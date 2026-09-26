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
                albumSeleccionado = { id: resultado.id, titulo: titulo, artista: artista, portada: urlPortada };
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
