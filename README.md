# RedMusica

RedMusica es una red social para compartir música, películas, memes, videos, juegos y conversaciones.

## Instalar en el teléfono

RedMusica es una aplicación web progresiva (PWA). No hace falta descargar una app desde una tienda:

- **Android:** abre [RedMusica](https://kattomon.github.io/RedMusica/) en Chrome y toca **Instalar RedMusica**. También puedes usar el menú ⋮ y elegir **Instalar aplicación** o **Añadir a pantalla de inicio**.
- **iPhone o iPad:** abre el sitio en Safari, toca **Compartir** y luego **Añadir a pantalla de inicio**. Abre la app desde el icono para usarla como aplicación.

La app guarda la interfaz básica para poder abrirse sin conexión. Para cargar publicaciones, buscar contenido, chatear o escuchar la radio necesitas internet.

## Desarrollo y pruebas

El proyecto es una web estática y sus pruebas de navegador usan Playwright. Con Node.js instalado, ejecuta `npm test` para correr la suite completa.

## Interfaz y uso de recursos

`layout.css` organiza la cabecera, navegación, perfil y paneles flotantes; `sections.css` presenta los contenidos y `admin-ui.css` el área de administración. `interface.js` gestiona la presentación sin abrir nuevas conexiones a la base de datos. Las secciones comparten el reproductor de radio para conservar la reproducción al navegar.

- Las nuevas fotos se reducen antes de subir: avatares de hasta 512 px y 180 KiB, fotos de álbum hasta 1440 px y 600 KiB, e imágenes del muro/memes hasta 1280 px y 512 KiB. Los GIF conservan la animación y el límite de 1 MiB.
- El feed sigue paginado. El perfil no vuelve a consultar sus datos y contadores al pedir otra página, y el panel owner carga los listados al abrir su pestaña.
- El indicador de radio reutiliza el estado del reproductor abierto. Cuando deja de recibirlo, retoma su consulta habitual.
- La caché sin conexión solo guarda archivos de la aplicación y reemplaza versiones antiguas del mismo archivo. No guarda respuestas de la base de datos ni portadas de catálogos externos.
- `node_modules`, resultados de pruebas y secretos permanecen fuera de Git. Las imágenes que suben los usuarios se guardan en Storage, no en el repositorio.

Estas medidas reducen el consumo; las cuotas reales de alojamiento y base de datos dependen también del tráfico y deben revisarse en los paneles de cada proveedor. No se borra contenido de usuarios automáticamente para liberar espacio.
