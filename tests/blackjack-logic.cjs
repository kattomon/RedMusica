const assert=require('node:assert/strict');
(async()=>{
 const {BET,advance,finishRound,natural,roomCode,score,shuffledDeck,startRound}=await import('../supabase/functions/blackjack/game.mjs');
 assert.match(roomCode(Uint8Array.from([0,1,2,3,4,5,6,7])),/^[A-Z0-9]{6}$/,'room codes must satisfy the six-character database and invite format');
 assert.equal(BET,100);assert.equal(score([{rank:'A'},{rank:'6'}]),17);assert.equal(score([{rank:'A'},{rank:'A'},{rank:'9'}]),21);assert.equal(score([{rank:'10'},{rank:'9'},{rank:'4'}]),23);
 assert.equal(natural([{rank:'A'},{rank:'K'}]),true);assert.equal(natural([{rank:'7'},{rank:'7'},{rank:'7'}]),false);assert.equal(shuffledDeck().length,312);
 const card=(rank,suit='♠')=>({rank,suit});
 const one={status:'lobby',players:[{user_id:'owner',username:'Kattomon',chips:1000,status:'waiting',hand:[]},{user_id:'guest',username:'Ana',chips:50,status:'waiting',hand:[]}],dealer:{hand:[]}};
 startRound(one,[card('7'),card('10'),card('A'),card('K')]);
 assert.equal(one.status,'finished');assert.equal(one.players[0].chips,1150,'natural blackjack pays 3:2');assert.equal(one.players[0].result,'Blackjack · ganó');assert.equal(one.players[1].chips,50);assert.equal(one.players[1].status,'waiting');assert.equal(one.players[1].result,'','players without a full stake remain waiting');
 const table={status:'lobby',players:[{user_id:'owner',username:'Kattomon',chips:1000,status:'waiting',hand:[]},{user_id:'guest',username:'Ana',chips:1000,status:'waiting',hand:[]}],dealer:{hand:[]}};
 startRound(table,[card('7'),card('10'),card('8'),card('10'),card('7'),card('9')]);assert.equal(table.current_player_id,'owner');assert.equal(table.players[0].chips,900);
 table.players[0].hand.push(card('5'));table.players[0].status='stood';advance(table);assert.equal(table.current_player_id,'guest');
 table.players[1].status='stood';advance(table);assert.equal(table.status,'finished');assert.equal(table.players[0].chips,1100);assert.equal(table.players[1].chips,1100);
 const solo={status:'lobby',players:[{user_id:'solo',username:'Sola',chips:1000,status:'waiting',hand:[]}],dealer:{hand:[]}};
 startRound(solo,[card('9'),card('10'),card('7'),card('8'),card('4')]);assert.equal(solo.status,'playing');assert.equal(solo.current_player_id,'solo','a single player can play the dealer');solo.players[0].status='stood';advance(solo);assert.equal(solo.status,'finished');assert.equal(solo.players[0].result,'Perdió');
 const tied={status:'playing',players:[{user_id:'p',chips:900,bet:100,hand:[card('A'),card('K')],status:'stood'}],dealer:{hand:[card('A','♥'),card('Q','♦')]},deck:[]};finishRound(tied);assert.equal(tied.players[0].chips,1000);assert.equal(tied.players[0].result,'Empate');
 console.log('PASS blackjack rules: soft aces, 6-deck shoe, natural payout, ties, sequential turns and low-balance players');
})().catch(e=>{console.error(e);process.exit(1)});
