Los errores del reproductor 2/5/100/101/150 saltan inmediatamente a la siguiente entrada disponible para ese oyente, aunque su horario común aún no haya comenzado. Los videos fallidos se excluyen durante la sesión de esa página; no se modifica la cola compartida. El botón Saltar para mí permite omitir una entrada manualmente. El error 153 se trata como configuración del reproductor, sin descartar todas las canciones. Las pruebas simulan estos códigos: no eliminan restricciones de copyright de YouTube.

La radio se abre desde el feed mediante radio-panel.js, en un panel fijo superior derecho. radio.html se carga dentro de un iframe del mismo origen; no se abre otra pestaña. El panel conserva su estado al cerrar, pausa el reproductor y permite volver al feed con Escape. Las portadas solicitan CAA 1200 px (con respaldo de 500 px) y Apple 600 px (con respaldo del recurso original).

# Cuentas y feed compartido

Estado: Supabase RedMusica (svnmwttoawpoavohfrya), región São Paulo, configurado el 26 de septiembre de 2026. La migración remota redmusica_initial_schema está aplicada y config.js activa el feed compartido.

Por decisión del propietario, esta primera prueba permite correo y contraseña SIN confirmar el correo. La recuperación por correo está desactivada en la interfaz. Ningún correo debe considerarse verificado a efectos de identidad. No se guardan contraseñas en las tablas públicas.

Cuando haya SMTP, activar Confirm email en Supabase y cambiar emailConfirmationEnabled/passwordRecoveryEnabled a true en config.js. Comprobar envío y recepción reales antes de anunciar esas funciones.

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
