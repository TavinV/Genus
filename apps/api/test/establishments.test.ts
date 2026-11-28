/** `GET /portal/establishments`: conta e escopo da sessão, colaborador só no próprio, ordem por nome. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortalHarness, type Org } from './support/portal';

const h = new PortalHarness();
const URL = '/portal/establishments';
let org: Org;
let other: Org;

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  other = await h.createOrg();
}, 240_000);
afterAll(async () => h.stop());

const idsFor = async (cookie: string, app = h.app) => {
  const res = await h.call(cookie, 'GET', URL, undefined, app);
  expect(res.statusCode).toBe(200);
  return (res.json().data as { id: number }[]).map((e) => e.id);
};

describe('GET /portal/establishments', () => {
  it('admin, rh e contador veem os da própria conta, em ordem de nome, com a razão social', async () => {
    for (const role of ['admin', 'rh', 'contador'] as const) {
      const { cookie } = await h.loginAs(org, role);
      const res = await h.call(cookie, 'GET', URL);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: [
          { id: org.otherEstablishmentId, name: 'Filial', subtitle: 'Fazenda Fictícia Ltda', companyId: org.companyId, isActive: true },
          { id: org.establishmentId, name: 'Matriz', subtitle: 'Fazenda Fictícia Ltda', companyId: org.companyId, isActive: true },
        ],
      });
    }
    const { cookie } = await h.loginAs(other, 'rh');
    expect(await idsFor(cookie)).toEqual([other.otherEstablishmentId, other.establishmentId]);
  });

  it('respeita o escopo de estabelecimentos do usuário', async () => {
    const { cookie } = await h.loginAs(org, 'rh', { establishments: [org.establishmentId] });
    expect(await idsFor(cookie)).toEqual([org.establishmentId]);
  });

  it('o colaborador recebe só o próprio', async () => {
    const employee = await h.createEmployee(org, { establishmentId: org.otherEstablishmentId });
    const { cookie } = await h.loginAs(org, 'colaborador', { employeeId: employee.id });
    expect(await idsFor(cookie)).toEqual([org.otherEstablishmentId]);
  });

  it('gestor só com o módulo ligado', async () => {
    const off = await h.loginAs(org, 'gestor');
    expect((await h.call(off.cookie, 'GET', URL)).statusCode).toBe(403);

    const app = await h.newApp({ gestorEnabled: true });
    const on = await h.loginAs(org, 'gestor', { app, establishments: [org.otherEstablishmentId] });
    expect(await idsFor(on.cookie, app)).toEqual([org.otherEstablishmentId]);
    await app.close();
  });

  it('inativo continua na lista, marcado', async () => {
    const tenant = await h.createOrg();
    await h.client.query('UPDATE rh.estabelecimentos SET ativo = false WHERE id = $1', [tenant.establishmentId]);
    const { cookie } = await h.loginAs(tenant, 'rh');
    const rows = (await h.call(cookie, 'GET', URL)).json().data as { id: number; isActive: boolean }[];
    expect(rows.map((r) => [r.id, r.isActive])).toEqual([
      [tenant.otherEstablishmentId, true],
      [tenant.establishmentId, false],
    ]);
  });

  it('403 para o super_admin (sem conta) e 401 sem sessão', async () => {
    const root = await h.loginAsSuperAdmin();
    expect((await h.call(root.cookie, 'GET', URL)).statusCode).toBe(403);
    expect((await h.call('', 'GET', URL)).statusCode).toBe(401);
  });
});
