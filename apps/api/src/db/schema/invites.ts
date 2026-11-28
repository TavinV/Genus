/**
 * Convites de usuário do portal (magic link com confirmação de CPF).
 *
 * Nem o token nem o CPF ficam em claro: `token_hash` é o SHA-256 do token e `cpf_hash` é HMAC-SHA256
 * com chave derivada do BETTER_AUTH_SECRET. Nenhum dos dois sai na API nem em log.
 *
 * O convite cria `admin` ou `rh` (conta inteira ou só uma empresa, `empresa_id`) ou o acesso de um `colaborador`
 * já cadastrado (`colaborador_id`; o CPF do convite é o do cadastro), sempre na própria conta: o CHECK de papel e a FK composta
 * `(conta_id, usuario_id)` repetem no banco a regra do service. A migration 0017 (SQL manual) congela
 * conta, e-mail, papel e hashes depois da criação e recusa mexer em convite já encerrado.
 */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, smallint, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { companies, employees, tenants, users } from './organization';
import { bytea, citext, id, ref, rh, tenantId } from './rh';

export const userInvites = rh.table(
  'convites_usuario',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    email: citext('email').notNull(),
    name: text('nome').notNull(),
    role: text('papel').notNull(),
    /** Convite de uma empresa: o usuário nasce restrito aos estabelecimentos dela. NULL = conta inteira. */
    companyId: ref('empresa_id'),
    /** Acesso do colaborador ao portal (/me): o usuário nasce ligado a este colaborador. Só com papel `colaborador`. */
    employeeId: ref('colaborador_id'),
    cpfHash: bytea('cpf_hash').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    /** `expirado` não é gravado: sai de `pendente` + `expira_em` vencido. */
    status: text('status').notNull().default('pendente'),
    /** CPFs errados no aceite. Na 5ª falha o convite é revogado. */
    attempts: smallint('tentativas').notNull().default(0),
    expiresAt: timestamp('expira_em', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('aceito_em', { withTimezone: true }),
    /** Usuário criado no aceite. */
    userId: ref('usuario_id'),
    /** FK simples: o super_admin que convida não pertence a conta nenhuma. */
    createdById: ref('criado_por_id').notNull(),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'fk_convites_usuario_conta', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({ name: 'fk_convites_usuario_usuario', columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ name: 'fk_convites_usuario_criado_por', columns: [t.createdById], foreignColumns: [users.id] }),
    foreignKey({ name: 'fk_convites_usuario_empresa', columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
    foreignKey({ name: 'fk_convites_usuario_colaborador', columns: [t.tenantId, t.employeeId], foreignColumns: [employees.tenantId, employees.id] }),
    unique('uq_convites_usuario_token_hash').on(t.tokenHash),
    uniqueIndex('uq_convites_usuario_pendente')
      .on(t.tenantId, t.email)
      .where(sql`status = 'pendente'`),
    check('ck_convites_usuario_papel', sql`papel IN ('admin','rh','colaborador')`),
    check('ck_convites_usuario_colaborador', sql`(papel = 'colaborador') = (colaborador_id IS NOT NULL) AND (papel <> 'colaborador' OR empresa_id IS NULL)`),
    check('ck_convites_usuario_status', sql`status IN ('pendente','aceito','revogado')`),
    check('ck_convites_usuario_tentativas', sql`tentativas BETWEEN 0 AND 5`),
    check('ck_convites_usuario_aceite', sql`(status = 'aceito') = (aceito_em IS NOT NULL) AND (status = 'aceito') = (usuario_id IS NOT NULL)`),
    index('idx_convites_usuario_conta').on(t.tenantId, t.createdAt.desc()),
    index('idx_convites_usuario_colaborador').on(t.tenantId, t.employeeId).where(sql`colaborador_id IS NOT NULL`),
  ],
);
