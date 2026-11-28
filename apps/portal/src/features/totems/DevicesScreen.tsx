'use client';
/**
 * [SEM DESIGN] Totens (RH): lista no padrão da Apuração (cabeçalho + filtro + tabela) e painel lateral de
 * cadastro/edição no padrão dos Atestados. Estabelecimento vem só da sessão (escopo); conexão fica na URL (`conexao`).
 * A chave de acesso aparece uma vez, em modal, e fica só no estado desta tela.
 */
import { DeviceMobile, PencilSimple } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ConnectionDot } from '@/components/domain';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { QueryView } from '@/components/ui/QueryView';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { EmptyState, ForbiddenState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DEVICE_CONNECTIONS, type Device, type DeviceConnection } from '@/lib/api/contracts';
import { can } from '@/lib/auth/permissions';
import { formatInstant, formatNumber } from '@/lib/format';
import { CALIBRATION_STATE, DEVICE_CONNECTION } from '@/lib/labels';
import { establishmentParam, useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { useTextSearch } from '@/lib/use-debounced-value';
import { COPY } from './copy';
import { DeviceFormPanel } from './DeviceFormPanel';
import { DeviceKeyModal } from './DeviceKeyModal';
import { useDeviceList, type KeyReveal } from './hooks';

const FILTERS = ['todos', ...DEVICE_CONNECTIONS] as const;
type Filter = (typeof FILTERS)[number];

export function DevicesScreen() {
  const { me, establishment, establishments } = useSession();
  const router = useRouter();
  const allowed = can(me.role, 'device.manage');
  const [url, setUrl] = useUrlState(['conexao'] as const);
  const filter = oneOf<Filter>(url.conexao, FILTERS, 'todos');
  const connection: DeviceConnection | undefined = filter === 'todos' ? undefined : filter;
  const [panel, setPanel] = useState<{ mode: 'create' } | { mode: 'edit'; device: Device } | null>(null);
  const [reveal, setReveal] = useState<KeyReveal | null>(null);

  const establishmentId = establishmentParam(establishment);
  const search = useTextSearch();
  const query = useDeviceList({ ...(establishmentId ? { establishmentId } : {}), ...(connection ? { connection } : {}), ...(search.q ? { q: search.q } : {}) }, allowed);

  const columns = useMemo<ColumnDef<Device, never>[]>(() => {
    const nameOf = (id: string) => establishments.find((e) => e.id === id)?.name ?? '—';
    return [
      { id: 'name', header: 'Totem', cell: ({ row }) => <span className="font-semibold">{row.original.name}</span> },
      { id: 'establishment', header: 'Estabelecimento', cell: ({ row }) => nameOf(row.original.establishmentId) },
      { id: 'connection', header: 'Status', cell: ({ row }) => <ConnectionDot connection={row.original.connection} /> },
      {
        id: 'lastSync', header: 'Última sincronização',
        cell: ({ row }) => (row.original.lastSyncAt ? <span className="tabular-nums">{formatInstant(row.original.lastSyncAt)}</span> : <span className="text-muted">{COPY.never}</span>),
      },
      {
        id: 'pending', header: 'Lote pendente',
        cell: ({ row }) => (row.original.pendingPunches > 0
          ? <span className="font-semibold tabular-nums text-warn">{formatNumber(row.original.pendingPunches)} {row.original.pendingPunches === 1 ? 'batida' : 'batidas'}</span>
          : <span className="text-muted">{COPY.pendingNone}</span>),
      },
      { id: 'version', header: 'Versão', cell: ({ row }) => <span className="tabular-nums">{row.original.appVersion ?? COPY.noVersion}</span> },
      {
        id: 'calibration', header: 'Calibração',
        cell: ({ row }) => { const l = CALIBRATION_STATE[row.original.calibrationState]; return <StatusBadge label={l.label} tone={l.tone} />; },
      },
      {
        id: 'edit', header: () => <span className="sr-only">Ações</span>,
        cell: ({ row }) => (
          <Button
            variant="ghost" size="sm" icon={<PencilSimple size={16} aria-hidden />} aria-label={`${COPY.edit} ${row.original.name}`}
            onClick={(e) => { e.stopPropagation(); setPanel({ mode: 'edit', device: row.original }); }}
          >
            {COPY.edit}
          </Button>
        ),
      },
    ];
  }, [establishments]);

  if (!allowed) {
    return (
      <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
        <ForbiddenState screen="Totens" />
      </PageHeader>
    );
  }

  const openCreate = () => setPanel({ mode: 'create' });

  return (
    <PageHeader title={COPY.title} subtitle={COPY.subtitle} primary={<Button variant="accent" onClick={openCreate}>{COPY.newDevice}</Button>}>
      <CountTabs<Filter>
        label={COPY.filterLabel}
        value={filter}
        onChange={(f) => setUrl({ conexao: f === 'todos' ? null : f })}
        items={FILTERS.map((f) => ({ value: f, label: f === 'todos' ? 'Todos' : DEVICE_CONNECTION[f].label }))}
      />
      <SearchBar label={COPY.searchLabel} placeholder="Buscar totem pelo nome" text={search.text} onTextChange={search.setText} searching={search.typing || query.isPlaceholderData} />
      <QueryView
        query={query}
        what="os totens"
        loading={<div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
        isEmpty={(list) => list.length === 0}
        empty={(
          <div className="flex flex-col items-center gap-3">
            {search.q
              ? <EmptyState icon={DeviceMobile} title={noResultsTitle(search.q)} text={COPY.emptySearchText} />
              : <EmptyState icon={DeviceMobile} title={filter === 'todos' ? COPY.emptyTitle : COPY.emptyFilteredTitle} text={filter === 'todos' ? COPY.emptyText : COPY.emptyFilteredText} />}
            {filter === 'todos' && !search.q && <Button onClick={openCreate}>{COPY.emptyCta}</Button>}
          </div>
        )}
      >
        {(list) => (
          <DataTable<Device>
            caption={COPY.tableCaption}
            columns={columns}
            data={list}
            getRowId={(d) => d.id}
            rowLabel={(d) => `Abrir totem ${d.name}`}
            onRowClick={(d) => router.push(`/rh/totens/${encodeURIComponent(d.id)}`)}
          />
        )}
      </QueryView>

      <DeviceFormPanel
        open={panel !== null}
        onOpenChange={(o) => { if (!o) setPanel(null); }}
        device={panel?.mode === 'edit' ? panel.device : undefined}
        onKey={setReveal}
      />
      <DeviceKeyModal reveal={reveal} onDone={() => setReveal(null)} />
    </PageHeader>
  );
}
