import {z} from 'zod';

export const statuses = ['Pendiente de pago','Pago por verificar','Pagado','En preparación','Enviado','Entregado','Cancelado'] as const;
export type OrderStatus = typeof statuses[number];
export const transitions: Record<OrderStatus, OrderStatus[]> = {
  'Pendiente de pago': ['Pago por verificar','Cancelado'],
  'Pago por verificar': ['Pagado','Pendiente de pago','Cancelado'],
  'Pagado': ['En preparación'],
  'En preparación': ['Enviado'],
  'Enviado': ['Entregado'],
  'Entregado': [],
  'Cancelado': []
};
export const schema = z.discriminatedUnion('action', [
  z.object({action: z.literal('list'), test: z.boolean()}),
  z.object({action: z.literal('transition'), test: z.boolean(), id: z.uuid(),
    expected: z.enum(statuses), status: z.enum(statuses), tracking: z.string().trim().max(100).optional()})
]);
