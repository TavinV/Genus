'use client';
import { keepPreviousData } from '@tanstack/react-query';
import type { CreateAssignmentBody, CreateEmployeeBody, Employee, EmployeeStatus, EntityId, TerminateEmployeeBody, UpdateAssignmentBody, UpdateEmployeeBody } from '@/lib/api/contracts';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { establishmentParam, useSession } from '@/lib/session';
import { PAGE_SIZE } from './copy';

export function useEmployeesList(status: EmployeeStatus | 'todos', page: number, q?: string) {
  const { establishment } = useSession();
  return useApiQuery(
    'employees',
    { list: true, status, page, q },
    (api, signal) => api.employees.list({ establishmentId: establishmentParam(establishment), status: status === 'todos' ? undefined : status, q, page, pageSize: PAGE_SIZE }, signal),
    { placeholderData: keepPreviousData },
  );
}

const NO_EMPLOYEES: Employee[] = [];

/** Mesma chave do diretório de colaboradores (useEmployeeDirectory): um cache só para nomes e gestores. */
export function useEmployeeChoices(enabled = true) {
  const { establishment } = useSession();
  const q = useApiQuery(
    'employees',
    { directory: true },
    async (api, signal) => (await api.employees.list({ establishmentId: establishmentParam(establishment), pageSize: 100 }, signal)).data,
    { staleTime: 5 * 60_000, enabled },
  );
  return { isPending: q.isPending, employees: q.data ?? NO_EMPLOYEES };
}

export const useCreateEmployee = () => useApiMutation((api, body: CreateEmployeeBody) => api.employees.create(body), { invalidates: ['employees'] });

export const useUpdateEmployee = () =>
  useApiMutation((api, v: { id: EntityId; body: UpdateEmployeeBody }) => api.employees.update(v.id, v.body), { invalidates: ['employees'] });

/** Não invalida nada: o PIN não aparece em lista nenhuma. */
export const useResetPin = () => useApiMutation((api, id: EntityId) => api.employees.resetPin(id));

export const useTerminateEmployee = () =>
  useApiMutation((api, v: { id: EntityId; body: TerminateEmployeeBody }) => api.employees.terminate(v.id, v.body), {
    invalidates: ['employees', 'assignments', 'timesheets', 'day'],
  });

export function useAssignments(employeeId: EntityId, enabled: boolean) {
  return useApiQuery('assignments', { employeeId }, (api, signal) => api.employees.assignments(employeeId, signal), { enabled });
}

export const useCreateAssignment = () =>
  useApiMutation((api, v: { id: EntityId; body: CreateAssignmentBody }) => api.employees.createAssignment(v.id, v.body), {
    invalidates: ['assignments', 'employees', 'timesheets', 'day'],
  });

export const useUpdateAssignment = () =>
  useApiMutation((api, v: { id: EntityId; assignmentId: EntityId; body: UpdateAssignmentBody }) => api.employees.updateAssignment(v.id, v.assignmentId, v.body), {
    invalidates: ['assignments', 'employees', 'timesheets', 'day'],
  });

export function useOrgNames(establishmentId: EntityId, enabled: boolean) {
  const opts = { enabled, staleTime: 5 * 60_000 };
  const departments = useApiQuery('org', { departments: establishmentId }, (api, signal) => api.org.departments(establishmentId, signal), opts);
  const jobTitles = useApiQuery('org', { jobTitles: establishmentId }, (api, signal) => api.org.jobTitles(establishmentId, signal), opts);
  const costCenters = useApiQuery('org', { costCenters: establishmentId }, (api, signal) => api.org.costCenters(establishmentId, signal), opts);
  return { departments, jobTitles, costCenters };
}
