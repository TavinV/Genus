import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockInvitesApi, resetMockInvites } from '@/lib/api/mocks/invites';
import { renderWithSession } from '../../../test/render';
import { UsersScreen } from './UsersScreen';

const CPF = '11144477735';

beforeEach(() => resetMockInvites());

describe('/rh/usuarios', () => {
  it('convida só para uma empresa: o campo Acesso manda o id da empresa e a lista mostra o nome', async () => {
    const create = vi.fn(mockInvitesApi.create);
    renderWithSession(<UsersScreen />, { role: 'admin', api: { invites: { create } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Convidar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Nome completo/), 'Bruno Reis');
    await userEvent.type(within(dialog).getByLabelText(/^E-mail/), 'bruno@exemplo.test');
    await userEvent.type(within(dialog).getByLabelText(/^CPF/), CPF);
    await userEvent.click(within(dialog).getByLabelText(/^Acesso/));
    await userEvent.click(await screen.findByRole('option', { name: 'Usina Boa Vista S.A.' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar convite' }));
    await screen.findByTestId('invite-link');
    expect(create).toHaveBeenCalledWith(null, expect.objectContaining({ email: 'bruno@exemplo.test', companyId: '2' }));
  });

  it('só o admin acessa; o rh não consulta os convites', async () => {
    const list = vi.fn(mockInvitesApi.list);
    renderWithSession(<UsersScreen />, { role: 'rh', api: { invites: { list } } });
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('cria o convite, mostra o link uma vez e não deixa CPF nem token em cache', async () => {
    const create = vi.fn(mockInvitesApi.create);
    const { queryClient } = renderWithSession(<UsersScreen />, { role: 'admin', api: { invites: { create } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Convidar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Nome completo/), 'Ana Souza');
    await userEvent.type(within(dialog).getByLabelText(/^E-mail/), 'ana@exemplo.test');
    await userEvent.type(within(dialog).getByLabelText(/^CPF/), CPF);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar convite' }));

    const link = await screen.findByTestId('invite-link');
    expect(create).toHaveBeenCalledWith(null, { name: 'Ana Souza', email: 'ana@exemplo.test', role: 'rh', cpf: CPF, companyId: null });
    const { token } = await (create.mock.results[0]?.value as ReturnType<typeof create>);
    expect(link).toHaveTextContent(`${window.location.origin}/convite#${token}`);
    expect(screen.getByText(/vai precisar do CPF/)).toBeInTheDocument();
    const cached = JSON.stringify([
      queryClient.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]),
      queryClient.getMutationCache().getAll().map((m) => [m.state.variables, m.state.data]),
    ]);
    expect(cached).not.toContain(CPF);
    expect(cached).not.toContain(token);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Copiei o link' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByTestId('invite-link')).toBeNull());
    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
  });

  it('revoga depois de confirmar', async () => {
    const revoke = vi.fn(mockInvitesApi.revoke);
    renderWithSession(<UsersScreen />, { role: 'admin', api: { invites: { revoke } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Revogar o convite de Teresa Campos' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revogar convite' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(null, '1'));
    expect(await screen.findByText('Revogado')).toBeInTheDocument();
  });
});
