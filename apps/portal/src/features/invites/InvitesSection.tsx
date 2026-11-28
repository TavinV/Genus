'use client';
/**
 * Convites de uma conta: lista, convidar e revogar. `tenantId` null = a própria conta; preenchido = super_admin.
 * `companies`: empresas da conta, para convidar alguém só para uma delas.
 */
import { EnvelopeSimple, UserPlus } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable } from '@/components/ui/DataTable';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EntityId } from '@/lib/api/contracts';
import type { CreatedInvite, Invite } from '@/lib/api/organization-contracts';
import { formatInstant } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';
import { useApiMutation, useApiQuery, useInvalidate } from '@/lib/query/hooks';
import { COPY, INVITE_STATUS_LABEL, inviteError } from './copy';
import { InviteDialog, type InviteCompanyOption } from './InviteDialog';
import { InviteLinkDialog } from './InviteLinkDialog';

const deadline = (i: Invite) =>
  i.acceptedAt ? `Aceito em ${formatInstant(i.acceptedAt)}` : i.status === 'pendente' ? `Vale até ${formatInstant(i.expiresAt)}` : `Criado em ${formatInstant(i.createdAt)}`;

export function InvitesSection({ tenantId, companies = [] }: { tenantId: EntityId | null; companies?: InviteCompanyOption[] }) {
  const query = useApiQuery('invites', { tenantId }, (api, signal) => api.invites.list(tenantId, signal));
  const revoke = useApiMutation((api, id: EntityId) => api.invites.revoke(tenantId, id));
  const invalidate = useInvalidate();
  const [inviting, setInviting] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [revoking, setRevoking] = useState<Invite | null>(null);

  const columns = useMemo<ColumnDef<Invite, never>[]>(() => [
    { id: 'name', header: 'Nome', cell: ({ row }) => <span className="flex items-center gap-3"><Avatar name={row.original.name} size="sm" /><span className="font-semibold">{row.original.name}</span></span> },
    { id: 'email', header: 'E-mail', cell: ({ row }) => row.original.email },
    { id: 'role', header: 'Perfil', cell: ({ row }) => ROLE_LABEL[row.original.role] },
    { id: 'access', header: 'Acesso', cell: ({ row }) => row.original.companyName ?? COPY.wholeAccount },
    { id: 'status', header: 'Situação', cell: ({ row }) => <StatusBadge {...INVITE_STATUS_LABEL[row.original.status]} /> },
    { id: 'deadline', header: 'Prazo', cell: ({ row }) => <span className="tabular-nums">{deadline(row.original)}</span> },
    {
      id: 'actions',
      header: () => <span className="sr-only">Ações</span>,
      cell: ({ row }) => row.original.status === 'pendente' && (
        <span className="flex justify-end">
          <Button variant="secondary" size="sm" aria-label={COPY.revokeLabel(row.original.name)} onClick={() => setRevoking(row.original)}>{COPY.revoke}</Button>
        </span>
      ),
    },
  ], []);

  const confirmRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      notify.success(COPY.revoked);
    } catch (e) {
      throw inviteError(e);
    } finally {
      // Mesmo na falha a situação pode ter mudado (aceito ou expirado no meio tempo).
      void invalidate('invites');
    }
  };

  return (
    <section aria-labelledby="invites-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="invites-title" className="m-0 text-base font-bold">{COPY.section}</h2>
          <p className="m-0 text-sm text-muted">{COPY.sectionHint}</p>
        </div>
        <Button variant="secondary" icon={<UserPlus size={18} aria-hidden />} onClick={() => setInviting(true)}>{COPY.invite}</Button>
      </div>
      <QueryView
        query={query}
        what="os convites"
        loading={<Skeleton className="h-40 w-full rounded-card" />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={EnvelopeSimple} {...COPY.empty} />}
      >
        {(invites) => <DataTable<Invite> caption={COPY.tableCaption} columns={columns} data={invites} getRowId={(i) => i.id} />}
      </QueryView>

      <InviteDialog tenantId={tenantId} companies={companies} open={inviting} onOpenChange={setInviting} onCreated={setCreated} />
      <InviteLinkDialog created={created} onDone={() => setCreated(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => { if (!o) setRevoking(null); }}
        title={COPY.revokeConfirm.title}
        description={COPY.revokeConfirm.description(revoking?.name ?? '')}
        confirmLabel={COPY.revokeConfirm.confirm}
        tone="danger"
        onConfirm={confirmRevoke}
      />
    </section>
  );
}
