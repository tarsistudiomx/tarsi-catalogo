import React,{useEffect,useState} from 'react';
import {Button} from './Button';
import {Input} from './Input';
import {sizes} from '../endpoints/tarsi_inventory_POST.schema';
import styles from './TarsiFinance.module.css';

type Stock={size:string;onHand:number;lowAt:number;restockOn:string|null;reserved:number;assigned:number};
type Movement={size:string;qty:number;reason:string;movedAt:string;number:string|null};
type Inventory={enabled:boolean;stock:Stock[];movements:Movement[]};
async function req(input:Record<string,unknown>){
  const response=await fetch('/_api/tarsi_inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const body=await response.json();
  if(!response.ok)throw new Error(body.error||'No pudimos consultar el inventario.');
  return body as Inventory;
}
export function TarsiInventory(){
  const [test,setTest]=useState(false);
  const [data,setData]=useState<Inventory|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [size,setSize]=useState<string>('S');
  useEffect(()=>{
    let active=true;
    setData(null);setMessage('');
    req({action:'list',test}).then(result=>{if(active)setData(result);}).catch(error=>{if(active)setMessage(error.message);});
    return()=>{active=false;};
  },[test]);
  async function save(input:Record<string,unknown>){
    if(busy)return;
    setBusy(true);setMessage('');
    try{await req({...input,test});setData(await req({action:'list',test}));setMessage('Inventario actualizado.');}
    catch(error){setMessage(error instanceof Error?error.message:'No se guardó el cambio.');}
    finally{setBusy(false);}
  }
  const selected=data?.stock.find(row=>row.size===size);
  return <section className={styles.finance}>
    <header><div><h2>Inventario de blanks</h2><p>Todos los diseños usan el mismo inventario por talla.</p></div>
    <Button variant="outline" disabled={busy} onClick={()=>setTest(!test)}>{test?'Ver inventario real':'Ver inventario de prueba'}</Button></header>
    {test&&<p>Solo pruebas</p>}
    {data&&<>
      <p>{data.enabled?'Reservas activas de 30 minutos.':'Reservas de stock desactivadas hasta confirmar el conteo de todas las tallas.'}</p>
      <ul className={styles.entries}>{sizes.map(value=>{
        const row=data.stock.find(item=>item.size===value);
        const available=row?row.onHand-row.reserved:null;
        return <li key={value}><div><strong>Talla {value}</strong><small>{row?
          'Disponibles '+available+' · Reservadas '+row.reserved+' · Asignadas '+row.assigned:'Sin conteo registrado'}</small></div>
          {row&&available!==null&&available<=row.lowAt&&<strong>Stock bajo</strong>}
          {row?.restockOn&&<small>Reposición {row.restockOn}</small>}</li>;
      })}</ul>
      <details className={styles.panel}><summary>Registrar conteo o reposición</summary>
        <label>Talla<select value={size} onChange={e=>setSize(e.target.value)}>{sizes.map(item=><option key={item}>{item}</option>)}</select></label>
        <form key={String(test)+size+JSON.stringify(selected)} onSubmit={e=>{
          e.preventDefault();const fields=new FormData(e.currentTarget);
          void save({action:'set',size,count:Number(fields.get('count')),low:Number(fields.get('low')),
            restock:fields.get('restock')||null,reason:fields.get('reason')});
        }}>
          <label>Existencias físicas de blanks sin asignar<Input name="count" type="number" step="1" min="0" max="100000" defaultValue={selected?.onHand} required/></label>
          <label>Umbral de stock bajo<Input name="low" type="number" step="1" min="0" max="100000" defaultValue={selected?.lowAt} required/></label>
          <label>Fecha de reposición (opcional)<Input name="restock" type="date" defaultValue={selected?.restockOn??''}/></label>
          <label>Motivo<Input name="reason" minLength={3} maxLength={160} required/></label>
          <Button type="submit" disabled={busy}>Guardar conteo</Button>
        </form>
      </details>
      {!data.enabled&&data.stock.length===sizes.length&&<form onSubmit={e=>{
        e.preventDefault();void save({action:'enable',verified:true});
      }}><label><input type="checkbox" required/> Confirmé que estos son los conteos físicos.</label>
        <Button type="submit" disabled={busy}>Activar reservas de 30 minutos</Button></form>}
      <details className={styles.panel}><summary>Historial de movimientos</summary><ul>{data.movements.map((row,index)=>
        <li key={index}>{new Date(row.movedAt).toLocaleString('es-MX')} · {row.size} · {row.qty>0?'+':''}{row.qty} · {row.reason}{row.number?' · '+row.number:''}</li>)}</ul></details>
    </>}
    <p role="status">{message}</p>
  </section>;
}
