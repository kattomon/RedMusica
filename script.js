const boton = document.getElementById("botonBuscar");
const estadoBusqueda = document.getElementById("estadoBusqueda");
let albumSeleccionado = null;
let numeroPublicacion = 0;

// Algunas ediciones no tienen portada en Cover Art Archive.
const portadaAlternativa = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#eeeeee"/><text x="250" y="250" text-anchor="middle" fill="#444444" font-size="28">Portada no disponible</text></svg>'
);

function asignarPortada(imagen, url, titulo) {
    imagen.alt = "Portada de " + titulo;
    imagen.onerror = function () {
        imagen.onerror = null;
        imagen.src = portadaAlternativa;
    };
    imagen.src = url;
}

document.getElementById("formularioBusqueda").addEventListener("submit", async function (evento) {
    evento.preventDefault();
    const album = document.getElementById("buscarAlbum").value.trim();
    if (!album || boton.disabled) return;

    const contenedor = document.getElementById("resultadosBusqueda");
    contenedor.textContent = "";
    estadoBusqueda.textContent = "Buscando álbumes…";
    boton.disabled = true;
    const controlador = new AbortController();
    const temporizador = setTimeout(function () { controlador.abort(); }, 15000);

    try {
        const consulta = 'releasegroup:"' + album.replace(/[\\"]/g, "\\$&") + '" AND primarytype:album';
        const url = "https://musicbrainz.org/ws/2/release-group/?query="
            + encodeURIComponent(consulta) + "&fmt=json&limit=5";
        const respuesta = await fetch(url, { signal: controlador.signal });
        if (!respuesta.ok) throw new Error("MusicBrainz: " + respuesta.status);
        const datos = await respuesta.json();
        const resultados = datos["release-groups"] || [];

        resultados.forEach(function (resultado) {
            const titulo = resultado.title;
            const artista = (resultado["artist-credit"] || []).map(function (credito) {
                return (credito.name || (credito.artist && credito.artist.name) || "") + (credito.joinphrase || "");
            }).join("") || "Artista desconocido";
            const urlPortada = "https://coverartarchive.org/release-group/" + resultado.id + "/front-500";
            const tarjeta = document.createElement("div");
            tarjeta.className = "tarjeta-album";
            const portada = document.createElement("img");
            portada.className = "portada-resultado";
            asignarPortada(portada, urlPortada, titulo);
            const nombre = document.createElement("h3");
            nombre.textContent = titulo;
            const nombreArtista = document.createElement("p");
            nombreArtista.textContent = artista;
            const botonElegir = document.createElement("button");
            botonElegir.type = "button";
            botonElegir.textContent = "Elegir";
            botonElegir.className = "boton-elegir";
            botonElegir.addEventListener("click", function () {
                document.getElementById("tituloAlbum").textContent = titulo;
                document.getElementById("artistaAlbum").textContent = artista;
                asignarPortada(document.getElementById("portadaAlbum"), urlPortada, titulo);
                albumSeleccionado = { titulo: titulo, artista: artista, portada: urlPortada };
                document.getElementById("resultadoAlbum").hidden = false;
                document.getElementById("comentarioPublicacion").focus();
            });
            tarjeta.append(portada, nombre, nombreArtista, botonElegir);
            contenedor.appendChild(tarjeta);
        });
        estadoBusqueda.textContent = resultados.length ? "Elige un álbum de los resultados." : "No se encontraron álbumes. Prueba otro nombre.";
    } catch (error) {
        estadoBusqueda.textContent = "No se pudo completar la búsqueda. Inténtalo de nuevo en unos segundos.";
    } finally {
        clearTimeout(temporizador);
        boton.disabled = false;
    }
});

function agregarInteracciones(publicacion, datos) {
    const botonLike = document.createElement("button");
    botonLike.type = "button";
    botonLike.textContent = "♡ Me gusta (" + datos.likes + ")";
    botonLike.addEventListener("click", function () {
        if (!exigirPerfil()) return;
        datos.likes++;
        botonLike.textContent = "♡ Me gusta (" + datos.likes + ")";
        guardarEstado();
    });

    const botonComentar = document.createElement("button");
    botonComentar.type = "button";
    botonComentar.textContent = "Comentar";
    botonComentar.setAttribute("aria-expanded", "false");
    const zonaComentarios = document.createElement("div");
    zonaComentarios.className = "zona-comentarios";
    zonaComentarios.id = "comentarios-" + (++numeroPublicacion);
    zonaComentarios.hidden = true;
    botonComentar.setAttribute("aria-controls", zonaComentarios.id);
    const formularioComentario = document.createElement("form");
    formularioComentario.className = "fila-controles";
    const inputComentario = document.createElement("input");
    inputComentario.type = "text";
    inputComentario.placeholder = "Escribe un comentario";
    inputComentario.setAttribute("aria-label", "Escribe un comentario");
    inputComentario.maxLength = 1000;
    inputComentario.required = true;
    const botonEnviarComentario = document.createElement("button");
    botonEnviarComentario.type = "submit";
    botonEnviarComentario.textContent = "Enviar";
    const listaComentarios = document.createElement("div");
    listaComentarios.className = "lista-comentarios";
    listaComentarios.setAttribute("aria-live", "polite");
    function mostrarComentario(comentario) {
        const comentarioNuevo = document.createElement("p");
        comentarioNuevo.textContent = comentario.autor + ": " + comentario.texto;
        listaComentarios.appendChild(comentarioNuevo);
    }
    datos.comentarios.forEach(mostrarComentario);
    botonComentar.addEventListener("click", function () {
        zonaComentarios.hidden = !zonaComentarios.hidden;
        botonComentar.setAttribute("aria-expanded", String(!zonaComentarios.hidden));
        if (!zonaComentarios.hidden) inputComentario.focus();
    });
    formularioComentario.addEventListener("submit", function (evento) {
        evento.preventDefault();
        if (!exigirPerfil()) return;
        const textoComentario = inputComentario.value.trim();
        if (!textoComentario) return;
        const comentario = { autor: estadoLocal.perfil, texto: textoComentario };
        datos.comentarios.push(comentario);
        mostrarComentario(comentario);
        guardarEstado();
        inputComentario.value = "";
        inputComentario.focus();
    });
    formularioComentario.append(inputComentario, botonEnviarComentario);
    zonaComentarios.append(formularioComentario, listaComentarios);
    const acciones = document.createElement("div");
    acciones.className = "acciones";
    acciones.append(botonLike, botonComentar);
    publicacion.append(acciones, zonaComentarios);
}

function mostrarPublicacion(datos) {
    const publicacion = document.createElement("article");
    const portadaPublicacion = document.createElement("img");
    portadaPublicacion.width = 250;
    portadaPublicacion.height = 250;
    asignarPortada(portadaPublicacion, datos.album.portada, datos.album.titulo);
    const tituloPublicacion = document.createElement("h3");
    tituloPublicacion.textContent = datos.album.titulo;
    const artistaPublicacion = document.createElement("p");
    artistaPublicacion.textContent = "Artista: " + datos.album.artista;
    const usuarioPublicacion = document.createElement("p");
    usuarioPublicacion.className = "autor-publicacion";
    usuarioPublicacion.textContent = "Publicado por " + datos.autor;
    const textoPublicacion = document.createElement("p");
    textoPublicacion.className = "opinion";
    textoPublicacion.textContent = datos.texto;
    publicacion.append(usuarioPublicacion, portadaPublicacion, tituloPublicacion, artistaPublicacion, textoPublicacion);
    agregarInteracciones(publicacion, datos);
    document.getElementById("feed").prepend(publicacion);
    document.getElementById("feedVacio").hidden = true;
}

document.getElementById("botonPublicar").addEventListener("click", function () {
    if (!exigirPerfil()) return;
    const opinion = document.getElementById("comentarioPublicacion");
    const comentario = opinion.value.trim();
    const estado = document.getElementById("estadoPublicacion");
    if (albumSeleccionado === null) {
        estado.textContent = "Primero debes elegir un álbum.";
        return;
    }
    if (!comentario) {
        estado.textContent = "Escribe algo sobre el álbum.";
        opinion.focus();
        return;
    }
    const publicacion = {
        autor: estadoLocal.perfil,
        album: { ...albumSeleccionado },
        texto: comentario,
        likes: 0,
        comentarios: []
    };
    estadoLocal.publicaciones.push(publicacion);
    mostrarPublicacion(publicacion);
    guardarEstado();
    opinion.value = "";
    estado.textContent = "Publicación agregada.";
});

// Estos datos son una prueba local, no un sistema de autenticación.
const claveAlmacenamiento = "redmusica.local.v1";
let estadoLocal = { perfil: null, publicaciones: [] };

function nombreValido(nombre) {
    return typeof nombre === "string" && nombre.trim().length >= 2 && nombre.length <= 30;
}

function publicacionValida(datos) {
    return datos && nombreValido(datos.autor) && typeof datos.texto === "string"
        && datos.album && typeof datos.album.titulo === "string"
        && typeof datos.album.artista === "string" && typeof datos.album.portada === "string"
        && /^https:\/\/coverartarchive\.org\/release-group\/[a-f0-9-]+\/front-500$/.test(datos.album.portada)
        && Number.isSafeInteger(datos.likes) && datos.likes >= 0
        && Array.isArray(datos.comentarios) && datos.comentarios.every(function (comentario) {
            return comentario && nombreValido(comentario.autor) && typeof comentario.texto === "string";
        });
}

function guardarEstado() {
    try {
        localStorage.setItem(claveAlmacenamiento, JSON.stringify(estadoLocal));
        document.getElementById("estadoGuardado").textContent = "";
    } catch (error) {
        document.getElementById("estadoGuardado").textContent = "No se pudo guardar en este navegador. Los cambios de esta sesión se perderán al recargar.";
    }
}

function mostrarPerfil() {
    const tienePerfil = estadoLocal.perfil !== null;
    document.getElementById("formularioPerfil").hidden = tienePerfil;
    document.getElementById("sesionPerfil").hidden = !tienePerfil;
    document.getElementById("nombrePerfil").textContent = tienePerfil ? "Publicas como " + estadoLocal.perfil : "";
}

function exigirPerfil() {
    if (estadoLocal.perfil !== null) return true;
    document.getElementById("estadoPerfil").textContent = "Crea un perfil local con tu nombre para participar.";
    document.getElementById("nombreUsuario").focus();
    return false;
}

document.getElementById("formularioPerfil").addEventListener("submit", function (evento) {
    evento.preventDefault();
    const nombre = document.getElementById("nombreUsuario").value.trim();
    if (!nombreValido(nombre)) {
        document.getElementById("estadoPerfil").textContent = "Escribe un nombre de entre 2 y 30 caracteres.";
        return;
    }
    estadoLocal.perfil = nombre;
    guardarEstado();
    mostrarPerfil();
    document.getElementById("estadoPerfil").textContent = "Tu perfil local está listo. Ya puedes publicar.";
});

document.getElementById("cerrarSesion").addEventListener("click", function () {
    estadoLocal.perfil = null;
    guardarEstado();
    mostrarPerfil();
    document.getElementById("nombreUsuario").value = "";
    document.getElementById("estadoPerfil").textContent = "Saliste del perfil. Las publicaciones siguen guardadas en este navegador.";
});

try {
    const guardado = localStorage.getItem(claveAlmacenamiento);
    if (guardado !== null) {
        const datos = JSON.parse(guardado);
        if (!datos || !(datos.perfil === null || nombreValido(datos.perfil))
            || !Array.isArray(datos.publicaciones) || !datos.publicaciones.every(publicacionValida)) {
            throw new Error("Datos locales no válidos");
        }
        estadoLocal = datos;
    }
} catch (error) {
    document.getElementById("estadoGuardado").textContent = "No se pudieron recuperar los datos locales. Puedes crear un perfil para esta sesión.";
}
mostrarPerfil();
estadoLocal.publicaciones.forEach(mostrarPublicacion);
