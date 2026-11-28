'use client';
/**
 * Escalas (rh edita; admin só lê). [SEM DESIGN] segue o padrão da Apuração: cabeçalho, abas, tabela e painel.
 * Avisos de jornada (`warnings`) só sinalizam e nunca bloqueiam (RN06, art. 74): o texto e os números vêm da api.
 * `?aviso=` (URL) pré-filtra as escalas com aquele aviso; o alerta da visão geral aponta para cá.
 * Lacuna: a listagem não traz avisos, então cada escala é lida em detalhe (ver hooks.ts).
 * Escala semanal: posição 0 = domingo ... 6 = sábado (schedules/rules/day-schedule.ts). Cíclica: "Dia N" do ciclo.
 * Inativa não recebe vínculo novo; quem já está nela continua (desativar não apaga nada).
 */
import { CalendarCheck, Plus, WarningCircle } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { QueryView } from '@/components/ui/QueryView';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, ForbiddenState, NotFoundState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { CycleType, Schedule, ScheduleType, ScheduleWarning } from '@/lib/api/contracts';
import { parseRouteId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { formatDate, formatMinutes } from '@/lib/format';
import { CYCLE_TYPE, SCHEDULE_TYPE, SCHEDULE_WARNING_CODE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { useTextSearch } from '@/lib/use-debounced-value';
import { AssignSchedulePanel } from './AssignSchedulePanel';
import { COPY, WARNING_FILTERS, type WarningFilter } from './copy';
import { ScheduleFormPanel } from './ScheduleFormPanel';
import { useSchedules, useUpdateSchedule } from './hooks';
import { asApiError } from '@/lib/api/errors';
import { notify } from '@/components/ui/notify';
import { useApiQuery } from '@/lib/query/hooks';

const typeLabel = (t: string) => SCHEDULE_TYPE[t as ScheduleType]?.label ?? t;
const cycleLabel = (s: Pick<Schedule, 'cycleType' | 'cycleDays'>) =>
  `${CYCLE_TYPE[s.cycleType as CycleType]?.label ?? s.cycleType}${s.cycleDays ? ` · ${s.cycleDays} dias` : ''}`;

function describeWarning(w: ScheduleWarning): string {
  const from = `a partir de ${formatDate(w.ruleValidFrom)}`;
  if (w.code === 'carga_semanal_acima_limite' && w.plannedMinutes !== undefined && w.maxMinutes !== undefined) {
    return `Carga prevista de ${formatMinutes(w.plannedMinutes)} por semana, acima do limite de ${formatMinutes(w.maxMinutes)} (${from}).`;
  }
  if (w.code === 'folgas_abaixo_minimo' && w.restDays !== undefined && w.minRestDays !== undefined) {
    return `${w.restDays} folga(s) no ciclo, abaixo do mínimo de ${w.minRestDays} (${from}).`;
  }
  return `Vale ${from}.`;
}

export function SchedulesScreen() {
  const { me } = useSession();
  const role = me.role;
  const allowed = can(role, 'schedule.view');
  const canEdit = can(role, 'schedule.edit');
  const [url, setUrl] = useUrlState(['aviso', 'id'] as const);
  const filter = oneOf<WarningFilter>(url.aviso, WARNING_FILTERS, 'todas');
  const selectedRaw = url.id;
  const selectedId = selectedRaw ? parseRouteId(selectedRaw) : null;

  const [editing, setEditing] = useState<Schedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const { text, setText, q, typing } = useTextSearch(() => setUrl({ id: null }));
  const query = useSchedules(allowed, q);

  const columns = useMemo<ColumnDef<Schedule, never>[]>(() => [
    { id: 'name', header: 'Escala', cell: ({ row }) => <span className="font-semibold">{row.original.name}</span> },
    { id: 'type', header: 'Tipo', cell: ({ row }) => typeLabel(row.original.type) },
    { id: 'cycle', header: 'Ciclo', cell: ({ row }) => cycleLabel(row.original) },
    { id: 'weekly', header: 'Carga semanal', cell: ({ row }) => <span className="tabular-nums">{formatMinutes(row.original.weeklyMinutes)}</span> },
    { id: 'active', header: 'Situação', cell: ({ row }) => <StatusBadge tone={row.original.isActive ? 'good' : 'neutral'} label={row.original.isActive ? 'Ativa' : 'Inativa'} /> },
    {
      id: 'warnings',
      header: 'Avisos',
      cell: ({ row }) => row.original.warnings.length === 0
        ? <span className="text-muted">Nenhum</span>
        : <span className="flex flex-wrap gap-1">{row.original.warnings.map((w) => <StatusBadge key={`${w.code}-${w.ruleValidFrom}`} tone={SCHEDULE_WARNING_CODE[w.code].tone} label={SCHEDULE_WARNING_CODE[w.code].label} />)}</span>,
    },
  ], []);

  if (!allowed) {
    return (
      <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
        <ForbiddenState screen="Escalas" />
      </PageHeader>
    );
  }

  const all = query.data ?? [];
  const visible = filter === 'todas' ? all : all.filter((s) => s.warnings.some((w) => w.code === filter));
  const selected = selectedId ? all.find((s) => s.id === selectedId) : undefined;
  const count = (code: WarningFilter) => (code === 'todas' ? all.length : all.filter((s) => s.warnings.some((w) => w.code === code)).length);

  return (
    <PageHeader
      title={COPY.title}
      subtitle={COPY.subtitle}
      controls={canEdit ? <Button variant="secondary" onClick={() => setAssigning(true)}>{COPY.assign}</Button> : undefined}
      primary={canEdit ? <Button variant="accent" icon={<Plus size={18} weight="bold" aria-hidden />} onClick={() => setCreating(true)}>{COPY.newSchedule}</Button> : undefined}
    >
      <CountTabs<WarningFilter>
        label={COPY.filterLabel}
        value={filter}
        onChange={(v) => setUrl({ aviso: v === 'todas' ? null : v, id: null })}
        items={[
          { value: 'todas', label: 'Todas', count: query.data ? count('todas') : undefined },
          { value: 'carga_semanal_acima_limite', label: SCHEDULE_WARNING_CODE.carga_semanal_acima_limite.label, count: query.data ? count('carga_semanal_acima_limite') : undefined },
          { value: 'folgas_abaixo_minimo', label: SCHEDULE_WARNING_CODE.folgas_abaixo_minimo.label, count: query.data ? count('folgas_abaixo_minimo') : undefined },
        ]}
      />
      <SearchBar label={COPY.searchLabel} placeholder="Buscar escala pelo nome" text={text} onTextChange={setText} searching={typing || query.isPlaceholderData} />
      <p className="m-0 text-xs text-muted">{COPY.warningsNote}</p>
      <QueryView
        query={query}
        what="as escalas"
        loading={<DataTable<Schedule> columns={columns} data={[]} getRowId={(s) => s.id} loadingRows={5} caption={COPY.tableCaption} />}
        isEmpty={(list) => list.length === 0}
        empty={(
          <div className="flex flex-col items-center gap-3">
            {q ? <EmptyState icon={CalendarCheck} title={noResultsTitle(q)} text={COPY.emptySearchText} /> : <EmptyState icon={CalendarCheck} {...COPY.empty} />}
            {canEdit && !q && <Button variant="secondary" onClick={() => setCreating(true)}>{COPY.newSchedule}</Button>}
          </div>
        )}
      >
        {() => (
          <DataTable<Schedule>
            columns={columns}
            data={visible}
            getRowId={(s) => s.id}
            caption={COPY.tableCaption}
            selectedId={selected?.id ?? null}
            rowLabel={(s) => `Abrir a escala ${s.name}`}
            onRowClick={(s) => setUrl({ id: s.id })}
            empty={<EmptyState icon={CalendarCheck} {...COPY.emptyFilter} />}
          />
        )}
      </QueryView>

      <SidePanel
        open={Boolean(selectedRaw) && !editing}
        onOpenChange={(o) => { if (!o) setUrl({ id: null }); }}
        title={selected?.name ?? 'Escala'}
        description={selected ? `${typeLabel(selected.type)} · ${cycleLabel(selected)}` : undefined}
        width="lg"
        footer={selected && canEdit ? (
          <>
            <ToggleActiveButton schedule={selected} />
            <Button variant="secondary" onClick={() => setEditing(selected)}>Editar escala</Button>
          </>
        ) : undefined}
      >
        {!selectedId || !selected ? <NotFoundState onBack={() => setUrl({ id: null })} /> : <ScheduleDetail schedule={selected} />}
      </SidePanel>

      <ScheduleFormPanel open={creating || editing !== null} schedule={editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} />
      <AssignSchedulePanel open={assigning} onOpenChange={setAssigning} schedules={all.filter((s) => s.isActive)} defaultScheduleId={selected?.isActive ? selected.id : undefined} />
    </PageHeader>
  );
}

function ScheduleDetail({ schedule }: { schedule: Schedule }) {
  return (
    <div className="flex flex-col gap-5">
      <KeyValueList
        items={[
          { label: 'Tipo', value: typeLabel(schedule.type) },
          { label: 'Ciclo', value: cycleLabel(schedule) },
          ...(schedule.referenceDate ? [{ label: 'Data de referência', value: formatDate(schedule.referenceDate) }] : []),
          { label: 'Carga semanal', value: <span className="tabular-nums">{formatMinutes(schedule.weeklyMinutes)}</span> },
          { label: 'Situação', value: schedule.isActive ? 'Ativa' : 'Inativa: não recebe vínculo novo' },
        ]}
      />
      <MembersSection scheduleId={schedule.id} />
      <section aria-label="Avisos da escala" className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-bold">Avisos</h3>
        {schedule.warnings.length === 0 ? (
          <p className="m-0 text-sm text-muted">Nenhum aviso para esta escala.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {schedule.warnings.map((w) => (
              <li key={`${w.code}-${w.ruleValidFrom}`} className="flex items-start gap-2 rounded-md border border-line bg-warn-bg px-3 py-2 text-sm text-warn">
                <WarningCircle size={18} weight="fill" aria-hidden className="mt-px shrink-0" />
                <span><strong>{SCHEDULE_WARNING_CODE[w.code].label}.</strong> {describeWarning(w)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-xs text-muted">{COPY.warningsNote}</p>
      </section>
      <section aria-label="Dias da escala" className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-bold">Dias</h3>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {[...schedule.days].sort((a, b) => a.position - b.position).map((d) => (
            <li key={d.position} className="flex items-center justify-between gap-3 border-b border-line-soft py-1.5 last:border-b-0">
              <span className="font-medium">{dayLabel(schedule, d.position)}</span>
              {d.isDayOff ? <span className="text-muted">Folga</span> : (
                <span className="tabular-nums">
                  {d.startTime} às {d.endTime}
                  {d.breakStartTime && d.breakEndTime ? ` · intervalo ${d.breakStartTime} às ${d.breakEndTime}` : ''}
                  {d.crossesMidnight ? ' · vira a meia-noite' : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const dayLabel = (s: Pick<Schedule, 'cycleType'>, position: number) =>
  s.cycleType === 'semanal' ? (WEEKDAYS[position] ?? `Dia ${position + 1}`) : `Dia ${position + 1} do ciclo`;

function ToggleActiveButton({ schedule }: { schedule: Schedule }) {
  const update = useUpdateSchedule();
  const next = !schedule.isActive;
  return (
    <Button
      variant="ghost"
      loading={update.isPending}
      onClick={() => {
        update.mutateAsync({ id: schedule.id, body: { isActive: next } }).then(
          () => notify.success(next ? 'Escala reativada' : 'Escala desativada', next ? undefined : 'Quem já está nela continua; ela só não recebe vínculo novo.'),
          (e: unknown) => notify.error(asApiError(e)),
        );
      }}
    >
      {next ? 'Reativar' : 'Desativar'}
    </Button>
  );
}

function MembersSection({ scheduleId }: { scheduleId: string }) {
  const q = useApiQuery('schedules', { members: scheduleId }, (api, signal) => api.schedules.members(scheduleId, signal));
  return (
    <section aria-label="Quem está nesta escala" className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-bold">Quem está nesta escala hoje</h3>
      <QueryView query={q} what="os colaboradores da escala" loading={<p className="m-0 text-sm text-muted">Carregando…</p>} isEmpty={(d) => d.length === 0} empty={<p className="m-0 text-sm text-muted">Ninguém nesta escala hoje.</p>}>
        {(rows) => (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {rows.map((m) => (
              <li key={m.assignmentId} className="flex items-center justify-between gap-3 border-b border-line-soft py-1.5 last:border-b-0">
                <span className="font-medium">{m.name}{m.registration ? <span className="text-muted"> · {m.registration}</span> : null}</span>
                <span className="text-xs text-muted tabular-nums">desde {formatDate(m.validFrom)}{m.validTo ? ` até ${formatDate(m.validTo)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </section>
  );
}
