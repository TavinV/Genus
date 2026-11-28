'use client';
/** Detalhe da conta (/admin/empresas/[id]): dados, empresas e estabelecimentos, administradores, convites, uso, edição do nome, suspender e reativar. */
import { ArrowLeft, PencilSimple, WarningCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { QueryView } from '@/components/ui/QueryView';
import { NotFoundState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TextInput } from '@/components/ui/Fields';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import { parseRouteId } from '@/lib/api/ids';
import type { StatsWindow, TenantDetail } from '@/lib/api/super-admin-contracts';
import { formatInstant, formatNumber } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';
import { MODULE_USAGE_LABEL, WINDOW_LABEL } from '@/lib/labels/super-admin';
import { InvitesSection } from '@/features/invites/InvitesSection';
import { COPY } from './copy';
import { useCompanies, useReactivateTenant, useSuspendTenant, useTenant, useTenantStats, useUpdateTenant } from './hooks';
import { OrganizationSection } from './OrganizationSection';
import { BarChart, formatPercent, friendlyError, StatCard, WindowSelect } from './parts';
import { tenantNameSchema, type TenantNameValues } from './schemas';
import { TenantStatusBadge } from './TenantsScreen';
import type { Role } from '@/lib/api/contracts';
import { formatDate } from '@/lib/format';

const when = (iso: string) => formatInstant(iso);

function EditNameDialog({ tenant, open, onOpenChange }: { tenant: TenantDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <EditNameBody tenant={tenant} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function EditNameBody({ tenant, onClose }: { tenant: TenantDetail; onClose: () => void }) {
  const update = useUpdateTenant();
  const form = useZodForm(tenantNameSchema, { name: tenant.name });
  const { register, handleSubmit, formState: { errors } } = form;
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (v: TenantNameValues) => {
    setFormError(null);
    try {
      await update.mutateAsync({ id: tenant.id, name: v.name });
      onClose();
    } catch (e) {
      setFormError(applyApiErrors(form, friendlyError(e)));
    }
  };
  return (
    <DialogContent className="gap-4">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">{COPY.detail.editTitle}</DialogTitle>
        <DialogDescription>{tenant.name}</DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
        <TextInput label={COPY.create.fields.name} required error={errors.name?.message} {...register('name')} />
        {formError && <p role="alert" className="m-0 text-sm text-danger">{formError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>{COPY.create.cancel}</Button>
          <Button type="submit" loading={update.isPending}>{COPY.detail.editSave}</Button>
        </div>
      </form>
    </DialogContent>
  );
}

function UsageSection({ id }: { id: string }) {
  const [window, setWindow] = useState<StatsWindow>('7d');
  const query = useTenantStats(id, window);
  const c = COPY.overview.cards;
  return (
    <Card as="section" className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-base font-bold">{COPY.detail.usage}</h2>
        <WindowSelect value={window} onChange={setWindow} label={COPY.overview.windowLabel} />
      </div>
      <QueryView query={query} what="o uso da empresa" loading={<Skeleton className="h-40 w-full rounded-card" />}>
        {(s) => (
          <>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
              <StatCard label={c.employees} value={formatNumber(s.employees)} />
              <StatCard label={c.devices} value={formatNumber(s.devices.active)} hint={c.devicesHint(s.devices.total)} />
              <StatCard label={c.punches} value={formatNumber(s.punches)} hint={WINDOW_LABEL[s.window]} />
              <StatCard label={c.processedRate} value={formatPercent(s.processedRate)} />
              <StatCard label={c.pendingClosings} value={formatNumber(s.pendingClosings)} />
            </div>
            <BarChart ariaLabel={`${COPY.overview.perDay}, ${WINDOW_LABEL[s.window].toLowerCase()}`} data={s.punchesPerDay.map((d) => ({ label: formatDate(d.day, 'dayMonth'), value: d.punches }))} />
            <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-sm text-muted">
              {(Object.keys(MODULE_USAGE_LABEL) as (keyof typeof MODULE_USAGE_LABEL)[]).map((k) => (
                <li key={k}>{MODULE_USAGE_LABEL[k]}: <span className="font-semibold text-ink tabular-nums">{formatNumber(s.moduleUsage[k])}</span></li>
              ))}
            </ul>
          </>
        )}
      </QueryView>
    </Card>
  );
}

/** Convites da conta, com as empresas ativas para o campo "Acesso". */
function TenantInvites({ tenantId }: { tenantId: string }) {
  const companies = useCompanies(tenantId);
  const options = (companies.data ?? []).filter((co) => co.isActive && co.establishments.length > 0).map((co) => ({ id: co.id, name: co.legalName }));
  return <InvitesSection tenantId={tenantId} companies={options} />;
}

function Body({ tenant }: { tenant: TenantDetail }) {
  const suspend = useSuspendTenant();
  const reactivate = useReactivateTenant();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'suspend' | 'reactivate' | null>(null);
  const d = COPY.detail;
  const suspended = tenant.status === 'suspensa';

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      throw friendlyError(e);
    }
  };

  return (
    <>
      {suspended && (
        <div role="status" className="flex items-start gap-3 rounded-md border border-danger-line bg-danger-bg px-4 py-3 text-sm text-danger">
          <WarningCircle size={20} weight="fill" aria-hidden className="mt-px shrink-0" />
          <div>
            <div className="font-bold">{d.suspendedTitle}</div>
            <div>{d.suspendedText(tenant.suspensionReason ?? 'não informado', tenant.suspendedAt ? when(tenant.suspendedAt) : '—')}</div>
          </div>
        </div>
      )}
      {!tenant.hasCompanyKey && (
        <div role="alert" className="flex items-start gap-3 rounded-md border border-warn bg-warn-bg px-4 py-3 text-sm text-warn">
          <WarningCircle size={20} weight="fill" aria-hidden className="mt-px shrink-0" />
          <div>
            <div className="font-bold">{d.noKeyTitle}</div>
            <div>{d.noKeyText}</div>
          </div>
        </div>
      )}

      <Card as="section" className="flex flex-col gap-3 p-5">
        <h2 className="m-0 text-base font-bold">{d.data}</h2>
        <KeyValueList
          items={[
            { label: d.kv.status, value: <TenantStatusBadge status={tenant.status} /> },
            { label: d.kv.createdAt, value: when(tenant.createdAt) },
            { label: d.kv.updatedAt, value: when(tenant.updatedAt) },
            { label: d.kv.employees, value: formatNumber(tenant.counts.employees) },
            { label: d.kv.devices, value: formatNumber(tenant.counts.devices) },
            { label: d.kv.users, value: formatNumber(tenant.counts.users) },
            { label: d.kv.establishments, value: formatNumber(tenant.counts.establishments) },
          ]}
        />
      </Card>

      <OrganizationSection tenantId={tenant.id} />

      <Card as="section" className="flex flex-col gap-3 p-5">
        <h2 className="m-0 text-base font-bold">{d.admins}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{d.admins}</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                {Object.values(d.adminColumns).map((h) => <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {tenant.admins.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4 font-semibold"><span className="flex items-center gap-2.5"><Avatar name={a.name} size="sm" />{a.name}</span></td>
                  <td className="py-2 pr-4">{a.email}</td>
                  <td className="py-2 pr-4">{(ROLE_LABEL as Record<string, string>)[a.role as Role] ?? a.role}</td>
                  <td className="py-2 pr-4"><StatusBadge label={a.isActive ? d.active : d.inactive} tone={a.isActive ? 'good' : 'neutral'} /></td>
                  <td className="py-2 pr-4"><StatusBadge label={a.mfaEnabled ? d.mfaOn : d.mfaOff} tone={a.mfaEnabled ? 'good' : 'warn'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <TenantInvites tenantId={tenant.id} />

      <UsageSection id={tenant.id} />

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon={<PencilSimple size={18} aria-hidden />} onClick={() => setEditing(true)}>{d.edit}</Button>
        {suspended
          ? <Button onClick={() => setConfirm('reactivate')}>{d.reactivate}</Button>
          : <Button variant="danger" onClick={() => setConfirm('suspend')}>{d.suspend}</Button>}
      </div>

      <EditNameDialog tenant={tenant} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirm === 'suspend'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={d.suspendConfirm.title}
        description={d.suspendConfirm.description}
        confirmLabel={d.suspendConfirm.confirm}
        tone="danger"
        reason={{ label: d.suspendConfirm.reason, min: 3, max: 500 }}
        onConfirm={(reason) => run(() => suspend.mutateAsync({ id: tenant.id, reason: reason ?? '' }))}
      />
      <ConfirmDialog
        open={confirm === 'reactivate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={d.reactivateConfirm.title}
        description={d.reactivateConfirm.description}
        confirmLabel={d.reactivateConfirm.confirm}
        reason={{ label: d.reactivateConfirm.reason, min: 3, max: 500 }}
        onConfirm={(reason) => run(() => reactivate.mutateAsync({ id: tenant.id, reason: reason ?? '' }))}
      />
    </>
  );
}

export function TenantDetailScreen({ rawId }: { rawId: string }) {
  const id = parseRouteId(rawId);
  const query = useTenant(id);
  const back = (
    <Link href="/admin/empresas" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
      <ArrowLeft size={16} aria-hidden />{COPY.detail.back}
    </Link>
  );
  if (id === null) {
    return <PageHeader title="Empresa" controls={back}><NotFoundState /></PageHeader>;
  }
  return (
    <PageHeader
      title={query.data?.name ?? 'Empresa'}
      subtitle={query.data ? <TenantStatusBadge status={query.data.status} /> : undefined}
      controls={back}
    >
      <QueryView query={query} what="a empresa" loading={<Skeleton className="h-64 w-full rounded-card" />}>
        {(tenant) => <Body tenant={tenant} />}
      </QueryView>
    </PageHeader>
  );
}
