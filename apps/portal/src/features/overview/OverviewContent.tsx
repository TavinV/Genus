'use client';
import { ChartLine } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shell/PageHeader';
import { useHeaderPeriod } from '@/components/shell/useHeaderPeriod';
import { AlertCard } from '@/components/ui/AlertCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { KpiCard } from '@/components/ui/KpiCard';
import { ComingSoonState, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/components/ui/States';
import { can } from '@/lib/auth/permissions';
import { isHiddenResource } from '@/lib/api/errors';
import { formatPeriod } from '@/lib/format';
import { useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { ALERT_ROUTE, COPY } from './copy';
import { FeaturedKpiCard } from './FeaturedKpiCard';
import { HoursChart, IssuesChart, StatusBreakdown, TopOvertime } from './OverviewCharts';

/**
 * Visão geral do RH (G11): KPIs, gráficos e alertas vêm prontos da api (GET /portal/overview).
 * O período (URL `from`/`to`) vai para a api e entra na chave de cache. Empresa nova: estado vazio.
 */
export function OverviewContent() {
  const { me, establishment } = useSession();
  const router = useRouter();
  const { period, setPeriod } = useHeaderPeriod();
  const allowed = can(me.role, 'nav.overview');
  const q = useApiQuery(
    'overview',
    { establishmentId: establishment.id, from: period.from, to: period.to },
    (api, signal) => api.overview.get(establishment.id, { from: period.from, to: period.to }, signal),
    { enabled: allowed },
  );

  const forbidden = (
    <PageHeader title={COPY.title}><ForbiddenState screen={COPY.title} /></PageHeader>
  );
  if (!allowed) return forbidden;

  const header = {
    title: COPY.title,
    subtitle: `${formatPeriod(period.from, period.to)} · America/Sao_Paulo`,
    primary: <Button variant="accent" onClick={() => router.push(ALERT_ROUTE.apuracao)}>{COPY.primary}</Button>,
    periodValue: period,
    onPeriodChange: setPeriod,
  };

  if (q.isPending) return <PageHeader {...header}><LoadingState label={`Carregando dados de ${establishment.name}…`} /></PageHeader>;
  if (q.isError) {
    if (isHiddenResource(q.error)) return forbidden;
    if (q.error.kind === 'unavailable') return <PageHeader title={COPY.title}><ComingSoonState what="a visão geral" /></PageHeader>;
    return (
      <PageHeader {...header}>
        <ErrorState what="a visão geral" code={`Erro ${q.error.status || '—'} · ${q.error.code}`} onRetry={() => void q.refetch()} />
      </PageHeader>
    );
  }

  const { kpis, alerts, series, statusBreakdown, topOvertime, calculatedDays } = q.data;
  const alertsCard = (
    <Card as="section" className="flex min-w-0 flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{COPY.alertsTitle}</h2>
        <span className="text-xs font-semibold text-muted tabular-nums">{alerts.length} {alerts.length === 1 ? 'aberto' : 'abertos'}</span>
      </div>
      {alerts.length === 0 && <p className="m-0 text-sm text-muted">{COPY.alertsNone}</p>}
      {alerts.map((a) => <AlertCard key={a.id} alert={a} onAction={() => router.push(ALERT_ROUTE[a.target])} />)}
    </Card>
  );
  if (calculatedDays === 0) {
    return (
      <PageHeader {...header}>
        <EmptyState
          icon={ChartLine}
          title={COPY.emptyTitle}
          text={`Os gráficos aparecem quando houver colaboradores com escala e marcações apuradas em ${establishment.name}. Cadastre setores, cargos, colaboradores e escalas para começar.`}
        />
        {alerts.length > 0 && alertsCard}
      </PageHeader>
    );
  }
  return (
    <PageHeader {...header}>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {kpis.map((k) => (k.key === 'workedHours' ? <FeaturedKpiCard key={k.key} kpi={k} /> : <KpiCard key={k.key} kpi={k} />))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <HoursChart series={series} />
        {alertsCard}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <IssuesChart series={series} />
        <StatusBreakdown breakdown={statusBreakdown} />
        <TopOvertime top={topOvertime} />
      </div>
    </PageHeader>
  );
}
