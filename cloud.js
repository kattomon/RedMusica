/* Shared mode: authorization is enforced by Supabase RLS, not by these buttons. */
(function () {
    const config = window.REDMUSICA_CONFIG;
    const db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    window.redmusicaClient = db;
    let perfilSolicitado = new URLSearchParams(location.search).get("perfil");
    let viendoPerfil = perfilSolicitado !== null;
    let viendoMemes = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'memes';
    let viendoPeliculas = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'peliculas';
    let viendoAmigos = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'amigos';
    let viendoActividad = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'actividad';
    let viendoGuardados = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'guardados';
    let viendoListas = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'listas';
    let viendoEventos = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'eventos';
    let viendoVideos = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'videos';
    let viendoJuegos = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'juegos';
    let viendoMusica = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'musica';
    let viendoBlackjack = !viendoPerfil && new URLSearchParams(location.search).get('seccion') === 'blackjack';
    let listaActualId = new URLSearchParams(location.search).get('lista');
    let idPerfilValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(perfilSolicitado || "");
    let presenceChannel = null;
    let presenceOwner = null;
    const presenciaEnLinea = new Set();
    const dialogoGif=document.getElementById('selectorGif');
    let formularioGifActivo=null;
    let giphyApiKey='';
    async function cargarClaveGiphy(){if(giphyApiKey)return giphyApiKey;try{const {data,error}=await db.from('site_gif_settings').select('api_key').eq('id',true).maybeSingle();if(!error)giphyApiKey=data?.api_key||'';}catch{}return giphyApiKey;}
    function urlGifPermitida(value){try{const url=new URL(value);return url.protocol==='https:'&&(/\.giphy\.com$|\.giphyusercontent\.com$/.test(url.hostname))&&/\.gif$/i.test(url.pathname);}catch{return false;}}
    function pintarTextoConGif(container,value){const text=String(value||''),match=text.match(/(?:\r?\n)?\[GIF\]\s*(https:\/\/\S+)\s*$/);container.textContent=match?text.slice(0,match.index).trimEnd():text;if(match&&urlGifPermitida(match[1])){const image=document.createElement('img');image.className='gif-compartido';image.src=match[1];image.alt='GIF de GIPHY';image.loading='lazy';image.referrerPolicy='no-referrer';container.append(document.createElement('br'),image);}}
    function prepararCuerpo(form,input,limit){const text=input.value.trim(),gif=form.querySelector('.url-gif-adjunto')?.value||'',body=text+(gif?(text?'\n':'')+'[GIF] '+gif:'');if(body.length>limit)throw Error('El texto más el GIF supera el límite del mensaje. Acorta el texto.');return body;}
    function adjuntarGif(form,url){if(!form||!urlGifPermitida(url))return;let field=form.querySelector('.url-gif-adjunto');if(!field){field=document.createElement('input');field.type='hidden';field.className='url-gif-adjunto';form.append(field);}field.value=url;let preview=form.querySelector('.gif-vista-previa');if(!preview){preview=document.createElement('img');preview.className='gif-vista-previa';preview.alt='GIF seleccionado';preview.loading='lazy';preview.width=200;preview.height=112;form.append(preview);}preview.src=url;}
    document.addEventListener('click',async event=>{const button=event.target.closest('.abrir-selector-gif');if(!button)return;formularioGifActivo=button.closest('form');const status=document.getElementById('estadoSelectorGif');if(!dialogoGif.open)dialogoGif.showModal();status.textContent='Conectando con GIPHY…';document.getElementById('textoBuscarGifs').focus();status.textContent=await cargarClaveGiphy()?'Busca y toca un GIF para añadirlo.':'La búsqueda está desactivada. La cuenta owner puede configurar una clave pública de GIPHY en Administración.';});
    document.getElementById('buscarGifs').addEventListener('submit',async event=>{event.preventDefault();const status=document.getElementById('estadoSelectorGif'),results=document.getElementById('resultadosGifs'),query=document.getElementById('textoBuscarGifs').value.trim();if(!await cargarClaveGiphy()){status.textContent='La cuenta owner puede configurar la clave pública de GIPHY en Administración.';return;}status.textContent='Buscando…';results.replaceChildren();try{const url=new URL('https://api.giphy.com/v1/gifs/search');url.searchParams.set('api_key',giphyApiKey);url.searchParams.set('q',query);url.searchParams.set('limit','18');url.searchParams.set('rating','g');url.searchParams.set('lang','es');const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const payload=await response.json();for(const gif of payload.data||[]){const full=gif.images?.original?.url,thumb=gif.images?.fixed_width_small?.url;if(!urlGifPermitida(full)||!thumb)continue;const item=document.createElement('button');item.type='button';item.className='gif-resultado';const image=document.createElement('img');image.src=thumb;image.alt=gif.title||'GIF';image.loading='lazy';image.referrerPolicy='no-referrer';item.append(image);item.addEventListener('click',()=>{adjuntarGif(formularioGifActivo,full);dialogoGif.close();formularioGifActivo?.querySelector('input:not([type=hidden])')?.focus();});results.append(item);}status.textContent=results.childElementCount?'Toca un GIF para adjuntarlo.':'No encontramos GIFs para esa búsqueda.';}catch{status.textContent='No se pudieron cargar los GIFs. Inténtalo de nuevo en un momento.';}});
    let revisionAmigos = 0;
    let canalMensajesPrivados = null, propietarioMensajesPrivados = null;
    let amigoChatActivo = null, mensajesPrivadosCargados = new Set();
    document.getElementById("navegacion").hidden = false;
    document.getElementById("perfilPublico").hidden = !viendoPerfil;
    document.getElementById("crearPublicacion").hidden = !viendoMusica;
    document.getElementById('compositorMuro').hidden = viendoPerfil || viendoMemes || viendoPeliculas || viendoAmigos || viendoActividad || viendoGuardados || viendoListas || viendoEventos || viendoVideos || viendoJuegos || viendoMusica || viendoBlackjack;
    document.getElementById('crearMeme').hidden = !viendoMemes;
    document.getElementById('seccionPeliculas').hidden = !viendoPeliculas;
    document.getElementById('seccionListas').hidden = !viendoListas;
    document.getElementById('seccionEventos').hidden = !viendoEventos;
    document.getElementById('seccionVideos').hidden = !viendoVideos;
    document.getElementById('seccionJuegos').hidden = !viendoJuegos;
    document.getElementById('seccionBlackjack').hidden = !viendoBlackjack;
    document.getElementById('memesNav').setAttribute('aria-current',viendoMemes?'page':'false');
    document.getElementById('peliculasNav').setAttribute('aria-current',viendoPeliculas?'page':'false');
    document.getElementById('amigosNav').hidden = !viendoAmigos;
    document.getElementById('seccionAmigos').hidden = !viendoAmigos;
    document.getElementById('inicioNav').setAttribute('aria-current',!viendoPerfil&&!viendoMemes&&!viendoPeliculas&&!viendoAmigos&&!viendoEventos&&!viendoMusica?'page':'false');
    document.getElementById('musicaNav').setAttribute('aria-current',viendoMusica?'page':'false');
    if(viendoAmigos)document.title='Amigos · RedMusica';
    if (viendoPerfil) {
        document.getElementById("tituloFeed").textContent = "Publicaciones de este perfil";
        document.getElementById("feedVacio").textContent = "Este usuario todavía no ha publicado.";
        document.title = "Perfil · RedMusica";
    } else if(viendoMemes) {
        document.getElementById('tituloFeed').textContent='Memes de la comunidad';
        document.getElementById('feedVacio').textContent='Todavía no hay memes. ¡Comparte el primero!';
        document.title='Memes · RedMusica';
    } else if(viendoPeliculas) {
        document.getElementById('tituloFeed').textContent='Reseñas de películas';
        document.getElementById('feedVacio').textContent='Todavía no hay reseñas. ¡Comparte la primera!';
        document.title='Películas · RedMusica';
    }
    function fotoPerfil(id, datos) {
        const caja = document.createElement('span'); caja.className = 'avatar';
        caja.textContent = (datos.username || '?').slice(0, 2).toUpperCase();
        caja.setAttribute('aria-label', 'Foto de @' + datos.username);
        if (datos.avatar_updated_at) {
            const img = document.createElement('img'); img.alt = ''; img.width = 64; img.height = 64; img.loading = 'lazy';
            img.src = config.supabaseUrl + '/storage/v1/object/public/avatars/' + encodeURIComponent(id) + '/avatar.jpg?v=' + encodeURIComponent(datos.avatar_updated_at);
            img.onerror = () => img.remove(); caja.append(img);
        }
        return caja;
    }
    function rangoPerfil(role) {
        const badge = document.createElement('span'); badge.className = 'rango-perfil';
        badge.textContent = ({owner:'Owner', admin:'Admin', member:'Miembro'})[role] || 'Miembro'; return badge;
    }
    function enlaceUsuario(id, nombre) {
        const enlace = document.createElement("a");
        enlace.href = "?perfil=" + encodeURIComponent(id);
        enlace.textContent = "@" + nombre;
        enlace.className = 'enlace-usuario';
        enlace.dataset.userId = id;
        enlace.dataset.online = String(presenciaEnLinea.has(id));
        enlace.setAttribute('aria-label','@'+nombre+', '+(presenciaEnLinea.has(id)?'en línea':'desconectado'));
        return enlace;
    }
    function actualizarIndicadoresPresencia(){
        document.querySelectorAll('.enlace-usuario[data-user-id]').forEach(link=>{
            const online=presenciaEnLinea.has(link.dataset.userId);
            link.dataset.online=String(online);
            link.setAttribute('aria-label',link.textContent+', '+(online?'en línea':'desconectado'));
        });
        document.querySelectorAll('.estado-presencia-amigo[data-user-id]').forEach(status=>{
            const online=presenciaEnLinea.has(status.dataset.userId);
            status.textContent=online?'En línea':'Desconectado';
            status.classList.toggle('en-linea',online);
        });
        document.querySelectorAll('.amigo-dock[data-user-id]').forEach(row=>{
            const online=presenciaEnLinea.has(row.dataset.userId);
            const status=row.querySelector('.estado-presencia-amigo');
            if(status){status.textContent=online?'En línea':'Desconectado';status.classList.toggle('en-linea',online);}
        });
        const status=document.getElementById('presenciaPerfil');
        if(status?.dataset.userId){const online=presenciaEnLinea.has(status.dataset.userId);status.textContent=online?'● En línea':'○ Desconectado';status.classList.toggle('en-linea',online);status.classList.toggle('desconectado',!online);}
    }
    function detenerPresencia(){
        presenciaEnLinea.clear();
        if(presenceChannel){db.removeChannel(presenceChannel);presenceChannel=null;presenceOwner=null;}
        actualizarIndicadoresPresencia();
    }
    function iniciarPresencia(){
        if(!usuario){detenerPresencia();return;}
        if(presenceChannel&&presenceOwner!==usuario.id)detenerPresencia();
        if(presenceChannel)return;
        const currentId=usuario.id;
        const channel=db.channel('redmusica-online',{config:{presence:{key:currentId}}});
        presenceChannel=channel;presenceOwner=currentId;
        channel.on('presence',{event:'sync'},()=>{
            if(presenceChannel!==channel)return;
            presenciaEnLinea.clear();
            Object.keys(channel.presenceState()).forEach(id=>presenciaEnLinea.add(id));
            actualizarIndicadoresPresencia();
        }).subscribe(async status=>{
            if(status==='SUBSCRIBED'&&presenceChannel===channel&&usuario?.id===currentId){
                try{await channel.track({user_id:currentId,online_at:new Date().toISOString()});}catch{}
            }
        });
    }
    const cuenta = document.getElementById("cuenta");
    cuenta.innerHTML = `
        <h2 id="tituloCuenta">Únete a RedMusica</h2>
        <p>Inicia sesión o crea una cuenta para compartir álbumes y conversar con otras personas.</p>
        <form id="formularioAcceso">
            <label for="modoAcceso">¿Qué quieres hacer?</label>
            <select id="modoAcceso"><option value="login">Iniciar sesión</option><option value="signup">Crear cuenta</option></select>
            <div id="campoNombre" hidden>
                <label for="nombreUsuario">Nombre de usuario</label>
                <input id="nombreUsuario" autocomplete="username" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" aria-describedby="ayudaNombre">
                <p id="ayudaNombre">De 3 a 24 letras, números o guiones bajos. Tu nombre será público.</p>
            </div>
            <label for="correoUsuario">Correo electrónico</label>
            <input id="correoUsuario" type="email" autocomplete="email" required maxlength="254">
            <label for="claveUsuario">Contraseña</label>
            <input id="claveUsuario" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
            <button id="botonAcceso" type="submit">Entrar</button>
            <button id="recuperarClave" type="button">Olvidé mi contraseña</button>
        </form>
        <form id="formularioNuevaClave" hidden>
            <label for="nuevaClave">Nueva contraseña</label>
            <input id="nuevaClave" type="password" autocomplete="new-password" minlength="8" maxlength="128" required>
            <button type="submit">Guardar contraseña</button>
        </form>
        <div id="sesionPerfil" hidden><p id="nombrePerfil"></p>
            <details id="editarPerfil"><summary>Editar mi perfil</summary>
            <div id="miFoto"></div>
            <form id="formularioFoto"><label for="archivoFoto">Foto de perfil</label><input id="archivoFoto" type="file" accept="image/jpeg,image/png,image/webp" required>
            <p>JPG, PNG o WebP, hasta 10 MB. Se recorta al centro. La foto será pública.</p>
            <button type="submit">Guardar foto</button><button id="quitarFoto" type="button">Quitar foto</button></form>
            <form id="formularioEstadoBreve"><label for="estadoBreve">Estado breve</label><input id="estadoBreve" maxlength="100" placeholder="¿Qué estás escuchando o pensando?"><button type="submit">Actualizar estado</button></form>
            <form id="formularioBio"><label for="bioPerfil">Sobre mí</label><textarea id="bioPerfil" maxlength="300" rows="3"></textarea><button type="submit">Guardar presentación</button></form>
            <form id="formularioAlbumFotos"><label for="nombreAlbumFotos">Álbum de fotos</label><input id="nombreAlbumFotos" maxlength="60" placeholder="Ej.: Concierto de Los Jaivas" required><label for="fotosPerfil">Fotos de discos o conciertos (JPG, PNG, WebP)</label><input id="fotosPerfil" type="file" accept="image/jpeg,image/png,image/webp" multiple required><label for="descripcionFotos">Pie de foto (opcional)</label><input id="descripcionFotos" maxlength="160" placeholder="Una noche inolvidable"><p>Las imágenes se reducen antes de subir y cada perfil puede guardar hasta 20 fotos.</p><button type="submit">Subir al álbum</button></form>
            <p id="estadoEdicionPerfil" role="status"></p></details><button id="cerrarSesion" type="button">Cerrar sesión</button></div>
        <p id="estadoPerfil" role="status"></p>`;
    if (config.emailConfirmationEnabled === false) {
        const aviso = document.createElement("p");
        aviso.className = "aviso-cuenta";
        aviso.textContent = "En RedMusica crear una cuenta es simple: no necesitas confirmar el correo. Lo usamos solo para iniciar sesión y no aparece en tu perfil. Por ahora no hay recuperación de contraseña, así que guarda bien tu contraseña.";
        document.getElementById("tituloCuenta").after(aviso);
    }
    document.getElementById("recuperarClave").hidden = config.passwordRecoveryEnabled === false;
    const feed = document.getElementById("feed");
    feed.textContent = "";
    const estadoFeed = document.createElement("p");
    estadoFeed.id = "estadoFeed";
    estadoFeed.setAttribute("role", "status");
    const refrescar = crearBoton("Actualizar publicaciones");
    refrescar.id = "actualizarFeed";
    feed.before(refrescar, estadoFeed);
    const mas = crearBoton("Ver más publicaciones");
    mas.id='verMas';
    mas.hidden = true;
    feed.after(mas);
    let usuario = null;
    let perfil = null;
    let sesionLista = false;
    let peliculaSeleccionada = null;
    let misListas = [];
    const cachePeliculas = new Map();
    let revisionBusquedaPeliculas = 0;
    let perfilSeguido = false, objetivoSeguir = null, guardandoSeguir = false;
    let offsetNotificaciones = 0, cargandoNotificaciones = false, revisionNotificaciones = 0, notificacionesAbiertas = false;
    let recuperando = false;
    let revisionSesion = 0;
    let revisionFeed = 0;
    let desplazamiento = 0;
    const porPagina = 20;
    const seleccionPosts = "id,user_id,album_id,album_title,album_artist,post_type,image_path,link_url,film_wikidata_id,film_tmdb_id,film_title,film_director,film_year,film_poster,film_rating,body,created_at,profiles:profiles!posts_user_id_fkey(username,role,avatar_updated_at),likes(count)";
    const destinoCorreo = location.origin + location.pathname;
    const estadoPerfil = document.getElementById("estadoPerfil");

    function actualizarVisibilidadCuenta(){
        const inicio=!viendoPerfil&&!viendoMemes&&!viendoPeliculas&&!viendoAmigos&&!viendoActividad&&!viendoGuardados&&!viendoListas&&!viendoEventos&&!viendoVideos&&!viendoJuegos&&!viendoMusica&&!viendoBlackjack;
        const recuperacion=Boolean(usuario&&recuperando&&inicio);
        cuenta.hidden=!(inicio&&(!usuario||recuperacion));
        const sesion=document.getElementById('sesionPerfil');
        const miPropioPerfil=Boolean(usuario&&viendoPerfil&&perfilSolicitado===usuario.id);
        if(miPropioPerfil&&sesion.parentElement!==document.getElementById('perfilPublico'))document.getElementById('perfilPublico').append(sesion);
        else if(!miPropioPerfil&&sesion.parentElement!==cuenta)cuenta.append(sesion);
        sesion.hidden=!usuario||recuperacion;
        document.getElementById('nombrePerfil').hidden=miPropioPerfil;
        if(recuperacion)document.getElementById('tituloCuenta').textContent='Restablece tu contraseña';
        else document.getElementById('tituloCuenta').textContent='Únete a RedMusica';
    }
    actualizarVisibilidadCuenta();

    function crearBoton(texto) {
        const boton = document.createElement("button");
        boton.type = "button";
        boton.textContent = texto;
        return boton;
    }
    function resultado(respuesta) {
        if (respuesta.error) throw respuesta.error;
        return respuesta.data;
    }
    async function accion(boton, mensaje, tarea) {
        if (boton.disabled) return;
        boton.disabled = true;
        mensaje.textContent = "";
        try { await tarea(); }
        catch (error) {
            mensaje.textContent = "No se pudo completar la acción. Revisa tu conexión y tu sesión e inténtalo de nuevo.";
        } finally { boton.disabled = false; }
    }
    function exigirCuenta() {
        if (usuario && perfil) return true;
        estadoPerfil.textContent = "Inicia sesión con tu cuenta para participar.";
        document.getElementById("correoUsuario").focus();
        return false;
    }
    function actualizarAcceso() {
        document.body.classList.toggle('con-dock-amigos',Boolean(usuario));
        if (!usuario) { notificacionesAbiertas=false; document.getElementById("abrirNotificaciones").setAttribute("aria-expanded", "false"); }
        document.getElementById("formularioAcceso").hidden = Boolean(usuario);
        document.getElementById("sesionPerfil").hidden = !usuario;
        document.getElementById("formularioNuevaClave").hidden = !recuperando || !usuario;
        document.getElementById("abrirNotificaciones").hidden = !usuario;
        document.getElementById("notificaciones").hidden = !usuario || !notificacionesAbiertas;
        document.getElementById('amigosNav').hidden = !usuario;
        document.getElementById('actividadNav').hidden = !usuario;
        document.getElementById('guardadosNav').hidden = !usuario;
        document.getElementById('listasNav').hidden = !usuario;
        document.getElementById('eventosNav').hidden = !usuario;
        document.getElementById('musicaNav').hidden = !usuario;
        document.getElementById('videosNav').hidden = !usuario;
        document.getElementById('juegosNav').hidden = !usuario;
        document.getElementById('memesNav').hidden = sesionLista&&!usuario;
        document.getElementById('peliculasNav').hidden = sesionLista&&!usuario;
        document.getElementById('blackjackNav').hidden = sesionLista&&!usuario;
        document.getElementById('chatComunitario').hidden = !usuario || viendoAmigos || viendoBlackjack;
        document.getElementById('compositorMuro').hidden = !usuario || viendoPerfil || viendoMemes || viendoPeliculas || viendoAmigos || viendoActividad || viendoGuardados || viendoListas || viendoEventos || viendoVideos || viendoJuegos || viendoMusica || viendoBlackjack;
        document.getElementById('dockAmigos').hidden = !usuario;
        document.getElementById('abrirDockAmigos').hidden = !usuario;
        actualizarVisibilidadCuenta();
        if(viendoAmigos||viendoBlackjack){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
        }
        const nombre = document.getElementById('nombrePerfil');
        nombre.textContent = perfil ? 'Publicas como @' + perfil.username + ' ' : 'Cargando tu perfil…';
        document.getElementById('miFoto').replaceChildren();
        if (perfil && usuario) { nombre.append(rangoPerfil(perfil.role)); document.getElementById('miFoto').append(fotoPerfil(usuario.id, perfil)); }
        document.getElementById('bioPerfil').value = perfil?.bio || '';
        document.getElementById('estadoBreve').value = perfil?.status_text || '';
        document.getElementById('quitarFoto').disabled = !perfil?.avatar_updated_at;
        document.getElementById('crearMeme').hidden = !viendoMemes || !usuario || !perfil;
        document.getElementById('reseñaPelicula').hidden = !viendoPeliculas || !usuario || !perfil || !peliculaSeleccionada;
        const miPerfil = document.getElementById("miPerfil");
        miPerfil.hidden = !usuario || !perfil;
        if (usuario) miPerfil.href = "?perfil=" + encodeURIComponent(usuario.id);
        else miPerfil.removeAttribute("href");
    }
    function renderizarListas(){
        const box=document.getElementById('listaColecciones');box.replaceChildren();
        misListas.forEach(list=>{
            const card=document.createElement('article'),link=document.createElement('a');card.className='tarjeta-lista';
            link.href='?seccion=listas&lista='+encodeURIComponent(list.id);link.textContent=list.name;card.append(link);box.append(card);
        });
        if(!misListas.length){const empty=document.createElement('p');empty.textContent='Todavía no tienes listas. Crea una para ordenar tus publicaciones favoritas.';box.append(empty);}
    }
    async function cargarListas(){
        if(!usuario){misListas=[];renderizarListas();return;}
        const rows=resultado(await db.from('personal_lists').select('id,name,created_at').eq('user_id',usuario.id).order('created_at',{ascending:false}).limit(100));
        if(!usuario)return;misListas=rows;renderizarListas();
    }
    document.getElementById('formularioLista').addEventListener('submit',event=>{
        event.preventDefault();if(!exigirCuenta())return;
        const input=document.getElementById('nombreLista'),status=document.getElementById('estadoListas'),button=event.currentTarget.querySelector('button'),name=input.value.trim();
        if(!name){status.textContent='Escribe un nombre para la lista.';return;}
        accion(button,status,async()=>{
            const response=await db.from('personal_lists').insert({name}).select('id,name,created_at').single();
            if(response.error?.code==='23505')throw Error('Ya tienes una lista con ese nombre.');
            const list=resultado(response);input.value='';misListas.unshift(list);renderizarListas();status.textContent='Lista creada.';
        });
    });
    async function perfilesAmigosActuales(){
        const rows=resultado(await db.from('friendships').select('user_a,user_b').eq('status','accepted').or('user_a.eq.'+usuario.id+',user_b.eq.'+usuario.id).limit(100));
        const ids=[...new Set(rows.map(row=>row.user_a===usuario.id?row.user_b:row.user_a))];
        return ids.length?resultado(await db.from('profiles').select('id,username,role,avatar_updated_at').in('id',ids)):[];
    }
    function horaEvento(value){return new Date(value).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'});}
    async function cargarEventos(){
        const invitationBox=document.getElementById('listaInvitaciones'),eventBox=document.getElementById('listaEventos');
        document.getElementById('estadoEventos').textContent='Cargando eventos…';document.getElementById('estadoInvitaciones').textContent='';
        try{
            const [invitesResponse,eventsResponse]=await Promise.all([
                db.from('event_invites').select('event_id,response,created_at,event:events!event_invites_event_id_fkey(id,host_id,title,venue,description,starts_at,host:profiles!events_host_id_fkey(username))').eq('invitee_id',usuario.id).eq('response','invited').order('created_at',{ascending:false}).limit(30),
                db.from('events').select('id,host_id,title,venue,description,starts_at,created_at,host:profiles!events_host_id_fkey(username)').gt('starts_at',new Date().toISOString()).order('starts_at').limit(60)
            ]);
            const invites=resultado(invitesResponse),events=resultado(eventsResponse);invitationBox.replaceChildren();eventBox.replaceChildren();
            for(const invite of invites){const ev=invite.event;if(!ev)continue;const card=document.createElement('article');card.className='tarjeta-evento';const heading=document.createElement('h4');heading.textContent=ev.title;const info=document.createElement('p');info.textContent=(ev.host?.username?'@'+ev.host.username+' te invita · ':'')+horaEvento(ev.starts_at)+(ev.venue?' · '+ev.venue:'');const description=document.createElement('p');description.textContent=ev.description||'';card.append(heading,info,description);
                [['going','Voy'],['interested','Me interesa'],['declined','No podré ir']].forEach(([value,label])=>{const button=crearBoton(label);button.addEventListener('click',async()=>{button.disabled=true;try{resultado(await db.from('event_invites').update({response:value,responded_at:new Date().toISOString()}).eq('event_id',ev.id).eq('invitee_id',usuario.id));await cargarEventos();}catch{document.getElementById('estadoInvitaciones').textContent='No se pudo responder a la invitación.';}finally{button.disabled=false;}});card.append(button);});invitationBox.append(card);
            }
            if(!invites.length){const empty=document.createElement('p');empty.textContent='No tienes invitaciones pendientes.';invitationBox.append(empty);}
            if(!events.length){const empty=document.createElement('p');empty.textContent='Todavía no hay eventos próximos. Crea el primero e invita a tus amigos.';eventBox.append(empty);}
            const eventIds=events.map(ev=>ev.id), responses=eventIds.length?resultado(await db.from('event_invites').select('event_id,invitee_id,response').in('event_id',eventIds)):[];
            let friends=[];try{friends=await perfilesAmigosActuales();}catch{}
            events.forEach(ev=>{
                const card=document.createElement('article');card.className='tarjeta-evento';const heading=document.createElement('h4');heading.textContent=ev.title;const info=document.createElement('p');info.textContent=(ev.host?.username?'Organiza @'+ev.host.username+' · ':'')+horaEvento(ev.starts_at)+(ev.venue?' · '+ev.venue:'');const description=document.createElement('p');description.textContent=ev.description||'';card.append(heading,info,description);
                const attending=responses.filter(r=>r.event_id===ev.id&&r.response==='going').length;if(ev.host_id===usuario.id||responses.some(r=>r.event_id===ev.id&&r.invitee_id===usuario.id)){const tally=document.createElement('p');tally.textContent=attending+' confirmaron asistencia';card.append(tally);}
                const mine=responses.find(r=>r.event_id===ev.id&&r.invitee_id===usuario.id);
                if(mine){const status=document.createElement('p');status.className='estado-respuesta-evento';status.textContent=({going:'Asistirás',interested:'Te interesa',declined:'Indicaste que no asistirás',invited:'Tienes una invitación pendiente'})[mine.response];card.append(status);if(mine.response==='invited')[['going','interested','declined']].forEach(([value,label])=>{const b=crearBoton(({going:'Voy',interested:'Me interesa',declined:'No podré ir'})[value]);b.addEventListener('click',async()=>{b.disabled=true;try{resultado(await db.from('event_invites').update({response:value,responded_at:new Date().toISOString()}).eq('event_id',ev.id).eq('invitee_id',usuario.id));await cargarEventos();}catch{document.getElementById('estadoEventos').textContent='No se pudo guardar tu respuesta.';}finally{b.disabled=false;}});card.append(b);});}
                if(ev.host_id===usuario.id){
                    const form=document.createElement('form');form.className='invitar-amigos-evento';const label=document.createElement('label'),select=document.createElement('select');label.textContent='Invitar amigos';select.multiple=true;select.size=Math.min(4,Math.max(2,friends.length));friends.forEach(friend=>{const option=document.createElement('option');option.value=friend.id;option.textContent='@'+friend.username;select.append(option);});const button=crearBoton('Enviar invitación');button.type='submit';button.disabled=!friends.length;const status=document.createElement('p');status.setAttribute('role','status');form.append(label,select,button,status);form.addEventListener('submit',async e=>{e.preventDefault();const selected=[...select.selectedOptions].map(option=>option.value);if(!selected.length){status.textContent='Elige uno o más amigos.';return;}if(selected.length>6){status.textContent='Puedes invitar hasta seis amigos de una vez.';return;}button.disabled=true;try{let sent=0;for(const friendId of selected){const result=await db.from('event_invites').insert({event_id:ev.id,invitee_id:friendId});if(result.error?.code==='23505')continue;if(result.error)throw result.error;sent++;}status.textContent=sent?'Invitaciones enviadas ('+sent+').':'Esas personas ya estaban invitadas.';select.selectedIndex=-1;}catch{status.textContent='No se pudieron enviar las invitaciones.';}finally{button.disabled=false;}});card.append(form);
                    const remove=crearBoton('Cancelar evento');remove.className='boton-secundario';remove.addEventListener('click',async()=>{if(!window.confirm('¿Cancelar este evento?'))return;remove.disabled=true;try{resultado(await db.from('events').delete().eq('id',ev.id).eq('host_id',usuario.id));await cargarEventos();}catch{document.getElementById('estadoEventos').textContent='No se pudo cancelar el evento.';}finally{remove.disabled=false;}});card.append(remove);
                }
                eventBox.append(card);
            });
            document.getElementById('estadoEventos').textContent='';document.getElementById('estadoInvitaciones').textContent='';
        }catch{document.getElementById('estadoEventos').textContent='No se pudieron cargar los eventos. Actualiza la página e inténtalo de nuevo.';}
    }
    document.getElementById('formularioEvento').addEventListener('submit',event=>{
        event.preventDefault();if(!exigirCuenta())return;const form=event.currentTarget,button=form.querySelector('button'),status=document.getElementById('estadoEventos');
        const startsAt=new Date(document.getElementById('fechaEvento').value);
        if(Number.isNaN(startsAt.valueOf())||startsAt<=new Date()){status.textContent='Elige una fecha y hora futuras.';return;}
        accion(button,status,async()=>{resultado(await db.from('events').insert({title:document.getElementById('nombreEvento').value.trim(),venue:document.getElementById('lugarEvento').value.trim(),description:document.getElementById('descripcionEvento').value.trim(),starts_at:startsAt.toISOString()}));form.reset();status.textContent='Evento creado. Ya puedes invitar amigos.';await cargarEventos();});
    });
    const listaVideos=document.getElementById('listaVideos'),estadoVideos=document.getElementById('estadoVideos');
    async function cargarVideos(){
        if(!usuario)return;estadoVideos.textContent='Buscando entre los artistas y álbumes compartidos…';listaVideos.replaceChildren();
        try{
            let albumes=resultado(await db.from('posts').select('album_artist,album_title').eq('user_id',usuario.id).eq('post_type','album').order('created_at',{ascending:false}).limit(30));
            if(!albumes.length)albumes=resultado(await db.from('posts').select('album_artist,album_title').eq('post_type','album').order('created_at',{ascending:false}).limit(30));
            const artistas=[...new Set(albumes.map(row=>row.album_artist?.trim()).filter(Boolean))].slice(0,3);
            if(!artistas.length){estadoVideos.textContent='Comparte o reseña algunos álbumes para recibir recomendaciones de video.';return;}
            const results=await Promise.all(artistas.map(async artist=>{
                const {data,error}=await db.functions.invoke('radio',{body:{action:'search',query:artist+' official music video'}});
                if(error)throw error;return data?.songs||[];
            }));
            const shown=new Set();
            results.flat().forEach(video=>{
                if(!video?.video_id||shown.has(video.video_id))return;shown.add(video.video_id);
                const card=document.createElement('article');card.className='tarjeta-video';
                const link=document.createElement('a');link.href='https://www.youtube.com/watch?v='+encodeURIComponent(video.video_id);link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','Ver en YouTube: '+video.title);
                const image=document.createElement('img');image.src=video.thumbnail||'https://i.ytimg.com/vi/'+encodeURIComponent(video.video_id)+'/hqdefault.jpg';image.alt='';image.loading='lazy';image.decoding='async';link.append(image);
                const title=document.createElement('h3');title.textContent=video.title;const channel=document.createElement('p');channel.textContent=video.channel||'YouTube';const watch=document.createElement('span');watch.textContent='Ver en YouTube ↗';link.append(title,channel,watch);card.append(link);listaVideos.append(card);
            });
            estadoVideos.textContent=shown.size?'Recomendaciones según los artistas presentes en tus álbumes. YouTube abre en una pestaña nueva.':'No encontramos videos disponibles para esos artistas. Prueba de nuevo más tarde.';
        }catch(error){estadoVideos.textContent=error?.message||'No se pudieron obtener recomendaciones de YouTube. Inténtalo de nuevo más tarde.';}
    }
    document.getElementById('actualizarVideos').addEventListener('click',cargarVideos);
    async function cargarJuegos(){
        const box=document.getElementById('listaJuegos'),status=document.getElementById('estadoJuegos');status.textContent='Cargando recomendaciones…';box.replaceChildren();
        try{
            const rows=resultado(await db.from('game_recommendations').select('id,user_id,title,platform,genre,reason,created_at,profiles:profiles!game_recommendations_user_id_fkey(username,role),game_recommendation_votes(count)').order('created_at',{ascending:false}).limit(60));
            const voted=usuario&&rows.length?resultado(await db.from('game_recommendation_votes').select('recommendation_id').eq('user_id',usuario.id).in('recommendation_id',rows.map(row=>row.id))):[];
            const voteIds=new Set(voted.map(row=>row.recommendation_id));
            rows.forEach(game=>{
                const card=document.createElement('article');card.className='tarjeta-recomendacion-juego';const author=document.createElement('p');author.className='autor-publicacion';author.append(enlaceUsuario(game.user_id,game.profiles?.username||'Usuario'));if(game.profiles?.role)author.append(document.createTextNode(' '),rangoPerfil(game.profiles.role));
                const title=document.createElement('h3');title.textContent=game.title;const platform=document.createElement('p');platform.className='plataforma-juego';platform.textContent=game.platform+(game.genre?' · '+game.genre:'');const reason=document.createElement('p');reason.textContent=game.reason;const time=document.createElement('time');time.dateTime=game.created_at;time.textContent=new Date(game.created_at).toLocaleDateString('es',{dateStyle:'medium'});card.append(author,title,platform,reason,time);
                const vote=crearBoton((voteIds.has(game.id)?'♥':'♡')+' Recomendar ('+(game.game_recommendation_votes?.[0]?.count||0)+')');vote.className='votar-juego';vote.setAttribute('aria-pressed',String(voteIds.has(game.id)));vote.addEventListener('click',async()=>{if(!exigirCuenta())return;vote.disabled=true;try{if(voteIds.has(game.id)){resultado(await db.from('game_recommendation_votes').delete().eq('recommendation_id',game.id).eq('user_id',usuario.id));voteIds.delete(game.id);}else{resultado(await db.from('game_recommendation_votes').insert({recommendation_id:game.id}));voteIds.add(game.id);}await cargarJuegos();}catch{status.textContent='No se pudo guardar el voto. Inténtalo de nuevo.';}finally{vote.disabled=false;}});card.append(vote);
                if(usuario?.id===game.user_id){const remove=crearBoton('Eliminar recomendación');remove.className='boton-secundario';remove.addEventListener('click',async()=>{remove.disabled=true;try{resultado(await db.from('game_recommendations').delete().eq('id',game.id).eq('user_id',usuario.id));await cargarJuegos();}catch{status.textContent='No se pudo eliminar la recomendación.';}finally{remove.disabled=false;}});card.append(remove);}
                box.append(card);
            });
            status.textContent=rows.length?'':'Todavía no hay recomendaciones. Publica la primera.';
        }catch{status.textContent='No se pudieron cargar las recomendaciones de juegos.';}
    }
    document.getElementById('formularioJuego').addEventListener('submit',event=>{
        event.preventDefault();if(!exigirCuenta())return;const form=event.currentTarget,button=form.querySelector('button'),status=document.getElementById('estadoJuegos');
        accion(button,status,async()=>{resultado(await db.from('game_recommendations').insert({title:document.getElementById('nombreJuego').value.trim(),platform:document.getElementById('plataformaJuego').value.trim(),genre:document.getElementById('generoJuego').value.trim(),reason:document.getElementById('motivoJuego').value.trim()}));form.reset();status.textContent='Recomendación publicada.';await cargarJuegos();});
    });
    async function sincronizarSesion(session, evento) {
        if (session && usuario && session.user.id === usuario.id && perfil && evento !== "PASSWORD_RECOVERY") return;
        const revision = ++revisionSesion;
        usuario = session ? session.user : null;
        sesionLista = true;
        perfil = null;
        if (evento === "PASSWORD_RECOVERY") recuperando = true;
        if (!usuario) recuperando = false;
        actualizarAcceso();
        if(usuario)iniciarPresencia();else detenerPresencia();
        try {
            if (usuario) {
                const datos = resultado(await db.from("profiles").select("username,role,bio,status_text,avatar_updated_at").eq("id", usuario.id).single());
                if (revision !== revisionSesion) return;
                perfil = datos;
            }
            if (revision !== revisionSesion) return;
            actualizarAcceso();
            aplicarRuta();
            if(usuario){if(!chatChannel||chatOwner!==usuario.id){iniciarChatRealtime();await cargarChat();}}
            else if(chatChannel){db.removeChannel(chatChannel);chatChannel=null;chatOwner=null;realtimeChat=false;mensajesChat.clear();perfilesChat.clear();listaChat.replaceChildren();}
            if(usuario)await cargarListas();else{misListas=[];renderizarListas();}
            await cargarFeed(true);
            await Promise.all([actualizarConteoSolicitudesAmistad(),cargarAmigosDock()]);
            iniciarMensajesPrivados();
            revisionNotificaciones++;offsetNotificaciones=0;actualizarContadorNotificaciones();
        } catch (error) {
            if (revision === revisionSesion) estadoPerfil.textContent = "No se pudo cargar tu perfil. Recarga la página para volver a intentarlo.";
        }
    }
    // Never await another Auth call inside this callback (the SDK holds a lock).
    db.auth.onAuthStateChange(function (evento, session) {
        setTimeout(function () { sincronizarSesion(session, evento); }, 0);
    });

    // Chat history is stored in Supabase and remains available after reloads.
    const cajaChat = document.getElementById('chatComunitario');
    const listaChat = document.getElementById('mensajesChat');
    const estadoChat = document.getElementById('estadoChat');
    cajaChat.hidden = true;
    const mensajesChat = new Set();
    const perfilesChat = new Map();
    let chatChannel = null, chatOwner = null, realtimeChat = false, cargandoChat = false;
    async function cargarChat() {
        if (cargandoChat || document.hidden) return;
        cargandoChat = true;
        try {
            const rows = resultado(await db.from('chat_messages').select('id,user_id,body,created_at,profiles:profiles!chat_messages_user_id_fkey(username,role)').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50));
            rows.reverse().forEach(renderMensajeChat);
            estadoChat.textContent = realtimeChat ? 'Chat en vivo.' : 'Chat conectado; actualizando mensajes.';
        } catch { estadoChat.textContent = 'No se pudo cargar el chat. Comprueba la conexión e inténtalo de nuevo.'; }
        finally { cargandoChat = false; }
    }
    function renderMensajeChat(row) {
        if (!row || mensajesChat.has(row.id)) return;
        mensajesChat.add(row.id);
        if (row.profiles?.username) perfilesChat.set(row.user_id,row.profiles);
        const item=document.createElement('article'); item.className='mensaje-chat'; item.dataset.messageId=row.id;
        const author=document.createElement('strong');
        const name=row.profiles?.username || perfilesChat.get(row.user_id)?.username || 'Usuario';
        author.append(enlaceUsuario(row.user_id,name));
        if(row.profiles?.role) author.append(document.createTextNode(' '),rangoPerfil(row.profiles.role));
        const body=document.createElement('p'); pintarTextoConGif(body,row.body);
        const time=document.createElement('time'); time.dateTime=row.created_at; time.textContent=new Date(row.created_at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
        item.append(author,body,time); listaChat.append(item);
        while(listaChat.children.length>80){const old=listaChat.firstElementChild;mensajesChat.delete(old.dataset.messageId);old.remove();}
        listaChat.scrollTop=listaChat.scrollHeight;
    }
    function iniciarChatRealtime() {
        if(chatChannel)db.removeChannel(chatChannel);
        chatOwner=usuario?.id||null;
        chatChannel=db.channel('redmusica-chat-general').on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages'},payload=>{
            const row=payload.new;
            if(row.user_id===usuario?.id && perfil) row.profiles=perfil;
            if(row.user_id!==usuario?.id)avisarNuevoMensaje(row,'community');
            renderMensajeChat(row);
            if(!perfilesChat.has(row.user_id)) db.from('profiles').select('username,role').eq('id',row.user_id).maybeSingle().then(r=>{
                if(r.data){perfilesChat.set(row.user_id,r.data);const link=listaChat.querySelector(`[data-message-id="${CSS.escape(row.id)}"] a`);if(link)link.textContent='@'+r.data.username;}
            });
        }).subscribe(status=>{
            realtimeChat=status==='SUBSCRIBED';
            if(realtimeChat)cargarChat();
            else estadoChat.textContent='Chat conectado; actualizando mensajes.';
        });
    }
    document.getElementById('formularioChat').addEventListener('submit',e=>{
        e.preventDefault();const input=document.getElementById('textoChat'),button=document.getElementById('enviarChat');
        const form=e.currentTarget;let body;try{body=prepararCuerpo(form,input,500);}catch(error){estadoChat.textContent=error.message;return;}
        if(!exigirCuenta()||!body)return;
        accion(button,estadoChat,async()=>{
            const row=resultado(await db.from('chat_messages').insert({body}).select('id,user_id,body,created_at').single());
            row.profiles=perfil;renderMensajeChat(row);input.value='';form.querySelector('.url-gif-adjunto').value='';form.querySelector('.gif-vista-previa')?.remove();estadoChat.textContent='Mensaje enviado.';
        });
    });
    document.addEventListener('visibilitychange',()=>{if(usuario&&!document.hidden)cargarChat();});
    setInterval(()=>{if(usuario&&!realtimeChat&&!document.hidden)cargarChat();},30000);
    window.addEventListener('pagehide',()=>{if(chatChannel)db.removeChannel(chatChannel);});

    document.getElementById("modoAcceso").addEventListener("change", function (evento) {
        const registro = evento.target.value === "signup";
        document.getElementById("campoNombre").hidden = !registro;
        document.getElementById("nombreUsuario").required = registro;
        document.getElementById("claveUsuario").autocomplete = registro ? "new-password" : "current-password";
        document.getElementById("botonAcceso").textContent = registro ? "Crear cuenta" : "Entrar";
        estadoPerfil.textContent = "";
    });
    document.getElementById("formularioAcceso").addEventListener("submit", function (evento) {
        evento.preventDefault();
        accion(document.getElementById("botonAcceso"), estadoPerfil, async function () {
            const email = document.getElementById("correoUsuario").value.trim();
            const password = document.getElementById("claveUsuario").value;
            let respuesta;
            if (document.getElementById("modoAcceso").value === "signup") {
                const username = document.getElementById("nombreUsuario").value.trim();
                respuesta = await db.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: destinoCorreo } });
                if (respuesta.error) {
                    estadoPerfil.textContent = "No se pudo crear la cuenta. Revisa los datos o prueba otro nombre de usuario.";
                    return;
                }
                if (config.emailConfirmationEnabled === false) {
                    estadoPerfil.textContent = respuesta.data.session ? "Cuenta creada. Ya puedes participar." : "Cuenta creada. Inicia sesión para participar.";
                } else {
                    estadoPerfil.textContent = respuesta.data.session ? "Cuenta creada." : "Revisa tu correo para confirmar la cuenta antes de entrar. Si ya tienes cuenta, inicia sesión.";
                }
            } else {
                respuesta = await db.auth.signInWithPassword({ email, password });
                if (respuesta.error) {
                    estadoPerfil.textContent = "No pudimos iniciar sesión. Revisa el correo, la contraseña y la confirmación de tu cuenta.";
                    return;
                }
                estadoPerfil.textContent = "Sesión iniciada.";
            }
            document.getElementById("claveUsuario").value = "";
        });
    });
    document.getElementById("recuperarClave").addEventListener("click", function (evento) {
        if (config.passwordRecoveryEnabled === false) return;
        const correo = document.getElementById("correoUsuario");
        if (!correo.reportValidity()) return;
        accion(evento.currentTarget, estadoPerfil, async function () {
            resultado(await db.auth.resetPasswordForEmail(correo.value.trim(), { redirectTo: destinoCorreo }));
            estadoPerfil.textContent = "Si el correo corresponde a una cuenta, recibirás un enlace para cambiar la contraseña.";
        });
    });
    document.getElementById("formularioNuevaClave").addEventListener("submit", function (evento) {
        evento.preventDefault();
        accion(evento.currentTarget.querySelector("button"), estadoPerfil, async function () {
            resultado(await db.auth.updateUser({ password: document.getElementById("nuevaClave").value }));
            document.getElementById("nuevaClave").value = "";
            recuperando = false;
            actualizarAcceso();
            estadoPerfil.textContent = "Contraseña actualizada.";
        });
    });
    document.getElementById("cerrarSesion").addEventListener("click", function (evento) {
        accion(evento.currentTarget, estadoPerfil, async function () {
            resultado(await db.auth.signOut({ scope: "local" }));
            document.getElementById("claveUsuario").value = "";
            estadoPerfil.textContent = "Sesión cerrada.";
        });
    });


    const estadoEdicion = document.getElementById('estadoEdicionPerfil');
    let guardandoPerfil = false;
    async function editarDatos(tarea) {
        if (!usuario || !perfil || guardandoPerfil) return;
        const id = usuario.id, revision = revisionSesion;
        guardandoPerfil = true; estadoEdicion.textContent = 'Guardando…';
        const botones = [...document.querySelectorAll('#editarPerfil button')]; botones.forEach(b => b.disabled = true);
        try {
            const cambios = await tarea(id);
            const filas = resultado(await db.from('profiles').update(cambios).eq('id', id).select('username,role,bio,status_text,avatar_updated_at'));
            if (!filas.length) throw Error('No se pudo guardar el perfil.');
            if (revision !== revisionSesion) return;
            perfil = filas[0]; actualizarAcceso(); await cargarFeed(true);
            estadoEdicion.textContent = 'Perfil actualizado.';
        } catch(e) { if(revision === revisionSesion) estadoEdicion.textContent = e.message || 'No se pudo guardar. Inténtalo otra vez.'; }
        finally { guardandoPerfil = false; botones.forEach(b => b.disabled = false); document.getElementById('quitarFoto').disabled = !perfil?.avatar_updated_at; }
    }
    async function prepararFoto(file, maxDimension = 512) {
        if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Elige una imagen JPG, PNG o WebP.');
        if (file.size > 10*1024*1024) throw Error('La imagen no puede superar 10 MB.');
        const url = URL.createObjectURL(file);
        try {
            const img = new Image(); img.src = url; await img.decode();
            if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 50000000) throw Error('La imagen es demasiado grande. Elige una más pequeña.');
            const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
            const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#eeeeee'; ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.drawImage(img,0,0,canvas.width,canvas.height);
            let quality=0.84, blob;
            do { blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',quality)); quality -= 0.12; } while(blob && blob.size > 900000 && quality > 0.48);
            if (!blob || blob.size>1048576) throw Error('No se pudo preparar la foto. Elige otra imagen.');
            return blob;
        } finally { URL.revokeObjectURL(url); }
    }
    document.getElementById('formularioFoto').addEventListener('submit',e=>{
        e.preventDefault(); const file = document.getElementById('archivoFoto').files[0];
        editarDatos(async id=>{ const blob = await prepararFoto(file); resultado(await db.storage.from('avatars').upload(id+'/avatar.jpg',blob,{upsert:true,contentType:'image/jpeg',cacheControl:'60'})); document.getElementById('archivoFoto').value=''; return {avatar_updated_at:new Date().toISOString()}; });
    });
    async function prepararFotoAlbum(file) { return prepararFoto(file, 1440); }
    function pintarAlbumesPerfil(rows, ownProfile) {
        const target=document.getElementById('albumesPerfil');target.replaceChildren();
        const groups=new Map();
        rows.forEach(photo=>{if(!groups.has(photo.album_id))groups.set(photo.album_id,{name:photo.album?.name||'Fotos',photos:[]});groups.get(photo.album_id).photos.push(photo);});
        groups.forEach(group=>{
            const section=document.createElement('section');section.className='album-fotos-perfil';
            const heading=document.createElement('h4');heading.textContent=group.name;section.append(heading);
            const grid=document.createElement('div');grid.className='galeria-perfil';
            group.photos.forEach(photo=>{
                const figure=document.createElement('figure'),image=document.createElement('img');image.src=config.supabaseUrl+'/storage/v1/object/public/profile-photos/'+photo.object_path.split('/').map(encodeURIComponent).join('/')+'?v='+encodeURIComponent(photo.created_at);image.alt=photo.caption||group.name;image.loading='lazy';image.decoding='async';
                figure.append(image);
                if(photo.caption){const caption=document.createElement('figcaption');caption.textContent=photo.caption;figure.append(caption);}
                if(ownProfile){const remove=crearBoton('Quitar foto');remove.className='quitar-foto-perfil';remove.addEventListener('click',async()=>{remove.disabled=true;try{resultado(await db.from('profile_photos').delete().eq('id',photo.id).eq('user_id',usuario.id));resultado(await db.storage.from('profile-photos').remove([photo.object_path]));await cargarFotosPerfil(perfilSolicitado||usuario.id,ownProfile);}catch{document.getElementById('estadoMediosPerfil').textContent='No se pudo eliminar la foto.';}finally{remove.disabled=false;}});figure.append(remove);}
                grid.append(figure);
            });
            section.append(grid);target.append(section);
        });
        if(!rows.length){const empty=document.createElement('p');empty.textContent=ownProfile?'Todavía no tienes fotos. Añade conciertos y discos desde Editar mi perfil.':'Todavía no hay fotos en este perfil.';target.append(empty);}
    }
    async function cargarFotosPerfil(profileId, ownProfile=false) {
        const status=document.getElementById('estadoMediosPerfil');status.textContent='';
        try {
            const rows=resultado(await db.from('profile_photos').select('id,album_id,user_id,object_path,caption,created_at,album:profile_photo_albums!profile_photos_album_id_user_id_fkey(name)').eq('user_id',profileId).order('created_at',{ascending:false}).limit(20));
            pintarAlbumesPerfil(rows,ownProfile);
        } catch { status.textContent='No se pudieron cargar las fotos. Inténtalo de nuevo.'; }
    }
    document.getElementById('formularioAlbumFotos').addEventListener('submit',event=>{
        event.preventDefault();if(!exigirCuenta())return;
        const form=event.currentTarget,button=form.querySelector('button'),status=document.getElementById('estadoEdicionPerfil'),albumName=document.getElementById('nombreAlbumFotos').value.trim(),caption=document.getElementById('descripcionFotos').value.trim(),files=[...document.getElementById('fotosPerfil').files];
        if(!albumName||!files.length)return;
        if(files.length>5){status.textContent='Sube hasta cinco fotos por vez.';return;}
        accion(button,status,async()=>{
            const countResponse=await db.from('profile_photos').select('id',{count:'exact',head:true}).eq('user_id',usuario.id);
            if(countResponse.error)throw countResponse.error;
            if((countResponse.count||0)+files.length>20)throw Error('Cada perfil puede guardar hasta 20 fotos.');
            let album=resultado(await db.from('profile_photo_albums').select('id').eq('user_id',usuario.id).eq('name',albumName).maybeSingle());
            if(!album)album=resultado(await db.from('profile_photo_albums').insert({name:albumName}).select('id').single());
            for(const file of files){
                const blob=await prepararFotoAlbum(file),path=usuario.id+'/'+crypto.randomUUID()+'.jpg';
                resultado(await db.storage.from('profile-photos').upload(path,blob,{contentType:'image/jpeg',cacheControl:'3600'}));
                try{resultado(await db.from('profile_photos').insert({album_id:album.id,object_path:path,caption}).select('id').single());}
                catch(error){await db.storage.from('profile-photos').remove([path]);throw error;}
            }
            document.getElementById('fotosPerfil').value='';document.getElementById('descripcionFotos').value='';
            status.textContent='Fotos añadidas al álbum.';await cargarFotosPerfil(usuario.id,true);
        });
    });
    document.getElementById('formularioBio').addEventListener('submit',e=>{e.preventDefault(); const bio=document.getElementById('bioPerfil').value.trim(); editarDatos(async()=>({bio}));});
    document.getElementById('formularioEstadoBreve').addEventListener('submit',e=>{e.preventDefault(); const status=document.getElementById('estadoBreve').value.trim(); editarDatos(async()=>({status_text:status}));});
    document.getElementById('quitarFoto').addEventListener('click',()=>editarDatos(async id=>{resultado(await db.storage.from('avatars').remove([id+'/avatar.jpg'])); return {avatar_updated_at:null};}));


    async function actualizarContadorNotificaciones() {
        const ticket=revisionNotificaciones;
        if(!usuario || document.hidden)return;
        try {
            const r=await db.from('notifications').select('id',{count:'exact',head:true}).eq('recipient_id',usuario.id).is('read_at',null);
            if(r.error)throw r.error;
            if(ticket!==revisionNotificaciones||!usuario)return;
            const button=document.getElementById('abrirNotificaciones');
            button.textContent=r.count ? 'Notificaciones ('+r.count+')' : 'Notificaciones';
            button.setAttribute('aria-label',r.count ? 'Notificaciones, '+r.count+' sin leer' : 'Notificaciones');
        } catch {}
    }
    async function cargarNotificaciones(reiniciar=true) {
        if(cargandoNotificaciones||!usuario)return;
        cargandoNotificaciones=true;const ticket=revisionNotificaciones;const box=document.getElementById('listaNotificaciones');
        document.getElementById('estadoNotificaciones').textContent='Cargando…';
        try {
            const desde=reiniciar?0:offsetNotificaciones;
            const rows=resultado(await db.from('notifications').select('id,kind,created_at,read_at,actor_id,post_id,actor:profiles!notifications_actor_id_fkey(username),post:posts(album_title)').eq('recipient_id',usuario.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(desde,desde+29));
            if(ticket!==revisionNotificaciones)return;
            if(reiniciar)box.replaceChildren();
            rows.forEach(n=>{
                const row=document.createElement('article');row.className='notificacion'+(n.read_at?'':' notificacion-no-leida');
                const link=document.createElement('a');
                const who=n.actor?.username?'@'+n.actor.username:'Una cuenta';
                const what=n.kind==='comment'?'comentó en tu publicación':n.kind==='like'?'marcó Me gusta en tu publicación':'empezó a seguirte';
                link.textContent=who+' '+what+(n.post?.album_title?' · '+n.post.album_title:'');
                link.href=n.kind==='follow'?'?perfil='+encodeURIComponent(n.actor_id||''):'?perfil='+encodeURIComponent(usuario.id)+'#'+encodeURIComponent(n.post_id||'');
                link.addEventListener('click',async e=>{if(!n.read_at){e.preventDefault();await db.from('notifications').update({read_at:new Date().toISOString()}).eq('id',n.id).eq('recipient_id',usuario.id);n.read_at=new Date().toISOString();await actualizarContadorNotificaciones();location.href=link.href;}});
                const time=document.createElement('time');time.dateTime=n.created_at;time.textContent=new Date(n.created_at).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'});
                row.append(link,time);box.append(row);
            });
            offsetNotificaciones=desde+rows.length;document.getElementById('masNotificaciones').hidden=rows.length<30;
            document.getElementById('estadoNotificaciones').textContent=offsetNotificaciones?'':'Todavía no tienes notificaciones.';
            await actualizarContadorNotificaciones();
        } catch {document.getElementById('estadoNotificaciones').textContent='No se pudieron cargar las notificaciones. Inténtalo de nuevo.';}
        finally {cargandoNotificaciones=false;}
    }
    document.getElementById('abrirNotificaciones').addEventListener('click',()=>{
        notificacionesAbiertas=!notificacionesAbiertas;
        const box=document.getElementById('notificaciones');box.hidden=!notificacionesAbiertas;
        document.getElementById('abrirNotificaciones').setAttribute('aria-expanded',String(notificacionesAbiertas));if(notificacionesAbiertas)cargarNotificaciones(true);
    });
    let registroAvisosNavegador=null;
    async function registrarAvisosNavegador(){
        if(!('serviceWorker' in navigator))return false;
        try{registroAvisosNavegador=await navigator.serviceWorker.register('./service-worker.js');await navigator.serviceWorker.ready;return true;}catch{return false;}
    }
    const activarAvisosNavegador=document.getElementById('activarNotificacionesNavegador');
    if(!('Notification' in window)){
        activarAvisosNavegador.hidden=true;
    }else{
        if(Notification.permission==='granted'){activarAvisosNavegador.textContent='Avisos del navegador activados';registrarAvisosNavegador();}
        activarAvisosNavegador.addEventListener('click',async()=>{
            try{
                const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
                const instalada=navigator.standalone||window.matchMedia('(display-mode: standalone)').matches;
                if(ios&&!instalada){document.getElementById('estadoNotificaciones').textContent='En iPhone o iPad, usa Compartir → Añadir a pantalla de inicio. Abre RedMusica desde ese icono y activa los avisos.';return;}
                const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
                const preparado=permission==='granted'?await registrarAvisosNavegador():false;
                activarAvisosNavegador.textContent=permission==='granted'?'Avisos del navegador activados':permission==='denied'?'Avisos bloqueados en el navegador':'Avisos no activados';
                document.getElementById('estadoNotificaciones').textContent=permission==='granted'?(preparado?'Te avisaremos cuando llegue un mensaje mientras RedMusica esté abierta.':'El navegador permitirá avisos mientras RedMusica siga abierta en esta pestaña.') :permission==='denied'?'El navegador bloqueó los avisos. Puedes permitirlos desde la configuración del sitio.':'No se activó el permiso de avisos.';
            }catch{document.getElementById('estadoNotificaciones').textContent='No se pudo activar el permiso de avisos.';}
        });
    }
    document.getElementById('masNotificaciones').addEventListener('click',()=>cargarNotificaciones(false));
    document.getElementById('marcarLeidas').addEventListener('click',async()=>{
        if(!usuario)return;const button=document.getElementById('marcarLeidas');button.disabled=true;
        try{resultado(await db.from('notifications').update({read_at:new Date().toISOString()}).eq('recipient_id',usuario.id).is('read_at',null));await cargarNotificaciones(true);}
        catch{document.getElementById('estadoNotificaciones').textContent='No se pudieron actualizar. Inténtalo de nuevo.';}
        finally{button.disabled=false;}
    });
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){actualizarContadorNotificaciones();if(!document.getElementById('notificaciones').hidden)cargarNotificaciones(true);}});
    setInterval(()=>{if(usuario&&!document.hidden){actualizarContadorNotificaciones();if(notificacionesAbiertas)cargarNotificaciones(true);}},60000);
    document.getElementById('seguirPerfil').addEventListener('click',async()=>{
        if(!exigirCuenta()||!objetivoSeguir||guardandoSeguir)return;const button=document.getElementById('seguirPerfil');guardandoSeguir=true;button.disabled=true;
        try{
            if(perfilSeguido)resultado(await db.from('follows').delete().eq('followed_id',objetivoSeguir).eq('user_id',usuario.id));
            else resultado(await db.from('follows').insert({followed_id:objetivoSeguir}));
            perfilSeguido=!perfilSeguido;button.textContent=perfilSeguido?'Dejar de seguir':'Seguir';await actualizarSeguidores();
        }catch{document.getElementById('estadoPerfil').textContent='No se pudo actualizar el seguimiento. Revisa tu sesión e inténtalo de nuevo.';}
        finally{guardandoSeguir=false;button.disabled=false;}
    });
    async function actualizarSeguidores(){
        if(!objetivoSeguir)return;
        const total=await db.from('follows').select('user_id',{count:'exact',head:true}).eq('followed_id',objetivoSeguir);
        document.getElementById('conteoSeguidores').textContent=(total.count||0)+(total.count===1?' seguidor':' seguidores');
    }
    function parDeAmistad(otherId){return [usuario.id,otherId].sort();}
    async function obtenerAmistad(otherId){
        const [a,b]=parDeAmistad(otherId);
        return resultado(await db.from('friendships').select('user_a,user_b,requested_by,status,created_at').eq('user_a',a).eq('user_b',b).maybeSingle());
    }
    function pintarEstadoAmistad(row){
        const button=document.getElementById('amistadPerfil'),reject=document.getElementById('rechazarAmistad');
        if(!usuario||!objetivoSeguir||usuario.id===objetivoSeguir){button.hidden=true;reject.hidden=true;return;}
        button.hidden=false;reject.hidden=true;
        if(!row){button.textContent='Agregar amigo';button.dataset.accionAmistad='send';}
        else if(row.status==='accepted'){button.textContent='Eliminar amigo';button.dataset.accionAmistad='remove';}
        else if(row.status==='pending'&&row.requested_by===usuario.id){button.textContent='Cancelar solicitud';button.dataset.accionAmistad='cancel';}
        else if(row.status==='pending'){button.textContent='Aceptar solicitud';button.dataset.accionAmistad='accept';reject.hidden=false;}
        else{button.textContent='Enviar nueva solicitud';button.dataset.accionAmistad='send';}
    }
    async function cargarEstadoAmistadPerfil(){
        const status=document.getElementById('estadoAmistadPerfil');status.textContent='';
        if(!usuario||!objetivoSeguir||usuario.id===objetivoSeguir){pintarEstadoAmistad(null);return;}
        try{pintarEstadoAmistad(await obtenerAmistad(objetivoSeguir));}
        catch{status.textContent='No se pudo revisar la amistad. Inténtalo de nuevo.';}
    }
    async function cambiarAmistad(targetId,action){
        const [a,b]=parDeAmistad(targetId);
        const query=db.from('friendships').delete().eq('user_a',a).eq('user_b',b);
        if(action==='send'){
            const existing=await obtenerAmistad(targetId);
            if(existing?.status==='declined')resultado(await query);
            resultado(await db.from('friendships').insert({user_a:a,user_b:b,requested_by:usuario.id}));
        }else if(action==='accept'||action==='decline'){
            resultado(await db.from('friendships').update({status:action==='accept'?'accepted':'declined'}).eq('user_a',a).eq('user_b',b).eq('status','pending'));
        }else resultado(await query);
        if(viendoPerfil)await cargarEstadoAmistadPerfil();
        if(viendoAmigos)await cargarAmigos();
        await Promise.all([actualizarConteoSolicitudesAmistad(),cargarAmigosDock()]);
    }
    document.getElementById('amistadPerfil').addEventListener('click',async()=>{
        if(!exigirCuenta()||!objetivoSeguir)return;
        const button=document.getElementById('amistadPerfil'),action=button.dataset.accionAmistad;
        button.disabled=true;document.getElementById('estadoAmistadPerfil').textContent='';
        try{await cambiarAmistad(objetivoSeguir,action);document.getElementById('estadoAmistadPerfil').textContent=action==='send'?'Solicitud enviada.':action==='accept'?'Ahora son amigos.':action==='cancel'?'Solicitud cancelada.':action==='remove'?'Amistad eliminada.':'';}
        catch{document.getElementById('estadoAmistadPerfil').textContent='No se pudo actualizar la amistad. Inténtalo de nuevo.';}
        finally{button.disabled=false;}
    });
    document.getElementById('rechazarAmistad').addEventListener('click',async()=>{
        if(!usuario||!objetivoSeguir)return;
        const button=document.getElementById('rechazarAmistad');button.disabled=true;
        try{await cambiarAmistad(objetivoSeguir,'decline');document.getElementById('estadoAmistadPerfil').textContent='Solicitud rechazada.';}
        catch{document.getElementById('estadoAmistadPerfil').textContent='No se pudo rechazar la solicitud. Inténtalo de nuevo.';}
        finally{button.disabled=false;}
    });
    async function cargarAmigos(){
        if(!usuario||!viendoAmigos)return;
        const revision=++revisionAmigos;const box=document.getElementById('listaAmigos'),status=document.getElementById('estadoAmigos');
        status.textContent='Cargando amigos y solicitudes…';
        try{
            const rows=resultado(await db.from('friendships').select('user_a,user_b,requested_by,status,created_at').or('user_a.eq.'+usuario.id+',user_b.eq.'+usuario.id).order('created_at',{ascending:false}).limit(100));
            if(revision!==revisionAmigos)return;
            const ids=[...new Set(rows.map(row=>row.user_a===usuario.id?row.user_b:row.user_a))];
            const people=ids.length?resultado(await db.from('profiles').select('id,username,role').in('id',ids)):[];
            const profiles=new Map(people.map(item=>[item.id,item]));
            box.replaceChildren();
            const incoming=rows.filter(row=>row.status==='pending'&&row.requested_by!==usuario.id);
            const heading=document.createElement('h3');heading.textContent='Solicitudes recibidas ('+incoming.length+')';box.append(heading);
            rows.forEach(row=>{
                const id=row.user_a===usuario.id?row.user_b:row.user_a,person=profiles.get(id);if(!person)return;
                const card=document.createElement('article');card.className='tarjeta-amigo';
                const identity=document.createElement('div');identity.className='amigo-identidad';identity.append(fotoPerfil(id,person),enlaceUsuario(id,person.username),rangoPerfil(person.role));card.append(identity);
                const online=document.createElement('span');online.className='estado-presencia-amigo';online.dataset.userId=id;online.textContent=presenciaEnLinea.has(id)?'En línea':'Desconectado';card.append(online);
                const state=document.createElement('span');state.className='estado-amistad';state.textContent=row.status==='accepted'?'Amigos':row.status==='declined'?'Solicitud rechazada':row.requested_by===usuario.id?'Solicitud enviada':'Te envió una solicitud';card.append(state);
                const actions=document.createElement('div');actions.className='acciones';
            if(row.status==='pending'&&row.requested_by!==usuario.id){const accept=crearBoton('Aceptar');accept.addEventListener('click',()=>hacerAccion(row,'accept'));const decline=crearBoton('Rechazar');decline.addEventListener('click',()=>hacerAccion(row,'decline'));actions.append(accept,decline);}
                else if(row.status==='accepted'){const remove=crearBoton('Eliminar amigo');remove.addEventListener('click',()=>hacerAccion(row,'remove'));actions.append(remove);}
                else if(row.status==='declined'){const dismiss=crearBoton('Quitar');dismiss.addEventListener('click',()=>hacerAccion(row,'remove'));actions.append(dismiss);}
                else if(row.requested_by===usuario.id){const cancel=crearBoton('Cancelar solicitud');cancel.addEventListener('click',()=>hacerAccion(row,'cancel'));actions.append(cancel);}
                card.append(actions);box.append(card);
            });
            if(!rows.length){const empty=document.createElement('p');empty.textContent='Todavía no tienes amigos ni solicitudes. Visita un perfil para agregar a alguien.';box.append(empty);}
            status.textContent='';
        }catch{if(revision===revisionAmigos)status.textContent='No se pudieron cargar tus amistades. Inténtalo de nuevo.';}
        async function hacerAccion(row,action){
            const other=row.user_a===usuario.id?row.user_b:row.user_a;
            try{await cambiarAmistad(other,action);}catch{status.textContent='No se pudo actualizar la solicitud. Inténtalo de nuevo.';}
        }
    }
    document.getElementById('actualizarAmigos').addEventListener('click',cargarAmigos);
    setInterval(()=>{if(viendoAmigos&&!document.hidden)cargarAmigos();},60000);
    async function cargarAmigosDock(){
        const box=document.getElementById('listaDockAmigos'),status=document.getElementById('estadoDockAmigos');
        if(!usuario){box.replaceChildren();return;}
        status.textContent='';
        try{
            const rows=resultado(await db.from('friendships').select('user_a,user_b,status').or('user_a.eq.'+usuario.id+',user_b.eq.'+usuario.id).eq('status','accepted').order('created_at',{ascending:false}).limit(100));
            if(!usuario)return;
            const ids=[...new Set(rows.map(row=>row.user_a===usuario.id?row.user_b:row.user_a))];
            const people=ids.length?resultado(await db.from('profiles').select('id,username,role,avatar_updated_at').in('id',ids)):[];
            const byId=new Map(people.map(person=>[person.id,person]));box.replaceChildren();
            rows.forEach(row=>{
                const id=row.user_a===usuario.id?row.user_b:row.user_a,person=byId.get(id);if(!person)return;
                const item=document.createElement('div');item.className='amigo-dock';item.dataset.userId=id;
                item.append(fotoPerfil(id,person));
                const identity=document.createElement('div');identity.className='amigo-identidad';
                const nameRow=document.createElement('div');nameRow.className='amigo-nombre';nameRow.append(enlaceUsuario(id,person.username),rangoPerfil(person.role));identity.append(nameRow);
                const presence=document.createElement('span');presence.className='estado-presencia-amigo';presence.dataset.userId=id;presence.textContent=presenciaEnLinea.has(id)?'En línea':'Desconectado';presence.classList.toggle('en-linea',presenciaEnLinea.has(id));identity.append(presence);item.append(identity);
                const button=crearBoton('Chat');button.className='boton-chat-amigo';button.setAttribute('aria-label','Abrir chat con @'+person.username);button.addEventListener('click',()=>abrirChatPrivado({id,username:person.username}));item.append(button);box.append(item);
            });
            if(!rows.length){const empty=document.createElement('p');empty.className='estado-vacio-amigos';empty.textContent='Tus amigos aparecerán aquí.';box.append(empty);}
        }catch{status.textContent='No se pudo cargar la lista de amigos.';}
    }
    const ventanaPrivada=document.getElementById('ventanaChatAmigo');
    const listaPrivada=document.getElementById('mensajesPrivados');
    let audioAvisoPrivado=null;
    const avisosMensajesProcesados=new Set();
    function desbloquearAudioAviso(){
        if(!audioAvisoPrivado||audioAvisoPrivado.state!=='running'||audioAvisoPrivado.__desbloqueado)return;
        try{const oscillator=audioAvisoPrivado.createOscillator(),gain=audioAvisoPrivado.createGain();gain.gain.setValueAtTime(0,audioAvisoPrivado.currentTime);oscillator.connect(gain);gain.connect(audioAvisoPrivado.destination);oscillator.start();oscillator.stop(audioAvisoPrivado.currentTime+.01);audioAvisoPrivado.__desbloqueado=true;}catch{}
    }
    function prepararAudioAviso(){
        const AudioContextClass=window.AudioContext||window.webkitAudioContext;
        if(!AudioContextClass)return;
        try{
            if(!audioAvisoPrivado)audioAvisoPrivado=new AudioContextClass();
            if(audioAvisoPrivado.state==='suspended')audioAvisoPrivado.resume().then(desbloquearAudioAviso).catch(()=>{});
            else desbloquearAudioAviso();
        }catch{}
    }
    function sonarAvisoMensaje(){
        if(!audioAvisoPrivado||audioAvisoPrivado.state!=='running')return;
        const now=audioAvisoPrivado.currentTime;
        [[880,0],[1175,.12]].forEach(([frequency,delay])=>{
            const oscillator=audioAvisoPrivado.createOscillator(),gain=audioAvisoPrivado.createGain();
            oscillator.type='sine';oscillator.frequency.value=frequency;
            gain.gain.setValueAtTime(.0001,now+delay);gain.gain.exponentialRampToValueAtTime(.075,now+delay+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+delay+.16);
            oscillator.connect(gain);gain.connect(audioAvisoPrivado.destination);oscillator.start(now+delay);oscillator.stop(now+delay+.17);
        });
    }
    document.addEventListener('pointerdown',prepararAudioAviso,{once:true});
    document.addEventListener('keydown',prepararAudioAviso,{once:true});
    function pintarMensajePrivado(row){
        if(!row||mensajesPrivadosCargados.has(row.id)||!amigoChatActivo)return;
        if(!((row.sender_id===usuario?.id&&row.recipient_id===amigoChatActivo.id)||(row.recipient_id===usuario?.id&&row.sender_id===amigoChatActivo.id)))return;
        mensajesPrivadosCargados.add(row.id);
        const item=document.createElement('article');item.className='mensaje-privado'+(row.sender_id===usuario.id?' propio':'');item.dataset.messageId=row.id;
        const body=document.createElement('p');pintarTextoConGif(body,row.body);
        const time=document.createElement('time');time.dateTime=row.created_at;time.textContent=new Date(row.created_at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
        item.append(body,time);listaPrivada.append(item);while(listaPrivada.children.length>50){mensajesPrivadosCargados.delete(listaPrivada.firstElementChild.dataset.messageId);listaPrivada.firstElementChild.remove();}
        listaPrivada.scrollTop=listaPrivada.scrollHeight;
    }
    function procesarAvisoPrivado(row,owner){
        if(!row||row.recipient_id!==owner||usuario?.id!==owner)return;
        avisarNuevoMensaje(row,'private');
        if(amigoChatActivo&&row.sender_id===amigoChatActivo.id)pintarMensajePrivado(row);
        else{const friend=document.querySelector('.amigo-dock[data-user-id="'+CSS.escape(row.sender_id)+'"] .boton-chat-amigo');if(friend)friend.textContent='Chat · nuevo';}
    }
    function avisarNuevoMensaje(row,tipo){
        if(!row?.id||avisosMensajesProcesados.has(row.id))return;
        avisosMensajesProcesados.add(row.id);if(avisosMensajesProcesados.size>300)avisosMensajesProcesados.delete(avisosMensajesProcesados.values().next().value);
        sonarAvisoMensaje();
        if(document.hidden&&'Notification' in window&&Notification.permission==='granted'){
            const body=tipo==='private'?'Tienes un nuevo mensaje privado.':'Hay un mensaje nuevo en el chat comunitario.';
            if(registroAvisosNavegador?.showNotification)registroAvisosNavegador.showNotification('Nuevo mensaje · RedMusica',{body,tag:'redmusica-mensaje-'+row.id}).catch(()=>{});
            else try{const notice=new Notification('Nuevo mensaje · RedMusica',{body,tag:'redmusica-mensaje-'+row.id});notice.onclick=()=>{window.focus();notice.close();};}catch{}
        }
    }
    async function abrirChatPrivado(person){
        if(!exigirCuenta())return;
        try{
            const friendship=await obtenerAmistad(person.id);
            if(!friendship||friendship.status!=='accepted'){document.getElementById('estadoDockAmigos').textContent='El chat solo está disponible entre amigos.';return;}
            amigoChatActivo=person;mensajesPrivadosCargados.clear();listaPrivada.replaceChildren();
            document.getElementById('tituloChatAmigo').textContent='@'+person.username;
            const toggleMinimize=document.getElementById('minimizarChatAmigo');toggleMinimize.textContent='−';toggleMinimize.setAttribute('aria-label','Minimizar chat');
            document.getElementById('estadoChatPrivado').textContent='Cargando conversación…';
            ventanaPrivada.hidden=false;ventanaPrivada.classList.remove('minimizado');
            const filter='and(sender_id.eq.'+usuario.id+',recipient_id.eq.'+person.id+'),and(sender_id.eq.'+person.id+',recipient_id.eq.'+usuario.id+')';
            const rows=resultado(await db.from('dm_messages').select('id,sender_id,recipient_id,body,created_at').or(filter).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(50));
            if(amigoChatActivo?.id!==person.id)return;
            rows.reverse().forEach(pintarMensajePrivado);document.getElementById('estadoChatPrivado').textContent='';document.getElementById('textoChatPrivado').focus();
        }catch{document.getElementById('estadoChatPrivado').textContent='No se pudo abrir el chat. Comprueba que siguen siendo amigos.';}
    }
    function iniciarMensajesPrivados(){
        if(!usuario){if(canalMensajesPrivados){db.removeChannel(canalMensajesPrivados);canalMensajesPrivados=null;}propietarioMensajesPrivados=null;amigoChatActivo=null;ventanaPrivada.hidden=true;return;}
        if(canalMensajesPrivados&&propietarioMensajesPrivados===usuario.id)return;
        if(canalMensajesPrivados)db.removeChannel(canalMensajesPrivados);
        const owner=usuario.id;propietarioMensajesPrivados=owner;avisosMensajesProcesados.clear();
        canalMensajesPrivados=db.channel('redmusica-dms-'+owner).on('postgres_changes',{event:'INSERT',schema:'public',table:'dm_messages'},payload=>{
            const row=payload.new;
            if(usuario?.id!==owner)return;
            if(row.recipient_id===owner)procesarAvisoPrivado(row,owner);
            else if(amigoChatActivo&&row.sender_id===owner&&row.recipient_id===amigoChatActivo.id)pintarMensajePrivado(row);
        }).subscribe();
    }
    document.getElementById('formularioChatPrivado').addEventListener('submit',event=>{
        event.preventDefault();const form=event.currentTarget,input=document.getElementById('textoChatPrivado'),button=document.getElementById('enviarChatPrivado');let body;try{body=prepararCuerpo(form,input,1000);}catch(error){document.getElementById('estadoChatPrivado').textContent=error.message;return;}
        if(!body||!amigoChatActivo||!exigirCuenta())return;
        accion(button,document.getElementById('estadoChatPrivado'),async()=>{
            const row=resultado(await db.from('dm_messages').insert({recipient_id:amigoChatActivo.id,body}).select('id,sender_id,recipient_id,body,created_at').single());
            pintarMensajePrivado(row);input.value='';form.querySelector('.url-gif-adjunto').value='';form.querySelector('.gif-vista-previa')?.remove();
        });
    });
    document.getElementById('minimizarChatAmigo').addEventListener('click',event=>{
        const button=event.currentTarget,collapsed=ventanaPrivada.classList.toggle('minimizado');
        button.textContent=collapsed?'□':'−';button.setAttribute('aria-label',collapsed?'Restaurar chat':'Minimizar chat');
        if(!collapsed)document.getElementById('textoChatPrivado').focus();
    });
    document.getElementById('cerrarChatAmigo').addEventListener('click',()=>{ventanaPrivada.hidden=true;amigoChatActivo=null;});
    const dockButton=document.getElementById('abrirDockAmigos'),dock=document.getElementById('dockAmigos');
    dockButton.addEventListener('click',()=>{const open=dock.classList.toggle('abierto');dockButton.setAttribute('aria-expanded',String(open));});
    document.getElementById('actualizarDockAmigos').addEventListener('click',cargarAmigosDock);
    async function actualizarConteoSolicitudesAmistad(){
        if(!usuario)return;
        try{
            const rows=resultado(await db.from('friendships').select('requested_by,status').eq('status','pending').or('user_a.eq.'+usuario.id+',user_b.eq.'+usuario.id).limit(100));
            const count=rows.filter(row=>row.requested_by!==usuario.id).length;
            document.getElementById('amigosNav').textContent=count?'Amigos ('+count+')':'Amigos';
        }catch{}
    }
    setInterval(()=>{if(usuario&&!document.hidden)actualizarConteoSolicitudesAmistad();},120000);

    async function cargarFeed(reiniciar) {
        if(viendoVideos){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','cuenta','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            if(usuario)await cargarVideos();else document.getElementById('estadoVideos').textContent='Inicia sesión para ver recomendaciones.';
            return;
        }
        if(viendoJuegos){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','cuenta','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            if(usuario)await cargarJuegos();else document.getElementById('estadoJuegos').textContent='Inicia sesión para ver y publicar recomendaciones.';
            return;
        }
        if(viendoEventos){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','cuenta','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            if(usuario)await cargarEventos();else document.getElementById('estadoEventos').textContent='Inicia sesión para ver eventos e invitaciones.';
            return;
        }
        if(viendoBlackjack){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','cuenta','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            return;
        }
        if(viendoAmigos){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','cuenta','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            if(usuario)cargarAmigos();else document.getElementById('estadoAmigos').textContent='Inicia sesión para ver tus amigos y solicitudes.';
            return;
        }
        if(viendoListas&&!listaActualId){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            document.getElementById('estadoListas').textContent=usuario?'Elige una lista para ver sus publicaciones.':'Inicia sesión para crear y ver tus listas.';
            return;
        }
        if((viendoActividad||viendoGuardados||viendoListas)&&!usuario){feed.replaceChildren();document.getElementById('feedVacio').hidden=true;estadoFeed.textContent='Inicia sesión para ver esta sección.';return;}
        const revision = ++revisionFeed;
        refrescar.disabled = true;
        mas.disabled = true;
        estadoFeed.textContent = "Cargando publicaciones…";
        const inicio = reiniciar ? 0 : desplazamiento;
        try {
            if (viendoPerfil) {
                const publico = idPerfilValido ? resultado(await db.from("profiles").select("username,created_at,role,bio,status_text,avatar_updated_at").eq("id", perfilSolicitado).maybeSingle()) : null;
                if (revision !== revisionFeed) return;
                if (!publico) {
                    document.getElementById('fotoPerfilPublico').replaceChildren();
                    document.getElementById('rangoPerfilPublico').replaceChildren();
                    document.getElementById('bioPerfilPublico').textContent = '';
                    document.getElementById('estadoBrevePublico').hidden=true;
                    document.getElementById('albumesPerfil').replaceChildren();
                    objetivoSeguir=null;document.getElementById("seguirPerfil").hidden=true;document.getElementById("conteoSeguidores").textContent="";
                    document.getElementById('presenciaPerfil').dataset.userId='';document.getElementById('amistadPerfil').hidden=true;document.getElementById('rechazarAmistad').hidden=true;
                    document.getElementById("tituloPerfilPublico").textContent = "Perfil no encontrado";
                    document.getElementById("fechaPerfilPublico").textContent = "";
                    document.getElementById("resumenPerfilPublico").textContent = "Comprueba el enlace o vuelve a Inicio.";
                    document.getElementById("compartirPerfil").hidden = true;
                    document.getElementById("feedVacio").hidden = true;
                    feed.textContent = "";
                    mas.hidden = true;
                    estadoFeed.textContent = "";
                    return;
                }
                document.getElementById('fotoPerfilPublico').replaceChildren(fotoPerfil(perfilSolicitado, publico));
                document.getElementById('rangoPerfilPublico').replaceChildren(rangoPerfil(publico.role));
                document.getElementById('bioPerfilPublico').textContent = publico.bio || 'Todavía no hay una presentación.';
                const statusNode=document.getElementById('estadoBrevePublico');statusNode.textContent=publico.status_text||'';statusNode.hidden=!publico.status_text;
                await cargarFotosPerfil(perfilSolicitado,Boolean(usuario&&usuario.id===perfilSolicitado));
                document.title = "@" + publico.username + " · RedMusica";
                document.getElementById('presenciaPerfil').dataset.userId=perfilSolicitado;actualizarIndicadoresPresencia();
                objetivoSeguir=perfilSolicitado;const followButton=document.getElementById('seguirPerfil');
                followButton.hidden=!usuario||usuario.id===perfilSolicitado;
                if(usuario&&usuario.id!==perfilSolicitado){
                    const existing=resultado(await db.from('follows').select('followed_id').eq('user_id',usuario.id).eq('followed_id',perfilSolicitado));
                    perfilSeguido=existing.length>0;followButton.textContent=perfilSeguido?'Dejar de seguir':'Seguir';
                }
                const followers=await db.from('follows').select('user_id',{count:'exact',head:true}).eq('followed_id',perfilSolicitado);
                const following=await db.from('follows').select('followed_id',{count:'exact',head:true}).eq('user_id',perfilSolicitado);
                document.getElementById('conteoSeguidores').textContent=(followers.count||0)+' seguidores · '+(following.count||0)+' siguiendo';
                await cargarEstadoAmistadPerfil();
                document.getElementById("tituloPerfilPublico").textContent = "@" + publico.username;
                document.getElementById("fechaPerfilPublico").textContent = "En RedMusica desde " + new Date(publico.created_at).toLocaleDateString("es", { month: "long", year: "numeric" });
                document.getElementById("enlacePerfil").value = location.origin + location.pathname + "?perfil=" + encodeURIComponent(perfilSolicitado);
                document.getElementById("compartirPerfil").hidden = false;
            }
            let postIds=null,friendAuthors=null,rowsEnFuente=0,datos=[],respuesta={count:null};
            if(viendoGuardados){
                if(!usuario)throw Error('Inicia sesión para ver los guardados.');
                document.getElementById('tituloFeed').textContent='Guardados';document.getElementById('feedVacio').textContent='Todavía no guardas publicaciones.';
                const rows=resultado(await db.from('saved_posts').select('post_id,created_at').eq('user_id',usuario.id).order('created_at',{ascending:false}).range(inicio,inicio+porPagina-1));
                postIds=rows.map(row=>row.post_id);rowsEnFuente=rows.length;
            }else if(viendoListas&&listaActualId){
                if(!usuario)throw Error('Inicia sesión para ver tus listas.');
                const rows=resultado(await db.from('personal_list_items').select('post_id,created_at').eq('list_id',listaActualId).order('created_at',{ascending:false}).range(inicio,inicio+porPagina-1));
                postIds=rows.map(row=>row.post_id);rowsEnFuente=rows.length;
                const selected=misListas.find(list=>list.id===listaActualId);document.getElementById('tituloFeed').textContent=selected?selected.name:'Publicaciones de la lista';
            }else if(viendoActividad){
                if(!usuario)throw Error('Inicia sesión para ver la actividad de tus amigos.');
                const rows=resultado(await db.from('friendships').select('user_a,user_b').eq('status','accepted').or('user_a.eq.'+usuario.id+',user_b.eq.'+usuario.id).limit(500));
                friendAuthors=[...new Set(rows.map(row=>row.user_a===usuario.id?row.user_b:row.user_a))];
                document.getElementById('tituloFeed').textContent='Actividad de tus amigos';
                if(!friendAuthors.length)document.getElementById('feedVacio').textContent='Agrega amigos para ver sus publicaciones aquí.';
            }
            if(postIds!==null&&postIds.length){
                respuesta=await db.from('posts').select(seleccionPosts).in('id',postIds);
                datos=resultado(respuesta);const byId=new Map(datos.map(post=>[post.id,post]));datos=postIds.map(id=>byId.get(id)).filter(Boolean);
            }else if(postIds===null&&!(friendAuthors&&friendAuthors.length===0)){
                let consulta=db.from('posts').select(seleccionPosts,viendoPerfil?{count:'exact'}:{});
                if(viendoPerfil)consulta=consulta.eq('user_id',perfilSolicitado);
                else if(friendAuthors)consulta=consulta.in('user_id',friendAuthors);
                else consulta=consulta.eq('post_type',viendoMemes?'meme':viendoPeliculas?'film':viendoMusica?'album':'status');
                respuesta=await consulta.order('created_at',{ascending:false}).order('id',{ascending:false}).range(inicio,inicio+porPagina-1);datos=resultado(respuesta);rowsEnFuente=datos.length;
            }
            let propios=[],guardados=[];
            if(usuario&&datos.length){
                [propios,guardados]=await Promise.all([
                    db.from('likes').select('post_id').eq('user_id',usuario.id).in('post_id',datos.map(post=>post.id)),
                    db.from('saved_posts').select('post_id').eq('user_id',usuario.id).in('post_id',datos.map(post=>post.id))
                ]);propios=resultado(propios);guardados=resultado(guardados);
            }
            if (revision !== revisionFeed) return;
            if (viendoPerfil) document.getElementById("resumenPerfilPublico").textContent = respuesta.count + (respuesta.count === 1 ? " publicación" : " publicaciones");
            if (reiniciar) feed.textContent = "";
            datos.forEach(function (post) { feed.appendChild(crearPublicacion(post, propios.some(like => like.post_id === post.id),guardados.some(saved=>saved.post_id===post.id))); });
            desplazamiento = inicio + (postIds!==null?rowsEnFuente:datos.length);
            mas.hidden = (postIds!==null?rowsEnFuente:datos.length) < porPagina;
            document.getElementById("feedVacio").hidden = feed.children.length > 0;
            estadoFeed.textContent = "";
        } catch (error) {
            if (revision === revisionFeed) estadoFeed.textContent = "No se pudieron cargar las publicaciones. Pulsa Actualizar para reintentar.";
        } finally {
            if (revision === revisionFeed) { refrescar.disabled = false; mas.disabled = false; }
        }
    }
    refrescar.addEventListener("click", function () { cargarFeed(true); });
    mas.addEventListener("click", function () { cargarFeed(false); });

    function aplicarRuta() {
        let params = new URLSearchParams(location.search);
        if(sesionLista&&!usuario&&(params.has('perfil')||params.has('seccion'))){history.replaceState(null,'',location.pathname);params=new URLSearchParams();}
        perfilSolicitado = params.get('perfil');
        viendoPerfil = perfilSolicitado !== null;
        viendoMemes = !viendoPerfil && params.get('seccion') === 'memes';
        viendoPeliculas = !viendoPerfil && params.get('seccion') === 'peliculas';
        viendoAmigos = !viendoPerfil && params.get('seccion') === 'amigos';
        viendoActividad = !viendoPerfil && params.get('seccion') === 'actividad';
        viendoGuardados = !viendoPerfil && params.get('seccion') === 'guardados';
        viendoBlackjack = !viendoPerfil && params.get('seccion') === 'blackjack';
        viendoListas = !viendoPerfil && params.get('seccion') === 'listas';
        viendoEventos = !viendoPerfil && params.get('seccion') === 'eventos';
        viendoVideos = !viendoPerfil && params.get('seccion') === 'videos';
        viendoJuegos = !viendoPerfil && params.get('seccion') === 'juegos';
        viendoMusica = !viendoPerfil && params.get('seccion') === 'musica';
        listaActualId=params.get('lista');
        idPerfilValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(perfilSolicitado || '');
        document.getElementById('perfilPublico').hidden = !viendoPerfil;
        document.getElementById('crearPublicacion').hidden = !viendoMusica;
        document.getElementById('compositorMuro').hidden = !usuario || viendoPerfil || viendoMemes || viendoPeliculas || viendoAmigos || viendoActividad || viendoGuardados || viendoListas || viendoEventos || viendoVideos || viendoJuegos || viendoMusica || viendoBlackjack;
        document.getElementById('crearMeme').hidden = !viendoMemes || !usuario || !perfil;
        document.getElementById('seccionPeliculas').hidden = !viendoPeliculas;
        document.getElementById('seccionListas').hidden = !viendoListas;
        document.getElementById('seccionVideos').hidden = !viendoVideos;
        document.getElementById('seccionJuegos').hidden = !viendoJuegos;
        document.getElementById('seccionEventos').hidden = !viendoEventos;
        document.getElementById('seccionBlackjack').hidden = !viendoBlackjack;
        document.getElementById('seccionAmigos').hidden = !viendoAmigos;
        document.getElementById('amigosNav').setAttribute('aria-current',viendoAmigos?'page':'false');
        document.getElementById('actividadNav').setAttribute('aria-current',viendoActividad?'page':'false');
        document.getElementById('guardadosNav').setAttribute('aria-current',viendoGuardados?'page':'false');
        document.getElementById('listasNav').setAttribute('aria-current',viendoListas?'page':'false');
        document.getElementById('eventosNav').setAttribute('aria-current',viendoEventos?'page':'false');
        document.getElementById('videosNav').setAttribute('aria-current',viendoVideos?'page':'false');
        document.getElementById('juegosNav').setAttribute('aria-current',viendoJuegos?'page':'false');
        document.getElementById('musicaNav').setAttribute('aria-current',viendoMusica?'page':'false');
        document.getElementById('blackjackNav').setAttribute('aria-current',viendoBlackjack?'page':'false');
        actualizarVisibilidadCuenta();
        document.getElementById('chatComunitario').hidden = !usuario || viendoAmigos || viendoBlackjack;
        ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=viendoAmigos||viendoBlackjack;});
        document.getElementById('reseñaPelicula').hidden = !viendoPeliculas || !usuario || !perfil || !peliculaSeleccionada;
        document.getElementById('memesNav').setAttribute('aria-current', viendoMemes ? 'page' : 'false');
        document.getElementById('peliculasNav').setAttribute('aria-current', viendoPeliculas ? 'page' : 'false');
        document.getElementById('inicioNav').setAttribute('aria-current', !viendoPerfil && !viendoMemes && !viendoPeliculas && !viendoAmigos && !viendoActividad && !viendoGuardados && !viendoListas && !viendoEventos && !viendoVideos && !viendoJuegos && !viendoMusica && !viendoBlackjack ? 'page' : 'false');
        document.getElementById('tituloFeed').textContent = viendoPerfil ? 'Publicaciones de este perfil' : viendoMemes ? 'Memes de la comunidad' : viendoPeliculas ? 'Reseñas de películas' : viendoMusica ? 'Publicaciones de música' : viendoActividad ? 'Actividad de tus amigos' : viendoGuardados ? 'Guardados' : viendoListas ? 'Mis listas' : 'Publicaciones del muro';
        document.getElementById('feedVacio').textContent = viendoPerfil ? 'Este usuario todavía no ha publicado.' : viendoMemes ? 'Todavía no hay memes. ¡Comparte el primero!' : viendoPeliculas ? 'Todavía no hay reseñas. ¡Comparte la primera!' : viendoMusica ? 'Todavía no hay álbumes reseñados. ¡Comparte el primero!' : viendoActividad ? 'Agrega amigos para ver sus publicaciones aquí.' : viendoGuardados ? 'Todavía no guardas publicaciones.' : viendoListas ? 'Esta lista todavía no tiene publicaciones.' : 'Todavía no hay publicaciones. Comparte algo en el muro.';
        document.title = viendoPerfil ? 'Perfil · RedMusica' : viendoMemes ? 'Memes · RedMusica' : viendoPeliculas ? 'Películas · RedMusica' : viendoAmigos ? 'Amigos · RedMusica' : viendoActividad ? 'Actividad de amigos · RedMusica' : viendoGuardados ? 'Guardados · RedMusica' : viendoListas ? 'Mis listas · RedMusica' : viendoBlackjack ? 'Blackjack · RedMusica' : viendoEventos ? 'Eventos · RedMusica' : viendoVideos ? 'Videos · RedMusica' : viendoJuegos ? 'Juegos · RedMusica' : viendoMusica ? 'Música · RedMusica' : 'RedMusica';
        if (!viendoPerfil) {
            document.getElementById('fotoPerfilPublico').replaceChildren();
            document.getElementById('rangoPerfilPublico').replaceChildren();
            document.getElementById('tituloPerfilPublico').textContent = 'Cargando perfil…';
            document.getElementById('resumenPerfilPublico').textContent = '';
        document.getElementById('compartirPerfil').hidden = true;
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=viendoAmigos||viendoBlackjack||(viendoListas&&!listaActualId);});
            document.getElementById('chatComunitario').hidden=!usuario||viendoAmigos||viendoBlackjack;
            actualizarVisibilidadCuenta();
            document.getElementById('presenciaPerfil').dataset.userId='';
            document.getElementById('amistadPerfil').hidden=true;
            document.getElementById('rechazarAmistad').hidden=true;
        }
        cargarFeed(true);
    }
    document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : event.target.parentElement;
        const anchor = target?.closest('a[href]');
        if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target || anchor.hasAttribute('download')) return;
        const destination = new URL(anchor.href, location.href);
        if (destination.origin !== location.origin || destination.pathname !== location.pathname) return;
        event.preventDefault();
        if (destination.href !== location.href) history.pushState(null, '', destination.href);
        aplicarRuta();
        window.scrollTo({ top: 0, behavior: 'instant' });
    });
    window.addEventListener('popstate', aplicarRuta);

    function crearPublicacion(post, meGusta, estaGuardada=false) {
        const articulo = document.createElement("article");
        articulo.dataset.postId = post.id;
        articulo.id = post.id;
        const autor = document.createElement("p");
        autor.className = "autor-publicacion";
        autor.append(fotoPerfil(post.user_id, post.profiles), enlaceUsuario(post.user_id, post.profiles.username), rangoPerfil(post.profiles.role));
        const fecha=document.createElement('time');fecha.className='fecha-publicacion';fecha.dateTime=post.created_at;fecha.textContent=post.created_at?new Date(post.created_at).toLocaleString('es-CL',{dateStyle:'medium',timeStyle:'short'}):'';autor.append(fecha);
        const esMeme = post.post_type === 'meme';
        const esPelicula = post.post_type === 'film';
        const esEstado = post.post_type === 'status';
        let portada = document.createElement("img");
        portada.loading = "lazy";
        portada.width = esPelicula ? 300 : 250;
        portada.height = esPelicula ? 450 : 250;
        if (esMeme) {
            portada.className='imagen-meme'; portada.alt='Meme publicado por @'+post.profiles.username;
            portada.src=config.supabaseUrl+'/storage/v1/object/public/post-images/'+post.image_path.split('/').map(encodeURIComponent).join('/');
        } else if (esPelicula) {
            portada.className='poster-pelicula';portada.alt='Afiche de '+post.film_title;
            const posterUrl=imagenAfiche(post.film_poster,600);
            if(posterUrl){portada.src=posterUrl;activarRespaldoAfiche(portada,{title:post.film_title,year:post.film_year,poster:post.film_poster,tmdb_id:post.film_tmdb_id},600);}
            else {portada=crearAficheAlternativo(post.film_title,post.film_year);recuperarAfichePublicacion(portada,{title:post.film_title,year:post.film_year,tmdb_id:post.film_tmdb_id},600);}
        } else if (!esEstado) asignarPortada(portada, "https://coverartarchive.org/release-group/" + post.album_id + "/front-500", post.album_title, post.album_artist);
        else if (post.image_path) { portada.className='imagen-muro';portada.alt='Imagen compartida por @'+post.profiles.username;portada.src=config.supabaseUrl+'/storage/v1/object/public/post-images/'+post.image_path.split('/').map(encodeURIComponent).join('/'); }
        const titulo = document.createElement("h3");
        titulo.textContent = esMeme ? 'Meme de @'+post.profiles.username : esPelicula ? post.film_title : esEstado ? 'Publicación' : post.album_title;
        const artista = document.createElement("p");
        artista.hidden=esMeme||esEstado; artista.textContent = esPelicula ? [post.film_director,post.film_year].filter(Boolean).join(' · ') : post.album_artist || '';
        const puntuacion=document.createElement('p');
        puntuacion.className='nota-pelicula';puntuacion.hidden=!esPelicula;
        puntuacion.textContent=esPelicula?'★'.repeat(Math.floor(post.film_rating))+(post.film_rating%1?'½':'')+' · '+Number(post.film_rating).toLocaleString('es-CL',{minimumFractionDigits:post.film_rating%1?1:0,maximumFractionDigits:1})+'/5':'';
        const texto = document.createElement("p");
        texto.className = "opinion";
        pintarTextoConGif(texto,post.body);
        const mensaje = document.createElement("p");
        mensaje.setAttribute("role", "status");
        const acciones = document.createElement("div");
        acciones.className = "acciones";
        const like = crearBoton("");
        let cantidad = post.likes[0].count;
        function actualizarLike() {
            like.textContent = (meGusta ? "♥" : "♡") + " Me gusta (" + cantidad + ")";
            like.setAttribute("aria-pressed", String(meGusta));
        }
        actualizarLike();
        like.addEventListener("click", function () {
            if (!exigirCuenta()) return;
            accion(like, mensaje, async function () {
                if (meGusta) resultado(await db.from("likes").delete().eq("post_id", post.id).eq("user_id", usuario.id));
                else {
                    const respuesta = await db.from("likes").insert({ post_id: post.id });
                    if (respuesta.error && respuesta.error.code !== "23505") throw respuesta.error;
                }
                const conteo = await db.from("likes").select("post_id", { count: "exact", head: true }).eq("post_id", post.id);
                resultado(conteo);
                cantidad = conteo.count;
                const propio = resultado(await db.from("likes").select("post_id").eq("post_id", post.id).eq("user_id", usuario.id));
                meGusta = propio.length > 0;
                actualizarLike();
            });
        });
        const comentar = crearBoton("Comentar");
        const zona = document.createElement("div");
        zona.className = "zona-comentarios";
        zona.id = "comentarios-" + post.id;
        zona.hidden = true;
        comentar.setAttribute("aria-controls", zona.id);
        comentar.setAttribute("aria-expanded", "false");
        const lista = document.createElement("div");
        lista.className = "lista-comentarios";
        const estadoComentarios = document.createElement("p");
        estadoComentarios.setAttribute("role", "status");
        const formulario = document.createElement("form");
        formulario.className = "fila-controles";
        const entrada = document.createElement("input");
        entrada.required = false;
        entrada.maxLength = 1000;
        entrada.placeholder = "Escribe un comentario";
        entrada.setAttribute("aria-label", "Escribe un comentario");
        const gifButton=crearBoton('GIF');gifButton.type='button';gifButton.className='abrir-selector-gif';gifButton.dataset.gifTarget='comentario';
        const gifField=document.createElement('input');gifField.type='hidden';gifField.className='url-gif-adjunto';
        const enviar = crearBoton("Enviar");
        enviar.type = "submit";
        formulario.append(entrada,gifField,gifButton, enviar);
        const masComentarios = crearBoton("Ver más comentarios");
        masComentarios.hidden = true;
        let comentariosCargados = 0;
        let cargandoComentarios = false;
        function crearNodoComentario(comentario, esRespuesta) {
            const caja=document.createElement('div');caja.className=esRespuesta?'comentario-publicado comentario-respuesta':'comentario-publicado';
            const p=document.createElement('p'),author=enlaceUsuario(comentario.user_id,comentario.profiles.username),content=document.createElement('span');
            p.append(author,document.createTextNode(': '));pintarTextoConGif(content,comentario.body);p.append(content);caja.append(p);
            if(!esRespuesta&&usuario){
                const reply=crearBoton('Responder');reply.type='button';reply.setAttribute('aria-expanded','false');
                reply.addEventListener('click',()=>{
                    const old=caja.querySelector('.formulario-respuesta-comentario');if(old){old.remove();reply.setAttribute('aria-expanded','false');return;}
                    const form=document.createElement('form');form.className='fila-controles formulario-respuesta-comentario';form.autocomplete='off';
                    const input=document.createElement('input');input.maxLength=1000;input.placeholder='Escribe una respuesta';input.setAttribute('aria-label','Responder a @'+comentario.profiles.username);
                    const gif=document.createElement('input');gif.type='hidden';gif.className='url-gif-adjunto';
                    const gifButton=crearBoton('GIF');gifButton.type='button';gifButton.className='abrir-selector-gif';
                    const send=crearBoton('Enviar respuesta');send.type='submit';
                    const cancel=crearBoton('Cancelar');cancel.type='button';cancel.addEventListener('click',()=>{form.remove();reply.setAttribute('aria-expanded','false');});
                    form.append(input,gif,gifButton,send,cancel);
                    form.addEventListener('submit',event=>{event.preventDefault();if(!exigirCuenta())return;accion(send,estadoComentarios,async()=>{
                        const body=prepararCuerpo(form,input,1000);if(!body)return;
                        resultado(await db.from('comments').insert({post_id:post.id,parent_comment_id:comentario.id,body}));
                        await cargarComentarios(true);estadoComentarios.textContent='Respuesta enviada.';
                    });});
                    caja.append(form);reply.setAttribute('aria-expanded','true');input.focus();
                });
                caja.append(reply);
            }
            return caja;
        }
        async function cargarComentarios(reiniciar) {
            if (cargandoComentarios) return;
            cargandoComentarios = true;
            masComentarios.disabled = true;
            try {
                const desde = reiniciar ? 0 : comentariosCargados;
                const comentarios = resultado(await db.from("comments").select("id,user_id,parent_comment_id,body,created_at,profiles:profiles!comments_user_id_fkey(username)").eq("post_id", post.id).is('parent_comment_id',null).order("created_at", { ascending: false }).order("id", { ascending: false }).range(desde, desde + 49));
                if (reiniciar) lista.textContent = "";
                const replies=comentarios.length?resultado(await db.from('comments').select("id,user_id,parent_comment_id,body,created_at,profiles:profiles!comments_user_id_fkey(username)").eq('post_id',post.id).in('parent_comment_id',comentarios.map(row=>row.id)).order('created_at',{ascending:true}).order('id',{ascending:true}).range(0,199)):[];
                const repliesByParent=new Map();for(const reply of replies){if(!repliesByParent.has(reply.parent_comment_id))repliesByParent.set(reply.parent_comment_id,[]);repliesByParent.get(reply.parent_comment_id).push(reply);}
                comentarios.forEach(function (comentario) {
                    const node=crearNodoComentario(comentario,false),children=repliesByParent.get(comentario.id)||[];
                    if(children.length){const thread=document.createElement('div');thread.className='respuestas-comentario';children.forEach(reply=>thread.append(crearNodoComentario(reply,true)));node.append(thread);}
                    lista.append(node);
                });
                comentariosCargados = desde + comentarios.length;
                masComentarios.hidden = comentarios.length < 50;
                estadoComentarios.textContent = "";
            } catch (error) { estadoComentarios.textContent = "No se pudieron cargar los comentarios. Cierra y vuelve a abrir Comentar para reintentar."; }
            finally { cargandoComentarios = false; masComentarios.disabled = false; }
        }
        masComentarios.addEventListener("click", function () { cargarComentarios(false); });
        comentar.addEventListener("click", function () {
            zona.hidden = !zona.hidden;
            comentar.setAttribute("aria-expanded", String(!zona.hidden));
            if (!zona.hidden) { cargarComentarios(true); entrada.focus(); }
        });
        formulario.addEventListener("submit", function (evento) {
            evento.preventDefault();
            if (!exigirCuenta()) return;
            accion(enviar, estadoComentarios, async function () {
                const body=prepararCuerpo(formulario,entrada,1000);if(!body)return;
                resultado(await db.from("comments").insert({ post_id: post.id, body }));
                entrada.value = "";
                gifField.value='';formulario.querySelector('.gif-vista-previa')?.remove();
                await cargarComentarios(true);
                estadoComentarios.textContent = "Comentario enviado.";
            });
        });
        zona.append(lista, masComentarios, estadoComentarios, formulario);
        acciones.append(like, comentar);
        if(usuario){
            const guardarPublicacion=crearBoton(estaGuardada?'Guardado':'Guardar');guardarPublicacion.setAttribute('aria-pressed',String(estaGuardada));
            guardarPublicacion.addEventListener('click',()=>accion(guardarPublicacion,mensaje,async()=>{
                if(estaGuardada)resultado(await db.from('saved_posts').delete().eq('post_id',post.id).eq('user_id',usuario.id));
                else {const response=await db.from('saved_posts').insert({post_id:post.id});if(response.error&&response.error.code!=='23505')throw response.error;}
                estaGuardada=!estaGuardada;guardarPublicacion.textContent=estaGuardada?'Guardado':'Guardar';guardarPublicacion.setAttribute('aria-pressed',String(estaGuardada));mensaje.textContent=estaGuardada?'Añadido a Guardados.':'Quitado de Guardados.';
                if(viendoGuardados&&!estaGuardada){articulo.remove();document.getElementById('feedVacio').hidden=feed.children.length>0;}
            }));acciones.append(guardarPublicacion);
            if(viendoListas&&listaActualId){const quitarDeLista=crearBoton('Quitar de esta lista');quitarDeLista.addEventListener('click',()=>accion(quitarDeLista,mensaje,async()=>{
                resultado(await db.from('personal_list_items').delete().eq('list_id',listaActualId).eq('post_id',post.id));articulo.remove();document.getElementById('feedVacio').hidden=feed.children.length>0;
            }));acciones.append(quitarDeLista);}
            if(misListas.length){
                const select=document.createElement('select');select.setAttribute('aria-label','Elegir lista para esta publicación');const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Añadir a una lista…';select.append(placeholder);
                misListas.forEach(list=>{const option=document.createElement('option');option.value=list.id;option.textContent=list.name;select.append(option);});
                const add=crearBoton('Añadir');add.addEventListener('click',()=>{if(!select.value){mensaje.textContent='Elige una lista primero.';return;}accion(add,mensaje,async()=>{const response=await db.from('personal_list_items').insert({list_id:select.value,post_id:post.id});if(response.error&&response.error.code!=='23505')throw response.error;select.value='';mensaje.textContent='Añadido a tu lista.';});});
                acciones.append(select,add);
            }
        }
        if (usuario && post.user_id === usuario.id) {
            const editar = crearBoton("Editar");
            const borrar = crearBoton("Eliminar");
            const editor = document.createElement("form");
            editor.hidden = true;
            const opinion = document.createElement("textarea");
            opinion.required = true;
            opinion.maxLength = 5000;
            opinion.setAttribute("aria-label", "Editar opinión");
            opinion.value = post.body;
            const guardar = crearBoton("Guardar cambios");
            guardar.type = "submit";
            const cancelar = crearBoton("Cancelar");
            cancelar.addEventListener("click", function () { editor.hidden = true; opinion.value = post.body; });
            editor.append(opinion, guardar, cancelar);
            editar.addEventListener("click", function () { editor.hidden = !editor.hidden; if (!editor.hidden) opinion.focus(); });
            editor.addEventListener("submit", function (evento) {
                evento.preventDefault();
                if (!exigirCuenta() || !opinion.value.trim()) return;
                accion(guardar, mensaje, async function () {
                    const filas = resultado(await db.from("posts").update({ body: opinion.value.trim() }).eq("id", post.id).select("id"));
                    if (!filas.length) throw new Error("Publicación no disponible");
                    post.body = opinion.value.trim();
                    texto.textContent = post.body;
                    editor.hidden = true;
                    mensaje.textContent = "Publicación actualizada.";
                });
            });
            borrar.addEventListener("click", function () {
                if (!exigirCuenta() || !confirm("¿Eliminar esta publicación y sus comentarios?")) return;
                accion(borrar, mensaje, async function () {
                    const filas = resultado(await db.from("posts").delete().eq("id", post.id).select("id"));
                    if (!filas.length) throw new Error("Publicación no disponible");
                    if (post.image_path) {
                        const cleanup=await db.storage.from('post-images').remove([post.image_path]);
                        if(cleanup.error) mensaje.textContent='La publicación se eliminó, pero no se pudo liberar el archivo de imagen.';
                    }
                    await cargarFeed(true);
                });
            });
            acciones.append(editar, borrar);
            articulo.appendChild(editor);
        }
        articulo.classList.toggle('publicacion-pelicula',esPelicula);
        if(esPelicula){const source=document.createElement('a');source.href=post.film_tmdb_id?'https://www.themoviedb.org/movie/'+encodeURIComponent(post.film_tmdb_id):'https://www.wikidata.org/wiki/'+encodeURIComponent(post.film_wikidata_id||'');source.target='_blank';source.rel='noopener';source.textContent=post.film_tmdb_id?'Ficha en TMDb':'Ficha en Wikidata';source.className='fuente-pelicula';articulo.prepend(autor,portada,titulo,artista,puntuacion,source,texto,acciones,mensaje,zona);}
        else if(esEstado){
            const elements=[autor,titulo];if(post.image_path)elements.push(portada);if(post.body.trim())elements.push(texto);
            if(post.link_url){try{const url=new URL(post.link_url);if(url.protocol==='https:'){const link=document.createElement('a');link.className='enlace-muro';link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=url.hostname+url.pathname;elements.push(link);}}catch{}}
            elements.push(acciones,mensaje,zona);articulo.classList.add('publicacion-muro');articulo.prepend(...elements);
        }
        else articulo.prepend(autor, portada, titulo, artista, texto, acciones, mensaje, zona);
        return articulo;
    }

    document.getElementById('formularioMuro').addEventListener('submit',event=>{
        event.preventDefault();if(!exigirCuenta())return;
        const form=event.currentTarget,button=document.getElementById('publicarMuro'),status=document.getElementById('estadoMuro');
        const body=document.getElementById('textoMuro').value.trim(),rawUrl=document.getElementById('enlaceMuro').value.trim(),file=document.getElementById('imagenMuro').files[0];
        let linkUrl=null;
        if(rawUrl){try{const url=new URL(rawUrl);if(url.protocol!=='https:')throw Error();linkUrl=url.href;}catch{status.textContent='Usa un enlace seguro que empiece por https://.';return;}}
        if(!body&&!linkUrl&&!file){status.textContent='Escribe algo o añade un enlace o una foto.';return;}
        accion(button,status,async()=>{
            let path=null;
            if(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Elige una foto JPG, PNG o WebP.');if(file.size>10*1024*1024)throw Error('La foto no puede superar 10 MB.');
                const blob=await prepararImagenMeme(file);path=usuario.id+'/'+crypto.randomUUID()+'.jpg';
                resultado(await db.storage.from('post-images').upload(path,blob,{upsert:false,contentType:'image/jpeg',cacheControl:'31536000'}));
            }
            try{resultado(await db.from('posts').insert({post_type:'status',body,link_url:linkUrl,image_path:path}));}
            catch(error){if(path)await db.storage.from('post-images').remove([path]);throw error;}
            form.reset();status.textContent='Publicación compartida.';await cargarFeed(true);
        });
    });

    document.getElementById("botonPublicar").addEventListener("click", function (evento) {
        if (!exigirCuenta()) return;
        const opinion = document.getElementById("comentarioPublicacion");
        const estado = document.getElementById("estadoPublicacion");
        if (!albumSeleccionado) { estado.textContent = "Primero debes elegir un álbum."; return; }
        if (!opinion.value.trim()) { estado.textContent = "Escribe algo sobre el álbum."; opinion.focus(); return; }
        accion(evento.currentTarget, estado, async function () {
            resultado(await db.from("posts").insert({ album_id: albumSeleccionado.id, album_title: albumSeleccionado.titulo, album_artist: albumSeleccionado.artista, body: opinion.value.trim() }));
            opinion.value = "";
            estado.textContent = "Publicación compartida.";
            await cargarFeed(true);
        });
    });

    async function buscarCatalogoPeliculas(query) {
        const key=query.trim().toLocaleLowerCase('es');
        const cached=cachePeliculas.get(key);
        if(cached&&cached.expira>Date.now())return cached.movies;
        const {data:catalogData,error}=await db.functions.invoke('movie-catalog',{body:{query:query.trim()}});
        if(error){
            let detail='';try{detail=(await error.context.json()).error||'';}catch{}
            throw new Error(detail||'No se pudo consultar TMDb. Inténtalo de nuevo.');
        }
        const movies=Array.isArray(catalogData?.results)?catalogData.results:[];
        cachePeliculas.set(key,{movies,expira:Date.now()+15*60*1000});
        return movies;
    }
    function normalizarTitulo(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim();}    async function buscarAfichesWikipedia(movies){
        const titles=movies.map(movie=>movie.title).filter(Boolean).slice(0,8);
        if(!titles.length)return new Map();
        const images=new Map();
        for(const language of ['es','en']){
            const url=new URL('https://'+language+'.wikipedia.org/w/api.php');
            url.searchParams.set('action','query');url.searchParams.set('titles',titles.join('|'));url.searchParams.set('prop','pageimages');url.searchParams.set('piprop','thumbnail');url.searchParams.set('pithumbsize','600');url.searchParams.set('format','json');url.searchParams.set('origin','*');
            const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
            try{
                const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});
                if(!response.ok)continue;
                const data=await response.json();
                for(const page of Object.values(data.query?.pages||{})){
                    const image=page.thumbnail;
                    if(!image?.source||image.width<140||image.height<200||image.width/image.height>=0.9)continue;
                    const key=normalizarTitulo(page.title),match=titles.find(title=>normalizarTitulo(title)===key);
                    if(match&&!images.has(normalizarTitulo(match)))images.set(normalizarTitulo(match),image.source);
                }
            }catch{}
        }
        return images;
    }
    let contadorJsonpAfiche=0;
    function buscarAficheItunes(query){
        return new Promise(resolve=>{
            const callback='redmusicaFilmArtwork'+(++contadorJsonpAfiche);
            const script=document.createElement('script');
            const url=new URL('https://itunes.apple.com/search');
            url.searchParams.set('term',query);url.searchParams.set('entity','movie');url.searchParams.set('country','cl');url.searchParams.set('limit','50');url.searchParams.set('callback',callback);
            let terminado=false;
            const finalizar=items=>{if(terminado)return;terminado=true;clearTimeout(timeout);delete window[callback];script.remove();resolve(items||[]);};
            window[callback]=data=>finalizar(Array.isArray(data?.results)?data.results:[]);
            script.onerror=()=>finalizar([]);script.src=url.href;document.head.append(script);
            const timeout=setTimeout(()=>finalizar([]),5000);
        });
    }
    function imagenAfiche(value,width){
        if(!value)return '';
        const tmdb=value.match(/^https:\/\/image\.tmdb\.org\/t\/p\/(?:original|w\d+)(\/[A-Za-z0-9._-]+)$/i);
        if(tmdb)return 'https://image.tmdb.org/t/p/'+(width>500?'w780':'w500')+tmdb[1];
        if(/^https:\/\/is\d+-ssl\.mzstatic\.com\//i.test(value))return value.replace(/\/(?:100|512|600)x(?:100|512|600)(?:bb)?\./,'/'+width+'x'+Math.round(width*1.5)+'bb.');
        if(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//i.test(value))return value;
        const commonsFile=value.match(/^https:\/\/commons\.wikimedia\.org\/wiki\/(?:Special:FilePath\/|File:)([^?#]+)/i);
        if(commonsFile)return 'https://commons.wikimedia.org/wiki/Special:FilePath/'+commonsFile[1]+'?width='+width;
        if(!/^https?:\/\//i.test(value)&&value.length<=500)return 'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(value.replace(/^File:/i,''))+'?width='+width;
        return '';
    }
    function activarRespaldoAfiche(image,movie,width){
        let etapa=0,actual=image.src;
        image.onerror=async()=>{
            if(etapa===0){etapa=1;try{const wiki=await buscarAfichesWikipedia([movie]),candidate=imagenAfiche(wiki.get(normalizarTitulo(movie.title)),width);if(candidate&&candidate!==actual){actual=candidate;image.src=candidate;return;}}catch{}}
            if(etapa<=1){etapa=2;try{const artwork=await buscarAficheItunes([movie.title,movie.year].filter(Boolean).join(' ')),match=artwork.find(item=>normalizarTitulo(item.trackName)===normalizarTitulo(movie.title)&&(!movie.year||!item.releaseDate||Math.abs(Number(item.releaseDate.slice(0,4))-movie.year)<=1)),candidate=imagenAfiche(match?.artworkUrl600||match?.artworkUrl512||match?.artworkUrl100,width);if(candidate&&candidate!==actual){actual=candidate;image.src=candidate;return;}}catch{}}
            image.onerror=null;image.replaceWith(crearAficheAlternativo(movie.title,movie.year));
        };
    }
    async function recuperarAfichePublicacion(fallback,movie,width){
        try{
            const lookup=movie.tmdb_id?await db.functions.invoke('movie-catalog',{body:{movieId:movie.tmdb_id}}):await db.functions.invoke('movie-catalog',{body:{query:movie.title}});
            if(lookup.error)throw lookup.error;
            const options=Array.isArray(lookup.data?.results)?lookup.data.results:[],match=options.find(item=>(movie.tmdb_id?Number(item.tmdb_id)===Number(movie.tmdb_id):normalizarTitulo(item.title)===normalizarTitulo(movie.title))&&(!movie.year||!item.year||item.year===movie.year));
            const url=imagenAfiche(match?.poster,width);if(!url||!fallback.isConnected)return;
            const image=document.createElement('img');image.className='poster-pelicula';image.width=300;image.height=450;image.loading='lazy';image.alt='Afiche de '+movie.title;image.src=url;
            activarRespaldoAfiche(image,{...movie,poster:match.poster},width);fallback.replaceWith(image);
        }catch{}
    }
    function crearAficheAlternativo(title,year){
        const fallback=document.createElement('div');fallback.className='poster-pelicula poster-pelicula-alternativo';fallback.setAttribute('role','img');fallback.setAttribute('aria-label','Portada de '+title);
        const marca=document.createElement('span');marca.textContent='REDMUSICA · CINE';
        const titulo=document.createElement('strong');titulo.textContent=title;
        const fecha=document.createElement('span');fecha.textContent=year||'AFICHE NO DISPONIBLE';
        fallback.append(marca,titulo,fecha);return fallback;
    }
    function establecerAfiche(contenedor,movie,width){
        contenedor.replaceChildren();
        const url=imagenAfiche(movie.poster,width);
        if(!url){contenedor.append(crearAficheAlternativo(movie.title,movie.year));return;}
        const image=document.createElement('img');image.className='poster-pelicula';image.width=300;image.height=450;image.loading='lazy';image.alt='Afiche de '+movie.title;image.src=url;
        activarRespaldoAfiche(image,movie,width);contenedor.append(image);
    }
    const formularioBusquedaPeliculas=document.getElementById('formularioBusquedaPeliculas');
    formularioBusquedaPeliculas.addEventListener('submit',async event=>{
        event.preventDefault();
        const button=document.getElementById('buscarPeliculas'),status=document.getElementById('estadoBusquedaPeliculas');
        const query=document.getElementById('buscarPelicula').value.trim();
        if(query.length<2){status.textContent='Escribe al menos dos letras del título.';return;}
        const revision=++revisionBusquedaPeliculas;button.disabled=true;status.textContent='Buscando en el catálogo abierto…';
        const results=document.getElementById('resultadosPeliculas');results.replaceChildren();results.hidden=false;
        try{
            const movies=await buscarCatalogoPeliculas(query);
            if(revision!==revisionBusquedaPeliculas)return;
            status.textContent=movies.length?'Elige la película que quieres reseñar.':'No encontramos películas con ese nombre. Prueba el título original.';
            movies.forEach(movie=>{
                const card=document.createElement('article');card.className='tarjeta-pelicula';
                const posterBox=document.createElement('div');posterBox.className='marco-afiche-resultado';
                const posterUrl=imagenAfiche(movie.poster,360);
                if(posterUrl){const image=document.createElement('img');image.className='poster-resultado-pelicula';image.loading='lazy';image.alt='Afiche de '+movie.title;image.src=posterUrl;activarRespaldoAfiche(image,movie,360);posterBox.append(image);}
                else posterBox.append(crearAficheAlternativo(movie.title,movie.year));card.append(posterBox);
                const title=document.createElement('h3');title.textContent=movie.title;
                const meta=document.createElement('p');meta.textContent=[movie.director,movie.year,movie.description].filter(Boolean).join(' · ');
                    const source=document.createElement('a');source.href='https://www.themoviedb.org/movie/'+encodeURIComponent(movie.tmdb_id);source.target='_blank';source.rel='noopener';source.textContent='Ficha en TMDb';
                const choose=crearBoton('Escribir reseña');choose.addEventListener('click',()=>{
                    peliculaSeleccionada=movie;document.getElementById('tituloResenaPelicula').textContent=movie.title;
                    establecerAfiche(document.getElementById('posterSeleccionPelicula'),movie,600);
                    document.getElementById('datosPelicula').textContent=[movie.director,movie.year].filter(Boolean).join(' · ')||'Ficha de Wikidata';
                    results.hidden=true;document.getElementById('reseñaPelicula').hidden=!usuario||!perfil;
                    status.textContent=usuario&&perfil?'Añade tu puntuación y reseña.':'Inicia sesión para publicar una reseña.';
                    if(usuario&&perfil)document.getElementById('notaPelicula').focus();
                });
                card.append(title,meta,source,choose);results.append(card);
            });
        }catch(error){if(revision===revisionBusquedaPeliculas)status.textContent=error.name==='AbortError'?'El catálogo está tardando demasiado. Inténtalo de nuevo.':error.message||'No se pudo consultar el catálogo. Inténtalo de nuevo.';}
        finally{if(revision===revisionBusquedaPeliculas)button.disabled=false;}
    });
    document.getElementById('cambiarPelicula').addEventListener('click',()=>{
        peliculaSeleccionada=null;document.getElementById('reseñaPelicula').hidden=true;document.getElementById('resultadosPeliculas').hidden=false;
        document.getElementById('estadoBusquedaPeliculas').textContent='Elige otra película del catálogo.';document.getElementById('buscarPelicula').focus();
    });
    document.getElementById('formularioResenaPelicula').addEventListener('submit',event=>{
        event.preventDefault();
        const status=document.getElementById('estadoResenaPelicula');
        if(!exigirCuenta()||!peliculaSeleccionada)return;
        const body=document.getElementById('opinionPelicula').value.trim();
        if(!body){status.textContent='Escribe tu reseña.';return;}
        const button=document.getElementById('publicarResenaPelicula');
        accion(button,status,async()=>{
            const movie=peliculaSeleccionada;
            resultado(await db.from('posts').insert({post_type:'film',film_wikidata_id:null,film_tmdb_id:movie.tmdb_id,film_title:movie.title,film_director:movie.director,film_year:movie.year,film_poster:movie.poster,film_rating:Number(document.getElementById('notaPelicula').value),body}));
            document.getElementById('formularioResenaPelicula').reset();peliculaSeleccionada=null;
            document.getElementById('reseñaPelicula').hidden=true;document.getElementById('resultadosPeliculas').hidden=false;
            document.getElementById('estadoBusquedaPeliculas').textContent='Reseña publicada.';status.textContent='';
            await cargarFeed(true);
        });
    });

    async function prepararImagenMeme(file) {
        if(!file||!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('Elige una imagen JPG, PNG, WebP o GIF.');
        if(file.size>10*1024*1024)throw Error('La imagen no puede superar 10 MB.');
        if(file.type==='image/gif'){if(file.size>1048576)throw Error('El GIF no puede superar 1 MB para cuidar el espacio de almacenamiento.');return file;}
        const url=URL.createObjectURL(file);
        try{
            const img=new Image();img.src=url;await img.decode();
            if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>50000000)throw Error('La imagen es demasiado grande para procesarla.');
            const scale=Math.min(1,1280/Math.max(img.naturalWidth,img.naturalHeight));
            const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
            canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
            for(const quality of [.84,.72,.60]){
                const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
                if(blob&&blob.size<=1048576)return blob;
            }
            throw Error('La imagen aún ocupa más de 1 MB tras reducirla. Elige una imagen más sencilla.');
        } finally {URL.revokeObjectURL(url);}
    }
    document.getElementById('formularioMeme').addEventListener('submit',e=>{
        e.preventDefault();const button=document.getElementById('publicarMeme'),status=document.getElementById('estadoMeme');
        if(!exigirCuenta())return;
        accion(button,status,async()=>{
            status.textContent='Preparando imagen…';
            const blob=await prepararImagenMeme(document.getElementById('imagenMeme').files[0]);
            const isGif=document.getElementById('imagenMeme').files[0].type==='image/gif';const path=usuario.id+'/'+crypto.randomUUID()+(isGif?'.gif':'.jpg');
            resultado(await db.storage.from('post-images').upload(path,blob,{upsert:false,contentType:isGif?'image/gif':'image/jpeg',cacheControl:'31536000'}));
            try{
                resultado(await db.from('posts').insert({post_type:'meme',image_path:path,body:document.getElementById('textoMeme').value.trim()}).select('id').single());
            }catch(error){await db.storage.from('post-images').remove([path]);throw error;}
            document.getElementById('formularioMeme').reset();status.textContent='Meme publicado.';await cargarFeed(true);
        });
    });
})();
