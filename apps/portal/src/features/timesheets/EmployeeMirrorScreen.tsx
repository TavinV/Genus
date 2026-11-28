'use client';
/**
 * Espelho do colaborador (mapa §4.3). Visão resolvida do back: a marcação original nunca é trocada na
 * tela; a tratada aparece ACRESCENTADA com a marca "ajustada". Os totais do período são soma simples
 * dos minutos que a api entregou, só para exibir (arquitetura §4).
 * [A CONFIRMAR] PDF do espelho e saldo do banco do período aberto: `pdfUrl` é nulo hoje (mapa §6 #13).
 */
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowClockwise, CalendarCheck, FilePdf, PencilSimpleLine } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { AbsencesSection } from '@/features/absences/AbsencesSection';
import { DayTimeline } from '@/components/domain/DayTimeline';
import { Minutes } from '@/components/domain/Minutes';
import { PunchChips } from '@/components/domain/PunchChips';
import { PageHeader } from '@/components/shell/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { notify } from '@/components/ui/notify';
import { PendingBackTooltip } from '@/components/ui/PendingBackTooltip';
import { PeriodPicker, type Period } from '@/components/ui/PeriodPicker';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, ForbiddenState, LoadingState, NotFoundState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EntityId, RecalculateResult, TimesheetDay } from '@/lib/api/contracts';
import { parseRouteId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { DEFAULT_TZ, formatDate, formatMinutes, formatTime, monthOf, plural, todayCivil } from '@/lib/format';
import { ISSUE_TYPE, PUNCH_ORIGIN, RECALCULATE_SKIP_REASON, TIMESHEET_DAY_STATUS } from '@/lib/labels';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { useUrlState } from '@/lib/url-state';
import { COPY, situationLabel } from './copy';
import { LinkButton } from './LinkButton';

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** Rota `/rh/colaboradores/[id]`: `rawId` é o `params.id` cru; inválido → "não encontrado" sem chamar a api. */
export function EmployeeMirrorScreen({ rawId }: { rawId: string | string[] | undefined }) {
  const { me } = useSession();
  const id = parseRouteId(rawId);
  const allowed = can(me.role, 'timesheet.view');
  const employee = useApiQuery('employees', { id }, (api, signal) => api.employees.get(id as EntityId, signal), { enabled: id !== null && allowed });

  if (!allowed) return <ForbiddenState screen="Espelho do colaborador" />;
  if (id === null) {
    return (
      <PageHeader title="Espelho do colaborador">
        <NotFoundState />
      </PageHeader>
    );
  }
  return (
    <QueryView
      query={employee}
      what="o colaborador"
      loading={<PageHeader title="Espelho do colaborador"><LoadingState label="Carregando o colaborador…" /></PageHeader>}
    >
      {(e) => <MirrorBody id={id} name={e.name} registrationNumber={e.registrationNumber} admissionDate={e.admissionDate} />}
    </QueryView>
  );
}

const sum = (days: TimesheetDay[], pick: (d: TimesheetDay) => number) => days.reduce((acc, d) => acc + pick(d), 0);
const Cell = ({ value }: { value: number }) => (value > 0 ? <Minutes value={value} /> : <span className="text-muted">—</span>);

function MirrorBody({ id, name, registrationNumber, admissionDate }: { id: EntityId; name: string; registrationNumber: string | null; admissionDate: string }) {
  const { me } = useSession();
  const clock = useClock();
  const today = todayCivil(clock);
  const [url, setUrl] = useUrlState(['from', 'to', 'dia'] as const);
  const [lastResult, setLastResult] = useState<RecalculateResult | null>(null);

  const valid = url.from !== null && url.to !== null && CIVIL.test(url.from) && CIVIL.test(url.to) && url.from <= url.to;
  const period: Period = valid ? { from: url.from as string, to: url.to as string } : { from: `${monthOf(today)}-01`, to: today };
  const selectedDate = url.dia && CIVIL.test(url.dia) ? url.dia : null;

  const q = useApiQuery('timesheets', { employeeId: id, from: period.from, to: period.to }, (api, signal) => api.timesheets.byEmployee(id, period, signal));
  const recalc = useApiMutation((api, _: void) => api.timesheets.recalculate(id, period), {
    invalidates: ['timesheets', 'day'],
    onSuccess: (r) => {
      setLastResult(r);
      notify.success('Dias recalculados', skippedText(r) ?? 'As marcações originais não mudam.');
    },
    onError: (e) => notify.error(e),
  });

  const columns = useMemo<ColumnDef<TimesheetDay, never>[]>(
    () => [
      {
        id: 'date',
        header: 'Dia',
        cell: ({ row: { original: d } }) => (
          <div className="flex flex-col">
            <span className="font-semibold tabular-nums">{formatDate(d.date, 'weekday')}</span>
            <span className="text-xs text-muted">{situationLabel(d.situation)}</span>
          </div>
        ),
      },
      { id: 'punches', header: 'Marcações', cell: ({ row: { original: d } }) => <PunchChips punches={d.punches} tz={DEFAULT_TZ} /> },
      { id: 'expected', header: 'Previsto', cell: ({ row: { original: d } }) => <Cell value={d.expectedMinutes} /> },
      { id: 'worked', header: 'Trabalhado', cell: ({ row: { original: d } }) => <Cell value={d.workedMinutes} /> },
      { id: 'absence', header: 'Falta', cell: ({ row: { original: d } }) => <Cell value={d.absenceMinutes} /> },
      { id: 'late', header: 'Atraso', cell: ({ row: { original: d } }) => <Cell value={d.lateMinutes} /> },
      { id: 'ot50', header: 'Extra 50%', cell: ({ row: { original: d } }) => <Cell value={d.overtime50Minutes} /> },
      { id: 'ot100', header: 'Extra 100%', cell: ({ row: { original: d } }) => <Cell value={d.overtime100Minutes} /> },
      { id: 'night', header: 'Noturno', cell: ({ row: { original: d } }) => <Cell value={d.nightMinutes} /> },
      { id: 'break', header: 'Intervalo', cell: ({ row: { original: d } }) => <Cell value={d.breakMinutes} /> },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row: { original: d } }) => {
          const s = TIMESHEET_DAY_STATUS[d.status];
          return (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge label={s.label} tone={s.tone} />
              {d.issues.map((i) => (
                <span key={i.type} className="text-xs text-muted">
                  {ISSUE_TYPE[i.type].label}
                  {i.resolved && <span className="ml-1 font-semibold text-good">Resolvido</span>}
                </span>
              ))}
            </div>
          );
        },
      },
    ],
    [],
  );

  const canRecalc = can(me.role, 'timesheet.recalculate');
  const canAdjust = can(me.role, 'adjustment.create');
  const adjustHref = (date: string) => `/rh/ajustes?employeeId=${encodeURIComponent(id)}&date=${date}&novo=1`;

  return (
    <PageHeader
      title={name}
      subtitle={[registrationNumber ? `Mat. ${registrationNumber}` : null, `admitido em ${formatDate(admissionDate)}`].filter(Boolean).join(' · ')}
      controls={
        <>
          <PeriodPicker value={period} onChange={(p) => setUrl({ from: p.from, to: p.to, dia: null })} />
          <PendingBackTooltip>
            <Button variant="secondary" disabled aria-describedby="pdf-note" icon={<FilePdf size={18} aria-hidden />}>Gerar espelho em PDF</Button>
          </PendingBackTooltip>
          {canAdjust && <LinkButton href={adjustHref(period.to)} icon={<PencilSimpleLine size={18} aria-hidden />}>Registrar ajuste do dia</LinkButton>}
        </>
      }
      primary={
        canRecalc ? (
          <Button variant="accent" loading={recalc.isPending} icon={<ArrowClockwise size={18} aria-hidden />} onClick={() => recalc.mutate()}>
            Recalcular
          </Button>
        ) : undefined
      }
    >
      <div className="flex items-center gap-3 rounded-card border border-line bg-white p-4 shadow-card">
        <Avatar name={name} size="lg" />
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-bold">{name}</span>
          <span className="text-sm text-muted">Período de {formatDate(period.from)} a {formatDate(period.to)}</span>
        </div>
      </div>
      <p id="pdf-note" className="m-0 text-xs text-muted">{COPY.pdfPending}</p>

      {lastResult && (
        <div role="status" className="rounded-md border border-line bg-tint px-4 py-3 text-sm">
          <strong>{plural(lastResult.days.length, 'dia recalculado', 'dias recalculados')}.</strong> As marcações originais não mudam.
          {lastResult.skipped.length > 0 && <p className="m-0 mt-1 text-warn">{skippedText(lastResult)}</p>}
        </div>
      )}

      <QueryView
        query={q}
        what="o espelho"
        loading={<DataTable caption="Carregando o espelho" columns={columns} data={[]} getRowId={(d) => d.date} loadingRows={8} />}
        isEmpty={(d) => d.length === 0}
        empty={
          <div className="flex flex-col items-center gap-4">
            <EmptyState icon={CalendarCheck} title="Nenhum dia apurado neste período" text="Não há apuração para este colaborador entre as datas escolhidas. Escolha outro período ou confira a escala." />
            <LinkButton href="/rh/apuracao">Ver apuração do dia</LinkButton>
          </div>
        }
      >
        {(days) => (
          <>
            <DataTable
              caption={`Espelho de ${name}`}
              columns={columns}
              data={days}
              getRowId={(d) => d.date}
              selectedId={selectedDate}
              onRowClick={(d) => setUrl({ dia: d.date })}
              rowLabel={(d) => `Ver detalhes de ${formatDate(d.date)}`}
              footer={<Totals days={days} />}
            />
            <DayDetail
              day={days.find((d) => d.date === selectedDate) ?? null}
              onClose={() => setUrl({ dia: null })}
              adjustHref={canAdjust ? adjustHref : null}
            />
          </>
        )}
      </QueryView>

      <AbsencesSection employeeId={id} />
    </PageHeader>
  );
}

function skippedText(r: RecalculateResult): string | null {
  if (r.skipped.length === 0) return null;
  const shown = r.skipped.slice(0, 5).map((s) => `${formatDate(s.date, 'dayMonth')}: ${RECALCULATE_SKIP_REASON[s.reason].label}`);
  const more = r.skipped.length - shown.length;
  return `${plural(r.skipped.length, 'dia sem cálculo', 'dias sem cálculo')}. ${shown.join('; ')}${more > 0 ? `; e mais ${more}` : ''}`;
}

function Totals({ days }: { days: TimesheetDay[] }) {
  const items: [string, number][] = [
    ['Previsto', sum(days, (d) => d.expectedMinutes)],
    ['Trabalhado', sum(days, (d) => d.workedMinutes)],
    ['Falta', sum(days, (d) => d.absenceMinutes)],
    ['Atraso', sum(days, (d) => d.lateMinutes)],
    ['Extra 50%', sum(days, (d) => d.overtime50Minutes)],
    ['Extra 100%', sum(days, (d) => d.overtime100Minutes)],
    ['Noturno', sum(days, (d) => d.nightMinutes)],
  ];
  return (
    <section aria-label={COPY.periodTotalsLabel} className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-bold">{COPY.periodTotalsLabel}</h2>
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2">
        {items.map(([label, v]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums"><Minutes value={v} /></dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-xs text-muted">{COPY.periodTotalsNote}</p>
    </section>
  );
}

function DayDetail({ day, onClose, adjustHref }: { day: TimesheetDay | null; onClose: () => void; adjustHref: ((date: string) => string) | null }) {
  return (
    <SidePanel
      open={day !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={day ? `Dia ${formatDate(day.date, 'short')}` : 'Dia'}
      description={day ? situationLabel(day.situation) : undefined}
      width="md"
    >
      {day && (
        <div className="flex flex-col gap-5">
          <DayTimeline punches={day.punches} tz={DEFAULT_TZ} />
          <section aria-label="Marcações do dia" className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-bold">Marcações</h3>
            {day.punches.length === 0 && <p className="m-0 text-sm text-muted">Sem marcações neste dia.</p>}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {day.punches.map((p) => (
                <li key={p.sequence} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold tabular-nums">{formatTime(p.at, DEFAULT_TZ)}</span>
                  <StatusBadge label={PUNCH_ORIGIN[p.origin].label} tone={PUNCH_ORIGIN[p.origin].tone} />
                  {p.nsr !== null && <span className="text-xs text-muted tabular-nums">NSR {p.nsr}</span>}
                </li>
              ))}
            </ul>
            {day.punches.some((p) => p.origin === 'tratada') && (
              <p className="m-0 text-xs text-muted">Marcação tratada foi acrescentada por ajuste aprovado. A original continua registrada e não foi alterada.</p>
            )}
          </section>
          <KeyValueList
            items={[
              { label: 'Previsto', value: formatMinutes(day.expectedMinutes) },
              { label: 'Trabalhado', value: formatMinutes(day.workedMinutes) },
              { label: 'Versão dos parâmetros', value: day.parameterVersion },
            ]}
          />
          {adjustHref && <LinkButton href={adjustHref(day.date)} icon={<PencilSimpleLine size={18} aria-hidden />}>Registrar ajuste deste dia</LinkButton>}
        </div>
      )}
    </SidePanel>
  );
}
