'use client';
/**
 * [SEM DESIGN] Banco de horas do RH (mapa §4.10): saldos por colaborador, extrato e a regra do
 * estabelecimento (PolicyPanel, só rh e admin). Saldos e vencimentos vêm calculados da api.
 * Sem KPIs: o contrato não traz totais, e o front não soma saldos entre colaboradores.
 * Folga compensatória: sem rota no back.
 */
import type { ColumnDef } from '@tanstack/react-table';
import { Hourglass } from '@phosphor-icons/react';
import { keepPreviousData } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Minutes } from '@/components/domain/Minutes';
import { PageHeader } from '@/components/shell/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { Pagination } from '@/components/ui/Pagination';
import { PendingBackTooltip } from '@/components/ui/PendingBackTooltip';
import { QueryView } from '@/components/ui/QueryView';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, ForbiddenState, LoadingState } from '@/components/ui/States';
import type { EmployeeTimeBank, EntityId, TimeBankBalanceRow, TimeBankEntry } from '@/lib/api/contracts';
import { isEntityId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import { useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { useUrlState } from '@/lib/url-state';
import { useTextSearch } from '@/lib/use-debounced-value';
import { COPY, entryLabel } from './copy';
import { PolicyPanel } from './PolicyPanel';

const PAGE_SIZE = 25;

export function TimeBankScreen() {
  const { me, establishment } = useSession();
  const [url, setUrl] = useUrlState(['page', 'colaborador'] as const);
  const allowed = can(me.role, 'timeBank.view');
  const hasEstablishment = establishment.id !== '';
  const page = Math.max(1, Number.parseInt(url.page ?? '1', 10) || 1);
  const selectedId = url.colaborador && isEntityId(url.colaborador) ? url.colaborador : null;

  const search = useTextSearch(() => setUrl({ page: null }));
  const q = useApiQuery(
    'timeBank',
    { establishmentId: establishment.id, page, q: search.q },
    (api, signal) => api.timeBank.balances({ establishmentId: establishment.id, q: search.q, page, pageSize: PAGE_SIZE }, signal),
    { enabled: allowed && hasEstablishment, placeholderData: keepPreviousData },
  );

  const columns = useMemo<ColumnDef<TimeBankBalanceRow, never>[]>(
    () => [
      {
        id: 'employee',
        header: 'Colaborador',
        cell: ({ row: { original: r } }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={r.employeeName} />
            <span className="font-semibold">{r.employeeName}</span>
          </div>
        ),
      },
      { id: 'department', header: 'Setor', cell: ({ row: { original: r } }) => <span className="text-ink-2">{r.departmentName ?? '—'}</span> },
      {
        id: 'balance',
        header: 'Saldo',
        // O destaque é só de exibição, pelo sinal que a api entregou: o front não aplica limite nem regra.
        cell: ({ row: { original: r } }) => <Minutes value={r.balanceMinutes} signed emphasis={r.balanceMinutes < 0 ? 'danger' : 'none'} />,
      },
      {
        id: 'expiring',
        header: 'A vencer em 30 dias',
        cell: ({ row: { original: r } }) => (r.expiringIn30DaysMinutes > 0 ? <Minutes value={r.expiringIn30DaysMinutes} emphasis="warn" /> : <span className="text-muted">—</span>),
      },
      {
        id: 'nextDue',
        header: 'Próximo vencimento',
        cell: ({ row: { original: r } }) => (r.nextDueDate ? <span className="tabular-nums">{formatDate(r.nextDueDate)}</span> : <span className="text-muted">—</span>),
      },
    ],
    [],
  );

  if (!allowed) return <ForbiddenState screen="Banco de horas" />;

  const compensatory = (
    <span title={COPY.compensatoryPending}>
      <PendingBackTooltip text={COPY.compensatoryPending}>
        <Button variant="secondary" disabled aria-describedby="compensatory-note">{COPY.compensatory}</Button>
      </PendingBackTooltip>
      <span id="compensatory-note" className="sr-only">{COPY.compensatoryPending}</span>
    </span>
  );

  const selectedRow = selectedId !== null ? q.data?.data.find((r) => r.employeeId === selectedId) : undefined;

  return (
    <PageHeader
      title={COPY.title}
      subtitle={hasEstablishment ? `${establishment.name} · ${COPY.subtitle}` : COPY.subtitle}
      controls={can(me.role, 'closing.manage') ? compensatory : undefined}
    >
      {!hasEstablishment ? (
        <EmptyState icon={Hourglass} title={COPY.pickEstablishmentTitle} text={COPY.pickEstablishmentText} />
      ) : (
        <>
        {can(me.role, 'timeBank.viewPolicy') && <PolicyPanel key={establishment.id} />}
        <SearchBar label={COPY.searchLabel} placeholder="Buscar por nome ou matrícula" text={search.text} onTextChange={search.setText} searching={search.typing || q.isPlaceholderData} />
        <QueryView
          query={q}
          what="o banco de horas"
          loading={<DataTable caption="Carregando o banco de horas" columns={columns} data={[]} getRowId={(r) => r.employeeId} loadingRows={6} />}
          isEmpty={(d) => d.meta.total === 0}
          empty={search.q ? <EmptyState icon={Hourglass} title={noResultsTitle(search.q)} text={COPY.emptySearchText} /> : <EmptyState icon={Hourglass} title={COPY.emptyTitle} text={COPY.emptyText} />}
        >
          {(data) => (
            <>
              <DataTable
                caption={`Saldos do banco de horas em ${establishment.name}`}
                columns={columns}
                data={data.data}
                getRowId={(r) => r.employeeId}
                selectedId={selectedId}
                onRowClick={(r) => setUrl({ colaborador: r.employeeId })}
                rowLabel={(r) => `Abrir extrato de ${r.employeeName}`}
              />
              {data.meta.total > data.meta.pageSize && <Pagination meta={data.meta} onPageChange={(p) => setUrl({ page: p === 1 ? null : p })} />}
            </>
          )}
        </QueryView>
        </>
      )}

      {selectedId !== null && (
        <StatementPanel employeeId={selectedId} name={selectedRow?.employeeName} onClose={() => setUrl({ colaborador: null })} />
      )}
    </PageHeader>
  );
}

function StatementPanel({ employeeId, name, onClose }: { employeeId: EntityId; name: string | undefined; onClose: () => void }) {
  const q = useApiQuery('timeBank', { employeeId }, (api, signal) => api.timeBank.byEmployee(employeeId, signal));
  const columns = useMemo<ColumnDef<TimeBankEntry, never>[]>(
    () => [
      { id: 'date', header: 'Data', cell: ({ row: { original: e } }) => <span className="tabular-nums">{formatDate(e.date)}</span> },
      { id: 'type', header: 'Tipo', cell: ({ row: { original: e } }) => entryLabel(e.type) },
      { id: 'minutes', header: 'Minutos', cell: ({ row: { original: e } }) => <Minutes value={e.minutes} signed /> },
      { id: 'due', header: 'Vence em', cell: ({ row: { original: e } }) => (e.dueDate ? <span className="tabular-nums">{formatDate(e.dueDate)}</span> : <span className="text-muted">—</span>) },
    ],
    [],
  );
  return (
    <SidePanel open onOpenChange={(o) => { if (!o) onClose(); }} title={name ? `Extrato de ${name}` : 'Extrato do banco de horas'} width="lg">
      <QueryView
        query={q}
        what="o extrato"
        loading={<LoadingState label="Carregando o extrato…" />}
        isEmpty={(d: EmployeeTimeBank) => d.entries.length === 0}
        empty={<EmptyState icon={Hourglass} title="Nenhum lançamento" text="Este colaborador ainda não tem lançamentos no banco de horas." />}
      >
        {(d) => (
          <div className="flex flex-col gap-4">
            <KeyValueList
              items={[
                { label: 'Saldo', value: <Minutes value={d.balanceMinutes} signed emphasis={d.balanceMinutes < 0 ? 'danger' : 'none'} /> },
                { label: 'A vencer em 30 dias', value: d.expiringIn30DaysMinutes > 0 ? <Minutes value={d.expiringIn30DaysMinutes} emphasis="warn" /> : '—' },
              ]}
            />
            {/* O ledger pode repetir data, tipo e minutos (recálculos do mesmo dia): a chave é a posição. */}
            <DataTable caption="Extrato do banco de horas" columns={columns} data={d.entries} getRowId={(e) => String(d.entries.indexOf(e))} />
          </div>
        )}
      </QueryView>
    </SidePanel>
  );
}
