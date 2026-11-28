/**
 * Área 1: colaborador e vínculo (G1, RF01 a RF06), contra Postgres real.
 * Caminho feliz, validação (400), perfil sem permissão (403), outro
 * estabelecimento ou outra conta (404, sem vazamento) e as regras do banco (409).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeCpf, PortalHarness, type Org } from './support/portal';

const h = new PortalHarness();
let org: Org;
let rh: string;

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  rh = (await h.loginAs(org, 'rh')).cookie;
});
afterAll(() => h.stop());

const newEmployee = (over: Record<string, unknown> = {}) => ({
  establishmentId: org.establishmentId,
  cpf: fakeCpf(),
  name: 'Maria Fictícia',
  birthDate: '1992-03-04',
  admissionDate: '2024-02-01',
  ...over,
});

describe('POST /portal/employees', () => {
  it('rh cadastra; o PIN inicial sai uma vez e o banco guarda só o hash; auditoria sem CPF', async () => {
    const body = newEmployee();
    const res = await h.call(rh, 'POST', '/portal/employees', body);
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.cpf).toBe(body.cpf);
    expect(data.status).toBe('ativo');
    expect(data.initialPin).toMatch(/^[0-9]{6}$/);
    expect(data).not.toHaveProperty('pinHash');

    const row = await h.one<{ pin_hash: string }>('SELECT pin_hash FROM rh.colaboradores WHERE id = $1', [data.id]);
    expect(row.pin_hash).toMatch(/^scrypt\$/);
    expect(row.pin_hash).not.toContain(data.initialPin);

    const audit = await h.one<{ acao: string; dados_depois: Record<string, unknown> }>(
      "SELECT acao, dados_depois FROM rh.auditorias WHERE entidade = 'colaboradores' AND entidade_id = $1",
      [data.id],
    );
    expect(audit.acao).toBe('criacao');
    expect(JSON.stringify(audit.dados_depois)).not.toContain(body.cpf);
    h.expectLogsWithout(body.cpf, data.initialPin);
  });

  it('CPF com dígito errado → 400 CPF_INVALIDO; campo faltando → 400 VALIDATION_ERROR', async () => {
    const bad = await h.call(rh, 'POST', '/portal/employees', newEmployee({ cpf: '12345678900' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('CPF_INVALIDO');
    expect(bad.body).not.toContain('12345678900');

    const missing = await h.call(rh, 'POST', '/portal/employees', { name: 'Sem CPF' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe('VALIDATION_ERROR');
  });

  it('CPF repetido na conta → 409 CPF_DUPLICADO (unicidade garantida pelo banco), sem ecoar o CPF', async () => {
    const body = newEmployee();
    expect((await h.call(rh, 'POST', '/portal/employees', body)).statusCode).toBe(201);
    const dup = await h.call(rh, 'POST', '/portal/employees', { ...body, name: 'Outra Pessoa' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('CPF_DUPLICADO');
    expect(dup.body).not.toContain(body.cpf);
  });

  it('contador e colaborador não cadastram, não alteram e não desligam → 403', async () => {
    const emp = await h.createEmployee(org);
    for (const [role, extra] of [['contador', {}], ['colaborador', { employeeId: emp.id }]] as const) {
      const { cookie } = await h.loginAs(org, role, extra);
      expect((await h.call(cookie, 'POST', '/portal/employees', newEmployee())).statusCode, role).toBe(403);
      expect((await h.call(cookie, 'PATCH', `/portal/employees/${emp.id}`, { name: 'X Y' })).statusCode, role).toBe(403);
      const end = { terminationDate: '2026-10-31', reason: 'Motivo qualquer' };
      expect((await h.call(cookie, 'POST', `/portal/employees/${emp.id}/terminate`, end)).statusCode, role).toBe(403);
    }
  });

  it('admin cadastra, altera e desliga (auditado); vínculo continua só do rh', async () => {
    const admin = await h.loginAs(org, 'admin');
    const created = await h.call(admin.cookie, 'POST', '/portal/employees', newEmployee());
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as number;
    expect((await h.call(admin.cookie, 'PATCH', `/portal/employees/${id}`, { name: 'Nome pelo Admin' })).statusCode).toBe(200);
    const assignment = { jobTitleId: org.jobTitleId, departmentId: org.departmentId, contractType: 'indeterminado', validFrom: '2024-02-01' };
    expect((await h.call(admin.cookie, 'POST', `/portal/employees/${id}/assignments`, assignment)).statusCode).toBe(403);
    const end = { terminationDate: '2026-10-31', reason: 'Fim do contrato' };
    expect((await h.call(admin.cookie, 'POST', `/portal/employees/${id}/terminate`, end)).statusCode).toBe(200);
    const audit = await h.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM rh.auditorias WHERE entidade = 'colaboradores' AND entidade_id = $1 AND usuario_id = $2",
      [id, admin.userId],
    );
    expect(audit.n).toBe(3);
  });

  it('admin de outra conta não alcança o colaborador → 404', async () => {
    const emp = await h.createEmployee(org);
    const outsider = (await h.loginAs(await h.createOrg(), 'admin')).cookie;
    expect((await h.call(outsider, 'PATCH', `/portal/employees/${emp.id}`, { name: 'X Y' })).statusCode).toBe(404);
    const end = { terminationDate: '2026-10-31', reason: 'Motivo qualquer' };
    expect((await h.call(outsider, 'POST', `/portal/employees/${emp.id}/terminate`, end)).statusCode).toBe(404);
  });

  it('estabelecimento de outra conta → 400 REFERENCIA_INVALIDA', async () => {
    const other = await h.createOrg();
    const res = await h.call(rh, 'POST', '/portal/employees', newEmployee({ establishmentId: other.establishmentId }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('REFERENCIA_INVALIDA');
  });
});

describe('GET /portal/employees', () => {
  it('filtra por estabelecimento e situação; contador vê CPF mascarado', async () => {
    const o = await h.createOrg();
    const a = await h.createEmployee(o);
    const b = await h.createEmployee(o, { establishmentId: o.otherEstablishmentId });
    await h.client.query("UPDATE rh.colaboradores SET data_desligamento = '2025-01-01', motivo_desligamento = 'teste' WHERE id = $1", [b.id]);
    const rhO = (await h.loginAs(o, 'rh')).cookie;

    const byEst = (await h.call(rhO, 'GET', `/portal/employees?establishmentId=${o.establishmentId}`)).json();
    expect(byEst.data.map((e: { id: number }) => e.id)).toEqual([a.id]);
    const off = (await h.call(rhO, 'GET', '/portal/employees?status=desligado')).json();
    expect(off.data.map((e: { id: number }) => e.id)).toEqual([b.id]);
    expect(off.meta).toEqual({ page: 1, pageSize: 25, total: 1 });

    const contador = (await h.loginAs(o, 'contador')).cookie;
    const list = await h.call(contador, 'GET', '/portal/employees');
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(a.cpf);
    expect(list.json().data[0].cpf).toMatch(/^\*\*\*\.\*\*\*\.\*\*\*-\d{2}$/);
    expect(list.json().data[0]).not.toHaveProperty('birthDate');
  });

  it('usuário com escopo de um estabelecimento não vê o colaborador de outro (404, nem na lista)', async () => {
    const o = await h.createOrg();
    const inMain = await h.createEmployee(o);
    const inOther = await h.createEmployee(o, { establishmentId: o.otherEstablishmentId });
    const scoped = (await h.loginAs(o, 'rh', { establishments: [o.otherEstablishmentId] })).cookie;

    const hidden = await h.call(scoped, 'GET', `/portal/employees/${inMain.id}`);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(inMain.cpf);
    expect((await h.call(scoped, 'GET', `/portal/employees/${inOther.id}`)).statusCode).toBe(200);
    const list = (await h.call(scoped, 'GET', '/portal/employees')).json();
    expect(list.data.map((e: { id: number }) => e.id)).toEqual([inOther.id]);

    // nem criar colaborador no estabelecimento fora do escopo
    const create = await h.call(scoped, 'POST', '/portal/employees', newEmployee({ establishmentId: o.establishmentId }));
    expect(create.statusCode).toBe(400);
  });

  it('colaborador de outra conta → 404', async () => {
    const other = await h.createOrg();
    const foreign = await h.createEmployee(other);
    const res = await h.call(rh, 'GET', `/portal/employees/${foreign.id}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(foreign.cpf);
  });

  it('gestor desligado por padrão → 403; ligado, vê só a própria equipe', async () => {
    const o = await h.createOrg();
    const boss = await h.createEmployee(o);
    const team = await h.createEmployee(o, { managerId: boss.id });
    const outsider = await h.createEmployee(o);
    const off = await h.loginAs(o, 'gestor', { employeeId: boss.id });
    expect((await h.call(off.cookie, 'GET', '/portal/employees')).statusCode).toBe(403);

    const appOn = await h.newApp({ gestorEnabled: true });
    try {
      // a mesma sessão vale nos dois apps (mesmo banco e segredo)
      const on = off;
      const list = (await h.call(on.cookie, 'GET', '/portal/employees', undefined, appOn)).json();
      expect(list.data.map((e: { id: number }) => e.id)).toEqual([team.id]);
      expect((await h.call(on.cookie, 'GET', `/portal/employees/${outsider.id}`, undefined, appOn)).statusCode).toBe(404);
    } finally {
      await appOn.close();
    }
  });

  it('colaborador não lista colaboradores → 403', async () => {
    const emp = await h.createEmployee(org);
    const { cookie } = await h.loginAs(org, 'colaborador', { employeeId: emp.id });
    expect((await h.call(cookie, 'GET', '/portal/employees')).statusCode).toBe(403);
  });
});

describe('PATCH /portal/employees/:id', () => {
  it('rh altera dados cadastrais; o CPF não muda por aqui', async () => {
    const emp = await h.createEmployee(org);
    const res = await h.call(rh, 'PATCH', `/portal/employees/${emp.id}`, { name: 'Nome Novo', cpf: '00000000000' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Nome Novo');
    expect(res.json().data.cpf).toBe(emp.cpf);
    expect((await h.call(rh, 'PATCH', `/portal/employees/${emp.id}`, {})).statusCode).toBe(400);
  });
});

describe('vínculos', () => {
  const assignment = (over: Record<string, unknown> = {}) => ({
    jobTitleId: org.jobTitleId,
    departmentId: org.departmentId,
    costCenterId: org.costCenterId,
    contractType: 'safra',
    baseSalary: '2750.50',
    validFrom: '2025-01-01',
    validTo: '2025-06-30',
    ...over,
  });

  it('rh cria; período sobreposto → 409 VINCULO_SOBREPOSTO (EXCLUDE do banco)', async () => {
    const emp = await h.createEmployee(org);
    const first = await h.call(rh, 'POST', `/portal/employees/${emp.id}/assignments`, assignment());
    expect(first.statusCode).toBe(201);
    expect(first.json().data.baseSalary).toBe('2750.50');
    expect(first.json().data.salaryPendingAccountantReview).toBe(true);

    const overlap = await h.call(rh, 'POST', `/portal/employees/${emp.id}/assignments`, assignment({ validFrom: '2025-06-01', validTo: null }));
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().code).toBe('VINCULO_SOBREPOSTO');

    const after = await h.call(rh, 'POST', `/portal/employees/${emp.id}/assignments`, assignment({ validFrom: '2025-07-01', validTo: null }));
    expect(after.statusCode).toBe(201);
  });

  it('salário: admin vê; contador não acessa os vínculos (403); o log não traz o valor', async () => {
    const emp = await h.createEmployee(org);
    await h.call(rh, 'POST', `/portal/employees/${emp.id}/assignments`, assignment({ baseSalary: '3333.33' }));
    const admin = (await h.loginAs(org, 'admin')).cookie;
    const list = await h.call(admin, 'GET', `/portal/employees/${emp.id}/assignments`);
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0].baseSalary).toBe('3333.33');
    const contador = (await h.loginAs(org, 'contador')).cookie;
    expect((await h.call(contador, 'GET', `/portal/employees/${emp.id}/assignments`)).statusCode).toBe(403);
    h.expectLogsWithout('3333.33');
    const audit = await h.one<{ dados_depois: unknown }>(
      "SELECT dados_depois FROM rh.auditorias WHERE entidade = 'vinculos_colaborador' ORDER BY id DESC LIMIT 1",
    );
    expect(JSON.stringify(audit.dados_depois)).not.toContain('3333.33');
  });

  it('cargo de outra empresa → 400 REFERENCIA_INVALIDA; valor inválido → 400', async () => {
    const emp = await h.createEmployee(org);
    const other = await h.createOrg();
    const res = await h.call(rh, 'POST', `/portal/employees/${emp.id}/assignments`, assignment({ jobTitleId: other.jobTitleId }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('REFERENCIA_INVALIDA');
    const money = await h.call(rh, 'POST', `/portal/employees/${emp.id}/assignments`, assignment({ baseSalary: '12,50' }));
    expect(money.statusCode).toBe(400);
  });

  it('PATCH encerra o vínculo; vínculo de outro colaborador → 404', async () => {
    const emp = await h.createEmployee(org);
    const other = await h.createEmployee(org);
    const created = (await h.call(rh, 'POST', `/portal/employees/${emp.id}/assignments`, assignment({ validTo: null }))).json().data;
    const res = await h.call(rh, 'PATCH', `/portal/employees/${emp.id}/assignments/${created.id}`, { validTo: '2025-12-31' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.validTo).toBe('2025-12-31');
    expect((await h.call(rh, 'PATCH', `/portal/employees/${other.id}/assignments/${created.id}`, { validTo: '2025-12-31' })).statusCode).toBe(404);
  });
});

describe('POST /portal/employees/:id/terminate', () => {
  it('grava data e motivo, encerra vínculo aberto e derruba o acesso do colaborador', async () => {
    const emp = await h.createEmployee(org);
    await h.createAssignment(org, emp.id, '2024-01-01');
    const colab = await h.loginAs(org, 'colaborador', { employeeId: emp.id });
    expect((await h.call(colab.cookie, 'GET', '/me')).statusCode).toBe(200);

    const res = await h.call(rh, 'POST', `/portal/employees/${emp.id}/terminate`, { terminationDate: '2026-10-31', reason: 'Fim da safra' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'desligado', terminationDate: '2026-10-31', terminationReason: 'Fim da safra' });
    const v = await h.one<{ vigencia_fim: string }>("SELECT to_char(vigencia_fim, 'YYYY-MM-DD') AS vigencia_fim FROM rh.vinculos_colaborador WHERE colaborador_id = $1", [emp.id]);
    expect(v.vigencia_fim).toBe('2026-10-31');
    expect((await h.call(colab.cookie, 'GET', '/me')).statusCode).toBe(401);

    const again = await h.call(rh, 'POST', `/portal/employees/${emp.id}/terminate`, { terminationDate: '2026-11-01', reason: 'De novo' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('COLABORADOR_DESLIGADO');
  });

  it('sem motivo → 400', async () => {
    const emp = await h.createEmployee(org);
    expect((await h.call(rh, 'POST', `/portal/employees/${emp.id}/terminate`, { terminationDate: '2026-10-31' })).statusCode).toBe(400);
  });
});

describe('POST /portal/employees/:id/pin/reset', () => {
  it('admin gera PIN novo: sai uma vez, troca o hash, auditoria sem o PIN; contador → 403; outra conta → 404; desligado → 409', async () => {
    const created = (await h.call(rh, 'POST', '/portal/employees', newEmployee())).json().data;
    const before = await h.one<{ pin_hash: string }>('SELECT pin_hash FROM rh.colaboradores WHERE id = $1', [created.id]);
    const admin = (await h.loginAs(org, 'admin')).cookie;

    const res = await h.call(admin, 'POST', `/portal/employees/${created.id}/pin/reset`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { pin } = res.json().data;
    expect(pin).toMatch(/^[0-9]{6}$/);
    const after = await h.one<{ pin_hash: string }>('SELECT pin_hash FROM rh.colaboradores WHERE id = $1', [created.id]);
    expect(after.pin_hash).not.toBe(before.pin_hash);
    expect(after.pin_hash).not.toContain(pin);
    const audit = await h.one<{ dados_depois: Record<string, unknown> }>(
      "SELECT dados_depois FROM rh.auditorias WHERE entidade = 'colaboradores' AND entidade_id = $1 AND acao = 'alteracao' ORDER BY id DESC LIMIT 1",
      [created.id],
    );
    expect(JSON.stringify(audit.dados_depois)).not.toContain(pin);
    h.expectLogsWithout(pin);

    const accountant = (await h.loginAs(org, 'contador')).cookie;
    expect((await h.call(accountant, 'POST', `/portal/employees/${created.id}/pin/reset`)).statusCode).toBe(403);
    const foreign = (await h.loginAs(await h.createOrg(), 'admin')).cookie;
    expect((await h.call(foreign, 'POST', `/portal/employees/${created.id}/pin/reset`)).statusCode).toBe(404);

    await h.call(rh, 'POST', `/portal/employees/${created.id}/terminate`, { terminationDate: '2026-11-20', reason: 'Pedido de demissão' });
    const gone = await h.call(rh, 'POST', `/portal/employees/${created.id}/pin/reset`);
    expect(gone.statusCode).toBe(409);
    expect(gone.json().code).toBe('COLABORADOR_DESLIGADO');
  });
});
