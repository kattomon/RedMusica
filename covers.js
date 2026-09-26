// Cover Art Archive remains the primary source. Only exact artist/title matches
// from Apple's catalog may replace a missing cover; never take the first result.
const portadaAlternativa = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#eeeeee"/><text x="250" y="250" text-anchor="middle" fill="#444444" font-size="28">Portada no disponible</text></svg>'
);
const solicitudesPortada = new Map();
const estadosPortada = new WeakMap();
let colaPortadas = Promise.resolve();
let ultimaConsultaPortada = 0;
let numeroConsultaPortada = 0;

function consultarCatalogoApple(termino) {
    // Apple's documented cross-origin API uses JSONP (CORS is inconsistent).
    return new Promise(function (resolve, reject) {
        const callback = "redmusicaPortada" + (++numeroConsultaPortada);
        const script = document.createElement("script");
        let temporizador;
        function limpiar() {
            clearTimeout(temporizador);
            script.remove();
            // Ignore a response that arrives after timeout.
            window[callback] = function () {};
            setTimeout(() => { delete window[callback]; }, 60000);
        }
        window[callback] = function (datos) { limpiar(); resolve(datos); };
        script.onerror = function () { limpiar(); reject(new Error("Catálogo no disponible")); };
        temporizador = setTimeout(function () { limpiar(); reject(new Error("Tiempo de espera agotado")); }, 10000);
        script.src = "https://itunes.apple.com/search?entity=album&country=CL&limit=25&term=" + encodeURIComponent(termino) + "&callback=" + callback;
        document.head.appendChild(script);
    });
}

function normalizarMusica(texto) {
    return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function buscarPortadaAlternativa(titulo, artista) {
    const clave = normalizarMusica(artista) + "|" + normalizarMusica(titulo);
    if (solicitudesPortada.has(clave)) return solicitudesPortada.get(clave);
    const tarea = colaPortadas.then(async function () {
        // The Search API is limited to approximately 20 requests/minute.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 3100 - (Date.now() - ultimaConsultaPortada))));
        ultimaConsultaPortada = Date.now();
        const datos = await consultarCatalogoApple(artista + " " + titulo);
        const album = (datos.results || []).find(item => normalizarMusica(item.artistName) === normalizarMusica(artista) && normalizarMusica(item.collectionName) === normalizarMusica(titulo));
        if (!album) return null;
        const imagen = new URL(album.artworkUrl100);
        const enlace = new URL(album.collectionViewUrl);
        if (imagen.protocol !== "https:" || !imagen.hostname.endsWith(".mzstatic.com") || enlace.protocol !== "https:" || !["music.apple.com", "itunes.apple.com"].includes(enlace.hostname)) return null;
        enlace.searchParams.set("app", "itunes");
        return { imagen: imagen.href, enlace: enlace.href };
    });
    colaPortadas = tarea.catch(() => null);
    solicitudesPortada.set(clave, tarea);
    tarea.catch(() => solicitudesPortada.delete(clave));
    return tarea;
}

function asignarPortada(imagen, url, titulo, artista) {
    const anterior = estadosPortada.get(imagen);
    if (anterior && anterior.enlace) anterior.enlace.remove();
    const estado = {};
    estadosPortada.set(imagen, estado);
    imagen.alt = "Portada de " + titulo;
    imagen.onerror = async function () {
        imagen.onerror = null;
        imagen.src = portadaAlternativa;
        if (!artista) return;
        try {
            const alternativa = await buscarPortadaAlternativa(titulo, artista);
            if (!alternativa || estadosPortada.get(imagen) !== estado || !imagen.isConnected) return;
            const enlace = document.createElement("a");
            enlace.className = "fuente-portada";
            enlace.href = alternativa.enlace;
            enlace.target = "_blank";
            enlace.rel = "noopener noreferrer";
            const insignia = document.createElement("img");
            insignia.src = "https://tools.applemediaservices.com/api/badges/get-it-on-itunes/badge/es-es?size=120x40";
            insignia.alt = "Ver este álbum en iTunes";
            insignia.width = 120;
            insignia.height = 40;
            enlace.appendChild(insignia);
            estado.enlace = enlace;
            imagen.onerror = function () { imagen.onerror = null; imagen.src = portadaAlternativa; enlace.remove(); };
            imagen.src = alternativa.imagen;
            imagen.after(enlace);
        } catch (error) { /* Keep the placeholder; publishing stays available. */ }
    };
    imagen.src = url;
}
