import {z} from 'zod';

export const categories = {
  production:'Producción e insumos', shipping:'Envíos y empaques', marketing:'Publicidad',
  operations:'Operación', other:'Otros gastos'
} as const;
export const schema = z.discriminatedUnion('action', [
  z.object({action:z.literal('report'),month:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)}),
  z.object({action:z.literal('add'),id:z.uuidv4(),date:z.iso.date(),category:z.enum(['production','shipping','marketing','operations','other']),
    description:z.string().trim().min(3).max(240),cents:z.number().int().min(1).max(100000000)}),
  z.object({action:z.literal('void'),id:z.uuidv4(),reason:z.string().trim().min(3).max(240)})
]);
