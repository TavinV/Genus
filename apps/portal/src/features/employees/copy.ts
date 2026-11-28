/** Textos da tela de colaboradores (pt-BR). */
export const COPY = {
  title: 'Colaboradores',
  subtitle: 'Cadastro, vínculos e desligamento. As marcações nunca são alteradas por aqui.',
  newEmployee: 'Novo colaborador',
  searchLabel: 'Buscar colaborador por nome ou matrícula',
  tabsLabel: 'Situação dos colaboradores',
  tableCaption: 'Colaboradores',
  empty: { title: 'Nenhum colaborador', text: 'Não há colaboradores nesta visão. Cadastre o primeiro para começar a apurar as marcações.' },
  emptySearchText: 'Confira a grafia ou busque pela matrícula. Limpe o campo para ver todos.',
  cpfReadOnlyHint: 'O CPF liga o colaborador às marcações e não muda.',
  establishmentReadOnlyHint: 'O estabelecimento não muda depois do cadastro.',
  noActiveEstablishment: 'Não há estabelecimento ativo no seu acesso. Peça a ativação antes de cadastrar.',
  portalAccess: {
    action: 'Acesso ao portal',
    title: (name: string) => `Acesso ao portal: ${name}`,
    description: 'Pelo portal, no celular ou no computador, o colaborador vê o espelho de ponto, o banco de horas e as férias, envia atestados e pede ajustes. Ele não bate ponto por lá.',
    status: {
      sem_acesso: { label: 'Sem acesso', tone: 'neutral' },
      convite_pendente: { label: 'Convite pendente', tone: 'info' },
      ativo: { label: 'Com acesso', tone: 'good' },
      inativo: { label: 'Acesso desativado', tone: 'warn' },
    },
    email: 'E-mail do colaborador',
    emailHint: 'Ele entra com este e-mail e a senha que criar ao aceitar o convite.',
    emailInvalid: 'Informe um e-mail válido.',
    send: 'Criar convite',
    resend: 'Criar novo convite',
    revoke: 'Cancelar convite',
    revoked: 'Convite cancelado',
    pendingText: (email: string, until: string) => `Convite enviado para ${email}, vale até ${until}. Um convite novo cancela este.`,
    activeText: (email: string) => `Entra em /login com ${email} e a senha dele.`,
    inactiveText: 'O acesso foi desativado (por exemplo, no desligamento).',
    close: 'Fechar',
  },
  resetPin: {
    action: 'Gerar novo PIN',
    title: (name: string) => `Gerar novo PIN para ${name}?`,
    description: 'Use quando o colaborador esqueceu o PIN. O PIN atual deixa de valer na hora e o novo aparece uma única vez.',
    confirm: 'Gerar novo PIN',
    done: 'Novo PIN gerado',
  },
  pinReset: {
    title: 'Novo PIN',
    text: 'Anote este PIN e entregue ao colaborador. O anterior não vale mais. Ele aparece só agora: depois que você fechar esta janela, não há como ver de novo.',
  },
  pin: {
    title: 'PIN inicial',
    text: 'Anote este PIN e entregue ao colaborador. Ele aparece só agora: depois que você fechar esta janela, não há como ver de novo.',
    copy: 'Copiar PIN',
    copied: 'PIN copiado',
    ack: 'Anotei o PIN',
    close: 'Concluir',
  },
  terminate: {
    title: 'Desligar colaborador',
    description: 'O desligamento encerra o vínculo a partir da data informada. As marcações já registradas continuam guardadas e nada é apagado (Portaria 671).',
    confirm: 'Desligar',
    reason: 'Motivo do desligamento',
  },
} as const;

export const STATUS_TABS = ['ativo', 'desligado', 'todos'] as const;
export type StatusTab = (typeof STATUS_TABS)[number];
export const PAGE_SIZE = 25;
