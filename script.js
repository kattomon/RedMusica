const boton = document.getElementById("botonBuscar");

let albumSeleccionado = null;

boton.addEventListener("click", async function()  {
    
    const album = document.getElementById("buscarAlbum").value;

    const url   = "https://musicbrainz.org/ws/2/release-group/?query="
        +   encodeURIComponent('releasegroup:"' + album + '" AND primarytype:album')
        +"&fmt=json&limit=5";

    const respuesta = await fetch(url);

    const datos = await respuesta.json();

    const resultados = datos["release-groups"];

    const contenedor = document.getElementById("resultadosBusqueda");

    contenedor.innerHTML = "";

    resultados.forEach(function(resultado) {

    const titulo = resultado.title;

    const artista = resultado["artist-credit"][0].name;

    const idAlbum = resultado.id;

    const urlPortada =
        "https://coverartarchive.org/release-group/"
        + idAlbum
        + "/front-500";

    const tarjeta = document.createElement("div");

    tarjeta.classList.add("tarjeta-album");

    const portada = document.createElement("img");

    portada.src = urlPortada;

    portada.classList.add("portada-resultado");

    const nombre = document.createElement("h3");
    nombre.textContent = titulo;

    const nombreArtista = document.createElement("p");
    nombreArtista.textContent = artista;

    const botonElegir = document.createElement("button");
    botonElegir.textContent = "Elegir";
    botonElegir.classList.add("boton-elegir");
    botonElegir.addEventListener("click", function()    {

        document.getElementById("tituloAlbum").textContent = titulo;

        document.getElementById("artistaAlbum").textContent = artista;

        document.getElementById("portadaAlbum").src = urlPortada

        albumSeleccionado = {
            titulo: titulo,
            artista: artista,
            portada: urlPortada 
        };
    });

    tarjeta.appendChild(portada);
    tarjeta.appendChild(nombre);
    tarjeta.appendChild(nombreArtista);
    tarjeta.appendChild(botonElegir);

    contenedor.appendChild(tarjeta);

});

});

const botonPublicar = document.getElementById("botonPublicar");

botonPublicar.addEventListener("click", function(){

    const comentario =
         document.getElementById("comentarioPublicacion").value;

    if (albumSeleccionado === null){
        alert("Primero debes elegir un álbum.");
        return;
    }

    if (comentario.trim() === "") {
        alert("Escribe algo sobre el álbum.");
        return;
    }

    const feed = document.getElementById("feed");

    const publicacion = document.createElement("article");

    const portadaPublicacion = document.createElement("img");
    portadaPublicacion.src = albumSeleccionado.portada;
    portadaPublicacion.width = 250;

    const tituloPublicacion = document.createElement("h3");
    tituloPublicacion.textContent = albumSeleccionado.titulo;

    const artistaPublicacion = document.createElement("p");
    artistaPublicacion.textContent =
            "Artista: " + albumSeleccionado.artista;

    const usuarioPublicacion = document.createElement("h3");
    usuarioPublicacion.textContent = "Publicado por Iñigo";

    const textoPublicacion = document.createElement("p");
    textoPublicacion.textContent = comentario;

    publicacion.appendChild(portadaPublicacion);
    publicacion.appendChild(tituloPublicacion);
    publicacion.appendChild(artistaPublicacion);
    publicacion.appendChild(usuarioPublicacion);
    publicacion.appendChild(textoPublicacion);

        feed.appendChild(publicacion);
});
