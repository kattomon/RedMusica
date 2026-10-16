import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
const headers={'Access-Control-Allow-Origin':'https://kattomon.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db=createClient(Deno.env.get('SUPABASE_URL')!,secret!,{auth:{persistSession:false,autoRefreshToken:false}});
// Owner only: a one-time link so a person who forgot their password can choose a new one.
// The site has no e-mail sending, so the owner passes the link on (WhatsApp, etc.).
// Only the hashed token goes into the link, after "#", so it never reaches GitHub Pages' servers;
// the page verifies it with Supabase. Nobody but the account holder ever sees a password.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function recoveryLink(actor:string,target:unknown):Promise<[unknown,number]>{
 const {data:me}=await db.from('profiles').select('role,suspended').eq('id',actor).maybeSingle();
 if(!me||me.role!=='owner'||me.suspended)return [{error:'Acceso solo para owner.'},403];
 if(typeof target!=='string'||!UUID.test(target))return [{error:'Cuenta no válida.'},400];
 const {data:found,error:findError}=await db.auth.admin.getUserById(target);
 const email=found?.user?.email;
 if(findError||!email)return [{error:'No se encontró la cuenta.'},404];
 const {data,error}=await db.auth.admin.generateLink({type:'recovery',email});
 const hashed=data?.properties?.hashed_token;
 if(error||!hashed)return [{error:'No se pudo crear el enlace. Inténtalo otra vez.'},500];
 await db.from('admin_audit').insert({actor,action:'recovery_link',target});
 return [{link:'https://kattomon.github.io/RedMusica/#recuperar='+encodeURIComponent(hashed)},200];
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
  const {data:{user},error:authError}=await db.auth.getUser(token);
  if(authError||!user)return reply({error:'Inicia sesión.'},401);
  const raw=await req.text();if(raw.length>4096)return reply({error:'Solicitud demasiado larga.'},413);
  const input=JSON.parse(raw);
  if(typeof input?.action!=='string' || (input.data!==undefined && (input.data===null || Array.isArray(input.data) || typeof input.data!=='object')))return reply({error:'Solicitud no válida.'},400);
  if(input.action==='recovery_link')return reply(...await recoveryLink(user.id,input.data?.id));
  const {data,error}=await db.rpc('site_manage',{p_actor:user.id,p_action:input.action,p_data:input.data||{}});
  if(error){const safe=/^(Acceso|No puedes|Solo puedes|Pedido|La radio|Acción)/.test(error.message);return reply({error:safe?error.message:'No se pudo guardar. Revisa los datos e inténtalo otra vez.'},403);}
  return reply(data);
 }catch{return reply({error:'No se pudo completar la solicitud.'},400);}
});
