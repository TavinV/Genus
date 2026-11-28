'use client';
/**
 * Ativação do 2FA do super_admin (/admin/ativar-2fa, fora do AuthGate). Etapas: senha → chave e códigos de recuperação → código de 6 dígitos.
 * A senha só existe no campo do formulário; a chave e os códigos ficam em estado de tela e somem ao concluir. Nada vai a log, URL ou storage.
 * Sem QR por enquanto (nenhuma dependência nova): a chave é digitada à mão no aplicativo autenticador.
 */
import { Check, Copy, ShieldCheck } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import { Button } from '@/components/ui/Button';
import { CheckboxField, PasswordInput, TextInput } from '@/components/ui/Fields';
import { useZodForm } from '@/components/ui/useZodForm';
import { ApiError, asApiError } from '@/lib/api/errors';
import { useApi } from '@/lib/api/provider';
import { SESSION_KEY, useSignOut } from '@/lib/auth/gate';
import { COPY } from './copy';
import { passwordOnlySchema, totpCodeSchema } from './schemas';

interface Setup {
  secret: string;
  uri: string;
  backupCodes: string[];
}

/** Chave base32 do endereço `otpauth://totp/...?secret=XXXX&issuer=...`. */
export function extractSecret(uri: string): string {
  const m = /[?&]secret=([^&#]+)/i.exec(uri);
  return m?.[1] ? decodeURIComponent(m[1]) : '';
}

/** "ABCDEFGH" → "ABCD EFGH". */
export const groupSecret = (secret: string) => secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');

function PasswordStep({ onDone }: { onDone: (s: Setup) => void }) {
  const api = useApi();
  const form = useZodForm(passwordOnlySchema, { password: '' });
  const { register, handleSubmit, reset, setFocus, formState: { errors, isSubmitting } } = form;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setFocus('password'), [setFocus]);
  const submit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      const r = await api.superAdmin.auth2fa.enable(password);
      reset({ password: '' });
      onDone({ secret: extractSecret(r.totpURI), uri: r.totpURI, backupCodes: r.backupCodes });
    } catch (e) {
      reset({ password: '' });
      const err = asApiError(e);
      setError(err.kind === 'validation' || err.kind === 'unauthenticated' ? COPY.twoFactor.wrongPassword : err.message);
    }
  });
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <PasswordInput label={COPY.twoFactor.password} autoComplete="current-password" required error={errors.password?.message} {...register('password')} />
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      <Button type="submit" loading={isSubmitting} className="h-11 w-full">{COPY.twoFactor.passwordSubmit}</Button>
    </form>
  );
}

function SetupStep({ setup, onVerified }: { setup: Setup; onVerified: () => Promise<void> }) {
  const api = useApi();
  const form = useZodForm(totpCodeSchema, { code: '' });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form;
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [error, setError] = useState<string | null>(null);
  const c = COPY.twoFactor;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };
  const submit = handleSubmit(async ({ code }) => {
    setError(null);
    try {
      await api.superAdmin.auth2fa.verify(code);
      reset({ code: '' });
      await onVerified();
    } catch (e) {
      reset({ code: '' });
      const err = asApiError(e);
      setError(err instanceof ApiError && (err.kind === 'validation' || err.kind === 'unauthenticated') ? c.wrongCode : err.message);
    }
  });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-labelledby="sa-key-title">
        <h2 id="sa-key-title" className="m-0 text-base font-bold">{c.keyTitle}</h2>
        <p className="m-0 text-sm text-muted">{c.keyHelp}</p>
        <code data-testid="totp-secret" className="block select-all break-all rounded-md border border-line bg-surface px-3 py-3 font-mono text-base tracking-wider">{groupSecret(setup.secret)}</code>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon={copied === 'yes' ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />} onClick={() => void copy()}>
            {copied === 'yes' ? c.keyCopied : c.copyKey}
          </Button>
          {copied === 'failed' && <span role="alert" className="text-sm text-danger">Não foi possível copiar. Selecione e copie à mão.</span>}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-brand">{c.uriSummary}</summary>
          <code className="mt-2 block break-all rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs">{setup.uri}</code>
        </details>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="sa-codes-title">
        <h2 id="sa-codes-title" className="m-0 text-base font-bold">{c.codesTitle}</h2>
        <p role="alert" className="m-0 rounded-md border border-warn bg-warn-bg px-3 py-2 text-sm font-semibold text-warn">{c.codesWarning}</p>
        <ul data-testid="backup-codes" className="m-0 grid list-none grid-cols-2 gap-2 p-0 font-mono text-sm">
          {setup.backupCodes.map((code) => <li key={code} className="rounded-md border border-line bg-surface px-3 py-1.5 select-all">{code}</li>)}
        </ul>
        <CheckboxField label={c.codesConfirm} checked={saved} onCheckedChange={setSaved} />
      </section>

      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextInput label={c.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={!saved} className="tracking-[0.3em] tabular-nums" error={errors.code?.message} {...register('code')} />
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={!saved} loading={isSubmitting} className="h-11 w-full">{c.codeSubmit}</Button>
      </form>
    </div>
  );
}

export function TwoFactorSetup() {
  const qc = useQueryClient();
  const router = useRouter();
  const signOut = useSignOut();
  const [setup, setSetup] = useState<Setup | null>(null);

  const finish = async () => {
    // Chave e códigos de recuperação saem da tela antes de seguir.
    setSetup(null);
    await qc.invalidateQueries({ queryKey: SESSION_KEY });
    router.replace('/admin');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-card border border-line bg-white p-6 shadow-card md:p-8">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 flex items-center gap-2 text-2xl font-bold tracking-[-0.02em]"><ShieldCheck size={26} aria-hidden />{COPY.twoFactor.title}</h1>
          {setup === null && <p className="m-0 text-muted">{COPY.twoFactor.intro}</p>}
        </div>
        {setup === null ? <PasswordStep onDone={setSetup} /> : <SetupStep setup={setup} onVerified={finish} />}
        <Button variant="ghost" onClick={() => void signOut()} className="self-start">{COPY.twoFactor.signOut}</Button>
      </div>
    </main>
  );
}
