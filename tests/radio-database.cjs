const { PGlite }=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table public.profiles(id uuid primary key,username text);grant usage on schema public to service_role;grant select on public.profiles to service_role;');
 await db.exec(fs.readFileSync('supabase/radio.sql','utf8'));
 const id='11111111-1111-4111-8111-111111111111';
 await db.query('insert into public.profiles values ($1,$2)',[id,'Ana']);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(db.query('select public.radio_state()'));
  await assert.rejects(db.query('select * from public.radio_queue'));
  await assert.rejects(db.query("insert into public.radio_cache values ('hack','[]',now())"));
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 assert.equal((await db.query('select public.radio_state() s')).rows[0].s.queue.length,0);
 await db.query('select public.radio_enqueue($1,$2,$3,$4,$5)',[id,'abcdefghijk','Canción','Canal',180]);
 await assert.rejects(db.query('select public.radio_enqueue($1,$2,$3,$4,$5)',[id,'abcdefghijk','Duplicado','Canal',180]));
 for(const video of ['abcdefghij2','abcdefghij3'])await db.query('select public.radio_enqueue($1,$2,$3,$4,$5)',[id,video,'Canción','Canal',180]);
 await assert.rejects(db.query('select public.radio_enqueue($1,$2,$3,$4,$5)',[id,'abcdefghij4','Cuarta','Canal',180]));
 const state=(await db.query('select public.radio_state() s')).rows[0].s;
 assert.equal(state.queue.length,3);assert.equal(state.queue[0].username,'Ana');
 assert.equal(Date.parse(state.queue[0].ends_at),Date.parse(state.queue[1].starts_at));
 assert.equal(Date.parse(state.queue[1].ends_at),Date.parse(state.queue[2].starts_at));
 for(let i=0;i<10;i++)await db.query('select public.radio_limit($1,$2,$3)',[id,'search','query'+i]);
 await assert.rejects(db.query('select public.radio_limit($1,$2,$3)',[id,'search','eleven']));
 await db.query("insert into public.radio_cache values ('cached','[]',now()+interval '1 day')");
 assert.deepEqual((await db.query('select public.radio_limit($1,$2,$3) r',[id,'search','cached'])).rows[0].r,{cached:[]});
 await db.query("update public.radio_queue set starts_at=starts_at-interval '1 day', ends_at=ends_at-interval '1 day'");
 const rotation=(await db.query('select public.radio_state() s')).rows[0].s;
 assert.equal(rotation.queue.length,1);assert.equal(rotation.queue[0].username,null);
 await db.close();console.log('PASS radio DB: server-only access, queue scheduling, duplicate/user limits, quotas, cache and rotation');
})().catch(e=>{console.error(e);process.exit(1)});
