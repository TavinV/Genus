'use client';
/** Empresas e estabelecimentos de uma conta: listar, criar, editar, desativar e reativar (não há exclusão). */
import { Buildings, PencilSimple, Plus, UserPlus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { EntityId } from '@/lib/api/contracts';
import type { Company, CompanyEstablishment, CreatedInvite } from '@/lib/api/organization-contracts';
import { COPY as INVITE_COPY } from '@/features/invites/copy';
import { InviteDialog } from '@/features/invites/InviteDialog';
import { InviteLinkDialog } from '@/features/invites/InviteLinkDialog';
import { formatCnpj } from '@/lib/cnpj';
import { COPY } from './copy';
import { useCompanies, useSaveCompany, useSaveEstablishment } from './hooks';
import { CompanyDialog, EstablishmentDialog, type CompanyTarget, type EstablishmentTarget } from './OrganizationDialogs';
import { friendlyError } from './parts';

const c = COPY.organization;

interface Toggle {
  kind: 'company' | 'establishment';
  id: EntityId;
  name: string;
  /** Situação que a confirmação vai gravar. */
  activate: boolean;
}

function RowActions({ subject, isActive, onEdit, onToggle }: { subject: string; isActive: boolean; onEdit: () => void; onToggle: () => void }) {
  return (
    <span className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" icon={<PencilSimple size={14} aria-hidden />} aria-label={`${c.edit} ${subject}`} onClick={onEdit}>{c.edit}</Button>
      <Button variant="secondary" size="sm" aria-label={`${isActive ? c.deactivate : c.reactivate} ${subject}`} onClick={onToggle}>
        {isActive ? c.deactivate : c.reactivate}
      </Button>
    </span>
  );
}

function registrationText(e: CompanyEstablishment) {
  const number = e.registrationType === 'CNPJ' ? formatCnpj(e.registration) : e.registration;
  return `${e.registrationType} ${number} · ${e.uf} · IBGE ${e.municipalityIbge}`;
}

export function OrganizationSection({ tenantId }: { tenantId: EntityId }) {
  const query = useCompanies(tenantId);
  const saveCompany = useSaveCompany();
  const saveEstablishment = useSaveEstablishment();
  const [company, setCompany] = useState<CompanyTarget | null>(null);
  const [establishment, setEstablishment] = useState<EstablishmentTarget | null>(null);
  const [toggle, setToggle] = useState<Toggle | null>(null);
  /** Convite de um usuário só para esta empresa (escopo = estabelecimentos dela). */
  const [inviting, setInviting] = useState<Company | null>(null);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  const confirmToggle = async () => {
    if (!toggle) return;
    const input = { tenantId, id: toggle.id, patch: { isActive: toggle.activate } };
    try {
      await (toggle.kind === 'company' ? saveCompany : saveEstablishment).mutateAsync(input);
    } catch (e) {
      throw friendlyError(e);
    }
  };
  const confirmCopy = toggle ? c.confirm[toggle.kind][toggle.activate ? 'reactivate' : 'deactivate'] : null;

  const renderCompany = (co: Company) => (
    <Card key={co.id} className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-sm font-bold">{co.legalName}</h3>
            {!co.isActive && <StatusBadge label={c.companyInactive} tone="neutral" />}
          </div>
          <div className="text-sm text-muted tabular-nums">{formatCnpj(co.cnpj)}</div>
        </div>
        <RowActions
          subject={`a empresa ${co.legalName}`}
          isActive={co.isActive}
          onEdit={() => setCompany({ company: co })}
          onToggle={() => setToggle({ kind: 'company', id: co.id, name: co.legalName, activate: !co.isActive })}
        />
      </div>
      {co.establishments.length === 0
        ? <p className="m-0 text-sm text-muted">{c.noEstablishments}</p>
        : (
          <ul aria-label={`Estabelecimentos de ${co.legalName}`} className="m-0 flex list-none flex-col p-0">
            {co.establishments.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.name}</span>
                    {!e.isActive && <StatusBadge label={c.establishmentInactive} tone="neutral" />}
                  </div>
                  <div className="text-muted tabular-nums">{registrationText(e)}</div>
                </div>
                <RowActions
                  subject={`o estabelecimento ${e.name}`}
                  isActive={e.isActive}
                  onEdit={() => setEstablishment({ company: co, establishment: e })}
                  onToggle={() => setToggle({ kind: 'establishment', id: e.id, name: e.name, activate: !e.isActive })}
                />
              </li>
            ))}
          </ul>
        )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost" size="sm" className="-ml-3" disabled={!co.isActive} icon={<Plus size={14} aria-hidden />}
          aria-label={`${c.addEstablishment} em ${co.legalName}`}
          onClick={() => setEstablishment({ company: co, establishment: null })}
        >
          {c.addEstablishment}
        </Button>
        <Button
          variant="ghost" size="sm" disabled={!co.isActive || co.establishments.length === 0} icon={<UserPlus size={14} aria-hidden />}
          aria-label={INVITE_COPY.inviteToCompanyLabel(co.legalName)}
          onClick={() => setInviting(co)}
        >
          {INVITE_COPY.inviteToCompany}
        </Button>
        {!co.isActive && <span className="text-xs text-muted">{c.inactiveCompanyHint}</span>}
      </div>
    </Card>
  );

  return (
    <section aria-labelledby="organization-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="organization-title" className="m-0 text-base font-bold">{c.title}</h2>
        <Button variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={() => setCompany({ company: null })}>{c.addCompany}</Button>
      </div>
      <QueryView
        query={query}
        what="as empresas"
        loading={<Skeleton className="h-40 w-full rounded-card" />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Buildings} {...c.empty} />}
      >
        {(companies) => <>{companies.map(renderCompany)}</>}
      </QueryView>

      <CompanyDialog tenantId={tenantId} target={company} onClose={() => setCompany(null)} />
      <InviteDialog
        tenantId={tenantId}
        open={inviting !== null}
        onOpenChange={(o) => { if (!o) setInviting(null); }}
        companies={inviting ? [{ id: inviting.id, name: inviting.legalName }] : []}
        defaultCompanyId={inviting?.id ?? null}
        onCreated={setCreated}
      />
      <InviteLinkDialog created={created} onDone={() => setCreated(null)} />
      <EstablishmentDialog tenantId={tenantId} target={establishment} onClose={() => setEstablishment(null)} />
      <ConfirmDialog
        open={toggle !== null}
        onOpenChange={(o) => { if (!o) setToggle(null); }}
        title={confirmCopy?.title ?? ''}
        description={confirmCopy?.description(toggle?.name ?? '') ?? ''}
        confirmLabel={confirmCopy?.confirm ?? ''}
        tone={toggle?.activate ? 'default' : 'danger'}
        onConfirm={confirmToggle}
      />
    </section>
  );
}
