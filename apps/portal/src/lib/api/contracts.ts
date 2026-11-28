/**
 * Tipos do portal copiados dos schemas Zod da api (apps/api). Ao mudar um schema
 * no back, atualize o tipo correspondente aqui e a tabela de rótulos em lib/labels.
 *
 * Valores de enumeração ficam em português, como no banco e na api. Nunca traduzir.
 */

/** ID opaco. A api devolve número hoje; o cliente converte para string na borda (lib/api/ids.ts). Quando o back passar a `publicId` (UUID), só muda a borda. */
export type EntityId = string;

// ---- comum (apps/api/src/http/schemas.ts) ----

/** Envelope de resposta única: `{ data }`. */
export interface Envelope<T> {
  data: T;
}

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** Resposta de listagem: `{ data, meta }`. */
export interface Paged<T> {
  data: T[];
  meta: ListMeta;
}

/** Paginação de listagem (padrão da api: page 1, pageSize 25, máximo 100). */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

// ---- auth (apps/api/src/modules/auth/me-routes.ts) ----

export const ROLES = ['super_admin', 'admin', 'rh', 'gestor', 'contador', 'colaborador'] as const;
export type Role = (typeof ROLES)[number];

export const AUTHENTICATED_VIA = ['cookie', 'jwt'] as const;
export type AuthenticatedVia = (typeof AUTHENTICATED_VIA)[number];

/** GET /me: o próprio usuário autenticado. Nunca traz hash, token nem segredo. */
export interface Me {
  id: EntityId;
  tenantId: EntityId | null;
  employeeId: EntityId | null;
  name: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
  establishmentScope: EntityId[] | null;
  authenticatedVia: AuthenticatedVia;
}

// ---- employees (apps/api/src/modules/employees) ----

export const EMPLOYEE_STATUSES = ['ativo', 'desligado'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const CONTRACT_TYPES = ['indeterminado', 'determinado', 'safra', 'intermitente'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export interface EmployeeListQuery extends PaginationQuery {
  establishmentId?: EntityId;
  status?: EmployeeStatus;
  /** Busca por nome ou matrícula (2 a 100 caracteres, sem acento). */
  q?: string;
}

export interface CreateEmployeeBody {
  establishmentId: EntityId;
  /** Entrada de 11 a 14 caracteres. */
  cpf: string;
  /** De 2 a 200 caracteres. */
  name: string;
  /** De 1 a 40 caracteres. */
  registrationNumber?: string;
  /** AAAA-MM-DD */
  birthDate: string;
  /** AAAA-MM-DD */
  admissionDate: string;
  managerId?: EntityId | null;
}

/** CPF e estabelecimento não mudam por aqui: o CPF liga o colaborador às batidas do arp. */
export interface UpdateEmployeeBody {
  name?: string;
  registrationNumber?: string | null;
  /** AAAA-MM-DD */
  birthDate?: string;
  managerId?: EntityId | null;
}

export interface TerminateEmployeeBody {
  /** AAAA-MM-DD */
  terminationDate: string;
  /** De 3 a 500 caracteres. */
  reason: string;
}

export interface Employee {
  id: EntityId;
  establishmentId: EntityId;
  /** Completo para rh e admin; mascarado (***.***.***-NN) para os demais. */
  cpf: string;
  name: string;
  registrationNumber: string | null;
  /** AAAA-MM-DD */
  birthDate?: string;
  /** AAAA-MM-DD */
  admissionDate: string;
  /** AAAA-MM-DD */
  terminationDate: string | null;
  terminationReason?: string | null;
  managerId: EntityId | null;
  status: EmployeeStatus;
}

/** Resposta do cadastro: o colaborador mais o PIN inicial. */
export interface CreatedEmployee extends Employee {
  /** PIN inicial do modo alternativo, mostrado UMA vez (o banco guarda só o hash). */
  initialPin: string;
}

export interface AssignmentParams {
  id: EntityId;
  assignmentId: EntityId;
}

export interface CreateAssignmentBody {
  jobTitleId: EntityId;
  departmentId: EntityId;
  costCenterId?: EntityId | null;
  contractType: ContractType;
  /** Valor em reais com até 2 casas, ex.: "2500.00". */
  baseSalary?: string | null;
  /** AAAA-MM-DD */
  validFrom: string;
  /** AAAA-MM-DD */
  validTo?: string | null;
}

export interface UpdateAssignmentBody {
  costCenterId?: EntityId | null;
  contractType?: ContractType;
  /** Valor em reais com até 2 casas, ex.: "2500.00". */
  baseSalary?: string | null;
  /** AAAA-MM-DD */
  validTo?: string | null;
}

export interface Assignment {
  id: EntityId;
  employeeId: EntityId;
  jobTitleId: EntityId;
  departmentId: EntityId;
  costCenterId: EntityId | null;
  contractType: ContractType;
  /** Só para rh e admin. [A CONFIRMAR] com o contador: valor e regra do salário-base. */
  baseSalary?: string | null;
  /** Marcado quando o salário aguarda revisão do contador. */
  salaryPendingAccountantReview?: true;
  /** AAAA-MM-DD */
  validFrom: string;
  /** AAAA-MM-DD */
  validTo: string | null;
}

// ---- schedules (apps/api/src/modules/schedules) ----

export const SCHEDULE_TYPES = ['5x2', '6x1', '12x36', 'livre'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const CYCLE_TYPES = ['semanal', 'ciclico'] as const;
export type CycleType = (typeof CYCLE_TYPES)[number];

/** Só avisa, nunca bloqueia (RN06, art. 74). */
export const SCHEDULE_WARNING_CODES = ['carga_semanal_acima_limite', 'folgas_abaixo_minimo'] as const;
export type ScheduleWarningCode = (typeof SCHEDULE_WARNING_CODES)[number];

export interface ScheduleListQuery {
  establishmentId?: EntityId;
  /** Busca pelo nome da escala (2 a 100 caracteres). */
  q?: string;
  /** Sem filtro: todas. */
  status?: 'ativa' | 'inativa';
}

/** Dia da escala na entrada. Horários no formato HH:mm. */
export interface ScheduleDayInput {
  /** De 0 a 59. */
  position: number;
  isDayOff?: boolean;
  /** HH:mm */
  startTime?: string | null;
  /** HH:mm */
  endTime?: string | null;
  /** HH:mm */
  breakStartTime?: string | null;
  /** HH:mm */
  breakEndTime?: string | null;
  crossesMidnight?: boolean;
}

export interface CreateScheduleBody {
  establishmentId: EntityId;
  /** De 2 a 100 caracteres. */
  name: string;
  type: ScheduleType;
  cycleType: CycleType;
  /** De 2 a 60. Obrigatório na escala cíclica. */
  cycleDays?: number | null;
  /** AAAA-MM-DD. Obrigatória na escala cíclica. */
  referenceDate?: string | null;
  /** Carga semanal em minutos. */
  weeklyMinutes: number;
  /** De 1 a 60 dias. */
  days: ScheduleDayInput[];
}

/** Troca nome, carga, dias (todos os dias da escala são substituídos) e ativa/desativa. Tipo e ciclo não mudam. */
export interface UpdateScheduleBody {
  name?: string;
  weeklyMinutes?: number;
  days?: ScheduleDayInput[];
  /** Inativa não recebe vínculo novo; quem já está nela continua. */
  isActive?: boolean;
}

export interface ScheduleDay {
  position: number;
  isDayOff: boolean;
  /** HH:mm */
  startTime: string | null;
  /** HH:mm */
  endTime: string | null;
  /** HH:mm */
  breakStartTime: string | null;
  /** HH:mm */
  breakEndTime: string | null;
  crossesMidnight: boolean;
}

export interface ScheduleWarning {
  /** AAAA-MM-DD. Data em que a regra de jornada usada passa a valer (RF11: aviso antes da troca). */
  ruleValidFrom: string;
  code: ScheduleWarningCode;
  plannedMinutes?: number;
  maxMinutes?: number;
  restDays?: number;
  minRestDays?: number;
}

export interface Schedule {
  id: EntityId;
  establishmentId: EntityId;
  name: string;
  /** Valor vindo da api como texto (ver ScheduleType para os valores aceitos na entrada). */
  type: string;
  /** Valor vindo da api como texto (ver CycleType para os valores aceitos na entrada). */
  cycleType: string;
  cycleDays: number | null;
  /** AAAA-MM-DD */
  referenceDate: string | null;
  weeklyMinutes: number;
  isActive: boolean;
  days: ScheduleDay[];
  /** Só avisa, nunca bloqueia (RN06, art. 74). */
  warnings: ScheduleWarning[];
}

/** Item da listagem de escalas (sem dias nem avisos). */
export type ScheduleSummary = Omit<Schedule, 'days' | 'warnings'>;

export interface AssignScheduleBody {
  scheduleId: EntityId;
  /** AAAA-MM-DD */
  validFrom: string;
  /** AAAA-MM-DD */
  validTo?: string | null;
}

export interface EmployeeSchedule {
  id: EntityId;
  employeeId: EntityId;
  scheduleId: EntityId;
  scheduleName: string;
  /** AAAA-MM-DD */
  validFrom: string;
  /** AAAA-MM-DD */
  validTo: string | null;
}

/** Troca de escala: a vigente termina no dia anterior a `validFrom` e a nova começa nele. */
export interface SwitchScheduleBody {
  scheduleId: EntityId;
  /** AAAA-MM-DD */
  validFrom: string;
}

/** GET /portal/schedules/:id/employees: quem está na escala na data. */
export interface ScheduleMember {
  employeeId: EntityId;
  name: string;
  registration: string | null;
  assignmentId: EntityId;
  validFrom: string;
  validTo: string | null;
}

/** Troca pontual de turno ou folga num dia (RF12). Muda só o previsto; nunca a marcação. */
export interface ScheduleOverride {
  id: EntityId;
  employeeId: EntityId;
  /** AAAA-MM-DD */
  date: string;
  isDayOff: boolean;
  /** HH:mm */
  startTime: string | null;
  /** HH:mm */
  endTime: string | null;
  reason: string;
  createdAt: string;
}

export interface CreateScheduleOverrideBody {
  date: string;
  isDayOff: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason: string;
}

// ---- timesheets (apps/api/src/modules/timesheets) ----

export const TIMESHEET_DAY_STATUSES = ['calculada', 'inconsistente'] as const;
export type TimesheetDayStatus = (typeof TIMESHEET_DAY_STATUSES)[number];

/** Origem da marcação na visão resolvida. A original nunca muda (RN01). */
export const PUNCH_ORIGINS = ['original', 'tratada'] as const;
export type PunchOrigin = (typeof PUNCH_ORIGINS)[number];

/** Tipos de inconsistência (valor do CHECK `inconsistencia_tipo`). */
export const ISSUE_TYPES = [
  'batida_faltando',
  'batidas_impares',
  'interjornada_menor_11h',
  'extra_acima_2h',
  'intervalo_nao_cumprido',
  'marcacao_duplicada',
  'marcacao_fora_de_ordem',
  'marcacao_fora_da_escala',
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

/** Motivo de um dia sem cálculo. */
export const RECALCULATE_SKIP_REASONS = ['sem_escala'] as const;
export type RecalculateSkipReason = (typeof RECALCULATE_SKIP_REASONS)[number];

export interface PeriodQuery {
  /** AAAA-MM-DD */
  from: string;
  /** AAAA-MM-DD */
  to: string;
}

export type RecalculateBody = PeriodQuery;

export interface Punch {
  sequence: number;
  /** ISO 8601, com fuso */
  at: string;
  origin: PunchOrigin;
  nsr: number | null;
  adjustmentId: EntityId | null;
}

export interface TimesheetIssue {
  type: IssueType;
  resolved: boolean;
}

/** Valores de `apuracoes_dia.situacao` (apps/api/src/modules/timesheets/rules/day.ts). O DTO tipa como string. */
export const DAY_SITUATIONS = ['normal', 'falta', 'folga', 'feriado', 'ferias', 'afastamento'] as const;
export type DaySituation = (typeof DAY_SITUATIONS)[number];

/** Apuração de um dia. Visão resolvida: a marcação original fica no arp e não muda. */
export interface TimesheetDay {
  /** AAAA-MM-DD */
  date: string;
  situation: string;
  status: TimesheetDayStatus;
  scheduleId: EntityId | null;
  expectedMinutes: number;
  workedMinutes: number;
  absenceMinutes: number;
  lateMinutes: number;
  overtime50Minutes: number;
  overtime100Minutes: number;
  nightMinutes: number;
  breakMinutes: number;
  /** RNF06: versão das linhas de parâmetros legais usadas. */
  parameterVersion: string;
  /** ISO 8601 */
  calculatedAt: string;
  punches: Punch[];
  issues: TimesheetIssue[];
}

export interface SkippedDay {
  /** AAAA-MM-DD */
  date: string;
  reason: RecalculateSkipReason;
}

export interface RecalculateResult {
  days: TimesheetDay[];
  /** Dias sem cálculo: sem escala vigente para o colaborador. */
  skipped: SkippedDay[];
}

/** GET /portal/timesheets?date&establishmentId&departmentId&status&q&page&pageSize: apuração do dia de todos. */
export interface DayRowQuery extends PaginationQuery {
  /** AAAA-MM-DD */
  date: string;
  establishmentId: EntityId;
  departmentId?: EntityId;
  status?: TimesheetDayStatus | 'falta';
  q?: string;
}

export interface DayRow {
  employeeId: EntityId;
  employeeName: string;
  registrationNumber: string | null;
  departmentName: string | null;
  jobTitleName: string | null;
  /** AAAA-MM-DD */
  date: string;
  /** Situação do dia (`DaySituation`; string no back). */
  situation: string;
  status: TimesheetDayStatus;
  /** A api diz se o dia é falta; o front não deduz. */
  isAbsence: boolean;
  punches: Punch[];
  expectedMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  absenceMinutes: number;
  issues: TimesheetIssue[];
}

export interface DayRowPage extends Paged<DayRow> {
  /** Contagens das abas, calculadas pela api sobre o filtro sem `status`. */
  counts: { todos: number; inconsistente: number; falta: number; calculada: number };
}

/** Motivo de um colaborador ficar fora do recálculo do dia do estabelecimento. */
export const DAY_RECALCULATE_SKIP_REASONS = ['sem_escala', 'periodo_fechado'] as const;
export type DayRecalculateSkipReason = (typeof DAY_RECALCULATE_SKIP_REASONS)[number];

/** POST /portal/timesheets/recalculate (rh): recalcula o dia de todo o estabelecimento. */
export interface DayRecalculateBody {
  establishmentId: EntityId;
  /** AAAA-MM-DD */
  date: string;
}

export interface DayRecalculateResult {
  /** Quantos colaboradores tiveram o dia recalculado. */
  recalculated: number;
  skipped: { employeeId: EntityId; reason: DayRecalculateSkipReason }[];
}

// ---- adjustments (apps/api/src/modules/adjustments) ----

export const ADJUSTMENT_TYPES = ['inclusao_batida', 'justificativa', 'abono'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export const ADJUSTMENT_STATUSES = ['pendente', 'aprovado', 'recusado'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export interface AdjustmentListQuery extends PaginationQuery {
  status?: AdjustmentStatus;
  employeeId?: EntityId;
  /** Busca por nome ou matrícula do colaborador (2 a 100 caracteres). */
  q?: string;
}

export interface CreateAdjustmentBody {
  /** AAAA-MM-DD */
  date: string;
  type: AdjustmentType;
  /** Só na inclusão de batida, obrigatório nela: o instante proposto (ISO 8601 com fuso). */
  proposedAt?: string;
  /** Motivo de quem pede: de 3 a 500 caracteres. */
  reason: string;
}

export interface ApproveAdjustmentBody {
  /** Nota de quem decide: de 3 a 500 caracteres. */
  note?: string;
}

export interface RejectAdjustmentBody {
  /** Nota de quem decide: de 3 a 500 caracteres. */
  reason: string;
}

export interface Adjustment {
  id: EntityId;
  employeeId: EntityId;
  /** AAAA-MM-DD */
  date: string;
  type: AdjustmentType;
  /** ISO 8601 com fuso */
  proposedAt: string | null;
  reason: string;
  status: AdjustmentStatus;
  requestedById: EntityId;
  /** ISO 8601 */
  requestedAt: string;
  decidedById: EntityId | null;
  /** ISO 8601 */
  decidedAt: string | null;
  decisionReason: string | null;
}

// ---- absences (apps/api/src/modules/absences) ----

/** `atestado` não entra aqui: o afastamento por atestado nasce da aprovação do atestado. */
export const MANUAL_ABSENCE_TYPES = ['maternidade', 'paternidade', 'casamento', 'obito', 'doacao_sangue', 'alistamento', 'inss', 'outro'] as const;
export type ManualAbsenceType = (typeof MANUAL_ABSENCE_TYPES)[number];

export interface CreateAbsenceBody {
  type: ManualAbsenceType;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD, não antes do início. */
  endDate: string;
}

export interface Absence {
  id: EntityId;
  employeeId: EntityId;
  /** Valor vindo da api como texto (inclui `atestado`, que não é criado à mão). */
  type: string;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD */
  endDate: string;
  certificateId: EntityId | null;
}

// ---- certificates (apps/api/src/modules/certificates) ----
// Dado de saúde (RN15, LGPD art. 11): NENHUMA resposta tem CID (nem cifrado), hash do arquivo ou texto de OCR.
// Médico e arquivo só para o RH. O colaborador vê status e motivo.

export const CERTIFICATE_STATUSES = ['pendente', 'aprovado', 'recusado'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export interface CertificateListQuery extends PaginationQuery {
  status?: CertificateStatus;
  employeeId?: EntityId;
  /** Busca por nome ou matrícula do colaborador (2 a 100 caracteres). */
  q?: string;
}

export interface RejectCertificateBody {
  /** Motivo: de 3 a 500 caracteres. */
  reason: string;
}

/** Campos do multipart de envio (o arquivo vai no campo `file`). Chegam como texto; a api converte. Informe `days` ou `hours`, um dos dois. */
export interface SubmitCertificateFields {
  /** AAAA-MM-DD */
  startDate: string;
  /** De 1 a 365. Um dos dois: days ou hours. */
  days?: number;
  /** De 1 a 24. Um dos dois: days ou hours. */
  hours?: number;
  /** De 2 a 200 caracteres. */
  doctorName?: string;
  /** Só os números do CRM. */
  doctorCrm?: string;
  /** UF em maiúsculas, ex.: "SP". */
  doctorCrmUf?: string;
}

/** Visão comum (admin e gestor): "afastado de D1 a D2", sem diagnóstico (04 G7). */
export interface Certificate {
  id: EntityId;
  employeeId: EntityId;
  /** AAAA-MM-DD */
  startDate: string;
  days: number | null;
  hours: number | null;
  status: CertificateStatus;
  /** ISO 8601 */
  sentAt: string;
  /** ISO 8601 */
  decidedAt: string | null;
}

/** Visão do RH: + médico e link do arquivo. Ainda sem CID (gravação do CID fica para depois). */
export interface CertificateRh extends Certificate {
  doctorName: string | null;
  doctorCrm: string | null;
  doctorCrmUf: string | null;
  decisionReason: string | null;
  /** Link do arquivo do atestado (download auditado). */
  fileUrl: string;
}

/** Visão do próprio colaborador (RF27): status e motivo da decisão. */
export interface MyCertificate extends Certificate {
  decisionReason: string | null;
}

// ---- certificate-analysis (apps/api/src/modules/certificate-analysis) ----
// Só o RH chama estas rotas. A resposta não traz hash do arquivo, texto completo nem chave de nada.
// O CID aparece interpretado (capítulo), porque o RH é o único perfil que vê CID.

/** Tamanho máximo do texto enviado à análise (caracteres). */
export const MAX_TEXT_CHARS = 20_000;

export const ANALYSIS_PROVIDERS = ['regras', 'mock', 'anthropic', 'openai_compativel'] as const;
export type AnalysisProvider = (typeof ANALYSIS_PROVIDERS)[number];

export const FINDING_SEVERITIES = ['alta', 'media', 'baixa'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const AI_STATUSES = ['concluida', 'nao_executada', 'falhou'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

/** Falhas da IA (valores de `AiFailure` em ai/provider.ts). Falha da IA não vira erro 500. */
export const AI_FAILURES = ['saida_fora_do_schema', 'provedor_indisponivel', 'tempo_esgotado', 'recusa_do_modelo', 'saida_truncada', 'dados_pessoais_no_envio'] as const;
export type AiFailure = (typeof AI_FAILURES)[number];

export const RECOMMENDATIONS = ['revisar_manual', 'sem_recomendacao'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** Itens verificados no atestado. */
export const FIELD_ITEMS = ['data_atestado', 'periodo_afastamento', 'profissional', 'legibilidade'] as const;
export type FieldItem = (typeof FIELD_ITEMS)[number];

export const FIELD_STATUSES = ['ok', 'ausente', 'incoerente', 'ilegivel'] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

export const CID_STATUSES = ['valido', 'fora_da_tabela'] as const;
export type CidStatus = (typeof CID_STATUSES)[number];

export const CID_SOURCES = ['regra', 'ia'] as const;
export type CidSource = (typeof CID_SOURCES)[number];

export const RISK_LEVELS = ['baixo', 'medio', 'alto'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RELIABILITY_BANDS = ['baixa', 'media', 'alta'] as const;
export type ReliabilityBand = (typeof RELIABILITY_BANDS)[number];

export interface AnalyzeCertificateBody {
  /** Texto extraído do atestado (OCR ou digitado pelo RH). Fica cifrado, nunca em log. De 20 a 20.000 caracteres. */
  text: string;
  /** Modelos a rodar (`provedor:modelo`). Sem a lista: o padrão do ambiente. Dois ou mais: gera comparação. De 1 a 4, sem repetição. */
  models?: string[];
}

export interface AnalysisFinding {
  code: string;
  severity: FindingSeverity;
  message: string;
}

export interface CheckedField {
  item: FieldItem;
  status: FieldStatus;
  /** Trecho literal do texto que sustenta a situação; nulo se o campo está ausente. */
  evidence: string | null;
}

export interface FieldPossibility {
  /** Campo ambíguo: data_atestado, periodo_afastamento, profissional, crm, cid... */
  field: string;
  hypotheses: { value: string; confidence: number }[];
}

export interface CidFinding {
  code: string;
  chapter: string | null;
  chapterTitle: string | null;
  status: CidStatus;
  confidence: number;
  source: CidSource;
}

export interface AnalysisAiResult {
  status: AiStatus;
  failure: AiFailure | null;
}

export interface AnalysisRisk {
  score: number;
  level: RiskLevel;
  findings: AnalysisFinding[];
}

export interface AnalysisReliability {
  score: number;
  band: ReliabilityBand;
  cap: number;
}

export interface CertificateAnalysis {
  id: EntityId;
  certificateId: EntityId;
  provider: AnalysisProvider;
  model: string | null;
  promptVersion: string | null;
  rulesVersion: string;
  /** Hash do texto redigido enviado à análise (não é o hash do arquivo). */
  inputHash: string | null;
  /** ISO 8601 */
  analyzedAt: string;
  responseMs: number | null;
  /** Sempre presente: a análise é indicativa e não comprova autenticidade. */
  notice: string;
  warnings: string[];
  recommendation: Recommendation;
  ai: AnalysisAiResult;
  checkedFields: CheckedField[];
  possibilities: FieldPossibility[];
  cid: CidFinding[] | null;
  risk: AnalysisRisk;
  reliability: AnalysisReliability;
}

export interface AnalysisComparison {
  agreementByField: Record<string, number>;
  divergences: { field: string; values: Record<string, string> }[];
  responseMs: Record<string, number | null>;
}

export interface AnalyzeCertificateResult {
  certificateId: EntityId;
  /** O status do atestado depois da análise: a IA nunca o altera. */
  certificateStatus: CertificateStatus;
  analyses: CertificateAnalysis[];
  comparison: AnalysisComparison | null;
}

// ---- vacations (apps/api/src/modules/vacations) ----

export const VACATION_STATUSES = ['solicitada', 'aprovada', 'recusada', 'cancelada', 'gozada'] as const;
export type VacationStatus = (typeof VACATION_STATUSES)[number];

export interface CreateAccrualPeriodBody {
  /** AAAA-MM-DD */
  startDate: string;
}

export interface RequestVacationBody {
  accrualPeriodId: EntityId;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD, não antes do início. */
  endDate: string;
  /** Abono pecuniário, de 0 a 10 dias. */
  cashBonusDays?: number;
}

export interface RejectVacationBody {
  /** Motivo: de 3 a 500 caracteres. */
  reason: string;
}

export interface Vacation {
  id: EntityId;
  accrualPeriodId: EntityId;
  employeeId: EntityId;
  departmentId: EntityId;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD */
  endDate: string;
  days: number;
  cashBonusDays: number;
  status: VacationStatus;
  /** ISO 8601 */
  requestedAt: string;
  /** ISO 8601 */
  decidedAt: string | null;
  decisionReason: string | null;
  /** RN12: dias depois do fim do período concessivo (pagos em dobro). */
  daysPaidInDouble: number;
}

export interface AccrualPeriod {
  id: EntityId;
  employeeId: EntityId;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD */
  endDate: string;
  /** AAAA-MM-DD */
  grantDeadline: string;
  unjustifiedAbsences: number;
  entitledDays: number;
  /** Valor vindo da api como texto. */
  status: string;
  /** Direito menos o que já está aprovado ou gozado (dias + abono). */
  remainingDays: number;
  vacations: Vacation[];
}

// ---- closing (apps/api/src/modules/closing) ----

export const CLOSING_STATUSES = ['aberto', 'fechado', 'reaberto'] as const;
export type ClosingStatus = (typeof CLOSING_STATUSES)[number];

export interface ListClosingsQuery {
  establishmentId?: EntityId;
}

export interface CreateClosingBody {
  establishmentId: EntityId;
  /** Competência `AAAA-MM`. O período vai do dia 1 ao último dia do mês [A CONFIRMAR]. */
  referenceMonth: string;
}

export interface ReopenClosingBody {
  /** Motivo: de 3 a 500 caracteres. Reabrir apaga a ciência dos espelhos. */
  reason: string;
}

export interface ClosingMirrorParams {
  id: EntityId;
  employeeId: EntityId;
}

export interface MyMirrorParams {
  closingId: EntityId;
}

export interface Closing {
  id: EntityId;
  establishmentId: EntityId;
  /** AAAA-MM */
  referenceMonth: string;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD */
  endDate: string;
  status: ClosingStatus;
  /** ISO 8601 */
  closedAt: string | null;
  /** ISO 8601 */
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface MirrorTotals {
  expectedMinutes: number;
  workedMinutes: number;
  absenceMinutes: number;
  lateMinutes: number;
  overtime50Minutes: number;
  overtime100Minutes: number;
  nightMinutes: number;
}

export interface MirrorEmployee {
  id: EntityId;
  name: string;
  cpf: string;
  registrationNumber: string | null;
}

export interface MirrorTimeBank {
  balanceMinutes: number;
  periodEntries: { date: string; type: string; minutes: number }[];
}

/** Espelho em JSON (RF47). O PDF assinado depende do signer: `pdfUrl` fica nulo por ora. */
export interface Mirror {
  closing: Closing;
  employee: MirrorEmployee;
  days: TimesheetDay[];
  totals: MirrorTotals;
  timeBank: MirrorTimeBank;
  pdfUrl: string | null;
  /** ISO 8601 */
  acknowledgedAt: string | null;
}

export interface MyMirrorSummary {
  closingId: EntityId;
  /** AAAA-MM */
  referenceMonth: string;
  status: ClosingStatus;
  /** ISO 8601 */
  acknowledgedAt: string | null;
}

export interface GenerateMirrorsResult {
  generated: number;
  total: number;
}

export interface MirrorAcknowledgement {
  closingId: EntityId;
  /** ISO 8601 */
  acknowledgedAt: string;
}

// ---- employee-portal (apps/api/src/modules/employee-portal) ----

export interface TimeBankEntry {
  /** AAAA-MM-DD */
  date: string;
  /** Valor vindo da api como texto. */
  type: string;
  minutes: number;
  /** AAAA-MM-DD */
  dueDate: string | null;
}

/** Saldo e extrato do banco de horas do próprio colaborador (RF52). */
export interface TimeBank {
  balanceMinutes: number;
  expiringIn30DaysMinutes: number;
  entries: TimeBankEntry[];
}

// ---- time-bank (apps/api/src/modules/time-bank) ----

export interface TimeBankBalanceQuery extends PaginationQuery {
  establishmentId: EntityId;
  /** Busca por nome ou matrícula. */
  q?: string;
}

/** GET /portal/time-bank?establishmentId&q&page&pageSize: saldos vistos pelo RH. */
export interface TimeBankBalanceRow {
  employeeId: EntityId;
  employeeName: string;
  departmentName: string | null;
  balanceMinutes: number;
  expiringIn30DaysMinutes: number;
  /** AAAA-MM-DD do vencimento mais próximo. */
  nextDueDate: string | null;
}

/** GET /portal/employees/:id/time-bank: mesmo formato do /me/time-bank. */
export type EmployeeTimeBank = TimeBank;

/** Valores de `regras_banco_horas.modalidade`. */
export const TIME_BANK_MODALITIES = ['individual_6m', 'coletivo_12m'] as const;
export type TimeBankModality = (typeof TIME_BANK_MODALITIES)[number];

/** Regra do banco de horas do estabelecimento (GET e PUT /portal/establishments/:id/time-bank-policy). */
export interface TimeBankPolicy {
  id: EntityId;
  establishmentId: EntityId;
  modality: TimeBankModality;
  /** Peso como texto com 2 casas, de "1.00" a "9.99". */
  sundayWeight: string;
  /** Peso como texto com 2 casas, de "1.00" a "9.99". */
  holidayWeight: string;
  /** AAAA-MM-DD */
  validFrom: string;
  /** AAAA-MM-DD, inclusivo; null = em aberto. */
  validTo: string | null;
}

/** PUT: data posterior encerra a vigência anterior; a mesma data atualiza; anterior → 409 BANCO_REGRA_VIGENCIA. */
export type SaveTimeBankPolicyBody = Pick<TimeBankPolicy, 'modality' | 'sundayWeight' | 'holidayWeight' | 'validFrom'>;

// ---- facial (apps/api/src/modules/facial) ----

/** Campos do multipart de cadastro facial (as fotos, 1 a 5, vão no campo `photos`). Chegam como texto. */
export interface FacialEnrollmentFields {
  cpf: string;
  /** De 4 a 6 dígitos. */
  pin: string;
  consentAccepted: 'true' | 'false';
  consentTextVersion: string;
}

export interface FacialEnrollment {
  employeeId: EntityId;
  /** ISO 8601 */
  enrolledAt: string;
  imagesProcessed: number;
  modelVersion: string;
}

export interface FacialStatusBody {
  cpf: string;
}

export interface FacialStatus {
  enrolled: boolean;
  /** ISO 8601 */
  enrolledAt: string | null;
}

// ---- [MOCK] contratos sem back ----

export const TRENDS = ['up', 'down'] as const;
export type Trend = (typeof TRENDS)[number];

export const TONES = ['good', 'warn', 'neutral'] as const;
export type Tone = (typeof TONES)[number];

/** GET /portal/establishments: só a conta e o escopo da sessão. `subtitle` é a razão social. */
export interface Establishment {
  id: EntityId;
  name: string;
  subtitle: string;
  /** Empresa do estabelecimento (`subtitle` é a razão social dela). Ausente nas opções sintéticas da tela. */
  companyId?: EntityId;
  isActive: boolean;
}

/** GET /portal/overview?establishmentId&from&to: valores já calculados e formatados pela api. */
export interface OverviewKpi {
  key: 'workedHours' | 'overtimeHours' | 'absences' | 'pendingAdjustments' | 'pendingCertificates' | 'activeVacations' | 'timeBankBalance';
  label: string;
  value: string;
  unit: string;
  delta: string;
  trend: Trend;
  tone: Tone;
  comparison: string;
}

export type OverviewAlertTarget = 'apuracao' | 'escalas' | 'colaboradores' | 'ajustes' | 'atestados' | 'banco-horas';

export interface OverviewAlert {
  id: string;
  severity: 'alerta' | 'sinal';
  title: string;
  text: string;
  cta: string;
  target: OverviewAlertTarget;
}

/** Um dia do período, somado para o escopo da sessão. */
export interface OverviewSeriesPoint {
  /** AAAA-MM-DD */
  date: string;
  workedMinutes: number;
  overtimeMinutes: number;
  absences: number;
  inconsistent: number;
}

export interface Overview {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  activeEmployees: number;
  /** Zero = nenhum dia apurado no período: a tela mostra o estado vazio. */
  calculatedDays: number;
  kpis: OverviewKpi[];
  series: OverviewSeriesPoint[];
  statusBreakdown: { calculada: number; inconsistente: number; falta: number };
  topOvertime: { employeeId: EntityId; name: string; overtimeMinutes: number }[];
  alerts: OverviewAlert[];
}

// Os contratos abaixo são PROPOSTAS para o back (docs/portal-endpoints-pendentes.md).
// Enquanto não existem, só respondem com NEXT_PUBLIC_USE_MOCKS=true; com false, a tela mostra "Em breve".

/** Item de cadastro para seletores e nomes (setor, cargo ou centro de custo). */
export interface OrgUnit {
  id: EntityId;
  /** Só o setor é do estabelecimento; cargo e centro de custo são da empresa. */
  establishmentId?: EntityId;
  name: string;
}

/** GET /portal/departments?establishmentId= */
export interface Department extends OrgUnit {
  establishmentId: EntityId;
  /** Quantas pessoas do setor podem estar de férias ao mesmo tempo (mínimo 1). */
  maxSimultaneousVacations: number;
}

/** GET /portal/job-titles?establishmentId= (cargos da empresa do estabelecimento). */
export interface JobTitle extends OrgUnit {
  companyId: EntityId;
  /** CBO com 6 dígitos, opcional. */
  cbo: string | null;
}

/** GET /portal/cost-centers?establishmentId= (centros de custo da empresa do estabelecimento). */
export interface CostCenter extends OrgUnit {
  companyId: EntityId;
  code: string;
}

export interface CreateDepartmentBody { establishmentId: EntityId; name: string; maxSimultaneousVacations?: number }
export type UpdateDepartmentBody = Partial<Pick<Department, 'name' | 'maxSimultaneousVacations'>>;
export interface CreateJobTitleBody { establishmentId: EntityId; name: string; cbo?: string | null }
export type UpdateJobTitleBody = Partial<Pick<JobTitle, 'name' | 'cbo'>>;
export interface CreateCostCenterBody { establishmentId: EntityId; code: string; name: string }
export type UpdateCostCenterBody = Partial<Pick<CostCenter, 'code' | 'name'>>;

/** [MOCK] GET /portal/vacations/calendar?establishmentId&departmentId&month=AAAA-MM. */
export interface VacationCalendar {
  /** AAAA-MM */
  month: string;
  departments: VacationCalendarDepartment[];
}

export interface VacationCalendarDepartment {
  departmentId: EntityId;
  name: string;
  headcount: number;
  /** Máximo de pessoas do setor fora ao mesmo tempo (parâmetro da empresa). */
  maxSimultaneous: number;
  /** Ocupação por dia do mês (índice 0 = dia 1), já calculada pela api. */
  dailyOccupancy: number[];
  rows: VacationCalendarRow[];
}

export interface VacationCalendarRow {
  vacationId: EntityId;
  employeeId: EntityId;
  employeeName: string;
  /** AAAA-MM-DD */
  startDate: string;
  /** AAAA-MM-DD */
  endDate: string;
  status: VacationStatus;
  /** A api informa se aprovar este pedido passa do limite do setor. */
  exceedsLimit: boolean;
  /** Próxima janela livre sugerida pela api, se houver (AAAA-MM-DD). */
  nextFreeStartDate: string | null;
}

// ---- Totens (aparelhos coletores). Contrato real: docs/totem-contrato.md §3.1 ----

export const DEVICE_CONNECTIONS = ['online', 'offline', 'inativo'] as const;
export type DeviceConnection = (typeof DEVICE_CONNECTIONS)[number];

export const CALIBRATION_STATES = ['calibrado', 'padrao', 'desatualizado'] as const;
export type CalibrationState = (typeof CALIBRATION_STATES)[number];

/** GET /portal/devices?establishmentId&connection. A chave do aparelho NUNCA vem aqui (só o prefixo, para reconhecer qual é). */
export interface Device {
  id: EntityId;
  establishmentId: EntityId;
  name: string;
  isActive: boolean;
  connection: DeviceConnection;
  /** ISO 8601 */
  lastSyncAt: string | null;
  /** Batidas guardadas offline no aparelho, ainda não recebidas. */
  pendingPunches: number;
  appVersion: string | null;
  calibrationState: CalibrationState;
  /** Aparelho com batidas não se apaga (Portaria 671): só se desativa. */
  hasPunches: boolean;
  /** 8 primeiros caracteres da chave (ex.: `gk_3f9a1`); null enquanto nenhuma chave foi gerada. */
  keyPrefix: string | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface DeviceListQuery {
  establishmentId?: EntityId;
  connection?: DeviceConnection;
  /** [MOCK] Busca pelo nome do totem (2 a 100 caracteres). */
  q?: string;
}

export interface CreateDeviceBody {
  establishmentId: EntityId;
  name: string;
}

export interface UpdateDeviceBody {
  name?: string;
  isActive?: boolean;
}

/** Resposta de POST /devices e POST /devices/:id/regenerate-key. A chave aparece UMA vez. */
export interface DeviceWithKey {
  device: Device;
  apiKey: string;
}

export interface DeviceCalibrationSettings {
  /** null = herda o padrão da engine. */
  recognitionThreshold: number | null;
  livenessThreshold: number | null;
  effectiveRecognitionThreshold: number;
  effectiveLivenessThreshold: number;
  isCalibrated: boolean;
  /** ISO 8601 */
  calibratedAt: string | null;
  calibrationSourceDeviceId: EntityId | null;
  calibrationSourceName: string | null;
}

export const CALIBRATION_SESSION_STATUSES = ['aguardando', 'calculada', 'aplicada', 'descartada', 'falhou'] as const;
export type CalibrationSessionStatus = (typeof CALIBRATION_SESSION_STATUSES)[number];

export interface CalibrationThresholds {
  recognitionThreshold: number;
  livenessThreshold: number;
}

export type CalibrationProfileName = 'conservative' | 'balanced' | 'liberal';

/** Uma opção de limiar de reconhecimento calculada pela engine. */
export interface CalibrationProfile {
  profile: CalibrationProfileName;
  label: string;
  recognitionThreshold: number;
  /** 0 a 1 */
  genuineAcceptRate: number;
  /** 0 a 1 */
  impostorRejectRate: number;
  interpretation: string;
}

/** Só números agregados: a api nunca devolve imagem nem embedding. */
export interface CalibrationSessionResult {
  current: CalibrationThresholds;
  proposed: CalibrationThresholds;
  /** 0 a 100, calculada pela engine. */
  qualityScore: number;
  recommendations: string[];
  /** Distâncias para o gráfico (genuíno x impostor), já agregadas em faixas. */
  distanceHistogram: { bucket: number; genuine: number; impostor: number }[];
  /** Ausentes em sessões antigas. */
  recommendedProfile?: CalibrationProfileName;
  profiles?: CalibrationProfile[];
}

/**
 * GET /portal/devices/:id/calibration/session (null = sem sessão) e POST .../calibration/start.
 * `aguardando` = o totem ainda não enviou as capturas; `calculada` = pronta para Aplicar ou Descartar.
 */
export interface CalibrationSession {
  id: EntityId;
  status: CalibrationSessionStatus;
  /** ISO 8601 */
  startedAt: string;
  /** ISO 8601 */
  computedAt: string | null;
  result: CalibrationSessionResult | null;
}

export interface DeviceActivity {
  id: EntityId;
  /** ISO 8601 */
  at: string;
  type: 'sincronizacao' | 'conexao' | 'desconexao' | 'calibracao' | 'cadastro_facial' | 'chave_regenerada' | 'ativado' | 'desativado';
  /** Texto sem dado pessoal (ex.: "Lote de 214 batidas recebido"). */
  description: string;
}

// ---- [MOCK] Relatórios e Configurações (prévias, sem back) ----

export const REPORT_TYPES = ['horas_extras', 'faltas', 'banco_horas', 'ferias', 'afastamentos'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportRequest {
  type: ReportType;
  establishmentId: EntityId;
  departmentId?: EntityId;
  /** AAAA-MM-DD */
  from: string;
  /** AAAA-MM-DD */
  to: string;
  format: 'pdf' | 'csv';
}

export interface PortalUser {
  id: EntityId;
  name: string;
  email: string;
  role: Role;
  establishmentScope: EntityId[] | null;
  mfaEnabled: boolean;
  isActive: boolean;
}

export interface CompanySettings {
  managerPortalEnabled: boolean;
  maxSimultaneousVacationsPerDepartment: number;
  /** Tolerância de marcação em minutos (parâmetro da empresa; a regra legal é da api). */
  punchToleranceMinutes: number;
}

export type HolidayScope = 'nacional' | 'estadual' | 'municipal';
export type HolidayTreatment = 'pagar_100' | 'banco_horas';

/** GET /portal/holidays?establishmentId&year: oficiais e da conta, com a regra do estabelecimento. */
export interface Holiday {
  id: EntityId;
  /** AAAA-MM-DD */
  date: string;
  name: string;
  scope: HolidayScope;
  uf: string | null;
  municipalityIbge: string | null;
  /** Facultativo não muda a apuração. */
  isOptional: boolean;
  /** Cadastrado pela conta (edita e remove); os demais são do catálogo oficial. */
  isOwn: boolean;
  /** O estabelecimento da consulta trabalha nesse feriado? */
  isWorked: boolean;
  treatment: HolidayTreatment | null;
}

/** Feriado da conta. `nacional` = todos os estabelecimentos da conta; os outros usam a UF/município do estabelecimento. */
export interface CreateHolidayBody {
  establishmentId: EntityId;
  date: string;
  name: string;
  scope: HolidayScope;
  isOptional?: boolean;
}
export type UpdateHolidayBody = Partial<Pick<Holiday, 'date' | 'name' | 'isOptional'>>;
export interface SetEstablishmentHolidayBody {
  isWorked: boolean;
  treatment?: HolidayTreatment | null;
}
