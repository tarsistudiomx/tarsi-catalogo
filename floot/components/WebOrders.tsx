import React, {useEffect, useState} from 'react';
import {Button} from './Button';
import {Input} from './Input';
import {transitions, type OrderStatus} from '../endpoints/tarsi_web_admin_POST.schema';
import type {payload} from '../endpoints/tarsi_web_order_POST.schema';
import type {z} from 'zod';

type Order = {
  id: string; number: string; status: OrderStatus; created_at: string; tracking: string | null;
  details: Omit<z.infer<typeof payload>, 'skydropx'>;
  history: {status: OrderStatus; date: string; actorId: number | null}[];
};
const money = (value: number) => value.toLocaleString('es-MX', {style: 'currency', currency: 'MXN'});

async function request(data: Record<string, unknown>) {
  const response = await fetch('/_api/tarsi_web_admin', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No fue posible consultar los pedidos.');
  return result;
}

export function WebOrders({onRevenue}: {onRevenue: (revenue: number, paid: number) => void}) {
  const [test, setTest] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState<Record<string, string>>({});

  async function load(mode: boolean) {
    const result = await request({action: 'list', test: mode});
    setOrders(result.orders);
    onRevenue(result.revenue, result.paid);
  }

  useEffect(() => {
    let active = true;
    request({action: 'list', test: false}).then(result => {
      if (active) { setOrders(result.orders); onRevenue(result.revenue, result.paid); }
    }).catch(error => { if (active) setStatus(error.message); });
    return () => {active = false;};
  }, [onRevenue]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try { await operation(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'No fue posible actualizar el pedido.'); }
    finally { setBusy(false); }
  }

  return <section>
    <h3>Pedidos de la tienda web</h3>
    <Button disabled={busy} onClick={() => void run(async () => {
      await load(!test);
      setTest(!test);
    })}>{test ? 'Ver pedidos reales' : 'Ver pedidos de prueba'}</Button>
    <Button disabled={busy} onClick={() => void run(() => load(test))}>Actualizar</Button>
    <p role="status">{status || (busy ? 'Cargando…' : test ? 'Modo prueba · excluido de ventas' : '')}</p>
    {!orders.length && !busy && <p>Aún no hay pedidos en esta vista.</p>}
    {orders.map(order => <article key={order.id}>
      <h4>{test ? '[PRUEBA] ' : ''}{order.number} · {order.status}</h4>
      <p>{order.details.customer.name} · {order.details.customer.phone} {order.details.customer.email}</p>
      <p>{Object.entries(order.details.address).filter(([key]) => key !== 'country_code').map(([,value]) => value).join(', ')}</p>
      <p>{order.details.delivery} {[order.details.carrier, order.details.service].filter(Boolean).join(' · ')}</p>
      <ul>{order.details.items.map(item => <li key={item.id + ':' + item.size}>{item.name} · {item.size} × {item.qty}</li>)}</ul>
      <p>Subtotal {money(order.details.subtotal)} · Envío {money(order.details.shipping)} · Total {money(order.details.total)}</p>
      {order.tracking && <p>Guía {order.tracking}</p>}
      {order.status === 'En preparación' && <Input aria-label="Guía de envío" placeholder="Guía de envío"
        value={tracking[order.id] || ''} onChange={event => setTracking({...tracking, [order.id]: event.target.value})} />}
      {transitions[order.status].map(next => <Button key={next} disabled={busy || (next === 'Enviado' && !tracking[order.id]?.trim())}
        onClick={() => void run(async () => {
          await request({action: 'transition', test, id: order.id, expected: order.status, status: next, tracking: tracking[order.id]});
          await load(test);
        })}>{next}</Button>)}
      <details><summary>Historial</summary><ul>{order.history?.map((event, index) =>
        <li key={index}>{event.status} · {new Date(event.date).toLocaleString('es-MX')} · {event.actorId ?? 'Tienda web'}</li>)}</ul></details>
    </article>)}
  </section>;
}
