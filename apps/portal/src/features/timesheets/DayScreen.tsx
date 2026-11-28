'use client';
/**
 * Escala e apuração do dia (mapa §4.4). Lista o dia de todos os colaboradores do estabelecimento
 * (api.timesheets.day): o front mostra o que a api devolve, sem calcular extra, falta nem status.
 * "Recalcular dia" (rh) pede à api para refazer o dia de todos; as marcações originais não mudam.
 */
import { keepPreviousData } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowClockwise, CaretLeft, CaretRight, FingerprintSimple, FunnelSimpleX } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { SelectField } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { Pagination } from '@/components/ui/Pagination';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, ForbiddenState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Minutes } from '@/components/domain/Minutes';
import { PunchChips } from '@/components/domain/PunchChips';
import type { DayRecalculateBody, DayRecalculateResult, DayRow, DayRowPage, TimesheetDayStatus } from '@/lib/api/contracts';
import { isEntityId } from '@/lib/api/ids';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { addCivilDays, DEFAULT_TZ, formatDate, plural, todayCivil } from '@/lib/format';
import { daySituationLabel, ISSUE_TYPE, TIMESHEET_DAY_STATUS } from '@/lib/labels';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { useTextSearch } from '@/lib/use-debounced-value';
import { ABSENCE_LABEL, COPY, emptyDayTitle, recalculatedText, skippedTitle } from './copy';
import { DayRecalcNotice } from './DayRecalcNotice';
import { LinkButton } from './LinkButton';

const TABS = ['todos', 'inconsistente', 'falta', 'calculada'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { todos: 'Todos', inconsistente: 'Inconsistentes', falta: 'Faltas', calculada: 'Calculadas' };
const PAGE_SIZE = 25;
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const ALL = 'all';

const hasOpenExtraFlag = (r: DayRow) => r.issues.some((i) => i.type === 'extra_acima_2h' && !i.resolved);

function useColumns(): ColumnDef<DayRow, never>[] {
  return useMemo<ColumnDef<DayRow, never>[]>(
    () => [
      {
        id: 'employee',
        header: 'Colaborador',
        cell: ({ row: { original: r } }) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={r.employeeName} />
            <div className="flex flex-col">
              <span className="font-semibold">{r.employeeName}</span>
              {r.registrationNumber && <span className="text-xs text-muted tabular-nums">Mat. {r.registrationNumber}</span>}
            </div>
          </div>
        ),
      },
      {
        id: 'department',
        header: 'Setor e cargo',
        cell: ({ row: { original: r } }) => (
          <div className="flex flex-col">
            <span className="text-ink-2">{r.departmentName ?? '—'}</span>
            {r.jobTitleName && <span className="text-xs text-muted">{r.jobTitleName}</span>}
          </div>
        ),
      },
      { id: 'punches', header: 'Marcações', cell: ({ row: { original: r } }) => <PunchChips punches={r.punches} tz={DEFAULT_TZ} /> },
      { id: 'expected', header: 'Previsto', cell: ({ row: { original: r } }) => (r.expectedMinutes > 0 ? <Minutes value={r.expectedMinutes} /> : <span className="text-muted">—</span>) },
      { id: 'worked', header: 'Trabalhado', cell: ({ row: { original: r } }) => (r.punches.length > 0 ? <Minutes value={r.workedMinutes} /> : <span className="text-muted">—</span>) },
      {
        id: 'overtime',
        header: 'Extra',
        // O destaque vem da inconsistência `extra_acima_2h` que a api aponta: o front não compara minutos.
        cell: ({ row: { original: r } }) =>
          r.overtimeMinutes > 0 ? <Minutes value={r.overtimeMinutes} emphasis={hasOpenExtraFlag(r) ? 'warn' : 'none'} /> : <span className="text-muted">—</span>,
      },
      {
        id: 'absence',
        header: 'Falta',
        cell: ({ row: { original: r } }) => (r.absenceMinutes > 0 ? <Minutes value={r.absenceMinutes} emphasis="warn" /> : <span className="text-muted">—</span>),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row: { original: r } }) => {
          const s = r.isAbsence
            ? ABSENCE_LABEL
            : r.status === 'calculada' && r.situation !== 'normal'
              ? daySituationLabel(r.situation)
              : TIMESHEET_DAY_STATUS[r.status];
          return (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge label={s.label} tone={s.tone} />
              {r.issues.map((i) => (
                <span key={i.type} className="text-xs text-muted">
                  {ISSUE_TYPE[i.type].label}
                  {i.resolved ? ' (resolvido)' : ''}
                </span>
              ))}
            </div>
          );
        },
      },
    ],
    [],
  );
}

export function DayScreen() {
  const { me, establishment } = useSession();
  const router = useRouter();
  const clock = useClock();
  const today = todayCivil(clock);
  const [url, setUrl] = useUrlState(['date', 'departmentId', 'aba', 'page'] as const);
  // Busca por texto: só em memória (nome e matrícula não vão para a URL); a api filtra (`q`, com debounce).
  const search = useTextSearch(() => setUrl({ page: null }));

  const date = url.date && CIVIL.test(url.date) ? url.date : today;
  const aba = oneOf<Tab>(url.aba, TABS, 'todos');
  const departmentId = url.departmentId && isEntityId(url.departmentId) ? url.departmentId : null;
  const page = Math.max(1, Number.parseInt(url.page ?? '1', 10) || 1);
  const allowed = can(me.role, 'nav.timesheets');
  const hasEstablishment = establishment.id !== '';
  const enabled = allowed && hasEstablishment;

  const departments = useApiQuery('org', { departments: establishment.id }, (api, signal) => api.org.departments(establishment.id, signal), { enabled });
  const status: TimesheetDayStatus | 'falta' | undefined = aba === 'todos' ? undefined : aba;
  const q = useApiQuery(
    'day',
    { date, establishmentId: establishment.id, departmentId, status, page, q: search.q },
    (api, signal) => api.timesheets.day({ date, establishmentId: establishment.id, departmentId: departmentId ?? undefined, status, q: search.q, page, pageSize: PAGE_SIZE }, signal),
    { enabled, placeholderData: keepPreviousData },
  );
  const columns = useColumns();

  // O resultado guarda o dia e o estabelecimento pedidos: ao trocar de dia, o aviso não aparece no dia errado.
  const [lastRecalc, setLastRecalc] = useState<(DayRecalculateBody & { result: DayRecalculateResult }) | null>(null);
  const recalculation = useApiMutation((api, body: DayRecalculateBody) => api.timesheets.recalculateDay(body), {
    invalidates: ['day', 'timesheets', 'timeBank'],
    onSuccess: (result, body) => {
      setLastRecalc({ ...body, result });
      const skipped = result.skipped.length > 0 ? ` · ${skippedTitle(result.skipped.length)}` : '';
      notify.success(COPY.recalcDayDone, `${recalculatedText(result.recalculated)}${skipped}`);
    },
    onError: (e) => notify.error(e),
  });
  const shownRecalc = lastRecalc && lastRecalc.date === date && lastRecalc.establishmentId === establishment.id ? lastRecalc : null;

  if (!allowed) return <ForbiddenState screen="Escala e apuração" />;

  const canRecalc = can(me.role, 'timesheet.recalculate');
  const canSchedules = can(me.role, 'schedule.view');
  const counts = q.data?.counts;
  const tabs = TABS.map((t) => ({
    value: t,
    label: TAB_LABEL[t],
    count: counts?.[t],
    attention: t === 'inconsistente' && (counts?.inconsistente ?? 0) > 0,
  }));
  const open = (r: DayRow) => router.push(`/rh/colaboradores/${encodeURIComponent(r.employeeId)}?from=${date}&to=${date}`);
  const departmentOptions = [{ value: ALL, label: 'Todos os setores' }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))];

  const navigator = (
    <div role="group" aria-label="Navegar entre os dias" className="flex items-center gap-1">
      <Button variant="secondary" aria-label="Dia anterior" icon={<CaretLeft size={18} aria-hidden />} onClick={() => setUrl({ date: addCivilDays(date, -1), page: null })} />
      <Button variant="secondary" disabled={date === today} onClick={() => setUrl({ date: null, page: null })}>Hoje</Button>
      <Button variant="secondary" aria-label="Próximo dia" disabled={date >= today} icon={<CaretRight size={18} aria-hidden />} onClick={() => setUrl({ date: addCivilDays(date, 1), page: null })} />
    </div>
  );

  const recalc = canRecalc ? (
    <Button
      variant="accent"
      loading={recalculation.isPending}
      disabled={!hasEstablishment || date > today}
      icon={<ArrowClockwise size={18} aria-hidden />}
      onClick={() => {
        setLastRecalc(null);
        recalculation.mutate({ establishmentId: establishment.id, date });
      }}
    >
      {COPY.recalcDay}
    </Button>
  ) : undefined;

  const emptyDay = (
    <div className="flex flex-col items-center gap-4">
      <EmptyState
        icon={FingerprintSimple}
        title={emptyDayTitle(formatDate(date, 'dayMonth'))}
        text="Nenhum colaborador deste estabelecimento registrou ponto neste dia. Se for folga coletiva ou feriado local, não há nada a fazer."
      />
      {canSchedules && <LinkButton href="/rh/escalas">Ver escala do dia</LinkButton>}
    </div>
  );

  const emptySearch = (
    <EmptyState icon={FingerprintSimple} title={noResultsTitle(search.q ?? '')} text="Confira a grafia ou busque pela matrícula. Limpe o campo para ver todos." />
  );

  const clearFilters = () => {
    search.setText('');
    setUrl({ aba: null, departmentId: null, page: null });
  };

  const renderTable = (data: DayRowPage) => {
    return (
      <>
        <DataTable
          caption={`Apuração de ${formatDate(date)}`}
          columns={columns}
          data={data.data}
          getRowId={(r) => r.employeeId}
          onRowClick={open}
          rowLabel={(r) => `Abrir espelho de ${r.employeeName}`}
          empty={
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <FunnelSimpleX size={28} aria-hidden className="text-muted" />
              <span className="font-semibold">Nenhum colaborador com esses filtros</span>
              <Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button>
            </div>
          }
          footer={
            <div className="flex flex-wrap justify-between gap-3 text-xs text-muted">
              <span className="tabular-nums">
                {plural(data.counts.todos, 'colaborador', 'colaboradores')} · {plural(data.counts.inconsistente, 'inconsistência', 'inconsistências')} para revisar antes do fechamento
              </span>
              <span>{COPY.originalNeverChanges}</span>
            </div>
          }
        />
        {data.meta.total > data.meta.pageSize && <Pagination meta={data.meta} onPageChange={(p) => setUrl({ page: p === 1 ? null : p })} />}
      </>
    );
  };

  return (
    <PageHeader
      title={COPY.dayTitle}
      subtitle={`${formatDate(date, 'long')} · horário de Brasília`}
      controls={
        <>
          {navigator}
          {canSchedules && <LinkButton href="/rh/escalas">{COPY.seeSchedules}</LinkButton>}
        </>
      }
      primary={recalc}
    >
      {!hasEstablishment ? (
        <EmptyState icon={FingerprintSimple} title={COPY.pickEstablishmentTitle} text={COPY.pickEstablishmentText} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4">
            <div className="min-w-[200px] flex-1 basis-48">
              <SelectField
                label="Setor"
                value={departmentId ?? ALL}
                options={departmentOptions}
                onValueChange={(v) => setUrl({ departmentId: v === ALL ? null : v, page: null })}
              />
            </div>
            <div className="min-w-[220px] flex-[2_1_260px]">
              <SearchBar
                className="max-w-none"
                label={COPY.searchLabel}
                placeholder="Nome ou matrícula"
                text={search.text}
                onTextChange={search.setText}
                searching={search.typing || q.isPlaceholderData}
              />
            </div>
          </div>
          {shownRecalc && <DayRecalcNotice date={shownRecalc.date} result={shownRecalc.result} />}
          <CountTabs label="Situação do dia" items={tabs} value={aba} onChange={(v) => setUrl({ aba: v === 'todos' ? null : v, page: null })} />
          <QueryView
            query={q}
            what="a apuração do dia"
            loading={<DataTable caption="Carregando a apuração" columns={columns} data={[]} getRowId={(r) => r.employeeId} loadingRows={6} />}
            isEmpty={(d) => d.counts.todos === 0}
            empty={search.q ? emptySearch : emptyDay}
          >
            {renderTable}
          </QueryView>
        </>
      )}
    </PageHeader>
  );
}
