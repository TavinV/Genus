/** Estados de tela do design: carregando (skeleton), vazio, erro e sem permissão. */
import { ArrowClockwise, LockKey, MagnifyingGlass, SpinnerGap, WarningCircle, Wrench } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { HIDDEN_RESOURCE_MESSAGE } from '@/lib/api/errors';
import { Button } from './Button';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`rounded-xs bg-skeleton ${className}`} />;
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-4">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-card border border-line p-5">
            <Skeleton className="h-3 w-[55%]" />
            <Skeleton className="h-7 w-[70%] rounded-sm" />
            <Skeleton className="h-3 w-[85%] bg-skeleton-soft" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted"><SpinnerGap size={16} aria-hidden />{label}</div>
    </div>
  );
}

export function EmptyState({ icon: I, title, text }: { icon: Icon; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-tint"><I size={28} className="text-brand" aria-hidden /></div>
      <div className="text-xl font-bold tracking-[-0.01em]">{title}</div>
      <div className="max-w-[460px] text-muted text-pretty">{text}</div>
    </div>
  );
}

export function ErrorState({ what, code, onRetry }: { what: string; code?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-danger-line bg-white px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg"><WarningCircle size={28} className="text-danger" aria-hidden /></div>
      <div className="text-xl font-bold tracking-[-0.01em]">Não foi possível carregar {what}</div>
      <div className="max-w-[480px] text-muted text-pretty">O servidor não respondeu a tempo. Nenhum dado foi perdido. Tente de novo em alguns segundos; se continuar, envie o código abaixo ao suporte.</div>
      {code && <code className="rounded-xs border border-line bg-surface px-2 py-0.5 font-mono text-xs text-muted">{code}</code>}
      {onRetry && <Button className="mt-2" onClick={onRetry} icon={<ArrowClockwise size={18} aria-hidden />}>Tentar de novo</Button>}
    </div>
  );
}

/**
 * Sem permissão (403). `screen` é o nome da tela ou área, como aparece no menu ("Escalas"); vai entre
 * aspas para não brigar com a preposição ("a os", "em este"). A causa pode ser o perfil ou o escopo de
 * estabelecimentos: o texto cobre as duas sem expor detalhe técnico.
 */
export function ForbiddenState({ screen, onBack }: { screen: string; onBack?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface"><LockKey size={28} className="text-ink" aria-hidden /></div>
      <div className="text-xs font-semibold tracking-[0.04em] text-muted">ACESSO RESTRITO</div>
      <div className="text-xl font-bold tracking-[-0.01em]">Sem permissão para esta tela</div>
      <div className="max-w-[480px] text-muted text-pretty">Seu perfil de acesso não permite abrir “{screen}”. Se você precisa dela no seu trabalho, peça ao administrador da sua empresa para revisar o seu acesso.</div>
      {onBack && <Button variant="secondary" className="mt-2" onClick={onBack}>Voltar para a visão geral</Button>}
    </div>
  );
}

/** 403 e 404 de recurso: a MESMA tela, para não confirmar que o item existe (defesa contra IDOR). */
export function NotFoundState({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface"><MagnifyingGlass size={28} className="text-ink" aria-hidden /></div>
      <div className="text-xl font-bold tracking-[-0.01em]">Item não encontrado</div>
      <div className="max-w-[480px] text-muted text-pretty">{HIDDEN_RESOURCE_MESSAGE}</div>
      {onBack && <Button variant="secondary" className="mt-2" onClick={onBack}>Voltar</Button>}
    </div>
  );
}

/** Endpoint que o servidor ainda não tem (mocks desligados). */
export function ComingSoonState({ what }: { what?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-tint"><Wrench size={28} className="text-brand" aria-hidden /></div>
      <div className="text-xl font-bold tracking-[-0.01em]">Em breve{what ? `: ${what}` : ''}</div>
      <div className="max-w-[480px] text-muted text-pretty">Esta parte ainda está sendo construída no servidor. Assim que ela ficar pronta, esta tela passa a funcionar sem você precisar fazer nada.</div>
    </div>
  );
}

/** Falha ao atualizar com dado antigo na tela: o conteúdo continua visível abaixo do aviso. */
export function ErrorBanner({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-danger-line bg-danger-bg px-4 py-3 text-sm text-danger">
      <WarningCircle size={20} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1">Não foi possível atualizar {what}. Os dados abaixo podem estar desatualizados.</span>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry} icon={<ArrowClockwise size={14} aria-hidden />}>Tentar de novo</Button>}
    </div>
  );
}
