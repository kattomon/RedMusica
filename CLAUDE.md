# RedMusica: guía para Claude Code

Red social sobre música, películas, libros y videojuegos. El dueño habla español; responde en español claro y sin jerga técnica innecesaria. Prioridades: estable, segura y cómoda en el celular.

> Este archivo es público (GitHub Pages sirve todo el repositorio). Nunca pongas aquí claves, contraseñas ni datos personales.

## Cómo está armado
- Sitio estático en GitHub Pages (`kattomon/RedMusica`, rama `main`). Se publica solo al hacer push a `main`.
- Backend en Supabase (proyecto `svnmwttoawpoavohfrya`): Postgres con RLS, Storage, Realtime y Edge Functions en `supabase/functions/`.
- Archivos principales: `index.html`, `script.js` (carga las secciones), `cloud.js` (cuenta, feed, perfiles, amigos, chat), `interface.js`, `service-worker.js` (PWA) y un archivo por juego: `pool.js`, `naipes.js`, `bachillerato.js`, `cancion.js`, `blackjack.js`.
- Juegos en línea: una Edge Function hace de árbitro (`pool`, `naipes`, `bachillerato`, `cancion`, `blackjack`). Las salas son tablas solo para `service_role`, con concurrencia optimista por `updated_at`. Realtime solo avisa "cambió" y el cliente vuelve a pedir el estado (con sondeo de respaldo).
- Más contexto: `README.md`, `BACKEND.md` y las notas del proyecto de Claude (`claude/mantenimiento.md`, `claude/pool-bola-8-y-migraciones.md`, `claude/perfil-escuchando-ahora.md`).

## Reglas al cambiar el sitio
- **Caché de la PWA:** el service worker guarda los archivos por URL exacta. Si cambias un archivo del shell:
  1. Sube su `?v=` donde se carga (en `index.html`, en `script.js` o en constantes como `ENGINE_URL` o `CARIOCA_URL`).
  2. Actualiza la misma URL en `SHELL_FILES` de `service-worker.js`.
  3. Cambia `SHELL_CACHE` (`redmusica-shell-vNN`).
  4. Actualiza también `tests/pwa-browser.cjs`.
- **Pool:** `supabase/functions/pool/engine.js` lo usan el servidor (decide los tiros) y el navegador (solo anima).
  - Si lo cambias, redespliega la función `pool` y publica el sitio a la vez.
  - El motor debe ser determinista: solo `+ - * /` y `Math.sqrt`. Nada de `Math.sin`, `Math.cos`, `Math.pow` ni `Math.random`.
- **Edge Functions:** al desplegar por el conector de Supabase hay que pasar todos los archivos de la función.
  - El conector convierte las secuencias `\uXXXX`, así que no las uses en esos archivos; usa `String.fromCharCode`.
  - Después de desplegar, compara con `get_edge_function` que quedó igual que lo local.
- No uses `Math.random` para nada que decida un servidor; los servidores usan `crypto`.

## Base de datos
- Antes de proponer cambios, revisa RLS, permisos (`grant` por columna) y migraciones.
- Después de aplicar, revisa los advisors de seguridad y rendimiento.
- Cada cambio va como migración en `supabase/migrations/` con el **mismo número de versión que quedó en remoto**: usa `list_migrations` después de aplicar y nombra el archivo con esa versión.
- No uses `supabase db push`: las migraciones antiguas tienen versiones locales distintas de las remotas.
- El conector cancela las sentencias que borran (DROP, DELETE en migraciones). Cuando haga falta borrar, prepara el SQL y pídele al dueño que lo corra en el SQL Editor de Supabase.
- Las funciones nuevas llevan `set search_path = ''`, y `revoke` para `anon`/`authenticated` si no son para el cliente.

## Pruebas
- Se corren con Node (por ejemplo `node tests/pool-logic.cjs`). Las de navegador usan Playwright: `TEST_CHROMIUM_ONLY=1 node tests/browser.cjs`.
- Antes de publicar, corre las pruebas de lo que tocaste y también `tests/browser.cjs` y `tests/pwa-browser.cjs`.
- Las pruebas `*-database.cjs` usan PGlite (`@electric-sql/pglite`).

## Trabajo con Git y publicación
- Commits claros, uno por tema. No edites la misma rama al mismo tiempo desde dos asistentes; para trabajos grandes usa una rama.
- No digas que algo está publicado sin comprobarlo. Para verificarlo: `gh api repos/kattomon/RedMusica/deployments` debe mostrar el commit nuevo, y su estado debe ser `success`.
- Nunca pidas ni guardes tokens o claves en el chat ni en el código. Los secretos van en los secretos de Supabase, y los configura el dueño.

## Contenido
- No reproduzcas personajes, marcas, letras ni arreglos de canciones con derechos de autor. Por ejemplo, el juego tipo UNO se llama «¡Última!» y no lleva su diseño.
- Spotify: la conexión directa de cuentas solo sirve para 5 usuarios (modo desarrollo). Si se quiere mostrar lo que alguien escucha, la vía para todos es Last.fm. Detalles en `claude/perfil-escuchando-ahora.md`.
