/**
 * Área 2: escala e apuração do dia (G2, G4), contra Postgres real do RH e do
 * arp. As batidas entram no arp como o rep-core grava (registro tipo 7 com NSR)
 * e a apuração só as lê.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock, PortalHarness, type Org } from './support/portal';

const clock = new FixedClock('2026-11-23T12:00:00Z');
const h = new PortalHarness({ arp: true, clock });
let org: Org;
let rh: string;
let scheduleId: number;
let nsr = 0;

// São Paulo (UTC-3, sem horário de verão): 07:00 local = 10:00Z
const local = (date: string, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh + 3, mm)).toISOString();
};

async function punches(emp: { cpf: string }, date: string, times: string[], establishmentId = org.establishmentId) {
  for (const t of times) {
    nsr += 1;
    await h.insertArpPunch({ tenantId: org.tenantId, establishmentId, nsr, cpf: emp.cpf, at: local(date, t) });
  }
}

const fiveByTwo = (establishmentId: number) => ({
  establishmentId,
  name: 'Comercial 5x2',
  type: '5x2',
  cycleType: 'semanal',
  weeklyMinutes: 2400,
  days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' })),
});

async function employeeOnSchedule() {
  const emp = await h.createEmployee(org);
  const res = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId, validFrom: '2026-11-01' });
  expect(res.statusCode).toBe(201);
  return emp;
}

const recalc = (empId: number, from: string, to = from, cookie = rh) => h.call(cookie, 'POST', `/portal/employees/${empId}/timesheets/recalculate`, { from, to });

beforeAll(async () => {
  await h.start();
  await h.seedLegalParameters();
  org = await h.createOrg();
  rh = (await h.loginAs(org, 'rh')).cookie;
  const s = await h.call(rh, 'POST', '/portal/schedules', fiveByTwo(org.establishmentId));
  expect(s.statusCode).toBe(201);
  scheduleId = s.json().data.id;
});
afterAll(() => h.stop());

describe('escalas', () => {
  it('5x2 de 40 h: sem aviso; 6x1 de 8 h avisa hoje (44 h) e nas próximas trocas (42 h e 40 h), sem bloquear', async () => {
    const ok = await h.call(rh, 'GET', `/portal/schedules/${scheduleId}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.days).toHaveLength(5);
    expect(ok.json().data.warnings).toEqual([]);

    const sixByOne = {
      ...fiveByTwo(org.establishmentId),
      name: '6x1 longa',
      type: '6x1',
      weeklyMinutes: 2880,
      days: [1, 2, 3, 4, 5, 6].map((position) => ({ position, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' })),
    };
    const res = await h.call(rh, 'POST', '/portal/schedules', sixByOne);
    expect(res.statusCode).toBe(201);
    const warnings = res.json().data.warnings as { ruleValidFrom: string; code: string; maxMinutes?: number }[];
    const load = warnings.filter((w) => w.code === 'carga_semanal_acima_limite').map((w) => [w.ruleValidFrom, w.maxMinutes]);
    expect(load).toEqual([
      ['2026-11-23', 2640],
      ['2026-12-16', 2520],
      ['2027-12-16', 2400],
    ]);
    // 1 folga: abaixo do mínimo de 2 a partir de 16/12/2026
    expect(warnings.some((w) => w.code === 'folgas_abaixo_minimo' && w.ruleValidFrom === '2026-12-16')).toBe(true);
  });

  it('validação: folga com horário e posição repetida → 400; admin cadastra; contador → 403', async () => {
    const bad = fiveByTwo(org.establishmentId);
    bad.days = [{ position: 1, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' }, { position: 1, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' }];
    expect((await h.call(rh, 'POST', '/portal/schedules', bad)).statusCode).toBe(400);
    const off = { ...fiveByTwo(org.establishmentId), days: [{ position: 0, isDayOff: true, startTime: '07:00', endTime: '16:00' }] };
    expect((await h.call(rh, 'POST', '/portal/schedules', off)).statusCode).toBe(400);
    const admin = (await h.loginAs(org, 'admin')).cookie;
    expect((await h.call(admin, 'POST', '/portal/schedules', { ...fiveByTwo(org.establishmentId), name: 'Escala do admin' })).statusCode).toBe(201);
    const accountant = (await h.loginAs(org, 'contador')).cookie;
    expect((await h.call(accountant, 'POST', '/portal/schedules', fiveByTwo(org.establishmentId))).statusCode).toBe(403);
    expect((await h.call(admin, 'GET', `/portal/schedules/${scheduleId}`)).statusCode).toBe(200);
  });

  it('escala de outra conta → 404; vínculo com escala sobreposta → 409 ESCALA_SOBREPOSTA', async () => {
    const other = await h.createOrg();
    const otherRh = (await h.loginAs(other, 'rh')).cookie;
    expect((await h.call(otherRh, 'GET', `/portal/schedules/${scheduleId}`)).statusCode).toBe(404);

    const emp = await employeeOnSchedule();
    const dup = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId, validFrom: '2026-12-01' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('ESCALA_SOBREPOSTA');
  });
});

describe('apuração do dia', () => {
  // Os dias apurados abaixo já encerraram (dia aberto não acusa falta nem batida ímpar).
  beforeAll(() => clock.set('2026-11-27T12:00:00Z'));

  it('dia normal: lê as 4 batidas do arp, 8 h trabalhadas, NSR guardado, sem inconsistência', async () => {
    const emp = await employeeOnSchedule();
    await punches(emp, '2026-11-23', ['07:00', '11:00', '12:00', '16:00']);
    const res = await recalc(emp.id, '2026-11-23');
    expect(res.statusCode).toBe(200);
    const [day] = res.json().data.days;
    expect(day).toMatchObject({ date: '2026-11-23', situation: 'normal', status: 'calculada', expectedMinutes: 480, workedMinutes: 480, breakMinutes: 60, issues: [] });
    expect(day.punches).toHaveLength(4);
    expect(day.punches.every((p: { origin: string; nsr: number | null }) => p.origin === 'original' && p.nsr !== null)).toBe(true);
    expect(day.parameterVersion).toContain('tolerancia_batida_min@');
    h.expectLogsWithout(emp.cpf);
  });

  it('RNF05: recalcular o mesmo dia dá sempre o mesmo resultado', async () => {
    const emp = await employeeOnSchedule();
    await punches(emp, '2026-11-24', ['07:04', '11:00', '12:02', '16:30']);
    const strip = (d: Record<string, unknown>) => ({ ...d, calculatedAt: undefined });
    const a = (await recalc(emp.id, '2026-11-24')).json().data.days.map(strip);
    const b = (await recalc(emp.id, '2026-11-24')).json().data.days.map(strip);
    expect(b).toEqual(a);
    const count = await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.apuracoes_marcacoes m JOIN rh.apuracoes_dia d ON d.id = m.apuracao_dia_id WHERE d.colaborador_id = $1', [emp.id]);
    expect(Number(count.n)).toBe(4);
  });

  it('batida ímpar → inconsistência batidas_impares, dia sem minutos calculados', async () => {
    const emp = await employeeOnSchedule();
    await punches(emp, '2026-11-25', ['07:00', '11:00', '12:00']);
    const [day] = (await recalc(emp.id, '2026-11-25')).json().data.days;
    expect(day.status).toBe('inconsistente');
    expect(day.workedMinutes).toBe(0);
    expect(day.issues).toEqual([{ type: 'batidas_impares', resolved: false }]);
  });

  it('batida duplicada (mesmo minuto, NSR diferente) → marcacao_duplicada', async () => {
    const emp = await employeeOnSchedule();
    await punches(emp, '2026-11-26', ['07:00', '07:00', '11:00', '12:00', '16:00', '16:00']);
    const [day] = (await recalc(emp.id, '2026-11-26')).json().data.days;
    expect(day.status).toBe('inconsistente');
    expect(day.issues.map((i: { type: string }) => i.type)).toContain('marcacao_duplicada');
  });

  it('dia útil sem batida → falta; dia sem escala vigente fica de fora (skipped)', async () => {
    const emp = await employeeOnSchedule();
    const res = (await recalc(emp.id, '2026-10-31', '2026-11-02')).json().data;
    expect(res.skipped).toEqual([{ date: '2026-10-31', reason: 'sem_escala' }]);
    const byDate = Object.fromEntries(res.days.map((d: { date: string }) => [d.date, d]));
    expect(byDate['2026-11-01']).toMatchObject({ situation: 'folga', expectedMinutes: 0 });
    expect(byDate['2026-11-02']).toMatchObject({ situation: 'falta', absenceMinutes: 480 });
  });

  it('período fechado → 409 PERIODO_FECHADO e nada muda', async () => {
    const o = await h.createOrg();
    const rhO = await h.loginAs(o, 'rh');
    const s = (await h.call(rhO.cookie, 'POST', '/portal/schedules', fiveByTwo(o.establishmentId))).json().data;
    const emp = await h.createEmployee(o);
    await h.call(rhO.cookie, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: s.id, validFrom: '2026-10-01' });
    await h.client.query(
      `INSERT INTO rh.fechamentos (conta_id, estabelecimento_id, competencia, data_inicio, data_fim, status, fechado_por, fechado_em)
       VALUES ($1, $2, '2026-10-01', '2026-10-01', '2026-10-31', 'fechado', $3, now())`,
      [o.tenantId, o.establishmentId, rhO.userId],
    );
    const res = await recalc(emp.id, '2026-10-30', '2026-11-02', rhO.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PERIODO_FECHADO');
    const n = await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.apuracoes_dia WHERE colaborador_id = $1', [emp.id]);
    expect(Number(n.n)).toBe(0);
  });

  it('perfis e escopo: admin consulta; contador e colaborador → 403; outro estabelecimento → 404; intervalo inválido → 400', async () => {
    const emp = await employeeOnSchedule();
    await recalc(emp.id, '2026-11-23');
    const admin = (await h.loginAs(org, 'admin')).cookie;
    const list = await h.call(admin, 'GET', `/portal/employees/${emp.id}/timesheets?from=2026-11-01&to=2026-11-30`);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
    expect((await recalc(emp.id, '2026-11-23', '2026-11-23', admin)).statusCode).toBe(403);
    const contador = (await h.loginAs(org, 'contador')).cookie;
    expect((await h.call(contador, 'GET', `/portal/employees/${emp.id}/timesheets?from=2026-11-01&to=2026-11-30`)).statusCode).toBe(403);
    const colab = (await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie;
    expect((await recalc(emp.id, '2026-11-23', '2026-11-23', colab)).statusCode).toBe(403);
    const scoped = (await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] })).cookie;
    expect((await recalc(emp.id, '2026-11-23', '2026-11-23', scoped)).statusCode).toBe(404);
    expect((await recalc(emp.id, '2026-11-23', '2026-11-01')).statusCode).toBe(400);
    expect((await recalc(emp.id, '2026-01-01', '2026-12-31')).statusCode).toBe(400);
  });
});
