const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated;`);
 for(const file of ['schema','radio','admin'])await db.exec(fs.readFileSync('supabase/'+file+'.sql','utf8').replace(/^﻿/,''));
 await db.exec(fs.readFileSync('supabase/migrations/20260930200000_pool_rooms_and_stats.sql','utf8'));
 const winner='11111111-1111-4111-8111-111111111111',loser='22222222-2222-4222-8222-222222222222',match='33333333-3333-4333-8333-333333333333';
 for(const [id,name] of [[winner,'Ganadora'],[loser,'Rival']])await db.query('insert into auth.users values($1,$2)',[id,{username:name}]);
 async function as(role,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);}
 const record=id=>db.query("select public.record_pool_result($1,'ABC234',$2,$3,'Metió la bola 8 y ganó la partida.') as recorded",[id,winner,loser]);

 // Browsers never reach rooms, matches or the recording function, and cannot write stats.
 for(const role of ['anon','authenticated']){
  await as(role,role==='authenticated'?winner:'');
  await assert.rejects(db.query('select * from public.pool_rooms'));
  await assert.rejects(db.query("insert into public.pool_rooms(code,host_id,state) values('ABC234',$1,'{}')",[winner]));
  await assert.rejects(db.query('select * from public.pool_matches'));
  await assert.rejects(record(match));
  await assert.rejects(db.query('insert into public.pool_stats(user_id,wins) values($1,99)',[winner]));
  assert.equal((await db.query('select count(*)::int as n from public.pool_stats')).rows.length,1,'stats are readable');
 }
 await as('authenticated',winner);
 await assert.rejects(db.query('update public.pool_stats set wins=99'));

 // The server records a match once and updates both counters.
 await as('service_role');
 await db.query("insert into public.pool_rooms(code,host_id,state) values('ABC234',$1,'{}')",[winner]);
 await assert.rejects(db.query("insert into public.pool_rooms(code,host_id,state) values('abc',$1,'{}')",[winner]));
 assert.equal((await record(match)).rows[0].recorded,true);
 assert.equal((await record(match)).rows[0].recorded,false,'recording the same match twice is ignored');
 await assert.rejects(db.query("select public.record_pool_result('44444444-4444-4444-8444-444444444444','ABC234',$1,$1,'')",[winner]));
 await as('anon');
 const stats=Object.fromEntries((await db.query('select user_id,wins,losses from public.pool_stats')).rows.map(r=>[r.user_id,[Number(r.wins),Number(r.losses)]]));
 assert.deepEqual(stats,{[winner]:[1,0],[loser]:[0,1]});

 // Deleting an account removes its counters and rooms but keeps the other player's history.
 await db.exec('reset role');
 await db.query('delete from public.profiles where id=$1',[loser]);
 assert.equal((await db.query('select count(*)::int as n from public.pool_stats where user_id=$1',[loser])).rows[0].n*1,0);
 assert.equal((await db.query('select loser_id from public.pool_matches where id=$1',[match])).rows[0].loser_id,null);
 await db.query('delete from public.profiles where id=$1',[winner]);
 assert.equal((await db.query('select count(*)::int as n from public.pool_rooms')).rows[0].n*1,0);
 console.log('Pool database tests passed');
})().catch(error=>{console.error(error);process.exit(1);});
