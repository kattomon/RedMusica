const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),assert=require('assert/strict');
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch();const page=await browser.newPage(engine===webkit?devices['iPhone 13']:{viewport:{width:1200,height:900}});const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://test.invalid/**',r=>{const b=r.request().postDataJSON();calls.push(b);let data={ok:true};if(b.action==='me')data={role:'owner'};if(b.action==='list')data={items:b.data.kind==='users'?[{id:'member',username:'Ana',role:'member',suspended:false},{id:'owner',username:'Kattomon',role:'owner'}]:[{id:'post',username:'Ana',body:'Opinión',hidden:false}]};if(b.action==='state')data={paused:false,queue:[{id:'song',title:'Canción',username:'Ana'}]};return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 await page.setContent('<nav id="navegacion"></nav><main><h1>RedMusica</h1><p>Descripción</p><section id="cuenta"></section><button id="actualizarFeed">Actualizar</button></main>');
 await page.addStyleTag({content:fs.readFileSync('style.css','utf8')});
 await page.evaluate(()=>{window.REDMUSICA_CONFIG={supabaseUrl:'https://test.invalid',supabasePublishableKey:'test'};window.redmusicaClient={auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),onAuthStateChange:cb=>window.authChange=cb},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{title:'RedMusica',description:'Descripción',accept_posts:true}})})})})};});
 await page.addScriptTag({content:fs.readFileSync('admin.js','utf8')});
 await page.getByRole('button',{name:'Administración · owner'}).click();await page.getByText('Opinión',{exact:true}).waitFor();await page.getByRole('button',{name:'Ocultar',exact:true}).click();await page.getByText('Listo.',{exact:true}).waitFor();assert(calls.some(c=>c.action==='moderate'));
 await page.locator('#adminKind').selectOption('users');await page.getByRole('button',{name:'Buscar / Actualizar'}).click();await page.getByRole('button',{name:'Dar rango admin'}).click();await page.getByText('Listo.',{exact:true}).waitFor();assert(calls.some(c=>c.action==='role'&&c.data.id==='member'));
 await page.getByRole('button',{name:'Poner ahora'}).click();await page.getByText('Listo.',{exact:true}).waitFor();assert(calls.some(c=>c.action==='play_now'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.evaluate(()=>{window.redmusicaClient.auth.getSession=async()=>({data:{session:null}});window.authChange();});await page.getByRole('button',{name:'Administración · owner'}).waitFor({state:'hidden'});assert.equal(await page.locator('#administracion').isVisible(),false);assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS '+engine.name()+': owner panel, moderation, roles, DJ, logout, responsive');
}})().catch(e=>{console.error(e);process.exit(1)});
