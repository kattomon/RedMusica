const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('.');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.join(root,pathname==='/'?'index.html':pathname);
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(4174,'127.0.0.1',r));
 for(const engine of (process.env.TEST_WEBKIT_ONLY?[webkit]:[chromium,webkit])) {
  const browser=await engine.launch();
  const ana={id:'11111111-1111-4111-8111-111111111111',email:'ana@example.test',aud:'authenticated',role:'authenticated'};
  const luis={id:'22222222-2222-4222-8222-222222222222',email:'luis@example.test',aud:'authenticated',role:'authenticated'};
  let posts=[],likes=[],comments=[],follows=[],friendships=[],notifications=[],chatMessages=[],dmMessages=[],savedPosts=[],personalLists=[],listItems=[],failPosts=false;
  const names={[ana.id]:'Ana',[luis.id]:'Luis'};
  const profiles={[ana.id]:{username:'Ana',role:'owner',bio:'',avatar_updated_at:null,created_at:'2026-09-26T12:00:00Z'},[luis.id]:{username:'Luis',role:'member',bio:'',avatar_updated_at:null,created_at:'2026-09-26T12:00:00Z'}};let uploads=0,imageUploads=0;const contexts=[];
  function token(user){return Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';}
  async function makePage(start=''){
   const ctx=await browser.newContext(engine===webkit?{...devices['iPhone 13']}:{viewport:{width:1440,height:900}});contexts.push(ctx);
   await ctx.addInitScript(()=>{
    window.__beepCount=0;window.__browserNotices=[];window.__testHidden=false;window.__dmRealtimeCallback=null;window.__chatRealtimeCallback=null;window.__deliverDm=row=>window.__dmRealtimeCallback?.({new:row});window.__deliverChat=row=>window.__chatRealtimeCallback?.({new:row});
    const realSetInterval=window.setInterval.bind(window);window.setInterval=(callback,delay,...args)=>delay>=30000?0:realSetInterval(callback,delay,...args);
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__testHidden});
    class TestAudioContext{constructor(){this.state='running';this.currentTime=0;this.destination={};}resume(){return Promise.resolve();}createOscillator(){return{frequency:{value:0},connect(){},start(){window.__beepCount++;},stop(){}};}createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}}
    class TestNotification{static permission='granted';static requestPermission(){return Promise.resolve('granted');}constructor(title,options){this.title=title;this.options=options;window.__browserNotices.push({title,body:options.body});}close(){}}
    const registration={showNotification:async(title,options)=>window.__browserNotices.push({title,body:options.body})};Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,ready:Promise.resolve(registration)},configurable:true});
    Object.defineProperty(window,'AudioContext',{value:TestAudioContext,configurable:true});Object.defineProperty(window,'Notification',{value:TestNotification,configurable:true});
    Object.defineProperty(window,'redmusicaClient',{configurable:true,set(client){Object.defineProperty(window,'redmusicaClient',{value:client,configurable:true,writable:true});const channel=client.channel.bind(client);client.channel=(...args)=>{const instance=channel(...args),on=instance.on.bind(instance);instance.on=(event,filter,callback)=>{if(event==='postgres_changes'&&filter?.table==='dm_messages')window.__dmRealtimeCallback=callback;if(event==='postgres_changes'&&filter?.table==='chat_messages')window.__chatRealtimeCallback=callback;return on(event,filter,callback);};return instance;}}});
   });
   await ctx.route('**/config.js?*',r=>r.fulfill({contentType:'text/javascript',body:'window.REDMUSICA_CONFIG={supabaseUrl:"https://redmusica-test.supabase.co",supabasePublishableKey:"sb_publishable_test",emailConfirmationEnabled:false,passwordRecoveryEnabled:true};'}));
   await ctx.route('https://musicbrainz.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({'release-groups':[{id:'33333333-3333-4333-8333-333333333333',title:'Álbum de prueba','artist-credit':[{name:'Artista de prueba'}]}]})}));
   await ctx.route('https://coverartarchive.org/**',r=>r.fulfill({status:404,body:''}));
   await ctx.route('https://image.tmdb.org/t/p/**',r=>r.request().url().includes('restored-movie-poster.jpg')?r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=','base64')}):r.fulfill({status:404,body:''}));
   await ctx.route('https://commons.wikimedia.org/wiki/Special:FilePath/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=','base64')}));
   await ctx.route('https://itunes.apple.com/**',r=>{const url=new URL(r.request().url()),callback=url.searchParams.get('callback');const results=url.searchParams.get('term')?.toLowerCase().includes('película de prueba')?[{trackName:'La película de prueba',releaseDate:'2020-01-01',artworkUrl100:'https://is1-ssl.mzstatic.com/image/thumb/test/100x100bb.jpg'}]:[];return r.fulfill({contentType:'text/javascript',body:callback+'('+JSON.stringify({results})+')'});});
   await ctx.route('https://is*.mzstatic.com/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=','base64')}));
   await ctx.route('https://es.wikipedia.org/w/api.php?*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({query:{pages:{}}})}));
   await ctx.route('https://en.wikipedia.org/w/api.php?*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({query:{pages:{}}})}));
   await ctx.route('https://www.wikidata.org/w/api.php?*',r=>{
    const url=new URL(r.request().url()),action=url.searchParams.get('action');let body={};
    if(action==='wbsearchentities')body={search:url.searchParams.get('search').toLowerCase().includes('commons')?[{id:'Q54321',label:'Película con afiche Commons',description:'película chilena'}]:[{id:'Q12345',label:'La película de prueba',description:'película chilena'}]};
  else{
     body={entities:{}};
     for(const id of url.searchParams.get('ids').split('|')){
      if(id==='Q12345')body.entities[id]={id,labels:{es:{value:'La película de prueba'}},descriptions:{es:{value:'película chilena'}},claims:{P31:[{mainsnak:{datavalue:{value:{id:'Q11424'}}}}],P57:[{mainsnak:{datavalue:{value:{id:'Q67890'}}}}],P577:[{mainsnak:{datavalue:{value:{time:'+2020-01-01T00:00:00Z'}}}}]}};
      else if(id==='Q54321')body.entities[id]={id,labels:{es:{value:'Película con afiche Commons'}},descriptions:{es:{value:'película chilena'}},claims:{P31:[{mainsnak:{datavalue:{value:{id:'Q11424'}}}}],P3383:[{mainsnak:{datavalue:{value:'Test_movie_poster.jpg'}}}]}};
      else body.entities[id]={id,labels:{es:{value:'Directora de prueba'}}};
     }
    }
    return r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   });
   await ctx.route('https://redmusica-test.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();const body=url.pathname.startsWith('/storage/')?null:req.postDataJSON();
    const headers={'Content-Type':'application/json','Access-Control-Expose-Headers':'Content-Range, X-Total-Count','Access-Control-Allow-Origin':req.headers().origin||'*','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':req.headers()['access-control-request-headers']||'authorization, apikey, content-type, x-client-info, accept, accept-profile, content-profile, prefer, range, x-upsert','Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS, HEAD','Access-Control-Max-Age':'86400'};
    if(method==='OPTIONS')return route.fulfill({status:204,headers,body:''});
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
    else if(url.pathname==='/rest/v1/friendships'){
      const a=url.searchParams.get('user_a')?.replace(/^eq\./,''),b=url.searchParams.get('user_b')?.replace(/^eq\./,''),statusFilter=url.searchParams.get('status')?.replace(/^eq\./,'');
      if(method==='GET'){const or=url.searchParams.get('or')||'';const rows=friendships.filter(f=>(!a||f.user_a===a)&&(!b||f.user_b===b)&&(!statusFilter||f.status===statusFilter)&&(!or||or.includes(f.user_a)||or.includes(f.user_b)));headers['Content-Range']='0-'+Math.max(0,rows.length-1)+'/'+rows.length;data=rows;}
      else if(method==='POST'){if(!current)throw Error('Unauthenticated friendship insert');const row={...body,status:'pending',created_at:new Date().toISOString()};assert.equal(row.requested_by,current.id);if(!friendships.some(f=>f.user_a===row.user_a&&f.user_b===row.user_b))friendships.push(row);else{status=409;data={code:'23505',message:'duplicate friendship'};}if(status!==409){status=201;data=url.searchParams.has('select')?row:null;}}
      else if(method==='PATCH'){for(const f of friendships)if((!a||f.user_a===a)&&(!b||f.user_b===b)&&(!statusFilter||f.status===statusFilter))Object.assign(f,body);data=[];}
      else if(method==='DELETE'){friendships=friendships.filter(f=>!((!a||f.user_a===a)&&(!b||f.user_b===b)));status=204;data=null;}
    }
    else if(url.pathname==='/rest/v1/profiles'){const filter=url.searchParams.get('id')||'',ids=filter.startsWith('in.(')?filter.slice(4,-1).split(','):filter.startsWith('eq.')?[filter.slice(3)]:Object.keys(profiles);if(method==='PATCH'){assert.equal(ids[0],current.id);Object.assign(profiles[ids[0]],body);data=[profiles[ids[0]]];}else data=ids.map(id=>({id,...profiles[id]})).filter(p=>p.username);}
    else if(url.pathname.startsWith('/storage/v1/object/public/')){return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=','base64')});}
    else if(url.pathname.startsWith('/storage/v1/object/')){if(method==='POST'){if(url.pathname.includes('/post-images/')){imageUploads++;assert(url.pathname.includes('/'+ana.id+'/'));assert.match(req.headers()['x-upsert'],/false/);}else{uploads++;assert(url.pathname.endsWith(ana.id+'/avatar.jpg'));}}if(method==='DELETE'&&url.pathname.includes('/post-images/'))data={};else data={};}
    else if(url.pathname==='/rest/v1/chat_messages'){
      if(method==='GET'){data=chatMessages.slice(-50).reverse().map(m=>({...m,profiles:profiles[m.user_id]}));headers['Content-Range']='0-'+Math.max(0,data.length-1)+'/'+chatMessages.length;}
      else if(method==='POST'){const m={...body,id:'chat-'+(chatMessages.length+1),user_id:current.id,created_at:new Date().toISOString()};chatMessages.push(m);status=201;data=url.searchParams.has('select')?{...m}:null;}
    }
    else if(url.pathname==='/rest/v1/dm_messages'){
      if(method==='GET'){
        const recipient=url.searchParams.get('recipient_id')?.replace(/^eq\./,'');
        if(recipient){const since=url.searchParams.get('created_at')?.replace(/^gte\./,'');data=dmMessages.filter(m=>m.recipient_id===recipient&&(!since||m.created_at>=since)).slice(-50);}
        else{const or=url.searchParams.get('or')||'',other=(or.match(/sender_id\.eq\.([0-9a-f-]{36})/)||[])[1]===current?.id?(or.match(/recipient_id\.eq\.([0-9a-f-]{36})/)||[])[1]:(or.match(/sender_id\.eq\.([0-9a-f-]{36})/)||[])[1];data=dmMessages.filter(m=>(m.sender_id===current?.id&&m.recipient_id===other)||(m.recipient_id===current?.id&&m.sender_id===other)).slice(-50).reverse();}
        headers['Content-Range']='0-'+Math.max(0,data.length-1)+'/'+data.length;
      }else if(method==='POST'){
        assert(friendships.some(f=>f.status==='accepted'&&((f.user_a===current.id&&f.user_b===body.recipient_id)||(f.user_b===current.id&&f.user_a===body.recipient_id))),'private chat requires accepted friendship');
        const m={...body,id:'dm-'+(dmMessages.length+1),sender_id:current.id,created_at:new Date().toISOString()};dmMessages.push(m);status=201;data=url.searchParams.has('select')?m:null;
      }
    }
    else if(url.pathname==='/rest/v1/saved_posts'){
      if(method==='GET'){const ids=url.searchParams.get('post_id')?.slice(4,-1).split(',');data=savedPosts.filter(row=>row.user_id===current?.id&&(!ids||ids.includes(row.post_id)));}
      else if(method==='POST'){if(!current)throw Error('Unauthenticated save');if(!savedPosts.some(row=>row.user_id===current.id&&row.post_id===body.post_id))savedPosts.push({user_id:current.id,post_id:body.post_id,created_at:new Date().toISOString()});status=201;data=null;}
      else if(method==='DELETE'){savedPosts=savedPosts.filter(row=>!(row.user_id===current?.id&&row.post_id===url.searchParams.get('post_id')?.slice(3)));status=204;data=null;}
    }
    else if(url.pathname==='/rest/v1/personal_lists'){
      if(method==='GET')data=personalLists.filter(row=>row.user_id===current?.id);
      else if(method==='POST'){if(!current)throw Error('Unauthenticated list');if(personalLists.some(row=>row.user_id===current.id&&row.name.toLowerCase()===body.name.toLowerCase())){status=409;data={code:'23505'};}else{const row={id:'list-'+(personalLists.length+1),user_id:current.id,name:body.name,created_at:new Date().toISOString()};personalLists.push(row);status=201;data=url.searchParams.has('select')?row:null;}}
    }
    else if(url.pathname==='/rest/v1/personal_list_items'){
      if(method==='GET')data=listItems.filter(row=>personalLists.some(list=>list.id===row.list_id&&list.user_id===current?.id)&&row.list_id===url.searchParams.get('list_id')?.slice(3));
      else if(method==='POST'){if(!current||!personalLists.some(list=>list.id===body.list_id&&list.user_id===current.id))throw Error('List access denied');if(!listItems.some(row=>row.list_id===body.list_id&&row.post_id===body.post_id))listItems.push({...body,created_at:new Date().toISOString()});status=201;data=null;}
      else if(method==='DELETE'){listItems=listItems.filter(row=>!(row.list_id===url.searchParams.get('list_id')?.slice(3)&&row.post_id===url.searchParams.get('post_id')?.slice(3)));status=204;data=null;}
    }
    else if(url.pathname==='/rest/v1/posts'){
      if(failPosts){status=503;data={message:'offline'};}
      else if(method==='GET'){const userFilter=url.searchParams.get('user_id'),owner=userFilter?.startsWith('eq.')?userFilter.slice(3):undefined,authorFilter=url.searchParams.get('user_id')?.match(/^in\.\((.*)\)$/)?.[1]?.split(','),idFilter=url.searchParams.get('id')?.match(/^in\.\((.*)\)$/)?.[1]?.split(','),type=url.searchParams.get('post_type')?.slice(3);const filtered=[...posts].reverse().filter(p=>(!owner||p.user_id===owner)&&(!authorFilter||authorFilter.includes(p.user_id))&&(!idFilter||idFilter.includes(p.id))&&(!type||(p.post_type||'album')===type));const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20);headers['Content-Range']=`${offset}-${Math.max(offset,Math.min(offset+limit,filtered.length)-1)}/${filtered.length}`;data=filtered.slice(offset,offset+limit).map(p=>({...p,profiles:profiles[p.user_id],likes:[{count:likes.filter(l=>l.post_id===p.id).length}]}));}
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
    else if(url.pathname==='/functions/v1/movie-catalog'){
      const movieId=Number(body?.movieId),withoutPoster=body?.query?.toLowerCase().includes('sin afiche');
      const movie={tmdb_id:body?.query?.toLowerCase().includes('commons')?54321:12345,title:body?.query?.toLowerCase().includes('commons')?'Película con afiche Commons':'La película de prueba',director:'Directora de prueba',year:2020,poster:withoutPoster?null:'https://image.tmdb.org/t/p/w500/test-movie-poster.jpg',description:'película chilena'};
      data={results:[movieId?{...movie,tmdb_id:movieId,poster:'https://image.tmdb.org/t/p/w500/restored-movie-poster.jpg'}:movie]};
    }
    else if(url.pathname==='/functions/v1/admin'){data={role:'member'};}
    else if(url.pathname==='/rest/v1/site_settings'){data={title:'RedMusica',description:'Comparte música',accept_posts:true};}
    else throw Error('Unexpected request '+method+' '+url);
    await route.fulfill({status,headers,body:data===null?'':JSON.stringify(data)});
   });
   const page=await ctx.newPage();page.errors=[];page.blockedTestRequests=[];page.on('pageerror',e=>{if(e.message.includes('due to access control checks.'))page.blockedTestRequests.push(e.message);else page.errors.push(e.message);});await page.goto('http://127.0.0.1:4174/'+start);await page.locator('#tituloFeed').waitFor({state:'attached'});return page;
  }
  async function login(page,email){await page.locator('#modoAcceso').selectOption('login');await page.locator('#correoUsuario').fill(email);await page.locator('#claveUsuario').fill('test-password-123');await page.locator('#botonAcceso').click();await page.locator('#sesionPerfil').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#nombrePerfil').textContent.startsWith('Publicas como'));}
  const a=await makePage();
  assert.equal(await a.locator('#cuenta').isVisible(),true,'guest account entry is shown on the home page');
  assert.equal(await a.locator('#chatComunitario').isVisible(),false,'community chat is hidden until login');
  const visitor=await makePage('?seccion=memes');await visitor.waitForURL('http://127.0.0.1:4174/');assert.equal(await visitor.locator('#memesNav').isVisible(),false,'visitors can only access home');assert.equal(await visitor.locator('#chatComunitario').isVisible(),false);await visitor.close();
  await a.locator('#modoAcceso').selectOption('signup');await a.locator('#nombreUsuario').fill('Ana');await a.locator('#correoUsuario').fill(ana.email);await a.locator('#claveUsuario').fill('test-password-123');await a.locator('#botonAcceso').click();await a.waitForFunction(()=>document.querySelector('#estadoPerfil').textContent.includes('Cuenta creada. Inicia sesión'));
  assert.match(await a.locator('.aviso-cuenta').innerText(),/no necesitas confirmar el correo/i);
  assert.match(await a.locator('.aviso-cuenta').innerText(),/no hay recuperación de contraseña/i);
  await login(a,ana.email);
  assert.equal(await a.locator('#cuenta').isVisible(),false,'signed-in users do not see the registration panel');
  const radioQueue=[{id:'radio-live',video_id:'abcdefghijk',title:'Música de prueba',channel:'Canal',duration:180,starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+179000).toISOString()}];
  await a.context().route('**/functions/v1/radio',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({now:new Date().toISOString(),queue:radioQueue})}));
  await a.context().route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'text/javascript',body:`window.YT={Player:function(id,options){window.playerOptions=options;window.playerCalls=[];window.pauseCalls=0;this.cueVideoById=p=>window.playerCalls.push(p);this.loadVideoById=p=>window.playerCalls.push(p);this.pauseVideo=()=>window.pauseCalls++;this.playVideo=()=>{};this.stopVideo=()=>{};document.getElementById(id).textContent='Reproductor visible';setTimeout(()=>options.events.onReady(),0);}};window.onYouTubeIframeAPIReady();`}));
  await a.getByRole('button',{name:'Radio ♫'}).click();
  const radio=a.frameLocator('#panelRadio iframe');
  await radio.getByRole('button',{name:'Entrar a escuchar'}).click();
  await radio.getByRole('button',{name:'Volver a la canción de la sala'}).waitFor();
  await a.locator('#memesNav').click();
  assert.equal(new URL(a.url()).searchParams.get('seccion'),'memes');
  assert.equal(await a.locator('#panelRadio iframe').count(),1,'switching to memes must keep the radio iframe alive');
  assert.equal(await radio.locator('body').evaluate(()=>window.pauseCalls),0,'switching to memes must not pause the player');
  await a.locator('#inicioNav').click();
  assert.equal(new URL(a.url()).searchParams.has('seccion'),false);
  assert.equal(await a.locator('#panelRadio iframe').count(),1,'returning home must keep the radio iframe alive');
  assert.equal(await radio.locator('body').evaluate(()=>window.pauseCalls),0,'returning home must not pause the player');
  await a.getByRole('button',{name:'Minimizar sin detener la radio'}).click();
  await a.locator('#buscarAlbum').fill('Álbum');await a.locator('#botonBuscar').click();await a.locator('.boton-elegir').click();await a.locator('#comentarioPublicacion').fill('Opinión <img src=x onerror=alert(1)>');await a.locator('#botonPublicar').click();await a.locator('#feed article').waitFor();
  assert.match(await a.locator('.autor-publicacion').innerText(),/@Ana/);assert.equal(await a.locator('#feed article script').count(),0);
  await a.locator('#peliculasNav').click();assert.equal(await a.locator('#tituloFeed').innerText(),'Reseñas de películas');
  assert.equal(await a.locator('#cuenta').isVisible(),false,'the account panel stays hidden in movies');
  assert.equal(await a.locator('#panelRadio iframe').count(),1,'switching to movies must keep the radio iframe alive');
  assert.equal(await radio.locator('body').evaluate(()=>window.pauseCalls),0,'switching to movies must not pause the player');
  await a.locator('#buscarPelicula').fill('La película de prueba');await a.locator('#buscarPeliculas').click();
  await a.getByRole('button',{name:'Escribir reseña'}).waitFor();await a.getByRole('button',{name:'Escribir reseña'}).click();
  assert.match(await a.locator('#datosPelicula').innerText(),/Directora de prueba.*2020/);
  await a.locator('#notaPelicula').selectOption('4.5');await a.locator('#opinionPelicula').fill('Una reseña de prueba');await a.getByRole('button',{name:'Publicar reseña'}).click();
  await a.locator('#estadoBusquedaPeliculas').getByText('Reseña publicada.',{exact:true}).waitFor();assert.equal(posts.at(-1).post_type,'film');assert.equal(posts.at(-1).film_tmdb_id,12345);assert.equal(posts.at(-1).film_rating,4.5);assert.match(posts.at(-1).film_poster,/image\.tmdb\.org\/t\/p\/w500/);await a.locator('.publicacion-pelicula .poster-pelicula').waitFor();assert.equal(await a.locator('.atribucion-catalogo').innerText().then(t=>t.includes('not endorsed or certified by TMDB')),true);
  await a.waitForFunction(()=>document.querySelectorAll('#feed article').length===1);assert.match(await a.locator('#feed article').innerText(),/La película de prueba/);
  await a.locator('#buscarPelicula').fill('Película con afiche Commons');await a.locator('#buscarPeliculas').click();await a.locator('.poster-resultado-pelicula').waitFor();assert.match(await a.locator('.poster-resultado-pelicula').getAttribute('src'),/image\.tmdb\.org\/t\/p\/w500/);
  await a.locator('#buscarPelicula').fill('Una película sin afiche');await a.locator('#buscarPeliculas').click();await a.getByRole('button',{name:'Escribir reseña'}).waitFor();await a.getByRole('button',{name:'Escribir reseña'}).click();await a.locator('#opinionPelicula').fill('Reseña sin imagen de catálogo');await a.getByRole('button',{name:'Publicar reseña'}).click();await a.locator('#estadoBusquedaPeliculas').getByText('Reseña publicada.',{exact:true}).waitFor();await a.locator('#'+posts.at(-1).id+' .poster-pelicula').waitFor();assert.equal(posts.at(-1).film_poster,null);assert.equal((await a.locator('#'+posts.at(-1).id+' .poster-pelicula').getAttribute('src')).includes('restored-movie-poster.jpg'),true);assert.equal(await a.locator('#'+posts.at(-1).id+' .poster-pelicula').evaluate(el=>getComputedStyle(el).width),await a.evaluate(()=>matchMedia('(max-width:520px)').matches?'72px':'92px'));
  await a.locator('#inicioNav').click();await a.waitForFunction(()=>document.querySelector('#feed').innerText.includes('Álbum de prueba'));assert.equal(await a.locator('#feed article').count(),1);
  await a.locator('#miPerfil').click();await a.locator('#perfilPublico').waitFor({state:'visible'});assert.equal(await a.locator('#sesionPerfil').isVisible(),true,'profile settings remain available on the owner profile');await a.locator('#editarPerfil summary').click();
  await a.locator('#bioPerfil').fill('Escucho discos de Chile.');await a.getByRole('button',{name:'Guardar presentación'}).click();await a.getByText('Perfil actualizado.',{exact:true}).waitFor();
  function png1(){const zlib=require('node:zlib');const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};const chunk=(name,data)=>{const n=Buffer.from(name),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,sum]);};const h=Buffer.alloc(13);h.writeUInt32BE(1,0);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}const photo=png1();
  await a.locator('#archivoFoto').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:photo});await a.getByRole('button',{name:'Guardar foto',exact:true}).click();await a.getByText('Perfil actualizado.',{exact:true}).waitFor();assert.equal(uploads,1);assert(profiles[ana.id].avatar_updated_at);
  await a.locator('#archivoFoto').setInputFiles({name:'invalido.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await a.getByRole('button',{name:'Guardar foto',exact:true}).click();await a.getByText('Elige una imagen JPG, PNG o WebP.',{exact:true}).waitFor();assert.equal(uploads,1);
  await a.locator('#inicioNav').click();
  const b=await makePage();await login(b,luis.email);await b.locator('#feed article').waitFor();
  assert.equal(await b.getByRole('button',{name:'Editar',exact:true}).count(),0);
  const like=b.getByRole('button',{name:/Me gusta/});await like.click();await b.waitForFunction(()=>document.querySelector('[aria-pressed]').getAttribute('aria-pressed')==='true');assert.equal(likes.length,1);
  await like.click();await b.waitForFunction(()=>document.querySelector('[aria-pressed]').getAttribute('aria-pressed')==='false');assert.equal(likes.length,0);
  await b.getByRole('button',{name:'Comentar',exact:true}).click();await b.getByRole('textbox',{name:'Escribe un comentario'}).fill('Hola Ana');await b.locator('.zona-comentarios form').getByRole('button',{name:'Enviar',exact:true}).click();await b.getByText('@Luis: Hola Ana',{exact:true}).waitFor();
  await a.getByRole('button',{name:/Notificaciones/}).click();await a.getByText('@Luis marcó Me gusta en tu publicación · Álbum de prueba').waitFor();await a.getByText('@Luis comentó en tu publicación · Álbum de prueba').waitFor();
  await a.waitForFunction(()=>document.querySelector('#abrirNotificaciones').textContent.includes('(2)'));await a.getByRole('button',{name:'Marcar todas como leídas'}).click();await a.waitForFunction(()=>document.querySelector('#abrirNotificaciones').textContent==='Notificaciones');
  await b.goto('http://127.0.0.1:4174/index.html?perfil='+ana.id);await b.getByRole('button',{name:'Seguir',exact:true}).waitFor();await b.getByRole('button',{name:'Seguir',exact:true}).click();await b.getByRole('button',{name:'Dejar de seguir',exact:true}).waitFor();
  await b.getByRole('button',{name:'Agregar amigo',exact:true}).click();await b.getByRole('button',{name:'Cancelar solicitud',exact:true}).waitFor();assert.equal(friendships.length,1);
  await a.goto('http://127.0.0.1:4174/?seccion=amigos');await a.getByRole('heading',{name:'Amigos y solicitudes'}).waitFor();assert.equal(await a.locator('#cuenta').isVisible(),false,'the account panel stays hidden on the friends page');await a.getByRole('button',{name:'Aceptar',exact:true}).click();await a.locator('.tarjeta-amigo .estado-amistad').getByText('Amigos',{exact:true}).waitFor();assert.equal(friendships[0].status,'accepted');
  await b.goto('http://127.0.0.1:4174/?seccion=amigos');await b.locator('.tarjeta-amigo').getByText('@Ana',{exact:true}).waitFor();await b.locator('.tarjeta-amigo .estado-amistad').getByText('Amigos',{exact:true}).waitFor();await b.locator('.tarjeta-amigo .estado-presencia-amigo').waitFor();await b.locator('.enlace-usuario').first().waitFor();
  if(engine.name()==='webkit'){await b.locator('#abrirDockAmigos').click();await b.locator('#dockAmigos.abierto').waitFor();assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile friends dock must not cause horizontal overflow');}
  await a.goto('http://127.0.0.1:4174/');await b.goto('http://127.0.0.1:4174/');
  await b.locator('#feed article').first().getByRole('button',{name:'Guardar',exact:true}).click();await b.getByRole('button',{name:'Guardado',exact:true}).waitFor();assert.equal(savedPosts.length,1);
  await b.locator('#guardadosNav').click();await b.getByRole('heading',{name:'Guardados'}).waitFor();await b.locator('#feed article').getByText('Álbum de prueba',{exact:true}).waitFor();
  await b.locator('#listasNav').click();await b.locator('#nombreLista').fill('Favoritos');await b.getByRole('button',{name:'Crear lista'}).click();await b.getByRole('link',{name:'Favoritos',exact:true}).waitFor();assert.equal(personalLists.length,1);
  await b.locator('#inicioNav').click();await b.locator('#feed article').first().locator('.acciones select').selectOption(personalLists[0].id);await b.locator('#feed article').first().getByRole('button',{name:'Añadir',exact:true}).click();await b.getByText('Añadido a tu lista.',{exact:true}).waitFor();assert.equal(listItems.length,1);
  await b.locator('#listasNav').click();await b.getByRole('link',{name:'Favoritos',exact:true}).click();await b.locator('#feed article').getByText('Álbum de prueba',{exact:true}).waitFor();
  await b.locator('#actividadNav').click();await b.getByRole('heading',{name:'Actividad de tus amigos'}).waitFor();await b.locator('#feed article').filter({hasText:'Álbum de prueba'}).waitFor();assert.equal(await b.locator('#feed article').count()>0,true);await b.locator('#inicioNav').click();
  if(engine.name()==='webkit')await a.locator('#abrirDockAmigos').click();
  await a.locator('.amigo-dock .estado-presencia-amigo').waitFor();assert.equal(await a.locator('.amigo-dock .amigo-identidad').count(),1);assert.equal(await a.locator('.amigo-dock .estado-presencia-amigo').evaluate(el=>el.getBoundingClientRect().top>el.parentElement.querySelector('.amigo-nombre').getBoundingClientRect().bottom),true,'friend presence is displayed below the name');
  await a.locator('.amigo-dock .boton-chat-amigo').click();await a.locator('#ventanaChatAmigo').waitFor({state:'visible'});await a.locator('#textoChatPrivado').fill('Hola en privado');await a.locator('#enviarChatPrivado').click();await a.getByText('Hola en privado',{exact:true}).waitFor();assert.equal(dmMessages.length,1);
  await a.locator('#memesNav').click();assert.equal(await a.locator('#ventanaChatAmigo').isVisible(),true,'private chat stays open while changing sections');await a.locator('#inicioNav').click();
  if(engine.name()==='webkit')await b.locator('#abrirDockAmigos').click();
  await b.locator('.amigo-dock .boton-chat-amigo').click();await b.getByText('Hola en privado',{exact:true}).waitFor();await b.locator('#textoChatPrivado').fill('Respuesta privada');await b.locator('#enviarChatPrivado').click();await b.getByText('Respuesta privada',{exact:true}).waitFor();assert.equal(dmMessages.length,2);
  await a.evaluate(row=>{window.__testHidden=true;window.__deliverDm(row);},dmMessages[1]);await a.waitForFunction(()=>window.__browserNotices.some(n=>n.body==='Tienes un nuevo mensaje privado.'));await a.waitForFunction(()=>window.__beepCount>=3);assert.equal(await a.evaluate(()=>window.__browserNotices.some(n=>n.title==='Nuevo mensaje · RedMusica')),true,'an incoming private message shows a browser notification while the tab is in the background');
  await a.evaluate(row=>window.__deliverChat(row),{id:'chat-incoming',user_id:luis.id,body:'Hola desde el segundo plano',created_at:new Date().toISOString(),profiles:{username:'Luis',role:'member'}});await a.waitForFunction(()=>window.__browserNotices.some(n=>n.body==='Hay un mensaje nuevo en el chat comunitario.'));await a.waitForFunction(()=>window.__beepCount>=5);assert.equal(await a.locator('#mensajesChat [data-message-id="chat-incoming"]').count(),1,'incoming community messages are shown once while the page is in the background');
  await a.locator('#minimizarChatAmigo').click();await a.locator('#ventanaChatAmigo.minimizado').waitFor();assert.equal(await a.locator('#ventanaChatAmigo header button').count(),2,'the minimized chat keeps its controls in one compact header');await a.getByRole('button',{name:'Restaurar chat'}).click();assert.equal(await a.locator('#ventanaChatAmigo.minimizado').count(),0);await a.locator('#cerrarChatAmigo').click();await a.locator('.amigo-dock .boton-chat-amigo').click();await a.getByText('Respuesta privada',{exact:true}).waitFor();
  await a.getByRole('button',{name:/Notificaciones/}).click();await a.getByText('@Luis empezó a seguirte').waitFor();await a.waitForFunction(()=>document.querySelector('#abrirNotificaciones').textContent.includes('(1)'));
  await a.getByRole('button',{name:'Comentar',exact:true}).click();await a.getByText('@Luis: Hola Ana',{exact:true}).waitFor();
  await a.getByRole('button',{name:'Editar',exact:true}).click();await a.getByRole('textbox',{name:'Editar opinión'}).fill('Opinión editada');await a.getByRole('button',{name:'Guardar cambios'}).click();await a.getByText('Publicación actualizada.',{exact:true}).waitFor();
  await b.locator('#actualizarFeed').click();await b.locator('.opinion').filter({hasText:'Opinión editada'}).waitFor();
  failPosts=true;await b.locator('#actualizarFeed').click();await b.waitForFunction(()=>document.querySelector('#estadoFeed').textContent.includes('No se pudieron'));failPosts=false;
  await b.locator('#actualizarFeed').click();await b.waitForFunction(()=>document.querySelector('#estadoFeed').textContent==='');
  await a.reload();await a.locator('#sesionPerfil').waitFor({state:'attached'});await a.getByRole('button',{name:'Eliminar',exact:true}).waitFor();
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  a.on('dialog',dialog=>dialog.accept());await a.getByRole('button',{name:'Eliminar',exact:true}).click();await a.waitForFunction(()=>document.querySelectorAll('#feed article').length===0);
  await a.locator('#miPerfil').click();await a.locator('#sesionPerfil').waitFor({state:'visible'});await a.locator('#cerrarSesion').click();await a.locator('#sesionPerfil').waitFor({state:'hidden'});await a.goto('http://127.0.0.1:4174/');await a.locator('#formularioAcceso').waitFor();await a.locator('#chatComunitario').waitFor({state:'hidden'});assert.equal(await a.locator('#claveUsuario').inputValue(),'');
  await a.locator('#correoUsuario').fill(ana.email);await a.locator('#recuperarClave').click();await a.waitForFunction(()=>document.querySelector('#estadoPerfil').textContent.includes('recibirás un enlace'));
  await a.goto('about:blank');await a.goto('http://127.0.0.1:4174/#access_token='+token(ana)+'&refresh_token=refresh-test&expires_in=3600&token_type=bearer&type=recovery');
  await a.locator('#formularioNuevaClave').waitFor();await a.locator('#nuevaClave').fill('new-password-123');await a.getByRole('button',{name:'Guardar contraseña',exact:true}).click();await a.waitForFunction(()=>document.querySelector('#estadoPerfil').textContent==='Contraseña actualizada.');await a.locator('#miPerfil').click();await a.locator('#cerrarSesion').click();await a.locator('#sesionPerfil').waitFor({state:'hidden'});await a.goto('http://127.0.0.1:4174/');await login(a,ana.email);
  // Public profile deep links must filter on the server and keep pagination/ownership.
  posts=Array.from({length:22},(_,i)=>({id:'profile-post-'+i,user_id:i===21?luis.id:ana.id,album_id:'33333333-3333-4333-8333-333333333333',album_title:'Disco '+i,album_artist:'Artista',body:'Opinión '+i,created_at:new Date().toISOString()}));
  const c=await makePage();await c.context().route('**/rest/v1/notifications*',r=>r.fulfill({status:r.request().method()==='OPTIONS'?204:200,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,HEAD,OPTIONS,PATCH','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,prefer','content-type':'application/json'},body:r.request().method()==='OPTIONS'?'':'[]'}));await login(c,luis.email);await c.goto('http://127.0.0.1:4174/?perfil='+ana.id);await c.locator('#bioPerfilPublico').getByText('Escucho discos de Chile.',{exact:true}).waitFor();assert.equal(await c.locator('#rangoPerfilPublico').innerText(),'Owner');assert.equal(await c.locator('#fotoPerfilPublico img').count(),1);
  await c.waitForFunction(()=>document.querySelector('#resumenPerfilPublico').textContent==='21 publicaciones');
  assert.equal(await c.locator('#tituloPerfilPublico').innerText(),'@Ana');
  assert.equal(await c.locator('#feed article').count(),20);
  assert.equal(await c.locator('#crearPublicacion').isVisible(),false);
  assert.equal(await c.locator('#miPerfil').isVisible(),true);
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
  await a.locator('#memesNav').click();
  await a.locator('#crearPublicacion').waitFor({state:'attached'});
  assert.equal(await a.locator('#crearPublicacion').isVisible(),false);
  assert.equal(await a.locator('#tituloFeed').innerText(),'Memes de la comunidad');
  assert.equal(await a.locator('#memesNav').getAttribute('aria-current'),'page');
  assert((await a.locator('#imagenMeme').getAttribute('accept')).includes('.jpeg'));
  await a.locator('#crearMeme').waitFor({state:'visible'});
  await a.locator('#imagenMeme').setInputFiles({name:'meme.png',mimeType:'image/png',buffer:photo});
  await a.locator('#textoMeme').fill('Memoria de la comunidad');
  await a.getByRole('button',{name:'Publicar meme',exact:true}).click();
  await a.getByText('Meme publicado.',{exact:true}).waitFor();
  assert.equal(imageUploads,1);assert.equal(posts.at(-1).post_type,'meme');assert.equal(posts.at(-1).album_id,null);
  await a.locator('.imagen-meme').waitFor();assert.equal(await a.locator('.imagen-meme').getAttribute('alt'),'Meme publicado por @Ana');
  await a.locator('#inicioNav').click();await a.locator('#feedVacio').waitFor();
  await a.waitForFunction(()=>!document.querySelector('#feed').innerText.includes('Meme de @Ana'));
  assert.equal(await a.locator('.imagen-meme').count(),0,'memes stay out of the album feed');
  await a.locator('#memesNav').click();await a.locator('.imagen-meme').waitFor();
  assert.equal(await a.locator('#chatComunitario').isVisible(),true,'signed-in users can access community chat');assert.equal(await a.locator('#textoChat').getAttribute('autocomplete'),'off');assert.equal(await a.locator('#textoChat').getAttribute('spellcheck'),'false');assert.equal(await a.locator('#textoChatPrivado').getAttribute('autocomplete'),'off');assert.equal(await a.locator('#textoChatPrivado').getAttribute('spellcheck'),'false');await a.locator('#textoChat').fill('Hola desde el chat');await a.locator('#formularioChat').getByRole('button',{name:'Enviar',exact:true}).click();
  try{await a.locator('.mensaje-chat').filter({hasText:'Hola desde el chat'}).waitFor({timeout:5000});}catch{throw Error(engine.name()+' chat send failed: '+await a.locator('#estadoChat').innerText()+'; account: '+await a.locator('#nombrePerfil').innerText()+'; DOM: '+await a.locator('#mensajesChat').innerText()+'; errors: '+JSON.stringify(a.errors));}assert.equal(chatMessages.length,1);
  await a.reload();await a.locator('.mensaje-chat').filter({hasText:'Hola desde el chat'}).waitFor();
  assert.equal(await a.locator('#mensajesChat .mensaje-chat').count(),1);
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
  console.log(engine.name(),'PASS notifications/follows and profiles: public deep links, reload, author filter, pagination, owner controls, likes/comments, missing/empty profiles, navigation');
  await browser.close();console.log(engine.name(),'PASS shared UI using mock API: signup, album and separate meme page/feed, likes, comments, community chat, ownership UI, reload, mobile, no JS errors');
 }
 server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
