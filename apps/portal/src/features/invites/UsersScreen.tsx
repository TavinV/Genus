'use client';
/** /rh/usuarios: o admin convida e revoga acessos da própria conta. */
import { useMemo } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { ForbiddenState } from '@/components/ui/States';
import { can } from '@/lib/auth/permissions';
import { useSession } from '@/lib/session';
import { COPY } from './copy';
import { InvitesSection } from './InvitesSection';

export function UsersScreen() {
  const { me, establishments } = useSession();
  // Empresas da conta, tiradas dos estabelecimentos (cada um traz a empresa e a razão social).
  const companies = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const e of establishments) if (e.companyId && !byId.has(e.companyId)) byId.set(e.companyId, { id: e.companyId, name: e.subtitle });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [establishments]);
  if (!can(me.role, 'nav.users')) {
    return <PageHeader title={COPY.users.title}><ForbiddenState screen={COPY.users.title} /></PageHeader>;
  }
  return (
    <PageHeader title={COPY.users.title} subtitle={COPY.users.subtitle}>
      <InvitesSection tenantId={null} companies={companies} />
    </PageHeader>
  );
}
