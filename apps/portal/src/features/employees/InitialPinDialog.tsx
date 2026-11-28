'use client';
/**
 * PIN inicial do colaborador, mostrado UMA vez. Só existe no estado do componente pai: ao fechar, o pai
 * descarta o valor (nada em storage, URL, log ou cache). O botão de fechar só libera depois da confirmação.
 */
import { Copy, Key } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/shadcn/alert-dialog';
import { COPY } from './copy';

/** `reset`: PIN novo de quem esqueceu o anterior (mesmo cuidado: aparece uma vez). */
export function InitialPinDialog({ pin, name, reset = false, onClose }: { pin: string | null; name: string; reset?: boolean; onClose: () => void }) {
  return (
    <AlertDialog open={pin !== null}>
      {pin !== null && <PinBody pin={pin} name={name} reset={reset} onClose={onClose} />}
    </AlertDialog>
  );
}

function PinBody({ pin, name, reset, onClose }: { pin: string; name: string; reset: boolean; onClose: () => void }) {
  const [ack, setAck] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pin);
      notify.success(COPY.pin.copied);
    } catch {
      // Sem permissão de área de transferência: a pessoa copia à mão.
    }
  };

  return (
    <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()} className="gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-lg font-bold"><Key size={22} aria-hidden />{reset ? COPY.pinReset.title : COPY.pin.title}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted">{reset ? `${name}: ${COPY.pinReset.text}` : `${name} foi cadastrado(a). ${COPY.pin.text}`}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
        <output aria-label="Valor do PIN" className="font-mono text-3xl font-bold tracking-[0.3em] tabular-nums">{pin}</output>
        <Button variant="secondary" size="sm" icon={<Copy size={14} aria-hidden />} onClick={() => void copy()}>{COPY.pin.copy}</Button>
      </div>
      <CheckboxField label={COPY.pin.ack} checked={ack} onCheckedChange={setAck} />
      <div className="flex justify-end">
        <Button disabled={!ack} onClick={onClose}>{COPY.pin.close}</Button>
      </div>
    </AlertDialogContent>
  );
}
