'use client';
/**
 * Acesso do colaborador ao portal (/me). O RH ou o admin informa o e-mail e recebe o link do convite UMA vez
 * (o portal não envia e-mail). No aceite, o colaborador confirma o próprio CPF (o do cadastro) e cria a senha;
 * depois entra em /login com o e-mail e a senha, no celular ou no computador.
 * Chamada direta à api ao convidar (sem useMutation): o token não passa por nenhum cache.
 */
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import { Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { Employee } from '@/lib/api/contracts';
import type { EmployeeAccess, EmployeeAccessStatus } from '@/lib/api/organization-contracts';
import { formatInstant } from '@/lib/format';
import type { LabelTone } from '@/lib/labels';
import { useApiMutation, useApiQuery, useInvalidate } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { inviteError } from '@/features/invites/copy';
import { InviteLinkDialog, type InviteLinkData } from '@/features/invites/InviteLinkDialog';
import { COPY } from './copy';

const c = COPY.portalAccess;
const STATUS: Record<EmployeeAccessStatus, { label: string; tone: LabelTone }> = c.status as Record<EmployeeAccessStatus, { label: string; tone: LabelTone }>;

const emailSchema = z.object({ email: z.string().trim().min(1, c.emailInvalid).pipe(z.email(c.emailInvalid)) });

export function PortalAccessDialog({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (open: boolean) => void }) {
  const [created, setCreated] = useState<InviteLinkData | null>(null);
  return (
    <>
      <Dialog open={employee !== null && created === null} onOpenChange={onOpenChange}>
        {employee && created === null && <Body employee={employee} onCreated={setCreated} onClose={() => onOpenChange(false)} />}
      </Dialog>
      <InviteLinkDialog created={created} employee onDone={() => { setCreated(null); onOpenChange(false); }} />
    </>
  );
}

function Body({ employee, onCreated, onClose }: { employee: Employee; onCreated: (d: InviteLinkData) => void; onClose: () => void }) {
  const query = useApiQuery('employees', { access: employee.id }, (api, signal) => api.employees.access(employee.id, signal));
  return (
    <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">{c.title(employee.name)}</DialogTitle>
        <DialogDescription>{c.description}</DialogDescription>
      </DialogHeader>
      <QueryView query={query} what="o acesso do colaborador" loading={<Skeleton className="h-24 w-full rounded-card" />}>
        {(access) => <AccessBody employee={employee} access={access} onCreated={onCreated} onClose={onClose} />}
      </QueryView>
    </DialogContent>
  );
}

function AccessBody({ employee, access, onCreated, onClose }: { employee: Employee; access: EmployeeAccess; onCreated: (d: InviteLinkData) => void; onClose: () => void }) {
  const { api } = useSession();
  const invalidate = useInvalidate();
  const revoke = useApiMutation((a, id: string) => a.employees.revokeAccessInvite(id), { invalidates: ['employees'] });
  const form = useZodForm(emailSchema, { email: access.email ?? '' });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;
  const [formError, setFormError] = useState<string | null>(null);
  const st = STATUS[access.status];
  const canInvite = access.status === 'sem_acesso' || access.status === 'convite_pendente';

  const submit = async (v: z.output<typeof emailSchema>) => {
    setFormError(null);
    try {
      const { access: next, token } = await api.employees.inviteAccess(employee.id, v.email);
      void invalidate('employees');
      onCreated({ invite: { name: employee.name, email: next.email ?? v.email, expiresAt: next.expiresAt ?? '' }, token });
    } catch (e) {
      const err = inviteError(e);
      if (err.code === 'EMAIL_IN_USE') form.setError('email', { type: 'server', message: err.message }, { shouldFocus: true });
      else setFormError(applyApiErrors(form, err));
    }
  };

  const cancel = async () => {
    setFormError(null);
    try {
      await revoke.mutateAsync(employee.id);
      notify.success(c.revoked);
    } catch (e) {
      setFormError(inviteError(e).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-1.5">
        <StatusBadge label={st.label} tone={st.tone} />
        {access.status === 'convite_pendente' && access.email && access.expiresAt && (
          <p className="m-0 text-sm text-muted">{c.pendingText(access.email, formatInstant(access.expiresAt))}</p>
        )}
        {access.status === 'ativo' && access.email && <p className="m-0 text-sm text-muted">{c.activeText(access.email)}</p>}
        {access.status === 'inativo' && <p className="m-0 text-sm text-muted">{c.inactiveText}</p>}
      </div>
      {canInvite && (
        <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
          <TextInput label={c.email} required type="email" autoComplete="off" hint={c.emailHint} error={errors.email?.message} {...register('email')} />
          {formError && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {access.status === 'convite_pendente' && (
              <Button variant="secondary" loading={revoke.isPending} disabled={isSubmitting} onClick={() => void cancel()}>{c.revoke}</Button>
            )}
            <Button type="submit" loading={isSubmitting} disabled={revoke.isPending}>{access.status === 'convite_pendente' ? c.resend : c.send}</Button>
          </div>
        </form>
      )}
      {!canInvite && (
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>{c.close}</Button></div>
      )}
    </div>
  );
}
