'use client';
/**
 * Atestados (RH): fila à esquerda, detalhe à direita (abaixo de 1024 px, o detalhe abre num painel lateral).
 * Aba e item selecionado ficam na URL (`?aba=&id=`, ID opaco). Nome e matrícula vêm do cache de colaboradores.
 *
 * Abas: o design tem Recebidos / Em análise / Decididos, que NÃO são status da api (pendente | aprovado | recusado).
 * Derivar "Em análise" exige as análises de cada item (uma chamada por atestado, proibido: sem varredura).
 * Decisão: abas Pendentes / Decididos / Todos, agrupadas pelo status da api. A etapa derivada aparece só no detalhe
 * do item aberto (rh). [A CONFIRMAR] com o Gomes (docs/portal-mapa-front.md §8).
 */
import { ClipboardText } from '@phosphor-icons/react';
import { keepPreviousData } from '@tanstack/react-query';
import { PageHeader } from '@/components/shell/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CountTabs } from '@/components/ui/CountTabs';
import { QueryView } from '@/components/ui/QueryView';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, ForbiddenState, NotFoundState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { can } from '@/lib/auth/permissions';
import type { Certificate, CertificateRh } from '@/lib/api/contracts';
import { parseRouteId } from '@/lib/api/ids';
import { formatInstant, formatNumber } from '@/lib/format';
import { CERTIFICATE_STATUS } from '@/lib/labels';
import { useApiQuery } from '@/lib/query/hooks';
import { useEmployeeDirectory } from '@/lib/query/useEmployeeDirectory';
import { useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { useTextSearch } from '@/lib/use-debounced-value';
import { CertificateDetail, describeLeave } from './CertificateDetail';
import { COPY } from './copy';
import { useIsDesktop } from './useIsDesktop';

const TABS = ['pendentes', 'decididos', 'todos'] as const;
type Tab = (typeof TABS)[number];
type Item = Certificate | CertificateRh;

const inTab = (c: Item, tab: Tab) => (tab === 'todos' ? true : tab === 'pendentes' ? c.status === 'pendente' : c.status !== 'pendente');

function QueueSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-2">
        <Skeleton className="h-11 w-full" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3 rounded-card border border-line p-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3.5 w-1/2" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-2/3" /></div>
          </div>
        ))}
      </div>
      <div className="hidden min-w-0 flex-[1.6_1_480px] flex-col gap-4 rounded-card border border-line p-6 lg:flex">
        <Skeleton className="h-6 w-1/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export function CertificatesScreen() {
  const { me } = useSession();
  const role = me.role;
  const allowed = can(role, 'certificate.view');
  const desktop = useIsDesktop();
  const [url, setUrl] = useUrlState(['aba', 'id'] as const);
  const tab = oneOf(url.aba, TABS, 'pendentes');
  const directory = useEmployeeDirectory();

  const { text, setText, q, typing } = useTextSearch();

  const query = useApiQuery('certificates', { list: true, q }, (api, signal) => api.certificates.list({ q, pageSize: 100 }, signal), {
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

  if (!allowed) {
    return (
      <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
        <ForbiddenState screen="Atestados" />
      </PageHeader>
    );
  }

  const items: Item[] = query.data?.data ?? [];
  const pending = items.filter((c) => c.status === 'pendente');
  const selectedRaw = url.id;
  const selectedId = selectedRaw ? parseRouteId(selectedRaw) : null;
  const selected = selectedId ? items.find((c) => c.id === selectedId) : undefined;

  const pendingIndex = pending.findIndex((c) => c.id === selectedId);
  const next = pending.length === 0 || (pending.length === 1 && pendingIndex === 0) ? null : pending[(pendingIndex + 1) % pending.length];
  const openNext = () => {
    if (next) setUrl({ aba: 'pendentes', id: next.id });
  };

  const select = (id: string | null) => setUrl({ id });
  const empty = (t: Tab) => ({
    title: t === 'pendentes' ? 'Nenhum atestado pendente' : t === 'decididos' ? 'Nenhum atestado decidido ainda' : 'Nenhum atestado recebido',
    text: t === 'pendentes' ? 'Todos os atestados recebidos já foram decididos.' : t === 'decididos' ? 'As decisões aparecem aqui depois que o RH aprovar ou recusar.' : 'Os atestados enviados pelos colaboradores aparecem aqui.',
  });

  const detail = (showHeader: boolean) => {
    if (!selectedRaw) return null;
    if (!selectedId || !selected) return <NotFoundState onBack={() => select(null)} />;
    const who = directory.lookup(selected.employeeId);
    return (
      <CertificateDetail key={selected.id} certificate={selected} role={role} name={who.name} registration={who.registrationNumber} showHeader={showHeader} />
    );
  };

  const panelWho = selected ? directory.lookup(selected.employeeId) : null;

  return (
    <PageHeader
      title={COPY.title}
      subtitle={COPY.subtitle}
      primary={(
        <Button variant="accent" disabled={next === null} onClick={openNext}>{COPY.nextInQueue}</Button>
      )}
    >
      <SearchBar label={COPY.searchLabel} placeholder="Buscar por nome ou matrícula" text={text} onTextChange={setText} searching={typing || query.isPlaceholderData} />
      <QueryView query={query} what="os atestados" loading={<QueueSkeleton />}>
        {(page) => {
          const counts = { pendentes: pending.length, decididos: items.length - pending.length, todos: items.length };
          const visible = items.filter((c) => inTab(c, tab));
          return (
            <>
              <CountTabs<Tab>
                label="Status dos atestados"
                value={tab}
                onChange={(t) => setUrl({ aba: t, id: null })}
                items={[
                  { value: 'pendentes', label: 'Pendentes', count: counts.pendentes, attention: counts.pendentes > 0 },
                  { value: 'decididos', label: 'Decididos', count: counts.decididos },
                  { value: 'todos', label: 'Todos', count: counts.todos },
                ]}
              />
              {page.meta.total > items.length && (
                <p className="m-0 text-xs text-muted">Mostrando os {formatNumber(items.length)} mais recentes de {formatNumber(page.meta.total)}.</p>
              )}
              <div className="flex flex-wrap items-start gap-4">
                <section aria-label={COPY.queueLabel} className="flex min-w-0 flex-[1_1_340px] flex-col gap-2">
                  {visible.length === 0 ? (
                    <div className="flex flex-col items-center gap-3">
                      {q ? <EmptyState icon={ClipboardText} title={noResultsTitle(q)} text={COPY.emptySearchText} /> : <EmptyState icon={ClipboardText} {...empty(tab)} />}
                      {!q && tab !== 'todos' && (
                        <Button variant="secondary" onClick={() => setUrl({ aba: tab === 'pendentes' ? 'decididos' : 'pendentes', id: null })}>
                          {tab === 'pendentes' ? 'Ver decididos' : 'Ver pendentes'}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {visible.map((c) => {
                        const who = directory.lookup(c.employeeId);
                        const st = CERTIFICATE_STATUS[c.status];
                        const current = c.id === selectedId;
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              aria-pressed={current}
                              onClick={() => select(c.id)}
                              className={`flex w-full cursor-pointer items-start gap-3 rounded-card border bg-white p-4 text-left hover:bg-surface ${current ? 'border-brand shadow-[inset_3px_0_0_var(--color-accent)]' : 'border-line'}`}
                            >
                              <Avatar name={who.name} />
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="font-semibold">{who.name}</span>
                                <span className="text-xs text-muted">{who.registrationNumber ? `Matrícula ${who.registrationNumber} · ` : ''}Enviado em {formatInstant(c.sentAt)}</span>
                                <span className="text-xs text-ink-2 tabular-nums">Afastamento: {describeLeave(c)}</span>
                                <span className="mt-1.5"><StatusBadge tone={st.tone} label={st.label} /></span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                {desktop && (
                  <section aria-label={COPY.detailLabel} className="min-w-0 flex-[1.6_1_480px] rounded-card border border-line bg-white shadow-card">
                    {detail(true) ?? <p className="m-0 p-8 text-center text-muted">{COPY.pickOne}</p>}
                  </section>
                )}
              </div>
            </>
          );
        }}
      </QueryView>
      {!desktop && (
        <SidePanel
          open={Boolean(selectedRaw)}
          onOpenChange={(o) => { if (!o) select(null); }}
          title={panelWho?.name ?? 'Atestado'}
          description={panelWho?.registrationNumber ? `Matrícula ${panelWho.registrationNumber}` : 'Detalhe do atestado'}
          width="lg"
        >
          {detail(false)}
        </SidePanel>
      )}
    </PageHeader>
  );
}
