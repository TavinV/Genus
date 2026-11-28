/** Colaboradores e vínculos (apps/api/src/modules/employees). */
import { qs, type ApiClient } from '../client';
import type {
  Assignment, CreateAssignmentBody, CreateEmployeeBody, CreatedEmployee, Employee, EmployeeListQuery, EntityId,
  Envelope, Paged, TerminateEmployeeBody, UpdateAssignmentBody, UpdateEmployeeBody,
} from '../contracts';
import { apiPath } from '../ids';
import type { CreatedEmployeeAccess, EmployeeAccess } from '../organization-contracts';

export const employeesApi = (c: ApiClient) => ({
  list: (q: EmployeeListQuery, signal?: AbortSignal) =>
    c.get<Paged<Employee>>(`/portal/employees${qs({ establishmentId: q.establishmentId, status: q.status, q: q.q, page: q.page, pageSize: q.pageSize })}`, signal),
  get: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<Employee>>(apiPath`/portal/employees/${id}`, signal)).data,
  /** `initialPin` aparece UMA vez: mostrar em modal e descartar. */
  create: async (body: CreateEmployeeBody) => (await c.post<Envelope<CreatedEmployee>>('/portal/employees', body)).data,
  update: async (id: EntityId, body: UpdateEmployeeBody) => (await c.patch<Envelope<Employee>>(apiPath`/portal/employees/${id}`, body)).data,
  /** PIN novo para quem esqueceu o seu. Aparece UMA vez: mostrar em modal e descartar. */
  resetPin: async (id: EntityId) => (await c.post<Envelope<{ pin: string; pinSetAt: string }>>(apiPath`/portal/employees/${id}/pin/reset`)).data,
  /** Acesso do colaborador ao portal (/me). */
  access: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<EmployeeAccess>>(apiPath`/portal/employees/${id}/access`, signal)).data,
  /** Convite de acesso: o `token` aparece UMA vez (montar o link e descartar). */
  inviteAccess: async (id: EntityId, email: string) =>
    (await c.post<Envelope<CreatedEmployeeAccess>>(apiPath`/portal/employees/${id}/access-invite`, { email })).data,
  revokeAccessInvite: async (id: EntityId) => (await c.post<Envelope<EmployeeAccess>>(apiPath`/portal/employees/${id}/access-invite/revoke`)).data,
  terminate: async (id: EntityId, body: TerminateEmployeeBody) =>
    (await c.post<Envelope<Employee>>(apiPath`/portal/employees/${id}/terminate`, body)).data,
  assignments: async (id: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<Assignment[]>>(apiPath`/portal/employees/${id}/assignments`, signal)).data,
  createAssignment: async (id: EntityId, body: CreateAssignmentBody) =>
    (await c.post<Envelope<Assignment>>(apiPath`/portal/employees/${id}/assignments`, body)).data,
  updateAssignment: async (id: EntityId, assignmentId: EntityId, body: UpdateAssignmentBody) =>
    (await c.patch<Envelope<Assignment>>(apiPath`/portal/employees/${id}/assignments/${assignmentId}`, body)).data,
});
export type EmployeesApi = ReturnType<typeof employeesApi>;
