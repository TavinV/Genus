/**
 * Área 4: férias (G9, RF39 a RF43, RN10 a RN12) contra Postgres real.
 * Relógio fixo em 23/11/2026 (segunda). Aviso de 30 dias: gozo a partir de 23/12/2026.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock, PortalHarness, type Org } from './support/portal';

const h = new PortalHarness({ clock: new FixedClock('2026-11-23T12:00:00Z') });
let org: Org;
let rhA: string;

// 04/01/2027 é segunda: nem o início nem os dois dias seguintes caem em descanso
const JAN = { startDate: '2027-01-04', endDate: '2027-01-18' };

async function employeeWithPeriod(o = org, cookie = rhA) {
  const emp = await h.createEmployee(o, { admissionDate: '2025-06-01' });
  await h.createAssignment(o, emp.id, '2025-06-01');
  const res = await h.call(cookie, 'POST', `/portal/employees/${emp.id}/vacation-periods`, { startDate: '2025-06-01' });
  expect(res.statusCode).toBe(201);
  return { ...emp, periodId: res.json().data.id as number, period: res.json().data };
}

beforeAll(async () => {
  await h.start();
  await h.seedLegalParameters();
  org = await h.createOrg({ maxSimultaneousVacations: 1 });
  rhA = (await h.loginAs(org, 'rh')).cookie;
});
afterAll(() => h.stop());

describe('período aquisitivo', () => {
  it('abre com 12 meses, concessivo nos 12 seguintes e 30 dias sem faltas (RN10)', async () => {
    const { period } = await employeeWithPeriod();
    expect(period).toMatchObject({
      startDate: '2025-06-01',
      endDate: '2026-05-31',
      grantDeadline: '2027-05-31',
      unjustifiedAbsences: 0,
      entitledDays: 30,
      remainingDays: 30,
      vacations: [],
    });
  });

  it('sobreposto → 409 PERIODO_AQUISITIVO_SOBREPOSTO; data inválida → 400; admin consulta e abre', async () => {
    const emp = await employeeWithPeriod();
    const dup = await h.call(rhA, 'POST', `/portal/employees/${emp.id}/vacation-periods`, { startDate: '2025-12-01' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('PERIODO_AQUISITIVO_SOBREPOSTO');
    expect((await h.call(rhA, 'POST', `/portal/employees/${emp.id}/vacation-periods`, { startDate: '2025-02-30' })).statusCode).toBe(400);
    const admin = (await h.loginAs(org, 'admin')).cookie;
    expect((await h.call(admin, 'GET', `/portal/employees/${emp.id}/vacation-periods`)).statusCode).toBe(200);
    expect((await h.call(admin, 'POST', `/portal/employees/${emp.id}/vacation-periods`, { startDate: '2026-06-01' })).statusCode).toBe(201);
  });
});

describe('pedido e decisão', () => {
  it('rh pede, outro rh aprova; saldo cai; quem pediu não aprova', async () => {
    const o = await h.createOrg();
    const a = (await h.loginAs(o, 'rh')).cookie;
    const b = (await h.loginAs(o, 'rh')).cookie;
    const emp = await employeeWithPeriod(o, a);
    const req = await h.call(a, 'POST', `/portal/employees/${emp.id}/vacations`, { accrualPeriodId: emp.periodId, ...JAN });
    expect(req.statusCode).toBe(201);
    expect(req.json().data).toMatchObject({ status: 'solicitada', days: 15, cashBonusDays: 0, daysPaidInDouble: 0 });
    const self = await h.call(a, 'POST', `/portal/vacations/${req.json().data.id}/approve`, {});
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe('DECISOR_IGUAL_SOLICITANTE');
    const ok = await h.call(b, 'POST', `/portal/vacations/${req.json().data.id}/approve`, {});
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.status).toBe('aprovada');
    const [p] = (await h.call(a, 'GET', `/portal/employees/${emp.id}/vacation-periods`)).json().data;
    expect(p.remainingDays).toBe(15);
    const again = await h.call(b, 'POST', `/portal/vacations/${req.json().data.id}/approve`, {});
    expect(again.json().code).toBe('STATUS_INVALIDO');
  });

  it('regras da CLT pela função pura: aviso curto, período curto, início vedado → 409 com código FERIAS_*', async () => {
    const emp = await employeeWithPeriod();
    const post = (body: object) => h.call(rhA, 'POST', `/portal/employees/${emp.id}/vacations`, { accrualPeriodId: emp.periodId, ...body });
    const notice = await post({ startDate: '2026-12-01', endDate: '2026-12-15' });
    expect(notice.statusCode).toBe(409);
    expect(notice.json().code).toBe('FERIAS_AVISO_INSUFICIENTE');
    // 4 dias: o Zod aceita; a regra (e o CHECK fg_minimo_5_dias) recusa
    const short = await post({ startDate: '2027-01-04', endDate: '2027-01-07' });
    expect(short.json().code).toBe('FERIAS_PERIODO_CURTO');
    // 07/01/2027 é quinta: sábado está nos 2 dias seguintes
    const blocked = await post({ startDate: '2027-01-07', endDate: '2027-01-21' });
    expect(blocked.json().code).toBe('FERIAS_INICIO_VEDADO');
    const allowance = await post({ ...JAN, cashBonusDays: 11 });
    expect(allowance.statusCode).toBe(400);
  });

  it('férias acima do limite do setor → 409 FERIAS_SETOR_DESFALCADO', async () => {
    const o = await h.createOrg({ maxSimultaneousVacations: 1 });
    const a = (await h.loginAs(o, 'rh')).cookie;
    const b = (await h.loginAs(o, 'rh')).cookie;
    const x = await employeeWithPeriod(o, a);
    const y = await employeeWithPeriod(o, a);
    const rx = (await h.call(a, 'POST', `/portal/employees/${x.id}/vacations`, { accrualPeriodId: x.periodId, ...JAN })).json().data.id;
    const ry = (await h.call(a, 'POST', `/portal/employees/${y.id}/vacations`, { accrualPeriodId: y.periodId, startDate: '2027-01-11', endDate: '2027-01-25' })).json().data.id;
    expect((await h.call(b, 'POST', `/portal/vacations/${rx}/approve`, {})).statusCode).toBe(200);
    const second = await h.call(b, 'POST', `/portal/vacations/${ry}/approve`, {});
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('FERIAS_SETOR_DESFALCADO');
    // pedido novo também já sai recusado pela regra
    const y2 = await h.call(a, 'POST', `/portal/employees/${y.id}/vacations`, { accrualPeriodId: y.periodId, startDate: '2027-01-11', endDate: '2027-01-15' });
    expect(y2.json().code).toBe('FERIAS_SETOR_DESFALCADO');
  });

  it('concorrência: duas aprovações simultâneas no mesmo setor com limite 1, só uma passa', async () => {
    const o = await h.createOrg({ maxSimultaneousVacations: 1 });
    const a = (await h.loginAs(o, 'rh')).cookie;
    const deciders = [(await h.loginAs(o, 'rh')).cookie, (await h.loginAs(o, 'rh')).cookie];
    const x = await employeeWithPeriod(o, a);
    const y = await employeeWithPeriod(o, a);
    const ids = [
      (await h.call(a, 'POST', `/portal/employees/${x.id}/vacations`, { accrualPeriodId: x.periodId, ...JAN })).json().data.id,
      (await h.call(a, 'POST', `/portal/employees/${y.id}/vacations`, { accrualPeriodId: y.periodId, ...JAN })).json().data.id,
    ];
    const results = await Promise.all(ids.map((id, i) => h.call(deciders[i]!, 'POST', `/portal/vacations/${id}/approve`, {})));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('FERIAS_SETOR_DESFALCADO');
    const approved = await h.one<{ n: string }>("SELECT count(*) AS n FROM rh.gozos_ferias WHERE id = ANY($1) AND status = 'aprovada'", [ids]);
    expect(Number(approved.n)).toBe(1);
  });

  it('recusa exige motivo; cancelar libera o setor', async () => {
    const o = await h.createOrg({ maxSimultaneousVacations: 1 });
    const a = (await h.loginAs(o, 'rh')).cookie;
    const b = (await h.loginAs(o, 'rh')).cookie;
    const x = await employeeWithPeriod(o, a);
    const y = await employeeWithPeriod(o, a);
    const rx = (await h.call(a, 'POST', `/portal/employees/${x.id}/vacations`, { accrualPeriodId: x.periodId, ...JAN })).json().data.id;
    expect((await h.call(b, 'POST', `/portal/vacations/${rx}/reject`, {})).statusCode).toBe(400);
    expect((await h.call(b, 'POST', `/portal/vacations/${rx}/approve`, {})).statusCode).toBe(200);
    expect((await h.call(b, 'POST', `/portal/vacations/${rx}/cancel`, { reason: 'Mudança na safra' })).json().data.status).toBe('cancelada');
    const ry = (await h.call(a, 'POST', `/portal/employees/${y.id}/vacations`, { accrualPeriodId: y.periodId, ...JAN })).json().data.id;
    expect((await h.call(b, 'POST', `/portal/vacations/${ry}/approve`, {})).statusCode).toBe(200);
  });
});

describe('perfis, escopo e portal do colaborador', () => {
  it('colaborador pede as próprias férias e vê só as suas; não aprova (403)', async () => {
    const emp = await employeeWithPeriod();
    const other = await employeeWithPeriod();
    const colab = (await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie;
    const mine = await h.call(colab, 'POST', '/portal/me/vacations', { accrualPeriodId: emp.periodId, startDate: '2027-02-01', endDate: '2027-02-10' });
    expect(mine.statusCode).toBe(201);
    expect(mine.json().data.employeeId).toBe(emp.id);
    // o período do outro não serve: 400
    const steal = await h.call(colab, 'POST', '/portal/me/vacations', { accrualPeriodId: other.periodId, startDate: '2027-02-01', endDate: '2027-02-10' });
    expect(steal.statusCode).toBe(400);
    const list = (await h.call(colab, 'GET', '/portal/me/vacations')).json().data;
    expect(list.map((p: { employeeId: number }) => p.employeeId)).toEqual([emp.id]);
    expect((await h.call(colab, 'POST', `/portal/vacations/${mine.json().data.id}/approve`, {})).statusCode).toBe(403);
    expect((await h.call(colab, 'GET', `/portal/employees/${other.id}/vacation-periods`)).statusCode).toBe(403);
  });

  it('contador não decide (403); admin decide; rh de outro estabelecimento e de outra conta → 404', async () => {
    const emp = await employeeWithPeriod();
    const id = (await h.call(rhA, 'POST', `/portal/employees/${emp.id}/vacations`, { accrualPeriodId: emp.periodId, startDate: '2027-03-01', endDate: '2027-03-10' })).json().data.id;
    const accountant = (await h.loginAs(org, 'contador')).cookie;
    expect((await h.call(accountant, 'POST', `/portal/vacations/${id}/approve`, {})).statusCode).toBe(403);
    const scoped = (await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] })).cookie;
    expect((await h.call(scoped, 'POST', `/portal/vacations/${id}/approve`, {})).statusCode).toBe(404);
    expect((await h.call(scoped, 'GET', `/portal/employees/${emp.id}/vacation-periods`)).statusCode).toBe(404);
    const foreign = (await h.loginAs(await h.createOrg(), 'rh')).cookie;
    expect((await h.call(foreign, 'POST', `/portal/vacations/${id}/approve`, {})).statusCode).toBe(404);
    const admin = (await h.loginAs(org, 'admin')).cookie;
    expect((await h.call(admin, 'POST', `/portal/vacations/${id}/approve`, {})).json().data.status).toBe('aprovada');
  });
});
