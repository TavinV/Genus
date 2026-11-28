import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role, VacationCalendar } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { mockVacationsApi, resetMockVacations } from '@/lib/api/mocks/vacations';
import { renderWithSession } from '../../../test/render';
import { VacationsScreen } from './VacationsScreen';

type R = Exclude<Role, 'super_admin'>;

function setup(role: R = 'rh', route = '/rh/ferias?month=2026-12', over: Partial<typeof mockVacationsApi> = {}) {
  const vacations = {
    calendar: vi.fn(over.calendar ?? mockVacationsApi.calendar),
    periods: vi.fn(over.periods ?? mockVacationsApi.periods),
    createPeriod: vi.fn(over.createPeriod ?? mockVacationsApi.createPeriod),
    request: vi.fn(over.request ?? mockVacationsApi.request),
    approve: vi.fn(over.approve ?? mockVacationsApi.approve),
    reject: vi.fn(over.reject ?? mockVacationsApi.reject),
    cancel: vi.fn(over.cancel ?? mockVacationsApi.cancel),
  };
  const view = renderWithSession(<VacationsScreen />, { role, route, api: { vacations } });
  return { ...view, ...vacations };
}

/** Setor de Agroindústria no mock (departmentIdOf). */
const AGRO = '12';

beforeEach(() => resetMockVacations());
afterEach(() => vi.restoreAllMocks());

describe('Férias: calendário', () => {
  it('mostra o calendário do setor, a fila de pendentes e passa no axe', async () => {
    const { container, calendar } = setup();
    expect(await screen.findByRole('table', { name: /Calendário de férias/ })).toBeInTheDocument();
    expect(calendar).toHaveBeenCalledWith({ establishmentId: '1', month: '2026-12' }, expect.anything());
    expect(screen.getByText('Daniela Costa', { selector: 'button' })).toBeInTheDocument();
    expect(screen.getByText('Dentro do limite')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ordenha/ })).toHaveAttribute('aria-selected', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a aba do setor na URL mostra "Acima do limite do setor" vindo da api', async () => {
    setup('rh', `/rh/ferias?month=2026-12&departmentId=${AGRO}`);
    expect(await screen.findByText('Acima do limite do setor', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Tereza Gomes', { selector: 'button' })).toBeInTheDocument();
  });

  it('o selo do limite vem do dado: exceedsLimit falso mostra "Dentro do limite" mesmo com ocupação alta', async () => {
    const calendar: VacationCalendar = {
      month: '2026-12',
      departments: [{
        departmentId: '10', name: 'Ordenha', headcount: 12, maxSimultaneous: 1, dailyOccupancy: Array.from({ length: 31 }, () => 9),
        rows: [{ vacationId: '1', employeeId: '103', employeeName: 'Maria Aparecida Souza', startDate: '2026-12-01', endDate: '2026-12-05', status: 'solicitada', exceedsLimit: false, nextFreeStartDate: null }],
      }],
    };
    setup('rh', '/rh/ferias?month=2026-12', { calendar: async () => calendar });
    expect(await screen.findByText('Dentro do limite')).toBeInTheDocument();
    expect(screen.queryByText('Acima do limite do setor', { selector: 'span' })).toBeNull();
  });

  it('marca o dia atual na régua', async () => {
    setup('rh', '/rh/ferias?month=2026-11');
    expect(await screen.findByText(/, hoje$/)).toBeInTheDocument();
  });

  it('o mês na URL vai para a api e o seletor troca de mês', async () => {
    const { calendar } = setup('rh', '/rh/ferias?month=2026-11');
    await screen.findByRole('table', { name: /Calendário/ });
    expect(calendar).toHaveBeenCalledWith({ establishmentId: '1', month: '2026-11' }, expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
    const { router } = await import('../../../test/navigation');
    expect(router.replace).toHaveBeenCalledWith('/rh/ferias?month=2026-12', { scroll: false });
  });

  it('mês sem férias mostra o vazio com "Lançar férias"', async () => {
    setup('rh', '/rh/ferias?month=2027-03');
    expect(await screen.findByText('Nenhum período de férias em março de 2027')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Lançar férias' })).toHaveLength(2);
  });

  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const { calendar } = setup('rh', '/rh/ferias?month=2026-12', { calendar: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(calendar).toHaveBeenCalledTimes(2));
  });

  it('403 e 404 mostram a mesma tela', async () => {
    const view = setup('rh', '/rh/ferias', { calendar: async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    view.unmount();
    setup('rh', '/rh/ferias', { calendar: async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('"em breve" quando o back não tem o calendário', async () => {
    setup('rh', '/rh/ferias', { calendar: async () => { throw new ApiError('unavailable', 0, 'EM_BREVE', 'x'); } });
    expect(await screen.findByText(/Em breve/)).toBeInTheDocument();
  });
});

describe('Férias: permissões', () => {
  it('colaborador não acessa e não dispara a busca', async () => {
    const { calendar } = setup('colaborador');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(calendar).not.toHaveBeenCalled();
  });

  it('RH decide e lança; "Exportar calendário" fica desabilitado', async () => {
    setup('rh');
    await screen.findByRole('table', { name: /Calendário/ });
    expect(screen.getByRole('button', { name: 'Lançar férias' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Aprovar férias de Daniela Costa/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Exportar calendário' })).toBeDisabled();
  });

  it('gestor decide mas não lança; admin lança e decide', async () => {
    const view = setup('gestor');
    await screen.findByRole('table', { name: /Calendário/ });
    expect(screen.queryByRole('button', { name: 'Lançar férias' })).toBeNull();
    expect(screen.getByRole('button', { name: /Aprovar férias de Daniela Costa/ })).toBeInTheDocument();
    view.unmount();
    setup('admin');
    await screen.findByRole('table', { name: /Calendário/ });
    expect(screen.getByRole('button', { name: 'Lançar férias' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar férias de Daniela Costa/ })).toBeInTheDocument();
  });
});

describe('Férias: decisão', () => {
  it('aprova dentro do limite e chama a api com o ID do pedido', async () => {
    const { approve } = setup();
    await userEvent.click(await screen.findByRole('button', { name: /Aprovar férias de Daniela Costa/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    const id = approve.mock.calls[0]?.[0] as string;
    const after = await mockVacationsApi.calendar({ establishmentId: '1', month: '2026-12' });
    expect(after.departments[0]?.rows.find((r) => r.vacationId === id)?.status).toBe('aprovada');
  });

  it('acima do limite: o botão fica habilitado, o diálogo avisa e o 409 mostra o motivo e a próxima janela', async () => {
    setup('rh', `/rh/ferias?month=2026-12&departmentId=${AGRO}`);
    const button = await screen.findByRole('button', { name: /Aprovar férias de Tereza Gomes/ });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/passa do limite de 2 pessoas/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprovar' }));
    expect(await within(dialog).findByText(/O setor ficaria desfalcado nesse intervalo/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Próxima janela livre: 17\/12\./)).toBeInTheDocument();
  });

  it('recusar exige o motivo', async () => {
    const { reject } = setup();
    await userEvent.click(await screen.findByRole('button', { name: /Recusar férias de Daniela Costa/ }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Recusar' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo da recusa/), 'Equipe reduzida');
    await userEvent.click(confirm);
    await waitFor(() => expect(reject).toHaveBeenCalledWith(expect.any(String), { reason: 'Equipe reduzida' }));
  });
});

describe('Férias: colaborador', () => {
  it('mostra os períodos com direito, saldo e histórico, e permite cancelar férias futuras aprovadas (RH)', async () => {
    const { cancel } = setup('rh', '/rh/ferias?month=2026-12&employeeId=103');
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('Direito')).toBeInTheDocument();
    expect(within(panel).getByText('Saldo')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /Cancelar férias de 01\/12\/2026/ }));
    const dialog = await screen.findByRole('alertdialog');
    // O back exige motivo no cancelamento: sem ele o botão fica desabilitado.
    expect(within(dialog).getByRole('button', { name: 'Cancelar férias' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Mudança de escala');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar férias' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(expect.any(String), { reason: 'Mudança de escala' }));
  });

  it('gestor vê os períodos sem os botões de cancelar e lançar', async () => {
    setup('gestor', '/rh/ferias?month=2026-12&employeeId=103');
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByText('Direito')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Cancelar férias de/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Lançar férias' })).toBeNull();
  });

  it('"Lançar férias" abre o painel para escolher o colaborador', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Lançar férias' }));
    const panel = await screen.findByRole('dialog', { name: 'Lançar férias' });
    expect(within(panel).getByRole('combobox', { name: /Colaborador/ })).toBeInTheDocument();
  });

  it('o lançamento mostra a mensagem do 409 FERIAS_* da api', async () => {
    const { request } = setup('rh', '/rh/ferias?month=2026-12&employeeId=103', {
      request: async () => { throw new ApiError('conflict', 409, 'FERIAS_SALDO_INSUFICIENTE', 'Os dias pedidos passam do direito do período aquisitivo'); },
    });
    const panel = await screen.findByRole('dialog');
    await userEvent.click(await within(panel).findByRole('button', { name: 'Lançar férias' }));
    const form = within(panel).getByRole('form', { name: 'Lançar férias' });
    await userEvent.click(within(form).getByRole('combobox', { name: /Período aquisitivo/ }));
    await userEvent.click(await screen.findByRole('option'));
    await userEvent.type(within(form).getByLabelText(/Primeiro dia/), '2027-02-01');
    await userEvent.type(within(form).getByLabelText(/Último dia/), '2027-02-10');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar férias' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('103', expect.objectContaining({ startDate: '2027-02-01', endDate: '2027-02-10', cashBonusDays: 0 })));
    expect(await within(form).findByText('Os dias pedidos passam do direito do período aquisitivo')).toBeInTheDocument();
  });
});

describe('mock de férias', () => {
  it('aprovar pedido acima do limite devolve 409 FERIAS_SETOR_DESFALCADO com a próxima janela', async () => {
    const cal = await mockVacationsApi.calendar({ establishmentId: '1', month: '2026-12' });
    const row = cal.departments.flatMap((d) => d.rows).find((r) => r.exceedsLimit && r.status === 'solicitada');
    expect(row).toBeDefined();
    await expect(mockVacationsApi.approve(row?.vacationId ?? '')).rejects.toMatchObject({
      status: 409, code: 'FERIAS_SETOR_DESFALCADO', fields: [{ path: 'nextFreeStartDate', message: '2026-12-17' }],
    });
  });

  it('recusar e cancelar mudam o estado lido depois', async () => {
    const cal = await mockVacationsApi.calendar({ establishmentId: '1', month: '2026-12' });
    const pending = cal.departments[0]?.rows.find((r) => r.status === 'solicitada');
    await mockVacationsApi.reject(pending?.vacationId ?? '', { reason: 'Equipe reduzida' });
    const after = await mockVacationsApi.calendar({ establishmentId: '1', month: '2026-12' });
    expect(after.departments[0]?.rows.find((r) => r.vacationId === pending?.vacationId)?.status).toBe('recusada');
    await expect(mockVacationsApi.approve(pending?.vacationId ?? '')).rejects.toMatchObject({ code: 'STATUS_INVALIDO' });
  });

  it('lançar férias cria um pedido solicitado e o saldo respeita o direito', async () => {
    const [period] = await mockVacationsApi.periods('115');
    const created = await mockVacationsApi.request('115', { accrualPeriodId: period?.id ?? '', startDate: '2027-03-01', endDate: '2027-03-10' });
    expect(created.status).toBe('solicitada');
    await expect(
      mockVacationsApi.request('115', { accrualPeriodId: period?.id ?? '', startDate: '2027-04-01', endDate: '2027-06-30' }),
    ).rejects.toMatchObject({ code: 'FERIAS_SALDO_INSUFICIENTE' });
  });
});
