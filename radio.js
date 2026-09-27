(function () {
 'use strict';
 const $ = id => document.getElementById(id);
 const embedded = window.parent !== window && new URLSearchParams(location.search).get('panel') === '1';
 if (embedded) document.body.classList.add('radio-embedded');
 const config = window.REDMUSICA_CONFIG;
 const db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
 let queue = [], offset = 0, session = null, player = null, loaded = null, joined = false, ready = false, updating = false;
 let busy = false, authRevision = 0, finished = null, continuePlaying = false, panelActive = true;
 window.addEventListener('message', e => {
  if(embedded && e.source===window.parent && e.origin===location.origin && e.data?.type==='radio-pause') {
   panelActive=false;continuePlaying=false;if(ready)player.pauseVideo();
  }
  if(embedded && e.source===window.parent && e.origin===location.origin && e.data?.type==='radio-open') {panelActive=true;refresh();}
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
  const active=current();
  $('radioActual').textContent=active ? decode(active.title)+' · '+(active.username ? 'Pedido por @'+active.username : 'Rotación de la comunidad') : 'La sala espera la próxima canción.';
  $('radioCola').replaceChildren(...queue.map(s=>text('li',decode(s.title)+' — '+(s.username ? '@'+s.username : 'Rotación')+(s.id===active?.id ? ' · En la sala ahora' : ' · '+new Date(s.starts_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})))));
  $('radioColaEstado').textContent=queue.length ? 'La cola se actualiza automáticamente.' : 'Todavía no hay canciones. Haz el primer pedido.';
  if (panelActive && joined && ready && !loaded && active && active.id!==finished && !document.hidden) load(active,continuePlaying);
 }
 function load(song, autoplay) {
  loaded=song.id;
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
  finished=loaded;loaded=null;continuePlaying=true;
  refresh();
 }
 $('radioEscuchar').addEventListener('click',()=>{
  joined=true;$('radioReproductor').hidden=false;
  if (ready) { const s=current();if(s) load(s,true);return; }
  $('radioEscuchar').disabled=true;
  window.onYouTubeIframeAPIReady=()=>{
   player=new YT.Player('youtubePlayer',{width:'100%',height:'360',playerVars:{playsinline:1,origin:location.origin},events:{
    onReady:()=>{ready=true;$('radioEscuchar').disabled=false;$('radioEscuchar').textContent='Volver a la canción de la sala';const s=current();if(s)load(s,false);},
    onStateChange:event=>{if(event.data===0)next();},
    onAutoplayBlocked:()=>{$('radioPlayback').textContent='Tu navegador pide un toque: pulsa reproducir en el video.';},
    onError:()=>{$('radioPlayback').textContent='YouTube no puede reproducir este video en tu dispositivo. La sala continuará con la próxima canción.';finished=loaded;loaded=null;continuePlaying=true;}
   }});
  };
  const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
  script.onerror=()=>{$('radioPlayback').textContent='No se pudo cargar YouTube. Recarga la página para volver a intentarlo.';};
  document.head.appendChild(script);
 });
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden && ready) { player.pauseVideo();continuePlaying=false; }
  else { refresh();if(joined)$('radioPlayback').textContent='Pulsa reproducir para continuar o vuelve a la canción de la sala.'; }
 });
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
 function updateSession(value){session=value;authRevision++;$('radioResultados').replaceChildren();$('radioSesion').textContent=session ? 'Ya puedes buscar y pedir canciones con tu cuenta.' : 'Puedes escuchar sin cuenta. Para pedir canciones, inicia sesión desde Inicio.';}
 db.auth.onAuthStateChange((_event,value)=>updateSession(value));
 db.auth.getSession().then(({data})=>updateSession(data.session));
 refresh();setInterval(refresh,15000);
})();
