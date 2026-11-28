/**
 * Autenticação do portal de RH com Better Auth (02 §2, security-lgpd.md §4).
 *
 * - Sessão em cookie httpOnly (portal web). Revogável: sign-out ou usuário inativo.
 * - JWT curto (15 min, EdDSA) em `GET /auth/token`, para clientes sem cookie
 *   (app, integrações). A chave pública sai em `GET /auth/jwks`.
 * - 2FA por TOTP (plugin twoFactor), ligado a `usuarios.mfa_ativo`. Obrigatório
 *   para o super_admin (plugins/request-context.ts).
 * - Sem cadastro público: usuário só nasce pelo UserService (RH ou admin cria).
 *
 * As tabelas são as do schema `rh` (db/schema/auth.ts e `usuarios`), com ids
 * bigint (generateId: 'serial'). Nada de senha, token ou segredo vai para log.
 */
import type { Logger } from '@genus/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { jwt, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { jwtKeys, loginCredentials, sessions, tenants, twoFactors, users, verifications } from '../../db/schema';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../../plugins/request-context';

/** Header que o handler de /auth/* preenche com o IP visto pelo Fastify (nunca o do cliente). */
export const CLIENT_IP_HEADER = 'x-genus-client-ip';

export const AUTH_BASE_PATH = '/auth';
export const SESSION_COOKIE_PREFIX = 'genus';
export const MIN_PASSWORD_LENGTH = 8; // [A CONFIRMAR] política de senha

export interface AuthConfig {
  /** Segredo do Better Auth (≥ 32 caracteres): assina cookies, cifra segredo TOTP e chave privada do JWT. */
  secret: string;
  /** URL pública da api (ex.: https://rh.genus.com.br/portal). Emissor e audiência do JWT. */
  baseURL: string;
  /** Origens do portal autorizadas a chamar /auth/* (proteção CSRF do Better Auth). */
  trustedOrigins: string[];
  /** Cookie `Secure`: true fora do dev. */
  secureCookies: boolean;
  /** Limite de tentativas do Better Auth (força bruta). Só os testes desligam. */
  rateLimit?: boolean;
  /** Validade do JWT curto. Padrão 15 min. */
  jwtExpiration?: string;
}

export function createAuth(db: Database, config: AuthConfig, logger: Logger) {
  return betterAuth({
    appName: 'Genus',
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: config.trustedOrigins,
    telemetry: { enabled: false },
    logger: {
      // O logger do Better Auth vai para o Pino, só com a mensagem (sem os argumentos,
      // que podem trazer e-mail, token ou erro do banco).
      log: (level, message) => {
        logger[level]({ component: 'better-auth' }, message);
      },
    },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: loginCredentials,
        verification: verifications,
        jwks: jwtKeys,
        twoFactor: twoFactors,
      },
    }),
    user: {
      additionalFields: {
        tenantId: { type: 'number', required: false, input: false },
        employeeId: { type: 'number', required: false, input: false },
        role: { type: 'string', required: true, input: false },
        isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 8 * 60 * 60, // 8 h [A CONFIRMAR]
      updateAge: 60 * 60, // renova a cada 1 h de uso
    },
    rateLimit: {
      enabled: config.rateLimit ?? true,
      storage: 'memory',
      window: 60,
      max: 100,
    },
    advanced: {
      cookiePrefix: SESSION_COOKIE_PREFIX,
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.secureCookies },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: 'serial' },
    },
    databaseHooks: {
      session: {
        create: {
          // Usuário desativado ou de conta suspensa não abre sessão (os triggers da 0008 e da 0015 derrubam as abertas).
          before: async (session) => {
            const [row] = await db
              .select({ isActive: users.isActive, tenantId: users.tenantId, tenantIsActive: tenants.isActive })
              .from(users)
              .leftJoin(tenants, eq(tenants.id, users.tenantId))
              .where(eq(users.id, Number(session.userId)))
              .limit(1);
            if (!row?.isActive) {
              throw new APIError('UNAUTHORIZED', { message: 'Usuário inativo', code: 'USER_INACTIVE' });
            }
            if (row.tenantId !== null && row.tenantIsActive === false) {
              throw new APIError('UNAUTHORIZED', { message: ACCOUNT_SUSPENDED_MESSAGE, code: 'ACCOUNT_SUSPENDED' });
            }
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'Genus',
        schema: { user: { fields: { twoFactorEnabled: 'mfaEnabled' } } },
        backupCodeOptions: { storeBackupCodes: 'encrypted' },
      }),
      jwt({
        jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
        jwt: {
          issuer: config.baseURL,
          audience: config.baseURL,
          expirationTime: config.jwtExpiration ?? '15m',
          // Só o necessário para identificar a sessão. Papel e conta são relidos do
          // banco a cada requisição (request-context), para valer a mudança na hora.
          definePayload: ({ session }) => ({ sid: String(session.id) }),
        },
        // O JWT sai só por GET /auth/token; não vai em header de toda resposta.
        disableSettingJwtHeader: true,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
