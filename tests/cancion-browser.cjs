// Plays "Adivina la canción" in a real browser (desktop and Pixel 7) against the real Edge Function code with a fake database.
const {chromium,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.cwd(),out=process.env.CANCION_SCREENSHOTS||'';
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
const people=[{token:'tok-k',id:'11111111-1111-4111-8111-111111111111',username:'Kattomon'},{token:'tok-a',id:'22222222-2222-4222-8222-222222222222',username:'Ana'}];
(async()=>{
 const {loadCancionServer}=await import('./helpers/cancion-fake-server.mjs');
 const L=await import('../supabase/functions/cancion/logic.js');
 await new Promise(r=>server.listen(4187,'127.0.0.1',r));
 for(const [label,device] of [['chromium',{viewport:{width:1200,height:900}}],['chromium-mobile',devices['Pixel 7']]]){
  const fake=await loadCancionServer(people,{friendships:[{user_a:people[0].id,user_b:people[1].id,status:'accepted'}]});
  const browser=await chromium.launch();const ctx=await browser.newContext({...device,serviceWorkers:'block'});const errors=[];
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
  async function open(person){
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(label+' '+person.username+': '+e.stack));
   await page.goto('http://127.0.0.1:4187/index.html?seccion=cancion');
   await page.evaluate(p=>{window.REDMUSICA_CONFIG.supabaseUrl='https://test.invalid';window.REDMUSICA_CONFIG.supabasePublishableKey='test';
    window.redmusicaClient={auth:{getSession:async()=>({data:{session:{access_token:p.token,user:{id:p.id}}}}),onAuthStateChange:()=>{}},
     from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{days:4,best:51,streak:2,best_streak:3},error:null})};return q;}};
    window.supabase={createClient:()=>window.redmusicaClient};document.getElementById('seccionCancion').hidden=false;},person);
   await page.addScriptTag({content:fs.readFileSync('cancion.js','utf8')});
   return page;
  }
  const [K]=people;
  const page=await open(K);
  await page.locator('.cancion-titulo .cancion-letra').first().waitFor({timeout:15000});
  const answers=fake.tables.song_days[0].songs.map(L.songById);
  assert.equal(await page.locator('.cancion-punto').count(),10,'ten songs');
  assert.match(await page.locator('.cancion-numero').innerText(),/Canción 1 de 10/);
  // The title is only boxes: no answer anywhere in the page or in what the server sent.
  assert.ok(!(await page.locator('#cancion').innerText()).includes(answers[0].title),'answer hidden in the page');
  assert.ok(!bodies.some(b=>answers.some(a=>b.includes(JSON.stringify(a.title)))),'answers not sent');
  assert.equal(await page.locator('.cancion-titulo .cancion-letra').count(),answers[0].title.split('').filter(c=>/[a-z0-9]/i.test(c.normalize('NFD').replace(/[^\x00-\x7f]/g,''))).length,'one box per letter');
  if(out)await page.screenshot({path:path.join(out,`cancion-inicio-${label}.png`),fullPage:true});

  const input=()=>page.locator('.cancion-buscar input');
  async function choose(song){
   await input().fill(song.title+' '+song.artists[0]);
   const option=page.locator('.cancion-opciones li[role=option]').filter({hasText:song.title}).filter({hasText:song.artists[0]}).first();
   await option.click();
   await page.locator('.cancion-adivinar:not([disabled])').click();
  }
  // A wrong try gives six coloured clues.
  const wrong=L.SONGS.find(s=>!answers.some(a=>a.id===s.id)&&s.artists[0]!==answers[0].artists[0]);
  await choose(wrong);
  await page.locator('.cancion-intento .cancion-pista-caja').nth(5).waitFor();
  assert.equal(await page.locator('.cancion-intento').count(),1);
  assert.equal(await page.locator('.cancion-intento .cancion-pista-caja').count(),6,'six clues');
  assert.match(await page.locator('.cancion-numero').innerText(),/5 intentos/);
  assert.match(await page.locator('.cancion-intento .cancion-pista-caja').nth(1).getAttribute('aria-label'),/^Año: \d{4}, (igual|cerca|no)/);
  if(out)await page.screenshot({path:path.join(out,`cancion-intento-${label}.png`),fullPage:true});
  // Keyboard: ArrowDown + Enter chooses, Enter again guesses.
  await input().fill(answers[0].title+' '+answers[0].artists[0]);
  const options=await page.locator('.cancion-opciones li[role=option]').allInnerTexts();
  const pos=options.findIndex(t=>t.includes(answers[0].title)&&t.includes(answers[0].artists[0]));
  assert.ok(pos>=0,'answer listed: '+options.join(' | '));
  for(let i=0;i<=pos;i++)await input().press('ArrowDown');
  await input().press('Enter');await page.locator('.cancion-adivinar:not([disabled])').waitFor();
  await page.locator('.cancion-adivinar').press('Enter');
  await page.locator('.cancion-resultado-bien').waitFor({timeout:5000}).catch(async e=>{console.log('DEBUG',await page.locator('#cancionEstado').innerText(),'|',(await page.locator('#cancionPanel').innerText()).slice(0,600));throw e;});
  assert.match(await page.locator('.cancion-resultado').innerText(),/La adivinaste[\s\S]*\+5 puntos/);
  assert.match(await page.locator('.cancion-puntaje').innerText(),/5 pts/);
  assert.equal(await page.locator('.cancion-titulo .cancion-letra').evaluateAll(b=>b.map(x=>x.textContent).join('')).then(t=>t.length>0),true,'title revealed');
  if(out)await page.screenshot({path:path.join(out,`cancion-acierto-${label}.png`),fullPage:true});
  await page.getByRole('button',{name:'Siguiente canción'}).click();
  // Give up on the second one (two taps).
  await page.getByRole('button',{name:'Me rindo'}).click();
  await page.getByRole('button',{name:'¿Seguro? Toca otra vez'}).click();
  await page.locator('.cancion-resultado-mal').waitFor();
  assert.match(await page.locator('.cancion-resultado').innerText(),new RegExp(answers[1].title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  await page.getByRole('button',{name:'Siguiente canción'}).click();
  // The other eight at the first try.
  for(let i=2;i<10;i++){
   await page.locator('.cancion-numero',{hasText:`Canción ${i+1} de 10`}).waitFor();
   await choose(answers[i]);
   await page.locator('.cancion-resultado-bien').waitFor();
   await page.getByRole('button',{name:i<9?'Siguiente canción':'Ver resultado'}).click();
  }
  await page.locator('.cancion-resumen').waitFor();
  assert.match(await page.locator('.cancion-resumen-total').innerText(),/53\s*\/ 60/);
  assert.match(await page.locator('.cancion-emojis').innerText(),/💚/);
  assert.equal(await page.locator('.cancion-resumen-lista li').count(),10);
  assert.match(await page.locator('.cancion-stats').innerText(),/racha[\s\S]*1 día/i);
  assert.equal(fake.tables.song_stats.length,1,'stats recorded');
  if(out)await page.screenshot({path:path.join(out,`cancion-resumen-${label}.png`),fullPage:true});
  // Review a song from the summary.
  await page.locator('.cancion-resumen-fila').nth(1).click();
  await page.locator('.cancion-resultado-mal').waitFor();
  // Friends.
  await page.getByRole('tab',{name:'Amigos'}).click();
  await page.locator('.cancion-tabla li').first().waitFor();
  assert.match(await page.locator('.cancion-tabla').innerText(),/Kattomon \(tú\)[\s\S]*53 pts/);
  if(out)await page.screenshot({path:path.join(out,`cancion-amigos-${label}.png`),fullPage:true});
  // Practice runs locally.
  await page.getByRole('tab',{name:'Práctica libre'}).click();
  await page.locator('.cancion-numero',{hasText:'Canción 1 de 10'}).waitFor();
  const practice=await page.evaluate(()=>JSON.parse(localStorage.getItem('redmusica-cancion-practica')));
  assert.equal(practice.songs.length,10);
  const before=bodies.length;
  await choose(L.songById(practice.songs[0]));
  await page.locator('.cancion-resultado-bien').waitFor();
  assert.equal(bodies.length,before,'practice does not call the server');
  // Mobile layout: nothing wider than the screen.
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  assert.ok(overflow<=1,'no horizontal scroll ('+overflow+')');
  if(out)await page.screenshot({path:path.join(out,`cancion-practica-${label}.png`),fullPage:true});
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log(`PASS cancion browser (${label})`);
 }
 server.close();
})().catch(e=>{console.error(e);process.exit(1);});
