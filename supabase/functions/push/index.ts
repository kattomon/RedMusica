import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';

const origin = 'https://kattomon.github.io';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-redmusica-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const secretKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(supabaseUrl, secretKey!, { auth: { persistSession: false, autoRefreshToken: false } });

async function getConfig() {
  const { data, error } = await db.rpc('redmusica_push_config');
  if (error) throw new Error('No se pudo cargar la configuración push.');
  return data as Record<string, string>;
}

async function currentUser(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await db.from('profiles').select('suspended').eq('id', user.id).maybeSingle();
  return profile && !profile.suspended ? user : null;
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname.endsWith('.push.services.mozilla.com') ||
      url.hostname.endsWith('.fcm.googleapis.com') ||
      url.hostname.endsWith('.push.apple.com') ||
      url.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}

async function deliver(recipientId: string, event: Record<string, unknown>, config: Record<string, string>) {
  const { data: subscriptions, error } = await db.from('push_subscriptions').select('endpoint,subscription').eq('user_id', recipientId).limit(5);
  if (error) throw error;
  if (!subscriptions?.length) return { delivered: 0 };

  const actorId = typeof event.actor_id === 'string' ? event.actor_id : '';
  const { data: actor } = actorId ? await db.from('profiles').select('username').eq('id', actorId).maybeSingle() : { data: null };
  const username = actor?.username ? `@${actor.username}` : 'Alguien';
  const kind = event.kind;
  let title = 'RedMusica';
  let body = 'Tienes una nueva notificación.';
  let url = './';
  if (kind === 'message') {
    const preview = typeof event.preview === 'string' ? event.preview.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    title = `${username} · RedMusica`; body = preview || `${username} te envió un mensaje.`;
    url = actorId ? `./?chat=${encodeURIComponent(actorId)}` : './?seccion=amigos';
  } else if (kind === 'follow') {
    title = 'Nuevo seguidor · RedMusica'; body = `${username} empezó a seguirte.`; url = actorId ? `./?perfil=${encodeURIComponent(actorId)}` : './?seccion=amigos';
  } else if (kind === 'like' || kind === 'comment') {
    const postId = typeof event.post_id === 'string' ? event.post_id : '';
    const { data: post } = postId ? await db.from('posts').select('album_title,film_title,body').eq('id', postId).maybeSingle() : { data: null };
    const subject = post?.album_title || post?.film_title || (post?.body ? 'tu publicación' : 'una publicación');
    title = kind === 'like' ? 'Nuevo Me gusta · RedMusica' : 'Nuevo comentario · RedMusica';
    body = kind === 'like' ? `${username} indicó que le gusta ${subject}.` : `${username} comentó en ${subject}.`;
    url = postId ? `./?perfil=${encodeURIComponent(recipientId)}#${encodeURIComponent(postId)}` : './';
  }
  // Messages from the same person stack into one notification that renews (renotify), like a chat thread.
  const tag = kind === 'message' && actorId ? `redmusica-chat-${actorId}` : `redmusica-${kind}-${crypto.randomUUID()}`;
  const payload = JSON.stringify({ title, body, url, tag, kind, renotify: kind === 'message' });
  webpush.setVapidDetails(config.redmusica_push_subject, config.redmusica_push_public_key, config.redmusica_push_private_key);
  let delivered = 0;
  await Promise.all(subscriptions.map(async row => {
    try {
      await webpush.sendNotification(row.subscription, payload, { TTL: kind === 'message' ? 6 * 60 * 60 : 60, urgency: kind === 'message' ? 'high' : 'normal' });
      delivered++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
    }
  }));
  return { delivered };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 10000) return reply({ error: 'Solicitud demasiado larga.' }, 413);
    const input = JSON.parse(raw);
    const config = await getConfig();

    if (input.action === 'public-key') {
      if (!config.redmusica_push_public_key) return reply({ error: 'Los avisos para este dispositivo aún no están configurados.' }, 503);
      return reply({ publicKey: config.redmusica_push_public_key });
    }

    if (input.action === 'dispatch') {
      if (!config.redmusica_push_webhook_secret || req.headers.get('x-redmusica-push-secret') !== config.redmusica_push_webhook_secret) return reply({ error: 'No autorizado.' }, 401);
      if (typeof input.recipient_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.recipient_id) || !input.event || typeof input.event !== 'object') return reply({ error: 'Evento no válido.' }, 400);
      if (!config.redmusica_push_public_key || !config.redmusica_push_private_key || !config.redmusica_push_subject) return reply({ error: 'Push no configurado.' }, 503);
      return reply(await deliver(input.recipient_id, input.event, config));
    }

    const user = await currentUser(req);
    if (!user) return reply({ error: 'Inicia sesión para configurar avisos.' }, 401);
    if (input.action === 'subscribe') {
      const sub = input.subscription;
      if (!sub || !validEndpoint(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string' || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) return reply({ error: 'Suscripción de avisos no válida.' }, 400);
      const { error } = await db.from('push_subscriptions').upsert({ endpoint: sub.endpoint, user_id: user.id, subscription: sub, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
      if (error) throw error;
      const { data: devices, error: listError } = await db.from('push_subscriptions').select('endpoint').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(20);
      if (listError) throw listError;
      if (devices && devices.length > 5) {
        const expired = devices.slice(5).map(device => device.endpoint);
        const { error: trimError } = await db.from('push_subscriptions').delete().eq('user_id', user.id).in('endpoint', expired);
        if (trimError) throw trimError;
      }
      return reply({ ok: true });
    }
    if (input.action === 'unsubscribe') {
      if (!validEndpoint(input.endpoint)) return reply({ error: 'Dispositivo no válido.' }, 400);
      const { error } = await db.from('push_subscriptions').delete().eq('endpoint', input.endpoint).eq('user_id', user.id);
      if (error) throw error;
      return reply({ ok: true });
    }
    return reply({ error: 'Acción no válida.' }, 400);
  } catch {
    return reply({ error: 'No se pudo completar la configuración de avisos.' }, 500);
  }
});
