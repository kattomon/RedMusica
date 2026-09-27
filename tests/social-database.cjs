const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public bool,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant all on storage.objects to authenticated;`);
 for(const f of ['schema','radio','admin','profiles','social'])await db.exec(fs.readFileSync('supabase/'+f+'.sql','utf8').replace(/^\uFEFF/,''));
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
 for(const [id,name] of [[a,'Ana'],[b,'Beto'],[c,'Cami']])await db.query('insert into auth.users values($1,$2)',[id,{username:name}]);
 const post=(await db.query("insert into public.posts(user_id,album_id,album_title,album_artist,body) values($1,'44444444-4444-4444-8444-444444444444','Álbum','Artista','Opinión') returning id",[a])).rows[0].id;
 async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
 await as(a);await db.query('insert into public.likes(post_id) values($1)',[post]);await db.query('insert into public.comments(post_id,body) values($1,\'Autocomentario\')',[post]);
 assert.equal((await db.query('select count(*)::int n from public.notifications where recipient_id=$1',[a])).rows[0].n,0,'no self notifications');
 await as(b);await db.query('insert into public.likes(post_id) values($1)',[post]);await db.query('insert into public.likes(post_id) values($1) on conflict do nothing',[post]);await db.query('insert into public.comments(post_id,body) values($1,\'Buen disco\')',[post]);await db.query('insert into public.follows(followed_id) values($1)',[a]);
 const [low,high]=[a,b].sort();await db.query('insert into public.friendships(user_a,user_b,requested_by) values($1,$2,$3)',[low,high,b]);
 await assert.rejects(db.query('insert into public.friendships(user_a,user_b,requested_by) values($1,$2,$3)',[low,high,c]),'cannot forge request owner');
 await as(a);let friendship=(await db.query('select status,requested_by from public.friendships where user_a=$1 and user_b=$2',[low,high])).rows[0];assert.equal(friendship.status,'pending');assert.equal(friendship.requested_by,b);
 await db.query("update public.friendships set status='accepted' where user_a=$1 and user_b=$2",[low,high]);
 await as(c);assert.equal((await db.query('select * from public.friendships where user_a=$1 and user_b=$2',[low,high])).rows.length,0,'friendship private to participants');
 assert.equal((await db.query("update public.friendships set status='declined' where user_a=$1 and user_b=$2 returning user_a",[low,high])).rows.length,0,'unrelated user cannot change status');
 await as(b);await db.query('delete from public.friendships where user_a=$1 and user_b=$2',[low,high]);
 await db.exec('reset role;set role service_role');
 let n=(await db.query('select kind,read_at,post_id,comment_id from public.notifications where recipient_id=$1 order by kind',[a])).rows;assert.deepEqual(n.map(x=>x.kind),['comment','follow','like']);
 assert.equal((await db.query('select count(*)::int n from public.notifications where recipient_id=$1',[b])).rows[0].n,0);
 await as(b);
 await assert.rejects(db.query('insert into public.notifications(recipient_id,actor_id,kind,post_id) values($1,$2,\'like\',$3)',[a,b,post]),'clients cannot forge notifications');
 await db.query('update public.notifications set read_at=now() where recipient_id=$1',[a]);await assert.rejects(db.query('update public.notifications set actor_id=$1 where recipient_id=$2',[c,a]));
 await db.exec('reset role;set role service_role');
 await db.query('delete from public.follows where user_id=$1 and followed_id=$2',[b,a]);assert.equal((await db.query('select count(*)::int n from public.notifications where recipient_id=$1 and kind=\'follow\'',[a])).rows[0].n,0);
 await db.query('insert into public.follows(user_id,followed_id) values($1,$2)',[b,a]);await db.query('insert into public.likes(user_id,post_id) values($1,$2)',[c,post]);await db.query('insert into public.comments(user_id,post_id,body) values($1,$2,\'Tercer comentario\')',[c,post]);
 assert.equal((await db.query('select count(*)::int n from public.notifications where recipient_id=$1',[a])).rows[0].n,5);
 await db.query('delete from public.comments where post_id=$1',[post]);await db.query('delete from public.posts where id=$1',[post]);assert.equal((await db.query('select count(*)::int n from public.notifications where recipient_id=$1',[a])).rows[0].n,1,'post/comment deletion cascades contextual notifications');
 await db.exec('reset role');await db.exec(`insert into public.posts(user_id,album_id,album_title,album_artist,body) select '${a}','44444444-4444-4444-8444-444444444444','A','B','C' from generate_series(1,105)`);const p=(await db.query('select id from public.posts order by created_at desc,id desc limit 1')).rows[0].id;
 for(let i=0;i<105;i++){const actor=i%2?b:c;await db.query('insert into public.likes(user_id,post_id) values($1,$2)',[actor,p]);await db.query('delete from public.likes where user_id=$1 and post_id=$2',[actor,p]);}
 assert((await db.query('select count(*)::int n from public.notifications where recipient_id=$1',[a])).rows[0].n<=100,'per-person notification retention cap');
 await db.close();console.log('PASS social DB: notifications, follows, RLS, dedupe, cascades, self-event filtering and 100-row retention');
})().catch(e=>{console.error(e);process.exit(1)});

