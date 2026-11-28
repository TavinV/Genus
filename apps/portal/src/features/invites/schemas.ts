import { z } from 'zod';
import { INVITE_ROLES } from '@/lib/api/organization-contracts';
import { cpfLooksValid, digitsOf } from '@/lib/cpf';

/** Mesmo mínimo e máximo do auth.ts da api. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const cpf = z.string().refine((v) => cpfLooksValid(digitsOf(v)), 'CPF inválido: confira os números.');

export const inviteSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome (pelo menos 2 letras).').max(120, 'O nome pode ter até 120 caracteres.'),
  email: z.string().trim().min(1, 'Informe o e-mail.').pipe(z.email('Informe um e-mail válido.')),
  role: z.enum(INVITE_ROLES),
  /** '' = toda a conta; senão o id da empresa. */
  companyId: z.string(),
  cpf,
});
export type InviteValues = z.output<typeof inviteSchema>;

export const acceptSchema = z
  .object({
    cpf,
    password: z.string().min(PASSWORD_MIN, `A senha precisa de pelo menos ${PASSWORD_MIN} caracteres.`).max(PASSWORD_MAX, `A senha pode ter até ${PASSWORD_MAX} caracteres.`),
    confirmation: z.string().min(1, 'Repita a senha.'),
  })
  .refine((v) => v.password === v.confirmation, { path: ['confirmation'], message: 'As senhas não são iguais.' });
export type AcceptValues = z.output<typeof acceptSchema>;
