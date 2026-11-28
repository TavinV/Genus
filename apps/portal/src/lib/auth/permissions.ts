/**
 * Regras de exibição por perfil. Só controlam a tela (esconder/desabilitar): a api valida de novo
 * e a tela trata o 403/404. Espelham os `authorize(...)` de apps/api/src/modules/*\/routes.ts.
 * CID só para o RH (CLAUDE.md, LGPD). Admin nunca vê CID nem aprova atestado.
 * Gestor depende de PORTAL_GESTOR_ENABLED no back: desligado, a api devolve 403 e a tela mostra o estado 403.
 */
import type { Role } from '../api/contracts';

const RULES = {
  // Portais
  'rh.panel': ['admin', 'rh', 'gestor', 'contador'],
  'employee.portal': ['colaborador'],
  /** Painel da operação Genus (/admin). Só o super_admin; ele não entra nos módulos de RH. */
  'superAdmin.panel': ['super_admin'],

  // Menu do painel (o que aparece na sidebar)
  'nav.overview': ['admin', 'rh', 'gestor'],
  'nav.employees': ['admin', 'rh', 'gestor', 'contador'],
  'nav.timesheets': ['admin', 'rh', 'gestor'],
  'nav.adjustments': ['rh', 'gestor'],
  'nav.vacations': ['admin', 'rh', 'gestor'],
  'nav.certificates': ['admin', 'rh', 'gestor'],
  'nav.timeBank': ['admin', 'rh', 'gestor'],
  'nav.closings': ['admin', 'rh', 'contador'],
  'nav.reports': ['admin', 'rh', 'contador'],
  'nav.devices': ['admin', 'rh'],
  'nav.settings': ['admin', 'rh'],
  'nav.schedules': ['admin', 'rh'],
  /** Usuários do portal: convidar e revogar (invites/routes.ts). */
  'nav.users': ['admin'],

  // Colaboradores (employees/routes.ts)
  'employee.create': ['rh', 'admin'],
  'employee.edit': ['rh', 'admin'],
  'employee.terminate': ['rh', 'admin'],
  /** PIN novo para quem esqueceu (employees/routes.ts). */
  'employee.resetPin': ['rh', 'admin'],
  /** Convite de acesso do colaborador ao portal /me (invites/routes.ts). */
  'employee.portalAccess': ['rh', 'admin'],
  'employee.viewFullCpf': ['rh', 'admin'],
  /** [A CONFIRMAR] back: rh e admin (SALARY_ROLES); security-lgpd.md §1 diz "só RH". */
  'employee.viewSalary': ['rh', 'admin'],
  'assignment.view': ['rh', 'admin'],
  'assignment.edit': ['rh'],
  /** Setores, cargos e centros de custo (org-units/routes.ts). */
  'org.manage': ['rh', 'admin'],
  /** Feriados da conta e regra de feriado trabalhado (holidays/routes.ts). */
  'holiday.manage': ['rh', 'admin'],

  // Escalas (schedules/routes.ts)
  'schedule.view': ['rh', 'admin'],
  'schedule.edit': ['rh', 'admin'],

  // Apuração (timesheets/routes.ts)
  'timesheet.view': ['rh', 'admin', 'gestor'],
  'timesheet.recalculate': ['rh'],

  // Ajustes (adjustments/routes.ts). Abono: só o RH decide (04 §5).
  'adjustment.create': ['rh'],
  'adjustment.decide': ['rh', 'gestor'],
  'adjustment.decideAllowance': ['rh'],

  // Afastamentos (absences/routes.ts)
  'absence.view': ['rh', 'admin', 'gestor'],
  'absence.create': ['rh'],

  // Atestados (certificates, certificate-analysis)
  'certificate.view': ['rh', 'admin', 'gestor'],
  'certificate.viewCid': ['rh'],
  'certificate.viewFile': ['rh'],
  'certificate.viewDoctor': ['rh'],
  'certificate.analyze': ['rh'],
  'certificate.approve': ['rh'],

  // Férias (vacations/routes.ts)
  'vacation.view': ['rh', 'admin', 'gestor'],
  'vacation.create': ['rh', 'admin'],
  'vacation.decide': ['rh', 'admin', 'gestor'],
  'vacation.cancel': ['rh', 'admin'],

  // Fechamento (closing/routes.ts)
  'closing.view': ['rh', 'admin', 'contador'],
  'closing.manage': ['rh'],
  'closing.reopen': ['rh'],
  'closing.viewMirror': ['rh', 'admin', 'contador', 'gestor'],

  // Banco de horas (time-bank/routes.ts). Gestor vê saldos e extrato; a regra é do RH (admin só consulta).
  'timeBank.view': ['rh', 'admin', 'gestor'],
  'timeBank.viewPolicy': ['rh', 'admin'],
  'timeBank.editPolicy': ['rh'],

  // [MOCK] sem back: Totens, Relatórios, Configurações
  'device.manage': ['rh', 'admin'],
  'report.generate': ['rh', 'admin', 'contador'],
  'settings.manage': ['rh', 'admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof RULES;

export const can = (role: Role, action: Action) => (RULES[action] as readonly Role[]).includes(role);

export const SENSITIVE_PLACEHOLDER = 'Dado sensível restrito';

export { ROLE_LABEL } from '../labels';

/** Primeira tela de cada perfil depois do login. `super_admin` não entra nos módulos de RH: vai para /admin. */
export function homeFor(role: Role): string {
  if (role === 'super_admin') return '/admin';
  if (role === 'colaborador') return '/me';
  if (role === 'contador') return '/rh/fechamento';
  if (can(role, 'rh.panel')) return '/rh';
  return '/sem-acesso';
}
