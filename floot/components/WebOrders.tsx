import React, {useEffect, useRef, useState} from 'react';
import styles from './WebOrders.module.css';
import {ConnectGoogleButton} from './ConnectGoogleButton';
import {Button} from './Button';
import {Input} from './Input';
import {transitions, type OrderStatus} from '../endpoints/tarsi_web_admin_POST.schema';
import type {payload} from '../endpoints/tarsi_web_order_POST.schema';
import type {z} from 'zod';

const mailKinds = {
  registered: 'Solicitud registrada', reminder: 'Recordatorio de pago', reported: 'Aviso de pago reportado',
  confirmed: 'Pago confirmado', recovery: 'Enlace nuevo'
};
const mailStates = {
  pending: 'Pendiente', sending: 'En proceso', accepted: 'Aceptado por Gmail',
  suppressed: 'Omitido por el estado del pedido o de su enlace', failed: 'Falló', review: 'Requiere revisión'
};

type Order = {
  id: string; number: string; status: OrderStatus; createdAt: string; tracking: string | null;
  paidAt: string | null; queuedAt: string | null; estimatedFrom: string; estimatedUntil: string; startedAt: string | null; preparedAt: string | null; paymentReference: string | null; paymentNote: string | null;
  details: Omit<z.infer<typeof payload>, 'skydropx'>;
  holdUntil:string|null; recoverUntil:string|null; revokedAt:string|null; lastIssue:string|null;
  transferReport:{bank:string;reference:string|null;date:string;cents:number;details:string|null;reportedAt:string}|null;
  adjustments: {cents:number; reference:string; reason:string; date:string; actorId:number}[];
  mailHistory?: {kind:keyof typeof mailKinds;state:keyof typeof mailStates;attempts:number;
    dueAt:string;acceptedAt:string|null;lastError:string|null}[];
  history: {status: OrderStatus; date: string; actorId: number | null}[];
};
const awaitingPayment = (order: Order) => order.status === 'Pendiente de pago' || order.status === 'Pago por verificar';
const orderLabel = (order: Order) => ({
  'Pendiente de pago':'Sin reporte de pago','Pago por verificar':'Pago reportado · por verificar','Pagado':'Pago verificado'
}[order.status as 'Pendiente de pago'|'Pago por verificar'|'Pagado']) || (order.status === 'En preparación' && order.preparedAt ? 'Preparado' : order.status);
const exceptional = (order:Order)=>Boolean(order.lastIssue||order.status==='Cancelado'||order.adjustments?.length||
  (awaitingPayment(order)&&order.holdUntil&&Date.parse(order.holdUntil)<=Date.now()));
const initialTestMode = () => typeof window !== 'undefined' && window.location.hostname.endsWith('.sandbox.floot.app');
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
  const [view, setView] = useState<'pending'|'verify'|'paid'|'exceptions'>('verify');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [test, setTest] = useState(initialTestMode);
  const [matched,setMatched]=useState<Order[]|null>(null);
  const [filters,setFilters]=useState<Record<string,unknown>>({});
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
  const pending = orders.filter(order => order.status === 'Pago por verificar');
  const dispatching = orders.filter(order => order.status === 'Enviado');
  const list=matched??orders;
  const unreported=list.filter(order=>order.status==='Pendiente de pago');
  const review=list.filter(order=>order.status==='Pago por verificar');
  const confirmed=list.filter(order=>!awaitingPayment(order)&&order.status!=='Cancelado');
  const exceptions=list.filter(exceptional);
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

  async function apply(order: Order, data: Record<string, unknown>) {
    await request({test, id: order.id, ...data});
    await load(test);
  }

  async function load(mode: boolean) {
    const result = await request({action: 'list', test: mode});
    setOrders(result.orders);
    onRevenue(result.revenue, result.paid);
    if(mode===test&&Object.keys(filters).length){
      const searched=await request({action:'list',test:mode,...filters});
      setMatched(searched.orders);
    }else setMatched(null);
  }

  useEffect(() => {
    if (busy) return;
    let active = true;
    async function refresh() {
      if (!active || document.hidden) return;
      try {
        const result = await request({action:'list',test});
        if (!active) return;
        setOrders(result.orders); onRevenue(result.revenue,result.paid);
        if (Object.keys(filters).length) {
          const searched = await request({action:'list',test,...filters});
          if (active) setMatched(searched.orders);
        }
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : 'No pudimos actualizar los pedidos.');
      }
    }
    void refresh();
    window.addEventListener('focus',refresh);
    return () => { active=false; window.removeEventListener('focus',refresh); };
  }, [test,onRevenue,busy,filters]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try { await operation(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'No fue posible actualizar el pedido.'); }
    finally { setBusy(false); }
  }

  function jump(order: Order) {
    setFilters({}); setMatched(null);
    setView(order.status==='Pago por verificar' ? 'verify' : awaitingPayment(order) ? 'pending' : 'paid');
    setExpanded(order.id);
    openOrder(order.id);
  }

  function work(order: Order, index: number) {
    return <article key={order.id}><p><a href={'#order-'+order.id} onClick={event=>{event.preventDefault(); jump(order);}}>Preparar pedido {order.number}</a> · Cola {index+1} · {order.details.customer.name}</p>
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
          <small>{order.number}</small><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'})}</time></span>
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
      {Boolean(order.mailHistory?.length) && <details>
        <summary>Estado de los correos</summary>
        <ul>{order.mailHistory?.map(mail => <li key={mail.kind}>
          <strong>{mailKinds[mail.kind]}</strong> · {test && mail.state==='accepted' ? 'Aceptado en pruebas' : mailStates[mail.state]}
          {mail.acceptedAt && <> · {new Date(mail.acceptedAt).toLocaleString('es-MX')}</>}
          {mail.state==='pending' && <> · {new Date(mail.dueAt).toLocaleString('es-MX')}</>}
          {mail.attempts>0 && <> · Intentos: {mail.attempts}</>}
          {mail.lastError && <> · {mail.lastError}</>}
        </li>)}</ul>
      </details>}
      <div className={styles.actions}>
      {order.lastIssue&&<p><strong>Revisión:</strong> {order.lastIssue}</p>}
      {order.holdUntil&&awaitingPayment(order)&&<p>Reserva {Date.parse(order.holdUntil)<=Date.now()?'vencida':'hasta '+new Date(order.holdUntil).toLocaleString('es-MX')}</p>}
      {order.transferReport&&<p className={styles.report}><strong>Transferencia reportada:</strong> {order.transferReport.bank} · {order.transferReport.date} · {money(order.transferReport.cents/100)}
        {order.transferReport.reference?' · '+order.transferReport.reference:''}{order.transferReport.details?' · '+order.transferReport.details:''}</p>}
      {order.tracking && <p>Guía {order.tracking}</p>}
      {order.paymentReference && <p>Referencia verificada: {order.paymentReference}{order.paymentNote && ' · '+order.paymentNote}</p>}
      {['Pendiente de pago','Pago por verificar'].includes(order.status) && <Button disabled={busy} onClick={() => {
        setPaymentOrder(order); setPayment({reference:order.transferReport?.reference || '',amount:'',verified:false,note:''});
        setStatus(''); dialog.current?.showModal();
      }}>{order.status === 'Pago por verificar' ? 'REVISAR Y CONFIRMAR EN NU' : 'CONFIRMAR PAGO'}</Button>}
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
      {order.paidAt && <details className={styles.settings}><summary>Devoluciones y ajustes</summary>
        {(order.adjustments || []).map(item => <p key={item.reference}>
          {item.cents < 0 ? 'Devolución' : 'Cobro adicional'} · {money(Math.abs(item.cents) / 100)} · {item.reference} · {item.reason}
          {' · '}{new Date(item.date).toLocaleString('es-MX')}
        </p>)}
        <form className={styles.adjustment} onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          const amount = String(fields.get('amount') || '').trim().replace(',','.');
          if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
            setStatus('Ingresa un monto válido con hasta dos decimales.'); return;
          }
          void run(async () => {
            await apply(order,{action:'adjust',kind:fields.get('kind'),cents:Math.round(Number(amount)*100),
              reference:fields.get('reference'),reason:fields.get('reason'),verified:fields.get('verified') === 'on'});
            form.reset();
            setStatus('Movimiento registrado.');
          });
        }}>
          <label>Movimiento<select name="kind"><option value="refund">Devolución</option><option value="credit">Cobro adicional</option></select></label>
          <label>Monto en MXN<Input name="amount" inputMode="decimal" required/></label>
          <label>Referencia bancaria<Input name="reference" minLength={3} maxLength={100} required/></label>
          <label>Motivo<Input name="reason" minLength={3} maxLength={400} required/></label>
          <label><input name="verified" type="checkbox" required/> Confirmé el movimiento en mi cuenta bancaria.</label>
          <p>Esto registra un movimiento que ya realizaste en el banco.</p>
          <Button type="submit" disabled={busy}>Registrar movimiento</Button>
        </form>
      </details>}
      <details className={styles.settings}><summary>Discrepancia o recuperación</summary>
        <form onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const note=new FormData(form).get('note');
          void run(async()=>{await apply(order,{action:'issue',note});form.reset();});}}>
          <label>Nota de conciliación<Input name="note" minLength={3} maxLength={400} required/></label>
          <Button type="submit" disabled={busy}>Guardar discrepancia</Button>
        </form>
        {order.recoverUntil&&!order.revokedAt&&<Button variant="outline" disabled={busy} onClick={()=>{
          if(confirm('Revocar el enlace anterior de este pedido.'))void run(()=>apply(order,{action:'revoke-recovery'}));
        }}>Revocar enlace</Button>}
        {order.recoverUntil&&(order.revokedAt||Date.parse(order.recoverUntil)<=Date.now())&&<Button variant="outline" disabled={busy} onClick={()=>{
          if(confirm('Generar un enlace nuevo y enviarlo al correo del cliente.'))void run(()=>apply(order,{action:'reissue-recovery'}));
        }}>Reenviar enlace</Button>}
      </details>
      <details><summary>Historial</summary><ul>{order.history?.map((event, index) =>
        <li key={index}>{event.status} · {new Date(event.date).toLocaleString('es-MX')} · {event.actorId ?? 'Tienda web'}</li>)}</ul></details>
      </div>
    </article>;
  }

  const visible={pending:unreported,verify:review,paid:confirmed,exceptions}[view];
  return <section className={styles.root} hidden={!['pedidos','hoy'].includes(tab)}>
    {tab === 'hoy' && <section className={styles.work}><h3>Mis actividades · Pedidos</h3>
      {test && <p>Pedidos de prueba · excluidos de ventas</p>}
      {pending.length > 0 && <article><h4>Transferencias por verificar ({pending.length})</h4>
        <ul>{pending.map(order => <li key={order.id}><button type="button" onClick={()=>jump(order)}>{order.details.customer.name} · {money(order.details.total)}</button> · {orderLabel(order)}</li>)}</ul>
      </article>}
      {queue.map(work)}
      {dispatching.length > 0 && <article><h4>Dar seguimiento a la entrega ({dispatching.length})</h4>
        <ul>{dispatching.map(order => <li key={order.id}><button type="button" onClick={()=>jump(order)}>{order.details.customer.name} · {order.tracking || 'Entrega local'}</button></li>)}</ul>
      </article>}
      {!pending.length&&!queue.length&&!dispatching.length&&<p>No hay actividades de pedidos pendientes.</p>}
      <Button variant="outline" disabled={busy} onClick={()=>void run(()=>load(test))}>Actualizar actividades</Button>
      <p role="status">{status}</p></section>}
    <section hidden={tab !== 'pedidos'}>
      <div className={styles.heading}>
        <h3>Pedidos registrados</h3>
        <div className={styles.tools}>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
            await load(!test);
            setTest(!test);
            setView('verify');
            setFilters({});setMatched(null);
            setExpanded(null);
          })}>{test ? 'Ver pedidos reales' : 'Ver pedidos de prueba'}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => load(test))}>Actualizar</Button>
        </div>
      </div>
      {test && <p className={styles.environment}>Modo de prueba · Estos pedidos no cuentan como ventas.</p>}
      <p className={styles.workflow}><strong>1. Sin reporte</strong><span aria-hidden="true">→</span>
        <strong>2. Por verificar en Nu</strong><span aria-hidden="true">→</span><strong>3. Confirmado y a preparación</strong></p>
      <details className={styles.settings}><summary>Buscar o filtrar pedidos</summary>
        <form className={styles.adjustment} onSubmit={e=>{
          e.preventDefault();
          const f=new FormData(e.currentTarget);
          const next:Record<string,unknown>={};
          for(const key of ['search','from','to','status'])if(String(f.get(key)||'').trim())next[key]=String(f.get(key)).trim();
          if(f.get('amount'))next.amount=Number(f.get('amount'));
          void run(async()=>{const result=await request({action:'list',test,...next});setFilters(next);setMatched(result.orders);if(result.orders.length===1){const order=result.orders[0] as Order;setView(order.status==='Pago por verificar'?'verify':order.status==='Pendiente de pago'?'pending':order.status==='Cancelado'?'exceptions':'paid');setExpanded(order.id);}});
        }}>
          <label>Folio o cliente<Input name="search" maxLength={100}/></label>
          <label>Desde<Input type="date" name="from"/></label><label>Hasta<Input type="date" name="to"/></label>
          <label>Importe MXN<Input name="amount" type="number" min="1" step="1"/></label>
          <label>Estado<select name="status"><option value="">Todos</option>{Object.keys(transitions).map(value=>
            <option key={value}>{value}</option>)}</select></label>
          <Button type="submit" disabled={busy}>Buscar</Button>
          <Button type="reset" variant="outline" onClick={()=>{setMatched(null);setFilters({});}}>Limpiar filtros</Button>
        </form>
      </details>
      <div className={styles.filters} role="group" aria-label="Bandeja de pedidos">
        {([['pending','Solicitudes sin reporte',unreported],['verify','Pagos por verificar',review],['paid','Pedidos confirmados',confirmed],
          ['exceptions','Historial y excepciones',exceptions]] as const).map(([key,label,rows])=>
          <button type="button" key={key} data-stage={key} aria-pressed={view===key} onClick={()=>setView(key)}>{label} <span>{rows.length}</span></button>)}
      </div>
      {(status || busy) && <p className={styles.status} role="status">{status || 'Cargando…'}</p>}
      {view==='verify' && <p>Comprueba el depósito en Nu antes de pasar el pedido a preparación.</p>}
      {visible.length > 0 ? <div className={styles.list}>
        <div className={styles.columns} aria-hidden="true"><span>Cliente</span><span>Total</span><span>Estado</span><span /></div>
        {visible.map(orderRow)}
      </div> : !busy && <p className={styles.empty}>No hay pedidos en esta bandeja.</p>}
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
