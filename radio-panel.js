(function () {
 const button = document.getElementById('abrirRadio');
 const panel = document.getElementById('panelRadio');
 const close = document.getElementById('cerrarRadio');
 const minimize = document.getElementById('minimizarRadio');
 const title = document.getElementById('tituloPanelRadio');
 let frame;
 function setOpen(open) {
  panel.hidden = !open;
  panel.classList.remove('minimizado');
  minimize.textContent = 'Minimizar';
  minimize.setAttribute('aria-label', 'Minimizar sin detener la radio');
  title.textContent = 'Radio RedMusica';
  button.setAttribute('aria-expanded', String(open));
  if (open && !frame) {
   frame = document.createElement('iframe');
   frame.title = 'Radio RedMusica: reproductor, búsqueda y cola';
   frame.src = 'radio.html?panel=1&v=20260927-9';
   frame.allow = 'autoplay; fullscreen';
   panel.append(frame);
  }
  if (frame) frame.contentWindow.postMessage({type:open ? 'radio-open' : 'radio-pause'}, location.origin);
  (open ? close : button).focus();
 }
 function minimizePanel() {
  if (panel.hidden) return;
  panel.classList.add('minimizado');
  minimize.textContent = 'Abrir';
  minimize.setAttribute('aria-label', 'Expandir radio');
  title.textContent = 'Radio ♫';
  minimize.focus();
 }
 button.addEventListener('click', () => setOpen(panel.hidden || panel.classList.contains('minimizado')));
 minimize.addEventListener('click', () => panel.classList.contains('minimizado') ? setOpen(true) : minimizePanel());
 close.addEventListener('click', () => setOpen(false));
 document.addEventListener('keydown', e => { if(e.key==='Escape' && !panel.hidden && !panel.classList.contains('minimizado')) setOpen(false); });
 window.addEventListener('message', e => {
  if(frame && e.source===frame.contentWindow && e.origin===location.origin && e.data?.type==='radio-close') setOpen(false);
 });
})();

