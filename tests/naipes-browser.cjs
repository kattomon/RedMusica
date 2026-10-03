const {chromium,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.cwd(),out=process.env.NAIPES_SCREENSHOTS||'';
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
const people=[{token:'tok-k',id:'11111111-1111-4111-8111-111111111111',username:'Kattomon'},{token:'tok-a',id:'22222222-2222-4222-8222-222222222222',username:'Ana'}];
(async()=>{
 const {loadNaipesServer}=await import('./helpers/naipes-fake-server.mjs');
 await new Promise(r=>server.listen(4186,'127.0.0.1',r));
 for(const [label,device] of [['chromium',{viewport:{width:1200,height:900}}],['chromium-mobile',devices['Pixel 7']]]){
  const fake=await loadNaipesServer(people);
  const browser=await chromium.launch();const ctx=await browser.newContext({...device,serviceWorkers:'block'});const errors=[],leaks=[];
  await ctx.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({})};'}));
  await ctx.route('**/script.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/radio-panel.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/functions/v1/naipes',async r=>{
   const cors={'access-control-allow-origin':'http://127.0.0.1:4186'};
   if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{...cors,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'}});
   const token=r.request().headers().authorization.replace('Bearer ','');
   const res=await fake.handle(token,r.request().postData());const body=await res.text();
   if(/"hands"\s*:/.test(body)&&!/"phase":"(handOver|finished)"/.test(body))leaks.push(body.slice(0,200));
   return r.fulfill({status:res.status,contentType:'application/json',headers:cors,body});
  });
  async function open(person,query=''){
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(label+' '+person.username+': '+e.stack));
   await page.goto('http://127.0.0.1:4186/index.html?seccion=naipes'+query);
   await page.evaluate(p=>{window.REDMUSICA_CONFIG.supabaseUrl='https://test.invalid';window.REDMUSICA_CONFIG.supabasePublishableKey='test';
    window.redmusicaClient={auth:{getSession:async()=>({data:{session:{access_token:p.token,user:{id:p.id}}}}),onAuthStateChange:()=>{}},
     channel:topic=>{const wire=new BroadcastChannel(topic);let listener=null;const channel={on:(_t,_f,fn)=>{listener=fn;return channel;},subscribe:fn=>{wire.onmessage=event=>listener?.({payload:event.data.payload});setTimeout(()=>fn('SUBSCRIBED'),0);return channel;},send:async m=>{wire.postMessage(m);return 'ok';},unsubscribe:()=>wire.close()};return channel;},
     removeChannel:async c=>c.unsubscribe(),
     from:()=>{const q={select:()=>q,eq:async()=>({data:[{game:'brisca',games:3,wins:2,losses:1}],error:null})};return q;}};
    window.supabase={createClient:()=>window.redmusicaClient};document.getElementById('seccionNaipes').hidden=false;},person);
   await page.addScriptTag({content:fs.readFileSync('naipes.js','utf8')});
   return page;
  }
  const [K,A]=people;
  const match=()=>fake.tables.card_rooms[0].state.match;
  const pageOf=id=>id===K.id?host:guest;
  const nudge=async()=>{for(const p of [host,guest])await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));};
  const host=await open(K);
  assert.equal(await host.locator('.naipes-juego').count(),4,'four games on the menu');
  assert.match(await host.locator('#naipesRecord').innerText(),/Brisca 2\/3/);
  if(out)await host.screenshot({path:path.join(out,`naipes-menu-${label}.png`),fullPage:label==='chromium'});
  await host.getByRole('button',{name:'Crear mesa de ¡Última!'}).click();
  await host.locator('.naipes-codigo strong').waitFor();const code=await host.locator('.naipes-codigo strong').innerText();
  const guest=await open(A,'&mesa='+code);
  await host.waitForFunction(()=>/Repartir \(2 jugadores\)/.test(document.querySelector('.naipes-principal')?.textContent||''),null,{timeout:15000});
  assert.match(await guest.locator('.naipes-espera').innerText(),/Esperando que Kattomon reparta/);

  // ¡Última!
  await host.getByRole('button',{name:'Repartir (2 jugadores)'}).click();
  for(const p of [host,guest])await p.waitForFunction(()=>document.querySelectorAll('.mano .carta').length>=7,null,{timeout:15000});
  assert.equal(await guest.locator('.mano .carta').count(),match().hands[1].length,'each one sees exactly their cards');
  // Whoever has the turn plays a card that fits (or draws).
  const m0=match(),turnId=m0.players[m0.turn],tp=pageOf(turnId),hand=m0.hands[m0.turn];
  const E=await import('../supabase/functions/naipes/ultima.js');
  const fit=hand.find(c=>c.c&&E.playable(c,m0,hand));
  const seqBefore=m0.seq;
  if(fit){await tp.locator('.mano .carta-jugable').first().click();}else await tp.getByRole('button',{name:/Robar/}).click();
  await tp.waitForFunction(s=>true,seqBefore);await new Promise(r=>setTimeout(r,600));
  assert.ok(match().seq>seqBefore,'the move reached the server');
  if(out)await host.screenshot({path:path.join(out,`naipes-ultima-${label}.png`)});
  // Forgetting to say ¡Última!: the rival catches you.
  let m=match();m.turn=0;m.drawn=null;m.vulnerable=null;m.declared=[];m.color='R';m.top={id:9001,c:'R',v:'5'};m.hands[0]=[{id:9002,c:'R',v:'7'},{id:9003,c:'B',v:'2'}];m.seq++;
  await nudge();await host.waitForFunction(()=>document.querySelectorAll('.mano .carta').length===2,null,{timeout:10000});
  assert.equal(await host.getByRole('button',{name:'¡Última!'}).isVisible(),true,'the ¡Última! button appears with two cards');
  await host.locator('.mano .carta-jugable').first().click();
  await guest.getByRole('button',{name:/Te pillé, Kattomon/}).waitFor({timeout:10000});
  await guest.getByRole('button',{name:/Te pillé, Kattomon/}).click();
  await guest.waitForFunction(()=>/pilló a Kattomon/.test(document.querySelector('.naipes-noticia')?.textContent||''),null,{timeout:10000});
  assert.equal(match().hands[0].length,3,'caught: two more cards');
  // A comodín asks for a colour; the last card wins.
  m=match();m.turn=1;m.drawn=null;m.vulnerable=null;m.hands[1]=[{id:9010,c:null,v:'W'}];m.seq++;
  await nudge();await guest.waitForFunction(()=>document.querySelectorAll('.mano .carta').length===1,null,{timeout:10000});
  await guest.locator('.mano .carta').first().click();
  await guest.getByRole('button',{name:'verde'}).click();
  await guest.locator('.naipes-final').waitFor({timeout:10000});
  assert.match(await guest.locator('.naipes-final h4').innerText(),/Ganaste/);
  await host.locator('.naipes-final').waitFor({timeout:10000});assert.match(await host.locator('.naipes-final h4').innerText(),/Ganó Ana/);
  if(out)await guest.screenshot({path:path.join(out,`naipes-ultima-final-${label}.png`)});
  assert.equal(fake.tables.card_matches.length,1,'the finished game is recorded');

  // Brisca
  await host.getByRole('button',{name:'Cambiar de juego'}).click();
  await host.locator('.naipes-opcion select').first().selectOption('brisca');
  await host.waitForFunction(()=>document.querySelector('#naipesNombreJuego').textContent==='Brisca',null,{timeout:10000});
  await host.getByRole('button',{name:'Repartir (2 jugadores)'}).click();
  for(const p of [host,guest])await p.waitForFunction(()=>document.querySelectorAll('.mano .carta').length===3,null,{timeout:15000});
  m=match();const bp=pageOf(m.players[m.turn]);
  await bp.locator('.mano .carta').first().click();await bp.locator('.mano .carta-elegida').waitFor();
  await bp.locator('.mano .carta-elegida').click();
  for(const p of [host,guest])await p.waitForFunction(()=>document.querySelectorAll('.naipes-baza figure').length===1,null,{timeout:10000});
  if(out)await bp.screenshot({path:path.join(out,`naipes-brisca-${label}.png`)});

  // Poto Sucio
  m=match();m.phase='finished';m.champion=0;m.score=[1,0];m.lastHand={points:[70,50],winnerTeam:0};fake.tables.card_rooms[0].state.status='finished';fake.tables.card_rooms[0].state.recorded=true;
  await nudge();await host.getByRole('button',{name:'Cambiar de juego'}).click();
  await host.locator('.naipes-opcion select').first().selectOption('potosucio');
  await host.waitForFunction(()=>document.querySelector('#naipesNombreJuego').textContent==='Poto Sucio',null,{timeout:10000});
  await host.getByRole('button',{name:'Repartir (2 jugadores)'}).click();
  for(const p of [host,guest])await p.waitForFunction(()=>document.querySelector('.naipes-vecino'),null,{timeout:15000});
  m=match();const pp=pageOf(m.players[m.turn]),before=m.hands[m.from].length;
  await pp.locator('.mano-dorso .carta').first().click();
  await new Promise(r=>setTimeout(r,800));assert.equal(match().hands[m.from===1?1:0].length,before-1,'a card was taken from the neighbour');
  if(out)await pp.screenshot({path:path.join(out,`naipes-potosucio-${label}.png`)});

  // Carioca: draw, use the suggestion to lay down, discard.
  fake.tables.card_rooms[0].state.status='finished';fake.tables.card_rooms[0].state.recorded=true;match().phase='finished';match().loser=0;match().out=[1];
  await nudge();await host.getByRole('button',{name:'Cambiar de juego'}).click();
  await host.locator('.naipes-opcion select').first().selectOption('carioca');
  await host.waitForFunction(()=>document.querySelector('#naipesNombreJuego').textContent==='Carioca',null,{timeout:10000});
  await host.getByRole('button',{name:'Repartir (2 jugadores)'}).click();
  for(const p of [host,guest])await p.waitForFunction(()=>document.querySelectorAll('.mano .carta').length===12,null,{timeout:15000});
  m=match();const cid=m.players[m.turn],cp=pageOf(cid),cs=m.turn;
  m.hands[cs]=[{id:801,r:'4',s:'S'},{id:802,r:'4',s:'H'},{id:803,r:'4',s:'D'},{id:804,r:'9',s:'C'},{id:805,r:'9',s:'S'},{id:806,r:'JK',s:'*'},{id:807,r:'2',s:'C'},{id:808,r:'K',s:'D'}];m.seq++;
  await nudge();await cp.waitForFunction(()=>document.querySelectorAll('.mano .carta').length===8,null,{timeout:10000});
  await cp.getByRole('button',{name:/Robar del mazo/}).click();
  await cp.getByRole('button',{name:/Sugerir/}).waitFor({timeout:10000});
  await cp.getByRole('button',{name:/Sugerir/}).click();
  assert.equal(await cp.locator('.carioca-grupo').count(),2,'the suggestion builds the two tríos');
  await cp.getByRole('button',{name:'Bajarme'}).click();
  await cp.waitForFunction(()=>document.querySelectorAll('.carioca-juego').length===2,null,{timeout:10000});
  await cp.locator('.mano .carta').first().click();await cp.getByRole('button',{name:'Botar carta'}).click();
  await new Promise(r=>setTimeout(r,800));assert.equal(match().turn,1-cs,'the turn passes after discarding');
  const other=pageOf(match().players[match().turn]);
  await other.waitForFunction(()=>/Te toca: roba/.test(document.querySelector('.naipes-turno-texto')?.textContent||''),null,{timeout:10000});
  if(out)await cp.screenshot({path:path.join(out,`naipes-carioca-${label}.png`)});

  // Leaving mid-game cancels it for everyone.
  await guest.getByRole('button',{name:'Salir'}).click();await guest.getByRole('button',{name:/Salir\? Se cancela/}).click();
  await host.waitForFunction(()=>/salió de la mesa/.test(document.querySelector('.naipes-aviso-mesa')?.textContent||''),null,{timeout:15000});
  const layout=await host.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  assert.ok(layout.scroll<=layout.client+1,`no horizontal overflow (${layout.scroll} > ${layout.client})`);
  assert.deepEqual(leaks,[],'no response carries other players\' hands during play');
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS naipes browser ('+label+')');
 }
 server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1);});
