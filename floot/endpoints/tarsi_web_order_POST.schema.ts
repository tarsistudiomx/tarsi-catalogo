import {z} from 'zod';

const amount = z.number().int().min(0).max(100000);
const nullableText = z.string().max(180).nullable();
export const item = z.object({
  id: z.number().int().min(0), name: z.string().min(1).max(140), size: z.enum(['XS','S','M','L','XL','XXL']),
  qty: z.number().int().min(1).max(30), unitPrice: amount
});
export const payload = z.object({
  items: z.array(item).min(1).max(30), quantity: z.number().int().min(1).max(30),
  customer: z.object({name: z.string().min(2).max(120), phone: z.string().regex(/^\d{10}$/), email: z.string().max(254)}),
  address: z.object({street: z.string().min(2).max(200), postal_code: z.string().regex(/^\d{5}$/),
    country_code: z.literal('MX'), area_level1: z.string().max(120), area_level2: z.string().max(120), area_level3: z.string().max(120)}),
  delivery: z.enum(['Envío nacional','Entrega en Querétaro']),
  subtotal: amount, discount: amount, shipping: amount, total: amount,
  promotions: z.object({threePack: z.number().int().min(0).max(10), twoPack: z.number().int().min(0).max(1)}),
  carrier: nullableText, service: nullableText, origin: z.literal('tienda web TARSI'),
  skydropx: z.object({
    destination: z.string().max(500), quantity: z.number().int().min(1).max(30), price: amount,
    expires: z.string().max(40), carrier: nullableText, service: nullableText,
    quotationId: z.string().max(180).optional(), rateId: z.union([z.string().max(180), z.number()]).nullable()
  }).nullable()
}).refine(order => order.subtotal + order.shipping === order.total &&
  order.items.reduce((qty, line) => qty + line.qty, 0) === order.quantity);
const identity = {key: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/)};
export const schema = z.discriminatedUnion('action', [
  z.object({...identity, action: z.literal('lookup')}),
  z.object({...identity, action: z.literal('create'), order: payload})
]);
