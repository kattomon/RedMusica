const suits=['♠','♥','♦','♣'];
const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
export const BET=100;
const roomAlphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode(bytes){return Array.from(bytes.slice(0,6),byte=>roomAlphabet[byte%roomAlphabet.length]).join('');}

export function shuffledDeck(){
 const cards=Array.from({length:6},()=>suits.flatMap(suit=>ranks.map(rank=>({rank,suit})))).flat();
 const random=new Uint32Array(1);
 for(let i=cards.length-1;i>0;i--){crypto.getRandomValues(random);const j=random[0]%(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}
 return cards;
}
export function score(hand){let total=0,aces=0;for(const card of hand){if(card.rank==='A'){total+=11;aces++;}else total+=['K','Q','J'].includes(card.rank)?10:Number(card.rank);}while(total>21&&aces){total-=10;aces--;}return total;}
export function natural(hand){return hand.length===2&&score(hand)===21;}
export function draw(state,hand){const card=state.deck.pop();if(!card)throw new Error('Se acabaron las cartas. Reparte una ronda nueva.');hand.push(card);}
export function finishRound(state){
 const active=state.players.some(p=>p.status==='playing');if(active)return;
 const dealerNatural=natural(state.dealer.hand);
 if(!state.players.every(p=>p.status==='bust')&&!dealerNatural)while(score(state.dealer.hand)<17)draw(state,state.dealer.hand);
 const dealerScore=score(state.dealer.hand),dealerBust=dealerScore>21;
 for(const player of state.players){
  if(player.status==='waiting')continue;
  if(player.status==='bust'){player.result='Perdió';continue;}
  const value=score(player.hand),playerNatural=natural(player.hand);
  if((playerNatural&&!dealerNatural)||(!dealerNatural&&(dealerBust||value>dealerScore))){player.chips+=player.bet*(playerNatural?2.5:2);player.result=playerNatural?'Blackjack · ganó':'Ganó';}
  else if(dealerNatural&&playerNatural||!dealerNatural&&value===dealerScore){player.chips+=player.bet;player.result='Empate';}
  else player.result='Perdió';
  player.status=player.result.toLowerCase().startsWith('ganó')||player.result.startsWith('Blackjack')?'won':player.result==='Empate'?'push':'lost';
 }
 state.status='finished';state.current_player_id=null;
}
export function advance(state){const next=state.players.find(p=>p.status==='playing');if(next){state.current_player_id=next.user_id;return;}state.current_player_id=null;finishRound(state);}
export function leaveRound(state,userId){
 const player=state.players.find(p=>p.user_id===userId);if(!player)return false;
 const wasTurn=state.status==='playing'&&state.current_player_id===userId;
 state.players=state.players.filter(p=>p.user_id!==userId);
 if(wasTurn){if(state.players.length)advance(state);else state.current_player_id=null;}
 return true;
}
export function setReady(state,userId,ready){
 if(state.status!=='lobby')throw new Error('Solo puedes cambiar tu estado de listo mientras la sala espera jugadores.');
 const player=state.players.find(p=>p.user_id===userId);if(!player)throw new Error('No formas parte de esta sala.');
 player.ready=Boolean(ready);return player.ready;
}
export function holdTurn(state,userId){state.current_player_id=userId;}
export function startRound(state,deck=shuffledDeck()){
 if(state.status==='lobby'&&(!state.players.length||state.players.some(player=>!player.ready)))throw new Error('Todos los jugadores deben marcarse listos antes de repartir.');
 state.deck=deck.slice();state.dealer={hand:[]};state.result='';state.status='playing';
 for(const player of state.players){player.hand=[];player.bet=0;player.result='';if(player.chips>=BET){player.chips-=BET;player.bet=BET;player.status='playing';}else player.status='waiting';}
 state.players.filter(player=>player.status==='playing').forEach(player=>{draw(state,player.hand);draw(state,player.hand);if(natural(player.hand))player.status='blackjack';});
 draw(state,state.dealer.hand);draw(state,state.dealer.hand);
 state.players.filter(player=>player.status==='blackjack').forEach(player=>player.status='stood');
 state.current_player_id=state.players.find(player=>player.status==='playing')?.user_id||null;
 if(!state.players.some(player=>player.status==='playing'))finishRound(state);
 return state;
}
