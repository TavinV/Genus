'use client';
/**
 * Guarda de área. Carrega `me`, decide pelo papel e monta a sessão. É conveniência de tela:
 * a segurança é a api (401/403/404 em toda rota).
 * - Sem sessão (401) → /login?next=<rota atual> (só o caminho, nunca dado da tela).
 * - Área `rh`: papéis de `rh.panel`. Colaborador vai para /me; os demais veem 403.
 * - Área `me`: só `colaborador`; os demais veem 403.
 * - Área `admin`: só `super_admin` (painel da operação). Ele não tem conta: sem lista de estabelecimentos.
 *   super_admin sem 2FA recebe 403 `MFA_REQUIRED` em /auth/whoami e vai para /admin/ativar-2fa.
 *   O super_admin que abre /rh volta para /admin; quem não é super_admin e abre /admin volta para a própria home.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ErrorState, ForbiddenState, LoadingState } from '@/components/ui/States';
import type { Establishment, Me } from '../api/contracts';
import { ApiError } from '../api/errors';
import { useApi } from '../api/provider';
import { SessionProvider } from '../session';
import { can, homeFor } from './permissions';

export const SESSION_KEY = ['genus-session'] as const;

/** Saída em andamento: a guarda desmonta o conteúdo e para as próprias consultas antes de limpar o cache. */
const SignOutContext = createContext<(() => void) | null>(null);

/** Só caminhos internos do portal entram no `next` (evita redirecionamento aberto). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return /^\/(rh|me|admin)(\/|$|\?)/.test(next) ? next : null;
}

export type GateArea = 'rh' | 'me' | 'admin';

const AREA_RULE = { rh: 'rh.panel', me: 'employee.portal', admin: 'superAdmin.panel' } as const;
const AREA_SCREEN = { rh: 'Painel de RH', me: 'Portal do colaborador', admin: 'Painel da operação Genus' } as const;

/** Rota de ativação do 2FA do super_admin: a única do /admin que abre sem 2FA ativo (fica fora do AuthGate). */
export const MFA_SETUP_PATH = '/admin/ativar-2fa';

export function AuthGate({ area, children }: { area: GateArea; children: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [signingOut, setSigningOut] = useState(false);
  const beginSignOut = useCallback(() => setSigningOut(true), []);

  const me = useQuery<Me, ApiError>({
    queryKey: [...SESSION_KEY, 'me'],
    queryFn: ({ signal }) => api.auth.me(signal),
    staleTime: 5 * 60_000,
    enabled: !signingOut,
  });
  const establishments = useQuery<Establishment[], ApiError>({
    queryKey: [...SESSION_KEY, 'establishments', me.data?.tenantId, me.data?.id],
    queryFn: ({ signal }) => api.org.establishments(signal),
    // super_admin não tem conta: não há estabelecimentos para listar (a api responderia 403).
    enabled: Boolean(me.data) && !signingOut && area !== 'admin',
    staleTime: 10 * 60_000,
  });

  const unauthenticated = me.error?.kind === 'unauthenticated';
  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, pathname, router]);

  // super_admin sem 2FA: /auth/whoami responde 403 MFA_REQUIRED; a única saída é ativar o 2FA.
  const mfaRequired = me.error?.code === 'MFA_REQUIRED';
  useEffect(() => {
    if (mfaRequired) router.replace(MFA_SETUP_PATH);
  }, [mfaRequired, router]);

  const role = me.data?.role;
  const wrongArea =
    role !== undefined &&
    (area === 'rh' ? role === 'colaborador' || role === 'super_admin' : area === 'admin' ? role !== 'super_admin' : false);
  useEffect(() => {
    if (wrongArea && role) router.replace(homeFor(role));
  }, [wrongArea, role, router]);

  if (signingOut) return <div className="p-8"><LoadingState label="Saindo…" /></div>;
  if (me.isPending || unauthenticated || wrongArea || mfaRequired) return <div className="p-8"><LoadingState label="Carregando sessão…" /></div>;
  if (me.isError) return <div className="p-8"><ErrorState what="a sua sessão" code={me.error.code} onRetry={() => void me.refetch()} /></div>;

  const allowed = can(me.data.role, AREA_RULE[area]);
  if (!allowed) {
    return (
      <div className="p-8">
        <ForbiddenState screen={AREA_SCREEN[area]} />
      </div>
    );
  }
  if (area !== 'admin' && establishments.isPending) return <div className="p-8"><LoadingState label="Carregando estabelecimentos…" /></div>;
  if (area !== 'admin' && establishments.isError) {
    return <div className="p-8"><ErrorState what="os estabelecimentos" code={establishments.error.code} onRetry={() => void establishments.refetch()} /></div>;
  }

  return (
    <SignOutContext.Provider value={beginSignOut}>
      <SessionProvider me={me.data} establishments={establishments.data ?? []} api={api} initialEstablishmentId={search.get('establishmentId')}>
        {children}
      </SessionProvider>
    </SignOutContext.Provider>
  );
}

/**
 * Sair: encerra no back, desmonta as telas (nenhuma consulta volta a buscar), limpa TODO o cache
 * (dados e sessão) e volta ao login.
 */
export function useSignOut() {
  const api = useApi();
  const begin = useContext(SignOutContext);
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    try {
      await api.auth.signOut();
    } finally {
      if (begin) flushSync(begin);
      qc.cancelQueries();
      qc.clear();
      router.replace('/login');
    }
  }, [api, begin, qc, router]);
}
