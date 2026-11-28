/**
 * Colaborador e vínculo (G1, RF01 a RF06), sob /portal.
 *
 * Perfis por rota (04 §1.4, §7.1):
 *   leitura: rh, admin, contador (CPF mascarado, sem salário), gestor (só a equipe, se ligado);
 *   cadastrar, alterar, desligar e gerar PIN novo: rh e admin;
 *   vínculos (têm salário): leitura rh e admin, escrita só rh.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  assignmentListResponse,
  assignmentParams,
  assignmentResponse,
  createAssignmentBody,
  createdEmployeeResponse,
  createEmployeeBody,
  employeeListResponse,
  employeeResponse,
  listEmployeesQuery,
  resetPinResponse,
  terminateEmployeeBody,
  updateAssignmentBody,
  updateEmployeeBody,
} from './schemas';
import { EmployeeService } from './service';

const tags = ['Colaboradores'];

export const employeeRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new EmployeeService(deps);
  const { access } = deps;
  const readers = app.authorize(...access.roles('rh', 'admin', 'contador', 'gestor'));
  const writers = app.authorize('rh', 'admin');
  const rh = app.authorize('rh');

  app.get(
    '/employees',
    { preHandler: [readers], schema: { tags, summary: 'Lista colaboradores (filtro por estabelecimento e situação)', querystring: listEmployeesQuery, response: { 200: employeeListResponse } } },
    async (req) => service.list(req.ctx!, req.query),
  );

  app.get(
    '/employees/:id',
    { preHandler: [readers], schema: { tags, params: idParams, response: { 200: employeeResponse } } },
    async (req) => ({ data: await service.get(req.ctx!, req.params.id) }),
  );

  app.post(
    '/employees',
    { preHandler: [writers], schema: { tags, summary: 'Cadastra colaborador (gera o PIN inicial)', body: createEmployeeBody, response: { 201: createdEmployeeResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.body) }),
  );

  app.patch(
    '/employees/:id',
    { preHandler: [writers], schema: { tags, params: idParams, body: updateEmployeeBody, response: { 200: employeeResponse } } },
    async (req) => ({ data: await service.update(req.ctx!, req.params.id, req.body) }),
  );

  app.post(
    '/employees/:id/terminate',
    { preHandler: [writers], schema: { tags, summary: 'Desliga o colaborador (data e motivo)', params: idParams, body: terminateEmployeeBody, response: { 200: employeeResponse } } },
    async (req) => ({ data: await service.terminate(req.ctx!, req.params.id, req.body) }),
  );

  app.post(
    '/employees/:id/pin/reset',
    { preHandler: [writers], schema: { tags, summary: 'Gera um PIN novo (o anterior deixa de valer); o PIN sai só nesta resposta', params: idParams, response: { 200: resetPinResponse } } },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return { data: await service.resetPin(req.ctx!, req.params.id) };
    },
  );

  const assignmentReaders = app.authorize('rh', 'admin');

  app.get(
    '/employees/:id/assignments',
    { preHandler: [assignmentReaders], schema: { tags, summary: 'Histórico de vínculos (cargo, setor, centro de custo, salário)', params: idParams, response: { 200: assignmentListResponse } } },
    async (req) => ({ data: await service.listAssignments(req.ctx!, req.params.id) }),
  );

  app.post(
    '/employees/:id/assignments',
    { preHandler: [rh], schema: { tags, params: idParams, body: createAssignmentBody, response: { 201: assignmentResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.createAssignment(req.ctx!, req.params.id, req.body) }),
  );

  app.patch(
    '/employees/:id/assignments/:assignmentId',
    { preHandler: [rh], schema: { tags, params: assignmentParams, body: updateAssignmentBody, response: { 200: assignmentResponse } } },
    async (req) => ({ data: await service.updateAssignment(req.ctx!, req.params.id, req.params.assignmentId, req.body) }),
  );
};
