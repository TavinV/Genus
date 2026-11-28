'use client';
/**
 * Moldura do painel da operação Genus (/admin): sidebar com o menu, usuário e sair. Sem seletor de estabelecimento
 * (o super_admin não tem conta). Em telas até 768 px a sidebar vira gaveta, como no painel de RH.
 */
import { List, SignOut, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/shadcn/sheet';
import { useSignOut } from '@/lib/auth/gate';
import { Avatar } from '@/components/ui/Avatar';
import { useSession } from '@/lib/session';
import { activeAdminNav, ADMIN_NAV, type AdminNavItem } from './nav';

function NavLinks({ items, current, tall, onNavigate }: { items: AdminNavItem[]; current: AdminNavItem | undefined; tall?: boolean; onNavigate?: () => void }) {
  return (
    <>
      {items.map(({ href, label, icon: I }) => {
        const active = current?.href === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={`relative flex items-center gap-3 rounded-md px-3 no-underline ${tall ? 'h-11' : 'h-10'} ${active ? 'bg-tint font-semibold text-brand' : 'font-medium text-ink-2 hover:bg-surface'}`}
          >
            {active && <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-[3px] bg-accent" aria-hidden />}
            <I size={20} aria-hidden className="shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
          </Link>
        );
      })}
    </>
  );
}

function UserBlock({ onSignOut }: { onSignOut: () => void }) {
  const { me } = useSession();
  return (
    <>
      <div className="flex items-center gap-2.5 px-1 py-2">
        <Avatar name={me.name} className="text-[13px]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{me.name}</span>
          <span className="text-xs text-muted">Operação Genus</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="flex h-10 cursor-pointer items-center justify-start gap-3 rounded-md border-0 bg-transparent px-3 text-muted hover:bg-surface"
      >
        <SignOut size={20} aria-hidden />
        <span>Sair</span>
      </button>
    </>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Navegou: a gaveta do celular fecha.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const current = activeAdminNav(pathname);
  const handleSignOut = () => void signOut();

  return (
    <div className="flex min-h-screen flex-col bg-white text-ink md:flex-row">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-white px-2 md:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded={drawerOpen}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink hover:bg-surface">
          <List size={24} aria-hidden />
        </button>
        <BrandMark />
        <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>
        <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-brand">Operação</span>
      </header>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[288px] max-w-[85vw] gap-0 p-0 md:hidden">
          <div className="flex h-14 shrink-0 items-center gap-2.5 pr-2 pl-5">
            <BrandMark />
            <SheetTitle className="m-0 flex-1 text-xl font-bold tracking-[-0.03em] text-ink">Genus</SheetTitle>
            <SheetDescription className="sr-only">Menu de navegação do painel da operação</SheetDescription>
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu"
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-surface">
              <X size={20} aria-hidden />
            </button>
          </div>
          <nav aria-label="Menu" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1">
            <NavLinks items={ADMIN_NAV} current={current} tall onNavigate={() => setDrawerOpen(false)} />
          </nav>
          <div className="flex shrink-0 flex-col gap-1 border-t border-line p-3">
            <UserBlock onSignOut={handleSignOut} />
          </div>
        </SheetContent>
      </Sheet>

      <aside className="sticky top-0 z-[5] hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white md:flex">
        <div className="flex h-[68px] shrink-0 items-center gap-2.5 px-[22px]">
          <BrandMark />
          <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>
        </div>
        <p className="m-0 px-5 pb-3 text-xs font-semibold tracking-[0.04em] text-muted uppercase">Painel da operação</p>
        <nav aria-label="Menu principal" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1">
          <NavLinks items={ADMIN_NAV} current={current} />
        </nav>
        <div className="flex shrink-0 flex-col gap-1 border-t border-line p-3">
          <UserBlock onSignOut={handleSignOut} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
