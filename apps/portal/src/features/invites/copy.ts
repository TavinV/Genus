/** Textos e erros dos convites (pt-BR). */
import { ApiError, asApiError } from '@/lib/api/errors';
import type { InviteStatus } from '@/lib/api/organization-contracts';
import type { LabelTone } from '@/lib/labels';

export const INVITE_STATUS_LABEL: Record<InviteStatus, { label: string; tone: LabelTone }> = {
  pendente: { label: 'Pendente', tone: 'info' },
  aceito: { label: 'Aceito', tone: 'good' },
  revogado: { label: 'Revogado', tone: 'neutral' },
  expirado: { label: 'Expirado', tone: 'warn' },
};

export const INVITE_ERRORS: Record<string, string> = {
  EMAIL_IN_USE: 'Este e-mail já tem um usuário na plataforma.',
  CPF_INVALIDO: 'CPF inválido: confira os números.',
  CPF_NAO_CONFERE: 'O CPF não confere com o do convite. Depois de 5 tentativas erradas, o convite é cancelado.',
  CONVITE_INVALIDO: 'Este convite não vale mais.',
  COLABORADOR_COM_ACESSO: 'Este colaborador já tem acesso ao portal.',
  COLABORADOR_DESLIGADO: 'O colaborador está desligado e não pode receber acesso.',
  EMPRESA_SEM_ESTABELECIMENTO: 'A empresa do convite ainda não tem estabelecimento. Peça um novo convite.',
};
export const RATE_LIMITED_MESSAGE = 'Muitas tentativas. Espere alguns minutos e tente de novo.';

/** Erro da api com a mensagem em pt-BR do código; 429 vira o aviso de limite. Os demais passam como vieram. */
export function inviteError(e: unknown): ApiError {
  const err = asApiError(e);
  const message = err.status === 429 ? RATE_LIMITED_MESSAGE : Object.hasOwn(INVITE_ERRORS, err.code) ? INVITE_ERRORS[err.code] : undefined;
  return message ? new ApiError(err.kind, err.status, err.code, message, err.fields) : err;
}

export const COPY = {
  section: 'Convites',
  sectionHint: 'Administradores e RH entram por um link de uso único, confirmando o CPF.',
  invite: 'Convidar',
  tableCaption: 'Convites',
  empty: { title: 'Nenhum convite', text: 'Convide um administrador ou alguém do RH para criar o acesso ao portal.' },
  revoke: 'Revogar',
  revokeLabel: (name: string) => `Revogar o convite de ${name}`,
  revoked: 'Convite revogado',
  revokeConfirm: {
    title: 'Revogar este convite?',
    description: (name: string) => `O link enviado a ${name} deixa de funcionar. Para dar acesso depois, crie um novo convite.`,
    confirm: 'Revogar convite',
  },
  form: {
    title: 'Convidar usuário',
    description: 'O portal não envia e-mail: você copia o link e entrega à pessoa. Um novo convite para o mesmo e-mail cancela o pendente.',
    name: 'Nome completo',
    email: 'E-mail',
    role: 'Perfil',
    access: 'Acesso',
    accessHint: 'Restrito a uma empresa, a pessoa só enxerga os estabelecimentos dela.',
    wholeAccount: 'Toda a conta',
    cpf: 'CPF',
    cpfHint: 'A pessoa precisa digitar este CPF para aceitar o convite.',
    submit: 'Criar convite',
    cancel: 'Cancelar',
  },
  link: {
    title: 'Link do convite',
    forPerson: (name: string, email: string) => `Convite de ${name} (${email}).`,
    warning: 'Este link aparece só agora. Copie e entregue à pessoa por um canal seguro.',
    needsOwnCpf: (until: string) => `Para aceitar, o colaborador confirma o próprio CPF (o do cadastro) e cria a senha. O link vale uma vez, até ${until}.`,
    needsCpf: (until: string) => `Para aceitar, a pessoa vai precisar do CPF que você informou. O link vale uma vez, até ${until}.`,
    copy: 'Copiar link',
    copied: 'Link copiado',
    copyFailed: 'Não foi possível copiar. Selecione o link e copie à mão.',
    done: 'Copiei o link',
    close: 'Fechar',
  },
  users: { title: 'Usuários', subtitle: 'Convites para administradores e RH desta conta ou de uma das empresas dela.' },
  wholeAccount: 'Toda a conta',
  inviteToCompany: 'Convidar usuário',
  inviteToCompanyLabel: (company: string) => `Convidar usuário para ${company}`,
  accept: {
    title: 'Aceitar convite',
    subtitle: 'Confirme seu CPF e defina a senha de acesso ao portal.',
    loading: 'Conferindo o convite…',
    tenant: 'Conta',
    company: 'Empresa',
    name: 'Nome',
    email: 'E-mail',
    role: 'Perfil',
    expiresAt: 'Vale até',
    cpf: 'Seu CPF',
    password: 'Senha',
    passwordHint: 'Pelo menos 8 caracteres.',
    confirmation: 'Repita a senha',
    submit: 'Criar acesso',
    invalidTitle: 'Convite inválido',
    invalidText: 'O link não vale mais: pode ter expirado, já ter sido usado ou ter sido cancelado. Peça um novo convite a quem enviou.',
    missingTitle: 'Link incompleto',
    missingText: 'Abra de novo o link completo que você recebeu. Se recarregou esta página, o link precisa ser aberto outra vez.',
    errorTitle: 'Não foi possível conferir o convite',
    retry: 'Tentar de novo',
    login: 'Ir para o login',
    done: 'Acesso criado',
    doneText: (email: string) => `Entre com ${email} e a senha que você definiu.`,
  },
} as const;
