/** Envelopes HTTP da api do portal (backend.md §6): sucesso `{ data }`, erro `{ error, code }`. */
import { z } from 'zod';
import { RH_DOMAIN_ERROR_CODES } from '../modules/rules-common/rules/errors';

/**
 * Códigos de domínio do portal de RH (estáveis: o front e os testes dependem deles).
 * Vários traduzem uma constraint ou trigger do banco (`http/domain-errors.ts`).
 */
export const PORTAL_ERROR_CODES = [
  'CPF_INVALIDO',
  'CPF_DUPLICADO',
  'MATRICULA_DUPLICADA',
  'VINCULO_SOBREPOSTO',
  'ESCALA_SOBREPOSTA',
  'ESCALA_INATIVA',
  'AFASTAMENTO_SOBREPOSTO',
  'PERIODO_AQUISITIVO_SOBREPOSTO',
  'ATESTADO_DUPLICADO',
  'PERIODO_FECHADO',
  'BANCO_REGRA_VIGENCIA',
  'DECISOR_IGUAL_SOLICITANTE',
  'FECHAMENTO_COM_PENDENCIAS',
  'FECHAMENTO_DUPLICADO',
  'STATUS_INVALIDO',
  'REFERENCIA_INVALIDA',
  'COLABORADOR_DESLIGADO',
  'ARQUIVO_INVALIDO',
  'CPF_OU_PIN_INVALIDO',
  'CONSENTIMENTO_AUSENTE',
  'CHAVE_EMPRESA_AUSENTE',
  'ROSTO_NAO_PROCESSADO',
  'MOTOR_FACIAL_INDISPONIVEL',
  'MUITAS_TENTATIVAS',
  'MODELO_IA_INVALIDO',
  'APARELHO_NOME_DUPLICADO',
  'APARELHO_COM_BATIDAS',
  'APARELHO_INATIVO',
  'CHAVE_APARELHO_INVALIDA',
  'CALIBRACAO_EM_ANDAMENTO',
  'CALIBRACAO_NAO_AGUARDANDO',
  'CALIBRACAO_SEM_ORIGEM',
  // Super admin (modules/super-admin, docs/prompts/super-admin-contrato.md)
  'ACCOUNT_SUSPENDED',
  /** super_admin sem 2FA: a sessão só serve para ativá-lo (o portal leva à tela de ativação). */
  'MFA_REQUIRED',
  'MASTER_KEY_AUSENTE',
  'TENANT_ALREADY_SUSPENDED',
  'TENANT_NOT_SUSPENDED',
  'EMAIL_IN_USE',
  'CNPJ_INVALIDO',
  /** Empresas e estabelecimentos do painel do super_admin. */
  'CNPJ_DUPLICADO',
  'INSCRICAO_DUPLICADA',
  'REGISTRO_EM_USO',
  'EMPRESA_INATIVA',
  /** Convite de admin/rh por link, com confirmação de CPF. */
  'CPF_NAO_CONFERE',
  'CONVITE_INVALIDO',
  'EMPRESA_SEM_ESTABELECIMENTO',
  'COLABORADOR_COM_ACESSO',
  /** Setores, cargos e centros de custo (modules/org-units). */
  'NOME_DUPLICADO',
  'CODIGO_DUPLICADO',
] as const;

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  /** UNIQUE ou EXCLUDE do banco: já existe registro igual ou com período sobreposto. */
  'CONFLICT',
  /** CHECK, FK ou trigger de regra (ex.: setor desfalcado, período fechado). */
  'BUSINESS_RULE_VIOLATION',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  ...RH_DOMAIN_ERROR_CODES,
  ...PORTAL_ERROR_CODES,
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** `{ error (pt-BR), code (UPPER_SNAKE) }`. Nunca stack, SQL ou texto de exceção. */
export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.enum(ERROR_CODES),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.enum(['ok', 'down']),
    checks: z.object({ api: z.literal('ok'), database: z.enum(['ok', 'down']) }),
  }),
});

export const readyResponseSchema = z.object({
  data: z.object({ ready: z.boolean() }),
});
