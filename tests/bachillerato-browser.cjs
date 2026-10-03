const {chromium,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.cwd(),out=process.env.TUTTI_SCREENSHOTS||'';
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
const people=[{token:'tok-k',id:'11111111-1111-4111-8111-111111111111',username:'Kattomon'},{token:'tok-a',id:'22222222-2222-4222-8222-222222222222',username:'Ana'},{token:'tok-b',id:'33333333-3333-4333-8333-333333333333',username:'Beto'}];
(async()=>{
 const {loadTuttiServer}=await import('./helpers/tutti-fake-server.mjs');
 await new Promise(r=>server.listen(4185,'127.0.0.1',r));
 const engines=[['chromium',{viewport:{width:1200,height:900}}],['chromium-mobile',devices['Pixel 7']]];
 for(const [label,device] of engines){
  const fake=await loadTuttiServer(people);
  const browser=await chromium.launch();const ctx=await browser.newContext({...device,serviceWorkers:'block'});const errors=[];
  await ctx.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({})};'}));
  await ctx.route('**/script.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/radio-panel.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/functions/v1/bachillerato',async r=>{
   const cors={'access-control-allow-origin':'http://127.0.0.1:4185'};
   if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{...cors,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'}});
   const res=await fake.handle(r.request().headers().authorization.replace('Bearer ',''),r.request().postData());
   return r.fulfill({status:res.status,contentType:'application/json',headers:cors,body:await res.text()});
  });
  async function open(person,query=''){
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(label+' '+person.username+': '+e.stack));
   await page.goto('http://127.0.0.1:4185/index.html?seccion=bachillerato'+query);
   await page.evaluate(p=>{window.REDMUSICA_CONFIG.supabaseUrl='https://test.invalid';window.REDMUSICA_CONFIG.supabasePublishableKey='test';
    const stats={'11111111-1111-4111-8111-111111111111':{games:4,wins:2,points:310}};
    window.redmusicaClient={auth:{getSession:async()=>({data:{session:{access_token:p.token,user:{id:p.id}}}}),onAuthStateChange:()=>{}},
     channel:topic=>{const wire=new BroadcastChannel(topic);let listener=null;const channel={on:(_t,_f,fn)=>{listener=fn;return channel;},subscribe:fn=>{wire.onmessage=event=>listener?.({payload:event.data.payload});setTimeout(()=>fn('SUBSCRIBED'),0);return channel;},send:async m=>{wire.postMessage(m);return 'ok';},unsubscribe:()=>wire.close()};return channel;},
     removeChannel:async c=>c.unsubscribe(),
     from:table=>{const q={_id:null,select:()=>q,eq:(c,v)=>{q._id=v;return q;},maybeSingle:async()=>({data:table==='tutti_stats'?stats[q._id]||null:null,error:null})};return q;}};
    window.supabase={createClient:()=>window.redmusicaClient};document.getElementById('seccionBachillerato').hidden=false;},person);
   await page.addScriptTag({content:fs.readFileSync('bachillerato.js','utf8')});
   return page;
  }
  const [K,A,B]=people;
  const host=await open(K);
  assert.equal(await host.getByRole('heading',{name:/Bachillerato · Tutti frutti/}).isVisible(),true);
  await host.locator('#tuttiRecord').waitFor();assert.equal(await host.locator('#tuttiRecord').innerText(),'Tu récord: 2 victorias en 4 partidas · 310 puntos');
  await host.getByRole('button',{name:'Crear sala'}).click();
  await host.locator('.tutti-codigo strong').waitFor();
  const code=await host.locator('.tutti-codigo strong').innerText();assert.match(code,/^[A-Z0-9]{6}$/);
  assert.match(host.url(),new RegExp('seccion=bachillerato&tutti='+code));
  // Host trims the categories to three plus one of their own, one round, Basta cuts at once.
  while(await host.locator('.tutti-editables li').count()>3){await host.locator('.tutti-editables li button').first().click();}
  assert.equal(await host.locator('.tutti-editables li button').first().isDisabled(),true,'at least three categories');
  await host.locator('#tuttiNuevaCategoria').fill('Canción');await host.getByRole('button',{name:'Agregar'}).click();
  assert.equal(await host.locator('.tutti-editables li').count(),4);
  await host.locator('.tutti-opcion',{hasText:'Rondas'}).locator('select').selectOption('1');
  await host.locator('.tutti-opcion',{hasText:'Después del ¡Basta!'}).locator('select').selectOption('0');
  const categories=await host.locator('.tutti-editables li span').allInnerTexts();
  // Two friends join with the invitation link; they see the host's rules.
  const guest=await open(A,'&tutti='+code),third=await open(B,'&tutti='+code);
  await host.waitForFunction(()=>/Jugadores \(3\)/.test(document.querySelector('#tuttiTituloJugadores')?.textContent),null,{timeout:15000});
  await guest.waitForFunction(n=>document.querySelectorAll('.tutti-resumen .tutti-etiquetas li').length===n,categories.length,{timeout:15000});
  assert.match(await guest.locator('.tutti-espera').innerText(),/Esperando que Kattomon/);
  assert.equal(await guest.locator('.tutti-editor').count(),0,'only the host edits the rules');
  if(out)await host.screenshot({path:path.join(out,`tutti-sala-${label}.png`),fullPage:label==='chromium'});
  await host.getByRole('button',{name:'Empezar con 3 jugadores'}).click();
  // The letter spins, then everyone can type.
  for(const p of [host,guest,third])await p.waitForFunction(()=>{const i=document.querySelector('#tuttiCampo0');return i&&!i.disabled;},null,{timeout:20000});
  const letter=(await host.locator('#tuttiLetra').innerText()).trim();assert.match(letter,/^[A-Z]$/);
  assert.equal(await guest.locator('#tuttiLetra').innerText(),letter,'everyone has the same letter');
  const word=s=>letter+s;
  // Host fills everything; Ana repeats the host's first answer; Beto writes one with the wrong letter.
  for(let i=0;i<4;i++)await host.locator('#tuttiCampo'+i).fill(word(['ndrea','aaa','olorado','anción'][i]));
  await guest.locator('#tuttiCampo0').fill(word('ndrea'));await guest.locator('#tuttiCampo1').fill(word('uno'));
  await third.locator('#tuttiCampo0').fill('Zzzz');await third.locator('#tuttiCampo2').fill(word('ojo'));
  assert.equal(await third.locator('#tuttiFila0').getAttribute('class'),'tutti-campo tutti-campo-mal','wrong letter is flagged while typing');
  assert.equal(await guest.locator('#tuttiBasta').isDisabled(),true,'Basta needs every category');
  assert.equal(await host.locator('#tuttiBasta').isEnabled(),true);
  await guest.waitForTimeout(1500);
  if(out)await guest.screenshot({path:path.join(out,`tutti-ronda-${label}.png`)});
  await host.locator('#tuttiBasta').click();
  await guest.waitForFunction(()=>/BASTA/.test(document.querySelector('#tuttiAlerta')?.textContent||'')||document.querySelector('[data-fase=review]'),null,{timeout:10000});
  // After the grace period everyone moves to the review.
  for(const p of [host,guest,third])await p.waitForFunction(()=>document.querySelector('#tuttiVista').dataset.fase==='review',null,{timeout:20000});
  const answersIn=fake.tables.tutti_answers.map(r=>r.answers);
  assert.ok(answersIn.some(a=>a[1]===word('uno')),'answers typed just before the bell were saved');
  assert.equal(await guest.locator('.tutti-respuesta').count(),12,'three players x four categories');
  const hostColor=k=>p=>p.locator(`.tutti-respuesta[data-key="${K.id}:2"]`);
  // Ana and Beto reject the host's third answer: two of two other voters.
  await hostColor()(guest).locator('.tutti-anular').click();await hostColor()(third).locator('.tutti-anular').click();
  assert.equal(await hostColor()(guest).locator('.tutti-anular').getAttribute('aria-pressed'),'true');
  assert.equal(await host.locator(`.tutti-respuesta[data-key="${K.id}:0"] .tutti-anular`).count(),0,'you cannot reject your own answer');
  await host.waitForFunction(id=>/anulada/.test(document.querySelector(`.tutti-respuesta[data-key="${id}:2"] .tutti-estado-resp`)?.textContent||''),K.id,{timeout:15000});
  if(out)await guest.screenshot({path:path.join(out,`tutti-revision-${label}.png`)});
  for(const p of [host,guest,third])await p.locator('#tuttiListo').click();
  for(const p of [host,guest,third])await p.waitForFunction(()=>document.querySelector('#tuttiVista').dataset.fase==='finished',null,{timeout:20000});
  // Points: Andrea repeated (5+5), host 4th answer unique among valid (20 when only one), color annulled.
  const ranking=await host.locator('.tutti-puesto').allInnerTexts();assert.equal(ranking.length,3);
  const totals=Object.fromEntries(fake.tables.tutti_answers.map(r=>[r.user_id,r.score]));
  assert.equal(totals[K.id],5+10+0+20,'host: repeated, unique, annulled, only answer');
  assert.equal(totals[A.id],5+10,'Ana: repeated and unique');
  assert.equal(totals[B.id],20,'Beto: wrong letter, then the only valid answer once the host one is annulled');
  assert.match(await host.locator('.tutti-titulo').innerText(),/Ganaste/);
  assert.match(await guest.locator('.tutti-titulo').innerText(),/Ganó Kattomon/);
  assert.equal(fake.tables.tutti_games.length,1);assert.equal(fake.tables.tutti_stats.length,3,'the finished game counts for everyone who played');
  if(out)await host.screenshot({path:path.join(out,`tutti-final-${label}.png`)});
  // Another game, then someone leaves.
  await host.getByRole('button',{name:'Jugar otra vez'}).click();
  await guest.waitForFunction(()=>document.querySelector('#tuttiVista').dataset.fase==='playing',null,{timeout:15000});
  await third.getByRole('button',{name:'Salir'}).click();await third.getByRole('button',{name:/Salir\? Toca otra vez/}).click();
  await third.waitForFunction(()=>!document.querySelector('#tuttiEntrada').hidden);
  assert.equal(fake.tables.tutti_players.length,2);
  // Phone layout: no sideways scroll and the Basta button stays on screen.
  const layout=await guest.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,h:innerHeight,basta:document.querySelector('#tuttiBasta').getBoundingClientRect().toJSON()}));
  assert.ok(layout.scroll<=layout.client+1,`no horizontal overflow (${layout.scroll} > ${layout.client})`);
  assert.ok(layout.basta.bottom<=layout.h+1&&layout.basta.top>=0,'the ¡Basta! button is visible '+JSON.stringify(layout));
  // Profile line.
  const profile=await open(A);
  await profile.evaluate(id=>{document.getElementById('perfilPublico').hidden=false;document.getElementById('presenciaPerfil').dataset.userId=id;},K.id);
  await profile.waitForFunction(()=>!document.getElementById('tuttiPerfil').hidden);
  assert.equal(await profile.locator('#tuttiPerfil').innerText(),'Bachillerato: 2 victorias en 4 partidas');
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS bachillerato browser ('+label+')');
 }
 server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1);});
