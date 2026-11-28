'use client';
/**
 * [SEM DESIGN] Detalhe do totem: abas Resumo / Calibração / Atividade (URL `aba`). Rota `/rh/totens/[id]`.
 * ID inválido: "não encontrado" sem chamar a api. 403 e 404 do recurso mostram a mesma tela.
 */
import { DeviceMobile, PencilSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConnectionDot } from '@/components/domain';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, ForbiddenState, NotFoundState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Device, DeviceActivity } from '@/lib/api/contracts';
import { parseRouteId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { formatInstant } from '@/lib/format';
import { CALIBRATION_STATE } from '@/lib/labels';
import { useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { CalibrationTab } from './CalibrationTab';
import { ACTIVITY_TYPE, COPY } from './copy';
import { DeviceFormPanel } from './DeviceFormPanel';
import { DeviceKeyModal } from './DeviceKeyModal';
import { OpenTotemLink } from './OpenTotemLink';
import { useDeviceDetail, type KeyReveal } from './hooks';

const TABS = ['resumo', 'calibracao', 'atividade'] as const;
type Tab = (typeof TABS)[number];

export function DeviceDetailScreen({ rawId }: { rawId: string }) {
  const { me, establishments } = useSession();
  const router = useRouter();
  const allowed = can(me.role, 'device.manage');
  const id = parseRouteId(rawId);
  const [url, setUrl] = useUrlState(['aba'] as const);
  const tab = oneOf<Tab>(url.aba, TABS, 'resumo');
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState<KeyReveal | null>(null);
  const query = useDeviceDetail(id, allowed);

  if (!allowed) {
    return (
      <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
        <ForbiddenState screen="Totens" />
      </PageHeader>
    );
  }
  if (id === null) {
    return (
      <PageHeader title="Totem">
        <NotFoundState onBack={() => router.push('/rh/totens')} />
      </PageHeader>
    );
  }

  const device = query.data;
  const establishmentName = device ? (establishments.find((e) => e.id === device.establishmentId)?.name ?? '') : '';

  return (
    <PageHeader
      title={device?.name ?? 'Totem'}
      subtitle={device ? establishmentName : undefined}
      primary={device ? <Button variant="accent" icon={<PencilSimple size={18} aria-hidden />} onClick={() => setEditing(true)}>{COPY.edit}</Button> : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/rh/totens" className="w-fit text-sm font-semibold text-brand underline">{COPY.back}</Link>
        <div className="flex flex-wrap items-center gap-3">
          {device && tab !== 'calibracao' && (
            <Button onClick={() => setUrl({ aba: 'calibracao' })}>{COPY.calibration.start}</Button>
          )}
          <OpenTotemLink />
        </div>
      </div>
      <p className="m-0 max-w-[720px] text-xs text-muted">{COPY.openTotem.hint}</p>
      <QueryView
        query={query}
        what="o totem"
        loading={<div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-3"><Skeleton className="h-11 w-full" /><Skeleton className="h-48 w-full" /></div>}
      >
        {(d) => (
          <>
            <CountTabs<Tab>
              label={COPY.tabs.label}
              value={tab}
              onChange={(t) => setUrl({ aba: t === 'resumo' ? null : t })}
              items={TABS.map((t) => ({ value: t, label: COPY.tabs[t] }))}
            />
            {tab === 'resumo' && <Summary device={d} establishmentName={establishmentName} />}
            {tab === 'calibracao' && <CalibrationTab device={d} />}
            {tab === 'atividade' && <ActivityTab id={d.id} />}
            <DeviceFormPanel open={editing} onOpenChange={setEditing} device={d} onKey={setReveal} onDeleted={() => router.push('/rh/totens')} />
          </>
        )}
      </QueryView>
      <DeviceKeyModal reveal={reveal} onDone={() => setReveal(null)} />
    </PageHeader>
  );
}

function Summary({ device, establishmentName }: { device: Device; establishmentName: string }) {
  const cal = CALIBRATION_STATE[device.calibrationState];
  const S = COPY.summary;
  return (
    <Card as="section" className="max-w-[720px] p-5">
      <KeyValueList
        items={[
          { label: S.establishment, value: establishmentName || '—' },
          { label: S.active, value: device.isActive ? S.activeYes : S.activeNo },
          { label: S.connection, value: <ConnectionDot connection={device.connection} /> },
          { label: S.lastSync, value: device.lastSyncAt ? formatInstant(device.lastSyncAt) : COPY.never },
          { label: S.pending, value: device.pendingPunches > 0 ? S.pendingText(device.pendingPunches) : COPY.pendingNone },
          { label: S.version, value: device.appVersion ?? COPY.noVersion },
          { label: S.key, value: device.keyPrefix ? <span className="font-mono">{S.keyFormat(device.keyPrefix)}</span> : S.keyNone },
          { label: S.calibration, value: <StatusBadge label={cal.label} tone={cal.tone} /> },
          { label: S.createdAt, value: formatInstant(device.createdAt) },
        ]}
      />
    </Card>
  );
}

function ActivityTab({ id }: { id: string }) {
  const query = useApiQuery('devices', { activity: id }, (api, signal) => api.devices.activity(id, signal));
  const A = COPY.activity;
  return (
    <>
      <p className="m-0 text-xs text-muted">{A.note}</p>
      <QueryView
        query={query}
        what={A.what}
        loading={<div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState icon={DeviceMobile} title={A.emptyTitle} text={A.emptyText} />}
      >
        {(list) => (
          <DataTable<DeviceActivity>
            caption={A.caption}
            getRowId={(a) => a.id}
            data={list}
            columns={[
              { id: 'at', header: 'Quando', cell: ({ row }) => <span className="tabular-nums">{formatInstant(row.original.at)}</span> },
              { id: 'type', header: 'Tipo', cell: ({ row }) => ACTIVITY_TYPE[row.original.type] },
              { id: 'description', header: 'Descrição', cell: ({ row }) => row.original.description },
            ]}
          />
        )}
      </QueryView>
    </>
  );
}
