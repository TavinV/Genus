/**
 * Mocks da sessão e dos dados transversais (dono: orquestrador). Os módulos de tela têm o próprio
 * arquivo em mocks/<modulo>.ts. Dados fictícios, copiados do design.
 *
 * Sessão de mock: o login aceita qualquer senha e escolhe o papel pelo início do e-mail
 * (`rh@`, `admin@`, `gestor@`, `contador@`, `colaborador@`, `superadmin@`: sem conta, 2FA já ativo). E-mail com `2fa` pede o código 123456.
 * O papel fica em sessionStorage só no modo mock (não é dado sensível); some ao fechar a aba.
 */
import type { AuthApi } from '../endpoints/auth';
import type { OrgApi } from '../endpoints/org';
import type { OverviewApi } from '../endpoints/overview';
import type { CostCenter, Department, Establishment, JobTitle, Me, OrgUnit, Overview, Role } from '../contracts';
import { clone, delay, mockFail } from './runtime';
import { addCivilDays } from '../../format';
import { MOCK_TODAY } from './employee-portal';

export { useMocks } from './runtime';

export const MOCK_SESSION_KEY = 'genus.mock.session';
export const MOCK_TOTP_CODE = '123456';

const BASE_ME: Me = {
  id: '1', tenantId: '1', employeeId: null, name: 'Lúcia Martins', email: 'lucia@exemplo.test',
  role: 'rh', mfaEnabled: false, establishmentScope: null, authenticatedVia: 'cookie',
};

const MOCK_USERS: Record<Role, Partial<Me>> = {
  super_admin: { id: '900', tenantId: null, name: 'Operação Genus', email: 'superadmin@exemplo.test', role: 'super_admin', mfaEnabled: true },
  rh: {},
  admin: { id: '2', name: 'Paulo Andrade', email: 'admin@exemplo.test', role: 'admin' },
  gestor: { id: '3', name: 'Renata Lopes', email: 'gestor@exemplo.test', role: 'gestor', establishmentScope: ['1'] },
  contador: { id: '4', name: 'Marcos Teixeira', email: 'contador@exemplo.test', role: 'contador' },
  colaborador: { id: '5', name: 'João Pereira', email: 'colaborador@exemplo.test', role: 'colaborador', employeeId: '101', establishmentScope: ['1'] },
};

/** `me` padrão dos testes e do primeiro carregamento (RH, conta inteira). */
export const mockMe: Me = BASE_ME;

export const mockMeFor = (role: Role): Me => ({ ...BASE_ME, ...MOCK_USERS[role] });

const storage = () => (typeof window === 'undefined' ? null : window.sessionStorage);

export function readSession(): { role: Role; pending2fa: boolean } | null {
  const raw = storage()?.getItem(MOCK_SESSION_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { role?: string; pending2fa?: boolean };
    return v.role && v.role in MOCK_USERS ? { role: v.role as Role, pending2fa: Boolean(v.pending2fa) } : null;
  } catch {
    return null;
  }
}

const writeSession = (v: { role: string; pending2fa: boolean } | null) =>
  v ? storage()?.setItem(MOCK_SESSION_KEY, JSON.stringify(v)) : storage()?.removeItem(MOCK_SESSION_KEY);

export const mockAuthApi: AuthApi = {
  me: async () => {
    await delay(150);
    const s = readSession();
    if (!s || s.pending2fa) throw mockFail(401, 'UNAUTHENTICATED', 'Sessão expirada');
    return clone(mockMeFor(s.role));
  },
  signIn: async (email) => {
    await delay(400);
    const prefix = email.split('@')[0]?.replace(/2fa/g, '').replace(/^superadmin$/, 'super_admin') as Role;
    // Mensagem genérica: não revela se o e-mail existe.
    if (!(prefix in MOCK_USERS)) throw mockFail(401, 'INVALID_EMAIL_OR_PASSWORD', 'E-mail ou senha incorretos');
    const needs2fa = email.includes('2fa');
    writeSession({ role: prefix, pending2fa: needs2fa });
    return { twoFactorRequired: needs2fa };
  },
  verifyTotp: async (code) => {
    await delay(300);
    const s = readSession();
    if (!s) throw mockFail(401, 'UNAUTHENTICATED', 'Sessão expirada');
    if (code !== MOCK_TOTP_CODE) throw mockFail(401, 'INVALID_TWO_FACTOR_CODE', 'Código inválido');
    writeSession({ role: s.role, pending2fa: false });
  },
  signOut: async () => {
    await delay(100);
    writeSession(null);
  },
};

export const mockEstablishments: Establishment[] = [
  { id: '1', name: 'Fazenda Santa Helena', subtitle: 'Agropecuária Santa Helena Ltda', companyId: '1', isActive: true },
  { id: '2', name: 'Usina Boa Vista', subtitle: 'Usina Boa Vista S.A.', companyId: '2', isActive: true },
  { id: '3', name: 'Granja São José', subtitle: 'Granja São José Avicultura Ltda', companyId: '3', isActive: true },
];

export const DEPARTMENTS = ['Colheita', 'Ordenha', 'Agroindústria', 'Manutenção', 'Administrativo', 'Armazém'];
export const JOB_TITLES = ['Operador de colhedora', 'Ordenhadora', 'Trabalhador rural', 'Auxiliar de produção', 'Mecânico', 'Tratorista', 'Assistente administrativa', 'Eletricista', 'Conferente'];

const units = (names: string[], establishmentId: string, base: number): OrgUnit[] =>
  names.map((name, i) => ({ id: String(base + i), establishmentId, name }));

export const mockDepartments = (establishmentId: string): Department[] =>
  units(DEPARTMENTS, establishmentId, 10).map((u) => ({ ...u, establishmentId, maxSimultaneousVacations: 2 }));
export const mockJobTitles = (establishmentId: string): JobTitle[] =>
  units(JOB_TITLES, establishmentId, 30).map(({ id, name }) => ({ id, name, companyId: '1', cbo: null }));

/** Itens criados no modo mock (somem ao recarregar). */
const created = { departments: [] as Department[], jobTitles: [] as JobTitle[], costCenters: [] as CostCenter[] };
let nextMockId = 900;
const mockCostCenters = (): CostCenter[] =>
  [['CC 100', 'Campo'], ['CC 200', 'Oficina'], ['CC 300', 'Escritório']].map(([code, name], i) => ({ id: String(50 + i), companyId: '1', code: code!, name: name! }));

export const mockOrgApi: OrgApi = {
  establishments: async () => {
    await delay(150);
    return clone(mockEstablishments);
  },
  departments: async (establishmentId) => {
    await delay();
    return [...mockDepartments(establishmentId), ...created.departments.filter((d) => d.establishmentId === establishmentId)];
  },
  createDepartment: async (body) => {
    await delay();
    const d: Department = { id: String(nextMockId++), establishmentId: body.establishmentId, name: body.name, maxSimultaneousVacations: body.maxSimultaneousVacations ?? 1 };
    created.departments.push(d);
    return clone(d);
  },
  updateDepartment: async (id, body) => {
    await delay();
    const d = created.departments.find((x) => x.id === id) ?? { ...mockDepartments('1').find((x) => x.id === id)!, establishmentId: '1' };
    Object.assign(d, body);
    return clone(d);
  },
  jobTitles: async (establishmentId) => {
    await delay();
    return [...mockJobTitles(establishmentId), ...created.jobTitles];
  },
  createJobTitle: async (body) => {
    await delay();
    const j: JobTitle = { id: String(nextMockId++), companyId: '1', name: body.name, cbo: body.cbo ?? null };
    created.jobTitles.push(j);
    return clone(j);
  },
  updateJobTitle: async (id, body) => {
    await delay();
    const j = created.jobTitles.find((x) => x.id === id) ?? mockJobTitles('1').find((x) => x.id === id)!;
    Object.assign(j, body);
    return clone(j);
  },
  costCenters: async () => {
    await delay();
    return [...mockCostCenters(), ...created.costCenters];
  },
  createCostCenter: async (body) => {
    await delay();
    const c: CostCenter = { id: String(nextMockId++), companyId: '1', code: body.code, name: body.name };
    created.costCenters.push(c);
    return clone(c);
  },
  updateCostCenter: async (id, body) => {
    await delay();
    const c = created.costCenters.find((x) => x.id === id) ?? mockCostCenters().find((x) => x.id === id)!;
    Object.assign(c, body);
    return clone(c);
  },
};

/** Série fictícia de 14 dias terminando em MOCK_TODAY (fins de semana com pouco movimento). */
const mockSeries = (): Overview['series'] =>
  Array.from({ length: 14 }, (_, i) => {
    const date = addCivilDays(MOCK_TODAY, i - 13);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    return {
      date,
      workedMinutes: weekend ? 1_800 + i * 30 : 19_200 + ((i * 37) % 9) * 240,
      overtimeMinutes: weekend ? 240 : 600 + ((i * 53) % 7) * 120,
      absences: weekend ? 0 : (i * 3) % 4,
      inconsistent: weekend ? 0 : (i * 5) % 3,
    };
  });

export const mockOverview: Overview = {
  period: { from: addCivilDays(MOCK_TODAY, -13), to: MOCK_TODAY },
  previousPeriod: { from: addCivilDays(MOCK_TODAY, -27), to: addCivilDays(MOCK_TODAY, -14) },
  activeEmployees: 52,
  calculatedDays: 640,
  kpis: [
    { key: 'workedHours', label: 'Horas trabalhadas', value: '3.412', unit: 'h', delta: '+3%', trend: 'up', tone: 'good', comparison: 'vs. período anterior' },
    { key: 'overtimeHours', label: 'Horas extras', value: '186', unit: 'h', delta: '+12%', trend: 'up', tone: 'warn', comparison: 'vs. período anterior' },
    { key: 'absences', label: 'Faltas', value: '17', unit: 'dias', delta: '−18%', trend: 'down', tone: 'good', comparison: 'vs. período anterior' },
    { key: 'pendingAdjustments', label: 'Ajustes pendentes', value: '6', unit: '', delta: '+11', trend: 'up', tone: 'warn', comparison: 'pedidos no período' },
    { key: 'pendingCertificates', label: 'Atestados pendentes', value: '3', unit: '', delta: '+5', trend: 'up', tone: 'warn', comparison: 'recebidos no período' },
    { key: 'activeVacations', label: 'Em férias hoje', value: '4', unit: '', delta: '+2', trend: 'up', tone: 'neutral', comparison: 'começam em 30 dias' },
    { key: 'timeBankBalance', label: 'Saldo do banco de horas', value: '412,5', unit: 'h', delta: '38', trend: 'up', tone: 'warn', comparison: 'h vencem em 30 dias' },
  ],
  series: mockSeries(),
  statusBreakdown: { calculada: 601, inconsistente: 22, falta: 17 },
  topOvertime: [
    { employeeId: '101', name: 'Ana Ribeiro', overtimeMinutes: 1_260 },
    { employeeId: '102', name: 'Bruno Lima', overtimeMinutes: 1_080 },
    { employeeId: '103', name: 'Carla Souza', overtimeMinutes: 870 },
    { employeeId: '104', name: 'Diego Martins', overtimeMinutes: 640 },
    { employeeId: '105', name: 'Elisa Rocha', overtimeMinutes: 420 },
  ],
  alerts: [
    { id: 'inconsistent-days', severity: 'alerta', title: '22 dias inconsistentes', text: 'Há pendências na apuração que impedem o fechamento do período.', cta: 'Revisar apuração', target: 'apuracao' },
    { id: 'without-schedule', severity: 'alerta', title: '2 colaboradores sem escala', text: 'Sem escala vigente hoje, o dia não é apurado e não há falta nem hora extra.', cta: 'Ver colaboradores', target: 'colaboradores' },
    { id: 'pending-adjustments', severity: 'sinal', title: '6 ajustes aguardando decisão', text: 'Pedidos de inclusão de batida, justificativa ou abono.', cta: 'Decidir ajustes', target: 'ajustes' },
    { id: 'pending-certificates', severity: 'sinal', title: '3 atestados para analisar', text: 'O dia só vira afastamento depois de aprovado.', cta: 'Analisar atestados', target: 'atestados' },
  ],
};

export const mockOverviewApi: OverviewApi = {
  get: async () => {
    await delay(350);
    return clone(mockOverview);
  },
};

/** Papel da sessão de mock (para o mock imitar o que a api esconde por papel, ex.: CPF mascarado). */
export const mockCurrentRole = (): Role => readSession()?.role ?? 'rh';
