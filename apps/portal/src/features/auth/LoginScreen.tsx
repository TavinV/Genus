'use client';
/**
 * Entrada no portal. [SEM DESIGN]: montada com os tokens (painel da marca + cartão do formulário).
 * Etapas: e-mail e senha → código TOTP (só se a conta tem 2FA). A senha fica só no campo do formulário
 * (cada etapa tem o próprio formulário, que se desfaz ao trocar): nunca em URL, storage, log ou estado da tela.
 */
import { Info, WarningCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import { Button } from '@/components/ui/Button';
import { PasswordInput, TextInput } from '@/components/ui/Fields';
import { PendingBackTooltip } from '@/components/ui/PendingBackTooltip';
import { useZodForm } from '@/components/ui/useZodForm';
import { useMocks } from '@/lib/api/mocks/runtime';
import { asApiError } from '@/lib/api/errors';
import { useApi } from '@/lib/api/provider';
import { MFA_SETUP_PATH, safeNext, SESSION_KEY } from '@/lib/auth/gate';
import { homeFor } from '@/lib/auth/permissions';
import { COPY, DEMO_EMAILS } from './copy';
import { describeLoginError, type LoginStep } from './errors';
import { passwordSchema, totpSchema, type PasswordValues, type TotpValues } from './schemas';

function PasswordStep({ busy, onSubmit }: { busy: boolean; onSubmit: (v: PasswordValues) => Promise<void> }) {
  const form = useZodForm(passwordSchema, { email: '', password: '' });
  const { register, handleSubmit, formState: { errors, isSubmitting }, setFocus } = form;
  useEffect(() => setFocus('email'), [setFocus]);
  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <TextInput label={COPY.email} type="email" autoComplete="username" inputMode="email" error={errors.email?.message} {...register('email')} />
      <PasswordInput label={COPY.password} autoComplete="current-password" error={errors.password?.message} {...register('password')} />
      <div>
        <PendingBackTooltip>
          <Button variant="ghost" size="sm" disabled className="-ml-3">{COPY.forgot}</Button>
        </PendingBackTooltip>
      </div>
      <Button type="submit" loading={isSubmitting || busy} className="h-11 w-full">{COPY.submit}</Button>
    </form>
  );
}

function TotpStep({ busy, onSubmit, onBack }: { busy: boolean; onSubmit: (v: TotpValues) => Promise<void>; onBack: () => void }) {
  const form = useZodForm(totpSchema, { code: '' });
  const { register, handleSubmit, formState: { errors, isSubmitting }, setFocus } = form;
  useEffect(() => setFocus('code'), [setFocus]);
  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <TextInput label={COPY.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tracking-[0.3em] tabular-nums" error={errors.code?.message} {...register('code')} />
      <Button type="submit" loading={isSubmitting || busy} className="h-11 w-full">{COPY.verify}</Button>
      <Button variant="ghost" onClick={onBack} disabled={isSubmitting || busy} className="h-11 w-full">{COPY.back}</Button>
    </form>
  );
}

function DemoHint() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface p-4 text-sm">
      <div className="font-semibold">{COPY.demoTitle}</div>
      <p className="m-0 text-muted">{COPY.demoText}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-xs text-ink-2">
        {DEMO_EMAILS.map((e) => <li key={e}>{e}</li>)}
      </ul>
      <p className="m-0 text-xs text-muted">{COPY.demo2fa}</p>
    </div>
  );
}

export function LoginScreen() {
  const api = useApi();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get('next');
  const next = safeNext(rawNext);
  const [step, setStep] = useState<LoginStep>('password');
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  async function complete() {
    setRedirecting(true);
    try {
      qc.removeQueries({ queryKey: SESSION_KEY });
      const me = await api.auth.me();
      router.replace(next ?? homeFor(me.role));
    } catch (e) {
      // super_admin sem 2FA: a senha entrou, mas a sessão só serve para ativar o 2FA. Não é erro de login.
      if (asApiError(e).code === 'MFA_REQUIRED') {
        router.replace(MFA_SETUP_PATH);
        return;
      }
      setRedirecting(false);
      setError(describeLoginError(e, 'password').message);
    }
  }

  async function submitPassword(v: PasswordValues) {
    setError(null);
    try {
      const r = await api.auth.signIn(v.email, v.password);
      if (r.twoFactorRequired) {
        setStep('totp');
        return;
      }
    } catch (e) {
      setError(describeLoginError(e, 'password').message);
      return;
    }
    await complete();
  }

  async function submitCode(v: TotpValues) {
    setError(null);
    try {
      await api.auth.verifyTotp(v.code);
    } catch (e) {
      const d = describeLoginError(e, 'totp');
      setError(d.message);
      if (d.restart) setStep('password');
      return;
    }
    await complete();
  }

  const totp = step === 'totp';

  return (
    <div className="grid min-h-screen bg-white text-ink lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="hidden flex-col justify-between bg-brand p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <BrandMark className="bg-white/10 ring-1 ring-white/30" />
          <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>
        </div>
        <div className="flex max-w-[420px] flex-col gap-4">
          <p className="m-0 text-[32px] leading-10 font-bold tracking-[-0.02em] text-balance">{COPY.brandTitle}</p>
          <p className="m-0 text-white/80 text-pretty">{COPY.brandText}</p>
        </div>
        <p className="m-0 text-xs text-white/70">{COPY.brandFooter}</p>
      </div>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">{totp ? COPY.totpTitle : COPY.title}</h1>
            <p className="m-0 text-muted">{totp ? COPY.totpSubtitle : COPY.subtitle}</p>
          </div>

          {rawNext !== null && !totp && (
            <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink-2">
              <Info size={18} className="mt-px shrink-0 text-brand" aria-hidden />
              <span>{COPY.sessionEnded}</span>
            </p>
          )}

          {error && (
            <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2.5 text-sm text-danger">
              <WarningCircle size={18} weight="fill" className="mt-px shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}

          {totp
            ? <TotpStep busy={redirecting} onSubmit={submitCode} onBack={() => { setError(null); setStep('password'); }} />
            : <PasswordStep busy={redirecting} onSubmit={submitPassword} />}

          {useMocks() && <DemoHint />}
        </div>
      </main>
    </div>
  );
}
