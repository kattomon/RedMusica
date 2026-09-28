(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const section=$('seccionBlackjack');
 if(!section)return;
 const config=window.REDMUSICA_CONFIG;
 let db=null,user=null,roomCode='',room=null,busy=false,poll=null;
 const playerSeats=new Map();let lastAnimationKey='',seatSequence=0;
 const suitsRed=new Set(['♥','♦']);
 const chatLog=$('blackjackChatMensajes'),chatInput=$('blackjackChatTexto'),chatForm=$('blackjackChatFormulario');
 const memoryKey=()=>user?.id?'redmusica:blackjack-dealer:v1:'+user.id:null;
 function readMemory(){try{const raw=memoryKey()&&localStorage.getItem(memoryKey());const parsed=raw?JSON.parse(raw):null;return parsed&&Array.isArray(parsed.messages)?parsed:{messages:[],likes:[],dislikes:[]};}catch{return {messages:[],likes:[],dislikes:[]};}}
 function saveMemory(memory){try{if(memoryKey())localStorage.setItem(memoryKey(),JSON.stringify({...memory,messages:memory.messages.slice(-20),likes:memory.likes.slice(-12),dislikes:memory.dislikes.slice(-12)}));}catch{status('El almacenamiento local está lleno. Borra la memoria del crupier para liberar espacio.');}}
 function paintDealerChat(){if(!chatLog)return;const memory=readMemory();chatLog.replaceChildren();if(!user){const p=document.createElement('p');p.className='blackjack-chat-vacio';p.textContent='Inicia sesión para conversar con el crupier.';chatLog.append(p);return;}if(!memory.messages.length){const p=document.createElement('p');p.className='blackjack-chat-vacio';p.textContent='¡Buenas! Soy el crupier. Cuéntame qué música te gusta o pregúntame por las reglas.';chatLog.append(p);return;}for(const message of memory.messages){const item=document.createElement('p');item.className='blackjack-chat-mensaje '+(message.from==='you'?'es-tuyo':'es-crupier');item.textContent=message.text;chatLog.append(item);}chatLog.scrollTop=chatLog.scrollHeight;}
 function dealerReply(text,memory){const lower=text.toLocaleLowerCase('es');const dislike=lower.match(/(?:no me gusta|no me gustan|odio|detesto|no soporto)\s+(.{2,80})/i);const like=lower.match(/(?:me gusta|me gustan|me encanta|me encantan|prefiero|mi favorito(?:a)? es|mi artista favorito es)\s+(.{2,80})/i);if(dislike){const item=dislike[1].replace(/[.!?]+$/,'').trim();if(item&&!memory.dislikes.some(x=>x.toLowerCase()===item.toLowerCase()))memory.dislikes.push(item);return 'Anotado: '+item+' no es lo tuyo. Lo recordaré en este navegador.';}if(like){const item=like[1].replace(/[.!?]+$/,'').trim();if(item&&!memory.likes.some(x=>x.toLowerCase()===item.toLowerCase()))memory.likes.push(item);return '¡Me lo guardo! Tendré presente que te gusta '+item+'. ¿Qué más escuchas?';}if(/qué recuerdas|que recuerdas|qué sabes de mí|que sabes de mi/.test(lower)){if(!memory.likes.length&&!memory.dislikes.length)return 'Todavía no conozco tus gustos. Cuéntame qué artistas, discos o estilos te gustan.';return 'Recuerdo que te gusta'+(memory.likes.length===1?'':'n')+' '+memory.likes.join(', ')+(memory.dislikes.length?'; y que prefieres evitar '+memory.dislikes.join(', '):'')+'.';}if(/reglas|cómo se juega|como se juega|blackjack|veintiuno/.test(lower))return 'La meta es acercarte a 21 sin pasarte. Las figuras valen 10, el as vale 1 u 11; en tu turno puedes pedir carta o plantarte.';if(/hola|buenas|hey|qué tal|que tal/.test(lower))return '¡Buenas! ¿Qué música te acompaña hoy? También puedes preguntarme por las reglas del blackjack.';if(/recomiend|qué escucho|que escucho/.test(lower)&&memory.likes.length)return 'Como te gusta '+memory.likes.slice(-3).join(', ')+', podrías explorar artistas o discos relacionados. ¿Cuál de esos gustos quieres seguir?';if(/recomiend|qué escucho|que escucho/.test(lower))return 'Todavía no tengo suficientes pistas. Dime qué artista o disco te gusta y pensaré contigo.';return 'Te leo. Si me cuentas qué artistas, discos o estilos te gustan, los recordaré para esta mesa.';}
 function sendDealerMessage(text){const memory=readMemory(),clean=text.trim();if(!clean)return;memory.messages.push({from:'you',text:clean});memory.messages.push({from:'dealer',text:dealerReply(clean,memory)});saveMemory(memory);paintDealerChat();}
 if(config&&window.supabase)db=window.redmusicaClient||window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey);
 function status(message){$('estadoBlackjack').textContent=message;}
 function labelState(value){return ({lobby:'Esperando jugadores',playing:'Ronda en curso',finished:'Ronda terminada',waiting:'Esperando la próxima ronda',stood:'Se plantó',bust:'Se pasó',won:'Ganó',lost:'Perdió',push:'Empató'})[value]||value||'';}
 function validWagerAmount(value){const amount=Number(value);return Number.isFinite(amount)&&amount>=0.01&&Math.abs(amount*100-Math.round(amount*100))<1e-7;}
 function formatChips(value){return Number(Number(value).toFixed(2)).toString().replace('.',',');}
 function handValue(hand){let total=0,aces=0;for(const card of hand||[]){if(card.hidden)continue;if(card.rank==='A'){total+=11;aces++;}else total+=['J','Q','K'].includes(card.rank)?10:Number(card.rank);}while(total>21&&aces){total-=10;aces--;}return total;}
 function makeCard(card,index=0){const el=document.createElement('span');el.className='blackjack-carta';el.dataset.cardKey=card.hidden?'hidden':card.rank+card.suit;el.style.setProperty('--orden-reparto',index);if(card.hidden){el.classList.add('oculta');el.textContent='RM';el.setAttribute('aria-label','Carta boca abajo');return el;}if(suitsRed.has(card.suit))el.classList.add('roja');el.dataset.rank=card.rank;el.dataset.suit=card.suit;el.setAttribute('aria-label',card.rank+' de '+({ '♠':'picas','♥':'corazones','♦':'diamantes','♣':'tréboles'}[card.suit]));const corner=document.createElement('span');corner.className='blackjack-esquina';const value=document.createElement('b');value.textContent=card.rank;const symbol=document.createElement('i');symbol.textContent=card.suit;corner.append(value,symbol);const art=document.createElement('span');art.className='blackjack-arte-carta';if(['J','Q','K'].includes(card.rank)){art.classList.add('figura');const portrait=document.createElement('span');portrait.className='blackjack-retrato';portrait.textContent=card.rank;const portraitSuit=document.createElement('i');portraitSuit.textContent=card.suit;art.append(portrait,portraitSuit);}else{const count=card.rank==='A'?1:Number(card.rank);for(let pip=0;pip<count;pip++){const mark=document.createElement('i');mark.textContent=card.suit;art.append(mark);}}el.append(corner,art);return el;}
 function renderHand(container,hand){const cards=hand||[],old=[...container.children],next=cards.map((card,index)=>{const key=card.hidden?'hidden':card.rank+card.suit;if(old[index]?.dataset.cardKey===key)return old[index];const created=makeCard(card,index);if(old[index]?.classList.contains('oculta')&&!card.hidden)created.classList.add('revelada');return created;});if(old.length!==next.length||next.some((card,index)=>card!==old[index]))container.replaceChildren(...next);}
 function createPlayerSeat(){
  const item=document.createElement('li');item.className='blackjack-jugador blackjack-asiento';
  const header=document.createElement('div');header.className='blackjack-asiento-cabecera';
  const name=document.createElement('strong');name.className='blackjack-nombre-jugador';
  const turn=document.createElement('span');turn.className='blackjack-turno';turn.textContent='Tu turno';turn.hidden=true;
  const ready=document.createElement('span');ready.className='blackjack-listo';ready.hidden=true;
  const readyButton=document.createElement('button');readyButton.type='button';readyButton.className='blackjack-marcar-listo';readyButton.hidden=true;readyButton.addEventListener('click',()=>run('ready',roomCode,readyButton.dataset.ready!=='true'));
  header.append(name,turn,ready,readyButton);
  const details=document.createElement('div');details.className='blackjack-fichas-jugador';
  const chips=document.createElement('span');chips.className='blackjack-pila-fichas';chips.setAttribute('aria-hidden','true');for(let i=0;i<3;i++){const chip=document.createElement('i');chips.append(chip);}
  const balance=document.createElement('span');details.append(chips,balance);
  const hand=document.createElement('div');hand.className='blackjack-mano';
  const cards=document.createElement('div');cards.className='blackjack-cartas';
  const total=document.createElement('span');total.className='blackjack-total-jugador';hand.append(cards,total);
  const result=document.createElement('span');result.className='blackjack-resultado-jugador';
  const wagerBox=document.createElement('div');wagerBox.className='blackjack-apuesta-personal';
  const wagerLabel=document.createElement('label');wagerLabel.htmlFor='blackjack-apuesta-'+(++seatSequence);wagerLabel.textContent='Tu apuesta';
  const wagerInput=document.createElement('input');wagerInput.id=wagerLabel.htmlFor;wagerInput.type='number';wagerInput.min='0.01';wagerInput.step='0.01';wagerInput.inputMode='decimal';wagerInput.autocomplete='off';wagerInput.setAttribute('aria-label','Tu apuesta en fichas');
  const wagerButton=document.createElement('button');wagerButton.type='button';wagerButton.textContent='Guardar apuesta';wagerButton.addEventListener('click',()=>{if(!wagerInput.reportValidity())return;run('set_bet',roomCode,undefined,Number(wagerInput.value));});
  wagerInput.addEventListener('input',()=>{wagerButton.disabled=!wagerInput.validity.valid||Number(wagerInput.value)===Number(wagerInput.dataset.savedWager);readyButton.disabled=readyButton.dataset.ready!=='true'&&(!wagerInput.validity.valid||Number(wagerInput.value)!==Number(wagerInput.dataset.savedWager));});
  wagerBox.append(wagerLabel,wagerInput,wagerButton);
  item.append(header,details,wagerBox,hand,result);return {item,name,turn,ready,readyButton,balance,hand,cards,total,result,wagerBox,wagerLabel,wagerInput,wagerButton};
 }
 function setButton(button,visible,disabled){button.hidden=!visible;button.disabled=Boolean(disabled);}
 function render(data){
  room=data.room||null;
  if(!room){leaveView();return;}
  roomCode=room.code;$('blackjackEntrada').hidden=true;$('blackjackMesa').hidden=false;$('blackjackCodigo').textContent=roomCode;
  $('blackjackEstadoSala').textContent=room.status==='lobby'?'Elige tu apuesta y marca «Estoy listo». Quien creó la sala reparte cuando todos confirmen.':room.status==='playing'?'Los turnos se comparten con todos en la mesa.':'Elige una apuesta para la próxima ronda y vuelve a marcar «Estoy listo».';
  const players=room.players||[];
  const roster=$('blackjackJugadores'),seatIds=new Set();players.forEach((player,index)=>{
   let seat=playerSeats.get(player.user_id);if(!seat){seat=createPlayerSeat();playerSeats.set(player.user_id,seat);}
   seatIds.add(player.user_id);
   const atPosition=roster.children[index];if(seat.item.parentElement!==roster)roster.insertBefore(seat.item,atPosition||null);else if(atPosition!==seat.item)roster.insertBefore(seat.item,atPosition||null);
   seat.item.classList.toggle('es-mi-turno',player.user_id===room.current_player_id);
   seat.item.classList.toggle('se-paso',player.status==='bust');
   seat.name.textContent='@'+player.username+(player.user_id===user?.id?' (tú)':'');
   seat.turn.hidden=player.user_id!==room.current_player_id;
   seat.ready.hidden=!['lobby','finished'].includes(room.status);seat.ready.textContent=player.ready?'✓ Listo':'Esperando';seat.ready.classList.toggle('confirmado',Boolean(player.ready));
   const wager=player.wager??Math.min(100,player.chips);
   seat.wagerBox.hidden=player.user_id!==user?.id||!['lobby','finished'].includes(room.status);
   seat.wagerInput.max=String(player.chips);seat.wagerLabel.textContent='Tu apuesta (0,01–'+formatChips(player.chips)+')';
   if(seat.wagerInput.dataset.savedWager!==String(wager)&&document.activeElement!==seat.wagerInput)seat.wagerInput.value=String(wager);
   seat.wagerInput.dataset.savedWager=String(wager);seat.wagerButton.disabled=!['lobby','finished'].includes(room.status)||player.chips<1||Number(seat.wagerInput.value)===wager;
   seat.readyButton.hidden=!['lobby','finished'].includes(room.status)||player.user_id!==user?.id;seat.readyButton.dataset.ready=String(Boolean(player.ready));seat.readyButton.textContent=player.ready?'Quitar listo':'Estoy listo';seat.readyButton.disabled=!player.ready&&(!validWagerAmount(wager)||wager>player.chips||!seat.wagerInput.validity.valid||Number(seat.wagerInput.value)!==wager);
   seat.balance.textContent=formatChips(player.chips)+' fichas · '+labelState(player.status)+(room.status==='playing'&&player.bet?' · Apostó '+formatChips(player.bet):'');
   seat.hand.hidden=room.status==='lobby'||!player.hand?.length;
   if(!seat.hand.hidden){renderHand(seat.cards,player.hand);seat.total.textContent='Total: '+handValue(player.hand);}
   seat.result.hidden=!player.result;seat.result.textContent=player.result||'';
  });
  for(const [id,seat] of playerSeats)if(!seatIds.has(id)){seat.item.remove();playerSeats.delete(id);}
  const board=$('blackjackTablero');board.hidden=false;board.classList.toggle('ronda-en-curso',room.status==='playing');board.classList.toggle('ronda-terminada',room.status==='finished');
  renderHand($('manoCrupierBlackjack'),room.dealer?.hand||[]);
  $('totalCrupierBlackjack').textContent=room.dealer?.hidden?'Carta oculta hasta que termine la ronda.':(room.dealer?.hand?.length?'Total: '+handValue(room.dealer.hand):'El bot espera para repartir.');
  const current=players.find(player=>player.user_id===room.current_player_id);
  const animationKey=[room.status,room.current_player_id,JSON.stringify(room.dealer?.hand||[]),...players.map(player=>player.user_id+':'+JSON.stringify(player.hand||[]))].join('|');
  if(animationKey!==lastAnimationKey){lastAnimationKey=animationKey;const dealer=$('blackjackCrupierArte');dealer.classList.remove('animacion-accion');void dealer.offsetWidth;dealer.classList.add('animacion-accion');setTimeout(()=>dealer.classList.remove('animacion-accion'),850);}
  $('estadoCrupierBlackjack').textContent=room.status==='lobby'?'¿Listos para jugar?':room.status==='playing'?(current?.user_id===user?.id?'El crupier espera tu jugada.':'Ahora juega @'+(current?.username||'otro jugador')+'.'):room.result||'Ronda terminada.';
  $('resultadoBlackjack').textContent=room.result||'';
  const own=players.find(p=>p.user_id===user?.id),host=room.host_id===user?.id,turn=room.current_player_id===user?.id&&own?.status==='playing';
  board.classList.toggle('mi-turno',turn);board.classList.toggle('turno-compartido',room.status==='playing'&&!turn);
  const todosListos=players.length>0&&players.every(p=>p.ready);
  setButton($('iniciarRondaBlackjack'),host&&['lobby','finished'].includes(room.status),!players.some(p=>p.chips>=1)||(room.status==='lobby'&&!todosListos)||(room.status==='finished'&&!todosListos));
  setButton($('pedirCartaBlackjack'),room.status==='playing'&&turn,false);setButton($('plantarseBlackjack'),room.status==='playing'&&turn,false);
  $('salirSalaBlackjack').disabled=false;
  status(room.status==='playing'?(turn?'Es tu turno.':'Turno de @'+(current?.username||'otro jugador')+'.'):todosListos?'Todos están listos. Quien creó la sala ya puede repartir.':'Elige tu apuesta y marca «Estoy listo» para la próxima ronda.');
 }
 function leaveView(){room=null;roomCode='';$('blackjackEntrada').hidden=false;$('blackjackMesa').hidden=true;clearInterval(poll);poll=null;}
 async function request(action,code=roomCode,ready,amount){
  if(!db)throw new Error('No se pudo iniciar el juego. Recarga la página.');
  const {data:{session}}=await db.auth.getSession();
  if(!session)throw new Error('Inicia sesión para jugar al blackjack.');
  const response=await fetch(config.supabaseUrl+'/functions/v1/blackjack',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,code,...(ready===undefined?{}:{ready}),...(amount===undefined?{}:{amount})}),signal:AbortSignal.timeout(12000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'No se pudo actualizar la mesa.');return result;
 }
 async function run(action,code,ready,amount){if(busy)return;busy=true;status('Un momento…');try{const result=await request(action,code,ready,amount);if(result.left){leaveView();history.replaceState(null,'','?seccion=blackjack');status('Saliste de la mesa. Puedes crear o unirte a otra.');}else{render(result);if(!poll)poll=setInterval(refresh,5000);const url=new URL(location.href);url.searchParams.set('seccion','blackjack');url.searchParams.set('sala',roomCode);history.replaceState(null,'',url);}}catch(error){status(error.message);}finally{busy=false;}}
 async function refresh(){if(!roomCode||busy||document.hidden)return;try{render(await request('state'));}catch(error){status(error.message);if(/No encontramos esa sala/.test(error.message))leaveView();}}
 $('crearSalaBlackjack').addEventListener('click',()=>run('create',''));
 $('unirseSalaBlackjack').addEventListener('submit',event=>{event.preventDefault();run('join',$('codigoSalaBlackjack').value.trim().toUpperCase());});
 $('iniciarRondaBlackjack').addEventListener('click',()=>run('start'));
 $('pedirCartaBlackjack').addEventListener('click',()=>run('hit'));
 $('plantarseBlackjack').addEventListener('click',()=>run('stand'));
 $('salirSalaBlackjack').addEventListener('click',()=>run('leave'));
 $('compartirSalaBlackjack').addEventListener('click',async()=>{const url=new URL(location.href);url.searchParams.set('seccion','blackjack');url.searchParams.set('sala',roomCode);try{await navigator.clipboard.writeText(url.href);status('Enlace de invitación copiado.');}catch{status('Comparte este código: '+roomCode);}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&roomCode)refresh();});
 chatForm?.addEventListener('submit',event=>{event.preventDefault();if(!user){status('Inicia sesión para hablar con el crupier.');return;}sendDealerMessage(chatInput.value);chatInput.value='';chatInput.focus();});
 $('blackjackChatBorrar')?.addEventListener('click',()=>{if(memoryKey())localStorage.removeItem(memoryKey());paintDealerChat();status('Se borró la conversación y la memoria local del crupier.');});
 if(db)db.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;$('blackjackAcceso').hidden=Boolean(user);paintDealerChat();if(!user&&roomCode){leaveView();status('Inicia sesión desde Inicio para volver a jugar.');}});
 (async()=>{if(!db){status('El juego requiere una cuenta de RedMusica.');paintDealerChat();return;}const {data:{session}}=await db.auth.getSession();user=session?.user||null;paintDealerChat();$('blackjackAcceso').hidden=Boolean(user);if(!user){status('Inicia sesión desde Inicio para crear una sala o unirte con un código.');return;}const invited=new URLSearchParams(location.search).get('sala');if(invited&&/^[A-Z0-9]{6}$/i.test(invited))await run('join',invited.toUpperCase());})();
})();
