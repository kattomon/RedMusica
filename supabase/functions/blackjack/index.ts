import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { advance, draw, holdTurn, roomCode, score, startRound } from './game.mjs';

const origin='https://kattomon.github.io';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db=createClient(Deno.env.get('SUPABASE_URL')!,secret!,{auth:{persistSession:false,autoRefreshToken:false}});
const bet=100;
function publicState(room:any){
 const state=structuredClone(room.state);delete state.deck;
 if(state.status==='playing'&&state.dealer.hand.length>1)state.dealer={hand:[state.dealer.hand[0],{hidden:true}],hidden:true};
 return {code:room.code,host_id:room.host_id,status:state.status,players:state.players,dealer:state.dealer,current_player_id:state.current_player_id,result:state.result||'',updated_at:room.updated_at};
}
function code(){const bytes=new Uint8Array(6);crypto.getRandomValues(bytes);return roomCode(bytes);}
async function getProfile(userId:string){
 const {data,error}=await db.from('profiles').select('username,suspended').eq('id',userId).single();
 if(error||!data)throw new Error('No se encontró tu perfil.');
 if(data.suspended)throw new Error('Tu cuenta está suspendida.');
 return data;
}
async function findRoom(roomCode:string){
 const {data,error}=await db.from('blackjack_rooms').select('*').eq('code',roomCode).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error)throw new Error('No se pudo abrir la sala.');
 if(!data)throw new Error('No encontramos esa sala. Comprueba el código.');
 return data;
}
async function saveRoom(room:any,state:any){
 const updatedAt=new Date().toISOString();
 const {data,error}=await db.from('blackjack_rooms').update({state,updated_at:updatedAt}).eq('id',room.id).eq('updated_at',room.updated_at).select('*').maybeSingle();
 if(error)throw new Error('No se pudo actualizar la sala.');
 if(!data)throw new Error('La mesa cambió al mismo tiempo. Intenta de nuevo.');
 return data;
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
 try{
  const raw=await req.text();if(raw.length>2048)return reply({error:'Solicitud demasiado larga.'},413);
  const input=JSON.parse(raw);
  if(!['create','join','state','start','hit','stand','leave'].includes(input?.action))return reply({error:'Acción no válida.'},400);
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
  const {data:{user},error:authError}=await db.auth.getUser(token);
  if(authError||!user)return reply({error:'Inicia sesión para jugar.'},401);
  const profile=await getProfile(user.id);
  if(input.action==='create'){
   await db.from('blackjack_rooms').delete().lt('expires_at',new Date().toISOString());
   for(let attempt=0;attempt<5;attempt++){
    const roomCode=code(),state={status:'lobby',players:[{user_id:user.id,username:profile.username,chips:1000,bet:0,hand:[],status:'waiting'}],dealer:{hand:[]},deck:[],current_player_id:null,result:''};
    const {data,error}=await db.from('blackjack_rooms').insert({code:roomCode,host_id:user.id,state}).select('*').single();
    if(!error&&data)return reply({room:publicState(data)});
   }
   return reply({error:'No se pudo crear la sala. Inténtalo otra vez.'},503);
  }
  const roomCode=typeof input.code==='string'?input.code.toUpperCase():'';
  if(!/^[A-Z0-9]{6}$/.test(roomCode))return reply({error:'El código debe tener seis caracteres.'},400);
  let room=await findRoom(roomCode);
  if(input.action==='state'&&!room.state.players.some((p:any)=>p.user_id===user.id))return reply({error:'No formas parte de esta sala.'},403);
  if(input.action==='join'){
   if(room.state.players.some((p:any)=>p.user_id===user.id))return reply({room:publicState(room)});
   if(room.state.status!=='lobby')return reply({error:'La partida ya comenzó; la sala no acepta más jugadores.'},409);
   if(room.state.players.length>=6)return reply({error:'Esta mesa ya tiene seis jugadores.'},409);
   const state=structuredClone(room.state);state.players.push({user_id:user.id,username:profile.username,chips:1000,bet:0,hand:[],status:'waiting'});
   room=await saveRoom(room,state);return reply({room:publicState(room)});
  }
  if(input.action==='state')return reply({room:publicState(room)});
  let state=structuredClone(room.state);
  const player=state.players.find((p:any)=>p.user_id===user.id);
  if(input.action==='start'){
   if(room.host_id!==user.id)return reply({error:'Solo quien creó la sala puede repartir.'},403);
   if(!['lobby','finished'].includes(state.status))return reply({error:'Esta ronda todavía está en curso.'},409);
   const readyPlayers=state.players.filter((p:any)=>p.chips>=bet);
   if(!readyPlayers.length)return reply({error:'Nadie tiene fichas suficientes para otra ronda.'},409);
   startRound(state);room=await saveRoom(room,state);return reply({room:publicState(room)});
  }
  if(input.action==='leave'){
   if(!player)return reply({room:publicState(room)});
   if(state.status==='playing')return reply({error:'Espera a que termine la ronda para salir de la mesa.'},409);
   state.players=state.players.filter((p:any)=>p.user_id!==user.id);
   if(!state.players.length){const {error}=await db.from('blackjack_rooms').delete().eq('id',room.id).eq('updated_at',room.updated_at);if(error)return reply({error:'No se pudo cerrar la sala.'},500);return reply({left:true});}
   if(room.host_id===user.id)room.host_id=state.players[0].user_id;
   const {data,error}=await db.from('blackjack_rooms').update({host_id:room.host_id,state,updated_at:new Date().toISOString()}).eq('id',room.id).eq('updated_at',room.updated_at).select('*').maybeSingle();
   if(error||!data)return reply({error:'La mesa cambió al mismo tiempo. Intenta de nuevo.'},409);
   return reply({left:true});
  }
  if(!player)return reply({error:'No formas parte de esta sala.'},403);
  if(state.status!=='playing'||state.current_player_id!==user.id||player.status!=='playing')return reply({error:'Todavía no es tu turno.'},409);
  if(input.action==='hit'){
   draw(state,player.hand);const value=score(player.hand);
   if(value>21){player.status='bust';player.result='Se pasó · perdió';advance(state);}
   else if(value===21){player.status='stood';advance(state);}
   else advanceSameTurn(state,user.id);
  }else if(input.action==='stand'){player.status='stood';advance(state);}
  room=await saveRoom(room,state);return reply({room:publicState(room)});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const safe=/^(Inicia|No se encontró|Tu cuenta|No encontramos|El código|La partida|Esta ronda|Nadie|Espera|No formas|Todavía|La mesa|Solo quien|Se acabaron)/.test(message);
  return reply({error:safe?message:'No se pudo completar la jugada. Inténtalo de nuevo.'},400);
 }
});
function advanceSameTurn(state:any,userId:string){holdTurn(state,userId);}
