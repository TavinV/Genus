/** Regras puras do convite de usuário: papéis, prazo, tentativas, situação e e-mail mascarado. */

/** Papéis que o admin e o super_admin convidam por /invites. */
export const INVITE_ROLES = ['admin', 'rh'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** Tudo o que um convite cria: os acima e o acesso do colaborador (/employees/:id/access-invite). CHECK `ck_convites_usuario_papel`. */
export const ALL_INVITE_ROLES = ['admin', 'rh', 'colaborador'] as const;
export type AnyInviteRole = (typeof ALL_INVITE_ROLES)[number];

/** Situação do acesso do colaborador ao portal. */
export const EMPLOYEE_ACCESS_STATUSES = ['sem_acesso', 'convite_pendente', 'ativo', 'inativo'] as const;
export type EmployeeAccessStatus = (typeof EMPLOYEE_ACCESS_STATUSES)[number];

export const INVITE_STATUSES = ['pendente', 'aceito', 'revogado', 'expirado'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const INVITE_TTL_MS = 72 * 60 * 60_000;
/** Na 5ª confirmação de CPF errada o convite é revogado. */
export const MAX_CPF_ATTEMPTS = 5;

export const inviteExpiresAt = (now: Date): Date => new Date(now.getTime() + INVITE_TTL_MS);

/** `expirado` não é gravado: é o `pendente` cujo prazo acabou (no instante exato já não vale). */
export function inviteStatus(invite: { status: string; expiresAt: Date }, now: Date): InviteStatus {
  if (invite.status === 'aceito' || invite.status === 'revogado') return invite.status;
  return invite.expiresAt.getTime() > now.getTime() ? 'pendente' : 'expirado';
}

/** `maria@empresa.com.br` → `m***@empresa.com.br`. Não revela o tamanho do nome. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
