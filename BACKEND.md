Los errores del reproductor 2/5/100/101/150 saltan inmediatamente a la siguiente entrada disponible para ese oyente, aunque su horario común aún no haya comenzado. Los videos fallidos se excluyen durante la sesión de esa página; no se modifica la cola compartida. El botón Saltar para mí permite omitir una entrada manualmente. El error 153 se trata como configuración del reproductor, sin descartar todas las canciones. Las pruebas simulan estos códigos: no eliminan restricciones de copyright de YouTube.

La radio se abre desde el feed mediante radio-panel.js, en un panel fijo superior derecho. radio.html se carga dentro de un iframe del mismo origen; no se abre otra pestaña. Minimizar, pulsar Escape o cerrar el panel contrae la interfaz y mantiene el reproductor adjunto sin pausar; el botón Detener detiene la música expresamente. Al volver de una pestaña oculta, la página consulta el horario común y vuelve a sincronizar el video. El navegador, especialmente Safari en iPhone, puede suspender reproducción en segundo plano por sus propias reglas; la página ya no la pausa intencionalmente. Las portadas solicitan CAA 1200 px (con respaldo de 500 px) y Apple 600 px (con respaldo del recurso original).

# Cuentas y feed compartido

Estado: Supabase RedMusica (svnmwttoawpoavohfrya), región São Paulo, configurado el 26 de septiembre de 2026. La migración remota redmusica_initial_schema está aplicada y config.js activa el feed compartido.

La política de RedMusica es facilitar el registro: correo y contraseña, sin confirmar que el correo exista o pertenezca a la persona. El correo funciona como identificador de inicio de sesión y no se muestra en el perfil. La recuperación por correo está desactivada, así que la interfaz pide guardar la contraseña. Ningún correo debe considerarse verificado a efectos de identidad. No se guardan contraseñas en las tablas públicas.

La confirmación y la recuperación por correo no están habilitadas porque esta es la política elegida. Si el propietario decide cambiarla, deberá configurar SMTP, activar Confirm email en Supabase y cambiar emailConfirmationEnabled/passwordRecoveryEnabled en config.js. Comprobar envío y recepción reales antes de anunciar esas funciones.

Los datos antiguos de redmusica.local.v1 se conservan en el navegador y no se suben automáticamente. Dejando vacíos los valores de conexión en config.js puede recuperarse el prototipo local.

## Configuración para un proyecto nuevo o para habilitar verificación por correo

1. Conectar Supabase y elegir/crear un proyecto dedicado a RedMusica. No se necesita mover GitHub Pages.
2. En un proyecto nuevo, ejecutar `supabase/schema.sql` una vez en SQL Editor. La migración crea perfiles, publicaciones, likes y comentarios, sus índices, restricciones y políticas RLS dentro de una transacción. No desactivar RLS.
3. En Authentication, activar correo y contraseña con confirmación de correo. Configurar un mínimo de 8 caracteres.
4. Configurar Site URL y Redirect URLs con la URL real de GitHub Pages (habitualmente `https://kattomon.github.io/RedMusica/`). Añadir también la variante `index.html` si se va a visitar directamente.
5. Configurar SMTP para los correos de confirmación y recuperación antes de abrir registros al público. El SMTP de prueba de Supabase está limitado a direcciones del equipo del proyecto. No desactivar la confirmación para eludir esa limitación. Ver https://supabase.com/docs/guides/auth/auth-smtp.
6. Copiar a `config.js` solo la URL del proyecto y la **publishable key** (`sb_publishable_...`). Nunca usar `service_role`, secret keys, contraseñas de base de datos ni credenciales SMTP en el código público.
7. Probar con dos cuentas reales: registro y confirmación, inicio y cierre de sesión, recuperación de contraseña, publicación visible en el otro navegador, un like por cuenta y retirada del like, comentarios, edición y borrado únicamente del autor. Probar también el rechazo directo por la API de operaciones sobre publicaciones ajenas.
8. Hacer commit/push de `config.js` únicamente después de configurar y validar el proyecto. Incrementar la versión de caché en `index.html`.

## Arquitectura

- `script.js`: carga la búsqueda compartida y selecciona modo local o compartido según `config.js`.
- `search.js`: MusicBrainz y Cover Art Archive.
- `local.js`: conserva el prototipo local anterior.
- `cloud.js`: Supabase Auth y consultas del feed; nunca recibe contraseñas de otros usuarios ni decide los permisos del servidor.
- `supabase/schema.sql`: el servidor asigna el autor con `auth.uid()`. Solo se concede actualizar el texto de una publicación. Likes únicos por publicación/usuario. Borrar una publicación elimina sus likes y comentarios.
- `vendor/`: SDK Supabase JS 2.117.2 y licencia MIT, servido desde el propio sitio sin depender de un CDN en tiempo de ejecución.

El feed es público y se actualiza con el botón Actualizar; no hay suscripción en tiempo real. Se cargan 20 publicaciones por página y 50 comentarios (más recientes primero) por carga. Los correos y contraseñas no están en las tablas públicas.

## Pruebas reproducibles

Con Node instalado:

```sh
npm install
npx playwright install chromium webkit
npm test
```

`tests/database.cjs` ejecuta PostgreSQL mediante PGlite y prueba RLS con dos usuarios, lectura pública, escrituras autenticadas, autores inmutables, likes y nombres únicos y borrado en cascada.

`tests/browser.cjs` ejecuta el SDK real con respuestas API simuladas: prueba dos sesiones, registro, feed, likes, comentarios, edición/borrado, persistencia de sesión y fallos de red en Chromium/WebKit móvil. Estas pruebas **no verifican un Supabase desplegado ni el envío real de correos**; completar el paso 7 antes de activar.

## Validación del proyecto activo

Se probaron dos cuentas temporales reales contra Supabase: registro, inicio de sesión, búsqueda MusicBrainz, publicación compartida, comentario entre cuentas, like único, rechazo por API de edición/borrado ajenos y de cambios de autor, edición/borrado propios, recarga y cierre de sesión. Se usaron Chromium y WebKit con tamaño de iPhone. Las cuentas y publicaciones temporales se eliminaron después. Sin avisos del Security Advisor. La entrega de correos no está habilitada ni probada.
# Radio con YouTube

`radio.html` comparte la sesión de Supabase con el inicio. El usuario pulsa Entrar a escuchar y reproducir en el video; el reproductor permanece visible y se pausa cuando la página se oculta. No ofrece audio extraído ni reproducción con pantalla bloqueada. La cola tiene horarios comunes, pero las pausas, la carga y los anuncios pueden producir diferencias entre oyentes. Al terminar un video, el oyente pasa a la canción vigente de la sala. La consulta de estado se realiza cada 15 segundos solo con la página visible.

La función `supabase/functions/radio/index.ts` usa `YOUTUBE_API_KEY`, guardada en Edge Functions → Secrets, y limitada en Google Cloud a YouTube Data API v3. Nunca colocar esa clave en config.js. `verify_jwt=false` permite leer el estado sin cuenta; buscar y pedir exigen un JWT validado con `auth.getUser`. Las claves privadas de Supabase solo se leen del entorno del servidor.

Aplicar `supabase/radio.sql` una vez (migración remota `redmusica_youtube_radio`). Todas las tablas tienen RLS; solamente `service_role` puede llamar los RPC o escribir. Los RPC son SECURITY INVOKER y serializan reservas con bloqueos de transacción. No se confía en duración, título o autor enviados por el navegador: el servidor consulta YouTube antes de encolar. Máximo 20 canciones pendientes, 3 por usuario y sin videos duplicados pendientes. Se aceptan videos públicos e insertables de 20–1200 segundos disponibles en Chile.

Las búsquedas tienen caché de 24 horas: los fallos de caché reservan hasta 10 consultas por usuario y 90 compartidas por día (zona America/Los_Angeles, acorde al reinicio diario de YouTube). Los pedidos tienen límite de 30 por usuario y 300 globales por día. Estos límites se pueden ajustar revisando la cuota real del proyecto; no se ha activado facturación. La rotación sin pedidos usa canciones pedidas durante los últimos 7 días y comienza vacía. Los datos antiguos se limpian al consultar estado; la rotación no conserva indefinidamente las canciones antiguas.

Verificación: `tests/radio-database.cjs` prueba acceso, cuotas, duplicados, horarios y rotación; `tests/radio-browser.cjs` prueba UI con API/player simulados en Chromium y WebKit/iPhone. Una prueba real adicional verificó YouTube buscando Candelabro Refugio, un pedido, rechazo del duplicado y lectura anónima de la misma cola; se eliminó su usuario y pedido temporal. La reproducción audiovisual real depende de disponibilidad regional y restricciones de YouTube, y no se comprueba mediante el reproductor simulado.

## Administración y cabina de radio

Aplicar `supabase/admin.sql` después de `schema.sql` y `radio.sql`, y desplegar las funciones `admin` y `radio`. `admin` valida el token con `auth.getUser()` y obtiene el actor de esa respuesta; nunca confía en un ID ni en un rango enviado desde el navegador. Ambas funciones verifican la cuenta activa. La RPC `site_manage` solo permite ejecución al servidor y consulta el rango actual en cada operación.

- **member**: publicar, participar y cancelar sus pedidos pendientes.
- **admin**: ocultar/restaurar publicaciones y comentarios, suspender/reactivar miembros y gestionar la cola musical.
- **owner**: lo anterior, otorgar/retirar admin, gestionar otros administradores y cambiar título, descripción y apertura de publicaciones.

Nadie puede asignar `owner` desde el cliente ni modificar una cuenta owner. La asignación inicial se realiza desde la base de datos, después de confirmar la identidad. Los metadatos de registro no otorgan permisos. Las acciones quedan registradas en `admin_audit`, accesible únicamente mediante administración. La suspensión bloquea publicaciones, reacciones, comentarios, búsquedas y pedidos; no borra contenido ni cierra la sesión. La moderación oculta contenido de forma reversible.

La cabina permite poner una canción ahora o siguiente, quitarla, saltar para todos y pausar/reanudar la sala. Los clientes reciben el cambio en hasta 15 segundos mientras la radio está abierta. Reanudar vuelve a iniciar la selección pendiente. Los pedidos cancelados no vuelven a la rotación. La cabina es control de selección de YouTube: no incluye emisión de micrófono, mezcla de audio ni elimina restricciones de reproducción de YouTube.

Pruebas: `tests/admin-database.cjs` verifica RLS, ausencia de escalada de privilegios, protección del owner, revocación, moderación, suspensión, ajustes y cola. `tests/admin-browser.cjs` verifica el panel, acciones, cierre de sesión y diseño móvil con Chromium/WebKit. Los navegadores usan respuestas simuladas; la base usa PGlite. El despliegue también se comprueba con solicitudes sin token y con token inválido.

## Perfiles públicos y fotos

Aplicar `supabase/profiles.sql` después de `schema.sql` y `admin.sql`. El perfil público muestra el nombre, el rango, una presentación de hasta 300 caracteres y la foto si existe. Las publicaciones también incluyen avatar y rango del autor. El permiso de actualización se limita a `bio` y `avatar_updated_at`; el rango y el usuario siguen siendo de solo lectura para la persona.

Las fotos se guardan en el bucket público `avatars`, con una ruta fija por usuario. La interfaz admite JPG, PNG y WebP hasta 10 MB, los procesa localmente a JPEG cuadrado de 512x512 píxeles y menos de 1 MB. Storage valida el tipo y tamaño y las políticas RLS restringen insertar, actualizar o borrar al propio usuario activo. La descarga es pública porque se muestra en perfiles compartidos.

Pruebas: `tests/profiles-database.cjs` comprueba permisos de perfil, rango inmutable, validación del texto, ruta de avatar y suspensión. `tests/browser.cjs` verifica foto, presentación y rango en Chromium y WebKit.

## Seguimientos y notificaciones

Aplicar `supabase/social.sql` después de `schema.sql`, `admin.sql` y `profiles.sql`. El perfil público permite seguir o dejar de seguir; cada persona consulta sus propias notificaciones de comentarios, likes y seguimientos, puede marcarlas leídas y abrir la publicación relacionada. El servidor ignora acciones propias, impide que el cliente invente notificaciones y elimina avisos al borrar su publicación/comentario o retirar un like/seguimiento. Se guardan como máximo las 100 notificaciones recientes por cuenta; publicaciones, comentarios, likes y seguimientos no se purgan por esta regla.

El feed carga 20 publicaciones y los comentarios se piden al abrirlos. Las notificaciones se consultan al abrir el panel, en páginas de 30, y el contador consulta únicamente el total pendiente una vez por minuto con la pestaña visible. La radio ya limita sus datos temporales: búsqueda cacheada 24 horas, uso hasta 3 días y cola vieja hasta 7 días; la foto de perfil se comprime en el dispositivo a JPEG de 512×512 y menos de 1 MB. No se guardan imágenes de portadas en Supabase.

Prueba local: `tests/social-database.cjs` comprueba RLS, eventos automáticos, que no haya avisos de acciones propias, borrados relacionados, deduplicación y límite de 100. `tests/browser.cjs` cubre seguir, contador, comentarios, likes y marcar como leídas en Chromium y WebKit móvil.

## Memes y chat comunitario

Aplicar `supabase/community.sql` después de las otras migraciones. Inicio lista álbumes; `?seccion=memes` abre la sección de memes y `?seccion=peliculas` la de reseñas. Ambas tienen búsqueda/formulario y feed independientes, y los perfiles muestran todos los tipos de publicación. El catálogo de películas usa la API abierta de Wikidata y afiches de Wikimedia Commons; hay fichas sin imagen o metadatos. Las reseñas guardan puntuación de 0,5 a 5 estrellas. La migración incremental de producción está en `supabase/migrations/`.

La sección de memes acepta JPG/JPEG (incluido `.jpeg`), PNG y WebP; las imágenes se reducen en el dispositivo a JPEG de hasta 1280 píxeles y 1 MB. El bucket público solo admite JPEG y Storage limita cada cuenta a 15 imágenes de 1 MB. La eliminación del meme intenta borrar también su archivo. El texto alternativo de la imagen identifica a su autor.

El chat es una sala general compartida: leer es público, escribir requiere iniciar sesión con una cuenta activa y cada mensaje admite hasta 500 caracteres. Realtime actualiza los mensajes al instante cuando está disponible; si la conexión en tiempo real falla, la página consulta el chat cada 30 segundos mientras está visible. Se muestran hasta 50 mensajes recientes y la base conserva como máximo 500 en total. No hay mensajes privados ni historial permanente.

La radio se reduce a una barra en el mismo feed; el iframe sigue montado mientras se navega dentro de la página. Cerrar la pestaña o el navegador sí termina la reproducción, según las reglas del navegador y de YouTube.

`tests/community-database.cjs` comprueba rutas y límites de imágenes, autorización del chat, longitud y retención. `tests/browser.cjs` prueba publicar un meme, volver a cargarlo y enviar/cargar mensajes con el SDK simulado.

# Pool bola 8 en línea

El pool tiene su propia sección (`?seccion=pool`). Una persona crea una sala y comparte el código de seis caracteres o el enlace `?seccion=pool&pool=CÓDIGO`; la segunda persona que entra empieza la partida. Los enlaces antiguos de Juegos con un código de pool se redirigen a esta sección. Las victorias y derrotas aparecen en el perfil público.

## Arquitectura

- `supabase/functions/pool/engine.js`: física y reglas. La simulación solo usa suma, resta, multiplicación, división y `Math.sqrt`, operaciones exactas en IEEE 754, así que el servidor (Deno) y cualquier navegador obtienen la misma trayectoria a partir de la misma entrada. El navegador importa este mismo archivo para animar el tiro; nunca decide el resultado.
- `supabase/functions/pool/rooms.js`: entrar, salir (abandonar una partida en curso la pierde), reclamar la victoria si el rival no tira en cinco minutos y revancha (ambos deben aceptarla; saca quien perdió).
- `supabase/functions/pool/index.ts`: acciones `create`, `join`, `state`, `shoot`, `rematch`, `claim` y `leave`. Valida la sesión con `auth.getUser`, rechaza cuentas suspendidas, limita el cuerpo a 2 KiB y protege cada escritura con `updated_at` (dos cambios simultáneos no se pisan). El navegador solo envía dirección, fuerza y, con bola en mano, la posición de la blanca; el servidor valida todo y simula.
- `supabase/migrations/20260930200000_pool_rooms_and_stats.sql`: `pool_rooms` (salas de 24 horas) y `pool_matches` (historial) solo para `service_role`; `pool_stats` es de lectura pública y nadie más que el servidor la escribe. `record_pool_result` registra cada partida una sola vez (el id de partida es la clave) y solo puede ejecutarla `service_role`. Si registrar falla, se reintenta en la siguiente consulta de la sala.
- `pool.js` y `pool.css`: mesa en canvas (vertical en pantallas angostas), apuntar tocando o arrastrando, flechas y Enter en el teclado, control de fuerza, bola en mano, revancha y la línea de victorias del perfil. Consulta el estado cada 3 s mientras espera al rival y cada 10 s en su propio turno; se detiene con la pestaña oculta o fuera de Juegos.

Reglas simplificadas: no se canta tronera; la bola 8 que entra en el saque vuelve a su punto; una falta en el saque da bola en mano en toda la mesa.

## Publicación (en este orden)

1. Aplicar la migración: `supabase db push` o pegar el archivo en SQL Editor. Revisar después en Database → Policies que las tres tablas tengan RLS activo.
2. Desplegar la función: `supabase functions deploy pool`. Usa `SUPABASE_URL` y la clave de servicio que Supabase ya inyecta; no necesita secretos nuevos. Mantener la verificación de JWT activada (valor por defecto).
3. Recién entonces integrar la rama en `main` para que GitHub Pages publique la interfaz. Si la interfaz se publica antes, el pool muestra «El pool todavía no está disponible» y el resto del sitio sigue funcionando.

## Pruebas

`tests/pool-logic.cjs` (reglas, saque, faltas, bola 8, salas), `tests/pool-database.cjs` (RLS, permisos, registro único, borrado de cuentas) y `tests/pool-browser.cjs` (dos jugadores contra un servidor simulado con el motor real: saque con teclado, bola en mano tocando la mesa, victoria, revancha, salida, móvil sin desplazamiento lateral, contador en el perfil y trayectorias idénticas entre navegador y servidor).
