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
    let idPerfilValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(perfilSolicitado || "");
    let presenceChannel = null;
    let presenceOwner = null;
    const presenciaEnLinea = new Set();
    let revisionAmigos = 0;
    let canalMensajesPrivados = null, propietarioMensajesPrivados = null;
    let amigoChatActivo = null, mensajesPrivadosCargados = new Set();
    document.getElementById("navegacion").hidden = false;
    document.getElementById("perfilPublico").hidden = !viendoPerfil;
    document.getElementById("crearPublicacion").hidden = viendoPerfil || viendoMemes || viendoPeliculas;
    document.getElementById('crearMeme').hidden = !viendoMemes;
    document.getElementById('seccionPeliculas').hidden = !viendoPeliculas;
    document.getElementById('memesNav').setAttribute('aria-current',viendoMemes?'page':'false');
    document.getElementById('peliculasNav').setAttribute('aria-current',viendoPeliculas?'page':'false');
    document.getElementById('amigosNav').hidden = !viendoAmigos;
    document.getElementById('seccionAmigos').hidden = !viendoAmigos;
    document.getElementById('inicioNav').setAttribute('aria-current',!viendoPerfil&&!viendoMemes&&!viendoPeliculas?'page':'false');
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
        <h2 id="tituloCuenta">Tu cuenta</h2>
        <p>Crea una cuenta para compartir álbumes y conversar con otras personas.</p>
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
            <form id="formularioBio"><label for="bioPerfil">Sobre mí</label><textarea id="bioPerfil" maxlength="300" rows="3"></textarea><button type="submit">Guardar presentación</button></form>
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
    let peliculaSeleccionada = null;
    const cachePeliculas = new Map();
    let revisionBusquedaPeliculas = 0;
    let perfilSeguido = false, objetivoSeguir = null, guardandoSeguir = false;
    let offsetNotificaciones = 0, cargandoNotificaciones = false, revisionNotificaciones = 0, notificacionesAbiertas = false;
    let recuperando = false;
    let revisionSesion = 0;
    let revisionFeed = 0;
    let desplazamiento = 0;
    const porPagina = 20;
    const seleccionPosts = "id,user_id,album_id,album_title,album_artist,post_type,image_path,film_wikidata_id,film_title,film_director,film_year,film_poster,film_rating,body,created_at,profiles:profiles!posts_user_id_fkey(username,role,avatar_updated_at),likes(count)";
    const destinoCorreo = location.origin + location.pathname;
    const estadoPerfil = document.getElementById("estadoPerfil");

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
        document.getElementById('dockAmigos').hidden = !usuario;
        document.getElementById('abrirDockAmigos').hidden = !usuario;
        if(viendoAmigos){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            document.getElementById('cuenta').hidden=Boolean(usuario);
        }
        const nombre = document.getElementById('nombrePerfil');
        nombre.textContent = perfil ? 'Publicas como @' + perfil.username + ' ' : 'Cargando tu perfil…';
        document.getElementById('miFoto').replaceChildren();
        if (perfil && usuario) { nombre.append(rangoPerfil(perfil.role)); document.getElementById('miFoto').append(fotoPerfil(usuario.id, perfil)); }
        document.getElementById('bioPerfil').value = perfil?.bio || '';
        document.getElementById('quitarFoto').disabled = !perfil?.avatar_updated_at;
        document.getElementById('crearMeme').hidden = !viendoMemes || !usuario || !perfil;
        document.getElementById('reseñaPelicula').hidden = !viendoPeliculas || !usuario || !perfil || !peliculaSeleccionada;
        const miPerfil = document.getElementById("miPerfil");
        miPerfil.hidden = !usuario || !perfil;
        if (usuario) miPerfil.href = "?perfil=" + encodeURIComponent(usuario.id);
        else miPerfil.removeAttribute("href");
    }
    async function sincronizarSesion(session, evento) {
        if (session && usuario && session.user.id === usuario.id && perfil && evento !== "PASSWORD_RECOVERY") return;
        const revision = ++revisionSesion;
        usuario = session ? session.user : null;
        perfil = null;
        if (evento === "PASSWORD_RECOVERY") recuperando = true;
        if (!usuario) recuperando = false;
        actualizarAcceso();
        if(usuario)iniciarPresencia();else detenerPresencia();
        try {
            if (usuario) {
                const datos = resultado(await db.from("profiles").select("username,role,bio,avatar_updated_at").eq("id", usuario.id).single());
                if (revision !== revisionSesion) return;
                perfil = datos;
            }
            if (revision !== revisionSesion) return;
            actualizarAcceso();
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

    // One shared chat. Realtime is preferred; polling is only a quiet fallback.
    const cajaChat = document.getElementById('chatComunitario');
    const listaChat = document.getElementById('mensajesChat');
    const estadoChat = document.getElementById('estadoChat');
    cajaChat.hidden = false;
    const perfilesChat = new Map();
    const mensajesChat = new Set();
    let chatChannel = null, realtimeChat = false, cargandoChat = false;
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
        const body=document.createElement('p'); body.textContent=row.body;
        const time=document.createElement('time'); time.dateTime=row.created_at; time.textContent=new Date(row.created_at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
        item.append(author,body,time); listaChat.append(item);
        while(listaChat.children.length>80){const old=listaChat.firstElementChild;mensajesChat.delete(old.dataset.messageId);old.remove();}
        listaChat.scrollTop=listaChat.scrollHeight;
    }
    function iniciarChatRealtime() {
        chatChannel=db.channel('redmusica-chat-general').on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages'},payload=>{
            const row=payload.new;
            if(row.user_id===usuario?.id && perfil) row.profiles=perfil;
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
    iniciarChatRealtime();
    cargarChat();
    document.getElementById('formularioChat').addEventListener('submit',e=>{
        e.preventDefault();const input=document.getElementById('textoChat'),button=document.getElementById('enviarChat');
        if(!exigirCuenta()||!input.value.trim())return;
        accion(button,estadoChat,async()=>{
            const row=resultado(await db.from('chat_messages').insert({body:input.value.trim()}).select('id,user_id,body,created_at').single());
            row.profiles=perfil;renderMensajeChat(row);input.value='';estadoChat.textContent='Mensaje enviado.';
        });
    });
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)cargarChat();});
    setInterval(()=>{if(!realtimeChat&&!document.hidden)cargarChat();},30000);
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
            const filas = resultado(await db.from('profiles').update(cambios).eq('id', id).select('username,role,bio,avatar_updated_at'));
            if (!filas.length) throw Error('No se pudo guardar el perfil.');
            if (revision !== revisionSesion) return;
            perfil = filas[0]; actualizarAcceso(); await cargarFeed(true);
            estadoEdicion.textContent = 'Perfil actualizado.';
        } catch(e) { if(revision === revisionSesion) estadoEdicion.textContent = e.message || 'No se pudo guardar. Inténtalo otra vez.'; }
        finally { guardandoPerfil = false; botones.forEach(b => b.disabled = false); document.getElementById('quitarFoto').disabled = !perfil?.avatar_updated_at; }
    }
    async function prepararFoto(file) {
        if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('Elige una imagen JPG, PNG o WebP.');
        if (file.size > 10*1024*1024) throw Error('La imagen no puede superar 10 MB.');
        const url = URL.createObjectURL(file);
        try {
            const img = new Image(); img.src = url; await img.decode();
            if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 50000000) throw Error('La imagen es demasiado grande. Elige una más pequeña.');
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
            const ctx = canvas.getContext('2d'); const side = Math.min(img.naturalWidth,img.naturalHeight);
            ctx.fillStyle = '#eeeeee'; ctx.fillRect(0,0,512,512);
            ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,512,512);
            const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.88));
            if (!blob || blob.size>1048576) throw Error('No se pudo preparar la foto. Elige otra imagen.');
            return blob;
        } finally { URL.revokeObjectURL(url); }
    }
    document.getElementById('formularioFoto').addEventListener('submit',e=>{
        e.preventDefault(); const file = document.getElementById('archivoFoto').files[0];
        editarDatos(async id=>{ const blob = await prepararFoto(file); resultado(await db.storage.from('avatars').upload(id+'/avatar.jpg',blob,{upsert:true,contentType:'image/jpeg',cacheControl:'60'})); document.getElementById('archivoFoto').value=''; return {avatar_updated_at:new Date().toISOString()}; });
    });
    document.getElementById('formularioBio').addEventListener('submit',e=>{e.preventDefault(); const bio=document.getElementById('bioPerfil').value.trim(); editarDatos(async()=>({bio}));});
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
                const link=enlaceUsuario(id,person.username);card.append(link,rangoPerfil(person.role));
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
                const link=enlaceUsuario(id,person.username);item.append(link);
                const presence=document.createElement('span');presence.className='estado-presencia-amigo';presence.dataset.userId=id;presence.textContent=presenciaEnLinea.has(id)?'En línea':'Desconectado';presence.classList.toggle('en-linea',presenciaEnLinea.has(id));item.append(presence);
                const button=crearBoton('Chat');button.className='boton-chat-amigo';button.setAttribute('aria-label','Abrir chat con @'+person.username);button.addEventListener('click',()=>abrirChatPrivado({id,username:person.username}));item.append(button);box.append(item);
            });
            if(!rows.length){const empty=document.createElement('p');empty.className='estado-vacio-amigos';empty.textContent='Tus amigos aparecerán aquí.';box.append(empty);}
        }catch{status.textContent='No se pudo cargar la lista de amigos.';}
    }
    const ventanaPrivada=document.getElementById('ventanaChatAmigo');
    const listaPrivada=document.getElementById('mensajesPrivados');
    function pintarMensajePrivado(row){
        if(!row||mensajesPrivadosCargados.has(row.id)||!amigoChatActivo)return;
        if(!((row.sender_id===usuario?.id&&row.recipient_id===amigoChatActivo.id)||(row.recipient_id===usuario?.id&&row.sender_id===amigoChatActivo.id)))return;
        mensajesPrivadosCargados.add(row.id);
        const item=document.createElement('article');item.className='mensaje-privado'+(row.sender_id===usuario.id?' propio':'');item.dataset.messageId=row.id;
        const body=document.createElement('p');body.textContent=row.body;
        const time=document.createElement('time');time.dateTime=row.created_at;time.textContent=new Date(row.created_at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
        item.append(body,time);listaPrivada.append(item);while(listaPrivada.children.length>50){mensajesPrivadosCargados.delete(listaPrivada.firstElementChild.dataset.messageId);listaPrivada.firstElementChild.remove();}
        listaPrivada.scrollTop=listaPrivada.scrollHeight;
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
        const owner=usuario.id;propietarioMensajesPrivados=owner;
        canalMensajesPrivados=db.channel('redmusica-dms-'+owner).on('postgres_changes',{event:'INSERT',schema:'public',table:'dm_messages'},payload=>{
            const row=payload.new;
            if(usuario?.id!==owner)return;
            if(amigoChatActivo&&((row.sender_id===owner&&row.recipient_id===amigoChatActivo.id)||(row.recipient_id===owner&&row.sender_id===amigoChatActivo.id)))pintarMensajePrivado(row);
            else if(row.recipient_id===owner){const friend=document.querySelector('.amigo-dock[data-user-id="'+CSS.escape(row.sender_id)+'"] .boton-chat-amigo');if(friend)friend.textContent='Chat · nuevo';}
        }).subscribe();
    }
    document.getElementById('formularioChatPrivado').addEventListener('submit',event=>{
        event.preventDefault();const input=document.getElementById('textoChatPrivado'),button=document.getElementById('enviarChatPrivado'),body=input.value.trim();
        if(!body||!amigoChatActivo||!exigirCuenta())return;
        accion(button,document.getElementById('estadoChatPrivado'),async()=>{
            const row=resultado(await db.from('dm_messages').insert({recipient_id:amigoChatActivo.id,body}).select('id,sender_id,recipient_id,body,created_at').single());
            pintarMensajePrivado(row);input.value='';
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
        if(viendoAmigos){
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','cuenta','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=true;});
            if(usuario)cargarAmigos();else document.getElementById('estadoAmigos').textContent='Inicia sesión para ver tus amigos y solicitudes.';
            return;
        }
        const revision = ++revisionFeed;
        refrescar.disabled = true;
        mas.disabled = true;
        estadoFeed.textContent = "Cargando publicaciones…";
        const inicio = reiniciar ? 0 : desplazamiento;
        try {
            if (viendoPerfil) {
                const publico = idPerfilValido ? resultado(await db.from("profiles").select("username,created_at,role,bio,avatar_updated_at").eq("id", perfilSolicitado).maybeSingle()) : null;
                if (revision !== revisionFeed) return;
                if (!publico) {
                    document.getElementById('fotoPerfilPublico').replaceChildren();
                    document.getElementById('rangoPerfilPublico').replaceChildren();
                    document.getElementById('bioPerfilPublico').textContent = '';
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
            let consulta = db.from("posts").select(seleccionPosts, viendoPerfil ? { count: "exact" } : {});
            if (viendoPerfil) consulta = consulta.eq("user_id", perfilSolicitado);
            else consulta = consulta.eq('post_type',viendoMemes?'meme':viendoPeliculas?'film':'album');
            const respuesta = await consulta.order("created_at", { ascending: false }).order("id", { ascending: false }).range(inicio, inicio + porPagina - 1);
            const datos = resultado(respuesta);
            let propios = [];
            if (usuario && datos.length) propios = resultado(await db.from("likes").select("post_id").eq("user_id", usuario.id).in("post_id", datos.map(p => p.id)));
            if (revision !== revisionFeed) return;
            if (viendoPerfil) document.getElementById("resumenPerfilPublico").textContent = respuesta.count + (respuesta.count === 1 ? " publicación" : " publicaciones");
            if (reiniciar) feed.textContent = "";
            datos.forEach(function (post) { feed.appendChild(crearPublicacion(post, propios.some(like => like.post_id === post.id))); });
            desplazamiento = inicio + datos.length;
            mas.hidden = datos.length < porPagina;
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
        const params = new URLSearchParams(location.search);
        perfilSolicitado = params.get('perfil');
        viendoPerfil = perfilSolicitado !== null;
        viendoMemes = !viendoPerfil && params.get('seccion') === 'memes';
        viendoPeliculas = !viendoPerfil && params.get('seccion') === 'peliculas';
        viendoAmigos = !viendoPerfil && params.get('seccion') === 'amigos';
        idPerfilValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(perfilSolicitado || '');
        document.getElementById('perfilPublico').hidden = !viendoPerfil;
        document.getElementById('crearPublicacion').hidden = viendoPerfil || viendoMemes || viendoPeliculas;
        document.getElementById('crearMeme').hidden = !viendoMemes || !usuario || !perfil;
        document.getElementById('seccionPeliculas').hidden = !viendoPeliculas;
        document.getElementById('seccionAmigos').hidden = !viendoAmigos;
        document.getElementById('amigosNav').setAttribute('aria-current',viendoAmigos?'page':'false');
        document.getElementById('cuenta').hidden = viendoAmigos && Boolean(usuario);
        document.getElementById('chatComunitario').hidden = viendoAmigos;
        ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=viendoAmigos;});
        document.getElementById('reseñaPelicula').hidden = !viendoPeliculas || !usuario || !perfil || !peliculaSeleccionada;
        document.getElementById('memesNav').setAttribute('aria-current', viendoMemes ? 'page' : 'false');
        document.getElementById('peliculasNav').setAttribute('aria-current', viendoPeliculas ? 'page' : 'false');
        document.getElementById('inicioNav').setAttribute('aria-current', !viendoPerfil && !viendoMemes && !viendoPeliculas && !viendoAmigos ? 'page' : 'false');
        document.getElementById('tituloFeed').textContent = viendoPerfil ? 'Publicaciones de este perfil' : viendoMemes ? 'Memes de la comunidad' : viendoPeliculas ? 'Reseñas de películas' : 'Publicaciones';
        document.getElementById('feedVacio').textContent = viendoPerfil ? 'Este usuario todavía no ha publicado.' : viendoMemes ? 'Todavía no hay memes. ¡Comparte el primero!' : viendoPeliculas ? 'Todavía no hay reseñas. ¡Comparte la primera!' : 'Todavía no hay publicaciones. Comparte el primer álbum.';
        document.title = viendoPerfil ? 'Perfil · RedMusica' : viendoMemes ? 'Memes · RedMusica' : viendoPeliculas ? 'Películas · RedMusica' : 'RedMusica';
        if (!viendoPerfil) {
            document.getElementById('fotoPerfilPublico').replaceChildren();
            document.getElementById('rangoPerfilPublico').replaceChildren();
            document.getElementById('tituloPerfilPublico').textContent = 'Cargando perfil…';
            document.getElementById('resumenPerfilPublico').textContent = '';
        document.getElementById('compartirPerfil').hidden = true;
            ['tituloFeed','feedVacio','estadoFeed','actualizarFeed','feed','verMas','chatComunitario'].forEach(id=>{const element=document.getElementById(id);if(element)element.hidden=viendoAmigos;});
            document.getElementById('cuenta').hidden=viendoAmigos&&Boolean(usuario);
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

    function crearPublicacion(post, meGusta) {
        const articulo = document.createElement("article");
        articulo.dataset.postId = post.id;
        articulo.id = post.id;
        const autor = document.createElement("p");
        autor.className = "autor-publicacion";
        autor.append(fotoPerfil(post.user_id, post.profiles), enlaceUsuario(post.user_id, post.profiles.username), rangoPerfil(post.profiles.role));
        const esMeme = post.post_type === 'meme';
        const esPelicula = post.post_type === 'film';
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
            if(posterUrl){portada.src=posterUrl;portada.onerror=()=>{portada.replaceWith(crearAficheAlternativo(post.film_title,post.film_year));};}
            else portada=crearAficheAlternativo(post.film_title,post.film_year);
        } else asignarPortada(portada, "https://coverartarchive.org/release-group/" + post.album_id + "/front-500", post.album_title, post.album_artist);
        const titulo = document.createElement("h3");
        titulo.textContent = esMeme ? 'Meme de @'+post.profiles.username : esPelicula ? post.film_title : post.album_title;
        const artista = document.createElement("p");
        artista.hidden=esMeme; artista.textContent = esPelicula ? [post.film_director,post.film_year].filter(Boolean).join(' · ') : post.album_artist || '';
        const puntuacion=document.createElement('p');
        puntuacion.className='nota-pelicula';puntuacion.hidden=!esPelicula;
        puntuacion.textContent=esPelicula?'★'.repeat(Math.floor(post.film_rating))+(post.film_rating%1?'½':'')+' · '+Number(post.film_rating).toLocaleString('es-CL',{minimumFractionDigits:post.film_rating%1?1:0,maximumFractionDigits:1})+'/5':'';
        const texto = document.createElement("p");
        texto.className = "opinion";
        texto.textContent = post.body;
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
        entrada.required = true;
        entrada.maxLength = 1000;
        entrada.placeholder = "Escribe un comentario";
        entrada.setAttribute("aria-label", "Escribe un comentario");
        const enviar = crearBoton("Enviar");
        enviar.type = "submit";
        formulario.append(entrada, enviar);
        const masComentarios = crearBoton("Ver más comentarios");
        masComentarios.hidden = true;
        let comentariosCargados = 0;
        let cargandoComentarios = false;
        async function cargarComentarios(reiniciar) {
            if (cargandoComentarios) return;
            cargandoComentarios = true;
            masComentarios.disabled = true;
            try {
                const desde = reiniciar ? 0 : comentariosCargados;
                const comentarios = resultado(await db.from("comments").select("id,user_id,body,created_at,profiles:profiles!comments_user_id_fkey(username)").eq("post_id", post.id).order("created_at", { ascending: false }).order("id", { ascending: false }).range(desde, desde + 49));
                if (reiniciar) lista.textContent = "";
                comentarios.forEach(function (comentario) {
                    const p = document.createElement("p");
                    p.append(enlaceUsuario(comentario.user_id, comentario.profiles.username), ": " + comentario.body);
                    lista.appendChild(p);
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
            if (!exigirCuenta() || !entrada.value.trim()) return;
            accion(enviar, estadoComentarios, async function () {
                resultado(await db.from("comments").insert({ post_id: post.id, body: entrada.value.trim() }));
                entrada.value = "";
                await cargarComentarios(true);
                estadoComentarios.textContent = "Comentario enviado.";
            });
        });
        zona.append(lista, masComentarios, estadoComentarios, formulario);
        acciones.append(like, comentar);
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
        if(esPelicula){const source=document.createElement('a');source.href='https://www.wikidata.org/wiki/'+encodeURIComponent(post.film_wikidata_id);source.target='_blank';source.rel='noopener';source.textContent='Ficha en Wikidata';source.className='fuente-pelicula';articulo.prepend(autor,portada,titulo,artista,puntuacion,source,texto,acciones,mensaje,zona);}
        else articulo.prepend(autor, portada, titulo, artista, texto, acciones, mensaje, zona);
        return articulo;
    }

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

    async function wikidata(params) {
        const url = new URL('https://www.wikidata.org/w/api.php');
        Object.entries({...params,format:'json',origin:'*'}).forEach(([key,value])=>url.searchParams.set(key,String(value)));
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
        let response;
        try{response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});}
        finally{clearTimeout(timeout);}
        if(!response.ok)throw new Error('El catálogo de películas no respondió. Inténtalo de nuevo.');
        const data=await response.json();
        if(data.error)throw new Error('El catálogo de películas no pudo completar la búsqueda.');
        return data;
    }
    function claimValue(entity,property) {
        const claims=entity?.claims?.[property]||[];
        return claims.map(item=>item.mainsnak?.datavalue?.value).filter(Boolean);
    }
    function nombreEntidad(entity) {
        return entity?.labels?.es?.value||entity?.labels?.en?.value||'';
    }
    function añoPelicula(entity) {
        const fecha=claimValue(entity,'P577')[0]?.time||claimValue(entity,'P571')[0]?.time||'';
        const match=/^[+-](\d{4})-/.exec(fecha);
        const year=match?Number(match[1]):null;
        return year>=1888&&year<=2100?year:null;
    }
    async function buscarCatalogoPeliculas(query) {
        const key=query.trim().toLocaleLowerCase('es');
        const cached=cachePeliculas.get(key);
        if(cached&&cached.expira>Date.now())return cached.movies;
        const found=await wikidata({action:'wbsearchentities',search:query.trim(),language:'es',uselang:'es',type:'item',limit:12});
        const searchItems=(found.search||[]).filter(item=>/^Q[1-9][0-9]*$/.test(item.id));
        if(!searchItems.length)return [];
        const data=await wikidata({action:'wbgetentities',ids:searchItems.map(item=>item.id).join('|'),props:'claims|labels|descriptions',languages:'es|en',languagefallback:'1'});
        const movieIds=new Set(['Q11424','Q24869','Q506240']);
        const possible=searchItems.map(item=>{
            const entity=data.entities?.[item.id];
            const kinds=claimValue(entity,'P31').map(kind=>kind.id);
            const description=entity?.descriptions?.es?.value||entity?.descriptions?.en?.value||item.description||'';
            const isFilm=kinds.some(kind=>movieIds.has(kind))||(/\b(movie|film|película|pelicula|largometraje|cortometraje)\b/i.test(description)&&!/director|actor|actriz/i.test(description));
            if(!isFilm)return null;
            const directorIds=claimValue(entity,'P57').map(person=>person.id).filter(Boolean);
            const poster=claimValue(entity,'P3383')[0]||claimValue(entity,'P18')[0]||null;
            return {id:item.id,title:nombreEntidad(entity)||item.label||'',description,directorIds,poster,year:añoPelicula(entity)};
        }).filter(movie=>movie&&movie.title);
        if(!possible.length)return [];
        const directorIds=[...new Set(possible.flatMap(movie=>movie.directorIds))];
        let directors={};
        if(directorIds.length){
            const people=await wikidata({action:'wbgetentities',ids:directorIds.slice(0,20).join('|'),props:'labels',languages:'es|en',languagefallback:'1'});
            directors=people.entities||{};
        }
        const movies=possible.slice(0,8).map(movie=>({
            wikidata_id:movie.id,title:movie.title.slice(0,500),
            director:movie.directorIds.map(id=>nombreEntidad(directors[id])).filter(Boolean).join(', ').slice(0,500)||null,
            year:movie.year,poster:movie.poster&&movie.poster.length<=500?movie.poster:null,
            description:movie.description.slice(0,300)
        }));
        const missing=movies.filter(movie=>!movie.poster);
        if(missing.length){
            try{
                const wikipedia=await buscarAfichesWikipedia(missing);
                for(const movie of missing){const image=wikipedia.get(normalizarTitulo(movie.title));if(image)movie.poster=image;}
            }catch{}
        }
        const stillMissing=movies.filter(movie=>!movie.poster);
        if(stillMissing.length){
            try{
                const artwork=await buscarAficheItunes(query);
                for(const movie of stillMissing){
                    const match=artwork.find(item=>normalizarTitulo(item.trackName)===normalizarTitulo(movie.title)
                        &&(!movie.year||!item.releaseDate||Math.abs(Number(item.releaseDate.slice(0,4))-movie.year)<=1));
                    if(match)movie.poster=imagenAfiche(match.artworkUrl600||match.artworkUrl512||match.artworkUrl100,600)||null;
                }
            }catch{}
        }
        cachePeliculas.set(key,{movies,expira:Date.now()+15*60*1000});
        return movies;
    }
    function normalizarTitulo(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g,' ').trim();}
    async function buscarAfichesWikipedia(movies){
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
        if(/^https:\/\/is\d+-ssl\.mzstatic\.com\//i.test(value))return value.replace(/\/(?:100|512|600)x(?:100|512|600)(?:bb)?\./,'/'+width+'x'+Math.round(width*1.5)+'bb.');
        if(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//i.test(value))return value;
        if(!/^https?:\/\//i.test(value)&&value.length<=500)return 'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(value.replace(/^File:/i,''))+'?width='+width;
        return '';
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
        image.onerror=()=>image.replaceWith(crearAficheAlternativo(movie.title,movie.year));contenedor.append(image);
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
                if(posterUrl){const image=document.createElement('img');image.className='poster-resultado-pelicula';image.loading='lazy';image.alt='Afiche de '+movie.title;image.src=posterUrl;image.onerror=()=>image.replaceWith(crearAficheAlternativo(movie.title,movie.year));posterBox.append(image);}
                else posterBox.append(crearAficheAlternativo(movie.title,movie.year));card.append(posterBox);
                const title=document.createElement('h3');title.textContent=movie.title;
                const meta=document.createElement('p');meta.textContent=[movie.director,movie.year,movie.description].filter(Boolean).join(' · ');
                const source=document.createElement('a');source.href='https://www.wikidata.org/wiki/'+encodeURIComponent(movie.wikidata_id);source.target='_blank';source.rel='noopener';source.textContent='Ficha de Wikidata';
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
            resultado(await db.from('posts').insert({post_type:'film',film_wikidata_id:movie.wikidata_id,film_title:movie.title,film_director:movie.director,film_year:movie.year,film_poster:movie.poster,film_rating:Number(document.getElementById('notaPelicula').value),body}));
            document.getElementById('formularioResenaPelicula').reset();peliculaSeleccionada=null;
            document.getElementById('reseñaPelicula').hidden=true;document.getElementById('resultadosPeliculas').hidden=false;
            document.getElementById('estadoBusquedaPeliculas').textContent='Reseña publicada.';status.textContent='';
            await cargarFeed(true);
        });
    });

    async function prepararImagenMeme(file) {
        if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Elige una imagen JPG, PNG o WebP.');
        if(file.size>10*1024*1024)throw Error('La imagen no puede superar 10 MB.');
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
            const path=usuario.id+'/'+crypto.randomUUID()+'.jpg';
            resultado(await db.storage.from('post-images').upload(path,blob,{upsert:false,contentType:'image/jpeg',cacheControl:'31536000'}));
            try{
                resultado(await db.from('posts').insert({post_type:'meme',image_path:path,body:document.getElementById('textoMeme').value.trim()}).select('id').single());
            }catch(error){await db.storage.from('post-images').remove([path]);throw error;}
            document.getElementById('formularioMeme').reset();status.textContent='Meme publicado.';await cargarFeed(true);
        });
    });
})();
