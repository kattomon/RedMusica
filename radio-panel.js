(function () {
 const button = document.getElementById('abrirRadio');
 const panel = document.getElementById('panelRadio');
 const close = document.getElementById('cerrarRadio');
 let frame;
 function setOpen(open) {
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open && !frame) {
   frame = document.createElement('iframe');
   frame.title = 'Radio RedMusica: reproductor, búsqueda y cola';
   frame.src = 'radio.html?panel=1&v=20260927-5';
   frame.allow = 'autoplay; fullscreen';
   panel.append(frame);
  }
  if (frame) frame.contentWindow.postMessage({type:open ? 'radio-open' : 'radio-pause'}, location.origin);
  (open ? close : button).focus();
 }
 button.addEventListener('click', () => setOpen(panel.hidden));
 close.addEventListener('click', () => setOpen(false));
 document.addEventListener('keydown', e => { if(e.key==='Escape' && !panel.hidden) setOpen(false); });
 window.addEventListener('message', e => {
  if(frame && e.source===frame.contentWindow && e.origin===location.origin && e.data?.type==='radio-close') setOpen(false);
 });
})();

