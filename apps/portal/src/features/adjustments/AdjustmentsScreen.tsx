'use client';
/**
 * [SEM DESIGN] Ajustes (RH e gestor): abas por situação, tabela e painel lateral com a marcação original
 * ao lado da proposta. Segue o padrão de Atestados (fila + detalhe) e da Apuração (tabela).
 * URL: `status`, `id` (ajuste aberto), `employeeId` (filtro), `page`; atalho do espelho: `novo=1&employeeId=&date=`.
 * Aprovar nunca altera a marcação original: só acrescenta (Portaria MTP 671/2021).
 */
import { PencilSimpleLine, Plus } from '@phosphor-icons/react';
import { keepPreviousData } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CountTabs } from '@/components/ui/CountTabs';
import { SelectField } from '@/components/ui/Fields';
import { DataTable } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { QueryView } from '@/components/ui/QueryView';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { EmptyState, ForbiddenState, NotFoundState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Adjustment, AdjustmentStatus } from '@/lib/api/contracts';
import { parseRouteId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { DEFAULT_TZ, formatDate, formatInstant, formatTime, todayCivil } from '@/lib/format';
import { ADJUSTMENT_STATUS, ADJUSTMENT_TYPE } from '@/lib/labels';
import { useApiQuery } from '@/lib/query/hooks';
import { useEmployeeDirectory } from '@/lib/query/useEmployeeDirectory';
import { useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { useTextSearch } from '@/lib/use-debounced-value';
import { AdjustmentFormPanel } from './AdjustmentFormPanel';
import { AdjustmentPanel } from './AdjustmentPanel';
import { COPY, TAB_LABEL } from './copy';
import { useEmployeeOptions } from './useEmployeeOptions';

const TABS = ['pendente', 'aprovado', 'recusado', 'todos'] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 25;
const ALL = 'todos';

export function AdjustmentsScreen() {
  const { me } = useSession();
  const role = me.role;
  const allowed = can(role, 'nav.adjustments');
  const clock = useClock();
  const directory = useEmployeeDirectory();
  const employees = useEmployeeOptions();
  const [url, setUrl] = useUrlState(['status', 'id', 'employeeId', 'page', 'date', 'novo'] as const);
  const tab = oneOf(url.status, TABS, 'pendente');
  const employeeId = url.employeeId ? parseRouteId(url.employeeId) : null;
  const page = Math.max(1, Number(url.page) || 1);
  const selectedId = url.id ? parseRouteId(url.id) : null;
  const canCreate = can(role, 'adjustment.create');
  const formOpen = canCreate && url.novo === '1';
  const { text, setText, q, typing } = useTextSearch(() => setUrl({ page: null, id: null }));

  const status: AdjustmentStatus | undefined = tab === 'todos' ? undefined : tab;
  const list = useApiQuery(
    'adjustments',
    { list: true, status, employeeId, page, q },
    (api, signal) => api.adjustments.list({ status, employeeId: employeeId ?? undefined, q, page, pageSize: PAGE_SIZE }, signal),
    { enabled: allowed, placeholderData: keepPreviousData },
  );
  // Contagens das abas: uma chamada pequena por situação (pageSize 1), só o `meta.total` interessa.
  const counts = useApiQuery(
    'adjustments',
    { counts: true, employeeId, q },
    async (api, signal) => {
      const one = (s: AdjustmentStatus) => api.adjustments.list({ status: s, employeeId: employeeId ?? undefined, q, page: 1, pageSize: 1 }, signal);
      const [pendente, aprovado, recusado] = await Promise.all([one('pendente'), one('aprovado'), one('recusado')]);
      return { pendente: pendente.meta.total, aprovado: aprovado.meta.total, recusado: recusado.meta.total };
    },
    { enabled: allowed, placeholderData: keepPreviousData },
  );

  const columns = useMemo<ColumnDef<Adjustment, never>[]>(
    () => [
      {
        id: 'employee',
        header: 'Colaborador',
        cell: ({ row }) => {
          const who = directory.lookup(row.original.employeeId);
          return (
            <span className="flex items-center gap-3">
              <Avatar name={who.name} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{who.name}</span>
                {who.registrationNumber && <span className="text-xs text-muted">Matrícula {who.registrationNumber}</span>}
              </span>
            </span>
          );
        },
      },
      { id: 'date', header: 'Dia', cell: ({ row }) => <span className="tabular-nums">{formatDate(row.original.date)}</span> },
      { id: 'type', header: 'Tipo', cell: ({ row }) => ADJUSTMENT_TYPE[row.original.type].label },
      {
        id: 'proposal',
        header: 'Proposta',
        cell: ({ row }) => (row.original.proposedAt ? <span className="tabular-nums">{formatTime(row.original.proposedAt, DEFAULT_TZ)}</span> : <span className="text-muted">—</span>),
      },
      { id: 'reason', header: 'Motivo', cell: ({ row }) => <span className="line-clamp-2 max-w-[280px]">{row.original.reason}</span> },
      {
        id: 'status',
        header: 'Situação',
        cell: ({ row }) => <StatusBadge label={ADJUSTMENT_STATUS[row.original.status].label} tone={ADJUSTMENT_STATUS[row.original.status].tone} />,
      },
      { id: 'requestedAt', header: 'Solicitado em', cell: ({ row }) => <span className="tabular-nums">{formatInstant(row.original.requestedAt)}</span> },
    ],
    [directory],
  ) as ColumnDef<Adjustment, never>[];

  if (!allowed) {
    return (
      <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
        <ForbiddenState screen="Ajustes" />
      </PageHeader>
    );
  }

  const rows = list.data?.data ?? [];
  const selected = selectedId ? rows.find((a) => a.id === selectedId) : undefined;
  const selectedMissing = Boolean(url.id) && (!selectedId || (list.data !== undefined && !selected));
  const who = selected ? directory.lookup(selected.employeeId) : { name: '', registrationNumber: null };

  const c = counts.data;
  const countOf: Record<Tab, number | undefined> = {
    pendente: c?.pendente, aprovado: c?.aprovado, recusado: c?.recusado,
    todos: c ? c.pendente + c.aprovado + c.recusado : undefined,
  };
  const openNew = () => setUrl({ novo: '1' });
  const empty = COPY.empty[tab];

  return (
    <PageHeader
      title={COPY.title}
      subtitle={COPY.subtitle}
      controls={(
        <div className="w-64">
          <SelectField
            label={COPY.filterEmployee}
            value={employeeId ?? ALL}
            onValueChange={(v) => setUrl({ employeeId: v === ALL ? null : v, page: null, id: null })}
            options={[{ value: ALL, label: COPY.allEmployees }, ...employees.options]}
          />
        </div>
      )}
      primary={canCreate ? <Button variant="accent" icon={<Plus size={18} aria-hidden />} onClick={openNew}>{COPY.newAdjustment}</Button> : undefined}
    >
      <CountTabs<Tab>
        label={COPY.tabsLabel}
        value={tab}
        onChange={(t) => setUrl({ status: t, page: null, id: null })}
        items={TABS.map((t) => ({ value: t, label: TAB_LABEL[t], count: countOf[t], attention: t === 'pendente' && (c?.pendente ?? 0) > 0 }))}
      />
      <SearchBar label={COPY.searchLabel} placeholder="Buscar por nome ou matrícula" text={text} onTextChange={setText} searching={typing || list.isPlaceholderData} />
      {selectedMissing && <NotFoundState onBack={() => setUrl({ id: null })} />}
      <QueryView
        query={list}
        what="os ajustes"
        loading={<DataTable<Adjustment> caption={COPY.tableCaption} columns={columns} data={[]} getRowId={(a) => a.id} loadingRows={6} />}
        isEmpty={(p) => p.data.length === 0}
        empty={(
          <div className="flex flex-col items-center gap-3">
            {q ? <EmptyState icon={PencilSimpleLine} title={noResultsTitle(q)} text={COPY.emptySearchText} /> : <EmptyState icon={PencilSimpleLine} title={empty.title} text={empty.text} />}
            {canCreate && !q && <Button variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={openNew}>{COPY.newAdjustment}</Button>}
          </div>
        )}
      >
        {(p) => (
          <DataTable<Adjustment>
            caption={COPY.tableCaption}
            columns={columns}
            data={p.data}
            getRowId={(a) => a.id}
            selectedId={selectedId}
            onRowClick={(a) => setUrl({ id: a.id })}
            rowLabel={(a) => `Abrir ajuste de ${directory.lookup(a.employeeId).name}, ${formatDate(a.date)}`}
            footer={<Pagination meta={p.meta} onPageChange={(n) => setUrl({ page: n === 1 ? null : n, id: null })} />}
          />
        )}
      </QueryView>

      <AdjustmentPanel
        adjustment={selected}
        role={role}
        name={who.name}
        registration={who.registrationNumber}
        onClose={() => setUrl({ id: null })}
      />
      <AdjustmentFormPanel
        open={formOpen}
        onOpenChange={(o) => { if (!o) setUrl({ novo: null, date: null }); }}
        defaults={{ employeeId: employeeId ?? '', date: url.date && /^\d{4}-\d{2}-\d{2}$/.test(url.date) ? url.date : todayCivil(clock) }}
      />
    </PageHeader>
  );
}
