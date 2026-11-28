'use client';
/**
 * [SEM DESIGN] Fechamento (mapa §4.11), no padrão das telas desenhadas: PageHeader + tabela + painel lateral.
 * Fechar pode ser recusado pela api por inconsistência aberta ou ajuste pendente (409 FECHAMENTO_COM_PENDENCIAS):
 * a tela mostra a mensagem da api e leva para a apuração e para os ajustes. Reabrir é evento crítico:
 * motivo obrigatório e confirmação digitada. contador e admin só leem.
 * [A CONFIRMAR] Quais inconsistências travam o fechamento: a regra é do back (service.pendingCount).
 */
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarCheck, FilePlus, LockKey, LockKeyOpen, Stamp, UsersThree } from '@phosphor-icons/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable } from '@/components/ui/DataTable';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, ForbiddenState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MonthPicker } from '@/components/ui/MonthPicker';
import type { Closing, EntityId } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { isEntityId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { formatInstant, formatMonth, formatPeriod, monthOf, plural, todayCivil } from '@/lib/format';
import { CLOSING_STATUS } from '@/lib/labels';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { useUrlState } from '@/lib/url-state';
import { closeDialog, COPY, reopenDialog } from './copy';
import { MirrorPanel } from './MirrorPanel';

const PENDING_CODE = 'FECHAMENTO_COM_PENDENCIAS';

interface Blocked {
  closingId: EntityId;
  message: string;
  issues: number | null;
  adjustments: number | null;
}

type Confirm = { kind: 'close' | 'reopen'; closing: Closing } | null;

const linkClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line-strong bg-white px-[18px] font-semibold hover:bg-surface';

export function ClosingsScreen() {
  const { me, establishment } = useSession();
  const clock = useClock();
  const allowed = can(me.role, 'closing.view');
  const canManage = can(me.role, 'closing.manage');
  const canReopen = can(me.role, 'closing.reopen');
  const canMirror = can(me.role, 'closing.viewMirror');
  const hasEstablishment = establishment.id !== '';
  const enabled = allowed && hasEstablishment;

  const [url, setUrl] = useUrlState(['id', 'colaborador'] as const);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [creating, setCreating] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  const q = useApiQuery('closings', { establishmentId: establishment.id }, (api, signal) => api.closings.list({ establishmentId: establishment.id }, signal), { enabled });

  const close = useApiMutation((api, id: EntityId) => api.closings.close(id), { invalidates: ['closings', 'mirrors'] });
  const reopen = useApiMutation((api, v: { id: EntityId; reason: string }) => api.closings.reopen(v.id, { reason: v.reason }), {
    invalidates: ['closings', 'mirrors', 'timesheets', 'day'],
  });
  const generate = useApiMutation((api, id: EntityId) => api.closings.generateMirrors(id), {
    invalidates: ['closings', 'mirrors'],
    onSuccess: (r) => notify.success(`${r.generated} de ${r.total} espelhos gerados`),
    onError: (e) => notify.error(e),
  });

  const selectedId = url.id && isEntityId(url.id) ? url.id : null;
  const employeeId = url.colaborador && isEntityId(url.colaborador) ? url.colaborador : null;
  const selected = selectedId !== null ? (q.data ?? []).find((c) => c.id === selectedId) ?? null : null;

  const columns = useMemo<ColumnDef<Closing, never>[]>(
    () => [
      {
        id: 'month',
        header: 'Competência',
        cell: ({ row: { original: c } }) => <span className="font-semibold">{formatMonth(c.referenceMonth)}</span>,
      },
      { id: 'period', header: 'Período', cell: ({ row: { original: c } }) => <span className="text-ink-2 tabular-nums">{formatPeriod(c.startDate, c.endDate)}</span> },
      {
        id: 'status',
        header: 'Situação',
        cell: ({ row: { original: c } }) => <StatusBadge label={CLOSING_STATUS[c.status].label} tone={CLOSING_STATUS[c.status].tone} />,
      },
      {
        id: 'closedAt',
        header: 'Fechada em',
        cell: ({ row: { original: c } }) => (c.closedAt ? <span className="tabular-nums">{formatInstant(c.closedAt)}</span> : <span className="text-muted">—</span>),
      },
      {
        id: 'reopened',
        header: 'Reabertura',
        cell: ({ row: { original: c } }) =>
          c.reopenedAt ? (
            <div className="flex max-w-[260px] flex-col">
              <span className="tabular-nums">{formatInstant(c.reopenedAt)}</span>
              {c.reopenReason && <span className="text-xs text-muted">Motivo: {c.reopenReason}</span>}
            </div>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Ações</span>,
        cell: ({ row: { original: c } }) => {
          const month = formatMonth(c.referenceMonth);
          return (
            <div className="flex flex-wrap justify-end gap-2">
              {canMirror && c.status !== 'aberto' && (
                <Button variant="secondary" size="sm" aria-label={`Ver espelhos de ${month}`} icon={<UsersThree size={14} aria-hidden />} onClick={() => setUrl({ id: c.id, colaborador: null })}>
                  Ver espelhos
                </Button>
              )}
              {canManage && c.status !== 'fechado' && (
                <Button variant="primary" size="sm" aria-label={`Fechar ${month}`} icon={<LockKey size={14} aria-hidden />} onClick={() => setConfirm({ kind: 'close', closing: c })}>
                  Fechar
                </Button>
              )}
              {canManage && c.status === 'fechado' && (
                <Button variant="secondary" size="sm" aria-label={`Gerar espelhos de ${month}`} loading={generate.isPending && generate.variables === c.id} icon={<Stamp size={14} aria-hidden />} onClick={() => generate.mutate(c.id)}>
                  Gerar espelhos
                </Button>
              )}
              {canReopen && c.status === 'fechado' && (
                <Button variant="danger" size="sm" aria-label={`Reabrir ${month}`} icon={<LockKeyOpen size={14} aria-hidden />} onClick={() => setConfirm({ kind: 'reopen', closing: c })}>
                  Reabrir
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [canMirror, canManage, canReopen, generate, setUrl],
  );

  if (!allowed) return <ForbiddenState screen="Fechamento" />;

  const onConfirmClose = async (closing: Closing) => {
    try {
      await close.mutateAsync(closing.id);
      setBlocked(null);
      notify.success(`${formatMonth(closing.referenceMonth)} fechada`);
    } catch (e) {
      const err = asApiError(e);
      if (err.code !== PENDING_CODE) throw err;
      const count = (path: string) => {
        const n = Number(err.fields.find((f) => f.path === path)?.message);
        return Number.isFinite(n) ? n : null;
      };
      // A mensagem da api é mostrada na tela (com os atalhos), não só no diálogo.
      setBlocked({ closingId: closing.id, message: err.message, issues: count('issues'), adjustments: count('adjustments') });
    }
  };

  const onConfirmReopen = async (closing: Closing, reason: string | undefined) => {
    await reopen.mutateAsync({ id: closing.id, reason: reason ?? '' });
    notify.success(`${formatMonth(closing.referenceMonth)} reaberta`, 'A ciência dos espelhos foi apagada.');
  };

  const dialog = confirm && (confirm.kind === 'close' ? closeDialog(formatMonth(confirm.closing.referenceMonth)) : reopenDialog(formatMonth(confirm.closing.referenceMonth)));

  return (
    <PageHeader
      title={COPY.title}
      subtitle={hasEstablishment ? `${establishment.name} · ${COPY.subtitle}` : COPY.subtitle}
      controls={
        <span title={COPY.exportAejNote}>
          <Button variant="secondary" disabled aria-describedby="export-aej-note">{COPY.exportAej}</Button>
          <span id="export-aej-note" className="sr-only">{COPY.exportAejNote}</span>
        </span>
      }
      primary={
        canManage ? (
          <Button variant="accent" disabled={!hasEstablishment} icon={<FilePlus size={18} aria-hidden />} onClick={() => setCreating(true)}>
            {COPY.open}
          </Button>
        ) : undefined
      }
    >
      {!canManage && <p className="m-0 text-sm text-muted">{COPY.readOnly}</p>}

      {blocked && (
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-danger-line bg-danger-bg px-4 py-3 text-sm text-danger">
          <div className="flex flex-col gap-1">
            <strong>{COPY.blockedTitle}</strong>
            <span>{blocked.message}</span>
            {(blocked.issues !== null || blocked.adjustments !== null) && (
              <span className="tabular-nums">
                {[
                  blocked.issues !== null ? plural(blocked.issues, 'inconsistência aberta', 'inconsistências abertas') : null,
                  blocked.adjustments !== null ? plural(blocked.adjustments, 'ajuste pendente', 'ajustes pendentes') : null,
                ].filter(Boolean).join(' e ')}
                .
              </span>
            )}
            <span className="text-ink-2">{COPY.blockedHelp}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/rh/apuracao?aba=inconsistente" className={linkClass}>Ver inconsistências</Link>
            <Link href="/rh/ajustes?status=pendente" className={linkClass}>Ver ajustes pendentes</Link>
            <Button variant="ghost" onClick={() => setBlocked(null)}>Dispensar aviso</Button>
          </div>
        </div>
      )}

      {!hasEstablishment ? (
        <EmptyState icon={CalendarCheck} title={COPY.pickEstablishmentTitle} text={COPY.pickEstablishmentText} />
      ) : (
        <QueryView
          query={q}
          what="as competências"
          loading={<DataTable caption="Carregando as competências" columns={columns} data={[]} getRowId={(c) => c.id} loadingRows={4} />}
          isEmpty={(d) => d.length === 0}
          empty={
            <div className="flex flex-col items-center gap-4">
              <EmptyState icon={CalendarCheck} title={COPY.emptyTitle} text={COPY.emptyText} />
              {canManage && <Button variant="secondary" onClick={() => setCreating(true)}>{COPY.open}</Button>}
            </div>
          }
        >
          {(data) => (
            <DataTable
              caption={`Competências de ${establishment.name}`}
              columns={columns}
              data={[...data].sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth))}
              getRowId={(c) => c.id}
              selectedId={selectedId}
            />
          )}
        </QueryView>
      )}

      {selected && canMirror && (
        <MirrorPanel
          closing={selected}
          employeeId={employeeId}
          onSelectEmployee={(id) => setUrl({ colaborador: id })}
          onClose={() => setUrl({ id: null, colaborador: null })}
        />
      )}

      {creating && (
        <CreatePanel
          establishmentId={establishment.id}
          initialMonth={monthOf(todayCivil(clock))}
          onClose={() => setCreating(false)}
        />
      )}

      {confirm && dialog && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirm(null); }}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          tone={confirm.kind === 'reopen' ? 'danger' : 'default'}
          reason={confirm.kind === 'reopen' ? { label: 'Motivo da reabertura', min: 3, max: 500 } : undefined}
          typeToConfirm={confirm.kind === 'reopen' ? formatMonth(confirm.closing.referenceMonth) : undefined}
          onConfirm={(reason) => (confirm.kind === 'close' ? onConfirmClose(confirm.closing) : onConfirmReopen(confirm.closing, reason))}
        />
      )}
    </PageHeader>
  );
}

function CreatePanel({ establishmentId, initialMonth, onClose }: { establishmentId: EntityId; initialMonth: string; onClose: () => void }) {
  const [month, setMonth] = useState(initialMonth);
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation((api, referenceMonth: string) => api.closings.create({ establishmentId, referenceMonth }), {
    invalidates: ['closings'],
    onSuccess: (c) => {
      notify.success(`${formatMonth(c.referenceMonth)} aberta`);
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <SidePanel
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={COPY.open}
      description="Escolha o mês da competência. O período vai do dia 1 ao último dia do mês."
      width="sm"
      footer={
        <>
          <Button variant="secondary" disabled={create.isPending} onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={create.isPending} onClick={() => { setError(null); create.mutate(month); }}>{COPY.open}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <MonthPicker value={month} onChange={(m) => { setMonth(m); setError(null); }} />
        {error && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </SidePanel>
  );
}
