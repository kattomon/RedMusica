import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
const headers={'Access-Control-Allow-Origin':'https://kattomon.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db=createClient(Deno.env.get('SUPABASE_URL')!,secret!,{auth:{persistSession:false,autoRefreshToken:false}});
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
  const {data,error}=await db.rpc('site_manage',{p_actor:user.id,p_action:input.action,p_data:input.data||{}});
  if(error){const safe=/^(Acceso|No puedes|Solo puedes|Pedido|La radio|Acción)/.test(error.message);return reply({error:safe?error.message:'No se pudo guardar. Revisa los datos e inténtalo otra vez.'},403);}
  return reply(data);
 }catch{return reply({error:'No se pudo completar la solicitud.'},400);}
});
