'use client';
/**
 * Colaboradores (rh/admin/gestor/contador): lista paginada, cadastro, edição, vínculos e desligamento.
 * [SEM DESIGN] segue o padrão da Apuração (cabeçalho + abas + tabela) e o cabeçalho do Espelho.
 *
 * - Filtros na URL: `status` e `page`. A busca (`q`) fica só em memória: nome e matrícula não vão para a URL.
 * - Lacuna #7 (mapa §6): a api não filtra por texto; a busca age só na página corrente. Setor/cargo não vêm
 *   na lista (só em /assignments, uma chamada por colaborador): sem filtro por setor para evitar N+1.
 * - O CPF vem como a api entrega (mascarado fora de rh/admin): nunca desmascarar.
 * - Nenhuma ação aqui altera ou apaga marcação (Portaria 671, arts. 74, 82 e 98).
 */
import { DotsThreeVertical, Plus, UsersThree } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { useTextSearch } from '@/lib/use-debounced-value';
import { notify } from '@/components/ui/notify';
import { Pagination } from '@/components/ui/Pagination';
import { QueryView } from '@/components/ui/QueryView';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/shadcn/dropdown-menu';
import { EmptyState, ForbiddenState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Employee } from '@/lib/api/contracts';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { formatCpf, formatDate, todayCivil } from '@/lib/format';
import { EMPLOYEE_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { EmployeeSchedulePanel } from '@/features/schedules/EmployeeSchedulePanel';
import { AssignmentsPanel } from './AssignmentsPanel';
import { COPY, PAGE_SIZE, STATUS_TABS, type StatusTab } from './copy';
import { EmployeeFormPanel } from './EmployeeFormPanel';
import { useEmployeesList, useResetPin, useTerminateEmployee } from './hooks';
import { InitialPinDialog } from './InitialPinDialog';
import { PortalAccessDialog } from './PortalAccessDialog';
import { TerminateDialog } from './TerminateDialog';

type Panel = { kind: 'create' } | { kind: 'edit'; employee: Employee } | { kind: 'assignments'; employee: Employee } | { kind: 'schedule'; employee: Employee } | null;

export function EmployeesScreen() {
  const { me } = useSession();
  const role = me.role;
  const router = useRouter();
  const clock = useClock();
  const [url, setUrl] = useUrlState(['status', 'page'] as const);
  const status = oneOf<StatusTab>(url.status, STATUS_TABS, 'ativo');
  const page = Math.max(1, Number.parseInt(url.page ?? '1', 10) || 1);

  const { text, setText, q, typing } = useTextSearch(() => setUrl({ page: null }));
  const [panel, setPanel] = useState<Panel>(null);
  const [terminating, setTerminating] = useState<Employee | null>(null);
  const [pin, setPin] = useState<{ pin: string; name: string; reset?: boolean } | null>(null);
  const [resetting, setResetting] = useState<Employee | null>(null);
  const [accessFor, setAccessFor] = useState<Employee | null>(null);

  const query = useEmployeesList(status === 'todos' ? 'todos' : status, page, q);
  const terminate = useTerminateEmployee();
  const resetPin = useResetPin();

  const canCreate = can(role, 'employee.create');
  const canEdit = can(role, 'employee.edit');
  const canTerminate = can(role, 'employee.terminate');
  const canResetPin = can(role, 'employee.resetPin');
  const canPortalAccess = can(role, 'employee.portalAccess');
  const canAssignments = can(role, 'assignment.view');
  const canSchedule = can(role, 'schedule.view');

  const columns = useMemo<ColumnDef<Employee, never>[]>(() => [
    {
      id: 'name',
      header: 'Colaborador',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <Avatar name={row.original.name} />
          <span className="font-semibold">{row.original.name}</span>
        </span>
      ),
    },
    { id: 'registration', header: 'Matrícula', cell: ({ row }) => <span className="tabular-nums">{row.original.registrationNumber ?? '—'}</span> },
    { id: 'cpf', header: 'CPF', cell: ({ row }) => <span className="tabular-nums">{formatCpf(row.original.cpf)}</span> },
    { id: 'admission', header: 'Admissão', cell: ({ row }) => <span className="tabular-nums">{formatDate(row.original.admissionDate)}</span> },
    {
      id: 'status',
      header: 'Situação',
      cell: ({ row }) => {
        const e = row.original;
        const st = EMPLOYEE_STATUS[e.status];
        return (
          <span className="flex flex-col items-start gap-1">
            <StatusBadge label={st.label} tone={st.tone} />
            {e.terminationDate && <span className="text-xs text-muted tabular-nums">em {formatDate(e.terminationDate)}</span>}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Ações</span>,
      cell: ({ row }) => {
        const e = row.original;
        const items = [
          canEdit && { key: 'edit', label: 'Editar', run: () => setPanel({ kind: 'edit', employee: e }) },
          canAssignments && { key: 'assignments', label: 'Vínculos', run: () => setPanel({ kind: 'assignments', employee: e }) },
          canSchedule && { key: 'schedule', label: 'Escala e trocas de turno', run: () => setPanel({ kind: 'schedule', employee: e }) },
          canPortalAccess && e.status === 'ativo' && { key: 'portal-access', label: COPY.portalAccess.action, run: () => setAccessFor(e) },
          canResetPin && e.status === 'ativo' && { key: 'reset-pin', label: COPY.resetPin.action, run: () => setResetting(e) },
          canTerminate && e.status === 'ativo' && { key: 'terminate', label: 'Desligar', run: () => setTerminating(e) },
        ].filter((i): i is { key: string; label: string; run: () => void } => i !== false);
        if (items.length === 0) return null;
        return (
          // A célula não deve abrir o espelho: o clique fica só no menu.
          <span className="flex justify-end" onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={`Ações de ${e.name}`} icon={<DotsThreeVertical size={18} weight="bold" aria-hidden />} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {items.map((i) => <DropdownMenuItem key={i.key} onSelect={i.run}>{i.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        );
      },
    },
  ], [canEdit, canAssignments, canSchedule, canPortalAccess, canResetPin, canTerminate]);

  if (!can(role, 'nav.employees')) {
    return (
      <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
        <ForbiddenState screen="Colaboradores" />
      </PageHeader>
    );
  }

  const today = todayCivil(clock);

  return (
    <PageHeader
      title={COPY.title}
      subtitle={COPY.subtitle}
      primary={canCreate ? <Button variant="accent" icon={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setPanel({ kind: 'create' })}>{COPY.newEmployee}</Button> : undefined}
    >
      <CountTabs<StatusTab>
        label={COPY.tabsLabel}
        value={status}
        onChange={(v) => { setUrl({ status: v === 'ativo' ? null : v, page: null }); setText(''); }}
        items={[
          { value: 'ativo', label: 'Ativos' },
          { value: 'desligado', label: 'Desligados' },
          { value: 'todos', label: 'Todos' },
        ]}
      />
      <SearchBar label={COPY.searchLabel} placeholder="Buscar por nome ou matrícula" text={text} onTextChange={setText} searching={typing || query.isPlaceholderData} />
      <QueryView
        query={query}
        what="os colaboradores"
        loading={<DataTable<Employee> columns={columns} data={[]} getRowId={(e) => e.id} loadingRows={6} caption={COPY.tableCaption} />}
        isEmpty={(p) => p.data.length === 0}
        empty={q ? (
          <EmptyState icon={UsersThree} title={noResultsTitle(q)} text={COPY.emptySearchText} />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <EmptyState icon={UsersThree} {...COPY.empty} />
            {canCreate && <Button variant="secondary" onClick={() => setPanel({ kind: 'create' })}>{COPY.newEmployee}</Button>}
          </div>
        )}
      >
        {(result) => (
          <DataTable<Employee>
            columns={columns}
            data={result.data}
            getRowId={(e) => e.id}
            caption={COPY.tableCaption}
            rowLabel={(e) => `Abrir o espelho de ${e.name}`}
            onRowClick={(e) => router.push(`/rh/colaboradores/${e.id}`)}
            footer={<Pagination meta={{ ...result.meta, pageSize: result.meta.pageSize || PAGE_SIZE }} onPageChange={(p) => setUrl({ page: p === 1 ? null : p })} />}
          />
        )}
      </QueryView>

      <EmployeeFormPanel
        open={panel?.kind === 'create' || panel?.kind === 'edit'}
        onOpenChange={(o) => { if (!o) setPanel(null); }}
        employee={panel?.kind === 'edit' ? panel.employee : null}
        onCreated={(c) => setPin({ pin: c.initialPin, name: c.name })}
      />
      <AssignmentsPanel
        open={panel?.kind === 'assignments'}
        employee={panel?.kind === 'assignments' ? panel.employee : null}
        onOpenChange={(o) => { if (!o) setPanel(null); }}
      />
      <EmployeeSchedulePanel
        open={panel?.kind === 'schedule'}
        employee={panel?.kind === 'schedule' ? panel.employee : null}
        onOpenChange={(o) => { if (!o) setPanel(null); }}
      />
      <InitialPinDialog pin={pin?.pin ?? null} name={pin?.name ?? ''} reset={pin?.reset} onClose={() => setPin(null)} />
      <PortalAccessDialog employee={accessFor} onOpenChange={(o) => { if (!o) setAccessFor(null); }} />
      <ConfirmDialog
        open={resetting !== null}
        onOpenChange={(o) => { if (!o) setResetting(null); }}
        title={COPY.resetPin.title(resetting?.name ?? '')}
        description={COPY.resetPin.description}
        confirmLabel={COPY.resetPin.confirm}
        onConfirm={async () => {
          if (!resetting) return;
          const { pin: fresh } = await resetPin.mutateAsync(resetting.id);
          setPin({ pin: fresh, name: resetting.name, reset: true });
        }}
      />

      <TerminateDialog
        employee={terminating}
        defaultDate={today}
        onOpenChange={(o) => { if (!o) setTerminating(null); }}
        onConfirm={async (e, body) => {
          await terminate.mutateAsync({ id: e.id, body });
          notify.success('Colaborador desligado', 'As marcações continuam guardadas.');
        }}
      />
    </PageHeader>
  );
}
