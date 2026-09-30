(function () {
 'use strict';
 const $ = id => document.getElementById(id);
 const embedded = window.parent !== window && new URLSearchParams(location.search).get('panel') === '1';
 if (embedded) document.body.classList.add('radio-embedded');
 const config = window.REDMUSICA_CONFIG;
 const db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
 let queue = [], offset = 0, session = null, player = null, loaded = null, joined = false, ready = false, updating = false;
 let busy = false, authRevision = 0, continuePlaying = false, panelActive = true, resumingFromBackground = false, userPaused = false;
 const omitted = new Set(), blockedVideos = new Set();
 let playingSong = null, playerFailure = false;
 let roomRevision = null, roomPaused = false;
 const volumeControl=$('radioVolumen'),volumeOutput=$('radioVolumenValor');
 function volumeKey(){return 'redmusica:radio-volume:v1:'+(session?.user?.id||'guest');}
 function savedVolume(){try{const value=Number(localStorage.getItem(volumeKey()));return Number.isFinite(value)&&value>=0&&value<=100?value:60;}catch{return 60;}}
 function applyVolume(){const value=Number(volumeControl.value);volumeOutput.value=value+'%';volumeOutput.textContent=value+'%';if(ready&&player){try{player.setVolume(value);if(value===0)player.mute();else player.unMute();}catch{}}}
 volumeControl.value=String(savedVolume());applyVolume();
 volumeControl.addEventListener('input',()=>{applyVolume();try{localStorage.setItem(volumeKey(),volumeControl.value);}catch{}});
 async function manage(action,data){
  const {data:auth}=await db.auth.getSession();if(!auth.session)throw Error('Inicia sesión.');
  const response=await fetch(config.supabaseUrl+'/functions/v1/admin',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey,Authorization:'Bearer '+auth.session.access_token},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
 }
 function playable() {
  const live=current();
  return live && !omitted.has(live.id) && !blockedVideos.has(live.video_id) ? live : null;
 }
 function upcoming() { return queue.find(s=>Date.parse(s.starts_at)>Date.now()+offset && Date.parse(s.ends_at)>Date.now()+offset && !omitted.has(s.id) && !blockedVideos.has(s.video_id)); }
 function announce(title,videoId=null) { if(embedded) window.parent.postMessage({type:'radio-now-playing',title,videoId:/^[A-Za-z0-9_-]{11}$/.test(videoId||'')?videoId:null},location.origin); }
 function reportPlayback(paused) { if(embedded) window.parent.postMessage({type:'radio-playback',paused:Boolean(paused)},location.origin); }
 function togglePlayback() {
  if(!ready || !joined) return;
  userPaused=!userPaused;
  if(userPaused){player.pauseVideo();$('radioPlayback').textContent='Pausada solo para ti. La sala sigue en vivo para las demás personas.';reportPlayback(true);return;}
  $('radioPlayback').textContent='Retomando la canción en vivo…';
  const song=playable();if(song)load(song,true);else advance();reportPlayback(false);
 }
 function updateScheduleStatus() {
  const next=upcoming();
  if(next) {
   const seconds=Math.max(0,Math.ceil((Date.parse(next.starts_at)-(Date.now()+offset))/1000));
   const minutes=Math.floor(seconds/60), remainder=seconds%60;
   $('radioProximo').textContent='Siguiente: '+decode(next.title)+' · comienza en '+(minutes ? minutes+' min ' : '')+remainder+' s';
  } else $('radioProximo').textContent=queue.length ? 'No hay otra canción programada todavía.' : 'La sala espera el próximo pedido.';
 }
 function advance() {
  if (!panelActive || document.hidden || !ready || playerFailure || roomPaused || userPaused) return;
  const song=playable();
  if(song) load(song,continuePlaying);
  else {
   player.stopVideo();
   $('radioEscuchando').textContent='Esperando el siguiente turno de la programación.';
   $('radioSaltar').hidden=true;
   $('radioPlayback').textContent=upcoming() ? 'La canción actual se omitió en tu reproductor. La siguiente empezará a su hora para mantener sincronizada la radio.' : 'No quedan canciones reproducibles. Pide otra versión u otra canción.';
  }
 }
 window.addEventListener('message', e => {
  if(embedded && e.source===window.parent && e.origin===location.origin && e.data?.type==='radio-stop') {
   panelActive=false;joined=false;continuePlaying=false;userPaused=false;if(ready)player.pauseVideo();
  }
  if(embedded && e.source===window.parent && e.origin===location.origin && e.data?.type==='radio-open') {panelActive=true;refresh();}
  if(embedded && e.source===window.parent && e.origin===location.origin && e.data?.type==='radio-toggle-playback') togglePlayback();
 });
 document.addEventListener('keydown', e => {
  if(embedded && e.key==='Escape') window.parent.postMessage({type:'radio-close'},location.origin);
 });
 const api = async body => {
  const { data:auth } = await db.auth.getSession();
  const response = await fetch(config.supabaseUrl + '/functions/v1/radio', {
   method:'POST',headers:{ 'Content-Type':'application/json',apikey:config.supabasePublishableKey,...(auth.session ? {Authorization:'Bearer '+auth.session.access_token} : {}) },
   body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo conectar con la radio.');
  return result;
 };
 function text(tag,value) { const el=document.createElement(tag);el.textContent=value;return el; }
 function decode(value) { const el=document.createElement('textarea');el.innerHTML=value;return el.value; }
 function current() { const now=Date.now()+offset;return queue.find(s=>Date.parse(s.starts_at)<=now && Date.parse(s.ends_at)>now); }
 function render(data) {
  queue=data.queue;offset=Date.parse(data.now)-Date.now();
  if(embedded && panelActive) window.parent.postMessage({type:'radio-state',state:{queue,now:data.now,paused:Boolean(data.paused)}},location.origin);
  const changed=roomRevision!==null && data.revision!==undefined && data.revision!==roomRevision;
  roomRevision=data.revision??roomRevision;roomPaused=Boolean(data.paused);
  if(changed){loaded=null;omitted.clear();continuePlaying=joined;}
  const active=current();
  $('radioActual').textContent=active ? decode(active.title)+' · '+(active.username ? 'Pedido por @'+active.username : 'Rotación de la comunidad') : 'La sala espera la próxima canción.';
  announce(active ? decode(active.title) : 'Esperando canciones',active?.video_id);
  updateScheduleStatus();
  $('radioCola').replaceChildren(...queue.map(s=>text('li',decode(s.title)+' — '+(s.username ? '@'+s.username : 'Rotación')+(s.id===active?.id ? ' · En la sala ahora' : ' · '+new Date(s.starts_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})))));
  queue.forEach((s,index)=>{
   if(session?.user?.id===s.user_id && Date.parse(s.starts_at)>Date.now()+offset){
    const cancel=text('button','Cancelar mi pedido');cancel.type='button';
    cancel.addEventListener('click',async()=>{cancel.disabled=true;try{await manage('cancel_request',{id:s.id});await refresh();}catch(e){$('radioEstado').textContent=e.message;cancel.disabled=false;}});
    $('radioCola').children[index].append(' ',cancel);
   }
  });
  $('radioColaEstado').textContent=queue.length ? 'La cola se actualiza automáticamente.' : 'Todavía no hay canciones. Haz el primer pedido.';
  if(roomPaused){loaded=null;if(ready)player.stopVideo();$('radioActual').textContent='Radio pausada por administración.';$('radioPlayback').textContent='La sala se reanudará cuando administración vuelva a activarla.';return;}
  if(joined&&ready&&active&&resumingFromBackground) { if(!userPaused&&!omitted.has(active.id)&&!blockedVideos.has(active.video_id)){if(loaded!==active.id)load(active,true);else player.playVideo();}resumingFromBackground=false; }
  else if (joined && ready && active && loaded!==active.id && !userPaused && !omitted.has(active.id) && !blockedVideos.has(active.video_id)) load(active,true);
  else if (joined && !loaded) advance();
 }
 function load(song, autoplay) {
  loaded=song.id;playingSong=song;
  $('radioEscuchando').textContent='En tu reproductor: '+decode(song.title);
  announce(decode(song.title),song.video_id);
  $('radioSaltar').hidden=false;
  const start=Math.max(0,Math.floor((Date.now()+offset-Date.parse(song.starts_at))/1000));
  const params={videoId:song.video_id,startSeconds:start};
  if (autoplay) player.loadVideoById(params); else player.cueVideoById(params);
 }
 async function refresh() {
  if (updating || document.hidden || !panelActive) return;
  updating=true;
  try { render(await api({action:'state'})); } catch(e) { $('radioColaEstado').textContent=e.message; } finally { updating=false; }
 }
 function next() {
  if(loaded) omitted.add(loaded);
  loaded=null;continuePlaying=true;
  updateScheduleStatus();
  advance();
  refresh();
 }
 function playbackError(event) {
  if(!loaded) return;
  const code=event?.data;
  if(![2,5,100,101,150].includes(code)) {
   playerFailure=true;continuePlaying=false;player.pauseVideo();
   $('radioPlayback').textContent=code===153 ? 'YouTube no pudo identificar el reproductor. Recarga la página; si continúa, revisa las extensiones de privacidad del navegador.' : 'El reproductor falló. Pulsa Volver a la canción de la sala para reintentar.';
   return;
  }
  if(playingSong) blockedVideos.add(playingSong.video_id);
  if(playingSong){$('radioOtraVersion').hidden=false;$('radioOtraVersion').dataset.query=decode(playingSong.title);}
  $('radioPlayback').textContent='YouTube no permite reproducir este video aquí. Se omitió solo en tu reproductor; continuaremos con la próxima canción cuando llegue su turno.';
  next();
 }
 $('radioSaltar').addEventListener('click',()=>{playerFailure=false;next();});
 $('radioOtraVersion').addEventListener('click',()=>{
  $('radioArtista').value='';$('radioCancion').value=$('radioOtraVersion').dataset.query.slice(0,80);$('radioCancion').focus();
  $('radioEstado').textContent='Ajusta el nombre si hace falta y pulsa Buscar en YouTube para elegir otra versión.';
 });
 $('radioEscuchar').addEventListener('click',()=>{
  joined=true;$('radioReproductor').hidden=false;
  if(roomPaused){$('radioPlayback').textContent='La radio está pausada por administración.';return;}
  if (ready) { playerFailure=false;userPaused=false;reportPlayback(false);const s=playable();if(s) load(s,true);else advance();return; }
  $('radioEscuchar').disabled=true;
  window.onYouTubeIframeAPIReady=()=>{
   player=new YT.Player('youtubePlayer',{width:'100%',height:'360',playerVars:{playsinline:1,origin:location.origin},events:{
    onReady:()=>{ready=true;applyVolume();$('radioEscuchar').disabled=false;$('radioEscuchar').textContent='Volver a la canción de la sala';const s=playable();if(s)load(s,false);reportPlayback(userPaused);},
    onStateChange:event=>{if(event.data===0 && loaded)next();else if(event.data===1)reportPlayback(false);else if(event.data===2)reportPlayback(true);},
    onAutoplayBlocked:()=>{$('radioPlayback').textContent='Tu navegador pide un toque: pulsa reproducir en el video.';},
    onError:playbackError
   }});
  };
  const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
  script.onerror=()=>{$('radioPlayback').textContent='No se pudo cargar YouTube. Recarga la página para volver a intentarlo.';};
  document.head.appendChild(script);
 });
 document.addEventListener('visibilitychange',()=>{ if(!document.hidden){resumingFromBackground=joined;refresh();} });
 $('radioBusqueda').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(!session){$('radioEstado').textContent='Inicia sesión desde Inicio para buscar canciones.';return;}
  const query=[$('radioArtista').value.trim(),$('radioCancion').value.trim()].filter(Boolean).join(' ');
  if(query.length<2){$('radioEstado').textContent='Escribe un artista o una canción.';return;}
  busy=true;$('radioBuscar').disabled=true;$('radioEstado').textContent='Buscando en YouTube…';$('radioResultados').replaceChildren();
  const revision=authRevision;
  try {
   const result=await api({action:'search',query});
   if(revision!==authRevision)return;
   $('radioEstado').textContent=result.songs.length ? 'Elige la versión que quieres escuchar.' : 'No encontramos videos reproducibles. Prueba otra canción o escribe menos palabras.';
   result.songs.forEach(song=>{
    const card=document.createElement('article');
    card.className='radio-video-card';
    if(song.thumbnail){
     const image=document.createElement('img');image.className='radio-video-thumbnail';image.src=song.thumbnail;image.alt='';image.loading='lazy';image.decoding='async';
     image.referrerPolicy='no-referrer';
     image.addEventListener('error',()=>image.remove(),{once:true});
     card.append(image);
    }
    const link=document.createElement('a');link.href='https://www.youtube.com/watch?v='+encodeURIComponent(song.video_id);link.target='_blank';link.rel='noopener';link.textContent=decode(song.title);
    const heading=document.createElement('h3');heading.append(link);
    const button=text('button','Agregar a la cola');button.type='button';
    button.addEventListener('click',async()=>{
     if(busy)return;busy=true;button.disabled=true;$('radioEstado').textContent='Agregando canción…';
     try{const data=await api({action:'request',video_id:song.video_id});render(data);$('radioEstado').textContent='Canción agregada a la cola compartida.';}
     catch(e){$('radioEstado').textContent=e.message;}
     finally{busy=false;button.disabled=false;}
    });
    card.append(heading,text('p',decode(song.channel)+' · '+Math.floor(song.duration/60)+':'+String(song.duration%60).padStart(2,'0')),button);$('radioResultados').append(card);
   });
  }catch(e){$('radioEstado').textContent=e.message;}finally{busy=false;$('radioBuscar').disabled=false;}
 });
 function updateSession(value){session=value;authRevision++;volumeControl.value=String(savedVolume());applyVolume();$('radioResultados').replaceChildren();$('radioSesion').textContent=session ? 'Ya puedes buscar y pedir canciones con tu cuenta.' : 'Puedes escuchar sin cuenta. Para pedir canciones, inicia sesión desde Inicio.';}
 db.auth.onAuthStateChange((_event,value)=>updateSession(value));
 db.auth.getSession().then(({data})=>updateSession(data.session));
 refresh();setInterval(refresh,15000);setInterval(updateScheduleStatus,1000);
})();
