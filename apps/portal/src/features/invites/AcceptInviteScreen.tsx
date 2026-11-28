'use client';
/**
 * /convite (pública). O token chega no fragmento (`/convite#<token>`), sai da barra de endereço na hora
 * e fica só na memória desta tela. Chamadas diretas à api: token, CPF e senha não vão para URL, cache,
 * storage ou log.
 */
import { WarningCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller } from 'react-hook-form';
import { BrandMark } from '@/components/shell/BrandMark';
import { Button } from '@/components/ui/Button';
import { PasswordInput, TextInput } from '@/components/ui/Fields';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { notify } from '@/components/ui/notify';
import { LoadingState } from '@/components/ui/States';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { InvitePreview } from '@/lib/api/organization-contracts';
import { useApi } from '@/lib/api/provider';
import { digitsOf, maskCpf } from '@/lib/cpf';
import { formatInstant } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';
import { COPY, inviteError } from './copy';
import { acceptSchema, type AcceptValues } from './schemas';

type State =
  | { kind: 'loading' }
  | { kind: 'form'; preview: InvitePreview }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

const c = COPY.accept;

export function AcceptInviteScreen() {
  const api = useApi();
  const router = useRouter();
  const token = useRef<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    const value = token.current;
    if (!value) {
      setState({ kind: 'missing' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'form', preview: await api.invites.preview(value) });
    } catch (e) {
      const err = inviteError(e);
      setState(err.code === 'CONVITE_INVALIDO' ? { kind: 'invalid' } : { kind: 'error', message: err.message });
    }
  }, [api]);

  useEffect(() => {
    // Lido uma vez: o efeito pode rodar de novo e o fragmento já terá saído da barra.
    if (token.current === null) {
      token.current = window.location.hash.slice(1);
      // Num próximo ciclo, para o roteador do Next já acompanhar a troca da URL (senão ele pode repor o fragmento).
      if (window.location.hash) setTimeout(() => window.history.replaceState(null, '', window.location.pathname + window.location.search), 0);
    }
    void load();
  }, [load]);

  const goToLogin = () => router.replace('/login');

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 py-10 text-ink">
      <div className="flex w-full max-w-[420px] flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-xl font-bold tracking-[-0.03em]">Genus</span>
        </div>
        {state.kind === 'loading' && <LoadingState label={c.loading} />}
        {state.kind === 'missing' && <Notice title={c.missingTitle} text={c.missingText} action={c.login} onAction={goToLogin} />}
        {state.kind === 'invalid' && <Notice title={c.invalidTitle} text={c.invalidText} action={c.login} onAction={goToLogin} />}
        {state.kind === 'error' && <Notice title={c.errorTitle} text={state.message} action={c.retry} onAction={() => void load()} />}
        {state.kind === 'form' && (
          <AcceptForm
            preview={state.preview}
            token={() => token.current ?? ''}
            onInvalid={() => setState({ kind: 'invalid' })}
            onAccepted={(email) => {
              token.current = '';
              notify.success(c.done, c.doneText(email));
              goToLogin();
            }}
          />
        )}
      </div>
    </main>
  );
}

function Notice({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3">
      <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">{title}</h1>
      <p className="m-0 text-muted text-pretty">{text}</p>
      <Button className="h-11 w-full" onClick={onAction}>{action}</Button>
    </div>
  );
}

function AcceptForm({ preview, token, onInvalid, onAccepted }: {
  preview: InvitePreview;
  token: () => string;
  onInvalid: () => void;
  onAccepted: (email: string) => void;
}) {
  const api = useApi();
  const form = useZodForm(acceptSchema, { cpf: '', password: '', confirmation: '' });
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = form;
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (v: AcceptValues) => {
    setFormError(null);
    try {
      const { email } = await api.invites.accept({ token: token(), cpf: digitsOf(v.cpf), password: v.password });
      form.reset();
      onAccepted(email);
    } catch (e) {
      const err = inviteError(e);
      if (err.code === 'CONVITE_INVALIDO') onInvalid();
      else if (err.code === 'CPF_NAO_CONFERE' || err.code === 'CPF_INVALIDO') form.setError('cpf', { type: 'server', message: err.message }, { shouldFocus: true });
      else setFormError(applyApiErrors(form, err));
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">{c.title}</h1>
        <p className="m-0 text-muted">{c.subtitle}</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-4">
        <KeyValueList
          items={[
            { label: c.tenant, value: preview.tenantName },
            ...(preview.companyName ? [{ label: c.company, value: preview.companyName }] : []),
            { label: c.name, value: preview.name },
            { label: c.email, value: preview.emailMasked },
            { label: c.role, value: ROLE_LABEL[preview.role] },
            { label: c.expiresAt, value: formatInstant(preview.expiresAt) },
          ]}
        />
      </div>
      {formError && (
        <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2.5 text-sm text-danger">
          <WarningCircle size={18} weight="fill" className="mt-px shrink-0" aria-hidden />
          <span>{formError}</span>
        </p>
      )}
      <form noValidate method="post" onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
        <Controller
          control={control}
          name="cpf"
          render={({ field }) => (
            <TextInput
              label={c.cpf} required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00"
              error={errors.cpf?.message}
              name={field.name} ref={field.ref} onBlur={field.onBlur}
              value={field.value}
              onChange={(e) => field.onChange(maskCpf(e.target.value))}
            />
          )}
        />
        <PasswordInput label={c.password} required autoComplete="new-password" hint={c.passwordHint} error={errors.password?.message} {...register('password')} />
        <PasswordInput label={c.confirmation} required autoComplete="new-password" error={errors.confirmation?.message} {...register('confirmation')} />
        <Button type="submit" loading={isSubmitting} className="h-11 w-full">{c.submit}</Button>
      </form>
    </>
  );
}
