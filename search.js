const boton = document.getElementById("botonBuscar");
const estadoBusqueda = document.getElementById("estadoBusqueda");
let albumSeleccionado = null;
let numeroPublicacion = 0;

const masResultados = document.getElementById("masResultados");
let consultaActual = "";
let siguienteResultado = 0;
let ultimaPeticion = 0;

// Quote individual words so user input cannot become Lucene operators.
// Matching words independently also allows punctuation and title-order variations.
function consultarCampo(campo, texto) {
    return texto.split(/\s+/).filter(Boolean).map(function (palabra) {
        return campo + ':"' + palabra.replace(/[\\"]/g, "\\$&") + '"';
    }).join(" AND ");
}

document.getElementById("formularioBusqueda").addEventListener("submit", function (evento) {
    evento.preventDefault();
    const album = document.getElementById("buscarAlbum").value.trim();
    const artista = document.getElementById("buscarArtista").value.trim();
    if (boton.disabled) return;
    if (!album && !artista) {
        estadoBusqueda.textContent = "Escribe un artista o un álbum para buscar.";
        document.getElementById("buscarArtista").focus();
        return;
    }
    consultaActual = [artista && consultarCampo("artist", artista), album && consultarCampo("releasegroup", album)].filter(Boolean).join(" AND ");
    siguienteResultado = 0;
    document.getElementById("resultadosBusqueda").textContent = "";
    buscarResultados();
});

masResultados.addEventListener("click", function () {
    if (!boton.disabled && consultaActual) buscarResultados();
});

async function buscarResultados() {
    const contenedor = document.getElementById("resultadosBusqueda");
    estadoBusqueda.textContent = "Buscando música…";
    boton.disabled = true;
    masResultados.disabled = true;
    masResultados.hidden = siguienteResultado === 0;
    contenedor.setAttribute("aria-busy", "true");
    // MusicBrainz allows at most one request per second per client.
    await new Promise(function (resolve) { setTimeout(resolve, Math.max(0, 1100 - (Date.now() - ultimaPeticion))); });
    const controlador = new AbortController();
    const temporizador = setTimeout(function () { controlador.abort(); }, 15000);

    try {
        ultimaPeticion = Date.now();
        const url = "https://musicbrainz.org/ws/2/release-group/?query="
            + encodeURIComponent(consultaActual) + "&fmt=json&limit=20&offset=" + siguienteResultado;
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
            portada.loading = "lazy";
            asignarPortada(portada, urlPortada, titulo, artista);
            const nombre = document.createElement("h3");
            nombre.textContent = titulo;
            const nombreArtista = document.createElement("p");
            nombreArtista.textContent = artista;
            const detalle = document.createElement("p");
            detalle.className = "detalle-lanzamiento";
            const tipos = { Album: "Álbum", EP: "EP", Single: "Sencillo", Broadcast: "Emisión", Other: "Otro" };
            detalle.textContent = [tipos[resultado["primary-type"]] || resultado["primary-type"], (resultado["first-release-date"] || "").slice(0, 4), resultado.disambiguation].filter(Boolean).join(" · ");
            const botonElegir = document.createElement("button");
            botonElegir.type = "button";
            botonElegir.textContent = "Elegir";
            botonElegir.className = "boton-elegir";
            botonElegir.addEventListener("click", function () {
                document.getElementById("tituloAlbum").textContent = titulo;
                document.getElementById("artistaAlbum").textContent = artista;
                asignarPortada(document.getElementById("portadaAlbum"), urlPortada, titulo, artista);
                albumSeleccionado = { id: resultado.id, titulo: titulo, artista: artista, portada: urlPortada };
                document.getElementById("resultadoAlbum").hidden = false;
                document.getElementById("comentarioPublicacion").focus();
            });
            tarjeta.append(portada, nombre, nombreArtista, detalle, botonElegir);
            contenedor.appendChild(tarjeta);
        });
        siguienteResultado += resultados.length;
        const total = Number(datos.count) || siguienteResultado;
        masResultados.hidden = resultados.length === 0 || siguienteResultado >= total;
        estadoBusqueda.textContent = siguienteResultado
            ? "Mostrando " + siguienteResultado + " de " + total + " resultados. Elige un lanzamiento."
            : "No se encontraron lanzamientos en MusicBrainz. Prueba solo el artista o menos palabras. El catálogo puede no incluir todavía algunos discos.";
    } catch (error) {
        estadoBusqueda.textContent = "No se pudo completar la búsqueda. Inténtalo de nuevo en unos segundos.";
    } finally {
        clearTimeout(temporizador);
        boton.disabled = false;
        masResultados.disabled = false;
        contenedor.setAttribute("aria-busy", "false");
    }
}
