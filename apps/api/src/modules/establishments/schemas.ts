import { z } from 'zod';

/** `subtitle` = razão social da empresa; `companyId` = a empresa (agrupa os estabelecimentos por empresa no portal). */
export const establishmentOptionDto = z.strictObject({ id: z.number(), name: z.string(), subtitle: z.string(), companyId: z.number(), isActive: z.boolean() });
export type EstablishmentOptionDto = z.infer<typeof establishmentOptionDto>;

export const establishmentOptionListResponse = z.strictObject({ data: z.array(establishmentOptionDto) });
