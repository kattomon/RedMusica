const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const server=http.createServer((req,res)=>{const file=path.join(process.cwd(),new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(4180,'127.0.0.1',r));
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch();const ctx=await browser.newContext(engine===webkit?{...devices['iPhone 13']}:{viewport:{width:1200,height:900}});
  let queue=[],searches=0,requests=0;const errors=[];
  await ctx.route('**/vendor/supabase-2.117.2.js',r=>r.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),onAuthStateChange:()=>{}}})};`}));
  await ctx.route('**/functions/v1/radio',r=>{const body=r.request().postDataJSON();let result={now:new Date().toISOString(),queue};if(body.action==='search'){searches++;assert.equal(body.query,'Candelabro Refugio');result={songs:[{video_id:'abcdefghijk',title:'Candelabro &amp; amigos — Refugio',channel:'Candelabro',duration:180}]};}if(body.action==='request'){requests++;queue=[{id:'one',video_id:body.video_id,title:'Candelabro — Refugio',channel:'Candelabro',duration:180,starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+179000).toISOString(),username:'Ana'}];result={now:new Date().toISOString(),queue};}return r.fulfill({contentType:'application/json',body:JSON.stringify(result)});});
  await ctx.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'text/javascript',body:`window.YT={Player:function(id,options){window.playerOptions=options;window.playerCalls=[];this.cueVideoById=p=>window.playerCalls.push(p);this.loadVideoById=p=>window.playerCalls.push(p);this.pauseVideo=()=>{};document.getElementById(id).textContent='Reproductor visible';setTimeout(()=>options.events.onReady(),0);}};window.onYouTubeIframeAPIReady();`}));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4180/radio.html');
  await page.getByText('Todavía no hay canciones. Haz el primer pedido.').waitFor();
  await page.locator('#radioArtista').fill('Candelabro');await page.locator('#radioCancion').fill('Refugio');await page.getByRole('button',{name:'Buscar en YouTube'}).click();
  await page.getByRole('button',{name:'Agregar a la cola'}).click();await page.getByText('Canción agregada a la cola compartida.').waitFor();
  assert.match(await page.locator('#radioCola').innerText(),/Ana/);assert.equal(searches,1);assert.equal(requests,1);
  await page.getByRole('button',{name:'Entrar a escuchar'}).click();await page.getByRole('button',{name:'Volver a la canción de la sala'}).waitFor();
  assert.equal(await page.locator('#radioReproductor').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.playerCalls[0].videoId),'abcdefghijk');
  await page.evaluate(()=>window.playerOptions.events.onAutoplayBlocked());assert.match(await page.locator('#radioPlayback').innerText(),/pulsa reproducir/);
  const other=await ctx.newPage();await other.goto('http://127.0.0.1:4180/radio.html');await other.locator('#radioCola li').waitFor();assert.match(await other.locator('#radioCola').innerText(),/Refugio/);
  queue=[{...queue[0],id:'two',video_id:'abcdefghij2',title:'Siguiente canción',starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+179000).toISOString()}];
  await page.evaluate(()=>window.playerOptions.events.onStateChange({data:0}));
  await page.waitForFunction(()=>window.playerCalls.some(p=>p.videoId==='abcdefghij2'));
  await page.evaluate(()=>window.playerOptions.events.onError());assert.match(await page.locator('#radioPlayback').innerText(),/no puede reproducir/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);assert.deepEqual(errors,[]);
  await page.screenshot({path:'../radio-'+engine.name()+'.png',fullPage:true});await browser.close();console.log('PASS '+engine.name()+': search, request, shared queue, visible player, autoplay/error, responsive layout');
 }
 server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
