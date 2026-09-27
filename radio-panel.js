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

