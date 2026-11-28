/**
 * Estabelecimentos que o usuário enxerga, para os seletores do portal: conta da sessão e escopo de
 * estabelecimentos (RNF02). O colaborador recebe só o próprio.
 */
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { companies, employees, establishments } from '../../db/schema';
import { tenantOf } from '../../http/access';
import type { RequestContext } from '../../plugins/request-context';
import type { EstablishmentOptionDto } from './schemas';

export class EstablishmentService {
  constructor(private readonly d: { db: Database }) {}

  async list(ctx: RequestContext): Promise<EstablishmentOptionDto[]> {
    const tenantId = tenantOf(ctx);
    const conditions: SQL[] = [eq(establishments.tenantId, tenantId)];
    if (ctx.establishmentScope !== null) conditions.push(inArray(establishments.id, ctx.establishmentScope));
    if (ctx.role === 'colaborador') conditions.push(this.ownEstablishment(tenantId, ctx.employeeId));

    const rows = await this.d.db
      .select({ id: establishments.id, name: establishments.name, subtitle: companies.legalName, companyId: establishments.companyId, isActive: establishments.isActive })
      .from(establishments)
      .innerJoin(companies, and(eq(companies.tenantId, establishments.tenantId), eq(companies.id, establishments.companyId)))
      .where(and(...conditions))
      .orderBy(asc(establishments.name), asc(establishments.id));
    return rows.map((r) => ({ ...r, id: Number(r.id), companyId: Number(r.companyId) }));
  }

  private ownEstablishment(tenantId: number, employeeId: number | null): SQL {
    if (employeeId === null) return sql`false`;
    return inArray(
      establishments.id,
      this.d.db
        .select({ id: employees.establishmentId })
        .from(employees)
        .where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId))),
    );
  }
}
