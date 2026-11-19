import {z} from 'zod';

export const destination = z.object({
  postal_code:z.string().regex(/^\d{5}$/),
  area_level1:z.string().trim().max(120).optional(),
  area_level2:z.string().trim().max(120).optional(),
  area_level3:z.string().trim().min(1).max(120)
});

export const quoteRequest = z.object({destination,quantity:z.number().int().min(1).max(30)});
const lookup = z.object({key:z.uuidv4(),notify:z.boolean().optional()});
const checkout = lookup.extend({
  recover:z.literal(false).optional(),
  items:z.array(z.object({id:z.number().int().min(0),size:z.enum(['XS','S','M','L','XL','XXL']),qty:z.number().int().min(1).max(30)})).min(1).max(30),
  customer:z.object({
    name:z.string().trim().min(2).max(120),
    phone:z.string().max(30).transform(value=>value.replace(/[\s().-]/g,'').replace(/^\+52/,'')).pipe(z.string().regex(/^\d{10}$/)),
    email:z.union([z.literal(''),z.email().max(254)]).default('')
  }),
  address:destination.extend({street:z.string().trim().min(2).max(200)}),
  delivery:z.enum(['Entrega en Querétaro','Envío nacional']),
  proof:z.string().max(4096).optional(),
  acceptedTotal:z.number().int().positive().max(100000)
});
export const schema = z.discriminatedUnion('mode',[
  quoteRequest.extend({mode:z.literal('quote')}),
  checkout.extend({mode:z.literal('checkout')}),
  lookup.extend({mode:z.literal('recover')})
]);
