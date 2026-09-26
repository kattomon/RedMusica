const boton = document.getElementById("botonBuscar");
const estadoBusqueda = document.getElementById("estadoBusqueda");
let albumSeleccionado = null;
let numeroPublicacion = 0;

// Algunas ediciones no tienen portada en Cover Art Archive.
const portadaAlternativa = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#e2e8f0"/><text x="250" y="250" text-anchor="middle" fill="#334155" font-size="28">Portada no disponible</text></svg>'
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

function agregarInteracciones(publicacion) {
    let cantidadLikes = 0;
    const botonLike = document.createElement("button");
    botonLike.type = "button";
    botonLike.textContent = "♡ Me gusta (0)";
    botonLike.addEventListener("click", function () {
        cantidadLikes++;
        botonLike.textContent = "♡ Me gusta (" + cantidadLikes + ")";
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
    inputComentario.required = true;
    const botonEnviarComentario = document.createElement("button");
    botonEnviarComentario.type = "submit";
    botonEnviarComentario.textContent = "Enviar";
    const listaComentarios = document.createElement("div");
    listaComentarios.className = "lista-comentarios";
    listaComentarios.setAttribute("aria-live", "polite");

    botonComentar.addEventListener("click", function () {
        zonaComentarios.hidden = !zonaComentarios.hidden;
        botonComentar.setAttribute("aria-expanded", String(!zonaComentarios.hidden));
        if (!zonaComentarios.hidden) inputComentario.focus();
    });
    formularioComentario.addEventListener("submit", function (evento) {
        evento.preventDefault();
        const textoComentario = inputComentario.value.trim();
        if (!textoComentario) return;
        const comentarioNuevo = document.createElement("p");
        comentarioNuevo.textContent = "Iñigo: " + textoComentario;
        listaComentarios.appendChild(comentarioNuevo);
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

document.getElementById("botonPublicar").addEventListener("click", function () {
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
    const publicacion = document.createElement("article");
    const portadaPublicacion = document.createElement("img");
    portadaPublicacion.width = 250;
    portadaPublicacion.height = 250;
    asignarPortada(portadaPublicacion, albumSeleccionado.portada, albumSeleccionado.titulo);
    const tituloPublicacion = document.createElement("h3");
    tituloPublicacion.textContent = albumSeleccionado.titulo;
    const artistaPublicacion = document.createElement("p");
    artistaPublicacion.textContent = "Artista: " + albumSeleccionado.artista;
    const usuarioPublicacion = document.createElement("p");
    usuarioPublicacion.textContent = "Publicado por Iñigo";
    const textoPublicacion = document.createElement("p");
    textoPublicacion.className = "opinion";
    textoPublicacion.textContent = comentario;
    publicacion.append(portadaPublicacion, tituloPublicacion, artistaPublicacion, usuarioPublicacion, textoPublicacion);
    agregarInteracciones(publicacion);
    document.getElementById("feed").appendChild(publicacion);
    opinion.value = "";
    estado.textContent = "Publicación agregada.";
});

// La recomendación original conserva su contenido y ahora también es interactiva.
document.querySelectorAll("#feed article").forEach(agregarInteracciones);
