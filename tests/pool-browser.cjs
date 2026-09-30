const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
const out=process.env.POOL_SCREENSHOTS||'';
(async()=>{
 const E=await import('../supabase/functions/pool/engine.js'),Rooms=await import('../supabase/functions/pool/rooms.js');
 await new Promise(r=>server.listen(4183,'127.0.0.1',r));
 const engines=process.env.TEST_WEBKIT_ONLY?[['webkit',webkit,devices['iPhone 13']]]:process.env.TEST_CHROMIUM_ONLY?[['chromium',chromium,{viewport:{width:1200,height:900}}],['chromium-mobile',chromium,devices['Pixel 7']]]:[['chromium',chromium,{viewport:{width:1200,height:900}}],['webkit',webkit,devices['iPhone 13']]];
 const names={host:'Kattomon',guest:'Ana'};
 for(const [label,engine,device] of engines){
  const browser=await engine.launch();const ctx=await browser.newContext({...device,serviceWorkers:'block'});
  let room=null,shots=[];const errors=[];
  const bytes=Array.from({length:32},(_,i)=>(i*57+11)%256);
  await ctx.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({})};'}));
  await ctx.route('**/script.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/radio-panel.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  // A small stand-in for the Edge Function that uses the real engine and room rules.
  await ctx.route('**/functions/v1/pool',r=>{
   const cors={'access-control-allow-origin':'http://127.0.0.1:4183'};
   if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{...cors,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'}});
   const input=r.request().postDataJSON(),actor=r.request().headers().authorization.replace('Bearer ','');
   const send=(data,status=200)=>r.fulfill({status,contentType:'application/json',headers:cors,body:JSON.stringify(data)});
   const pub=()=>Rooms.publicState({code:'POOL23',host_id:room.host,updated_at:'now',state:room.state});
   try{
    if(input.action==='create'){room={host:actor,state:Rooms.newRoomState(actor,names[actor])};return send({room:pub()});}
    if(!room||input.code!=='POOL23')return send({error:'No encontramos esa sala. Comprueba el código.'},404);
    const member=room.state.players.some(p=>p.user_id===actor);
    if(input.action==='join'){if(!member){room.state=Rooms.joinRoom(room.state,actor,names[actor],Date.now());room.state.game=E.newGame('game-'+Date.now(),room.state.players.map(p=>p.user_id),room.host,bytes);}return send({room:pub()});}
    if(!member)return send({error:'No formas parte de esta sala.'},403);
    if(input.action==='state')return send({room:pub()});
    if(input.action==='shoot'){shots.push(input);const before=room.state.game.turn;room.state.game=E.applyShot(room.state.game,actor,{dx:input.dx,dy:input.dy,power:input.power,...(input.cue?{cue:input.cue}:{})});if(room.state.game.turn!==before)room.state.turn_started_at=Date.now();if(room.state.game.winner)room.state.status='finished';return send({room:pub()});}
    if(input.action==='rematch'){const breaker=Rooms.requestRematch(room.state,actor);if(breaker){room.state.game=E.newGame('game-r',room.state.players.map(p=>p.user_id),breaker,bytes);room.state.status='playing';room.state.rematch=[];}return send({room:pub()});}
    if(input.action==='leave'){const res=Rooms.leaveRoom(room.state,actor,room.host,Date.now());room.state=res.state;room.host=res.hostId;return send({left:true});}
    return send({error:'Acción no válida.'},400);
   }catch(error){return send({error:error.message},400);}
  });
  async function open(user,query=''){
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(label+': '+e.message));
   await page.goto('http://127.0.0.1:4183/index.html?seccion=juegos'+query);
   await page.evaluate(id=>{window.REDMUSICA_CONFIG.supabaseUrl='https://test.invalid';window.REDMUSICA_CONFIG.supabasePublishableKey='test';
    const stats={host:{wins:3,losses:1}};
    window.redmusicaClient={auth:{getSession:async()=>({data:{session:{access_token:id,user:{id}}}}),onAuthStateChange:()=>{}},
     from:table=>{const q={_id:null,select:()=>q,eq:(c,v)=>{q._id=v;return q;},maybeSingle:async()=>({data:table==='pool_stats'?stats[q._id]||null:null,error:null})};return q;}};
    window.supabase={createClient:()=>window.redmusicaClient};document.getElementById('seccionJuegos').hidden=false;},user);
   await page.addScriptTag({content:fs.readFileSync('pool.js','utf8')});
   return page;
  }
  const tableLabel=page=>page.locator('#poolCanvas').getAttribute('aria-label');
  const serverLabel=()=>'Bolas en la mesa: '+(room.state.game.balls.filter(b=>!b.p&&b.n).map(b=>b.n).join(', ')||'ninguna');
  async function tap(page,x,y){const box=await page.locator('#poolCanvas').boundingBox();const portrait=box.width<560;const scale=box.width/(portrait?568:1068);const [sx,sy]=portrait?[(34+y)*scale,(34+x)*scale]:[(34+x)*scale,(34+y)*scale];await page.mouse.click(box.x+sx,box.y+sy);}

  const host=await open('host');
  assert.equal(await host.getByRole('heading',{name:'Pool bola 8 en línea'}).isVisible(),true);
  await host.getByRole('button',{name:'Crear una sala'}).click();
  await host.waitForFunction(()=>document.querySelector('#poolCodigoSala').textContent==='POOL23');
  assert.match(await host.locator('#poolTurno').innerText(),/Comparte el código POOL23/);
  assert.match(host.url(),/pool=POOL23/,'the invitation code is kept in the address');
  const guest=await open('guest','&pool=POOL23');
  await guest.waitForFunction(()=>document.querySelector('#poolJugadores').innerText.includes('Kattomon'));
  assert.match(await guest.locator('#poolTurno').innerText(),/Turno de Kattomon/);
  await host.waitForFunction(()=>/Saque/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  assert.equal(await host.locator('#poolTirar').isEnabled(),true);assert.equal(await guest.locator('#poolControles').isVisible(),true);assert.equal(await guest.locator('#poolTirar').isEnabled(),false,'only the player in turn can shoot');
  if(out)await host.screenshot({path:path.join(out,`pool-antes-${label}.png`),fullPage:false});

  // The browser engine reproduces the server trajectories exactly.
  const samples=[{dx:1,dy:0.01,power:1},{dx:0.8,dy:-0.6,power:0.55},{dx:-0.3,dy:0.95,power:0.8}];
  const expected=samples.map(s=>E.simulate(room.state.game.balls,s).balls);
  const inBrowser=await host.evaluate(async({balls,samples})=>{const m=await import('./supabase/functions/pool/engine.js?v=20260930-1');return samples.map(s=>m.simulate(balls,s).balls);},{balls:room.state.game.balls,samples});
  assert.deepEqual(inBrowser,expected,'browser and server simulations match');

  // Break with the keyboard: aim a little, full power, Enter.
  await host.locator('#poolCanvas').focus();await host.keyboard.press('ArrowRight');await host.keyboard.press('ArrowLeft');
  await host.locator('#poolFuerza').fill('100');assert.equal(await host.locator('#poolFuerzaValor').innerText(),'100%');
  await host.locator('#poolCanvas').focus();await host.keyboard.press('Enter');
  await host.waitForFunction(()=>{const t=document.querySelector('#poolEstado').textContent;return t.length>0&&!t.includes('Un momento');},null,{timeout:15000});
  assert.equal(shots.length,1);assert.ok(Math.abs(shots[0].power-1)<1e-9);
  await host.waitForFunction(()=>!document.querySelector('#poolTirar').disabled||/Turno de/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  assert.match(await tableLabel(host),new RegExp(serverLabel()));
  await guest.waitForFunction(seq=>document.querySelector('#poolEstado').textContent.length>0,null,{timeout:15000});
  await guest.waitForTimeout(200);
  assert.match(await tableLabel(guest),new RegExp(serverLabel()),'the opponent sees the same table');

  // Ball in hand anywhere: the guest places the cue ball by tapping, then shoots.
  const g=room.state.game;g.turn='guest';g.ballInHand='table';g.balls[0].p=1;g.last=null;g.seq+=1;room.state.turn_started_at=Date.now();
  await guest.waitForFunction(()=>/Bola en mano/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  assert.equal(await guest.getByRole('button',{name:/Mover la blanca|Listo/}).isVisible(),true);
  let spot=null;for(const [x,y] of [[140,60],[140,440],[60,250],[420,80],[600,470]])if(E.validPlacement(g.balls,x,y,'table')){spot=[x,y];break;}
  assert.ok(spot,'a free spot exists');
  await tap(guest,spot[0],spot[1]);
  await guest.getByRole('button',{name:/Listo, ahora apunta/}).click();
  await guest.getByRole('button',{name:'Tirar'}).click();
  await guest.waitForFunction(n=>document.querySelector('#poolEstado').textContent.length>0&&!document.querySelector('#poolEstado').textContent.includes('Un momento'),null,{timeout:15000});
  assert.equal(shots.length,2);assert.ok(shots[1].cue,'the placement is sent with the shot');
  assert.ok(Math.abs(shots[1].cue.x-spot[0])<4&&Math.abs(shots[1].cue.y-spot[1])<4,`cue placed near the tapped spot (${JSON.stringify(shots[1].cue)} vs ${spot})`);
  if(out)await guest.screenshot({path:path.join(out,`pool-bola-en-mano-${label}.png`),fullPage:false});

  // Winning shot: only the 8 is left for the host; the default aim sinks it.
  const w=room.state.game;w.turn='host';w.groups={host:'solids',guest:'stripes'};w.ballInHand=null;w.winner=null;w.last=null;w.seq+=1;
  w.balls=w.balls.map(b=>b.n===0?{n:0,x:850,y:12,p:0}:b.n===8?{n:8,x:950,y:12,p:0}:b.n===12?{n:12,x:300,y:300,p:0}:{...b,p:1});
  await host.waitForFunction(()=>/Te toca/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  await host.evaluate(()=>{document.querySelector('#poolFuerza').value='30';document.querySelector('#poolFuerza').dispatchEvent(new Event('input'));});
  await host.getByRole('button',{name:'Tirar'}).click();
  await host.waitForFunction(()=>/Ganaste/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  assert.equal(room.state.status,'finished');assert.equal(room.state.game.winner,'host');
  await guest.waitForFunction(()=>/Ganó Kattomon/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  if(out)await host.screenshot({path:path.join(out,`pool-victoria-${label}.png`),fullPage:false});

  // Rematch needs both players; the loser breaks.
  await host.getByRole('button',{name:'Pedir revancha'}).click();
  await host.waitForFunction(()=>document.querySelector('#poolRevancha').textContent==='Esperando respuesta…');
  await guest.waitForFunction(()=>document.querySelector('#poolRevancha').textContent==='Aceptar revancha',null,{timeout:15000});
  await guest.getByRole('button',{name:'Aceptar revancha'}).click();
  await guest.waitForFunction(()=>/Saque/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  assert.equal(room.state.game.turn,'guest');

  // Leaving an active game asks for a second tap and hands the win to the rival.
  await host.waitForFunction(()=>/Turno de Ana/.test(document.querySelector('#poolTurno').textContent),null,{timeout:15000});
  await host.getByRole('button',{name:'Salir'}).click();
  assert.equal(await host.getByRole('button',{name:'Confirmar: perderás la partida'}).isVisible(),true);
  assert.equal(await host.getByRole('button',{name:/Confirmar/}).isVisible(),true);assert.equal(room.state.players.length,2);
  await host.getByRole('button',{name:/Confirmar/}).click();
  await host.waitForFunction(()=>!document.querySelector('#poolEntrada').hidden);
  assert.equal(room.state.game.winner,'guest');assert.doesNotMatch(host.url(),/pool=/);

  // Mobile layout: no sideways scrolling; the table turns vertical on narrow screens.
  const layout=await guest.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,canvas:document.querySelector('#poolCanvas').getBoundingClientRect().toJSON()}));
  assert.ok(layout.scroll<=layout.client+1,`no horizontal overflow (${layout.scroll} > ${layout.client})`);
  if(layout.client<560)assert.ok(layout.canvas.height>layout.canvas.width,'portrait table on phones');

  // Profile line with wins.
  const profile=await open('guest');
  await profile.evaluate(()=>{document.getElementById('perfilPublico').hidden=false;document.getElementById('presenciaPerfil').dataset.userId='host';});
  await profile.waitForFunction(()=>!document.getElementById('poolPerfil').hidden);
  assert.equal(await profile.locator('#poolPerfil').innerText(),'Pool bola 8: 3 victorias · 1 derrota');
  await profile.evaluate(()=>{document.getElementById('presenciaPerfil').dataset.userId='nadie';});
  await profile.waitForFunction(()=>document.getElementById('poolPerfil').hidden);

  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS pool browser ('+label+')');
 }
 server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1);});
