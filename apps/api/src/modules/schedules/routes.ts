/**
 * Escalas (G2), sob /portal. Leitura e escrita: rh e admin.
 * Trocas de turno (RF12): leitura rh, admin e gestor (se ligado); escrita rh e admin.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  assignmentParams,
  assignScheduleBody,
  createOverrideBody,
  listOverridesQuery,
  overrideListResponse,
  overrideParams,
  overrideResponse,
  scheduleEmployeeListResponse,
  scheduleEmployeesQuery,
  switchScheduleBody,
  updateEmployeeScheduleBody,
  createScheduleBody,
  employeeScheduleListResponse,
  employeeScheduleResponse,
  listSchedulesQuery,
  scheduleListResponse,
  scheduleResponse,
  updateScheduleBody,
} from './schemas';
import { ScheduleService } from './service';

const tags = ['Escalas'];

export const scheduleRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new ScheduleService(deps);
  const readers = app.authorize('rh', 'admin');
  const writers = app.authorize('rh', 'admin');

  app.get(
    '/schedules',
    { preHandler: [readers], schema: { tags, querystring: listSchedulesQuery, response: { 200: scheduleListResponse } } },
    async (req) => ({ data: await service.list(req.ctx!, req.query) }),
  );
  app.get(
    '/schedules/:id',
    { preHandler: [readers], schema: { tags, params: idParams, response: { 200: scheduleResponse } } },
    async (req) => ({ data: await service.get(req.ctx!, req.params.id) }),
  );
  app.post(
    '/schedules',
    { preHandler: [writers], schema: { tags, summary: 'Cadastra escala e dias (avisa se passar do limite semanal)', body: createScheduleBody, response: { 201: scheduleResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.body) }),
  );
  app.patch(
    '/schedules/:id',
    { preHandler: [writers], schema: { tags, params: idParams, body: updateScheduleBody, response: { 200: scheduleResponse } } },
    async (req) => ({ data: await service.update(req.ctx!, req.params.id, req.body) }),
  );
  app.post(
    '/employees/:id/schedules',
    { preHandler: [writers], schema: { tags, summary: 'Liga o colaborador a uma escala, com vigência', params: idParams, body: assignScheduleBody, response: { 201: employeeScheduleResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.assign(req.ctx!, req.params.id, req.body) }),
  );
  app.get(
    '/employees/:id/schedules',
    { preHandler: [readers], schema: { tags, params: idParams, response: { 200: employeeScheduleListResponse } } },
    async (req) => ({ data: await service.listForEmployee(req.ctx!, req.params.id) }),
  );
  app.patch(
    '/employees/:id/schedules/:assignmentId',
    { preHandler: [writers], schema: { tags, summary: 'Encerra (ou reabre) o vínculo com a escala', params: assignmentParams, body: updateEmployeeScheduleBody, response: { 200: employeeScheduleResponse } } },
    async (req) => ({ data: await service.updateAssignment(req.ctx!, req.params.id, req.params.assignmentId, req.body.validTo) }),
  );
  app.post(
    '/employees/:id/schedules/switch',
    { preHandler: [writers], schema: { tags, summary: 'Troca de escala a partir de uma data (encerra a vigente no dia anterior)', params: idParams, body: switchScheduleBody, response: { 201: employeeScheduleResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.switchSchedule(req.ctx!, req.params.id, req.body) }),
  );
  app.get(
    '/schedules/:id/employees',
    { preHandler: [readers], schema: { tags, summary: 'Quem está na escala na data (padrão: hoje)', params: idParams, querystring: scheduleEmployeesQuery, response: { 200: scheduleEmployeeListResponse } } },
    async (req) => ({ data: await service.employeesOf(req.ctx!, req.params.id, req.query.date) }),
  );

  const overrideReaders = app.authorize(...deps.access.roles('rh', 'admin', 'gestor'));
  app.get(
    '/employees/:id/schedule-overrides',
    { preHandler: [overrideReaders], schema: { tags, params: idParams, querystring: listOverridesQuery, response: { 200: overrideListResponse } } },
    async (req) => ({ data: await service.listOverrides(req.ctx!, req.params.id, req.query.from, req.query.to) }),
  );
  app.post(
    '/employees/:id/schedule-overrides',
    { preHandler: [writers], schema: { tags, summary: 'Troca pontual de turno ou folga num dia (muda só o previsto)', params: idParams, body: createOverrideBody, response: { 201: overrideResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.createOverride(req.ctx!, req.params.id, req.body) }),
  );
  app.delete(
    '/employees/:id/schedule-overrides/:overrideId',
    { preHandler: [writers], schema: { tags, summary: 'Remove a troca de turno', params: overrideParams } },
    async (req, reply) => {
      await service.deleteOverride(req.ctx!, req.params.id, req.params.overrideId);
      return reply.code(204).send();
    },
  );
};
