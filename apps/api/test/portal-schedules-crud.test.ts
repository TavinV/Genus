/**
 * Escalas (G2): ativar/desativar, encerrar e trocar o vínculo, quem está na escala e troca de turno
 * (RF12). Trocar a escala ou o turno recalcula os dias já apurados.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock, PortalHarness, type Org } from './support/portal';

// segunda-feira, 23/11/2026, 09:00 em São Paulo
const clock = new FixedClock('2026-11-23T12:00:00Z');
const h = new PortalHarness({ arp: true, clock });
let org: Org;
let rh: string;
let fiveByTwo: number;
let lateShift: number;
let nsr = 0;

const local = (date: string, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh + 3, mm)).toISOString();
};

async function punches(cpf: string, date: string, times: string[]) {
  for (const t of times) {
    nsr += 1;
    await h.insertArpPunch({ tenantId: org.tenantId, establishmentId: org.establishmentId, nsr, cpf, at: local(date, t) });
  }
}

const weekly = (name: string, start: string, end: string) => ({
  establishmentId: org.establishmentId,
  name,
  type: '5x2',
  cycleType: 'semanal',
  weeklyMinutes: 2400,
  days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: start, endTime: end, breakStartTime: '11:00', breakEndTime: '12:00' })),
});

const day = async (empId: number, date: string) => {
  const res = await h.call(rh, 'GET', `/portal/employees/${empId}/timesheets?from=${date}&to=${date}`);
  expect(res.statusCode).toBe(200);
  return res.json().data[0] as { scheduleId: number; expectedMinutes: number; situation: string } | undefined;
};

beforeAll(async () => {
  await h.start();
  await h.seedLegalParameters();
  org = await h.createOrg();
  rh = (await h.loginAs(org, 'rh')).cookie;
  fiveByTwo = (await h.call(rh, 'POST', '/portal/schedules', weekly('Comercial', '07:00', '16:00'))).json().data.id;
  // 10:00 às 17:00 com 1 h de intervalo = 6 h previstas
  lateShift = (await h.call(rh, 'POST', '/portal/schedules', weekly('Tarde curta', '10:00', '17:00'))).json().data.id;
});
afterAll(() => h.stop());

describe('ativar e desativar escala', () => {
  it('inativa sai do filtro de ativas e não recebe vínculo novo (400 ESCALA_INATIVA)', async () => {
    const s = (await h.call(rh, 'POST', '/portal/schedules', weekly('Temporária', '07:00', '16:00'))).json().data;
    expect(s.isActive).toBe(true);
    const off = await h.call(rh, 'PATCH', `/portal/schedules/${s.id}`, { isActive: false });
    expect(off.statusCode).toBe(200);
    expect(off.json().data.isActive).toBe(false);

    const active = (await h.call(rh, 'GET', `/portal/schedules?establishmentId=${org.establishmentId}&status=ativa`)).json().data as { id: number }[];
    expect(active.map((x) => x.id)).not.toContain(s.id);
    const inactive = (await h.call(rh, 'GET', `/portal/schedules?establishmentId=${org.establishmentId}&status=inativa`)).json().data as { id: number }[];
    expect(inactive.map((x) => x.id)).toEqual([s.id]);

    const emp = await h.createEmployee(org);
    const res = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: s.id, validFrom: '2026-11-01' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ESCALA_INATIVA');

    expect((await h.call(rh, 'PATCH', `/portal/schedules/${s.id}`, { isActive: true })).json().data.isActive).toBe(true);
    expect((await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: s.id, validFrom: '2026-11-01' })).statusCode).toBe(201);
  });
});

describe('troca de escala', () => {
  it('encerra a vigente no dia anterior, abre a nova e recalcula os dias já apurados', async () => {
    const emp = await h.createEmployee(org);
    await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: fiveByTwo, validFrom: '2026-11-01' });
    // terça 17/11: apurada na escala comercial (8 h previstas)
    await punches(emp.cpf, '2026-11-17', ['07:00', '11:00', '12:00', '16:00']);
    await h.call(rh, 'POST', `/portal/employees/${emp.id}/timesheets/recalculate`, { from: '2026-11-17', to: '2026-11-17' });
    expect(await day(emp.id, '2026-11-17')).toMatchObject({ scheduleId: fiveByTwo, expectedMinutes: 480 });

    const sw = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules/switch`, { scheduleId: lateShift, validFrom: '2026-11-16' });
    expect(sw.statusCode).toBe(201);
    expect(sw.json().data).toMatchObject({ scheduleId: lateShift, scheduleName: 'Tarde curta', validFrom: '2026-11-16', validTo: null });

    const list = (await h.call(rh, 'GET', `/portal/employees/${emp.id}/schedules`)).json().data;
    expect(list.map((a: { scheduleName: string; validFrom: string; validTo: string | null }) => [a.scheduleName, a.validFrom, a.validTo])).toEqual([
      ['Comercial', '2026-11-01', '2026-11-15'],
      ['Tarde curta', '2026-11-16', null],
    ]);
    // o dia já apurado foi recalculado na escala nova
    expect(await day(emp.id, '2026-11-17')).toMatchObject({ scheduleId: lateShift, expectedMinutes: 360 });

    const people = (await h.call(rh, 'GET', `/portal/schedules/${lateShift}/employees`)).json().data as { employeeId: number }[];
    expect(people.map((p) => p.employeeId)).toContain(emp.id);
    const before = (await h.call(rh, 'GET', `/portal/schedules/${fiveByTwo}/employees?date=2026-11-10`)).json().data as { employeeId: number }[];
    expect(before.map((p) => p.employeeId)).toContain(emp.id);
  });

  it('trocar no mesmo dia do início troca só a escala; encerrar e reabrir o vínculo', async () => {
    const emp = await h.createEmployee(org);
    const created = (await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: fiveByTwo, validFrom: '2026-11-20' })).json().data;
    const sw = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules/switch`, { scheduleId: lateShift, validFrom: '2026-11-20' });
    expect(sw.json().data).toMatchObject({ id: created.id, scheduleId: lateShift });

    const end = await h.call(rh, 'PATCH', `/portal/employees/${emp.id}/schedules/${created.id}`, { validTo: '2026-11-30' });
    expect(end.statusCode).toBe(200);
    expect(end.json().data.validTo).toBe('2026-11-30');
    const bad = await h.call(rh, 'PATCH', `/portal/employees/${emp.id}/schedules/${created.id}`, { validTo: '2026-11-01' });
    expect(bad.statusCode).toBe(400);
    expect((await h.call(rh, 'PATCH', `/portal/employees/${emp.id}/schedules/${created.id}`, { validTo: null })).json().data.validTo).toBeNull();
  });

  it('outra conta: 404; admin lê e troca; contador não troca (403)', async () => {
    const emp = await h.createEmployee(org);
    const other = await h.createOrg();
    const intruder = await h.loginAs(other, 'rh');
    expect((await h.call(intruder.cookie, 'POST', `/portal/employees/${emp.id}/schedules/switch`, { scheduleId: fiveByTwo, validFrom: '2026-11-20' })).statusCode).toBe(404);
    expect((await h.call(intruder.cookie, 'GET', `/portal/schedules/${fiveByTwo}/employees`)).statusCode).toBe(404);
    const admin = await h.loginAs(org, 'admin');
    expect((await h.call(admin.cookie, 'GET', `/portal/schedules/${fiveByTwo}/employees`)).statusCode).toBe(200);
    expect((await h.call(admin.cookie, 'POST', `/portal/employees/${emp.id}/schedules/switch`, { scheduleId: fiveByTwo, validFrom: '2026-11-20' })).statusCode).toBe(201);
    const accountant = await h.loginAs(org, 'contador');
    expect((await h.call(accountant.cookie, 'POST', `/portal/employees/${emp.id}/schedules/switch`, { scheduleId: fiveByTwo, validFrom: '2026-11-25' })).statusCode).toBe(403);
  });
});

describe('troca de turno (RF12)', () => {
  it('folga pontual recalcula o dia; repetir o dia = 409; remover volta ao previsto', async () => {
    const emp = await h.createEmployee(org);
    await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: fiveByTwo, validFrom: '2026-11-01' });
    await punches(emp.cpf, '2026-11-18', ['07:00', '11:00', '12:00', '16:00']);
    await h.call(rh, 'POST', `/portal/employees/${emp.id}/timesheets/recalculate`, { from: '2026-11-18', to: '2026-11-18' });
    expect((await day(emp.id, '2026-11-18'))?.expectedMinutes).toBe(480);

    const created = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedule-overrides`, { date: '2026-11-18', isDayOff: true, reason: 'Folga trocada com colega' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ date: '2026-11-18', isDayOff: true, startTime: null });
    expect((await day(emp.id, '2026-11-18'))?.expectedMinutes).toBe(0);

    const dup = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedule-overrides`, { date: '2026-11-18', startTime: '08:00', endTime: '12:00', reason: 'De novo' });
    expect(dup.statusCode).toBe(409);
    const bad = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedule-overrides`, { date: '2026-11-19', isDayOff: true, startTime: '08:00', endTime: '12:00', reason: 'Inválida' });
    expect(bad.statusCode).toBe(400);

    const list = (await h.call(rh, 'GET', `/portal/employees/${emp.id}/schedule-overrides?from=2026-11-01&to=2026-11-30`)).json().data;
    expect(list).toHaveLength(1);
    const del = await h.call(rh, 'DELETE', `/portal/employees/${emp.id}/schedule-overrides/${list[0].id}`);
    expect(del.statusCode).toBe(204);
    expect((await day(emp.id, '2026-11-18'))?.expectedMinutes).toBe(480);
    expect((await h.call(rh, 'DELETE', `/portal/employees/${emp.id}/schedule-overrides/${list[0].id}`)).statusCode).toBe(404);
  });
});
