'use strict';

const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const {mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, symlinkSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const test = require('node:test');

const dependencies = process.env.TARSI_FLOOT_TEST_MODULES;
test('Floot v2 over isolated PostgreSQL: checkout, reservation, report, approval and outbox', {skip: !dependencies}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tarsi-flow-'));
  const modules = resolve(dependencies);
  const ts = require(join(modules, 'typescript'));
  const {PGlite} = require(join(modules, '@electric-sql/pglite'));
  const {Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, CamelCasePlugin} = require(join(modules, 'kysely'));
  const pg = new PGlite();
  const savedFetch = global.fetch;
  const names = ['JWT_SECRET','TARSI_TEST_STOREFRONT_URL','TARSI_PREVIEW_STOREFRONT_KEY','TARSI_STOREFRONT_KEY'];
  const savedEnv = Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const queued = [];
  let busy = false;
  const connection = {
    async executeQuery(query) {
      const result = await pg.query(query.sql, [...query.parameters]);
      return {rows:result.rows, numAffectedRows:BigInt(result.affectedRows ?? 0)};
    }
  };
  const driver = {
    async init() {},
    async acquireConnection() {
      if (busy) await new Promise(resolve => queued.push(resolve));
      busy = true;
      return connection;
    },
    async releaseConnection() {
      const next = queued.shift();
      if (next) next();
      else busy = false;
    },
    async beginTransaction() { await pg.exec('BEGIN'); },
    async commitTransaction() { await pg.exec('COMMIT'); },
    async rollbackTransaction() { await pg.exec('ROLLBACK'); },
    async destroy() {}
  };
  const db = new Kysely({dialect:{createAdapter:()=>new PostgresAdapter(),createDriver:()=>driver,
    createIntrospector:db=>new PostgresIntrospector(db),createQueryCompiler:()=>new PostgresQueryCompiler()},plugins:[new CamelCasePlugin()]});
  const symbol = Symbol.for('tarsi.floot.test.db');
  global[symbol] = db;
  const install = (file, source) => writeFileSync(join(root, file), source);
  try {
    for (const name of ['helpers','endpoints']) {
      mkdirSync(join(root,name));
      for (const file of readdirSync('floot/'+name).filter(file=>/\.tsx?$/.test(file))) {
        const source = readFileSync('floot/'+name+'/'+file,'utf8');
        install(name+'/'+file.replace(/\.tsx?$/,'.js'),ts.transpileModule(source,{
          compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
        }).outputText.replaceAll("require(\"@floot/google-integrations\")", "require('../google.js')"));
      }
    }
    symlinkSync(modules,join(root,'node_modules'),'dir');
    install('helpers/db.js',"exports.db=global[Symbol.for('tarsi.floot.test.db')];");
    install('helpers/getServerUserSession.js',"exports.getServerUserSession=async req=>req.headers.has('x-test-admin')?{user:{id:1,role:'admin'}}:null;");
    install('google.js',"exports.getGoogleAccessToken=async()=>({access_token:'synthetic'});");
    await pg.exec('CREATE TABLE users (id integer PRIMARY KEY); INSERT INTO users VALUES (1);');
    const migration = file => pg.exec(readFileSync('floot/'+file+'.sql','utf8'));
    for (const name of ['migration','sales-migration','order-adjustments','preview-checkout','live-checkout']) await migration(name);
    await pg.query(`INSERT INTO tarsi_web_orders(idempotency_key,request_digest,payload,is_test,number)
      VALUES($1,'legacy','{"items":[{"size":"XS","qty":1}],"total":399}',true,'TARSI-HISTORICO')`,[randomUUID()]);
    await migration('order-flow-v2');
    await migration('order-flow-v2');
    assert.equal((await pg.query("SELECT payload->'items'->0->>'size' AS size FROM tarsi_web_orders WHERE number='TARSI-HISTORICO'")).rows[0].size,'XS');
    await pg.exec("INSERT INTO tarsi_preview_checkout_config(bank,holder,clabe) VALUES('Banco de prueba','Titular de prueba','000000000000000000')");
    process.env.JWT_SECRET = 'test-only-hmac-secret';
    process.env.TARSI_TEST_STOREFRONT_URL = 'https://deploy-preview-7--tarsi-skydropx.netlify.app/';
    process.env.TARSI_PREVIEW_STOREFRONT_KEY='synthetic-preview-key-at-least-32';
    delete process.env.TARSI_STOREFRONT_KEY;
    const liveKey='synthetic-live-key-at-least-32-characters';
    const workerKey='synthetic-live-worker-key-at-least-32-characters';
    const mails = [];
    let mailStatus = 200;
    global.fetch = async (url, options) => {
      if (url.includes('/postal-code?')) return Response.json({colonies:[{name:'Centro',city:'Querétaro',state:'Querétaro'}]});
      if (url.endsWith('/shipping-quote')) return Response.json({customer_price:150,
        expires_at:new Date(Date.now()+600000).toISOString(),carrier_name:'FedEx',carrier_service:'Priority',quotation_id:'private'});
      if (url.startsWith('https://gmail.googleapis.com/')) {
        const message = Buffer.from(JSON.parse(options.body).raw,'base64url').toString();
        mails.push(message);
        return Response.json({id:'fake-'+mails.length},{status:mailStatus});
      }
      throw new Error('Unexpected upstream');
    };
    const checkout = require(join(root,'helpers/storefrontCheckout.js')).handleStorefront;
    const admin = require(join(root,'endpoints/tarsi_web_admin_POST.js')).handle;
    const drain = require(join(root,'helpers/orderFlowMail.js')).drainOrderMail;
    const send = (data,isTest=true,authorized=true) => checkout(new Request('https://sandbox.example/_api/test',{
      method:'POST',headers:{...(isTest?{'x-tarsi-preview':'checkout-v1'}:{'x-tarsi-storefront':'storefront-v1'}),
        Authorization:authorized?'Bearer '+(isTest?process.env.TARSI_PREVIEW_STOREFRONT_KEY:liveKey):''},body:JSON.stringify(data)
    }),isTest,true);
    const manage = (data, authorized=true) => admin(new Request('https://sandbox.example/_api/admin',{
      method:'POST',headers:{origin:'https://sandbox.example',...(authorized?{'x-test-admin':'1'}:{})},body:JSON.stringify({test:true,...data})
    }));
    const fixture = (size='M')=>({mode:'checkout',key:randomUUID(),items:[{id:0,size,qty:1}],acceptedTotal:399,
      customer:{name:'Cliente aislado',email:'cliente@example.com',phone:'5555550000'},delivery:'Entrega en Querétaro',
      address:{postal_code:'76099',area_level3:'Centro',street:'Calle ficticia 1'}});
    assert.equal((await send(fixture(),true,false)).status,403);
    assert.equal((await send(fixture('XS'))).status,400);
    assert.equal((await send(fixture())).status,503);
    await pg.exec("INSERT INTO tarsi_blank_policy VALUES(true,true); INSERT INTO tarsi_blank_stock VALUES(true,'M',1,0,NULL),(true,'S',2,0,NULL)");
    const primary = fixture();
    const changedTotal = {...fixture(),acceptedTotal:1};
    assert.equal((await send(changedTotal)).status,409);
    const response = await send(primary);
    assert.equal(response.status,200);
    const receipt = await response.json();
    assert.match(receipt.number,/^TARSI-\d{6}$/);
    assert.equal(receipt.total,399);
    assert.equal(receipt.status,'Pendiente de pago');
    assert.ok(receipt.transfer && receipt.holdUntil);
    assert.equal((await (await send(primary)).json()).number,receipt.number);
    assert.equal(mails.length,1);
    assert.match(mails[0],/To: tarsi.studiomx@gmail.com/);
    assert.match(mails[0],/Solicitud registrada TARSI-/);
    assert.equal((await send({...fixture(),items:[{id:1,size:'M',qty:1}]})).status,409);
    assert.equal((await send({mode:'recover',key:randomUUID()})).status,404);
    const pending = await (await manage({action:'list',search:receipt.number})).json();
    assert.equal(pending.orders.length,1);
    const id = pending.orders[0].id;
    assert.equal(pending.paid,0);
    const pendingReminder=pending.orders[0].mailHistory.find(mail=>mail.kind==='reminder');
    assert.equal(pendingReminder.state,'pending');
    assert.equal(pendingReminder.attempts,0);
    assert.ok(Date.parse(pendingReminder.dueAt)>Date.now());
    assert.equal((await manage({action:'list'},false)).status,403);
    await pg.exec("UPDATE tarsi_order_flow SET hold_until=now()-interval '11 hours 30 minutes' WHERE hold_until IS NOT NULL");
    await pg.query("UPDATE tarsi_web_orders SET created_at=now()-interval '12 hours' WHERE id=$1",[id]);
    const recovered = await (await send({mode:'recover',key:primary.key})).json();
    assert.equal(recovered.number,receipt.number);
    assert.equal(recovered.transfer,null);
    assert.equal(recovered.customer,undefined);
    assert.ok((await (await send({mode:'renew',key:primary.key})).json()).transfer);
    await pg.exec("UPDATE tarsi_order_flow SET hold_until=now()-interval '1 hour'");
    const report = {mode:'report',key:primary.key,bank:'Banco de prueba',reference:'TEST12345',cents:39900,
      date:(await pg.query("SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text AS day")).rows[0].day};
    assert.equal((await send(report)).status,200);
    assert.equal((await send(report)).status,200);
    assert.equal((await pg.query("SELECT state FROM tarsi_mail_outbox WHERE kind='reminder'")).rows[0].state,'suppressed');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM tarsi_production_work')).rows[0].n,0);
    const verify = {action:'confirm-payment',id,cents:39900,reference:'TEST12345',verified:true};
    assert.equal((await manage({...verify,cents:10000})).status,422);
    const confirmed = await manage(verify);
    assert.equal(confirmed.status,200,await confirmed.text());
    assert.equal((await manage(verify)).status,409);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM tarsi_production_work')).rows[0].n,1);
    assert.equal((await pg.query("SELECT on_hand FROM tarsi_blank_stock WHERE size='M'")).rows[0].on_hand,0);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM tarsi_blank_movements')).rows[0].n,1);
    assert.match(mails.at(-1),/Tu pedido est/);
    mailStatus = 429;
    const second = fixture('S');
    const next = await send(second);
    assert.equal(next.status,200);
    const secondNumber = (await next.json()).number;
    assert.notEqual(secondNumber,receipt.number);
    const retrying = await (await manage({action:'list',search:secondNumber})).json();
    const registration = retrying.orders[0].mailHistory.find(mail=>mail.kind==='registered');
    assert.equal(registration.state,'pending');
    assert.equal(registration.lastError,'Gmail HTTP 429');
    assert.equal((await send({...report,key:second.key})).status,409);
    assert.equal((await pg.query('SELECT last_issue FROM tarsi_order_flow WHERE recovery_key=$1',[second.key])).rows[0].last_issue,
      'Referencia reportada en otro pedido');
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM tarsi_mail_outbox WHERE state='pending' AND attempts=1")).rows[0].n,1);
    await pg.exec("UPDATE tarsi_mail_outbox SET due_at=now() WHERE state='pending'");
    mailStatus = 200;
    await drain(true);
    assert.equal(mails.filter(message=>/Sigue con tu pedido TARSI-/.test(message)).length,1);
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM tarsi_mail_outbox WHERE kind='reminder' AND state='accepted'")).rows[0].n,1);
    assert.equal((await drain(true)).processed,0);
    const accepted = await (await manage({action:'list',search:secondNumber})).json();
    const reminder = accepted.orders[0].mailHistory.find(mail=>mail.kind==='reminder');
    assert.equal(reminder.state,'accepted');
    assert.equal(reminder.attempts,1);
    assert.ok(Date.parse(reminder.acceptedAt));
    assert.equal(reminder.providerId,undefined);
    const suppressed = await (await manage({action:'list',search:receipt.number})).json();
    assert.equal(suppressed.orders[0].mailHistory.find(mail=>mail.kind==='reminder').state,'suppressed');
    assert.equal((await manage({action:'revoke-recovery',id})).status,200);
    assert.equal((await send({mode:'recover',key:primary.key})).status,404);
    assert.equal((await manage({action:'reissue-recovery',id})).status,200);
    assert.equal((await manage({action:'reissue-recovery',id})).status,409);
    assert.match(mails.at(-1),/Nuevo enlace de tu pedido TARSI-/);
    const recoveredKey=(await pg.query('SELECT recovery_key::text FROM tarsi_order_flow WHERE order_id=$1',[id])).rows[0].recovery_key;
    assert.notEqual(recoveredKey,primary.key);
    assert.equal((await send({mode:'recover',key:primary.key})).status,404);
    assert.equal((await (await send({mode:'recover',key:recoveredKey})).json()).number,receipt.number);
    await pg.exec("INSERT INTO tarsi_live_checkout_config(enabled,bank,holder,clabe) VALUES(true,'Banco de prueba','Titular de prueba','000000000000000000')");
    await pg.exec("INSERT INTO tarsi_blank_policy VALUES(false,true); INSERT INTO tarsi_blank_stock VALUES(false,'M',1,0,NULL)");
    assert.equal((await send(fixture(),false)).status,403);
    const hash = key => createHash('sha256').update('Bearer '+key).digest('hex');
    await pg.query('INSERT INTO tarsi_live_integration (storefront_auth_sha256,mail_auth_sha256) VALUES($1,$2)',
      [hash(liveKey),hash(workerKey)]);
    const worker=require(join(root,'endpoints/tarsi_mail_worker_POST.js')).handle;
    const runWorker=key=>worker(new Request('https://tarsi-control-ventas.floot.app/_api/tarsi_mail_worker',
      {method:'POST',headers:{Authorization:'Bearer '+key}}));
    assert.equal((await runWorker(liveKey)).status,403);
    assert.equal((await runWorker(workerKey)).status,200);
    const national = {...fixture(),delivery:'Envío nacional',acceptedTotal:549};
    const quote = await (await send({mode:'quote',quantity:1,destination:national.address},false)).json();
    assert.equal(quote.customer_price,150);
    assert.equal(quote.shipping_charge,150);
    assert.equal(quote.quotationId,undefined);
    assert.equal((await send({...national,proof:'invalid'},false)).status,409);
    const booked = await send({...national,proof:quote.proof},false);
    assert.equal(booked.status,200);
    const publicReceipt = await booked.json();
    assert.equal(publicReceipt.total,549);
    assert.equal(publicReceipt.skydropx,undefined);
    assert.match(mails.at(-1),/To: cliente@example.com/);
    const metrics = async ()=> (await manage({action:'list',test:false})).json();
    const live = await metrics();
    assert.deepEqual([live.orders.length, live.paid, live.revenue],[1,0,0]);
    const liveConfirm = await manage({...verify,test:false,id:live.orders[0].id,cents:54900});
    assert.equal(liveConfirm.status,200,await liveConfirm.text());
    const collected = await metrics();
    assert.deepEqual([collected.orders.length,collected.paid,collected.revenue],[1,1,549]);
    await pg.exec("INSERT INTO tarsi_blank_stock VALUES(false,'XL',10,0,NULL)");
    const three = await (await send({mode:'quote',quantity:3,destination:national.address},false)).json();
    assert.equal(three.shipping_charge,150);
    const four = await (await send({mode:'quote',quantity:4,destination:national.address},false)).json();
    assert.equal(four.customer_price,150);
    assert.equal(four.shipping_charge,0);
    const promotion = {...fixture('XL'),delivery:'Envío nacional',items:[{id:0,size:'XL',qty:4}],proof:four.proof};
    promotion.customer.email='recordatorio@example.invalid';
    assert.equal((await send({...promotion,acceptedTotal:1397},false)).status,409);
    const free = await send({...promotion,acceptedTotal:1398},false);
    assert.equal(free.status,200);
    const freeReceipt = await free.json();
    assert.equal(freeReceipt.shipping,0);
    assert.equal(freeReceipt.total,1398);
    assert.equal((await pg.query('SELECT payload FROM tarsi_web_orders WHERE number=$1',[freeReceipt.number])).rows[0].payload.skydropx.price,150);
    const cached = await send({...promotion,key:randomUUID(),acceptedTotal:1548},false);
    assert.equal(cached.status,200);
    assert.equal((await cached.json()).total,1398);
    await pg.query("UPDATE tarsi_order_flow SET hold_until=now()-interval '1 minute' WHERE recovery_key=$1",[promotion.key]);
    const renewedFreeShipping = await send({mode:'renew',key:promotion.key},false);
    assert.equal(renewedFreeShipping.status,200);
    assert.equal((await renewedFreeShipping.json()).total,1398);
    const remindersFor = number => mails.filter(message => message.includes('Subject: Sigue con tu pedido '+number));
    assert.equal(remindersFor(freeReceipt.number).length,0);
    await pg.query("UPDATE tarsi_mail_outbox SET due_at=now() WHERE kind='reminder' AND order_id=(SELECT id FROM tarsi_web_orders WHERE number=$1)",[freeReceipt.number]);
    assert.equal((await runWorker(workerKey)).status,200);
    assert.equal((await runWorker(workerKey)).status,200);
    const liveReminder = remindersFor(freeReceipt.number);
    assert.equal(liveReminder.length,1);
    assert.match(liveReminder[0],/From: tarsi\.studiomx@gmail\.com/);
    assert.match(liveReminder[0],/To: recordatorio@example\.invalid/);
  } finally {
    global.fetch = savedFetch;
    delete global[symbol];
    for (const [name,value] of Object.entries(savedEnv)) {
      if(value===undefined) delete process.env[name];
      else process.env[name]=value;
    }
    await db.destroy();
    await pg.close();
    rmSync(root,{recursive:true,force:true});
  }
});

test('PostgreSQL concurrent connections serialize the last blank and its assignment', {
  skip: !dependencies || process.env.TARSI_FLOOT_TEST_CONCURRENCY !== '1'
}, async () => {
  const {createServer} = require('node:net');
  const {once} = require('node:events');
  const {setTimeout: delay} = require('node:timers/promises');
  const modules = resolve(dependencies);
  const EmbeddedPostgres = require(join(modules,'embedded-postgres/dist/index.js')).default;
  const portFinder = createServer().listen(0,'127.0.0.1');
  await once(portFinder,'listening');
  const {port} = portFinder.address();
  await new Promise(resolve=>portFinder.close(resolve));
  const root = mkdtempSync(join(tmpdir(),'tarsi-postgres-'));
  const logs = [];
  const pg = new EmbeddedPostgres({databaseDir:join(root,'data'),port,persistent:false,onLog:entry=>logs.push(String(entry)),
    onError:entry=>logs.push(String(entry)),postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='+root]});
  const clients = [];
  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    for(let index=0;index<3;index++){
      const client=pg.getPgClient();
      await client.connect();
      clients.push(client);
    }
    const [observer,first,second]=clients;
    await observer.query('CREATE TABLE users(id integer PRIMARY KEY);');
    for(const name of ['migration','order-flow-v2']) await observer.query(readFileSync('floot/'+name+'.sql','utf8'));
    await observer.query("INSERT INTO tarsi_blank_policy VALUES(true,true); INSERT INTO tarsi_blank_stock VALUES(true,'M',1,0,NULL)");
    async function create(client,design){
      const key=randomUUID();
      const result=await client.query(`INSERT INTO tarsi_web_orders(idempotency_key,request_digest,payload,is_test,number)
        VALUES($1,'synthetic',$2,true,'TARSI-'||lpad(nextval('tarsi_short_order_seq')::text,6,'0')) RETURNING id,number`,
        [key,{items:[{id:design,size:'M',qty:1}]}]);
      const order=result.rows[0];
      await client.query('INSERT INTO tarsi_order_flow(order_id,recovery_key) VALUES($1,$2)',[order.id,key]);
      return order;
    }
    async function allocate(client,order,assign){
      return (await client.query('SELECT tarsi_allocate_blanks($1,$2) AS ok',[order.id,assign])).rows[0].ok;
    }
    async function waitForLock(client){
      const pid=client.processID;
      for(let count=0;count<100;count++){
        const activity=await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
        if(activity.rows[0]?.wait_event_type==='Lock') return;
        await delay(10);
      }
      throw new Error('Second PostgreSQL session did not wait for a lock');
    }
    await first.query('BEGIN');
    const reserved=await create(first,0);
    assert.equal(await allocate(first,reserved,false),true);
    await second.query('BEGIN');
    const contender=await create(second,1);
    const rejected=allocate(second,contender,false);
    await waitForLock(second);
    await first.query('COMMIT');
    assert.equal(await rejected,false);
    await second.query('ROLLBACK');
    assert.notEqual(reserved.number,contender.number);
    assert.deepEqual((await observer.query('SELECT number FROM tarsi_web_orders')).rows,[{number:reserved.number}]);
    await first.query('BEGIN');
    assert.equal(await allocate(first,reserved,true),true);
    await second.query('BEGIN');
    const duplicate=allocate(second,reserved,true);
    await waitForLock(second);
    await first.query('COMMIT');
    assert.equal(await duplicate,true);
    await second.query('COMMIT');
    assert.equal((await observer.query('SELECT on_hand FROM tarsi_blank_stock')).rows[0].on_hand,0);
    assert.equal((await observer.query('SELECT count(*)::int AS n FROM tarsi_blank_movements')).rows[0].n,1);
  } catch(error) {
    if(!started && logs.length) throw new Error(logs.join('\n'),{cause:error});
    throw error;
  } finally {
    await Promise.allSettled(clients.map(client=>client.end()));
    if(started) await pg.stop();
    rmSync(root,{recursive:true,force:true});
  }
});
