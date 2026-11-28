import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { toApiError } from '@/lib/api/errors';
import { MOCK_SESSION_KEY } from '@/lib/api/mocks';
import { resetMockEmployees } from '@/lib/api/mocks/employees';
import { mockSchedulesApi, resetMockSchedules } from '@/lib/api/mocks/schedules';
import { renderWithSession } from '../../../test/render';
import { SchedulesScreen } from './SchedulesScreen';

type R = Exclude<Role, 'super_admin'>;
const asSession = (role: R) => window.sessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify({ role, pending2fa: false }));

function setup(role: R = 'rh', overrides: Partial<typeof mockSchedulesApi> = {}, route = '/rh/escalas') {
  asSession(role);
  const spies = {
    list: vi.fn(overrides.list ?? mockSchedulesApi.list),
    get: vi.fn(overrides.get ?? mockSchedulesApi.get),
    create: vi.fn(overrides.create ?? mockSchedulesApi.create),
    update: vi.fn(overrides.update ?? mockSchedulesApi.update),
    employeeSchedules: vi.fn(overrides.employeeSchedules ?? mockSchedulesApi.employeeSchedules),
    assign: vi.fn(overrides.assign ?? mockSchedulesApi.assign),
  };
  return { ...renderWithSession(<SchedulesScreen />, { role, route, api: { schedules: spies } }), ...spies };
}

beforeEach(() => {
  resetMockSchedules();
  resetMockEmployees();
});

describe('Escalas: lista e detalhe', () => {
  it('lista as escalas do estabelecimento com tipo, ciclo e carga', async () => {
    const { list } = setup();
    expect(await screen.findByText('Campo 6x1 · 44 h')).toBeInTheDocument();
    expect(screen.getByText('Ordenha 12x36')).toBeInTheDocument();
    expect(screen.getByText('Cíclica · 2 dias')).toBeInTheDocument();
    expect(screen.getAllByText('44:00').length).toBeGreaterThan(0);
    expect(list).toHaveBeenCalledWith({ establishmentId: '1' }, expect.anything());
  });

  it('vazio, erro com retry e 403/404', async () => {
    const { unmount } = setup('rh', { list: async () => [] });
    expect(await screen.findByText('Nenhuma escala')).toBeInTheDocument();
    unmount();
    const list = vi.fn().mockRejectedValueOnce(toApiError(500, {})).mockImplementation(mockSchedulesApi.list);
    const second = setup('rh', { list });
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Campo 6x1 · 44 h')).toBeInTheDocument();
    second.unmount();
    for (const status of [403, 404]) {
      const v = setup('rh', { list: async () => { throw toApiError(status, {}); } });
      expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
      v.unmount();
    }
  });

  it('avisos aparecem no detalhe com o texto da api e nunca bloqueiam', async () => {
    setup();
    await userEvent.click(await screen.findByText('Campo 6x1 · 44 h'));
    const panel = await screen.findByRole('dialog', { name: 'Campo 6x1 · 44 h' });
    expect(within(panel).getByText(/Carga semanal acima do limite\./)).toBeInTheDocument();
    expect(within(panel).getByText(/42:00/)).toBeInTheDocument();
    expect(within(panel).getByText(/16\/12\/2026/)).toBeInTheDocument();
    expect(within(panel).getAllByText(/nunca impedem salvar/).length).toBeGreaterThan(0);
    expect(within(panel).getByText('Folga')).toBeInTheDocument();
  });

  it('?aviso= pré-filtra as escalas com aquele aviso', async () => {
    setup('rh', {}, '/rh/escalas?aviso=folgas_abaixo_minimo');
    expect(await screen.findByText('Plantão livre')).toBeInTheDocument();
    expect(screen.queryByText('Campo 6x1 · 44 h')).toBeNull();
    expect(screen.queryByText('Ordenha 12x36')).toBeNull();
  });

  it('?aviso=carga_semanal_acima_limite mostra as duas escalas acima do limite', async () => {
    setup('rh', {}, '/rh/escalas?aviso=carga_semanal_acima_limite');
    expect(await screen.findByText('Campo 6x1 · 44 h')).toBeInTheDocument();
    expect(screen.getByText('Administrativo 5x2 · 44 h')).toBeInTheDocument();
    expect(screen.queryByText('Plantão livre')).toBeNull();
  });

  it('permissão: rh e admin editam; gestor vê 403 da tela', async () => {
    const rh = setup('rh');
    expect(await screen.findByRole('button', { name: 'Nova escala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atribuir escala' })).toBeInTheDocument();
    rh.unmount();
    const admin = setup('admin');
    await screen.findByText('Campo 6x1 · 44 h');
    expect(screen.getByRole('button', { name: 'Nova escala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atribuir escala' })).toBeInTheDocument();
    admin.unmount();
    const gestor = setup('gestor');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(gestor.list).not.toHaveBeenCalled();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = setup();
    await screen.findByText('Campo 6x1 · 44 h');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Escalas: criar, editar e atribuir', () => {
  it('cria uma escala semanal e o corpo vai certo, mesmo com aviso de carga', async () => {
    const { create } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Nova escala' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova escala' });
    await userEvent.type(within(dialog).getByLabelText(/Nome da escala/), 'Turno longo');
    await userEvent.type(within(dialog).getByLabelText(/Carga semanal/), '50:00');
    for (let p = 1; p <= 7; p++) {
      if (p <= 5) {
        fireEvent.change(within(dialog).getByLabelText(`Entrada do dia ${p}`), { target: { value: '07:00' } });
        fireEvent.change(within(dialog).getByLabelText(`Saída do dia ${p}`), { target: { value: '17:00' } });
      } else {
        await userEvent.click(within(dialog).getByRole('checkbox', { name: `Folga no dia ${p}` }));
      }
    }
    const save = within(dialog).getByRole('button', { name: 'Salvar' });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ establishmentId: '1', name: 'Turno longo', type: '5x2', cycleType: 'semanal', weeklyMinutes: 3000 });
    expect(create.mock.calls[0]?.[0].days).toHaveLength(7);
    // Salvou apesar do aviso de carga, e a lista já mostra a escala nova.
    expect(await screen.findByText('Turno longo')).toBeInTheDocument();
    const list = await mockSchedulesApi.list({ establishmentId: '1' });
    expect(list.some((s) => s.name === 'Turno longo')).toBe(true);
  });

  it('na edição tipo e ciclo são somente leitura e salvar chama update só com nome, carga e dias', async () => {
    const { update } = setup();
    await userEvent.click(await screen.findByText('Ordenha 12x36'));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar escala' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar escala' });
    expect(within(dialog).getByLabelText('Tipo')).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText('Ciclo')).toHaveAttribute('readonly');
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    const name = within(dialog).getByLabelText(/Nome da escala/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Ordenha noturna');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('3', expect.objectContaining({ name: 'Ordenha noturna', weeklyMinutes: 2520 })));
    expect(Object.keys(update.mock.calls[0]?.[1] ?? {}).sort()).toEqual(['days', 'name', 'weeklyMinutes']);
  });

  it('escala com aviso continua salvável (botão Salvar nunca desabilitado por aviso)', async () => {
    setup();
    await userEvent.click(await screen.findByText('Campo 6x1 · 44 h'));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar escala' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar escala' });
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('atribui a escala a um colaborador com vigência', async () => {
    const { assign } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Atribuir escala' }));
    const dialog = await screen.findByRole('dialog', { name: 'Atribuir escala' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Colaborador/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Maria Aparecida Souza/ }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Escala/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Plantão livre' }));
    fireEvent.change(within(dialog).getByLabelText(/Início da vigência/), { target: { value: '2027-01-01' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Atribuir' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('103', { scheduleId: '4', validFrom: '2027-01-01', validTo: null }));
  });
});

describe('mock de schedules', () => {
  it('criar muda o que a próxima leitura devolve e vigência sobreposta dá 409', async () => {
    const created = await mockSchedulesApi.create({
      establishmentId: '1', name: 'Nova', type: 'livre', cycleType: 'semanal', weeklyMinutes: 3000,
      days: [{ position: 0, startTime: '08:00', endTime: '16:00' }],
    });
    expect((await mockSchedulesApi.get(created.id)).warnings.map((w) => w.code)).toContain('carga_semanal_acima_limite');
    await expect(mockSchedulesApi.assign('101', { scheduleId: '2', validFrom: '2024-01-01' })).rejects.toMatchObject({ status: 409, code: 'ESCALA_SOBREPOSTA' });
  });
});
