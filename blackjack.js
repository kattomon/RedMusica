(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const section=$('seccionBlackjack');
 if(!section)return;
 const config=window.REDMUSICA_CONFIG;
 let db=null,user=null,roomCode='',room=null,busy=false,poll=null;
 const playerSeats=new Map();
 const suitsRed=new Set(['♥','♦']);
 if(config&&window.supabase)db=window.redmusicaClient||window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey);
 function status(message){$('estadoBlackjack').textContent=message;}
 function labelState(value){return ({lobby:'Esperando jugadores',playing:'Ronda en curso',finished:'Ronda terminada',waiting:'Esperando la próxima ronda',stood:'Se plantó',bust:'Se pasó',won:'Ganó',lost:'Perdió',push:'Empató'})[value]||value||'';}
 function handValue(hand){let total=0,aces=0;for(const card of hand||[]){if(card.hidden)continue;if(card.rank==='A'){total+=11;aces++;}else total+=['J','Q','K'].includes(card.rank)?10:Number(card.rank);}while(total>21&&aces){total-=10;aces--;}return total;}
 function makeCard(card){const el=document.createElement('span');el.className='blackjack-carta';el.dataset.cardKey=card.hidden?'hidden':card.rank+card.suit;if(card.hidden){el.classList.add('oculta');el.textContent='RM';el.setAttribute('aria-label','Carta boca abajo');return el;}if(suitsRed.has(card.suit))el.classList.add('roja');el.setAttribute('aria-label',card.rank+' de '+({ '♠':'picas','♥':'corazones','♦':'diamantes','♣':'tréboles'}[card.suit]));const corner=document.createElement('span');corner.className='blackjack-esquina';corner.textContent=card.rank;const face=document.createElement('span');face.className='blackjack-figura';face.textContent=card.suit;el.append(corner,face);return el;}
 function renderHand(container,hand){const cards=hand||[],old=[...container.children],next=cards.map((card,index)=>old[index]?.dataset.cardKey===(card.hidden?'hidden':card.rank+card.suit)?old[index]:makeCard(card));if(old.length!==next.length||next.some((card,index)=>card!==old[index]))container.replaceChildren(...next);}
 function createPlayerSeat(){
  const item=document.createElement('li');item.className='blackjack-jugador blackjack-asiento';
  const header=document.createElement('div');header.className='blackjack-asiento-cabecera';
  const name=document.createElement('strong');name.className='blackjack-nombre-jugador';
  const turn=document.createElement('span');turn.className='blackjack-turno';turn.textContent='Tu turno';turn.hidden=true;header.append(name,turn);
  const details=document.createElement('div');details.className='blackjack-fichas-jugador';
  const chips=document.createElement('span');chips.className='blackjack-pila-fichas';chips.setAttribute('aria-hidden','true');chips.textContent='◉';
  const balance=document.createElement('span');details.append(chips,balance);
  const hand=document.createElement('div');hand.className='blackjack-mano';
  const cards=document.createElement('div');cards.className='blackjack-cartas';
  const total=document.createElement('span');total.className='blackjack-total-jugador';hand.append(cards,total);
  const result=document.createElement('span');result.className='blackjack-resultado-jugador';
  item.append(header,details,hand,result);return {item,name,turn,balance,hand,cards,total,result};
 }
 function setButton(button,visible,disabled){button.hidden=!visible;button.disabled=Boolean(disabled);}
 function render(data){
  room=data.room||null;
  if(!room){leaveView();return;}
  roomCode=room.code;$('blackjackEntrada').hidden=true;$('blackjackMesa').hidden=false;$('blackjackCodigo').textContent=roomCode;
  $('blackjackEstadoSala').textContent=room.status==='lobby'?'Comparte el código y espera a que se sumen tus amigos.':room.status==='playing'?'Los turnos se comparten con todos en la mesa.':'La mesa sigue abierta; quien la creó puede repartir otra ronda.';
  const players=room.players||[];
  const roster=$('blackjackJugadores');roster.replaceChildren(...players.map(player=>{
   let seat=playerSeats.get(player.user_id);if(!seat){seat=createPlayerSeat();playerSeats.set(player.user_id,seat);}
   seat.item.classList.toggle('es-mi-turno',player.user_id===room.current_player_id);
   seat.item.classList.toggle('se-paso',player.status==='bust');
   seat.name.textContent='@'+player.username+(player.user_id===user?.id?' (tú)':'');
   seat.turn.hidden=player.user_id!==room.current_player_id;
   seat.balance.textContent=player.chips+' fichas · '+labelState(player.status);
   seat.hand.hidden=room.status==='lobby'||!player.hand?.length;
   if(!seat.hand.hidden){renderHand(seat.cards,player.hand);seat.total.textContent='Total: '+handValue(player.hand);}
   seat.result.hidden=!player.result;seat.result.textContent=player.result||'';
   return seat.item;
  }));
  for(const id of playerSeats.keys())if(!players.some(player=>player.user_id===id))playerSeats.delete(id);
  const board=$('blackjackTablero');board.hidden=false;board.classList.toggle('ronda-en-curso',room.status==='playing');board.classList.toggle('ronda-terminada',room.status==='finished');
  renderHand($('manoCrupierBlackjack'),room.dealer?.hand||[]);
  $('totalCrupierBlackjack').textContent=room.dealer?.hidden?'Carta oculta hasta que termine la ronda.':(room.dealer?.hand?.length?'Total: '+handValue(room.dealer.hand):'El bot espera para repartir.');
  const current=players.find(player=>player.user_id===room.current_player_id);
  $('estadoCrupierBlackjack').textContent=room.status==='lobby'?'¿Listos para jugar?':room.status==='playing'?(current?.user_id===user?.id?'El crupier espera tu jugada.':'Ahora juega @'+(current?.username||'otro jugador')+'.'):room.result||'Ronda terminada.';
  $('resultadoBlackjack').textContent=room.result||'';
  const own=players.find(p=>p.user_id===user?.id),host=room.host_id===user?.id,turn=room.current_player_id===user?.id&&own?.status==='playing';
  setButton($('iniciarRondaBlackjack'),host&&['lobby','finished'].includes(room.status),!players.some(p=>p.chips>=100));
  setButton($('pedirCartaBlackjack'),room.status==='playing'&&turn,false);setButton($('plantarseBlackjack'),room.status==='playing'&&turn,false);
  $('salirSalaBlackjack').disabled=room.status==='playing';
  status(room.status==='playing'?(turn?'Es tu turno.':'Turno de @'+(current?.username||'otro jugador')+'.'):room.status==='lobby'?'Sala lista para jugar a solas o invitar hasta cinco personas.':'Partida actualizada. Puedes repartir otra ronda.');
 }
 function leaveView(){room=null;roomCode='';$('blackjackEntrada').hidden=false;$('blackjackMesa').hidden=true;clearInterval(poll);poll=null;}
 async function request(action,code=roomCode){
  if(!db)throw new Error('No se pudo iniciar el juego. Recarga la página.');
  const {data:{session}}=await db.auth.getSession();
  if(!session)throw new Error('Inicia sesión para jugar al blackjack.');
  const response=await fetch(config.supabaseUrl+'/functions/v1/blackjack',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,code}),signal:AbortSignal.timeout(12000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'No se pudo actualizar la mesa.');return result;
 }
 async function run(action,code){if(busy)return;busy=true;status('Un momento…');try{const result=await request(action,code);if(result.left){leaveView();history.replaceState(null,'','?seccion=blackjack');status('Saliste de la mesa. Puedes crear o unirte a otra.');}else{render(result);if(!poll)poll=setInterval(refresh,5000);const url=new URL(location.href);url.searchParams.set('seccion','blackjack');url.searchParams.set('sala',roomCode);history.replaceState(null,'',url);}}catch(error){status(error.message);}finally{busy=false;}}
 async function refresh(){if(!roomCode||busy||document.hidden)return;try{render(await request('state'));}catch(error){status(error.message);if(/No encontramos esa sala/.test(error.message))leaveView();}}
 $('crearSalaBlackjack').addEventListener('click',()=>run('create',''));
 $('unirseSalaBlackjack').addEventListener('submit',event=>{event.preventDefault();run('join',$('codigoSalaBlackjack').value.trim().toUpperCase());});
 $('iniciarRondaBlackjack').addEventListener('click',()=>run('start'));
 $('pedirCartaBlackjack').addEventListener('click',()=>run('hit'));
 $('plantarseBlackjack').addEventListener('click',()=>run('stand'));
 $('salirSalaBlackjack').addEventListener('click',()=>run('leave'));
 $('compartirSalaBlackjack').addEventListener('click',async()=>{const url=new URL(location.href);url.searchParams.set('seccion','blackjack');url.searchParams.set('sala',roomCode);try{await navigator.clipboard.writeText(url.href);status('Enlace de invitación copiado.');}catch{status('Comparte este código: '+roomCode);}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&roomCode)refresh();});
 if(db)db.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;$('blackjackAcceso').hidden=Boolean(user);if(!user&&roomCode){leaveView();status('Inicia sesión desde Inicio para volver a jugar.');}});
 (async()=>{if(!db){status('El juego requiere una cuenta de RedMusica.');return;}const {data:{session}}=await db.auth.getSession();user=session?.user||null;$('blackjackAcceso').hidden=Boolean(user);if(!user){status('Inicia sesión desde Inicio para crear una sala o unirte con un código.');return;}const invited=new URLSearchParams(location.search).get('sala');if(invited&&/^[A-Z0-9]{6}$/i.test(invited))await run('join',invited.toUpperCase());})();
})();
