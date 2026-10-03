// Plays "Adivina la canción" in a real browser (desktop and Pixel 7) against the real Edge Function code with a fake database:
// daily challenge with steps and skips, bonus round, archive, friends, packs, a live room with two players and the audio mode.
const {chromium,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.cwd(),out=process.env.CANCION_SCREENSHOTS||'';
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
const people=[{token:'tok-k',id:'11111111-1111-4111-8111-111111111111',username:'Kattomon'},{token:'tok-a',id:'22222222-2222-4222-8222-222222222222',username:'Ana'}];
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
(async()=>{
 const {loadCancionServer}=await import('./helpers/cancion-fake-server.mjs');
 const L=await import('../supabase/functions/cancion/logic.js');
 await new Promise(r=>server.listen(4187,'127.0.0.1',r));
 for(const [label,device] of [['chromium',{viewport:{width:1200,height:900}}],['chromium-mobile',devices['Pixel 7']]]){
  const fake=await loadCancionServer(people,{friendships:[{user_a:people[0].id,user_b:people[1].id,status:'accepted'}]});
  const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const ctx=await browser.newContext({...device,serviceWorkers:'block'});const errors=[];
  await ctx.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'text/javascript',body:'window.supabase={createClient:()=>({})};'}));
  await ctx.route('**/script.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await ctx.route('**/radio-panel.js?*',r=>r.fulfill({contentType:'text/javascript',body:''}));
  const bodies=[];
  await ctx.route('**/functions/v1/cancion',async r=>{
   const cors={'access-control-allow-origin':'http://127.0.0.1:4187'};
   if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{...cors,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'}});
   const token=r.request().headers().authorization.replace('Bearer ','');
   const res=await fake.handle(token,r.request().postData());const body=await res.text();bodies.push(body);
   return r.fulfill({status:res.status,contentType:'application/json',headers:cors,body});
  });
  async function open(person,query=''){
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(label+' '+person.username+': '+e.stack));
   await page.goto('http://127.0.0.1:4187/index.html?seccion=cancion'+query);
   await page.evaluate(p=>{window.REDMUSICA_CONFIG.supabaseUrl='https://test.invalid';window.REDMUSICA_CONFIG.supabasePublishableKey='test';
    window.redmusicaClient={auth:{getSession:async()=>({data:{session:{access_token:p.token,user:{id:p.id}}}}),onAuthStateChange:()=>{}},
     channel:topic=>{const wire=new BroadcastChannel(topic);let listener=null;const channel={on:(_t,_f,fn)=>{listener=fn;return channel;},subscribe:fn=>{wire.onmessage=event=>listener?.({payload:event.data.payload});setTimeout(()=>fn('SUBSCRIBED'),0);return channel;},send:async m=>{wire.postMessage(m);return 'ok';},unsubscribe:()=>wire.close()};return channel;},
     removeChannel:async c=>c.unsubscribe(),
     from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{days:4,best:51,streak:2,best_streak:3,live_games:1,live_wins:1},error:null})};return q;}};
    window.supabase={createClient:()=>window.redmusicaClient};document.getElementById('seccionCancion').hidden=false;},person);
   await page.addScriptTag({content:fs.readFileSync('cancion.js','utf8')});
   return page;
  }
  const shot=async(page,name,full=true)=>{if(out)await page.screenshot({path:path.join(out,`cancion-${name}-${label}.png`),fullPage:full});};
  const [K]=people;
  const page=await open(K);
  await page.locator('.cancion-capas').waitFor({timeout:15000});
  const answers=fake.tables.song_days[0].songs.map(L.songById);
  assert.equal(await page.locator('.cancion-punto').count(),10,'ten songs');
  assert.equal(await page.locator('.cancion-capa-abierta').count(),1,'only the first layer is open');
  assert.match(await page.locator('.cancion-capa-abierta').innerText(),new RegExp(String(answers[0].year)));
  assert.ok(!(await page.locator('#cancion').innerText()).includes(answers[0].title),'answer hidden in the page');
  assert.ok(!bodies.some(b=>answers.some(a=>b.includes(JSON.stringify(a.title)))),'answers not sent');
  await shot(page,'inicio');

  const input=()=>page.locator('.cancion-buscar input');
  async function choose(title,artist){
   await input().fill(title+' '+artist);
   await page.locator('.cancion-opciones li[role=option]').filter({hasText:title}).filter({hasText:artist}).first().click();
   await page.locator('.cancion-adivinar:not([disabled])').click();
  }
  // Skip opens the second layer.
  await page.getByRole('button',{name:/Saltar/}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.cancion-capa-abierta').length===2);
  assert.equal(await page.locator('.cancion-paso-skip').count(),1);
  // A wrong guess: six colours and the third layer.
  const wrong=L.SONGS.find(s=>!answers.some(a=>a.id===s.id)&&s.artists[0]!==answers[0].artists[0]);
  await choose(wrong.title,wrong.artists[0]);
  await page.locator('.cancion-intento .cancion-pista-caja').nth(5).waitFor();
  assert.equal(await page.locator('.cancion-capa-abierta').count(),3);
  assert.match(await page.locator('.cancion-numero').innerText(),/paso 3 de 6/);
  await shot(page,'pasos');
  // Keyboard: ArrowDown + Enter chooses, Enter again guesses.
  await input().fill(answers[0].title+' '+answers[0].artists[0]);
  const options=await page.locator('.cancion-opciones li[role=option]').allInnerTexts();
  const pos=options.findIndex(t=>t.includes(answers[0].title)&&t.includes(answers[0].artists[0]));
  assert.ok(pos>=0,'answer listed');
  for(let i=0;i<=pos;i++)await input().press('ArrowDown');
  await input().press('Enter');await page.locator('.cancion-adivinar:not([disabled])').waitFor();
  await page.locator('.cancion-adivinar').press('Enter');
  await page.locator('.cancion-resultado-bien').waitFor();
  assert.match(await page.locator('.cancion-resultado').innerText(),/paso 3[\s\S]*\+4 puntos/);
  await page.getByRole('button',{name:'Siguiente canción'}).click();
  await page.getByRole('button',{name:'Me rindo'}).click();
  await page.getByRole('button',{name:'¿Seguro? Toca otra vez'}).click();
  await page.locator('.cancion-resultado-mal').waitFor();
  assert.match(await page.locator('.cancion-resultado').innerText(),new RegExp(esc(answers[1].title)));
  await page.getByRole('button',{name:'Siguiente canción'}).click();
  for(let i=2;i<10;i++){
   await page.locator('.cancion-numero',{hasText:`Canción ${i+1} de 10`}).waitFor();
   await choose(answers[i].title,answers[i].artists[0]);
   await page.locator('.cancion-resultado-bien').waitFor();
   await page.getByRole('button',{name:i<9?'Siguiente canción':'Ver resultado'}).click();
  }
  await page.locator('.cancion-resumen').waitFor();
  assert.match(await page.locator('.cancion-resumen-total').innerText(),/52\s*\/ 60/);
  assert.equal(await page.locator('.cancion-dist-fila').count(),7,'step distribution');
  assert.equal(fake.tables.song_stats.length,1,'stats recorded');
  await shot(page,'resumen');
  // Bonus round.
  await page.getByRole('button',{name:/Ronda extra/}).click();
  for(let q=0;q<5;q++){await page.locator('.cancion-trivia-opcion').first().click();await page.getByRole('button',{name:q<4?'Siguiente pregunta':'Ver resultado'}).click();}
  assert.match(await page.locator('.cancion-trivia').innerText(),/\/ 5/);
  await page.getByRole('button',{name:'Volver al juego'}).click();
  // Archive (the game started today: only today).
  await page.getByRole('button',{name:'Días anteriores'}).click();
  await page.locator('.cancion-dia').first().waitFor();
  assert.match(await page.locator('.cancion-archivo').innerText(),/Todavía no hay días anteriores/);
  await page.getByRole('button',{name:'Volver'}).click();
  // Friends.
  await page.getByRole('tab',{name:'Amigos'}).click();
  await page.locator('.cancion-tabla li').first().waitFor();
  assert.match(await page.locator('.cancion-tabla').innerText(),/Kattomon \(tú\)[\s\S]*52 pts/);
  // Packs run locally.
  await page.getByRole('tab',{name:'Paquetes'}).click();
  await page.locator('.cancion-paquete').first().waitFor();
  assert.equal(await page.locator('.cancion-paquete').count(),L.PACKS.length);
  await shot(page,'paquetes');
  await page.locator('.cancion-paquete',{hasText:'Chilenas'}).click();
  const practice=await page.evaluate(()=>JSON.parse(localStorage.getItem('redmusica-cancion-paquete')));
  assert.equal(practice.pack,'cl'); assert.ok(practice.songs.every(id=>L.songById(id).country==='CL'));
  const before=bodies.length;
  const first=L.songById(practice.songs[0]);
  await choose(first.title,first.artists[0]);
  await page.locator('.cancion-resultado-bien').waitFor();
  assert.equal(bodies.length,before,'packs do not call the server');

  // Live room with two players.
  await page.getByRole('tab',{name:'En vivo'}).click();
  await page.locator('.cancion-vivo-opciones select[name=rounds]').selectOption('5');
  await page.locator('.cancion-vivo-opciones select[name=seconds]').selectOption('30');
  await page.getByRole('button',{name:'Crear sala'}).click();
  await page.locator('.cancion-codigo').waitFor();
  const code=await page.locator('.cancion-codigo').innerText();
  const guest=await open(people[1],'&sala='+code);
  await page.waitForFunction(()=>/Empezar \(2 jugadores\)/.test(document.querySelector('.cancion-empezar')?.textContent||''),null,{timeout:15000});
  assert.match(await guest.locator('.cancion-espera').innerText(),/Esperando que Kattomon empiece/);
  await shot(page,'sala');
  await page.getByRole('button',{name:/Empezar/}).click();
  for(const p of [page,guest])await p.locator('.cancion-capas').waitFor({timeout:15000});
  const roomSongs=fake.tables.song_rooms[0].state.songs.map(L.songById);
  assert.ok(!(await guest.locator('#cancion').innerText()).includes(roomSongs[0].title),'room answer hidden');
  const wrong2=L.SONGS.find(s=>!roomSongs.some(a=>a.id===s.id));
  await guest.locator('.cancion-buscar input').fill(wrong2.title+' '+wrong2.artists[0]);
  await guest.locator('.cancion-opciones li[role=option]').filter({hasText:wrong2.title}).first().click();
  await guest.locator('.cancion-adivinar:not([disabled])').click();
  await guest.locator('.cancion-intento').waitFor();
  await choose(roomSongs[0].title,roomSongs[0].artists[0]);
  await page.locator('.cancion-resultado-bien').waitFor();
  assert.match(await page.locator('.cancion-resultado-bien').innerText(),/La adivinaste en la pista 1/);
  await shot(page,'vivo');
  await guest.locator('.cancion-buscar input').fill(roomSongs[0].title+' '+roomSongs[0].artists[0]);
  await guest.locator('.cancion-opciones li[role=option]').filter({hasText:roomSongs[0].title}).filter({hasText:roomSongs[0].artists[0]}).first().click();
  await guest.locator('.cancion-adivinar:not([disabled])').click();
  for(const p of [page,guest])await p.locator('.cancion-vivo .cancion-resultado',{hasText:'Era'}).waitFor({timeout:15000});
  const board=await page.locator('.cancion-vivo-jugadores').innerText();
  assert.ok(board.indexOf('Kattomon')<board.indexOf('Ana'),'faster player first');
  await guest.getByRole('button',{name:'Salir'}).click();
  await guest.locator('.cancion-vivo-opciones').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.cancion-vivo-jugadores li').length===1,null,{timeout:15000});

  // Audio mode: plays and steps work.
  await page.getByRole('button',{name:'Salir'}).click();
  await page.getByRole('tab',{name:'Con audio'}).click();
  await page.locator('.cancion-escuchar-boton').waitFor({timeout:15000});
  await page.locator('.cancion-escuchar-boton').click();
  await page.locator('.cancion-sonando').waitFor();
  await page.getByRole('button',{name:/Saltar/}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.cancion-capas-audio .cancion-capa-abierta').length===2);
  assert.match(await page.locator('.cancion-escuchar-boton').innerText(),/Detener|2 instrumentos/);
  await shot(page,'audio');
  await page.getByRole('button',{name:'Me rindo'}).click();
  await page.getByRole('button',{name:'¿Seguro? Toca otra vez'}).click();
  await page.locator('.cancion-audio .cancion-resultado',{hasText:'Era'}).waitFor();

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert.ok(overflow<=1,'no horizontal scroll ('+overflow+')');
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log(`PASS cancion browser (${label})`);
 }
 server.close();
})().catch(e=>{console.error(e);process.exit(1);});
