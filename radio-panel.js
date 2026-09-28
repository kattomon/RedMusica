(function () {
 const button = document.getElementById('abrirRadio');
 const panel = document.getElementById('panelRadio');
 const stop = document.getElementById('detenerRadio');
 const close = document.getElementById('cerrarRadio');
 const minimize = document.getElementById('minimizarRadio');
 const toggle = document.getElementById('alternarRadio');
 const title = document.getElementById('tituloPanelRadio');
 const thumbnail = document.getElementById('miniaturaRadioPanel');
 const liveWidget = document.getElementById('radioEnVivo');
 if (liveWidget) initializeLiveWidget(liveWidget);
 const defaultTitle = title.textContent;
 let nowPlaying = '';
 let playbackPaused = false;
 let frame;
 const dragKey='redmusica:radio-panel-position:v1';
 function clampPosition(left,top){const rect=panel.getBoundingClientRect(),margin=8;return{left:Math.max(margin,Math.min(left,innerWidth-rect.width-margin)),top:Math.max(margin,Math.min(top,innerHeight-rect.height-margin))};}
 function savePosition(left,top){const p=clampPosition(left,top);panel.style.left=p.left+'px';panel.style.top=p.top+'px';panel.style.right='auto';try{localStorage.setItem(dragKey,JSON.stringify(p));}catch{}}
 try{const p=JSON.parse(localStorage.getItem(dragKey)||'null');if(Number.isFinite(p?.left)&&Number.isFinite(p?.top)){panel.style.left=p.left+'px';panel.style.top=p.top+'px';panel.style.right='auto';}}catch{}
 let drag=null;
 panel.querySelector('header').addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,input,a,select,textarea'))return;const rect=panel.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};event.currentTarget.setPointerCapture(event.pointerId);});
 panel.querySelector('header').addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const deltaX=event.clientX-drag.x,deltaY=event.clientY-drag.y;if(Math.abs(deltaX)+Math.abs(deltaY)>3)savePosition(drag.left+deltaX,drag.top+deltaY);});
 const finishDrag=event=>{if(drag?.id===event.pointerId)drag=null;};
 panel.querySelector('header').addEventListener('pointerup',finishDrag);
 panel.querySelector('header').addEventListener('pointercancel',finishDrag);
 window.addEventListener('resize',()=>{if(!panel.hidden&&!panel.style.right){const rect=panel.getBoundingClientRect();savePosition(rect.left,rect.top);}});
 function setOpen(open) {
  panel.hidden = !open;
  panel.classList.remove('minimizado');
  minimize.textContent = 'Minimizar';
  minimize.setAttribute('aria-label', 'Minimizar sin detener la radio');
  title.textContent = nowPlaying ? '♫ ' + nowPlaying : defaultTitle;
  button.setAttribute('aria-expanded', String(open));
  if (open && !frame) {
   frame = document.createElement('iframe');
   frame.title = 'Radio RedMusica: reproductor, búsqueda y cola';
   frame.src = 'radio.html?panel=1&v=20260928-23';
   frame.allow = 'autoplay; fullscreen';
   panel.append(frame);
  }
  if (frame && open) frame.contentWindow.postMessage({type:'radio-open'}, location.origin);
  (open ? minimize : button).focus();
 }
 function minimizePanel() {
  if (panel.hidden) return;
  panel.classList.add('minimizado');
  minimize.textContent = 'Abrir';
  minimize.setAttribute('aria-label', 'Expandir radio');
  title.textContent = nowPlaying ? '♫ ' + nowPlaying : 'Radio ♫';
  minimize.focus();
 }
 function stopRadio() {
  panel.hidden = true;
  panel.classList.remove('minimizado');
  button.setAttribute('aria-expanded', 'false');
  if (frame) frame.contentWindow.postMessage({type:'radio-stop'}, location.origin);
  playbackPaused=true;toggle.hidden=true;updateToggle();
  button.focus();
 }
 button.addEventListener('click', () => setOpen(panel.hidden || panel.classList.contains('minimizado')));
 minimize.addEventListener('click', () => panel.classList.contains('minimizado') ? setOpen(true) : minimizePanel());
 close.addEventListener('click', minimizePanel);
 stop.addEventListener('click', stopRadio);
 function updateToggle(){toggle.textContent=playbackPaused?'▶':'Ⅱ';toggle.setAttribute('aria-label',playbackPaused?'Reanudar radio solo para ti':'Pausar radio solo para ti');toggle.title=toggle.getAttribute('aria-label');}
 toggle.addEventListener('click',()=>{if(!frame)return;frame.contentWindow.postMessage({type:'radio-toggle-playback'},location.origin);});
 const liveButton = document.getElementById('abrirRadioDesdeEstado');
 if (liveButton) liveButton.addEventListener('click', () => setOpen(panel.hidden || panel.classList.contains('minimizado')));
 document.addEventListener('keydown', e => { if(e.key==='Escape' && !panel.hidden && !panel.classList.contains('minimizado')) minimizePanel(); });
 window.addEventListener('message', e => {
  if(frame && e.source===frame.contentWindow && e.origin===location.origin && e.data?.type==='radio-now-playing' && typeof e.data.title==='string') {
   nowPlaying=e.data.title.slice(0,80);
   if(typeof e.data.videoId==='string'&&/^[A-Za-z0-9_-]{11}$/.test(e.data.videoId)){thumbnail.src='https://i.ytimg.com/vi/'+e.data.videoId+'/mqdefault.jpg';thumbnail.alt='Miniatura de '+nowPlaying;thumbnail.hidden=false;thumbnail.onerror=()=>{thumbnail.hidden=true;thumbnail.removeAttribute('src');};}
   else{thumbnail.hidden=true;thumbnail.removeAttribute('src');thumbnail.alt='';}
   title.textContent=panel.classList.contains('minimizado') ? '♫ '+nowPlaying : (nowPlaying ? '♫ '+nowPlaying : defaultTitle);
  }
  if(frame && !panel.hidden && e.source===frame.contentWindow && e.origin===location.origin && e.data?.type==='radio-playback' && typeof e.data.paused==='boolean') {playbackPaused=e.data.paused;toggle.hidden=false;updateToggle();}
  if(frame && e.source===frame.contentWindow && e.origin===location.origin && e.data?.type==='radio-close') minimizePanel();
 });

 function initializeLiveWidget(widget) {
  const config = window.REDMUSICA_CONFIG;
  const status = document.getElementById('radioEstadoEnVivo');
  const statusText = document.getElementById('radioEstadoEnVivoTexto');
  const cover = document.getElementById('radioPortadaEnVivo');
  const currentTitle = document.getElementById('radioTituloEnVivo');
  const currentDetail = document.getElementById('radioDetalleEnVivo');
  const nextTitle = document.getElementById('radioSiguienteEnVivo');
  const countdown = document.getElementById('radioCuentaAtrasEnVivo');
  let serverOffset = 0, deadline = 0, tick;
  const setStatus = (name, label) => { status.dataset.status = name; statusText.textContent = label; };
  const formatTime = seconds => {
   const value = Math.max(0, Math.floor(seconds));
   return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
  };
  function renderCountdown() {
   if (!deadline) { countdown.textContent = ''; return; }
   const left = Math.max(0, Math.ceil((deadline - (Date.now() + serverOffset)) / 1000));
   countdown.textContent = deadlineLabel === 'start' ? `Empieza en ${formatTime(left)}` : `Termina en ${formatTime(left)}`;
  }
  let deadlineLabel = 'end';
  function render(state) {
   if (!state || !Array.isArray(state.queue)) throw new Error('Estado de radio incorrecto');
   const serverNow = Date.parse(state.now) || Date.now();
   serverOffset = serverNow - Date.now();
   const now = serverNow;
   const active = state.queue.find(song => Date.parse(song.starts_at) <= now && Date.parse(song.ends_at) > now);
   const upcoming = state.queue.find(song => Date.parse(song.starts_at) > now);
   const song = active || upcoming;
   if (!song) {
    setStatus('idle', 'Esperando pedidos'); currentTitle.textContent = 'Todavía no hay canciones en la cola';
    currentDetail.textContent = ''; nextTitle.textContent = '—'; deadline = 0; cover.hidden = true; cover.removeAttribute('src'); renderCountdown(); return;
   }
   currentTitle.textContent = song.title || 'Canción de la comunidad';
   currentDetail.textContent = song.username ? `Pedido por @${song.username}` : 'Pedido de la comunidad';
   const videoId = String(song.video_id || '');
   if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    cover.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    cover.alt = `Miniatura de ${song.title || 'la canción actual'}`;
    cover.hidden = false;
    cover.onerror = () => { cover.hidden = true; cover.removeAttribute('src'); };
   } else { cover.hidden = true; cover.removeAttribute('src'); }
   if (active) {
    setStatus(state.paused ? 'paused' : 'live', state.paused ? 'Pausada' : 'En vivo');
    document.getElementById('radioEtiquetaEnVivo').textContent = 'Sonando ahora';
    deadline = Date.parse(active.ends_at); deadlineLabel = 'end';
   } else {
    setStatus('loading', 'Preparando');
    document.getElementById('radioEtiquetaEnVivo').textContent = 'Siguiente canción';
    deadline = Date.parse(upcoming.starts_at); deadlineLabel = 'start';
   }
   if (upcoming && active) nextTitle.textContent = upcoming.title || 'Siguiente canción';
   else nextTitle.textContent = active ? 'En rotación' : '—';
   renderCountdown();
  }
  async function refresh() {
   if (!navigator.onLine) { setStatus('offline', 'Sin conexión'); return; }
   if (document.visibilityState === 'hidden') return;
   try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/radio`, {
     method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey },
     body: JSON.stringify({ action: 'state' }), cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
   } catch {
    setStatus('offline', 'Reconectando');
    if (!currentTitle.textContent || currentTitle.textContent === 'Consultando programación…') currentTitle.textContent = 'No se pudo consultar la radio';
   }
  }
  refresh();
  tick = window.setInterval(renderCountdown, 1000);
  window.setInterval(refresh, 25000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('online', refresh);
 }
})();

