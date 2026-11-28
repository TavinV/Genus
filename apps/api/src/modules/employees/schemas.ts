/**
 * Contratos HTTP de colaborador e vínculo (G1, RF01 a RF06). As respostas
 * passam por estes schemas: o que não está aqui (pin_hash, campos internos) não sai.
 * CPF completo e salário saem só para os perfis de `http/access.ts`.
 */
import { z } from 'zod';
import { civilDate, listMeta, pagination, positiveId, reasonText } from '../../http/schemas';
import { searchText } from '../../http/search';

const name = z.string().trim().min(2).max(200);
const registrationNumber = z.string().trim().min(1).max(40);
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'valor em reais com até 2 casas, ex.: 2500.00');

export const CONTRACT_TYPES = ['indeterminado', 'determinado', 'safra', 'intermitente'] as const;

export const listEmployeesQuery = pagination.extend({
  establishmentId: positiveId.optional(),
  status: z.enum(['ativo', 'desligado']).optional(),
  /** Nome ou matrícula (contém, sem diferenciar maiúsculas). */
  q: searchText.optional(),
});

export const createEmployeeBody = z.object({
  establishmentId: positiveId,
  cpf: z.string().min(11).max(14),
  name,
  registrationNumber: registrationNumber.optional(),
  birthDate: civilDate,
  admissionDate: civilDate,
  managerId: positiveId.nullable().optional(),
});

/** CPF e estabelecimento não mudam por aqui: o CPF liga o colaborador às batidas do arp. */
export const updateEmployeeBody = z
  .object({
    name,
    registrationNumber: registrationNumber.nullable(),
    birthDate: civilDate,
    managerId: positiveId.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

export const terminateEmployeeBody = z.object({ terminationDate: civilDate, reason: reasonText });

export const employeeDto = z.object({
  id: z.number(),
  establishmentId: z.number(),
  /** Completo para rh e admin; mascarado (***.***.***-NN) para os demais. */
  cpf: z.string(),
  name: z.string(),
  registrationNumber: z.string().nullable(),
  birthDate: z.string().optional(),
  admissionDate: z.string(),
  terminationDate: z.string().nullable(),
  terminationReason: z.string().nullable().optional(),
  managerId: z.number().nullable(),
  status: z.enum(['ativo', 'desligado']),
});

export const employeeResponse = z.object({ data: employeeDto });
export const createdEmployeeResponse = z.object({
  data: employeeDto.extend({
    /** PIN inicial do modo alternativo, mostrado UMA vez (o banco guarda só o hash). */
    initialPin: z.string(),
  }),
});
/** PIN novo (esqueceu o anterior), mostrado UMA vez. */
export const resetPinResponse = z.strictObject({ data: z.strictObject({ pin: z.string(), pinSetAt: z.string() }) });
export const employeeListResponse = z.object({ data: z.array(employeeDto), meta: listMeta });

export const assignmentParams = z.object({ id: positiveId, assignmentId: positiveId });

export const createAssignmentBody = z
  .object({
    jobTitleId: positiveId,
    departmentId: positiveId,
    costCenterId: positiveId.nullable().optional(),
    contractType: z.enum(CONTRACT_TYPES),
    baseSalary: money.nullable().optional(),
    validFrom: civilDate,
    validTo: civilDate.nullable().optional(),
  })
  .refine((b) => !b.validTo || b.validTo >= b.validFrom, { path: ['validTo'], message: 'fim antes do início' });

export const updateAssignmentBody = z
  .object({
    costCenterId: positiveId.nullable(),
    contractType: z.enum(CONTRACT_TYPES),
    baseSalary: money.nullable(),
    validTo: civilDate.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

export const assignmentDto = z.object({
  id: z.number(),
  employeeId: z.number(),
  jobTitleId: z.number(),
  departmentId: z.number(),
  costCenterId: z.number().nullable(),
  contractType: z.enum(CONTRACT_TYPES),
  /** Só para rh e admin. [A CONFIRMAR] com o contador: valor e regra do salário-base. */
  baseSalary: z.string().nullable().optional(),
  salaryPendingAccountantReview: z.literal(true).optional(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});

export const assignmentResponse = z.object({ data: assignmentDto });
export const assignmentListResponse = z.object({ data: z.array(assignmentDto) });
