const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('.');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.join(root,pathname==='/'?'index.html':pathname);
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(4174,'127.0.0.1',r));
 for(const engine of [chromium,webkit]) {
  const browser=await engine.launch();
  const ana={id:'11111111-1111-4111-8111-111111111111',email:'ana@example.test',aud:'authenticated',role:'authenticated'};
  const luis={id:'22222222-2222-4222-8222-222222222222',email:'luis@example.test',aud:'authenticated',role:'authenticated'};
  let posts=[],likes=[],comments=[],failPosts=false;
  const names={[ana.id]:'Ana',[luis.id]:'Luis'};
  const contexts=[];
  function token(user){return Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';}
  async function makePage(start=''){
   const ctx=await browser.newContext(engine===webkit?{...devices['iPhone 13']}:{viewport:{width:1280,height:900}});contexts.push(ctx);
   await ctx.route('**/config.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.REDMUSICA_CONFIG={supabaseUrl:"https://redmusica-test.supabase.co",supabasePublishableKey:"sb_publishable_test"};'}));
   await ctx.route('https://musicbrainz.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({'release-groups':[{id:'33333333-3333-4333-8333-333333333333',title:'Álbum de prueba','artist-credit':[{name:'Artista de prueba'}]}]})}));
   await ctx.route('https://coverartarchive.org/**',r=>r.fulfill({status:404,body:''}));
   await ctx.route('https://itunes.apple.com/**',r=>r.fulfill({contentType:'text/javascript',body:new URL(r.request().url()).searchParams.get('callback')+'({"results":[]})'}));
   await ctx.route('https://redmusica-test.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();const body=req.postDataJSON();
    const headers={'Content-Type':'application/json','Access-Control-Expose-Headers':'Content-Range'};
    const auth=req.headers().authorization;const sub=auth?.startsWith("Bearer ey")?JSON.parse(Buffer.from(auth.split(".")[1],"base64url").toString()).sub:null;const current=sub===ana.id?ana:sub===luis.id?luis:null;
    let data={},status=200;
    if(url.pathname==='/auth/v1/signup'){data={user:ana,session:null};}
    else if(url.pathname==='/auth/v1/token'){const user=body.email===ana.email?ana:luis;data={access_token:token(user),refresh_token:'refresh-'+user.id,expires_in:3600,token_type:'bearer',user};}
    else if(url.pathname==='/auth/v1/logout'){status=204;data=null;}
    else if(url.pathname==='/auth/v1/recover'){data={};}
    else if(url.pathname==='/auth/v1/user'){data=current;}
    else if(url.pathname==='/rest/v1/profiles'){const id=url.searchParams.get('id').slice(3);data=names[id]?{username:names[id],created_at:'2026-09-26T12:00:00Z'}:null;}
    else if(url.pathname==='/rest/v1/posts'){
      if(failPosts){status=503;data={message:'offline'};}
      else if(method==='GET'){const owner=url.searchParams.get('user_id')?.slice(3);const filtered=[...posts].reverse().filter(p=>!owner||p.user_id===owner);const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20);headers['Content-Range']=`${offset}-${Math.max(offset,Math.min(offset+limit,filtered.length)-1)}/${filtered.length}`;data=filtered.slice(offset,offset+limit).map(p=>({...p,profiles:{username:names[p.user_id]},likes:[{count:likes.filter(l=>l.post_id===p.id).length}]}));}
      else if(method==='POST'){if(!current)throw Error('Unauthenticated insert');posts.push({...body,id:'post-'+(posts.length+1),user_id:current.id,created_at:new Date().toISOString()});status=201;data=null;}
      else {const id=url.searchParams.get('id').slice(3),p=posts.find(p=>p.id===id&&p.user_id===current?.id);data=p?[{id:p.id}]:[];if(p&&method==='PATCH')p.body=body.body;if(p&&method==='DELETE')posts=posts.filter(p=>p.id!==id);}
    }
    else if(url.pathname==='/rest/v1/likes'){
      const id=url.searchParams.get('post_id')?.replace(/^eq\./,'');
      if(method==='POST'){if(!likes.some(l=>l.post_id===body.post_id&&l.user_id===current.id))likes.push({post_id:body.post_id,user_id:current.id});status=201;data=null;}
      else if(method==='DELETE'){likes=likes.filter(l=>!(l.post_id===id&&l.user_id===current.id));status=204;data=null;}
      else {data=likes.filter(l=>(!id||id.startsWith('in.')||l.post_id===id)&&(!url.searchParams.has('user_id')||l.user_id===url.searchParams.get('user_id').slice(3)));headers['Content-Range']='0-0/'+data.length;if(method==='HEAD')data=null;}
    }
    else if(url.pathname==='/rest/v1/comments'){
      if(method==='POST'){comments.push({...body,id:'comment-'+comments.length,user_id:current.id,profiles:{username:names[current.id]},created_at:new Date().toISOString()});status=201;data=null;}
      else data=comments.filter(c=>c.post_id===url.searchParams.get('post_id').slice(3));
    }
    else if(url.pathname==='/functions/v1/admin'){data={role:'member'};}
    else if(url.pathname==='/rest/v1/site_settings'){data={title:'RedMusica',description:'Comparte música',accept_posts:true};}
    else throw Error('Unexpected request '+method+' '+url);
    await route.fulfill({status,headers,body:data===null?'':JSON.stringify(data)});
   });
   const page=await ctx.newPage();page.errors=[];page.on('pageerror',e=>page.errors.push(e.message));await page.goto('http://127.0.0.1:4174/'+start);await page.locator('#modoAcceso').waitFor();return page;
  }
  async function login(page,email){await page.locator('#modoAcceso').selectOption('login');await page.locator('#correoUsuario').fill(email);await page.locator('#claveUsuario').fill('test-password-123');await page.locator('#botonAcceso').click();await page.locator('#sesionPerfil').waitFor();await page.waitForFunction(()=>document.querySelector('#nombrePerfil').textContent.startsWith('Publicas como'));}
  const a=await makePage();
  await a.locator('#modoAcceso').selectOption('signup');await a.locator('#nombreUsuario').fill('Ana');await a.locator('#correoUsuario').fill(ana.email);await a.locator('#claveUsuario').fill('test-password-123');await a.locator('#botonAcceso').click();await a.waitForFunction(()=>document.querySelector('#estadoPerfil').textContent.includes('Revisa tu correo'));
  await login(a,ana.email);
  await a.locator('#buscarAlbum').fill('Álbum');await a.locator('#botonBuscar').click();await a.locator('.boton-elegir').click();await a.locator('#comentarioPublicacion').fill('Opinión <img src=x onerror=alert(1)>');await a.locator('#botonPublicar').click();await a.locator('#feed article').waitFor();
  assert.match(await a.locator('.autor-publicacion').innerText(),/@Ana/);assert.equal(await a.locator('#feed article script').count(),0);
  const b=await makePage();await login(b,luis.email);await b.locator('#feed article').waitFor();
  assert.equal(await b.getByRole('button',{name:'Editar',exact:true}).count(),0);
  const like=b.getByRole('button',{name:/Me gusta/});await like.click();await b.waitForFunction(()=>document.querySelector('[aria-pressed]').getAttribute('aria-pressed')==='true');assert.equal(likes.length,1);
  await like.click();await b.waitForFunction(()=>document.querySelector('[aria-pressed]').getAttribute('aria-pressed')==='false');assert.equal(likes.length,0);
  await b.getByRole('button',{name:'Comentar',exact:true}).click();await b.getByRole('textbox',{name:'Escribe un comentario'}).fill('Hola Ana');await b.getByRole('button',{name:'Enviar',exact:true}).click();await b.getByText('@Luis: Hola Ana',{exact:true}).waitFor();
  await a.getByRole('button',{name:'Comentar',exact:true}).click();await a.getByText('@Luis: Hola Ana',{exact:true}).waitFor();
  await a.getByRole('button',{name:'Editar',exact:true}).click();await a.getByRole('textbox',{name:'Editar opinión'}).fill('Opinión editada');await a.getByRole('button',{name:'Guardar cambios'}).click();await a.getByText('Publicación actualizada.',{exact:true}).waitFor();
  await b.locator('#actualizarFeed').click();await b.locator('.opinion').filter({hasText:'Opinión editada'}).waitFor();
  failPosts=true;await b.locator('#actualizarFeed').click();await b.waitForFunction(()=>document.querySelector('#estadoFeed').textContent.includes('No se pudieron'));failPosts=false;
  await b.locator('#actualizarFeed').click();await b.waitForFunction(()=>document.querySelector('#estadoFeed').textContent==='');
  await a.reload();await a.locator('#sesionPerfil').waitFor();await a.getByRole('button',{name:'Eliminar',exact:true}).waitFor();
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  a.on('dialog',dialog=>dialog.accept());await a.getByRole('button',{name:'Eliminar',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('#feed article').length===0);
  await a.locator('#cerrarSesion').click();await a.locator('#formularioAcceso').waitFor();assert.equal(await a.locator('#claveUsuario').inputValue(),'');
  await a.locator('#correoUsuario').fill(ana.email);await a.locator('#recuperarClave').click();await a.waitForFunction(()=>document.querySelector('#estadoPerfil').textContent.includes('recibirás un enlace'));
  await a.goto('about:blank');await a.goto('http://127.0.0.1:4174/#access_token='+token(ana)+'&refresh_token=refresh-test&expires_in=3600&token_type=bearer&type=recovery');
  await a.locator('#formularioNuevaClave').waitFor();await a.locator('#nuevaClave').fill('new-password-123');await a.getByRole('button',{name:'Guardar contraseña',exact:true}).click();await a.getByText('Contraseña actualizada.',{exact:true}).waitFor();
  // Public profile deep links must filter on the server and keep pagination/ownership.
  posts=Array.from({length:22},(_,i)=>({id:'profile-post-'+i,user_id:i===21?luis.id:ana.id,album_id:'33333333-3333-4333-8333-333333333333',album_title:'Disco '+i,album_artist:'Artista',body:'Opinión '+i,created_at:new Date().toISOString()}));
  const c=await makePage('?perfil='+ana.id);
  await c.waitForFunction(()=>document.querySelector('#resumenPerfilPublico').textContent==='21 publicaciones');
  assert.equal(await c.locator('#tituloPerfilPublico').innerText(),'@Ana');
  assert.equal(await c.locator('#feed article').count(),20);
  assert.equal(await c.locator('#crearPublicacion').isVisible(),false);
  assert.equal(await c.locator('#miPerfil').isVisible(),false);
  assert.equal(await c.getByRole('button',{name:'Editar',exact:true}).count(),0);
  assert.equal(await c.locator('#enlacePerfil').inputValue(),'http://127.0.0.1:4174/?perfil='+ana.id);
  assert.equal(await c.locator('#feed').innerText().then(t=>t.includes('@Luis')),false);
  await c.getByRole('button',{name:'Ver más publicaciones',exact:true}).click();
  await c.waitForFunction(()=>document.querySelectorAll('#feed article').length===21);
  await c.reload();await c.waitForFunction(()=>document.querySelectorAll('#feed article').length===20);
  await a.goto('http://127.0.0.1:4174/?perfil='+ana.id);
  await a.waitForFunction(()=>document.querySelectorAll('#feed article').length===20);
  await a.getByRole('button',{name:'Editar',exact:true}).first().waitFor();
  assert.equal(await a.locator('#miPerfil').getAttribute('href'),'?perfil='+ana.id);
  await b.goto('http://127.0.0.1:4174/?perfil='+ana.id);
  await b.waitForFunction(()=>document.querySelectorAll('#feed article').length===20);
  await b.getByRole('button',{name:/Me gusta/}).first().click();
  await b.waitForFunction(()=>document.querySelector('[aria-pressed]').getAttribute('aria-pressed')==='true');
  await b.getByRole('button',{name:'Comentar',exact:true}).first().click();
  await b.getByRole('textbox',{name:'Escribe un comentario'}).fill('Comentario en perfil');
  await b.getByRole('button',{name:'Enviar',exact:true}).click();
  await b.getByText('@Luis: Comentario en perfil',{exact:true}).waitFor();
  assert.equal(await b.locator('.lista-comentarios a').getAttribute('href'),'?perfil='+luis.id);
  await c.goto('http://127.0.0.1:4174/?perfil=00000000-0000-4000-8000-000000000000');
  await c.getByRole('heading',{name:'Perfil no encontrado'}).waitFor();
  assert.equal(await c.locator('#feed article').count(),0);
  await c.goto('http://127.0.0.1:4174/?perfil=incorrecto');
  await c.getByRole('heading',{name:'Perfil no encontrado'}).waitFor();
  posts=[];
  await c.goto('http://127.0.0.1:4174/?perfil='+luis.id);
  await c.waitForFunction(()=>document.querySelector('#resumenPerfilPublico').textContent==='0 publicaciones');
  assert.equal(await c.locator('#feedVacio').isVisible(),true);
  assert.equal(await c.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await c.getByRole('link',{name:'Inicio',exact:true}).click();
  await c.locator('#crearPublicacion').waitFor();
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);assert.deepEqual(c.errors,[]);
  console.log(engine.name(),'PASS profiles: public deep links, reload, author filter, pagination, owner controls, likes/comments, missing/empty profiles, navigation');
  await browser.close();console.log(engine.name(),'PASS shared UI using mock API: signup, two sessions, publish, toggle like, comments, edit/delete ownership UI, reload, failure/retry, logout, mobile, no JS errors');
 }
 server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
