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
  let posts=[],likes=[],comments=[],follows=[],notifications=[],chatMessages=[],failPosts=false;
  const names={[ana.id]:'Ana',[luis.id]:'Luis'};
  const profiles={[ana.id]:{username:'Ana',role:'owner',bio:'',avatar_updated_at:null,created_at:'2026-09-26T12:00:00Z'},[luis.id]:{username:'Luis',role:'member',bio:'',avatar_updated_at:null,created_at:'2026-09-26T12:00:00Z'}};let uploads=0,imageUploads=0;const contexts=[];
  function token(user){return Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';}
  async function makePage(start=''){
   const ctx=await browser.newContext(engine===webkit?{...devices['iPhone 13']}:{viewport:{width:1280,height:900}});contexts.push(ctx);
   await ctx.route('**/config.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.REDMUSICA_CONFIG={supabaseUrl:"https://redmusica-test.supabase.co",supabasePublishableKey:"sb_publishable_test"};'}));
   await ctx.route('https://musicbrainz.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({'release-groups':[{id:'33333333-3333-4333-8333-333333333333',title:'Álbum de prueba','artist-credit':[{name:'Artista de prueba'}]}]})}));
   await ctx.route('https://coverartarchive.org/**',r=>r.fulfill({status:404,body:''}));
   await ctx.route('https://itunes.apple.com/**',r=>r.fulfill({contentType:'text/javascript',body:new URL(r.request().url()).searchParams.get('callback')+'({"results":[]})'}));
   await ctx.route('https://redmusica-test.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();const body=url.pathname.startsWith('/storage/')?null:req.postDataJSON();
    const headers={'Content-Type':'application/json','Access-Control-Expose-Headers':'Content-Range'};
    const auth=req.headers().authorization;const sub=auth?.startsWith("Bearer ey")?JSON.parse(Buffer.from(auth.split(".")[1],"base64url").toString()).sub:null;const current=sub===ana.id?ana:sub===luis.id?luis:null;
    let data={},status=200;
    if(url.pathname==='/auth/v1/signup'){data={user:ana,session:null};}
    else if(url.pathname==='/auth/v1/token'){const user=body.email===ana.email?ana:luis;data={access_token:token(user),refresh_token:'refresh-'+user.id,expires_in:3600,token_type:'bearer',user};}
    else if(url.pathname==='/auth/v1/logout'){status=204;data=null;}
    else if(url.pathname==='/auth/v1/recover'){data={};}
    else if(url.pathname==='/auth/v1/user'){data=current;}
    else if(url.pathname==='/rest/v1/notifications'){
      const recipient=url.searchParams.get('recipient_id')?.replace(/^eq\./,'');
      if(method==='GET'||method==='HEAD'){const unread=url.searchParams.has('read_at');const items=notifications.filter(n=>(!recipient||n.recipient_id===recipient)&&(!unread||n.read_at===null));headers['Content-Range']='0-'+Math.max(0,items.length-1)+'/'+items.length;data=method==='HEAD'?null:items.slice().reverse();}
      else if(method==='PATCH'){for(const n of notifications)if(n.recipient_id===recipient&&(!url.searchParams.has('id')||n.id===url.searchParams.get('id').slice(3))&&n.read_at===null)n.read_at=body.read_at;data=[];}
    }
    else if(url.pathname==='/rest/v1/follows'){
      const user=url.searchParams.get('user_id')?.replace(/^eq\./,'');const target=url.searchParams.get('followed_id')?.replace(/^eq\./,'');
      if(method==='GET'){const items=follows.filter(f=>(!user||f.user_id===user)&&(!target||f.followed_id===target));headers['Content-Range']='0-'+Math.max(0,items.length-1)+'/'+items.length;data=method==='HEAD'?null:items;}
      else if(method==='POST'){const f={user_id:current.id,followed_id:body.followed_id};if(!follows.some(x=>x.user_id===f.user_id&&x.followed_id===f.followed_id)){follows.push(f);const u=profiles[f.followed_id];notifications.push({id:'n'+(notifications.length+1),recipient_id:f.followed_id,actor_id:current.id,kind:'follow',post_id:null,comment_id:null,actor:profiles[current.id],post:null,created_at:new Date().toISOString(),read_at:null});}status=201;data=null;}
      else if(method==='DELETE'){const doomed=follows.filter(f=>f.user_id===current.id&&f.followed_id===target);follows=follows.filter(f=>!doomed.includes(f));notifications=notifications.filter(n=>!(n.kind==='follow'&&n.recipient_id===target&&n.actor_id===current.id));status=204;data=null;}
    }
    else if(url.pathname==='/rest/v1/profiles'){const id=url.searchParams.get('id').slice(3);if(method==='PATCH'){assert.equal(id,current.id);Object.assign(profiles[id],body);data=[profiles[id]];}else data=profiles[id]||null;}
    else if(url.pathname.startsWith('/storage/v1/object/public/')){return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=','base64')});}
    else if(url.pathname.startsWith('/storage/v1/object/')){if(method==='POST'){if(url.pathname.includes('/post-images/')){imageUploads++;assert(url.pathname.includes('/'+ana.id+'/'));assert.match(req.headers()['x-upsert'],/false/);}else{uploads++;assert(url.pathname.endsWith(ana.id+'/avatar.jpg'));}}if(method==='DELETE'&&url.pathname.includes('/post-images/'))data={};else data={};}
    else if(url.pathname==='/rest/v1/chat_messages'){
      if(method==='GET'){data=chatMessages.slice(-50).reverse().map(m=>({...m,profiles:profiles[m.user_id]}));headers['Content-Range']='0-'+Math.max(0,data.length-1)+'/'+chatMessages.length;}
      else if(method==='POST'){const m={...body,id:'chat-'+(chatMessages.length+1),user_id:current.id,created_at:new Date().toISOString()};chatMessages.push(m);status=201;data=url.searchParams.has('select')?{...m}:null;}
    }
    else if(url.pathname==='/rest/v1/posts'){
      if(failPosts){status=503;data={message:'offline'};}
      else if(method==='GET'){const owner=url.searchParams.get('user_id')?.slice(3);const filtered=[...posts].reverse().filter(p=>!owner||p.user_id===owner);const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20);headers['Content-Range']=`${offset}-${Math.max(offset,Math.min(offset+limit,filtered.length)-1)}/${filtered.length}`;data=filtered.slice(offset,offset+limit).map(p=>({...p,profiles:profiles[p.user_id],likes:[{count:likes.filter(l=>l.post_id===p.id).length}]}));}
      else if(method==='POST'){if(!current)throw Error('Unauthenticated insert');const item={post_type:'album',album_id:null,album_title:null,album_artist:null,image_path:null,...body,id:'post-'+(posts.length+1),user_id:current.id,created_at:new Date().toISOString()};posts.push(item);status=201;data=url.searchParams.has('select')?{id:item.id}:null;}
      else {const id=url.searchParams.get('id').slice(3),p=posts.find(p=>p.id===id&&p.user_id===current?.id);data=p?[{id:p.id}]:[];if(p&&method==='PATCH')p.body=body.body;if(p&&method==='DELETE')posts=posts.filter(p=>p.id!==id);}
    }
    else if(url.pathname==='/rest/v1/likes'){
      const id=url.searchParams.get('post_id')?.replace(/^eq\./,'');
      if(method==='POST'){if(!likes.some(l=>l.post_id===body.post_id&&l.user_id===current.id)){likes.push({post_id:body.post_id,user_id:current.id});const target=posts.find(p=>p.id===body.post_id);if(target&&target.user_id!==current.id)notifications.push({id:'n'+(notifications.length+1),recipient_id:target.user_id,actor_id:current.id,kind:'like',post_id:target.id,comment_id:null,actor:profiles[current.id],post:{album_title:target.album_title},created_at:new Date().toISOString(),read_at:null});}status=201;data=null;}
      else if(method==='DELETE'){likes=likes.filter(l=>!(l.post_id===id&&l.user_id===current.id));status=204;data=null;}
      else {data=likes.filter(l=>(!id||id.startsWith('in.')||l.post_id===id)&&(!url.searchParams.has('user_id')||l.user_id===url.searchParams.get('user_id').slice(3)));headers['Content-Range']='0-0/'+data.length;if(method==='HEAD')data=null;}
    }
    else if(url.pathname==='/rest/v1/comments'){
      if(method==='POST'){const c={...body,id:'comment-'+comments.length,user_id:current.id,profiles:{username:names[current.id]},created_at:new Date().toISOString()};comments.push(c);const target=posts.find(p=>p.id===body.post_id);if(target&&target.user_id!==current.id)notifications.push({id:'n'+(notifications.length+1),recipient_id:target.user_id,actor_id:current.id,kind:'comment',post_id:target.id,comment_id:c.id,actor:profiles[current.id],post:{album_title:target.album_title},created_at:new Date().toISOString(),read_at:null});status=201;data=null;}
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
  await a.locator('#editarPerfil summary').click();
  await a.locator('#bioPerfil').fill('Escucho discos de Chile.');await a.getByRole('button',{name:'Guardar presentación'}).click();await a.getByText('Perfil actualizado.',{exact:true}).waitFor();
  function png1(){const zlib=require('node:zlib');const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};const chunk=(name,data)=>{const n=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,sum]);};const h=Buffer.alloc(13);h.writeUInt32BE(1,0);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}const photo=png1();
  await a.locator('#archivoFoto').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:photo});await a.getByRole('button',{name:'Guardar foto',exact:true}).click();await a.getByText('Perfil actualizado.',{exact:true}).waitFor();assert.equal(uploads,1);assert(profiles[ana.id].avatar_updated_at);
  await a.locator('#archivoFoto').setInputFiles({name:'invalido.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await a.getByRole('button',{name:'Guardar foto',exact:true}).click();await a.getByText('Elige una imagen JPG, PNG o WebP.',{exact:true}).waitFor();assert.equal(uploads,1);
  const b=await makePage();await login(b,luis.email);await b.locator('#feed article').waitFor();
  assert.equal(await b.getByRole('button',{name:'Editar',exact:true}).count(),0);
  const like=b.getByRole('button',{name:/Me gusta/});await like.click();await b.waitForFunction(()=>document.querySelector('[aria-pressed]').getAttribute('aria-pressed')==='true');assert.equal(likes.length,1);
  await like.click();await b.waitForFunction(()=>document.querySelector('[aria-pressed]').getAttribute('aria-pressed')==='false');assert.equal(likes.length,0);
  await b.getByRole('button',{name:'Comentar',exact:true}).click();await b.getByRole('textbox',{name:'Escribe un comentario'}).fill('Hola Ana');await b.locator('.zona-comentarios form').getByRole('button',{name:'Enviar',exact:true}).click();await b.getByText('@Luis: Hola Ana',{exact:true}).waitFor();
  await a.getByRole('button',{name:/Notificaciones/}).click();await a.getByText('@Luis marcó Me gusta en tu publicación · Álbum de prueba').waitFor();await a.getByText('@Luis comentó en tu publicación · Álbum de prueba').waitFor();
  await a.waitForFunction(()=>document.querySelector('#abrirNotificaciones').textContent.includes('(2)'));await a.getByRole('button',{name:'Marcar todas como leídas'}).click();await a.waitForFunction(()=>document.querySelector('#abrirNotificaciones').textContent==='Notificaciones');
  await b.goto('http://127.0.0.1:4174/index.html?perfil='+ana.id);await b.getByRole('button',{name:'Seguir',exact:true}).waitFor();await b.getByRole('button',{name:'Seguir',exact:true}).click();await b.getByRole('button',{name:'Dejar de seguir',exact:true}).waitFor();
  await a.getByRole('button',{name:'Notificaciones',exact:true}).click();await a.getByRole('button',{name:'Notificaciones',exact:true}).click();await a.getByText('@Luis empezó a seguirte').waitFor();await a.waitForFunction(()=>document.querySelector('#abrirNotificaciones').textContent.includes('(1)'));
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
  const c=await makePage('?perfil='+ana.id);await c.locator('#bioPerfilPublico').getByText('Escucho discos de Chile.',{exact:true}).waitFor();assert.equal(await c.locator('#rangoPerfilPublico').innerText(),'Owner');assert.equal(await c.locator('#fotoPerfilPublico img').count(),1);
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
  await b.locator('.zona-comentarios form').getByRole('button',{name:'Enviar',exact:true}).click();
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
  await a.goto('http://127.0.0.1:4174/');
  await a.locator('#crearPublicacion').waitFor();
  await a.locator('#crearMeme').waitFor({state:'visible'});
  await a.locator('#imagenMeme').setInputFiles({name:'meme.png',mimeType:'image/png',buffer:photo});
  await a.locator('#textoMeme').fill('Memoria de la comunidad');
  await a.getByRole('button',{name:'Publicar meme',exact:true}).click();
  await a.getByText('Meme publicado.',{exact:true}).waitFor();
  assert.equal(imageUploads,1);assert.equal(posts.at(-1).post_type,'meme');assert.equal(posts.at(-1).album_id,null);
  await a.locator('.imagen-meme').waitFor();assert.equal(await a.locator('.imagen-meme').getAttribute('alt'),'Meme publicado por @Ana');
  await a.locator('#textoChat').fill('Hola desde el chat');await a.locator('#formularioChat').getByRole('button',{name:'Enviar',exact:true}).click();
  try{await a.locator('.mensaje-chat').filter({hasText:'Hola desde el chat'}).waitFor({timeout:5000});}catch{throw Error(engine.name()+' chat send failed: '+await a.locator('#estadoChat').innerText()+'; account: '+await a.locator('#nombrePerfil').innerText()+'; DOM: '+await a.locator('#mensajesChat').innerText()+'; errors: '+JSON.stringify(a.errors));}assert.equal(chatMessages.length,1);
  await a.reload();await a.locator('.mensaje-chat').filter({hasText:'Hola desde el chat'}).waitFor();
  assert.equal(await a.locator('#mensajesChat .mensaje-chat').count(),1);
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);assert.deepEqual(c.errors,[]);
  console.log(engine.name(),'PASS notifications/follows and profiles: public deep links, reload, author filter, pagination, owner controls, likes/comments, missing/empty profiles, navigation');
  await browser.close();console.log(engine.name(),'PASS shared UI using mock API: signup, two sessions, album/meme posts, likes, comments, community chat, edit/delete ownership UI, reload, mobile, no JS errors');
 }
 server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
