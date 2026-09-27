(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const section=$('seccionBlackjack');
 if(!section)return;
 const config=window.REDMUSICA_CONFIG;
 let db=null,user=null,roomCode='',room=null,busy=false,poll=null;
 const suitsRed=new Set(['♥','♦']);
 if(config&&window.supabase)db=window.redmusicaClient||window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey);
 function status(message){$('estadoBlackjack').textContent=message;}
 function labelState(value){return ({lobby:'Esperando jugadores',playing:'Ronda en curso',finished:'Ronda terminada',waiting:'Esperando la próxima ronda',stood:'Se plantó',bust:'Se pasó',won:'Ganó',lost:'Perdió',push:'Empató'})[value]||value||'';}
 function handValue(hand){let total=0,aces=0;for(const card of hand||[]){if(card.hidden)continue;if(card.rank==='A'){total+=11;aces++;}else total+=['J','Q','K'].includes(card.rank)?10:Number(card.rank);}while(total>21&&aces){total-=10;aces--;}return total;}
 function makeCard(card){const el=document.createElement('span');el.className='blackjack-carta';if(card.hidden){el.classList.add('oculta');el.textContent='RM';el.setAttribute('aria-label','Carta boca abajo');return el;}el.textContent=card.rank+card.suit;if(suitsRed.has(card.suit))el.classList.add('roja');el.setAttribute('aria-label',card.rank+' de '+({ '♠':'picas','♥':'corazones','♦':'diamantes','♣':'tréboles'}[card.suit]));return el;}
 function renderHand(container,hand){container.replaceChildren(...(hand||[]).map(makeCard));}
 function setButton(button,visible,disabled){button.hidden=!visible;button.disabled=Boolean(disabled);}
 function render(data){
  room=data.room||null;
  if(!room){leaveView();return;}
  roomCode=room.code;$('blackjackEntrada').hidden=true;$('blackjackMesa').hidden=false;$('blackjackCodigo').textContent=roomCode;
  $('blackjackEstadoSala').textContent=room.status==='lobby'?'Comparte el código: cuando estén listos, quien creó la sala puede repartir.':room.status==='playing'?'Los turnos se comparten con todos en la mesa.':'La mesa sigue abierta; quien la creó puede repartir otra ronda.';
  const players=room.players||[];
  $('blackjackJugadores').replaceChildren(...players.map(player=>{
   const item=document.createElement('li');item.className='blackjack-jugador';
   const name=document.createElement('strong');name.textContent='@'+player.username+(player.user_id===user?.id?' (tú)':'');item.append(name);
   const details=document.createElement('span');details.textContent=player.chips+' fichas · '+labelState(player.status);item.append(' ',details);
   if(player.user_id===room.current_player_id){item.classList.add('es-mi-turno');const turn=document.createElement('span');turn.className='blackjack-turno';turn.textContent='Turno';item.append(' ',turn);}
   if(room.status!=='lobby'&&player.hand?.length){const hand=document.createElement('div');hand.className='blackjack-mano';renderHand(hand,player.hand);const total=document.createElement('span');total.textContent='Total: '+handValue(player.hand);hand.append(total);item.append(hand);}
   if(player.result){const result=document.createElement('span');result.className='blackjack-resultado-jugador';result.textContent=player.result;item.append(' ',result);}
   return item;
  }));
  const board=$('blackjackTablero');board.hidden=room.status==='lobby';
  if(!board.hidden){
   renderHand($('manoCrupierBlackjack'),room.dealer?.hand||[]);
   $('totalCrupierBlackjack').textContent=room.dealer?.hidden?'Carta oculta hasta que termine la ronda.':(room.dealer?.hand?.length?'Total: '+handValue(room.dealer.hand):'');
   const hands=$('blackjackManos');hands.replaceChildren();
  }
  $('resultadoBlackjack').textContent=room.result||'';
  const own=players.find(p=>p.user_id===user?.id),host=room.host_id===user?.id,turn=room.current_player_id===user?.id&&own?.status==='playing';
  setButton($('iniciarRondaBlackjack'),host&&['lobby','finished'].includes(room.status),!players.some(p=>p.chips>=100));
  setButton($('pedirCartaBlackjack'),room.status==='playing'&&turn,false);setButton($('plantarseBlackjack'),room.status==='playing'&&turn,false);
  $('salirSalaBlackjack').disabled=room.status==='playing';
  status(room.status==='playing'?(turn?'Es tu turno.':'Turno de @'+(players.find(p=>p.user_id===room.current_player_id)?.username||'otro jugador')+'.'):room.status==='lobby'?'La sala está lista para recibir hasta seis jugadores.':'Partida compartida y actualizada.');
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
