/**
 * Colaborador e vínculo (G1, RF01 a RF06). Regras que o banco garante e que
 * esta camada só traduz: CPF único por conta (colaborador_cpf_unico → 409
 * CPF_DUPLICADO), vínculo sem sobreposição (vinculo_sem_sobreposicao → 409
 * VINCULO_SOBREPOSTO). Toda escrita em transação, com auditoria na mesma transação.
 */
import { maskCpf, type Clock } from '@genus/shared';
import { and, asc, count, eq, gt, isNotNull, isNull, lte, or, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { containsAny } from '../../http/search';
import type { Executor } from '../../db/executor';
import {
  costCenters,
  departments,
  employeeAssignments,
  employeeSchedules,
  employees,
  establishments,
  jobTitles,
  users,
} from '../../db/schema';
import { employeeScopeConditions, establishmentInScope, FULL_CPF_ROLES, notFound, SALARY_ROLES, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope } from './lookup';
import { generatePin, hashPin, type PinPepper } from './pin';
import { isValidCpf, normalizeCpf } from './rules/cpf';
import type { z } from 'zod';
import type {
  assignmentDto,
  createAssignmentBody,
  createEmployeeBody,
  employeeDto,
  listEmployeesQuery,
  terminateEmployeeBody,
  updateAssignmentBody,
  updateEmployeeBody,
} from './schemas';

type EmployeeDto = z.infer<typeof employeeDto>;
type AssignmentDto = z.infer<typeof assignmentDto>;

const badReference = (path: string, message: string) =>
  new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path, message }]);

const employeeColumns = {
  id: employees.id,
  establishmentId: employees.establishmentId,
  cpf: employees.cpf,
  name: employees.name,
  registrationNumber: employees.registrationNumber,
  birthDate: employees.birthDate,
  admissionDate: employees.admissionDate,
  terminationDate: employees.terminationDate,
  terminationReason: employees.terminationReason,
  managerId: employees.managerId,
};
interface EmployeeRow {
  id: number;
  establishmentId: number;
  cpf: string;
  name: string;
  registrationNumber: string | null;
  birthDate: string;
  admissionDate: string;
  terminationDate: string | null;
  terminationReason: string | null;
  managerId: number | null;
}

export function toEmployeeDto(row: EmployeeRow, ctx: RequestContext): EmployeeDto {
  const full = FULL_CPF_ROLES.includes(ctx.role);
  return {
    id: row.id,
    establishmentId: row.establishmentId,
    cpf: full ? row.cpf : maskCpf(row.cpf),
    name: row.name,
    registrationNumber: row.registrationNumber,
    ...(full ? { birthDate: row.birthDate, terminationReason: row.terminationReason } : {}),
    admissionDate: row.admissionDate,
    terminationDate: row.terminationDate,
    managerId: row.managerId,
    status: row.terminationDate === null ? 'ativo' : 'desligado',
  };
}

const assignmentColumns = {
  id: employeeAssignments.id,
  employeeId: employeeAssignments.employeeId,
  jobTitleId: employeeAssignments.jobTitleId,
  departmentId: employeeAssignments.departmentId,
  costCenterId: employeeAssignments.costCenterId,
  contractType: employeeAssignments.contractType,
  baseSalary: employeeAssignments.baseSalary,
  validFrom: employeeAssignments.validFrom,
  validTo: employeeAssignments.validTo,
};

function toAssignmentDto(
  row: {
    id: number;
    employeeId: number;
    jobTitleId: number;
    departmentId: number;
    costCenterId: number | null;
    contractType: string;
    baseSalary: string | null;
    validFrom: string;
    validTo: string | null;
  },
  ctx: RequestContext,
): AssignmentDto {
  const { baseSalary, ...rest } = row;
  const salary = SALARY_ROLES.includes(ctx.role) ? { baseSalary, salaryPendingAccountantReview: true as const } : {};
  return { ...rest, contractType: rest.contractType as AssignmentDto['contractType'], ...salary };
}

export interface EmployeeServiceDeps {
  db: Database;
  clock: Clock;
  pin: { current: PinPepper };
}

export class EmployeeService {
  constructor(private readonly d: EmployeeServiceDeps) {}

  async list(ctx: RequestContext, q: z.infer<typeof listEmployeesQuery>) {
    const conds: SQL[] = employeeScopeConditions(ctx);
    if (q.establishmentId) conds.push(eq(employees.establishmentId, q.establishmentId));
    if (q.status === 'ativo') conds.push(isNull(employees.terminationDate));
    if (q.status === 'desligado') conds.push(isNotNull(employees.terminationDate));
    if (q.q) conds.push(containsAny([employees.name, employees.registrationNumber], q.q));
    const where = and(...conds);
    const [rows, [total]] = await Promise.all([
      this.d.db
        .select(employeeColumns)
        .from(employees)
        .where(where)
        .orderBy(asc(employees.name), asc(employees.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.d.db.select({ n: count() }).from(employees).where(where),
    ]);
    return { data: rows.map((r) => toEmployeeDto(r, ctx)), meta: { page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 } };
  }

  private async row(ex: Executor, tenantId: number, id: number): Promise<EmployeeRow> {
    const [row] = await ex
      .select(employeeColumns)
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
      .limit(1);
    if (!row) throw notFound('Colaborador');
    return row;
  }

  async get(ctx: RequestContext, id: number): Promise<EmployeeDto> {
    await findEmployeeInScope(this.d.db, ctx, id);
    return toEmployeeDto(await this.row(this.d.db, tenantOf(ctx), id), ctx);
  }

  private async assertManager(ex: Executor, tenantId: number, managerId: number | null | undefined, selfId?: number) {
    if (managerId === null || managerId === undefined) return;
    if (managerId === selfId) throw badReference('managerId', 'o colaborador não pode ser gestor de si mesmo');
    const [m] = await ex
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, managerId)))
      .limit(1);
    if (!m) throw badReference('managerId', 'gestor não encontrado');
  }

  async create(ctx: RequestContext, body: z.infer<typeof createEmployeeBody>): Promise<EmployeeDto & { initialPin: string }> {
    const tenantId = tenantOf(ctx);
    const cpf = normalizeCpf(body.cpf);
    if (!isValidCpf(cpf)) throw new HttpError(400, 'CPF_INVALIDO', 'CPF inválido', [{ path: 'cpf', message: 'dígito verificador não confere' }]);
    if (body.admissionDate <= body.birthDate) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'admissionDate', message: 'admissão deve ser depois do nascimento' }]);
    }
    const [est] = await this.d.db
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantId), eq(establishments.id, body.establishmentId)))
      .limit(1);
    if (!est || !establishmentInScope(ctx, body.establishmentId)) throw badReference('establishmentId', 'estabelecimento não encontrado');
    await this.assertManager(this.d.db, tenantId, body.managerId);

    // PIN obrigatório (0003): nasce aqui, sai uma vez na resposta e só o hash fica no banco.
    const initialPin = generatePin();
    const pinHash = await hashPin(initialPin, this.d.pin.current);

    const created = await this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(employees)
        .values({
          tenantId,
          establishmentId: body.establishmentId,
          cpf,
          name: body.name,
          registrationNumber: body.registrationNumber ?? null,
          birthDate: body.birthDate,
          admissionDate: body.admissionDate,
          managerId: body.managerId ?? null,
          pinHash,
          pinSetAt: this.d.clock.now(),
        })
        .returning(employeeColumns);
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'colaboradores',
        entityId: row!.id,
        action: 'criacao',
        after: { establishmentId: body.establishmentId, admissionDate: body.admissionDate, cpf: true },
      });
      return row!;
    });
    return { ...toEmployeeDto(created, ctx), initialPin };
  }

  async update(ctx: RequestContext, id: number, body: z.infer<typeof updateEmployeeBody>): Promise<EmployeeDto> {
    const tenantId = tenantOf(ctx);
    await findEmployeeInScope(this.d.db, ctx, id);
    await this.assertManager(this.d.db, tenantId, body.managerId, id);
    const row = await this.d.db.transaction(async (tx) => {
      const before = await this.row(tx, tenantId, id);
      if (body.birthDate !== undefined && before.admissionDate <= body.birthDate) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'birthDate', message: 'nascimento deve ser antes da admissão' }]);
      }
      const [after] = await tx
        .update(employees)
        .set(body)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
        .returning(employeeColumns);
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'colaboradores',
        entityId: id,
        action: 'alteracao',
        before: pick(before, Object.keys(body)),
        after: pick(after!, Object.keys(body)),
      });
      return after!;
    });
    return toEmployeeDto(row, ctx);
  }

  /**
   * Novo PIN para quem esqueceu o seu. Sorteado aqui, sai UMA vez na resposta e só o hash fica no
   * banco; o anterior deixa de valer na hora. Colaborador desligado não recebe PIN novo.
   * A auditoria registra só que houve troca, nunca o PIN.
   */
  async resetPin(ctx: RequestContext, id: number): Promise<{ pin: string; pinSetAt: string }> {
    const tenantId = tenantOf(ctx);
    await findEmployeeInScope(this.d.db, ctx, id);
    const pin = generatePin();
    const pinHash = await hashPin(pin, this.d.pin.current);
    const now = this.d.clock.now();
    await this.d.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ terminationDate: employees.terminationDate, pinSetAt: employees.pinSetAt })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
        .for('update');
      if (current!.terminationDate !== null) throw new HttpError(409, 'COLABORADOR_DESLIGADO', 'O colaborador já está desligado');
      await tx
        .update(employees)
        .set({ pinHash, pinSetAt: now })
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)));
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'colaboradores',
        entityId: id,
        action: 'alteracao',
        before: { pinSetAt: current!.pinSetAt },
        after: { pinSetAt: now, pinReset: true },
      });
    });
    return { pin, pinSetAt: now.toISOString() };
  }

  /**
   * Desligamento (RF05): não apaga nada. Grava data e motivo, encerra o vínculo
   * e a escala abertos na data e desativa o acesso do colaborador ao portal
   * (o trigger trg_usuario_inativo_sessoes derruba as sessões).
   * Apagar a galeria facial e liquidar o banco de horas ficam para depois.
   */
  async terminate(ctx: RequestContext, id: number, body: z.infer<typeof terminateEmployeeBody>): Promise<EmployeeDto> {
    const tenantId = tenantOf(ctx);
    await findEmployeeInScope(this.d.db, ctx, id);
    const row = await this.d.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ admissionDate: employees.admissionDate, terminationDate: employees.terminationDate })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
        .for('update');
      if (current!.terminationDate !== null) throw new HttpError(409, 'COLABORADOR_DESLIGADO', 'O colaborador já está desligado');
      if (body.terminationDate < current!.admissionDate) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'terminationDate', message: 'desligamento antes da admissão' }]);
      }
      const [after] = await tx
        .update(employees)
        .set({ terminationDate: body.terminationDate, terminationReason: body.reason })
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
        .returning(employeeColumns);
      const open = (table: typeof employeeAssignments | typeof employeeSchedules) =>
        and(
          eq(table.tenantId, tenantId),
          eq(table.employeeId, id),
          lte(table.validFrom, body.terminationDate),
          or(isNull(table.validTo), gt(table.validTo, body.terminationDate)),
        );
      await tx.update(employeeAssignments).set({ validTo: body.terminationDate }).where(open(employeeAssignments));
      await tx.update(employeeSchedules).set({ validTo: body.terminationDate }).where(open(employeeSchedules));
      await tx
        .update(users)
        .set({ isActive: false, updatedAt: this.d.clock.now() })
        .where(and(eq(users.tenantId, tenantId), eq(users.employeeId, id)));
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'colaboradores',
        entityId: id,
        action: 'alteracao',
        before: { terminationDate: null },
        after: { terminationDate: body.terminationDate },
        reason: body.reason,
      });
      return after!;
    });
    return toEmployeeDto(row, ctx);
  }

  async listAssignments(ctx: RequestContext, employeeId: number): Promise<AssignmentDto[]> {
    await findEmployeeInScope(this.d.db, ctx, employeeId);
    const rows = await this.d.db
      .select(assignmentColumns)
      .from(employeeAssignments)
      .where(and(eq(employeeAssignments.tenantId, tenantOf(ctx)), eq(employeeAssignments.employeeId, employeeId)))
      .orderBy(asc(employeeAssignments.validFrom));
    return rows.map((r) => toAssignmentDto(r, ctx));
  }

  /** Cargo e centro de custo da empresa do colaborador; setor do estabelecimento dele. */
  private async assertAssignmentRefs(
    ex: Executor,
    tenantId: number,
    emp: { companyId: number; establishmentId: number },
    refs: { jobTitleId?: number; departmentId?: number; costCenterId?: number | null },
  ) {
    if (refs.jobTitleId !== undefined) {
      const [j] = await ex
        .select({ id: jobTitles.id })
        .from(jobTitles)
        .where(and(eq(jobTitles.tenantId, tenantId), eq(jobTitles.id, refs.jobTitleId), eq(jobTitles.companyId, emp.companyId)));
      if (!j) throw badReference('jobTitleId', 'cargo não encontrado na empresa do colaborador');
    }
    if (refs.departmentId !== undefined) {
      const [s] = await ex
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.tenantId, tenantId), eq(departments.id, refs.departmentId), eq(departments.establishmentId, emp.establishmentId)));
      if (!s) throw badReference('departmentId', 'setor não encontrado no estabelecimento do colaborador');
    }
    if (refs.costCenterId !== undefined && refs.costCenterId !== null) {
      const [c] = await ex
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(and(eq(costCenters.tenantId, tenantId), eq(costCenters.id, refs.costCenterId), eq(costCenters.companyId, emp.companyId)));
      if (!c) throw badReference('costCenterId', 'centro de custo não encontrado na empresa do colaborador');
    }
  }

  async createAssignment(ctx: RequestContext, employeeId: number, body: z.infer<typeof createAssignmentBody>): Promise<AssignmentDto> {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    await this.assertAssignmentRefs(this.d.db, tenantId, emp, body);
    const row = await this.d.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(employeeAssignments)
        .values({
          tenantId,
          employeeId,
          jobTitleId: body.jobTitleId,
          departmentId: body.departmentId,
          costCenterId: body.costCenterId ?? null,
          contractType: body.contractType,
          baseSalary: body.baseSalary ?? null,
          validFrom: body.validFrom,
          validTo: body.validTo ?? null,
        })
        .returning(assignmentColumns);
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'vinculos_colaborador',
        entityId: created!.id,
        action: 'criacao',
        after: { ...body, baseSalary: body.baseSalary ? true : null },
      });
      return created!;
    });
    return toAssignmentDto(row, ctx);
  }

  async updateAssignment(
    ctx: RequestContext,
    employeeId: number,
    assignmentId: number,
    body: z.infer<typeof updateAssignmentBody>,
  ): Promise<AssignmentDto> {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    await this.assertAssignmentRefs(this.d.db, tenantId, emp, { costCenterId: body.costCenterId });
    const row = await this.d.db.transaction(async (tx) => {
      const where = and(
        eq(employeeAssignments.tenantId, tenantId),
        eq(employeeAssignments.employeeId, employeeId),
        eq(employeeAssignments.id, assignmentId),
      );
      const [before] = await tx.select(assignmentColumns).from(employeeAssignments).where(where).for('update');
      if (!before) throw notFound('Vínculo');
      if (body.validTo && body.validTo < before.validFrom) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'validTo', message: 'fim antes do início' }]);
      }
      const [after] = await tx.update(employeeAssignments).set(body).where(where).returning(assignmentColumns);
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'vinculos_colaborador',
        entityId: assignmentId,
        action: 'alteracao',
        before: pick(before, Object.keys(body)),
        after: pick(after!, Object.keys(body)),
      });
      return after!;
    });
    return toAssignmentDto(row, ctx);
  }
}

function pick(obj: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, (obj as Record<string, unknown>)[k]]));
}
