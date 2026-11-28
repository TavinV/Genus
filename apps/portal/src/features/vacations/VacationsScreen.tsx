'use client';
/**
 * Férias (rh, gestor, admin): calendário do setor com limite de simultâneos e fila de pedidos.
 * Desenhada (Genus RH.dc.html, "Férias"). Dados do calendário: [MOCK] (sem endpoint no back).
 * "Dentro do limite" / "Acima do limite do setor" vêm de `exceedsLimit` da api: o front nunca calcula.
 * URL: `month` (AAAA-MM), `departmentId` (aba), `employeeId` (painel do colaborador).
 */
import { CalendarBlank, CheckCircle, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { VacationGantt } from '@/components/domain';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CountTabs } from '@/components/ui/CountTabs';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { notify } from '@/components/ui/notify';
import { PendingBackTooltip } from '@/components/ui/PendingBackTooltip';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, ForbiddenState, Skeleton } from '@/components/ui/States';
import type { VacationCalendar, VacationCalendarRow } from '@/lib/api/contracts';
import { ApiError, asApiError } from '@/lib/api/errors';
import { parseRouteId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { formatDate, formatMonth, monthOf, todayCivil } from '@/lib/format';
import { useApiMutation, useApiQuery, useInvalidate } from '@/lib/query/hooks';
import { useEmployeeDirectory } from '@/lib/query/useEmployeeDirectory';
import { establishmentParam, useSession } from '@/lib/session';
import { useUrlState } from '@/lib/url-state';
import { COPY } from './copy';
import { EmployeeVacationPanel } from './EmployeeVacationPanel';

const MODULES = ['vacations', 'vacationCalendar', 'overview'] as const;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function Skel() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-4">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function VacationsScreen() {
  const { me, establishment } = useSession();
  const role = me.role;
  const allowed = can(role, 'vacation.view');
  const clock = useClock();
  const directory = useEmployeeDirectory();
  const invalidate = useInvalidate();
  const today = todayCivil(clock);
  const [url, setUrl] = useUrlState(['month', 'departmentId', 'employeeId'] as const);
  const month = url.month && MONTH.test(url.month) ? url.month : monthOf(today);
  const establishmentId = establishmentParam(establishment);
  const employeeId = url.employeeId ? parseRouteId(url.employeeId) : null;
  const [launching, setLaunching] = useState(false);
  const [decision, setDecision] = useState<{ kind: 'approve' | 'reject'; row: VacationCalendarRow; max: number } | null>(null);

  const calendar = useApiQuery(
    'vacationCalendar',
    { establishmentId, month },
    (api, signal) => api.vacations.calendar({ establishmentId: establishmentId ?? '', month }, signal),
    { enabled: allowed && establishmentId !== undefined },
  );

  const approve = useApiMutation((api, id: string) => api.vacations.approve(id), { invalidates: [...MODULES] });
  const reject = useApiMutation((api, v: { id: string; reason: string }) => api.vacations.reject(v.id, { reason: v.reason }), { invalidates: [...MODULES] });

  if (!allowed) {
    return (
      <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
        <ForbiddenState screen="Férias" />
      </PageHeader>
    );
  }

  const canCreate = can(role, 'vacation.create');
  const canDecide = can(role, 'vacation.decide');
  const panelOpen = launching || employeeId !== null;
  const closePanel = () => { setLaunching(false); setUrl({ employeeId: null }); };

  /** Aprovar: o 409 de setor desfalcado mostra a mensagem da api e a próxima janela livre, se vier. */
  const doApprove = async (row: VacationCalendarRow) => {
    try {
      await approve.mutateAsync(row.vacationId);
      notify.success('Férias aprovadas', `${row.employeeName}, ${formatDate(row.startDate, 'dayMonth')} a ${formatDate(row.endDate, 'dayMonth')}.`);
    } catch (e) {
      const err = asApiError(e);
      if (err.status === 409 && err.code === 'STATUS_INVALIDO') {
        notify.error(err);
        await invalidate(...MODULES);
        return;
      }
      if (err.code === 'FERIAS_SETOR_DESFALCADO') {
        const next = err.fields.find((f) => f.path === 'nextFreeStartDate')?.message ?? row.nextFreeStartDate;
        throw new ApiError(err.kind, err.status, err.code, next ? `${err.message}. ${COPY.nextWindow(formatDate(next, 'dayMonth'))}` : err.message, err.fields);
      }
      throw err;
    }
  };

  const doReject = async (row: VacationCalendarRow, reason: string) => {
    try {
      await reject.mutateAsync({ id: row.vacationId, reason });
      notify.success('Pedido recusado', `O motivo foi registrado para ${row.employeeName}.`);
    } catch (e) {
      const err = asApiError(e);
      if (err.status === 409 && err.code === 'STATUS_INVALIDO') {
        notify.error(err);
        await invalidate(...MODULES);
        return;
      }
      throw err;
    }
  };

  const launch = () => setLaunching(true);
  const exportDisabled = (
    <PendingBackTooltip text="Em breve: o servidor ainda não exporta o calendário">
      <Button variant="secondary" disabled>{COPY.export}</Button>
    </PendingBackTooltip>
  );
  const noPeriods = `Nenhum período de férias em ${formatMonth(month)}`;
  const who = employeeId ? directory.lookup(employeeId).name : '';

  const content = (data: VacationCalendar) => {
    const dept = data.departments.find((d) => d.departmentId === url.departmentId) ?? data.departments[0];
    if (!dept) return null;
    const pending = dept.rows.filter((r) => r.status === 'solicitada');
    const peak = Math.max(0, ...dept.dailyOccupancy);
    return (
      <>
        <CountTabs<string>
          label={COPY.departmentsLabel}
          value={dept.departmentId}
          onChange={(v) => setUrl({ departmentId: v })}
          items={data.departments.map((d) => ({
            value: d.departmentId,
            label: d.name,
            count: d.rows.length,
            attention: d.rows.some((r) => r.status === 'solicitada'),
          }))}
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <Card className="flex flex-col gap-1 p-5">
            <span className="text-xs font-medium text-muted">Limite de férias simultâneas</span>
            <span className="text-2xl font-bold tabular-nums">{dept.maxSimultaneous}<span className="ml-1 text-sm font-semibold text-muted">de {dept.headcount} colaboradores</span></span>
          </Card>
          <Card className="flex flex-col gap-1 p-5">
            <span className="text-xs font-medium text-muted">Pico de ocupação no mês</span>
            <span className="text-2xl font-bold tabular-nums">{peak}<span className="ml-1 text-sm font-semibold text-muted">de {dept.maxSimultaneous}</span></span>
          </Card>
        </div>
        <VacationGantt
          month={data.month}
          rows={dept.rows}
          dailyOccupancy={dept.dailyOccupancy}
          maxSimultaneous={dept.maxSimultaneous}
          today={today}
          onSelect={(r) => setUrl({ employeeId: r.employeeId })}
        />
        <section aria-label={COPY.queueTitle} className="flex flex-col gap-3 rounded-card border border-line bg-white p-5 shadow-card">
          <h2 className="m-0 text-base font-bold">{COPY.queueTitle}</h2>
          {pending.length === 0 && <p className="m-0 text-muted">{COPY.queueEmpty}</p>}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {pending.map((r) => (
              <li key={r.vacationId} className="flex flex-col gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => setUrl({ employeeId: r.employeeId })} className="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold underline-offset-2 hover:underline">
                    {r.employeeName}
                  </button>
                  <span className="text-sm tabular-nums text-ink-2">{formatDate(r.startDate, 'dayMonth')} a {formatDate(r.endDate, 'dayMonth')}</span>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${r.exceedsLimit ? 'text-warn' : 'text-brand'}`}>
                  {r.exceedsLimit ? <Warning size={14} weight="fill" aria-hidden /> : <CheckCircle size={14} weight="fill" aria-hidden />}
                  {r.exceedsLimit ? COPY.aboveLimit : COPY.withinLimit}
                </span>
                {canDecide && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" aria-label={`Aprovar férias de ${r.employeeName}`} onClick={() => setDecision({ kind: 'approve', row: r, max: dept.maxSimultaneous })}>{COPY.approve}</Button>
                    <Button size="sm" variant="secondary" aria-label={`Recusar férias de ${r.employeeName}`} onClick={() => setDecision({ kind: 'reject', row: r, max: dept.maxSimultaneous })}>{COPY.reject}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  };

  return (
    <PageHeader
      title={COPY.title}
      subtitle={COPY.subtitle}
      controls={(
        <>
          <MonthPicker value={month} onChange={(m) => setUrl({ month: m })} />
          {exportDisabled}
        </>
      )}
      primary={canCreate ? <Button variant="accent" onClick={launch}>{COPY.launch}</Button> : undefined}
    >
      {establishmentId === undefined ? (
        <EmptyState icon={CalendarBlank} {...COPY.noEstablishment} />
      ) : (
        <QueryView
          query={calendar}
          what="o calendário de férias"
          loading={<Skel />}
          isEmpty={(d) => d.departments.every((x) => x.rows.length === 0)}
          empty={(
            <div className="flex flex-col items-center gap-3">
              <EmptyState icon={CalendarBlank} title={noPeriods} text="Quando houver férias solicitadas ou aprovadas neste mês, elas aparecem no calendário do setor." />
              {canCreate && <Button variant="secondary" onClick={launch}>{COPY.emptyCta}</Button>}
            </div>
          )}
        >
          {content}
        </QueryView>
      )}

      <EmployeeVacationPanel
        open={panelOpen}
        employeeId={employeeId}
        launching={launching}
        name={who}
        role={role}
        today={today}
        onPick={(id) => setUrl({ employeeId: id })}
        onClose={closePanel}
      />

      <ConfirmDialog
        open={decision?.kind === 'approve'}
        onOpenChange={(o) => { if (!o) setDecision(null); }}
        title={COPY.approveTitle}
        description={decision?.row.exceedsLimit ? COPY.approveWarn(decision.max) : COPY.approveOk}
        confirmLabel={COPY.approve}
        onConfirm={() => (decision ? doApprove(decision.row) : Promise.resolve())}
      />
      <ConfirmDialog
        open={decision?.kind === 'reject'}
        onOpenChange={(o) => { if (!o) setDecision(null); }}
        title={COPY.rejectTitle}
        description="O motivo é registrado e enviado ao colaborador."
        confirmLabel="Recusar"
        tone="danger"
        reason={{ label: COPY.rejectReason, min: 3, max: 500 }}
        onConfirm={(reason) => (decision ? doReject(decision.row, reason ?? '') : Promise.resolve())}
      />
    </PageHeader>
  );
}
