'use client';
/** Mostra o link do convite uma única vez. Ele vive só no estado de quem abre este diálogo e some ao fechar. */
import { Check, Copy, LinkSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/Fields';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/shadcn/alert-dialog';
import { formatInstant } from '@/lib/format';
import { COPY } from './copy';

/** O token vai no fragmento: o navegador não o envia ao servidor, então não cai em log. */
export const inviteLink = (origin: string, token: string) => `${origin}/convite#${token}`;

/** O mínimo que o diálogo precisa: quem foi convidado, o prazo e o token. */
export interface InviteLinkData {
  invite: { name: string; email: string; expiresAt: string };
  token: string;
}

/** `employee`: convite de acesso do colaborador, que confirma o próprio CPF (o do cadastro). */
export function InviteLinkDialog({ created, onDone, employee = false }: { created: InviteLinkData | null; onDone: () => void; employee?: boolean }) {
  return (
    <AlertDialog open={created !== null}>
      {created && <Body created={created} employee={employee} onDone={onDone} />}
    </AlertDialog>
  );
}

function Body({ created, employee, onDone }: { created: InviteLinkData; employee: boolean; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const c = COPY.link;
  const { invite } = created;
  const link = inviteLink(window.location.origin, created.token);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };
  return (
    // Sem fechar por Esc: a pessoa precisa confirmar que copiou o link.
    <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()} className="gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-lg font-bold"><LinkSimple size={20} aria-hidden />{c.title}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted">{c.forPerson(invite.name, invite.email)}</AlertDialogDescription>
      </AlertDialogHeader>
      <p role="alert" className="m-0 rounded-md border border-warn bg-warn-bg px-3 py-2 text-sm font-semibold text-warn">{c.warning}</p>
      <code data-testid="invite-link" className="block select-all break-all rounded-md border border-line bg-surface px-3 py-3 font-mono text-sm">{link}</code>
      <p className="m-0 text-sm text-ink-2">{(employee ? c.needsOwnCpf : c.needsCpf)(formatInstant(invite.expiresAt))}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={copied === 'yes' ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />} onClick={() => void copy()}>
          {copied === 'yes' ? c.copied : c.copy}
        </Button>
        {copied === 'failed' && <span role="alert" className="text-sm text-danger">{c.copyFailed}</span>}
      </div>
      <CheckboxField label={c.done} checked={confirmed} onCheckedChange={setConfirmed} />
      <div className="flex justify-end">
        <Button disabled={!confirmed} onClick={onDone}>{c.close}</Button>
      </div>
    </AlertDialogContent>
  );
}
