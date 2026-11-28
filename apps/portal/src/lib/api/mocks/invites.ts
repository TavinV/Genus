/**
 * Mock dos convites. Guarda o CPF só em memória para imitar a conferência (a api guarda um HMAC).
 * Mesmos códigos da api: CPF_NAO_CONFERE (revoga na 5ª falha), CONVITE_INVALIDO, EMAIL_IN_USE, CPF_INVALIDO.
 */
import { cpfLooksValid } from '../../cpf';
import type { EntityId } from '../contracts';
import type { InvitesApi } from '../endpoints/invites';
import type { Invite } from '../organization-contracts';
import { clone, delay, mockFail, mockId, mockNotFound } from './runtime';

/** Mesmo dia de referência do portal em modo mock. */
const NOW = '2026-11-21T13:00:00.000Z';
const TTL_MS = 72 * 3_600_000;
const MAX_ATTEMPTS = 5;

interface Row extends Invite {
  tenantId: EntityId;
  token: string;
  cpf: string;
  attempts: number;
}

/** Razão social das empresas do mock (mesmos ids de mockEstablishments). */
const MOCK_COMPANY_NAMES: Record<string, string> = {
  '1': 'Agropecuária Santa Helena Ltda',
  '2': 'Usina Boa Vista S.A.',
  '3': 'Granja São José Avicultura Ltda',
};

/** A conta da sessão de mock (`tenantId` null) é a '1'. */
const OWN_TENANT = '1';

const seed = (): Row[] => [
  {
    id: '1', tenantId: OWN_TENANT, name: 'Teresa Campos', email: 'teresa@exemplo.test', role: 'rh', companyId: null, companyName: null, status: 'pendente',
    createdAt: NOW, expiresAt: new Date(Date.parse(NOW) + TTL_MS).toISOString(), acceptedAt: null, token: 'convite-de-demonstracao', cpf: '52998224725', attempts: 0,
  },
];

let rows = seed();
export const resetMockInvites = () => {
  rows = seed();
};

const view = (r: Row): Invite => ({
  id: r.id, name: r.name, email: r.email, role: r.role, companyId: r.companyId, companyName: r.companyName, status: r.status, expiresAt: r.expiresAt, createdAt: r.createdAt, acceptedAt: r.acceptedAt,
});

const invalid = () => mockFail(404, 'CONVITE_INVALIDO', 'Convite inválido');
const usable = (token: string) => {
  const row = rows.find((r) => r.token === token && r.status === 'pendente');
  if (!row) throw invalid();
  return row;
};

const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

export const mockInvitesApi: InvitesApi = {
  list: async (tenantId) => {
    await delay();
    return clone(rows.filter((r) => r.tenantId === (tenantId ?? OWN_TENANT)).map(view));
  },
  create: async (tenantId, input) => {
    await delay(300);
    if (!cpfLooksValid(input.cpf)) throw mockFail(400, 'CPF_INVALIDO', 'CPF inválido');
    const owner = tenantId ?? OWN_TENANT;
    const email = input.email.trim().toLowerCase();
    if (rows.some((r) => r.email === email && r.status === 'aceito')) throw mockFail(409, 'EMAIL_IN_USE', 'E-mail já em uso');
    for (const r of rows) if (r.tenantId === owner && r.email === email && r.status === 'pendente') r.status = 'revogado';
    const row: Row = {
      id: mockId(), tenantId: owner, name: input.name, email, role: input.role,
      companyId: input.companyId ?? null, companyName: input.companyId ? (MOCK_COMPANY_NAMES[input.companyId] ?? `Empresa ${input.companyId}`) : null,
      status: 'pendente', createdAt: NOW,
      expiresAt: new Date(Date.parse(NOW) + TTL_MS).toISOString(), acceptedAt: null, token: randomToken(), cpf: input.cpf, attempts: 0,
    };
    rows.unshift(row);
    return { invite: view(row), token: row.token };
  },
  revoke: async (tenantId, inviteId) => {
    await delay();
    const row = rows.find((r) => r.id === inviteId && r.tenantId === (tenantId ?? OWN_TENANT));
    if (!row) throw mockNotFound();
    row.status = 'revogado';
    return view(row);
  },
  preview: async (token) => {
    await delay();
    const r = usable(token);
    const [user = '', domain = ''] = r.email.split('@');
    return { tenantName: 'Agropecuária Santa Helena', name: r.name, emailMasked: `${user.slice(0, 1)}***@${domain}`, role: r.role, companyName: r.companyName, expiresAt: r.expiresAt };
  },
  accept: async ({ token, cpf }) => {
    await delay(300);
    const r = usable(token);
    if (r.cpf !== cpf) {
      r.attempts += 1;
      if (r.attempts >= MAX_ATTEMPTS) r.status = 'revogado';
      throw mockFail(400, 'CPF_NAO_CONFERE', 'CPF não confere');
    }
    r.status = 'aceito';
    r.acceptedAt = NOW;
    return { email: r.email };
  },
};
