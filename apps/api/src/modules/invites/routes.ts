/**
 * Convites sob /portal: o `admin` convida `admin` e `rh` para a própria conta (a da sessão), e as duas
 * rotas públicas do aceite (public-routes.ts). Admin restrito a alguns estabelecimentos recebe 403: o
 * usuário criado pelo convite enxerga a conta inteira.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import type { PortalDeps } from '../portal/deps';
import { idParams } from '../../http/schemas';
import { findEmployeeInScope } from '../employees/lookup';
import { publicInviteRoutes } from './public-routes';
import {
  createdEmployeeAccessResponse, createdInviteResponse, createEmployeeAccessBody, createInviteBody, employeeAccessResponse,
  inviteIdParams, inviteListResponse, inviteResponse,
} from './schemas';
import { InviteService, type InviteActor } from './service';

const tags = ['Convites'];

function actorOf(ctx: RequestContext): InviteActor {
  if (ctx.establishmentScope !== null) throw new HttpError(403, 'FORBIDDEN', 'Só o administrador da conta inteira pode gerenciar convites');
  return { tenantId: tenantOf(ctx), userId: ctx.userId };
}

export const inviteRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new InviteService({ db: deps.db, clock: deps.clock, cpfHashKey: deps.inviteCpfHashKey });
  const admin = app.authorize('admin');

  app.get(
    '/invites',
    { preHandler: [admin], schema: { tags, summary: 'Lista os convites da conta', response: { 200: inviteListResponse } } },
    async (req) => ({ data: await service.list(actorOf(req.ctx!).tenantId) }),
  );

  app.post(
    '/invites',
    {
      preHandler: [admin],
      schema: { tags, summary: 'Convida um admin ou rh; o token do link sai só nesta resposta', body: createInviteBody, response: { 201: createdInviteResponse } },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return reply.code(201).send({ data: await service.create(actorOf(req.ctx!), req.body) });
    },
  );

  app.post(
    '/invites/:inviteId/revoke',
    { preHandler: [admin], schema: { tags, summary: 'Revoga um convite pendente', params: inviteIdParams, response: { 200: inviteResponse } } },
    async (req) => ({ data: await service.revoke(actorOf(req.ctx!), req.params.inviteId) }),
  );

  // Acesso do colaborador ao portal (/me): rh e admin, dentro do próprio escopo (fora dele, 404).
  const employeeManagers = app.authorize('rh', 'admin');
  const employeeActor = async (ctx: RequestContext, employeeId: number): Promise<InviteActor> => {
    await findEmployeeInScope(deps.db, ctx, employeeId);
    return { tenantId: tenantOf(ctx), userId: ctx.userId };
  };

  app.get(
    '/employees/:id/access',
    { preHandler: [employeeManagers], schema: { tags, summary: 'Situação do acesso do colaborador ao portal', params: idParams, response: { 200: employeeAccessResponse } } },
    async (req) => ({ data: await service.employeeAccess((await employeeActor(req.ctx!, req.params.id)).tenantId, req.params.id) }),
  );

  app.post(
    '/employees/:id/access-invite',
    {
      preHandler: [employeeManagers],
      schema: {
        tags,
        summary: 'Convida o colaborador para o portal (nome e CPF do cadastro); o token do link sai só nesta resposta',
        params: idParams,
        body: createEmployeeAccessBody,
        response: { 201: createdEmployeeAccessResponse },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const actor = await employeeActor(req.ctx!, req.params.id);
      return reply.code(201).send({ data: await service.createForEmployee(actor, req.params.id, req.body.email) });
    },
  );

  app.post(
    '/employees/:id/access-invite/revoke',
    { preHandler: [employeeManagers], schema: { tags, summary: 'Cancela o convite de acesso pendente do colaborador', params: idParams, response: { 200: employeeAccessResponse } } },
    async (req) => ({ data: await service.revokeForEmployee(await employeeActor(req.ctx!, req.params.id), req.params.id) }),
  );

  await app.register(publicInviteRoutes, { ...deps, service });
};
