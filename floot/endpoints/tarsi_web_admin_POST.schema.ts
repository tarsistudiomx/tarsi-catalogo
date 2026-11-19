import {z} from 'zod';

export const statuses = ['Pendiente de pago','Pago por verificar','Pagado','En preparación','Enviado','Entregado','Cancelado'] as const;
export type OrderStatus = typeof statuses[number];
export const transitions: Record<OrderStatus, OrderStatus[]> = {
  'Pendiente de pago': ['Pago por verificar','Cancelado'],
  'Pago por verificar': ['Pendiente de pago','Cancelado'],
  'Pagado': ['En preparación'],
  'En preparación': ['Enviado'],
  'Enviado': ['Entregado'],
  'Entregado': [],
  'Cancelado': []
};
export const schema = z.discriminatedUnion('action', [
  z.object({action: z.literal('list'), test: z.boolean(), search:z.string().trim().max(100).optional(), from:z.iso.date().optional(), to:z.iso.date().optional(), amount:z.number().int().positive().optional(), status:z.enum(statuses).optional()}),
  z.object({action: z.literal('confirm-payment'), test: z.boolean(), id: z.uuid(),
    reference: z.string().trim().min(3).max(100).regex(/^[\p{L}\p{N}][\p{L}\p{N} ._\/-]*$/u),
    cents: z.number().int().positive().max(10000000), verified: z.literal(true), note: z.string().trim().max(400).optional()}),
  z.object({action: z.literal('adjust'), test: z.boolean(), id: z.uuid(),
    kind: z.enum(['refund','credit']), cents: z.number().int().positive().max(10000000),
    reference: z.string().trim().min(3).max(100), reason: z.string().trim().min(3).max(400), verified: z.literal(true)}),
  z.object({action:z.literal('issue'),test:z.boolean(),id:z.uuid(),note:z.string().trim().min(3).max(400)}),
  z.object({action:z.literal('revoke-recovery'),test:z.boolean(),id:z.uuid()}),
  z.object({action: z.literal('prepare'), test: z.boolean(), id: z.uuid()}),
  z.object({action: z.literal('transition'), test: z.boolean(), id: z.uuid(),
    expected: z.enum(statuses), status: z.enum(statuses), tracking: z.string().trim().max(100).optional(), carrier: z.string().trim().max(100).optional(), note: z.string().trim().max(400).optional()})
]);
