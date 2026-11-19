import React,{useEffect,useState} from 'react';
import {Button} from './Button';
import {Input} from './Input';
import {categories} from '../endpoints/tarsi_finance_POST.schema';
import styles from './TarsiFinance.module.css';

type Entry={id:string;date:string;category:keyof typeof categories;description:string;cents:number;voided:boolean;voidReason?:string};
type Report={gross:number;adjustments:number;expenses:number;count:number;entries:Entry[]};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const mxn=(cents:number)=>(cents/100).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
async function api(data:Record<string,unknown>){
  const response=await fetch('/_api/tarsi_finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error || 'No se pudo consultar Finanzas.');
  return result;
}
export function TarsiFinance(){
  const [month,setMonth]=useState(()=>today().slice(0,7));
  const [report,setReport]=useState<Report|null>(null);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [key,setKey]=useState(()=>crypto.randomUUID());
  const [voidId,setVoidId]=useState('');
  useEffect(()=>{
    let active=true;
    setReport(null);setStatus('');setVoidId('');
    api({action:'report',month}).then(data=>{if(active)setReport(data);})
      .catch(error=>{if(active)setStatus(error.message);});
    return ()=>{active=false;};
  },[month]);
  async function save(data:Record<string,unknown>, targetMonth=month){
    setBusy(true);setStatus('');
    try {
      await api(data);
      if(targetMonth===month) setReport(await api({action:'report',month}));
      else setMonth(targetMonth);
      setStatus(data.action==='void'?'Gasto anulado. Se conservó el historial.':'Gasto registrado.');
      return true;
    }catch(error){setStatus(error instanceof Error?error.message:'No se guardó el movimiento.');return false;}
    finally{setBusy(false);}
  }
  const net=report ? report.gross+report.adjustments : 0;
  return <section className={styles.finance}>
    <header><div><h2>Ventas y gastos</h2><p>Estado de resultados de caja · pedidos web y gastos registrados</p></div>
      <label>Mes<Input type="month" value={month} disabled={busy} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label></header>
    {report ? <>
      <dl className={styles.metrics}>
        <div><dt>Ventas cobradas</dt><dd>{mxn(report.gross)}</dd><small>{report.count} pedidos web pagados</small></div>
        <div><dt>Ajustes y devoluciones</dt><dd>{mxn(report.adjustments)}</dd></div>
        <div><dt>Gastos pagados</dt><dd>{mxn(report.expenses)}</dd></div>
        <div><dt>Resultado neto</dt><dd>{mxn(net-report.expenses)}</dd><small>Ingresos netos menos gastos</small></div>
      </dl>
      <p>Los pedidos pendientes, las pruebas y los registros manuales de clientes quedan fuera del resultado mensual.</p>
      <details className={styles.panel}><summary>Registrar un gasto</summary>
        <form onSubmit={async e=>{
          e.preventDefault();
          if(busy) return;
          const form=e.currentTarget, fields=new FormData(form);
          const amount=String(fields.get('amount')??'').trim().replace(',','.');
          if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount) || Number(amount)<=0){setStatus('Ingresa un importe válido.');return;}
          const date=String(fields.get('date')??'');
          if(await save({action:'add',id:key,date,category:fields.get('category'),description:fields.get('description'),cents:Math.round(Number(amount)*100)},date.slice(0,7))){
            setKey(crypto.randomUUID());form.reset();
          }
        }}>
          <label>Fecha<Input type="date" name="date" defaultValue={today()} max={today()} required/></label>
          <label>Categoría<select name="category">{Object.entries(categories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>Concepto<Input name="description" placeholder="Ej. empaques para pedidos de la semana" minLength={3} maxLength={240} required/></label>
          <label>Importe MXN<Input name="amount" inputMode="decimal" required/></label>
          <Button type="submit" disabled={busy}>Guardar gasto pagado</Button>
        </form>
      </details>
      <h3>Gastos del mes</h3>
      {report.entries.length ? <ul className={styles.entries}>{report.entries.map(entry=><li key={entry.id}>
        <div><strong>{entry.description}</strong><small>{entry.date} · {categories[entry.category]}</small></div>
        <strong>{mxn(entry.cents)}{entry.voided?' · Anulado':''}</strong>
        {entry.voided ? <small>{entry.voidReason}</small> : <Button disabled={busy} variant="outline" onClick={()=>setVoidId(voidId===entry.id?'':entry.id)}>Anular gasto</Button>}
        {voidId===entry.id && <form onSubmit={async e=>{
          e.preventDefault();const fields=new FormData(e.currentTarget);
          if(await save({action:'void',id:entry.id,reason:fields.get('reason')}))setVoidId('');
        }}>
          <label>Motivo de anulación<Input name="reason" minLength={3} maxLength={240} required/></label>
          <Button type="submit" disabled={busy}>Confirmar anulación</Button>
        </form>}
      </li>)}</ul> : <p>Aún no hay gastos registrados en este mes.</p>}
    </> : !status && <p>Cargando resultados…</p>}
    <p role="status">{status}</p>
  </section>;
}
