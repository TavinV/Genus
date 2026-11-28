/**
 * Convites de usuário (magic link com confirmação de CPF). Um só service para as duas portas: o admin
 * da conta (`/portal/invites`) e o super_admin (`/portal/super-admin/tenants/:tenantId/invites`).
 *
 * Segurança: o aceite não recebe conta, papel, nome nem e-mail; tudo sai da linha do convite. O usuário
 * nasce na mesma transação que marca o convite, com a linha travada (uso único). Token inexistente,
 * expirado, usado, revogado ou de conta suspensa dão a mesma resposta (404 `CONVITE_INVALIDO`).
 * CPF, token e hashes nunca entram em log, auditoria ou erro.
 */
import type { Clock } from '@genus/shared';
import { z } from 'zod';
import type { Database } from '../../db/client';
import type { Transaction } from '../../db/executor';
import { notFound } from '../../http/access';
import { HttpError, pgError } from '../../plugins/error-handler';
import { recordAudit, type AuditEntry } from '../audit/audit';
import { UserService } from '../auth/user-service';
import { isValidCpf, normalizeCpf } from '../employees/rules/cpf';
import { generateInviteToken, hashInviteCpf, hashInviteToken, sameDigest } from './crypto';
import { InviteRepository, type InviteRow } from './repository';
import {
  ALL_INVITE_ROLES, INVITE_ROLES, inviteExpiresAt, inviteStatus, maskEmail, MAX_CPF_ATTEMPTS, type AnyInviteRole,
} from './rules/invite';
import type { acceptInviteBody, createInviteBody, EmployeeAccessDto, InviteDto } from './schemas';

export interface InviteServiceDeps {
  db: Database;
  clock: Clock;
  /** Chave do HMAC do CPF (`deriveInviteCpfKey`). */
  cpfHashKey: Buffer;
}

/** Quem convida ou revoga. `tenantId` vem da sessão (admin) ou da rota (super_admin), nunca do corpo. */
export interface InviteActor {
  tenantId: number;
  userId: number;
}

const roleSchema = z.enum(INVITE_ROLES);
const anyRoleSchema = z.enum(ALL_INVITE_ROLES);

export const invalidInvite = () => new HttpError(404, 'CONVITE_INVALIDO', 'Convite inválido ou expirado. Peça um novo convite');
const cpfMismatch = () => new HttpError(400, 'CPF_NAO_CONFERE', 'O CPF não confere com o convite');
const badCompany = (message: string) => new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'companyId', message }]);
const employeeHasAccess = () => new HttpError(409, 'COLABORADOR_COM_ACESSO', 'O colaborador já tem acesso ao portal');
const employeeTerminated = () => new HttpError(409, 'COLABORADOR_DESLIGADO', 'O colaborador já está desligado');
const emailInUse = () => new HttpError(409, 'EMAIL_IN_USE', 'Já existe um usuário com esse e-mail na plataforma');

function toDto(row: InviteRow, now: Date, companyName: string | null): InviteDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: roleSchema.parse(row.role),
    companyId: row.companyId,
    companyName: row.companyId === null ? null : companyName,
    status: inviteStatus(row, now),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

export class InviteService {
  private readonly users: UserService;

  constructor(
    private readonly d: InviteServiceDeps,
    private readonly repo = new InviteRepository(),
  ) {
    this.users = new UserService({ db: d.db });
  }

  async list(tenantId: number): Promise<InviteDto[]> {
    await this.assertTenant(tenantId);
    const rows = await this.repo.list(this.d.db, tenantId);
    const now = this.d.clock.now();
    return rows.map((r) => toDto(r, now, r.companyName));
  }

  async create(actor: InviteActor, body: z.infer<typeof createInviteBody>): Promise<{ invite: InviteDto; token: string }> {
    await this.assertTenant(actor.tenantId);
    return this.d.db.transaction((tx) => this.createIn(tx, actor, body));
  }

  /** A criação dentro de uma transação já aberta (conta nova + convite do admin). Quem chama garante a conta. */
  async createIn(tx: Transaction, actor: InviteActor, body: z.infer<typeof createInviteBody>): Promise<{ invite: InviteDto; token: string }> {
    const cpf = normalizeCpf(body.cpf);
    if (!isValidCpf(cpf)) throw new HttpError(400, 'CPF_INVALIDO', 'CPF inválido', [{ path: 'cpf', message: 'dígito verificador não confere' }]);

    const companyId = body.companyId ?? null;
    let companyName: string | null = null;
    if (companyId !== null) {
      // Empresa sem estabelecimento daria escopo vazio, que o request-context lê como "conta inteira".
      const company = await this.repo.company(tx, actor.tenantId, companyId);
      if (!company || !company.isActive) throw badCompany('empresa não encontrada');
      if (company.establishments === 0) throw badCompany('a empresa ainda não tem estabelecimento');
      companyName = company.name;
    }

    const { token, tokenHash } = generateInviteToken();
    const now = this.d.clock.now();
    if (await this.repo.emailExists(tx, body.email)) throw emailInUse();
    // Um pendente por (conta, e-mail): o anterior deixa de valer, mesmo já vencido.
    for (const id of await this.repo.revokePendingByEmail(tx, actor.tenantId, body.email)) {
      await this.audit(tx, { ...actor, entityId: id, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'revogado' } });
    }
    const row = await this.repo.insert(tx, {
      tenantId: actor.tenantId,
      email: body.email,
      name: body.name,
      role: body.role,
      companyId,
      cpfHash: hashInviteCpf(this.d.cpfHashKey, cpf),
      tokenHash,
      expiresAt: inviteExpiresAt(now),
      createdById: actor.userId,
      createdAt: now,
    });
    await this.audit(tx, { ...actor, entityId: row.id, action: 'criacao', after: { role: body.role, companyId, expiresAt: row.expiresAt } });
    return { invite: toDto(row, now, companyName), token };
  }

  /**
   * Situação do acesso do colaborador ao portal (/me): usuário ativo ou inativo, convite pendente ou nada.
   * Quem chama já conferiu o escopo do colaborador.
   */
  async employeeAccess(tenantId: number, employeeId: number): Promise<EmployeeAccessDto> {
    const user = await this.repo.userOfEmployee(this.d.db, tenantId, employeeId);
    if (user) return { status: user.isActive ? 'ativo' : 'inativo', email: user.email, expiresAt: null };
    const pending = await this.repo.pendingForEmployee(this.d.db, tenantId, employeeId, this.d.clock.now());
    if (pending) return { status: 'convite_pendente', email: pending.email, expiresAt: pending.expiresAt.toISOString() };
    return { status: 'sem_acesso', email: null, expiresAt: null };
  }

  /**
   * Convite de acesso do colaborador ao portal. Nome e CPF saem do cadastro (o CPF é conferido no aceite,
   * como nos outros convites); só o e-mail vem de quem convida. Um convite novo cancela o pendente.
   * Quem chama já conferiu o escopo do colaborador.
   */
  async createForEmployee(actor: InviteActor, employeeId: number, email: string): Promise<{ access: EmployeeAccessDto; token: string }> {
    return this.d.db.transaction(async (tx) => {
      const employee = await this.repo.lockEmployee(tx, actor.tenantId, employeeId);
      if (!employee) throw notFound('Colaborador');
      if (employee.terminationDate !== null) throw employeeTerminated();
      if (await this.repo.userOfEmployee(tx, actor.tenantId, employeeId)) throw employeeHasAccess();
      if (await this.repo.emailExists(tx, email)) throw emailInUse();

      const now = this.d.clock.now();
      const revoked = new Set([
        ...(await this.repo.revokePendingByEmployee(tx, actor.tenantId, employeeId)),
        ...(await this.repo.revokePendingByEmail(tx, actor.tenantId, email)),
      ]);
      for (const id of revoked) {
        await this.audit(tx, { ...actor, entityId: id, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'revogado' } });
      }
      const { token, tokenHash } = generateInviteToken();
      const row = await this.repo.insert(tx, {
        tenantId: actor.tenantId,
        email,
        name: employee.name,
        role: 'colaborador',
        companyId: null,
        employeeId,
        cpfHash: hashInviteCpf(this.d.cpfHashKey, employee.cpf),
        tokenHash,
        expiresAt: inviteExpiresAt(now),
        createdById: actor.userId,
        createdAt: now,
      });
      await this.audit(tx, { ...actor, entityId: row.id, action: 'criacao', after: { role: 'colaborador', employeeId, expiresAt: row.expiresAt } });
      return { access: { status: 'convite_pendente', email: row.email, expiresAt: row.expiresAt.toISOString() }, token };
    });
  }

  /** Cancela o convite de acesso pendente do colaborador (se houver). */
  async revokeForEmployee(actor: InviteActor, employeeId: number): Promise<EmployeeAccessDto> {
    await this.d.db.transaction(async (tx) => {
      for (const id of await this.repo.revokePendingByEmployee(tx, actor.tenantId, employeeId)) {
        await this.audit(tx, { ...actor, entityId: id, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'revogado' } });
      }
    });
    return this.employeeAccess(actor.tenantId, employeeId);
  }

  /** Revogar de novo não muda nada; convite aceito não se revoga (o usuário já existe). */
  async revoke(actor: InviteActor, inviteId: number): Promise<InviteDto> {
    const row = await this.d.db.transaction(async (tx) => {
      const current = await this.repo.getForUpdate(tx, actor.tenantId, inviteId);
      // O convite de acesso do colaborador se cancela pelo cadastro dele (/employees/:id/access-invite/revoke).
      if (!current || current.role === 'colaborador') throw notFound('Convite');
      if (current.status === 'aceito') throw new HttpError(409, 'CONFLICT', 'O convite já foi aceito e não pode ser revogado');
      if (current.status === 'revogado') return current;
      const revoked = await this.repo.revoke(tx, actor.tenantId, inviteId);
      await this.audit(tx, { ...actor, entityId: inviteId, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'revogado' } });
      return revoked;
    });
    const company = row.companyId === null ? undefined : await this.repo.company(this.d.db, actor.tenantId, row.companyId);
    return toDto(row, this.d.clock.now(), company?.name ?? null);
  }

  async preview(token: string): Promise<{ tenantName: string; name: string; emailMasked: string; role: AnyInviteRole; companyName: string | null; expiresAt: string }> {
    const invite = await this.repo.findPendingByTokenHash(this.d.db, hashInviteToken(token), this.d.clock.now());
    if (!invite) throw invalidInvite();
    const tenantName = await this.repo.activeTenantName(this.d.db, invite.tenantId);
    if (tenantName === undefined) throw invalidInvite();
    const company = invite.companyId === null ? undefined : await this.repo.company(this.d.db, invite.tenantId, invite.companyId);
    return {
      tenantName,
      name: invite.name,
      emailMasked: maskEmail(invite.email),
      role: anyRoleSchema.parse(invite.role),
      companyName: company?.name ?? null,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async accept(body: z.infer<typeof acceptInviteBody>): Promise<{ email: string }> {
    const cpfHash = hashInviteCpf(this.d.cpfHashKey, normalizeCpf(body.cpf));
    try {
      const outcome = await this.d.db.transaction(async (tx) => {
        const now = this.d.clock.now();
        const invite = await this.repo.findPendingByTokenHash(tx, hashInviteToken(body.token), now, true);
        if (!invite || (await this.repo.activeTenantName(tx, invite.tenantId, true)) === undefined) throw invalidInvite();
        const { tenantId, id: inviteId } = invite;

        if (!sameDigest(invite.cpfHash, cpfHash)) {
          const attempts = invite.attempts + 1;
          const status = attempts >= MAX_CPF_ATTEMPTS ? 'revogado' : 'pendente';
          await this.repo.registerFailure(tx, tenantId, inviteId, attempts, status);
          await this.audit(tx, {
            tenantId,
            userId: null,
            entityId: inviteId,
            action: 'alteracao',
            before: { attempts: invite.attempts, status: 'pendente' },
            after: { attempts, status },
          });
          // Sai sem lançar erro: a transação precisa ser confirmada para a tentativa contar.
          return null;
        }

        if (await this.repo.emailExists(tx, invite.email)) throw emailInUse();
        const role = anyRoleSchema.parse(invite.role);
        if (invite.employeeId !== null) {
          // Desligado depois do convite: o link não vale mais. Já com acesso (outro convite aceito): 409.
          if (!(await this.repo.employeeActive(tx, tenantId, invite.employeeId))) throw invalidInvite();
          if (await this.repo.userOfEmployee(tx, tenantId, invite.employeeId)) throw employeeHasAccess();
        }
        const user = await this.users.createUser(
          { tenantId, email: invite.email, name: invite.name, role, employeeId: invite.employeeId, password: body.password },
          tx,
        );
        if (invite.companyId !== null) {
          // Sem estabelecimento o escopo ficaria vazio (= conta inteira): o aceite para aqui.
          const scoped = await this.repo.scopeUserToCompany(tx, tenantId, user.id, invite.companyId);
          if (scoped === 0) throw new HttpError(409, 'EMPRESA_SEM_ESTABELECIMENTO', 'A empresa do convite não tem estabelecimento. Peça um novo convite');
        }
        await this.repo.markAccepted(tx, tenantId, inviteId, user.id, now);
        const by = { tenantId, userId: user.id };
        await this.audit(tx, { ...by, entityId: inviteId, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'aceito' } });
        await recordAudit(tx, this.d.clock, { ...by, entity: 'usuarios', entityId: user.id, action: 'criacao', after: { role, inviteId, companyId: invite.companyId } });
        return { email: user.email };
      });
      if (!outcome) throw cpfMismatch();
      return outcome;
    } catch (err) {
      // Corrida: o e-mail virou usuário entre a checagem e o INSERT.
      if (pgError(err)?.constraint === 'usuario_email_key') throw emailInUse();
      if (pgError(err)?.constraint === 'usuario_colaborador_id_key') throw employeeHasAccess();
      throw err;
    }
  }

  private async assertTenant(tenantId: number): Promise<void> {
    if (!(await this.repo.tenantExists(this.d.db, tenantId))) throw notFound('Conta');
  }

  private async audit(tx: Transaction, e: Omit<AuditEntry, 'entity'>): Promise<void> {
    await recordAudit(tx, this.d.clock, { ...e, entity: 'user_invite' });
  }
}
