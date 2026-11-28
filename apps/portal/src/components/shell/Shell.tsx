'use client';
/**
 * Moldura do painel de RH: sidebar (estabelecimento, menu por papel, usuário, sair) + área da página.
 * Cada página desenha o próprio cabeçalho com <PageHeader>. Visual do design (Genus RH.dc.html).
 * Em telas até 768 px a sidebar vira gaveta (Sheet), aberta pelo botão de menu da barra superior.
 * O ponto de pendência (accent) no menu vem de uma contagem só de leitura; erro ou "Em breve" = sem ponto.
 */
import { List, SidebarSimple, SignOut, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/shadcn/sheet';
import { useSignOut } from '@/lib/auth/gate';
import { can, ROLE_LABEL } from '@/lib/auth/permissions';
import { Avatar } from '@/components/ui/Avatar';
import { plural } from '@/lib/format';
import { useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { BrandMark } from './BrandMark';
import { EstablishmentSelect } from './EstablishmentSelect';
import { activeNav, RH_NAV, type NavItem } from './nav';

export const SIDEBAR_PREF = 'genus.ui.sidebar';

type Pending = Partial<Record<NonNullable<NavItem['attention']>, number>>;

/** Quantos itens esperam o RH (atestados e ajustes pendentes). Só `meta.total`; falha não mostra nada. */
function usePending(): Pending {
  const { me } = useSession();
  const quiet = { retry: false, staleTime: 60_000, refetchOnWindowFocus: false } as const;
  const certificates = useApiQuery(
    'certificates',
    { attention: 'pendente' },
    (api, signal) => api.certificates.list({ status: 'pendente', pageSize: 1 }, signal),
    { ...quiet, enabled: can(me.role, 'nav.certificates') },
  );
  const adjustments = useApiQuery(
    'adjustments',
    { attention: 'pendente' },
    (api, signal) => api.adjustments.list({ status: 'pendente', pageSize: 1 }, signal),
    { ...quiet, enabled: can(me.role, 'nav.adjustments') },
  );
  return {
    certificates: certificates.isSuccess ? certificates.data.meta.total : undefined,
    adjustments: adjustments.isSuccess ? adjustments.data.meta.total : undefined,
  };
}

function NavLinks({ items, current, pending, expanded, tall, onNavigate }: {
  items: NavItem[];
  current: NavItem | undefined;
  pending: Pending;
  expanded: boolean;
  /** Alvo de toque maior (gaveta no celular). */
  tall?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map(({ href, label, icon: I, attention }) => {
        const active = current?.href === href;
        const count = attention ? pending[attention] : undefined;
        const hasDot = count !== undefined && count > 0;
        return (
          <Link
            key={href}
            href={href}
            title={expanded ? undefined : label}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={`relative flex items-center gap-3 rounded-md px-3 no-underline ${tall ? 'h-11' : 'h-10'} ${expanded ? 'justify-start' : 'justify-center'} ${active ? 'bg-tint font-semibold text-brand' : 'font-medium text-ink-2 hover:bg-surface'}`}
          >
            {active && <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-[3px] bg-accent" aria-hidden />}
            <span className="relative shrink-0">
              <I size={20} aria-hidden />
              {hasDot && !expanded && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />}
            </span>
            {expanded ? <span className="whitespace-nowrap">{label}</span> : <span className="sr-only">{label}</span>}
            {hasDot && expanded && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden />}
            {hasDot && <span className="sr-only">{`, ${plural(count, 'pendente', 'pendentes')}`}</span>}
          </Link>
        );
      })}
    </>
  );
}

function UserBlock({ expanded, onSignOut }: { expanded: boolean; onSignOut: () => void }) {
  const { me } = useSession();
  return (
    <>
      <div className={`flex items-center gap-2.5 py-2 ${expanded ? 'px-1' : 'justify-center'}`}>
        <Avatar name={me.name} className="text-[13px]" />
        {expanded && (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{me.name}</span>
            <span className="text-xs text-muted">Perfil {ROLE_LABEL[me.role].toLowerCase()}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onSignOut}
        aria-label={expanded ? undefined : 'Sair'}
        className={`flex h-10 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3 text-muted hover:bg-surface ${expanded ? 'justify-start' : 'justify-center'}`}
      >
        <SignOut size={20} aria-hidden />
        {expanded && <span>Sair</span>}
      </button>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const pathname = usePathname();
  const signOut = useSignOut();
  const pending = usePending();
  const [expanded, setExpanded] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_PREF) === 'collapsed') setExpanded(false);
    } catch {
      /* preferência de UI */
    }
  }, []);
  // Navegou: a gaveta do celular fecha.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const toggle = () =>
    setExpanded((e) => {
      try {
        window.localStorage.setItem(SIDEBAR_PREF, e ? 'collapsed' : 'expanded');
      } catch {
        /* preferência de UI */
      }
      return !e;
    });

  const items = RH_NAV.filter((i) => can(me.role, i.action));
  const current = activeNav(pathname, items);
  const handleSignOut = () => void signOut();

  return (
    <div className="flex min-h-screen flex-col bg-white text-ink md:flex-row">
      {/* Celular: barra fina com o botão do menu */}
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white px-2 md:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded={drawerOpen}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink hover:bg-surface">
          <List size={24} aria-hidden />
        </button>
        <BrandMark />
        <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>
      </header>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[288px] max-w-[85vw] gap-0 p-0 md:hidden">
          <div className="flex h-14 shrink-0 items-center gap-2.5 pr-2 pl-5">
            <BrandMark />
            <SheetTitle className="m-0 flex-1 text-xl font-bold tracking-[-0.03em] text-ink">Genus</SheetTitle>
            <SheetDescription className="sr-only">Menu de navegação do painel</SheetDescription>
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu"
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-surface">
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="shrink-0 px-3 pb-3"><EstablishmentSelect /></div>
          <nav aria-label="Menu" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1">
            <NavLinks items={items} current={current} pending={pending} expanded tall onNavigate={() => setDrawerOpen(false)} />
          </nav>
          <div className="flex shrink-0 flex-col gap-1 border-t border-line p-3">
            <UserBlock expanded onSignOut={handleSignOut} />
          </div>
        </SheetContent>
      </Sheet>

      <aside className={`sticky top-0 z-[5] hidden h-screen shrink-0 flex-col border-r border-line bg-white transition-[width] duration-[180ms] md:flex ${expanded ? 'w-60' : 'w-[72px]'}`}>
        <div className="flex h-[68px] shrink-0 items-center gap-2.5 px-[22px]">
          <BrandMark />
          {expanded && <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>}
        </div>
        <div className="shrink-0 px-3 pb-3"><EstablishmentSelect compact={!expanded} /></div>
        <nav aria-label="Menu principal" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1">
          <NavLinks items={items} current={current} pending={pending} expanded={expanded} />
        </nav>
        <div className="flex shrink-0 flex-col gap-1 border-t border-line p-3">
          <button type="button" onClick={toggle} aria-label={expanded ? 'Recolher menu' : 'Expandir menu'}
            className={`flex h-10 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3 text-muted hover:bg-surface ${expanded ? 'justify-start' : 'justify-center'}`}>
            <SidebarSimple size={20} aria-hidden />
            {expanded && <span>Recolher menu</span>}
          </button>
          <UserBlock expanded={expanded} onSignOut={handleSignOut} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
