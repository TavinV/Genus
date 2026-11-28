/**
 * Convites de usuário (magic link com confirmação de CPF), contra Postgres real: o convite só cria admin
 * ou rh na conta que convidou, vale uma vez, e CPF, token e hashes não saem em resposta, log ou auditoria.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, cookiesOf, fakeCpf, FixedClock, PortalHarness, type Org } from './support/portal';

const h = new PortalHarness();
const NEW_PASSWORD = 'outra-senha-ficticia-456';
let org: Org;
let admin: { userId: number; cookie: string };
let root: { userId: number; cookie: string };

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  admin = await h.loginAs(org, 'admin');
  root = await h.loginAsSuperAdmin();
});
afterAll(() => h.stop());

let n = 0;
const newInvite = (over: Record<string, unknown> = {}) => ({
  name: 'Pessoa Convidada',
  email: `convidado${(n += 1)}@portal.teste.dev`,
  role: 'rh',
  cpf: fakeCpf(),
  ...over,
});

async function invite(over: Record<string, unknown> = {}, cookie = admin.cookie) {
  const body = newInvite(over);
  const res = await h.call(cookie, 'POST', '/portal/invites', body);
  expect(res.statusCode, res.body).toBe(201);
  const { data } = res.json();
  return { body, id: data.invite.id as number, token: data.token as string };
}

/** IP novo a cada chamada, para o limite por IP não misturar os casos. */
let ip = 0;
function publicCall(action: 'preview' | 'accept', payload: object, opts: { app?: FastifyInstance; ip?: string } = {}): Promise<LightMyRequestResponse> {
  ip += 1;
  return (opts.app ?? h.app).inject({
    method: 'POST',
    url: `/portal/public/invites/${action}`,
    remoteAddress: opts.ip ?? `10.0.${Math.floor(ip / 250)}.${(ip % 250) + 1}`,
    headers: { origin: BASE_URL },
    payload,
  });
}
const accept = (token: string, cpf: string, extra: Record<string, unknown> = {}) => publicCall('accept', { token, cpf, password: NEW_PASSWORD, ...extra });

const statusOf = (id: number) => h.one<{ status: string; tentativas: number }>('SELECT status, tentativas FROM rh.convites_usuario WHERE id = $1', [id]);
const usersWith = async (email: string) => (await h.client.query('SELECT conta_id, papel, colaborador_id FROM rh.usuarios WHERE email = $1', [email])).rows;

describe('criar e listar', () => {
  it('o token sai uma vez; o banco guarda só os hashes; auditoria e log sem CPF nem token', async () => {
    const { body, id, token } = await invite();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await h.one<{ conta_id: string; token_hash: Buffer; cpf_hash: Buffer; criado_por_id: string }>(
      'SELECT conta_id, token_hash, cpf_hash, criado_por_id FROM rh.convites_usuario WHERE id = $1',
      [id],
    );
    expect(Number(row.conta_id)).toBe(org.tenantId);
    expect(Number(row.criado_por_id)).toBe(admin.userId);
    expect(row.token_hash).toEqual(createHash('sha256').update(token).digest());
    expect(row.cpf_hash).toHaveLength(32);
    expect(row.cpf_hash).not.toEqual(createHash('sha256').update(body.cpf).digest());

    const list = await h.call(admin.cookie, 'GET', '/portal/invites');
    expect(list.statusCode).toBe(200);
    const listed = list.json().data.find((i: { id: number }) => i.id === id);
    expect(Object.keys(listed).sort()).toEqual(['acceptedAt', 'companyId', 'companyName', 'createdAt', 'email', 'expiresAt', 'id', 'name', 'role', 'status']);
    expect(listed).toMatchObject({ status: 'pendente', role: 'rh', acceptedAt: null });
    expect(list.body).not.toContain(token);
    expect(list.body).not.toContain(body.cpf);

    const audit = await h.client.query("SELECT dados_antes, dados_depois FROM rh.auditorias WHERE entidade = 'user_invite' AND entidade_id = $1", [id]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain(body.cpf);
    expect(JSON.stringify(audit.rows)).not.toContain(token);
    h.expectLogsWithout(body.cpf, token);
  });

  it.each(['super_admin', 'gestor', 'contador', 'colaborador'])('papel %s é recusado → 400', async (role) => {
    expect((await h.call(admin.cookie, 'POST', '/portal/invites', newInvite({ role }))).statusCode).toBe(400);
  });

  it('o banco também recusa outro papel e a troca do papel ou da conta depois de criado', async () => {
    const { id } = await invite();
    await expect(h.client.query("UPDATE rh.convites_usuario SET papel = 'admin' WHERE id = $1", [id])).rejects.toThrow(/não podem ser alterados/);
    const other = await h.createOrg();
    await expect(h.client.query('UPDATE rh.convites_usuario SET conta_id = $2 WHERE id = $1', [id, other.tenantId])).rejects.toThrow(/não podem ser alterados/);
    await expect(
      h.client.query(
        `INSERT INTO rh.convites_usuario (conta_id, email, nome, papel, cpf_hash, token_hash, expira_em, criado_por_id)
         VALUES ($1, 'sa@portal.teste.dev', 'X', 'super_admin', $2, $2, now(), $3)`,
        [org.tenantId, Buffer.alloc(32, 9), admin.userId],
      ),
    ).rejects.toThrow(/ck_convites_usuario_papel/);
  });

  it('CPF inválido → 400; e-mail que já é usuário → 409 (sem diferenciar maiúsculas)', async () => {
    const bad = await h.call(admin.cookie, 'POST', '/portal/invites', newInvite({ cpf: '12345678900' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('CPF_INVALIDO');
    const { email } = await h.one<{ email: string }>('SELECT email FROM rh.usuarios WHERE id = $1', [admin.userId]);
    const used = await h.call(admin.cookie, 'POST', '/portal/invites', newInvite({ email: email.toUpperCase() }));
    expect(used.statusCode).toBe(409);
    expect(used.json().code).toBe('EMAIL_IN_USE');
  });

  it('novo convite para o mesmo e-mail revoga o anterior', async () => {
    const first = await invite();
    const second = await invite({ email: first.body.email });
    expect((await statusOf(first.id)).status).toBe('revogado');
    expect((await publicCall('preview', { token: first.token })).statusCode).toBe(404);
    expect((await publicCall('preview', { token: second.token })).statusCode).toBe(200);
  });

  it('rh, gestor, contador, colaborador e super_admin não usam /portal/invites → 403; anônimo → 401', async () => {
    const emp = await h.createEmployee(org);
    for (const role of ['rh', 'gestor', 'contador', 'colaborador'] as const) {
      const { cookie } = await h.loginAs(org, role, { employeeId: role === 'colaborador' ? emp.id : null });
      expect((await h.call(cookie, 'GET', '/portal/invites')).statusCode, role).toBe(403);
      expect((await h.call(cookie, 'POST', '/portal/invites', newInvite({ role: 'admin' }))).statusCode, role).toBe(403);
    }
    expect((await h.call(root.cookie, 'GET', '/portal/invites')).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: '/portal/invites' })).statusCode).toBe(401);
  });

  it('admin restrito a um estabelecimento não convida (o convidado enxergaria a conta inteira) → 403', async () => {
    const scoped = await h.loginAs(org, 'admin', { establishments: [org.establishmentId] });
    expect((await h.call(scoped.cookie, 'POST', '/portal/invites', newInvite({ role: 'admin' }))).statusCode).toBe(403);
    expect((await h.call(scoped.cookie, 'GET', '/portal/invites')).statusCode).toBe(403);
  });

  it('a conta vem da sessão: tenantId no corpo é ignorado e o admin de outra conta não vê nem revoga', async () => {
    const other = await h.createOrg();
    const { id } = await invite({ tenantId: other.tenantId });
    const row = await h.one<{ conta_id: string }>('SELECT conta_id FROM rh.convites_usuario WHERE id = $1', [id]);
    expect(Number(row.conta_id)).toBe(org.tenantId);
    const outsider = (await h.loginAs(other, 'admin')).cookie;
    expect((await h.call(outsider, 'GET', '/portal/invites')).json().data).toEqual([]);
    const res = await h.call(outsider, 'POST', `/portal/invites/${id}/revoke`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    expect((await statusOf(id)).status).toBe('pendente');
  });
});

describe('aceite público', () => {
  it('preview mascara o e-mail; aceitar cria o usuário com a conta e o papel do convite, uma só vez', async () => {
    const { body, id, token } = await invite({ role: 'admin' });
    const preview = await publicCall('preview', { token });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.json().data).toMatchObject({ tenantName: 'Conta Teste', name: 'Pessoa Convidada', role: 'admin', emailMasked: 'c***@portal.teste.dev' });
    expect(preview.body).not.toContain(body.email);

    const other = await h.createOrg();
    const res = await accept(token, body.cpf, { tenantId: other.tenantId, role: 'super_admin', email: 'invasor@portal.teste.dev' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ data: { email: body.email } });
    const created = await usersWith(body.email);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ papel: 'admin', colaborador_id: null });
    expect(Number(created[0].conta_id)).toBe(org.tenantId);
    expect(await usersWith('invasor@portal.teste.dev')).toEqual([]);
    expect((await statusOf(id)).status).toBe('aceito');

    const login = await h.app.inject({ method: 'POST', url: '/auth/sign-in/email', headers: { origin: BASE_URL }, payload: { email: body.email, password: NEW_PASSWORD } });
    expect(login.statusCode).toBe(200);

    for (const again of [await accept(token, body.cpf), await publicCall('preview', { token })]) {
      expect(again.statusCode).toBe(404);
      expect(again.json().code).toBe('CONVITE_INVALIDO');
    }
    const revoke = await h.call(admin.cookie, 'POST', `/portal/invites/${id}/revoke`);
    expect(revoke.statusCode).toBe(409);
    h.expectLogsWithout(body.cpf, token, NEW_PASSWORD);
  });

  it('CPF errado conta a tentativa; na 5ª o convite é revogado, mesmo que depois venha o certo', async () => {
    const { body, id, token } = await invite();
    const wrong = fakeCpf();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await accept(token, wrong);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('CPF_NAO_CONFERE');
      expect(await statusOf(id)).toEqual({ status: attempt < 5 ? 'pendente' : 'revogado', tentativas: attempt });
    }
    const late = await accept(token, body.cpf);
    expect(late.statusCode).toBe(404);
    expect(late.json().code).toBe('CONVITE_INVALIDO');
    expect(await usersWith(body.email)).toEqual([]);
    h.expectLogsWithout(body.cpf, wrong, token);
  });

  it('tentativas em paralelo não passam de 5, e dois aceites criam um usuário só', async () => {
    const guessed = await invite();
    const wrong = fakeCpf();
    const results = await Promise.all(Array.from({ length: 8 }, () => accept(guessed.token, wrong)));
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 404)).toHaveLength(3);

    const { body, token } = await invite();
    const twice = await Promise.all([accept(token, body.cpf), accept(token, body.cpf)]);
    expect(twice.map((r) => r.statusCode).sort()).toEqual([201, 404]);
    expect(await usersWith(body.email)).toHaveLength(1);
  });

  it('expirado, revogado, inexistente e conta suspensa respondem igual', async () => {
    const expired = await invite();
    const clock = new FixedClock(new Date(Date.now() + 73 * 60 * 60_000));
    const later = await h.newApp({ clock });
    const revoked = await invite();
    expect((await h.call(admin.cookie, 'POST', `/portal/invites/${revoked.id}/revoke`)).json().data.status).toBe('revogado');

    const suspendedOrg = await h.createOrg();
    const suspended = await invite({}, (await h.loginAs(suspendedOrg, 'admin')).cookie);
    await h.client.query("UPDATE rh.contas SET ativo = false, suspensa_em = now(), motivo_suspensao = 'teste' WHERE id = $1", [suspendedOrg.tenantId]);

    const responses = [
      await publicCall('preview', { token: expired.token }, { app: later }),
      await publicCall('accept', { token: expired.token, cpf: expired.body.cpf, password: NEW_PASSWORD }, { app: later }),
      await publicCall('preview', { token: revoked.token }),
      await accept(revoked.token, revoked.body.cpf),
      await publicCall('preview', { token: 'token-que-nao-existe' }),
      await publicCall('preview', { token: suspended.token }),
      await accept(suspended.token, suspended.body.cpf),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(responses[0]!.json());
    }
    expect(responses[0]!.json().code).toBe('CONVITE_INVALIDO');
    await later.close();
  });

  it('senha curta → 400 sem gastar tentativa', async () => {
    const { body, id, token } = await invite();
    const res = await publicCall('accept', { token, cpf: body.cpf, password: 'curta' });
    expect(res.statusCode).toBe(400);
    expect(await statusOf(id)).toEqual({ status: 'pendente', tentativas: 0 });
  });

  it('10 falhas do mesmo IP → 429', async () => {
    const same = { ip: '192.0.2.10' };
    for (let i = 0; i < 10; i++) expect((await publicCall('preview', { token: `chute-${i}` }, same)).statusCode).toBe(404);
    const blocked = await publicCall('preview', { token: 'chute-final' }, same);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('MUITAS_TENTATIVAS');
  });
});

describe('convite de uma empresa', () => {
  it('o usuário nasce restrito aos estabelecimentos da empresa; a lista e o preview mostram a empresa', async () => {
    const { body, id, token } = await invite({ companyId: org.companyId });
    const listed = (await h.call(admin.cookie, 'GET', '/portal/invites')).json().data.find((i: { id: number }) => i.id === id);
    expect(listed).toMatchObject({ companyId: org.companyId, companyName: 'Fazenda Fictícia Ltda' });
    expect((await publicCall('preview', { token })).json().data.companyName).toBe('Fazenda Fictícia Ltda');

    expect((await accept(token, body.cpf)).statusCode).toBe(201);
    const [user] = await usersWith(body.email);
    expect(user).toBeDefined();
    const scope = await h.client.query(
      'SELECT ue.estabelecimento_id FROM rh.usuarios_estabelecimentos ue JOIN rh.usuarios u ON u.id = ue.usuario_id WHERE u.email = $1 ORDER BY 1',
      [body.email],
    );
    expect(scope.rows.map((r) => Number(r.estabelecimento_id))).toEqual([org.establishmentId, org.otherEstablishmentId].sort((a, b) => a - b));
  });

  it('convite da conta inteira não restringe; empresa de outra conta ou sem estabelecimento → 400', async () => {
    const whole = await invite();
    expect((await accept(whole.token, whole.body.cpf)).statusCode).toBe(201);
    const none = await h.client.query(
      'SELECT 1 FROM rh.usuarios_estabelecimentos ue JOIN rh.usuarios u ON u.id = ue.usuario_id WHERE u.email = $1',
      [whole.body.email],
    );
    expect(none.rows).toEqual([]);

    const other = await h.createOrg();
    const foreign = await h.call(admin.cookie, 'POST', '/portal/invites', newInvite({ companyId: other.companyId }));
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().code).toBe('REFERENCIA_INVALIDA');

    const empty = await h.id("INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, 'Empresa Vazia Ltda', '11222333000181') RETURNING id", [org.tenantId]);
    const noEst = await h.call(admin.cookie, 'POST', '/portal/invites', newInvite({ companyId: empty }));
    expect(noEst.statusCode).toBe(400);
    expect(noEst.json().code).toBe('REFERENCIA_INVALIDA');
  });

  it('o super_admin também convida para uma empresa da conta', async () => {
    const res = await h.call(root.cookie, 'POST', `/portal/super-admin/tenants/${org.tenantId}/invites`, newInvite({ companyId: org.companyId }));
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data.invite).toMatchObject({ companyId: org.companyId, companyName: 'Fazenda Fictícia Ltda' });
  });
});

describe('acesso do colaborador ao portal', () => {
  const accessUrl = (id: number) => `/portal/employees/${id}/access`;
  const inviteUrl = (id: number) => `/portal/employees/${id}/access-invite`;

  it('rh convida; o aceite confere o CPF do cadastro e o colaborador entra no /me', async () => {
    const rh = await h.loginAs(org, 'rh');
    const emp = await h.createEmployee(org);
    expect((await h.call(rh.cookie, 'GET', accessUrl(emp.id))).json().data).toEqual({ status: 'sem_acesso', email: null, expiresAt: null });

    const email = `colaborador${(n += 1)}@portal.teste.dev`;
    const res = await h.call(rh.cookie, 'POST', inviteUrl(emp.id), { email, cpf: '00000000000', name: 'Outro Nome' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const { token, access } = res.json().data;
    expect(access).toMatchObject({ status: 'convite_pendente', email });
    expect((await h.call(rh.cookie, 'GET', accessUrl(emp.id))).json().data.status).toBe('convite_pendente');
    // Não aparece na lista de usuários do portal (admin e rh).
    expect((await h.call(admin.cookie, 'GET', '/portal/invites')).json().data.some((i: { email: string }) => i.email === email)).toBe(false);

    const preview = await publicCall('preview', { token });
    expect(preview.json().data).toMatchObject({ role: 'colaborador', name: 'Pessoa Fictícia', companyName: null });
    expect((await accept(token, fakeCpf())).json().code).toBe('CPF_NAO_CONFERE');
    expect((await accept(token, emp.cpf)).statusCode).toBe(201);

    const [user] = await usersWith(email);
    expect(user).toMatchObject({ papel: 'colaborador' });
    expect(Number(user.colaborador_id)).toBe(emp.id);
    expect((await h.call(rh.cookie, 'GET', accessUrl(emp.id))).json().data).toMatchObject({ status: 'ativo', email });

    const login = await h.app.inject({ method: 'POST', url: '/auth/sign-in/email', headers: { origin: BASE_URL }, payload: { email, password: NEW_PASSWORD } });
    expect(login.statusCode).toBe(200);
    const me = await h.call(cookiesOf(login), 'GET', '/me');
    expect(me.json().data).toMatchObject({ role: 'colaborador', employeeId: emp.id });

    const again = await h.call(rh.cookie, 'POST', inviteUrl(emp.id), { email: `outro${(n += 1)}@portal.teste.dev` });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('COLABORADOR_COM_ACESSO');
    h.expectLogsWithout(emp.cpf, token, NEW_PASSWORD);
  });

  it('convite novo cancela o anterior; cancelar volta a sem acesso; desligado → 409; contador → 403; fora do escopo → 404', async () => {
    const emp = await h.createEmployee(org);
    const first = (await h.call(admin.cookie, 'POST', inviteUrl(emp.id), { email: `a${(n += 1)}@portal.teste.dev` })).json().data.token;
    const second = await h.call(admin.cookie, 'POST', inviteUrl(emp.id), { email: `b${(n += 1)}@portal.teste.dev` });
    expect(second.statusCode).toBe(201);
    expect((await publicCall('preview', { token: first })).statusCode).toBe(404);

    const revoked = await h.call(admin.cookie, 'POST', `${inviteUrl(emp.id)}/revoke`);
    expect(revoked.json().data).toEqual({ status: 'sem_acesso', email: null, expiresAt: null });
    expect((await publicCall('preview', { token: second.json().data.token })).statusCode).toBe(404);

    const accountant = await h.loginAs(org, 'contador');
    expect((await h.call(accountant.cookie, 'POST', inviteUrl(emp.id), { email: 'x@portal.teste.dev' })).statusCode).toBe(403);
    const scoped = await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] });
    expect((await h.call(scoped.cookie, 'GET', accessUrl(emp.id))).statusCode).toBe(404);
    const foreign = await h.loginAs(await h.createOrg(), 'rh');
    expect((await h.call(foreign.cookie, 'POST', inviteUrl(emp.id), { email: 'y@portal.teste.dev' })).statusCode).toBe(404);

    const pending = (await h.call(admin.cookie, 'POST', inviteUrl(emp.id), { email: `c${(n += 1)}@portal.teste.dev` })).json().data.token;
    await h.client.query("UPDATE rh.colaboradores SET data_desligamento = '2026-11-20', motivo_desligamento = 'teste' WHERE id = $1", [emp.id]);
    expect((await accept(pending, emp.cpf)).json().code).toBe('CONVITE_INVALIDO');
    const gone = await h.call(admin.cookie, 'POST', inviteUrl(emp.id), { email: `d${(n += 1)}@portal.teste.dev` });
    expect(gone.statusCode).toBe(409);
    expect(gone.json().code).toBe('COLABORADOR_DESLIGADO');
  });
});

describe('convites pelo super_admin', () => {
  const base = (tenantId: number) => `/portal/super-admin/tenants/${tenantId}/invites`;

  it('convida e revoga na conta da rota; o aceite cria o usuário nela', async () => {
    const target = await h.createOrg();
    const body = newInvite({ role: 'admin' });
    const res = await h.call(root.cookie, 'POST', base(target.tenantId), body);
    expect(res.statusCode, res.body).toBe(201);
    const { token } = res.json().data;
    expect((await accept(token, body.cpf)).statusCode).toBe(201);
    expect(Number((await usersWith(body.email))[0].conta_id)).toBe(target.tenantId);
    expect((await h.call(root.cookie, 'GET', base(target.tenantId))).json().data).toHaveLength(1);
  });

  it('convite de outra conta e conta inexistente → 404', async () => {
    const { id } = await invite();
    const other = await h.createOrg();
    expect((await h.call(root.cookie, 'POST', `${base(other.tenantId)}/${id}/revoke`)).statusCode).toBe(404);
    expect((await h.call(root.cookie, 'GET', base(999_999))).statusCode).toBe(404);
    expect((await h.call(root.cookie, 'POST', base(999_999), newInvite())).statusCode).toBe(404);
    expect((await h.call(root.cookie, 'POST', `${base(org.tenantId)}/${id}/revoke`)).json().data.status).toBe('revogado');
  });
});
