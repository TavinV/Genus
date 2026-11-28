'use client';
/**
 * [SEM DESIGN] Configurações (usuários e escopo, parâmetros da empresa, feriados), prévia sem back.
 * Tudo é leitura: convidar, salvar e adicionar ficam desabilitados com a dica "Aguardando back".
 */
import { Info, UsersThree, type Icon } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useMemo } from 'react';
import { Controller } from 'react-hook-form';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { SwitchField, TextInput } from '@/components/ui/Fields';
import { PendingBackTooltip } from '@/components/ui/PendingBackTooltip';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, ForbiddenState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useZodForm } from '@/components/ui/useZodForm';
import type { CompanySettings, PortalUser } from '@/lib/api/contracts';
import { can, ROLE_LABEL } from '@/lib/auth/permissions';
import { useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { OrgUnitsSection } from '@/features/org-units/OrgUnitsSection';
import { HolidaysTab } from './HolidaysTab';
import { COPY, TABS, type SettingsTab } from './copy';
import { settingsFormSchema } from './schemas';

const TAB_VALUES = TABS.map((t) => t.value);

export function SettingsScreen() {
  const { me } = useSession();
  const [url, setUrl] = useUrlState(['aba'] as const);
  const tab = oneOf<SettingsTab>(url.aba, TAB_VALUES, 'estrutura');

  if (!can(me.role, 'nav.settings')) {
    return <PageHeader title={COPY.title}><ForbiddenState screen={COPY.title} /></PageHeader>;
  }
  return (
    <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
      <Card className="flex items-start gap-3 bg-tint p-4">
        <Info size={20} className="mt-0.5 shrink-0 text-brand" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{COPY.noticeTitle}</span>
          <span className="text-ink-2 text-pretty">{COPY.noticeText}</span>
        </div>
      </Card>
      <CountTabs items={TABS} value={tab} onChange={(v) => setUrl({ aba: v })} label={COPY.tabsLabel} />
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} className="flex flex-col gap-4">
        {tab === 'estrutura' && <OrgUnitsSection />}
        {tab === 'usuarios' && <UsersTab />}
        {tab === 'parametros' && <ParamsTab />}
        {tab === 'feriados' && <HolidaysTab />}
      </div>
    </PageHeader>
  );
}

const TableSkeleton = () => <Skeleton className="h-48 w-full" />;

function TabActions({ children }: { children: string }) {
  return (
    <div className="flex justify-end">
      <PendingBackTooltip text={COPY.pending}>
        <Button variant="primary" disabled>{children}</Button>
      </PendingBackTooltip>
    </div>
  );
}

function UsersTab() {
  const { establishments } = useSession();
  const q = useApiQuery('admin', { users: true }, (api, signal) => api.admin.users(signal));
  const names = useMemo(() => new Map(establishments.map((e) => [e.id, e.name])), [establishments]);
  const columns = useMemo<ColumnDef<PortalUser, never>[]>(() => [
    { header: 'Nome', accessorKey: 'name' },
    { header: 'E-mail', accessorKey: 'email' },
    { header: 'Perfil', id: 'role', cell: ({ row }) => ROLE_LABEL[row.original.role] },
    {
      header: 'Escopo',
      id: 'scope',
      cell: ({ row }) => row.original.establishmentScope === null
        ? COPY.allEstablishments
        : row.original.establishmentScope.map((id) => names.get(id) ?? `Estabelecimento ${id}`).join(', '),
    },
    { header: '2FA', id: 'mfa', cell: ({ row }) => <StatusBadge label={row.original.mfaEnabled ? 'Ativo' : 'Desligado'} tone={row.original.mfaEnabled ? 'good' : 'neutral'} /> },
    { header: 'Situação', id: 'active', cell: ({ row }) => <StatusBadge label={row.original.isActive ? 'Ativo' : 'Inativo'} tone={row.original.isActive ? 'good' : 'neutral'} /> },
  ] as ColumnDef<PortalUser, never>[], [names]);

  return (
    <>
      <TabActions>{COPY.inviteUser}</TabActions>
      <QueryView
        query={q}
        what="os usuários"
        loading={<TableSkeleton />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={UsersThree as Icon} title="Nenhum usuário cadastrado" text="Quando o servidor tiver a gestão de usuários, eles aparecem aqui." />}
      >
        {(users) => <DataTable caption="Usuários e escopo" columns={columns} data={users} getRowId={(u) => u.id} />}
      </QueryView>
    </>
  );
}

function ParamsTab() {
  const q = useApiQuery('admin', { settings: true }, (api, signal) => api.admin.companySettings(signal));
  return (
    <QueryView query={q} what="os parâmetros da empresa" loading={<TableSkeleton />}>
      {(settings) => <ParamsForm settings={settings} />}
    </QueryView>
  );
}

function ParamsForm({ settings }: { settings: CompanySettings }) {
  const form = useZodForm(settingsFormSchema, settings);
  const { register, control, formState: { errors }, watch, trigger } = form;
  useEffect(() => {
    const sub = watch(() => void trigger());
    return () => sub.unsubscribe();
  }, [watch, trigger]);

  return (
    <Card as="section" className="flex flex-col gap-5 p-6">
      <h2 className="m-0 text-md font-bold tracking-[-0.01em]">Parâmetros da empresa</h2>
      <form noValidate onSubmit={(e) => e.preventDefault()} aria-label="Parâmetros da empresa" className="flex max-w-xl flex-col gap-5">
        <Controller
          control={control}
          name="managerPortalEnabled"
          render={({ field }) => (
            <SwitchField label={COPY.managerPortalLabel} hint={COPY.managerPortalHint} checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <TextInput
          label={COPY.vacationsLabel}
          hint={COPY.vacationsHint}
          type="number"
          inputMode="numeric"
          min={1}
          {...register('maxSimultaneousVacationsPerDepartment', { valueAsNumber: true })}
          error={errors.maxSimultaneousVacationsPerDepartment?.message}
        />
        <TextInput
          label={COPY.toleranceLabel}
          hint={COPY.toleranceHint}
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          {...register('punchToleranceMinutes', { valueAsNumber: true })}
          error={errors.punchToleranceMinutes?.message}
        />
        <div>
          <PendingBackTooltip text={COPY.pending}>
            <Button type="submit" variant="primary" disabled>{COPY.save}</Button>
          </PendingBackTooltip>
        </div>
      </form>
    </Card>
  );
}
