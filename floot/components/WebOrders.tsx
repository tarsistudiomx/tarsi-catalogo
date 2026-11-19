import React, {useEffect, useRef, useState} from 'react';
import styles from './WebOrders.module.css';
import {ConnectGoogleButton} from './ConnectGoogleButton';
import {Button} from './Button';
import {Input} from './Input';
import {transitions, type OrderStatus} from '../endpoints/tarsi_web_admin_POST.schema';
import type {payload} from '../endpoints/tarsi_web_order_POST.schema';
import type {z} from 'zod';

type Order = {
  id: string; number: string; status: OrderStatus; createdAt: string; tracking: string | null;
  paidAt: string | null; queuedAt: string | null; estimatedFrom: string; estimatedUntil: string; startedAt: string | null; preparedAt: string | null; paymentReference: string | null; paymentNote: string | null;
  details: Omit<z.infer<typeof payload>, 'skydropx'>;
  history: {status: OrderStatus; date: string; actorId: number | null}[];
};
const awaitingPayment = (order: Order) => order.status === 'Pendiente de pago' || order.status === 'Pago por verificar';
const orderLabel = (order: Order) => order.status === 'En preparación' && order.preparedAt ? 'Preparado' : order.status;
const money = (value: number) => value.toLocaleString('es-MX', {style: 'currency', currency: 'MXN'});

async function request(data: Record<string, unknown>) {
  const response = await fetch('/_api/tarsi_web_admin', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No fue posible consultar los pedidos.');
  return result;
}

export function WebOrders({onRevenue, tab, openOrder}: {tab: string; openOrder: (id:string)=>void; onRevenue: (revenue: number, paid: number) => void}) {
  const [view, setView] = useState<'pending' | 'paid'>('pending');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [test, setTest] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState<Record<string, string>>({});

  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [payment, setPayment] = useState({reference:'', amount:'', verified:false, note:''});
  const [dispatch, setDispatch] = useState<Record<string, {carrier?:string; note?:string}>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const cents = /^\d{1,7}(?:[.,]\d{1,2})?$/.test(payment.amount.trim()) ? Math.round(Number(payment.amount.replace(',','.')) * 100) : 0;
  const queue = orders.filter(o => o.queuedAt && ['Pagado','En preparación'].includes(o.status))
    .sort((a,b) => (a.queuedAt || '').localeCompare(b.queuedAt || '') || a.id.localeCompare(b.id));
  const pending = orders.filter(awaitingPayment);
  const paid = orders.filter(order => !awaitingPayment(order) && order.status !== 'Cancelado');
  const cancelled = orders.filter(order => order.status === 'Cancelado');
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

  async function apply(order: Order, data: Record<string, unknown>) {
    await request({test, id: order.id, ...data});
    await load(test);
  }

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

  function work(order: Order, index: number) {
    return <article key={order.id}><p><a href={'#order-'+order.id} onClick={event=>{event.preventDefault(); setView('paid'); setExpanded(order.id); openOrder(order.id);}}>Preparar pedido {order.number}</a> · Cola {index+1} · {order.details.customer.name}</p>
      <ul>{order.details.items.map(item => <li key={item.id+':'+item.size}>{item.name} · {item.size} × {item.qty}</li>)}</ul>
      <p>Pago {order.paidAt && new Date(order.paidAt).toLocaleString('es-MX')} · Estimado {order.estimatedFrom} a {order.estimatedUntil}
      {order.estimatedUntil < today && !order.preparedAt ? ' · Retrasado' : order.estimatedUntil === today && !order.preparedAt ? ' · Vence hoy' : ''}
      {order.startedAt && ' · Inicio '+new Date(order.startedAt).toLocaleString('es-MX')}</p>
      <p>{order.preparedAt ? 'Preparado' : order.status === 'Pagado' ? 'Pendiente de preparar' : order.status}</p>
      {order.status === 'Pagado' && <Button disabled={busy} onClick={() => void run(() => apply(order,{action:'transition',expected:order.status,status:'En preparación'}))}>Iniciar preparación</Button>}
      {order.status === 'En preparación' && !order.preparedAt && <Button disabled={busy} onClick={() => void run(() => apply(order,{action:'prepare'}))}>Marcar preparado</Button>}
    </article>;
  }

  function orderRow(order: Order) {
    const isOpen = expanded === order.id;
    const detailsId = 'details-'+order.id;
    return <article className={styles.row} key={order.id} id={'order-'+order.id}>
      <button type="button" className={styles.rowButton} aria-expanded={isOpen} aria-controls={detailsId}
        onClick={() => setExpanded(isOpen ? null : order.id)}>
        <span className={styles.customer}><strong>{order.details.customer.name}</strong>
          <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'})}</time></span>
        <span className={styles.amount}>{money(order.details.total)}</span>
        <span className={styles.badge} data-status={orderLabel(order)}>{orderLabel(order)}</span>
        <span className={styles.chevron} aria-hidden="true">{isOpen ? '−' : '+'}</span>
      </button>
      <div id={detailsId} className={styles.details} hidden={!isOpen}>
      <h4>{test ? '[PRUEBA] ' : ''}{order.number}</h4>
      <p>{new Date(order.createdAt).toLocaleString("es-MX")} · {order.details.origin}</p>
      <p>{order.details.customer.name} · {order.details.customer.phone} {order.details.customer.email}</p>
      <p>{Object.entries(order.details.address).filter(([key]) => key !== 'country_code').map(([,value]) => value).join(', ')}</p>
      <p>{order.details.delivery} {[order.details.carrier, order.details.service].filter(Boolean).join(' · ')}</p>
      <ul>{order.details.items.map(item => <li key={item.id + ':' + item.size}>{item.name} · {item.size} × {item.qty}</li>)}</ul>
      <p>Subtotal {money(order.details.subtotal)} · Envío {order.details.delivery === 'Entrega en Querétaro' ? 'por cotizar el día de la entrega' : money(order.details.shipping)} · Total {money(order.details.total)}</p>
      <div className={styles.actions}>
      {order.tracking && <p>Guía {order.tracking}</p>}
      {order.paymentReference && <p>Referencia verificada: {order.paymentReference}{order.paymentNote && ' · '+order.paymentNote}</p>}
      {['Pendiente de pago','Pago por verificar'].includes(order.status) && <Button disabled={busy} onClick={() => {
        setPaymentOrder(order); setPayment({reference:'',amount:'',verified:false,note:''});
        setStatus(''); dialog.current?.showModal();
      }}>CONFIRMAR PAGO</Button>}
      {order.preparedAt && order.status === 'En preparación' && order.details.delivery === 'Envío nacional' && <>
        <Input aria-label="Paquetería" placeholder="Paquetería" value={dispatch[order.id]?.carrier || ''} onChange={event =>
          setDispatch({...dispatch,[order.id]:{...dispatch[order.id],carrier:event.target.value}})}/>
        <Input aria-label="Guía de envío" placeholder="Guía de envío" value={tracking[order.id] || ''}
          onChange={event => setTracking({...tracking,[order.id]:event.target.value})}/>
      </>}
      {order.details.delivery === 'Entrega en Querétaro' && (order.preparedAt && order.status === 'En preparación' || order.status === 'Enviado') &&
        <Input aria-label="Confirmación de entrega local" placeholder="Nota de entrega local" value={dispatch[order.id]?.note || ''}
          onChange={event => setDispatch({...dispatch,[order.id]:{...dispatch[order.id],note:event.target.value}})}/>}
      {transitions[order.status].filter(next => next !== 'Enviado' || order.preparedAt).map(next => <Button key={next} disabled={busy}
        onClick={() => void run(() => apply(order,{action:'transition',expected:order.status,status:next,
          tracking:tracking[order.id],...dispatch[order.id]}))}>{next === 'Enviado' && order.details.delivery === 'Entrega en Querétaro' ? 'Registrar salida local' : next}</Button>)}
      {order.status === 'En preparación' && !order.preparedAt && <Button disabled={busy} onClick={() =>
        void run(() => apply(order,{action:'prepare'}))}>Marcar preparado</Button>}
      </div>
      <details><summary>Historial</summary><ul>{order.history?.map((event, index) =>
        <li key={index}>{event.status} · {new Date(event.date).toLocaleString('es-MX')} · {event.actorId ?? (index === 0 ? 'Tienda web' : 'Prueba automatizada')}</li>)}</ul></details>
      </div>
    </article>;
  }

  const visible = view === 'pending' ? pending : paid;
  return <section className={styles.root} hidden={!['pedidos','hoy'].includes(tab)}>
    {tab === 'hoy' && <section className={styles.work}><h3>Mis actividades · Producción</h3>
      {queue.map(work)}<p role="status">{status}</p></section>}
    <section hidden={tab !== 'pedidos'}>
      <div className={styles.heading}>
        <h3>Pedidos registrados</h3>
        <div className={styles.tools}>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
            await load(!test);
            setTest(!test);
            setView('pending');
            setExpanded(null);
          })}>{test ? 'Ver pedidos reales' : 'Ver pedidos de prueba'}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => load(test))}>Actualizar</Button>
        </div>
      </div>
      <div className={styles.filters} role="group" aria-label="Estado de pago">
        <button type="button" aria-pressed={view === 'pending'} onClick={() => setView('pending')}>Pendientes de pago <span>{pending.length}</span></button>
        <button type="button" aria-pressed={view === 'paid'} onClick={() => setView('paid')}>Pagados <span>{paid.length}</span></button>
      </div>
      {(status || busy || test) && <p className={styles.status} role="status">{status || (busy ? 'Cargando…' : 'Pedidos de prueba · excluidos de ventas')}</p>}
      {visible.length > 0 ? <div className={styles.list}>
        <div className={styles.columns} aria-hidden="true"><span>Cliente</span><span>Total</span><span>Estado</span><span /></div>
        {visible.map(orderRow)}
      </div> : !busy && <p className={styles.empty}>{view === 'pending' ? 'Aún no hay pedidos pendientes de pago.' : 'Aún no hay pedidos pagados.'}</p>}
      {cancelled.length > 0 && <details className={styles.settings}><summary>Cancelados ({cancelled.length})</summary>{cancelled.map(orderRow)}</details>}
      <details className={styles.settings}><summary>Configuración del correo</summary>
        <p>Conecta tarsi.studiomx@gmail.com para enviar avisos de pedidos.</p>
        <ConnectGoogleButton feature="gmail"/>
      </details>
    <dialog className={styles.dialog} ref={dialog} aria-labelledby="verifyTitle">
      <h3 id="verifyTitle">CONFIRMAR PAGO</h3>
      {paymentOrder && <><p>Pedido {paymentOrder.number} · Importe esperado {money(paymentOrder.details.total)} · Banco Nu</p>
        <label>Clave de rastreo o referencia bancaria<Input value={payment.reference} maxLength={100}
          onChange={event=>setPayment({...payment,reference:event.target.value})}/></label>
        <label>Importe recibido<Input value={payment.amount} inputMode="decimal"
          onChange={event=>setPayment({...payment,amount:event.target.value})}/></label>
        {cents > 0 && cents !== paymentOrder.details.total * 100 && <p>El importe difiere del total. Resuelve la diferencia manualmente.</p>}
        <label>Nota administrativa<Input value={payment.note} maxLength={400}
          onChange={event=>setPayment({...payment,note:event.target.value})}/></label>
        <label><input type="checkbox" checked={payment.verified} onChange={event=>setPayment({...payment,verified:event.target.checked})}/>
          Verifiqué que el depósito realmente aparece en mi cuenta Nu y corresponde a este pedido.</label>
        <p role="status">{status}</p>
        <Button disabled={busy} onClick={()=>dialog.current?.close()}>Cerrar</Button>
        <Button disabled={busy || !payment.verified || payment.reference.trim().length < 3 || cents !== paymentOrder.details.total * 100}
          onClick={()=>void run(async()=> {
            await apply(paymentOrder,{action:'confirm-payment',reference:payment.reference,cents,verified:payment.verified,note:payment.note});
            dialog.current?.close(); setView('paid'); setExpanded(paymentOrder.id); setStatus('Pago confirmado y actividad creada.');
          })}>CONFIRMAR PAGO</Button></>}
    </dialog></section></section>;
}
