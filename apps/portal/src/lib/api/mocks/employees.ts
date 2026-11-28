/**
 * Mock de employees (dono: lote E). Mesmo contrato de endpoints/employees.ts, estado em memória
 * iniciado com SEED_EMPLOYEES (mocks/seed.ts). Erros no formato da api (mockFail): 400 CPF_INVALIDO,
 * 409 CPF_DUPLICADO / MATRICULA_DUPLICADA / COLABORADOR_DESLIGADO / VINCULO_SOBREPOSTO, 404 fora do escopo.
 * Salário só sai para rh e admin (SALARY_ROLES); CPF completo só para rh e admin (FULL_CPF_ROLES).
 */
import type { Assignment, CreateAssignmentBody, Employee, EntityId } from '../contracts';
import type { EmployeesApi } from '../endpoints/employees';
import type { EmployeeAccess } from '../organization-contracts';
import { mockCurrentRole } from './index';
import { clone, delay, matchesQuery, mockFail, mockId, mockNotFound, paginate } from './runtime';
import { cpfFor, departmentIdOf, jobTitleIdOf, SEED_EMPLOYEES } from './seed';

/** Estabelecimentos do mock (mocks/index.ts: '1', '2', '3'). */
const mockEstablishmentIds = ['1', '2', '3'];

interface Row {
  id: string;
  establishmentId: string;
  /** Só dígitos; o CPF sai mascarado conforme o papel. */
  cpf: string;
  name: string;
  registrationNumber: string | null;
  birthDate: string;
  admissionDate: string;
  terminationDate: string | null;
  terminationReason: string | null;
  managerId: string | null;
}

const fromSeed = (): Row[] =>
  SEED_EMPLOYEES.map((e) => ({
    id: e.id,
    establishmentId: e.establishmentId,
    cpf: e.cpf,
    name: e.name,
    registrationNumber: e.registrationNumber,
    birthDate: e.birthDate,
    admissionDate: e.admissionDate,
    terminationDate: null,
    terminationReason: null,
    managerId: null,
  }));

const seedAssignments = (): Assignment[] =>
  SEED_EMPLOYEES.map((e) => ({
    id: `a${e.id}`,
    employeeId: e.id,
    jobTitleId: jobTitleIdOf(e.jobTitleName),
    departmentId: departmentIdOf(e.departmentName),
    costCenterId: '50',
    contractType: 'indeterminado',
    baseSalary: '2500.00',
    salaryPendingAccountantReview: true,
    validFrom: e.admissionDate,
    validTo: null,
  }));

let rows: Row[] = fromSeed();
let assignmentRows: Assignment[] = seedAssignments();

/** Volta ao estado inicial (testes). */
export function resetMockEmployees() {
  rows = fromSeed();
  assignmentRows = seedAssignments();
  accessRows.clear();
}

const canSeeSalary = () => {
  const r = mockCurrentRole();
  return r === 'rh' || r === 'admin';
};

const toEmployee = (r: Row): Employee => ({
  id: r.id,
  establishmentId: r.establishmentId,
  cpf: cpfFor(r.cpf, mockCurrentRole()),
  name: r.name,
  registrationNumber: r.registrationNumber,
  birthDate: r.birthDate,
  admissionDate: r.admissionDate,
  terminationDate: r.terminationDate,
  terminationReason: r.terminationReason,
  managerId: r.managerId,
  status: r.terminationDate === null ? 'ativo' : 'desligado',
});

const toAssignment = (a: Assignment): Assignment => {
  if (canSeeSalary()) return a;
  const rest = { ...a };
  delete rest.baseSalary;
  delete rest.salaryPendingAccountantReview;
  return rest;
};

const find = (id: EntityId) => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw mockNotFound();
  return r;
};

/** Espelha apps/api/src/modules/employees/rules/cpf.ts. */
function isValidCpf(cpf: string): boolean {
  if (!/^[0-9]{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const d = cpf.split('').map(Number);
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += (d[i] as number) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === d[9] && check(10) === d[10];
}

const validation = (path: string, message: string) => mockFail(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path, message }]);
const badReference = (path: string, message: string) => mockFail(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path, message }]);

const overlaps = (a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }) =>
  a.validFrom <= (b.validTo ?? '9999-12-31') && b.validFrom <= (a.validTo ?? '9999-12-31');

function checkManager(managerId: string | null | undefined, selfId: string | null) {
  if (managerId == null) return;
  if (managerId === selfId) throw badReference('managerId', 'o colaborador não pode ser gestor de si mesmo');
  if (!rows.some((r) => r.id === managerId)) throw badReference('managerId', 'gestor não encontrado');
}

/** Acesso ao portal por colaborador (mock): sem linha = sem acesso. */
const accessRows = new Map<string, EmployeeAccess>();
const accessOf = (id: string): EmployeeAccess => accessRows.get(id) ?? { status: 'sem_acesso', email: null, expiresAt: null };

export const mockEmployeesApi: EmployeesApi = {
  list: async (q) => {
    await delay();
    const filtered = rows.filter(
      (e) => (!q.establishmentId || e.establishmentId === q.establishmentId) && (!q.status || (e.terminationDate === null ? 'ativo' : 'desligado') === q.status) && matchesQuery(q.q, e.name, e.registrationNumber),
    );
    return clone(paginate(filtered.map(toEmployee), q));
  },
  get: async (id) => {
    await delay();
    return clone(toEmployee(find(id)));
  },
  create: async (body) => {
    await delay();
    const cpf = body.cpf.replace(/[.\-\s]/g, '');
    if (!isValidCpf(cpf)) throw mockFail(400, 'CPF_INVALIDO', 'CPF inválido', [{ path: 'cpf', message: 'dígito verificador não confere' }]);
    if (body.admissionDate < body.birthDate) throw validation('admissionDate', 'admissão deve ser depois do nascimento');
    if (!mockEstablishmentIds.includes(body.establishmentId)) throw badReference('establishmentId', 'estabelecimento não encontrado');
    checkManager(body.managerId, null);
    if (rows.some((r) => r.cpf === cpf)) throw mockFail(409, 'CPF_DUPLICADO', 'Já existe um colaborador com esse CPF nesta conta');
    if (body.registrationNumber && rows.some((r) => r.establishmentId === body.establishmentId && r.registrationNumber === body.registrationNumber)) {
      throw mockFail(409, 'MATRICULA_DUPLICADA', 'Já existe um colaborador com essa matrícula no estabelecimento');
    }
    const row: Row = {
      id: mockId(),
      establishmentId: body.establishmentId,
      cpf,
      name: body.name,
      registrationNumber: body.registrationNumber ?? null,
      birthDate: body.birthDate,
      admissionDate: body.admissionDate,
      terminationDate: null,
      terminationReason: null,
      managerId: body.managerId ?? null,
    };
    rows = [...rows, row];
    return { ...clone(toEmployee(row)), initialPin: '483920' };
  },
  update: async (id, body) => {
    await delay();
    const r = find(id);
    const birthDate = body.birthDate ?? r.birthDate;
    if (body.birthDate !== undefined && r.admissionDate < birthDate) throw validation('birthDate', 'nascimento deve ser antes da admissão');
    if (body.managerId !== undefined) checkManager(body.managerId, id);
    if (body.registrationNumber && rows.some((x) => x.id !== id && x.establishmentId === r.establishmentId && x.registrationNumber === body.registrationNumber)) {
      throw mockFail(409, 'MATRICULA_DUPLICADA', 'Já existe um colaborador com essa matrícula no estabelecimento');
    }
    if (body.name !== undefined) r.name = body.name;
    if (body.registrationNumber !== undefined) r.registrationNumber = body.registrationNumber;
    if (body.birthDate !== undefined) r.birthDate = body.birthDate;
    if (body.managerId !== undefined) r.managerId = body.managerId;
    return clone(toEmployee(r));
  },
  access: async (id) => {
    await delay();
    find(id);
    return clone(accessOf(id));
  },
  inviteAccess: async (id, email) => {
    await delay(300);
    const r = find(id);
    if (r.terminationDate !== null) throw mockFail(409, 'COLABORADOR_DESLIGADO', 'O colaborador já está desligado');
    const current = accessOf(id);
    if (current.status === 'ativo' || current.status === 'inativo') throw mockFail(409, 'COLABORADOR_COM_ACESSO', 'O colaborador já tem acesso ao portal');
    const access = { status: 'convite_pendente' as const, email: email.trim().toLowerCase(), expiresAt: '2026-11-24T13:00:00.000Z' };
    accessRows.set(id, access);
    return { access: clone(access), token: 'convite-do-colaborador-' + id };
  },
  revokeAccessInvite: async (id) => {
    await delay();
    find(id);
    if (accessOf(id).status === 'convite_pendente') accessRows.delete(id);
    return clone(accessOf(id));
  },
  resetPin: async (id) => {
    await delay();
    const r = find(id);
    if (r.terminationDate !== null) throw mockFail(409, 'COLABORADOR_DESLIGADO', 'O colaborador já está desligado');
    return { pin: '715264', pinSetAt: '2026-11-21T13:00:00.000Z' };
  },
  terminate: async (id, body) => {
    await delay();
    const r = find(id);
    if (r.terminationDate !== null) throw mockFail(409, 'COLABORADOR_DESLIGADO', 'O colaborador já está desligado');
    if (body.terminationDate < r.admissionDate) throw validation('terminationDate', 'desligamento antes da admissão');
    r.terminationDate = body.terminationDate;
    r.terminationReason = body.reason;
    return clone(toEmployee(r));
  },
  assignments: async (id) => {
    await delay();
    find(id);
    return clone(assignmentRows.filter((a) => a.employeeId === id).sort((a, b) => b.validFrom.localeCompare(a.validFrom)).map(toAssignment));
  },
  createAssignment: async (id, body: CreateAssignmentBody) => {
    await delay();
    find(id);
    if (body.validTo && body.validTo < body.validFrom) throw validation('validTo', 'fim antes do início');
    const next = { validFrom: body.validFrom, validTo: body.validTo ?? null };
    if (assignmentRows.some((a) => a.employeeId === id && overlaps(a, next))) {
      throw mockFail(409, 'VINCULO_SOBREPOSTO', 'O vínculo se sobrepõe a outro vínculo do colaborador');
    }
    const a: Assignment = {
      id: mockId(),
      employeeId: id,
      jobTitleId: body.jobTitleId,
      departmentId: body.departmentId,
      costCenterId: body.costCenterId ?? null,
      contractType: body.contractType,
      baseSalary: body.baseSalary ?? null,
      salaryPendingAccountantReview: true,
      validFrom: body.validFrom,
      validTo: body.validTo ?? null,
    };
    assignmentRows = [...assignmentRows, a];
    return clone(toAssignment(a));
  },
  updateAssignment: async (id, assignmentId, body) => {
    await delay();
    find(id);
    const a = assignmentRows.find((x) => x.id === assignmentId && x.employeeId === id);
    if (!a) throw mockNotFound();
    if (body.validTo !== undefined && body.validTo !== null && body.validTo < a.validFrom) throw validation('validTo', 'fim antes do início');
    if (body.validTo !== undefined) {
      const next = { validFrom: a.validFrom, validTo: body.validTo };
      if (assignmentRows.some((x) => x.id !== a.id && x.employeeId === id && overlaps(x, next))) {
        throw mockFail(409, 'VINCULO_SOBREPOSTO', 'O vínculo se sobrepõe a outro vínculo do colaborador');
      }
      a.validTo = body.validTo;
    }
    if (body.costCenterId !== undefined) a.costCenterId = body.costCenterId;
    if (body.contractType !== undefined) a.contractType = body.contractType;
    if (body.baseSalary !== undefined) a.baseSalary = body.baseSalary;
    return clone(toAssignment(a));
  },
};
