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
