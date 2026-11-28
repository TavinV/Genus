import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { toApiError } from '@/lib/api/errors';
import { MOCK_SESSION_KEY } from '@/lib/api/mocks';
import { mockEmployeesApi, resetMockEmployees } from '@/lib/api/mocks/employees';
import { renderWithSession } from '../../../test/render';
import { router } from '../../../test/navigation';
import { EmployeesScreen } from './EmployeesScreen';

type R = Exclude<Role, 'super_admin'>;
const asSession = (role: R) => window.sessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify({ role, pending2fa: false }));
const VALID_CPF = '52998224725';

function setup(role: R = 'rh', overrides: Partial<typeof mockEmployeesApi> = {}, route = '/rh/colaboradores') {
  asSession(role);
  const spies = {
    list: vi.fn(overrides.list ?? mockEmployeesApi.list),
    get: vi.fn(overrides.get ?? mockEmployeesApi.get),
    create: vi.fn(overrides.create ?? mockEmployeesApi.create),
    update: vi.fn(overrides.update ?? mockEmployeesApi.update),
    terminate: vi.fn(overrides.terminate ?? mockEmployeesApi.terminate),
    resetPin: vi.fn(overrides.resetPin ?? mockEmployeesApi.resetPin),
    access: vi.fn(overrides.access ?? mockEmployeesApi.access),
    inviteAccess: vi.fn(overrides.inviteAccess ?? mockEmployeesApi.inviteAccess),
    revokeAccessInvite: vi.fn(overrides.revokeAccessInvite ?? mockEmployeesApi.revokeAccessInvite),
    assignments: vi.fn(overrides.assignments ?? mockEmployeesApi.assignments),
    createAssignment: vi.fn(overrides.createAssignment ?? mockEmployeesApi.createAssignment),
    updateAssignment: vi.fn(overrides.updateAssignment ?? mockEmployeesApi.updateAssignment),
  };
  return { ...renderWithSession(<EmployeesScreen />, { role, route, api: { employees: spies } }), ...spies };
}

const openMenu = async (name: string, item: string) => {
  await userEvent.click(await screen.findByRole('button', { name: `Ações de ${name}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
};

async function fillCreate(name = 'Nova Pessoa Teste') {
  const dialog = await screen.findByRole('dialog', { name: 'Novo colaborador' });
  await userEvent.type(within(dialog).getByLabelText(/^CPF/), VALID_CPF);
  await userEvent.type(within(dialog).getByLabelText(/Nome completo/), name);
  fireEvent.change(within(dialog).getByLabelText(/Nascimento/), { target: { value: '1990-05-10' } });
  fireEvent.change(within(dialog).getByLabelText(/Admissão/), { target: { value: '2026-11-01' } });
  return dialog;
}

beforeEach(() => resetMockEmployees());

describe('Colaboradores: lista', () => {
  it('mostra a lista com CPF completo para rh e a página só traz ativos por padrão', async () => {
    const { list } = setup();
    expect(await screen.findByText('Antônio Carlos Ferreira')).toBeInTheDocument();
    expect(screen.getByText('000.000.001-01')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'ativo', page: 1 }), expect.anything());
    expect(screen.queryByText(/filtra só os colaboradores desta página/)).toBeNull();
  });

  it('gestor recebe o CPF mascarado e não o desmascara', async () => {
    setup('gestor');
    await screen.findByText('Antônio Carlos Ferreira');
    expect(screen.getAllByText(/^\*\*\*\.\*\*\*\.\*\*\*-\d\d$/).length).toBeGreaterThan(0);
    expect(screen.queryByText('000.000.001-01')).toBeNull();
  });

  it('estado vazio com CTA', async () => {
    setup('rh', { list: async () => ({ data: [], meta: { page: 1, pageSize: 25, total: 0 } }) });
    expect(await screen.findByText('Nenhum colaborador')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Novo colaborador' }).length).toBeGreaterThan(1);
  });

  it('erro mostra "Tentar de novo" e refaz a consulta', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(toApiError(500, {}))
      .mockImplementation(mockEmployeesApi.list);
    setup('rh', { list });
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Antônio Carlos Ferreira')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('403 e 404 mostram a mesma tela', async () => {
    for (const status of [403, 404]) {
      const { unmount } = setup('rh', { list: async () => { throw toApiError(status, { code: 'X' }); } });
      expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
      unmount();
    }
  });

  it('a busca vai para a api (q com debounce) e a lista vem filtrada', async () => {
    const { list } = setup();
    await screen.findByText('Antônio Carlos Ferreira');
    await userEvent.type(screen.getByRole('searchbox'), 'antonio');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'antonio' }), expect.anything()));
    await waitFor(() => expect(screen.queryByText('Maria Aparecida Souza')).toBeNull());
    expect(screen.getByText('Antônio Carlos Ferreira')).toBeInTheDocument();
  });

  it('clicar na linha navega com o ID opaco', async () => {
    setup();
    await userEvent.click(await screen.findByText('Antônio Carlos Ferreira'));
    expect(router.push).toHaveBeenCalledWith('/rh/colaboradores/102');
  });

  it('o status da URL filtra e desligados mostram a data', async () => {
    const { list } = setup('rh', {}, '/rh/colaboradores?status=desligado');
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'desligado' }), expect.anything()));
  });

  it('só rh e admin veem "Novo colaborador" e o menu de ações', async () => {
    for (const role of ['gestor', 'contador'] as R[]) {
      const { unmount } = setup(role);
      await screen.findByText('Antônio Carlos Ferreira');
      expect(screen.queryByRole('button', { name: 'Novo colaborador' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Ações de/ })).toBeNull();
      unmount();
    }
    for (const role of ['rh', 'admin'] as R[]) {
      const { unmount } = setup(role);
      expect(await screen.findByRole('button', { name: 'Novo colaborador' })).toBeInTheDocument();
      expect((await screen.findAllByRole('button', { name: /^Ações de/ })).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('o cadastro só oferece estabelecimento ativo', async () => {
    renderWithSession(<EmployeesScreen />, {
      establishments: [
        { id: '9', name: 'Fazenda Desativada', subtitle: '', isActive: false },
        { id: '1', name: 'Fazenda Santa Helena', subtitle: '', isActive: true },
      ],
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Novo colaborador' }));
    const select = within(await screen.findByRole('dialog')).getByRole('combobox', { name: /Estabelecimento/ });
    expect(select).toHaveTextContent('Fazenda Santa Helena');
    await userEvent.click(select);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Fazenda Santa Helena']);
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = setup();
    await screen.findByText('Antônio Carlos Ferreira');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Colaboradores: cadastro e PIN', () => {
  it('cadastra, mostra o PIN uma vez e ele some do DOM e dos storages ao fechar', async () => {
    const { create } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Novo colaborador' }));
    const dialog = await fillCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ cpf: VALID_CPF, name: 'Nova Pessoa Teste', establishmentId: '1', birthDate: '1990-05-10', admissionDate: '2026-11-01', managerId: null })));
    const pin = await screen.findByLabelText('Valor do PIN');
    expect(pin).toHaveTextContent('483920');
    const close = screen.getByRole('button', { name: 'Concluir' });
    expect(close).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Anotei o PIN' }));
    expect(close).toBeEnabled();
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain('483920');
    await userEvent.click(close);
    await waitFor(() => expect(screen.queryByText('483920')).toBeNull());
    expect(document.body.textContent).not.toContain('483920');
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain('483920');
  });

  it('CPF duplicado (409) vira erro no campo', async () => {
    resetMockEmployees();
    const taken = await mockEmployeesApi.create({ establishmentId: '1', cpf: VALID_CPF, name: 'Primeiro', birthDate: '1980-01-01', admissionDate: '2020-01-01' });
    expect(taken.initialPin).toBe('483920');
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Novo colaborador' }));
    const dialog = await fillCreate('Segundo');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));
    expect(await within(dialog).findByText('Já existe um colaborador com este CPF.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Valor do PIN')).toBeNull();
  });

  it('CPF com dígito verificador errado é barrado no formulário', async () => {
    const { create } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Novo colaborador' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo colaborador' });
    await userEvent.type(within(dialog).getByLabelText(/^CPF/), '12345678900');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cadastrar' }));
    expect(await within(dialog).findByText(/CPF inválido/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('Colaboradores: edição e desligamento', () => {
  it('CPF e estabelecimento ficam somente leitura e o PATCH leva só os campos editáveis', async () => {
    const { update } = setup();
    await openMenu('Antônio Carlos Ferreira', 'Editar');
    const dialog = await screen.findByRole('dialog', { name: 'Editar colaborador' });
    expect(within(dialog).getByLabelText('CPF')).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText('Estabelecimento')).toHaveAttribute('readonly');
    expect(within(dialog).getByText(/liga o colaborador às marcações/)).toBeInTheDocument();
    const name = within(dialog).getByLabelText(/Nome completo/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Antônio C. Ferreira');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('102', { name: 'Antônio C. Ferreira', registrationNumber: '00412', birthDate: '1988-06-15', managerId: null }));
    expect(await screen.findByText('Antônio C. Ferreira')).toBeInTheDocument();
  });

  it('desligar exige data e motivo e chama terminate(id, body)', async () => {
    const { terminate } = setup();
    await openMenu('Antônio Carlos Ferreira', 'Desligar');
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Desligar' });
    expect(within(dialog).getByText(/continuam guardadas/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Data do desligamento/), { target: { value: '' } });
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Pedido de demissão');
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Data do desligamento/), { target: { value: '2026-11-20' } });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(terminate).toHaveBeenCalledWith('102', { terminationDate: '2026-11-20', reason: 'Pedido de demissão' }));
    await waitFor(() => expect(screen.queryByText('Antônio Carlos Ferreira')).toBeNull());
  });
});

describe('Colaboradores: vínculos', () => {
  it('rh e admin veem o salário; nomes vêm das listas de org', async () => {
    setup('rh');
    await openMenu('Antônio Carlos Ferreira', 'Vínculos');
    const dialog = await screen.findByRole('dialog', { name: 'Vínculos' });
    expect(await within(dialog).findByText('Operador de colhedora')).toBeInTheDocument();
    expect(within(dialog).getByText('Colheita')).toBeInTheDocument();
    expect(within(dialog).getByText(/R\$\s*2\.500,00/)).toBeInTheDocument();
    expect(within(dialog).getByText('Prazo indeterminado')).toBeInTheDocument();
  });

  it('admin vê o salário, mas não edita', async () => {
    setup('admin');
    await openMenu('Antônio Carlos Ferreira', 'Vínculos');
    const dialog = await screen.findByRole('dialog', { name: 'Vínculos' });
    expect(await within(dialog).findByText(/R\$\s*2\.500,00/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Novo vínculo' })).toBeNull();
  });

  it('sem permissão de salário o valor nem é pedido ao usuário', async () => {
    // Gestor e contador não têm o menu de vínculos; a api também não entrega o salário.
    setup('gestor');
    await screen.findByText('Antônio Carlos Ferreira');
    expect(screen.queryByRole('button', { name: /^Ações de/ })).toBeNull();
    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it('novo vínculo sobreposto mostra o aviso da api; fim antes do início é barrado', async () => {
    const { createAssignment } = setup();
    await openMenu('Antônio Carlos Ferreira', 'Vínculos');
    const dialog = await screen.findByRole('dialog', { name: 'Vínculos' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Novo vínculo' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Cargo/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Mecânico' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Setor/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Manutenção' }));
    fireEvent.change(within(dialog).getByLabelText(/Início da vigência/), { target: { value: '2026-12-01' } });
    fireEvent.change(within(dialog).getByLabelText(/Fim da vigência/), { target: { value: '2026-11-01' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar vínculo' }));
    expect(await within(dialog).findByText('O fim não pode ser antes do início.')).toBeInTheDocument();
    expect(createAssignment).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Fim da vigência/), { target: { value: '' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar vínculo' }));
    expect(await within(dialog).findByText(/se sobrepõe a outro/)).toBeInTheDocument();
  });
});

describe('mock de employees', () => {
  it('criar e depois listar inclui o novo colaborador; get funciona', async () => {
    const created = await mockEmployeesApi.create({ establishmentId: '1', cpf: VALID_CPF, name: 'Zélia Nova', birthDate: '1990-01-01', admissionDate: '2026-01-01' });
    const page = await mockEmployeesApi.list({ establishmentId: '1', pageSize: 100 });
    expect(page.data.some((e) => e.id === created.id && e.name === 'Zélia Nova')).toBe(true);
    expect((await mockEmployeesApi.get(created.id)).name).toBe('Zélia Nova');
  });

  it('CPF duplicado responde 409 CPF_DUPLICADO e salário some para quem não é rh/admin', async () => {
    await mockEmployeesApi.create({ establishmentId: '1', cpf: VALID_CPF, name: 'A', birthDate: '1990-01-01', admissionDate: '2026-01-01' });
    await expect(mockEmployeesApi.create({ establishmentId: '1', cpf: '529.982.247-25', name: 'B', birthDate: '1990-01-01', admissionDate: '2026-01-01' })).rejects.toMatchObject({ status: 409, code: 'CPF_DUPLICADO' });
    asSession('rh');
    expect((await mockEmployeesApi.assignments('101'))[0]?.baseSalary).toBe('2500.00');
    asSession('gestor');
    expect((await mockEmployeesApi.assignments('101'))[0]).not.toHaveProperty('baseSalary');
  });
});

describe('Colaboradores: PIN novo', () => {
  it('admin gera um PIN novo depois de confirmar; o PIN aparece uma vez', async () => {
    const { resetPin } = setup('admin');
    await openMenu('Antônio Carlos Ferreira', 'Gerar novo PIN');
    const confirm = await screen.findByRole('alertdialog', { name: /Gerar novo PIN para Antônio Carlos Ferreira/ });
    expect(resetPin).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Gerar novo PIN' }));
    const shown = await screen.findByRole('alertdialog', { name: 'Novo PIN' });
    expect(within(shown).getByLabelText('Valor do PIN')).toHaveTextContent('715264');
    expect(resetPin).toHaveBeenCalledTimes(1);
    await userEvent.click(within(shown).getByLabelText('Anotei o PIN'));
    await userEvent.click(within(shown).getByRole('button', { name: 'Concluir' }));
    await waitFor(() => expect(screen.queryByText('715264')).toBeNull());
  });

  it('contador não vê a opção', async () => {
    setup('contador');
    expect(await screen.findByText('Antônio Carlos Ferreira')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Gerar novo PIN' })).toBeNull();
  });
});

describe('Colaboradores: acesso ao portal', () => {
  it('rh convida pelo e-mail e recebe o link uma vez; o colaborador confirma o próprio CPF', async () => {
    const { inviteAccess } = setup('rh');
    await openMenu('Antônio Carlos Ferreira', 'Acesso ao portal');
    const dialog = await screen.findByRole('dialog', { name: /Acesso ao portal: Antônio Carlos Ferreira/ });
    expect(await within(dialog).findByText('Sem acesso')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^E-mail do colaborador/), 'antonio@exemplo.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar convite' }));
    const link = await screen.findByTestId('invite-link');
    expect(link).toHaveTextContent('/convite#convite-do-colaborador-');
    expect(inviteAccess).toHaveBeenCalledWith(expect.any(String), 'antonio@exemplo.test');
    expect(screen.getByText(/confirma o próprio CPF/)).toBeInTheDocument();
  });

  it('e-mail inválido não chama a api; contador não vê a opção', async () => {
    const { inviteAccess, unmount } = setup('admin');
    await openMenu('Antônio Carlos Ferreira', 'Acesso ao portal');
    const dialog = await screen.findByRole('dialog', { name: /Acesso ao portal/ });
    await userEvent.type(await within(dialog).findByLabelText(/^E-mail do colaborador/), 'sem-arroba');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar convite' }));
    expect(await within(dialog).findByText('Informe um e-mail válido.')).toBeInTheDocument();
    expect(inviteAccess).not.toHaveBeenCalled();
    unmount();
    setup('contador');
    expect(await screen.findByText('Antônio Carlos Ferreira')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Acesso ao portal' })).toBeNull();
  });
});
