const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(4182,'127.0.0.1',r));
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch();const ctx=await browser.newContext(engine===webkit?{...devices['iPhone 13']}:{viewport:{width:1200,height:900}});
  let room=null;const errors=[];
  await ctx.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({})};'}));
  await ctx.route('**/script.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/radio-panel.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/functions/v1/blackjack',r=>{
   if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'http://127.0.0.1:4182','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'}});
   const {action,code}=r.request().postDataJSON(),actor=r.request().headers().authorization?.replace('Bearer ','')||'owner';
   const send=(data,status=200)=>r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'http://127.0.0.1:4182'},body:JSON.stringify(data)});
   if(action==='create'){room={code:'ABC234',host_id:actor,status:'lobby',players:[{user_id:actor,username:actor==='solo'?'Sola':'Kattomon',chips:1000,status:'waiting',hand:[]}],dealer:{hand:[]},current_player_id:null,result:''};return send({room});}
   if(action==='join'){if(!room||code!=='ABC234')return send({error:'No encontramos esa sala.'},404);if(!room.players.some(p=>p.user_id==='guest'))room.players.push({user_id:'guest',username:'Ana',chips:1000,status:'waiting',hand:[]});return send({room});}
   if(action==='state')return room&&room.players.some(p=>p.user_id===actor)?send({room}):send({error:'No formas parte de esta sala.'},403);
   if(action==='start'){room.status='playing';room.players[0].hand=[{rank:'9',suit:'♠'},{rank:'7',suit:'♥'}];room.players[0].status='playing';room.players[0].chips=900;room.players[0].bet=100;if(room.players[1]){room.players[1].hand=[{rank:'10',suit:'♣'},{rank:'8',suit:'♦'}];room.players[1].status='waiting';room.players[1].chips=900;room.players[1].bet=100;}room.dealer={hand:[{rank:'10',suit:'♠'},{hidden:true}],hidden:true};room.current_player_id=room.players[0].user_id;return send({room});}
   if(action==='hit'){room.players[0].hand.push({rank:'5',suit:'♣'});room.players[0].status='stood';room.players[0].result='Ganó';room.players[0].chips=1100;room.players[1].status='playing';room.current_player_id='guest';return send({room});}
   if(action==='stand'){const player=room.players.find(p=>p.user_id===actor);if(room.players.length===1){player.status='lost';player.result='Perdió';player.chips=900;}else{room.players[1].status='won';room.players[1].result='Ganó';room.players[1].chips=1100;}room.status='finished';room.dealer={hand:[{rank:'10',suit:'♠'},{rank:'7',suit:'♥'}]};room.current_player_id=null;room.result='Ronda terminada.';return send({room});}
   if(action==='leave'){room.players=room.players.filter(p=>p.user_id!==actor);if(!room.players.length)room=null;else room.host_id=room.players[0].user_id;return send({left:true});}
   return send({error:'Acción no válida.'},400);
  });
  async function open(user){const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4182/index.html?seccion=blackjack&testUser='+user);await page.evaluate(id=>{window.REDMUSICA_CONFIG.supabaseUrl='https://test.invalid';window.REDMUSICA_CONFIG.supabasePublishableKey='test';window.supabase={createClient:()=>window.redmusicaClient};window.redmusicaClient={auth:{getSession:async()=>({data:{session:{access_token:id,user:{id}}}}),onAuthStateChange:()=>{}}};document.getElementById('seccionBlackjack').hidden=false;},user);await page.addScriptTag({content:fs.readFileSync('blackjack.js','utf8')});return page;}
  const host=await open('owner');assert.equal(await host.locator('#seccionBlackjack').isVisible(),true);assert.match(await host.locator('#tituloBlackjack').innerText(),/Blackjack/);assert.match(await host.locator('#seccionBlackjack').innerText(),/a solas contra el crupier/i);
  await host.getByRole('button',{name:'Crear una sala'}).click();await host.waitForFunction(()=>document.querySelector('#blackjackCodigo').textContent==='ABC234');assert.equal(await host.getByRole('img',{name:'Crupier bot en estilo pixel art'}).isVisible(),true);assert.equal(await host.locator('#blackjackTablero').isVisible(),true,'table is visible before the first deal');
  const guest=await open('guest');await guest.locator('#codigoSalaBlackjack').fill('abc234');await guest.getByRole('button',{name:'Unirse'}).click();await guest.getByText('@Ana (tú)').waitFor();
  await host.waitForFunction(()=>document.querySelector('#blackjackJugadores').textContent.includes('@Ana'));
  await host.getByRole('button',{name:/Repartir/}).click();await host.getByText('Es tu turno.').waitFor();assert.equal(await host.locator('#manoCrupierBlackjack .blackjack-carta').count(),2);assert.equal(await host.locator('#blackjackJugadores .blackjack-carta').count(),4);await host.locator('#blackjackTablero .blackjack-carta').first().waitFor();await host.locator('#blackjackJugadores .blackjack-carta').first().evaluate(el=>{if(!el.classList.contains('blackjack-carta'))throw Error('card visual missing');});await host.getByRole('button',{name:'Pedir carta'}).click();await guest.getByText('Es tu turno.').waitFor();
  assert.match(await guest.locator('#blackjackJugadores').innerText(),/Total: 21/);await guest.getByRole('button',{name:'Plantarse'}).click();await guest.locator('#resultadoBlackjack').getByText('Ronda terminada.',{exact:true}).waitFor();assert.match(await guest.locator('#blackjackJugadores').innerText(),/1100 fichas/);
  const solo=await open('solo');await solo.getByRole('button',{name:'Crear una sala'}).click();await solo.waitForFunction(()=>document.querySelector('#blackjackCodigo').textContent==='ABC234');await solo.getByRole('button',{name:/Repartir/}).click();await solo.getByText('Es tu turno.').waitFor();await solo.getByRole('button',{name:'Plantarse'}).click();await solo.getByText('Partida actualizada. Puedes repartir otra ronda.').waitFor();assert.match(await solo.locator('#blackjackJugadores').innerText(),/Perdió/);
  assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await solo.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await browser.close();console.log('PASS '+engine.name()+': solo play vs dealer, six-seat room, room join, shared turns, hit/stand, virtual chips, responsive/mobile, no JS errors');
 }
 server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
