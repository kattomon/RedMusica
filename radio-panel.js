(function () {
 const button = document.getElementById('abrirRadio');
 const panel = document.getElementById('panelRadio');
 const stop = document.getElementById('detenerRadio');
 const close = document.getElementById('cerrarRadio');
 const minimize = document.getElementById('minimizarRadio');
 const title = document.getElementById('tituloPanelRadio');
 const defaultTitle = title.textContent;
 let nowPlaying = '';
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
   frame.src = 'radio.html?panel=1&v=20260927-19';
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
  button.focus();
 }
 button.addEventListener('click', () => setOpen(panel.hidden || panel.classList.contains('minimizado')));
 minimize.addEventListener('click', () => panel.classList.contains('minimizado') ? setOpen(true) : minimizePanel());
 close.addEventListener('click', minimizePanel);
 stop.addEventListener('click', stopRadio);
 document.addEventListener('keydown', e => { if(e.key==='Escape' && !panel.hidden && !panel.classList.contains('minimizado')) minimizePanel(); });
 window.addEventListener('message', e => {
  if(frame && e.source===frame.contentWindow && e.origin===location.origin && e.data?.type==='radio-now-playing' && typeof e.data.title==='string') {
   nowPlaying=e.data.title.slice(0,80);
   title.textContent=panel.classList.contains('minimizado') ? '♫ '+nowPlaying : (nowPlaying ? '♫ '+nowPlaying : defaultTitle);
  }
  if(frame && e.source===frame.contentWindow && e.origin===location.origin && e.data?.type==='radio-close') minimizePanel();
 });
})();

