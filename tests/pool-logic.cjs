const assert=require('node:assert/strict');
(async()=>{
 const E=await import('../supabase/functions/pool/engine.js');
 const {TABLE}=E,R=TABLE.radius;
 const bytes=Array.from({length:32},(_,i)=>(i*97+13)%256);
 const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const noOverlap=balls=>{const live=balls.filter(b=>!b.p);for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++){const d=Math.hypot(live[i].x-live[j].x,live[i].y-live[j].y);assert.ok(d>=2*R-0.05,`balls ${live[i].n} and ${live[j].n} overlap (${d})`);}};
 const inside=balls=>balls.filter(b=>!b.p).forEach(b=>{assert.ok(b.x>=R-0.01&&b.x<=TABLE.width-R+0.01&&b.y>=R-0.01&&b.y<=TABLE.height-R+0.01,`ball ${b.n} left the table`);});

 // Rack: 16 balls, 8 in the centre of row three, mixed back corners, deterministic.
 const balls=E.rack(bytes);
 assert.equal(balls.length,16);assert.deepEqual(balls.map(b=>b.n),[...Array(16).keys()]);
 noOverlap(balls);inside(balls);
 assert.deepEqual(E.rack(bytes),balls,'the same bytes produce the same rack');
 const xs=[...new Set(balls.filter(b=>b.n).map(b=>b.x))].sort((a,b)=>a-b);assert.equal(xs.length,5);
 const eight=balls.find(b=>b.n===8);assert.equal(eight.x,xs[2]);assert.equal(eight.y,TABLE.height/2);
 const back=balls.filter(b=>b.x===xs[4]).sort((a,b)=>a.y-b.y);assert.notEqual(E.isSolid(back[0].n),E.isSolid(back[4].n));
 for(let seed=0;seed<40;seed++){const r=E.rack(Array.from({length:32},(_,i)=>(i*31+seed*7)%256));assert.equal(r.find(b=>b.n===8).x,xs[2]);}

 // Break: every run from the same input is identical; balls stay on the table without overlapping.
 const game=E.newGame('g1',[A,B],A,bytes);
 assert.throws(()=>E.applyShot(game,B,{dx:1,dy:0,power:1}),/turno/);
 assert.throws(()=>E.applyShot(game,A,{dx:0,dy:0,power:1}),/no es válido/);
 assert.throws(()=>E.applyShot(game,A,{dx:1,dy:0,power:2}),/no es válido/);
 assert.throws(()=>E.applyShot(game,A,{dx:1,dy:0,power:1,cue:{x:600,y:250}}),/detrás de la línea/);
 const shot={dx:1,dy:0.003,power:1};
 const broken=E.applyShot(game,A,shot),again=E.applyShot(game,A,shot);
 assert.deepEqual(broken,again);assert.equal(game.seq,0,'input game is not modified');
 assert.equal(broken.seq,1);assert.equal(broken.breakShot,false);assert.deepEqual(broken.groups,{},'table stays open after the break');
 noOverlap(broken.balls);inside(broken.balls);
 assert.ok(broken.balls.filter(b=>b.n&&!b.p).some(b=>Math.abs(b.x-balls[b.n].x)>30),'the break spreads the rack');
 let frames=0;const sim=E.simulate(broken.last.before,shot,()=>frames++);
 assert.deepEqual(sim.balls,broken.balls,'replaying last.before with the shot reproduces the stored result');
 assert.ok(frames>30&&frames<2400);

 // Scenario helpers: only the listed balls stay on the table.
 const scene=(placed,extra={})=>{const g=E.newGame('s',[A,B],A,bytes);g.breakShot=false;g.ballInHand=null;g.balls=g.balls.map(b=>placed[b.n]?{n:b.n,x:placed[b.n][0],y:placed[b.n][1],p:0}:{...b,p:1});return Object.assign(g,extra);};
 const toCorner={dx:1,dy:-1,power:0.3,spin:-0.5};// cue (850,150) -> ball (950,50) -> pocket (1000,0), stun so the cue ball stays out

 // Open table: pocketing a stripe assigns stripes to the shooter, who keeps shooting.
 let g=E.applyShot(scene({0:[850,150],11:[950,50],2:[200,400],8:[500,300]}),A,toCorner);
 assert.deepEqual(g.last.summary.pocketed,[11]);assert.equal(g.last.summary.foul,'');
 assert.equal(g.groups[A],'stripes');assert.equal(g.groups[B],'solids');assert.equal(g.turn,A);assert.equal(g.ballInHand,null);

 // With groups: pocketing an opponent ball after hitting it first is a foul and passes ball in hand.
 g=E.applyShot(scene({0:[850,150],3:[950,50],12:[200,400],8:[500,300]},{groups:{[A]:'stripes',[B]:'solids'}}),A,toCorner);
 assert.match(g.last.summary.foul,/tu grupo/);assert.equal(g.turn,B);assert.equal(g.ballInHand,'table');

 // Pocketing an own ball continues the turn.
 g=E.applyShot(scene({0:[850,150],3:[950,50],12:[200,400],8:[500,300]},{groups:{[A]:'solids',[B]:'stripes'}}),A,toCorner);
 assert.equal(g.last.summary.foul,'');assert.equal(g.turn,A);assert.deepEqual(g.balls.filter(b=>!b.p).map(b=>b.n).sort((a,b)=>a-b),[0,8,12]);

 // Scratch: the cue ball is off the table and the opponent must place it.
 g=E.applyShot(scene({0:[900,100],3:[200,400],8:[500,300]},{groups:{[A]:'solids',[B]:'stripes'}}),A,{dx:1,dy:-1,power:0.5});
 assert.equal(g.last.summary.scratch,true);assert.equal(g.turn,B);assert.equal(g.ballInHand,'table');assert.equal(g.balls[0].p,1);
 assert.throws(()=>E.applyShot(g,B,{dx:1,dy:0,power:0.5,call:0}),/Coloca la bola blanca/);
 assert.throws(()=>E.applyShot(g,B,{dx:1,dy:0,power:0.5,cue:{x:200,y:400},call:0}),/espacio libre/);
 const placed=E.applyShot(g,B,{dx:-1,dy:0,power:0.4,cue:{x:700,y:250},call:0});assert.equal(placed.last.before[0].x,700);

 // Missing everything is a foul; so is a contact with no rail and nothing pocketed.
 g=E.applyShot(scene({0:[100,250],3:[900,60],8:[500,450]},{groups:{[A]:'solids',[B]:'stripes'}}),A,{dx:0,dy:-1,power:0.2});
 assert.match(g.last.summary.foul,/no tocó ninguna bola/);
 g=E.applyShot(scene({0:[400,250],3:[450,250],8:[900,450]},{groups:{[A]:'solids',[B]:'stripes'}}),A,{dx:1,dy:0,power:0.06});
 assert.equal(g.last.summary.firstContact,3);assert.match(g.last.summary.foul,/banda/);

 // The 8: early is a loss, after clearing the group is a win, on the break it is re-spotted.
 g=E.applyShot(scene({0:[850,150],8:[950,50],3:[200,400]},{groups:{[A]:'solids',[B]:'stripes'}}),A,toCorner);
 assert.equal(g.winner,B);assert.match(g.reason,/antes de terminar/);
 assert.throws(()=>E.applyShot(g,B,toCorner),/terminó/);
 const onEight=scene({0:[850,150],8:[950,50],12:[200,400]},{groups:{[A]:'solids',[B]:'stripes'}});
 assert.equal(E.mustCallEight(onEight,A),true);assert.equal(E.mustCallEight(onEight,B),false);
 assert.throws(()=>E.applyShot(onEight,A,toCorner),/Elige la tronera/);
 g=E.applyShot(onEight,A,{...toCorner,call:2});
 assert.equal(g.winner,A);assert.equal(g.last.summary.foul,'');assert.equal(g.last.summary.eightPocket,2);assert.equal(g.last.shot.call,2);
 g=E.applyShot(onEight,A,{...toCorner,call:0});
 assert.equal(g.winner,B,'the 8 in a pocket that was not called loses');assert.match(g.reason,/otra tronera/);
 assert.throws(()=>E.applyShot(onEight,A,{...toCorner,call:7}),/no es válido/);

 // Shot clock: the waiting player can take ball in hand when time runs out.
 const late=E.applyTimeout(onEight,B);
 assert.equal(late.turn,B);assert.equal(late.ballInHand,'table');assert.equal(late.seq,onEight.seq+1);assert.equal(late.last.timeout,true);assert.match(late.last.summary.foul,/tiempo/);
 assert.throws(()=>E.applyTimeout(onEight,A),/turno/);
 assert.equal(E.applyTimeout(game,B).ballInHand,'kitchen','a missed break keeps the kitchen');

 // Side spin changes the rebound off a cushion.
 const sideEnd=side=>E.simulate(scene({0:[300,300]}).balls,{dx:0,dy:-1,power:0.35,side}).balls[0].x;
 assert.ok(sideEnd(1)>sideEnd(0)+50&&sideEnd(-1)<sideEnd(0)-50,'right english sends the ball right off the cushion, left english left');
 let impacts=[];E.simulate(game.balls,{dx:1,dy:0.002,power:1},null,e=>impacts.push(e));
 assert.ok(impacts.some(e=>e.type==='ball'&&e.strength>10)&&impacts.some(e=>e.type==='rail'),'impacts are reported for sound');
 assert.deepEqual(E.simulate(game.balls,{dx:1,dy:0.002,power:1},null,()=>{}),E.simulate(game.balls,{dx:1,dy:0.002,power:1}),'listening to impacts does not change the shot');
 g=E.applyShot(scene({0:[850,150],8:[950,50],12:[200,400]},{groups:{[A]:'solids',[B]:'stripes'},breakShot:true}),A,toCorner);
 assert.equal(g.winner,null);assert.equal(g.balls[8].p,0);assert.ok(g.last.summary.respotted);

 // Aiming guide finds the first ball on the line.
 const guide=E.aimGuide([{n:0,x:100,y:250,p:0},{n:5,x:300,y:250,p:0},{n:6,x:600,y:250,p:0}],1,0);
 assert.equal(guide.ball.n,5);assert.ok(Math.abs(guide.point.x-(300-2*R))<1e-9);
 // Physics: spin, rolling and pockets.
 const straight=spin=>E.simulate(scene({0:[300,250],3:[500,250]}).balls,{dx:1,dy:0,power:0.35,spin}).balls[0].x;
 const draw=straight(-1),stun=straight(-0.4),follow=straight(1);
 assert.ok(draw<500-2*R-30,`draw brings the cue ball back (${draw})`);
 assert.ok(follow>500+30,`follow carries the cue ball forward (${follow})`);
 assert.ok(draw<stun&&stun<follow,'more top spin means the cue ball ends further forward');
 const travel=power=>{let last=null,d=0;E.simulate(scene({0:[100,250]}).balls,{dx:1,dy:0.0001,power},s=>{if(last)d+=Math.hypot(s[0].x-last.x,s[0].y-last.y);last=s[0];});return d;};
 assert.ok(travel(0.1)<travel(0.4)&&travel(0.4)<travel(1),'harder shots travel further');
 assert.ok(travel(0.1)>100,'soft shots still move the ball');
 const railShot=E.simulate(scene({0:[600,11.5],5:[400,11.5]}).balls,{dx:-1,dy:0,power:0.5,spin:-0.5});
 assert.ok(railShot.events.pocketed.includes(5),'a ball rolled along the rail drops in the corner');
 const sideShot=E.simulate(scene({0:[500,300],5:[500,100]}).balls,{dx:0,dy:-1,power:0.4,spin:-0.5});
 assert.ok(sideShot.events.pocketed.includes(5),'a straight shot drops in the side pocket');
 const crazy=E.simulate(broken.balls,{dx:-0.3,dy:0.95,power:1,spin:1});inside(crazy.balls);noOverlap(crazy.balls);
 assert.deepEqual(E.simulate(broken.balls,{dx:0.4,dy:-1,power:0.8,spin:-0.7}),E.simulate(broken.balls,{dx:0.4,dy:-1,power:0.8,spin:-0.7}),'spin shots are deterministic');
 assert.throws(()=>E.applyShot(game,A,{dx:1,dy:0,power:1,spin:2}),/no es válido/);
 assert.equal(E.applyShot(game,A,{dx:1,dy:0.003,power:1,spin:0.5}).last.shot.spin,0.5,'spin is kept for the replay');
 assert.equal(E.applyShot(game,A,shot).last.shot.spin,undefined,'shots without spin stay compatible');
 assert.equal(E.validPlacement([],8,8,'table'),false,'the cue ball cannot be placed in a pocket mouth');

 // Collisions are resolved at the moment of contact, so fast cut shots go where the line of centres says,
 // bent only by a few degrees of throw: towards the cue ball's motion, and against the side spin.
 const objectAngle=(power,side=0)=>{const gx=500-2*R,gy=250,c=Math.PI/6,cx=gx-200*Math.cos(c),cy=gy-200*Math.sin(c);let f=null;
  E.simulate([{n:0,x:cx,y:cy,p:0},{n:3,x:500,y:250,p:0}],{dx:gx-cx,dy:gy-cy,power,side},s=>{if(!f&&Math.hypot(s[1].x-500,s[1].y-250)>20)f=s[1];});return Math.atan2(f.y-250,f.x-500)*180/Math.PI;};
 for(const power of [0.15,0.5,1]){const a=objectAngle(power);assert.ok(a>0.5&&a<5,`cut throw at power ${power}: ${a}`);}
 assert.ok(objectAngle(0.15)>objectAngle(1),'slow cuts throw more than fast ones');
 const straightThrow=side=>{let f=null;E.simulate([{n:0,x:300,y:250,p:0},{n:3,x:500,y:250,p:0}],{dx:1,dy:0,power:0.3,side},s=>{if(!f&&s[1].x>540)f=s[1];});return f.y-250;};
 assert.ok(straightThrow(1)<-0.5&&straightThrow(-1)>0.5&&straightThrow(0)===0,'right english throws the object ball left and left english right');
 // Off the cushion a rolling ball bends forward (its spin into the cushion survives), so its final path is
 // closer to the rail than right after the bounce.
 {const path=[];E.simulate([{n:0,x:300,y:400,p:0}],{dx:1,dy:-1,power:0.3,spin:0.6},s=>path.push(s[0]));
  const hit=path.findIndex((p,i)=>i>0&&p.y>path[i-1].y),a=path[hit+1],b=path[hit+3],c=path[hit+40];
  const early=Math.atan2(b.y-a.y,b.x-a.x),late=Math.atan2(c.y-path[hit+37].y,c.x-path[hit+37].x);
  assert.ok(late<early-0.05,`rolling ball bends towards the rail after the bounce (${early} -> ${late})`);}

 // Rooms: two players, forfeits, inactivity claims and rematches.
 const Rooms=await import('../supabase/functions/pool/rooms.js');
 let room=Rooms.newRoomState(A,'Kattomon');
 room=Rooms.joinRoom(room,B,'Ana',1000);assert.equal(room.status,'playing');
 assert.throws(()=>Rooms.joinRoom(room,'c','Otra',1000),/dos jugadores/);
 room.game=E.newGame('g2',[A,B],A,bytes);
 assert.equal(Rooms.claimAllowed(room,B,1000+Rooms.TURN_LIMIT_MS-1),false);
 assert.equal(Rooms.claimAllowed(room,A,1000+Rooms.TURN_LIMIT_MS),false,'the shooter cannot claim');
 assert.equal(Rooms.claimAllowed(room,B,1000+Rooms.TURN_LIMIT_MS),true);
 assert.throws(()=>Rooms.requestRematch(room,A),/en curso/);
 const left=Rooms.leaveRoom(room,A,A,2000);
 assert.equal(left.state.game.winner,B);assert.match(left.state.game.reason,/abandonó/);assert.equal(left.hostId,B);assert.equal(left.state.status,'finished');
 assert.throws(()=>Rooms.requestRematch(left.state,B),/Esperando/);
 const rejoined=Rooms.joinRoom(left.state,'c','Otra',3000);assert.equal(rejoined.players.length,2);assert.equal(rejoined.recorded,false);
 room.status='finished';room.game.winner=A;
 assert.equal(Rooms.requestRematch(room,A),null);assert.equal(Rooms.requestRematch(room,A),null,'votes are not counted twice');
 assert.equal(Rooms.requestRematch(room,B),B,'the loser breaks the rematch');
 console.log('Pool logic tests passed');
})().catch(error=>{console.error(error);process.exit(1);});
