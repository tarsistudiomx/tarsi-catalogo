import {z} from 'zod';
export const sizes=['S','M','L','XL','XXL'] as const;
export const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('list'),test:z.boolean()}),
  z.object({action:z.literal('set'),test:z.boolean(),size:z.enum(sizes),count:z.number().int().min(0).max(100000),
    low:z.number().int().min(0).max(100000),restock:z.iso.date().nullable(),reason:z.string().trim().min(3).max(160)}),
  z.object({action:z.literal('enable'),test:z.boolean(),verified:z.literal(true)})
]);
