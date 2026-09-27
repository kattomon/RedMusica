/* Shared mode: authorization is enforced by Supabase RLS, not by these buttons. */
(function () {
    const config = window.REDMUSICA_CONFIG;
    const db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    window.redmusicaClient = db;
    const perfilSolicitado = new URLSearchParams(location.search).get("perfil");
    const viendoPerfil = perfilSolicitado !== null;
    const idPerfilValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(perfilSolicitado || "");
    document.getElementById("navegacion").hidden = false;
    document.getElementById("perfilPublico").hidden = !viendoPerfil;
    document.getElementById("crearPublicacion").hidden = viendoPerfil;
    if (viendoPerfil) {
        document.getElementById("tituloFeed").textContent = "Publicaciones de este perfil";
        document.getElementById("feedVacio").textContent = "Este usuario todavía no ha publicado.";
        document.title = "Perfil · RedMusica";
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
        return enlace;
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
        aviso.textContent = "Prueba inicial: el correo todavía no se verifica y no hay recuperación de contraseña. Guarda tu contraseña; no uses la de otros servicios.";
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
    mas.hidden = true;
    feed.after(mas);
    let usuario = null;
    let perfil = null;
    let perfilSeguido = false, objetivoSeguir = null, guardandoSeguir = false;
    let offsetNotificaciones = 0, cargandoNotificaciones = false, revisionNotificaciones = 0, notificacionesAbiertas = false;
    let recuperando = false;
    let revisionSesion = 0;
    let revisionFeed = 0;
    let desplazamiento = 0;
    const porPagina = 20;
    const seleccionPosts = "id,user_id,album_id,album_title,album_artist,body,created_at,profiles:profiles!posts_user_id_fkey(username,role,avatar_updated_at),likes(count)";
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
        if (!usuario) { notificacionesAbiertas=false; document.getElementById("abrirNotificaciones").setAttribute("aria-expanded", "false"); }
        document.getElementById("formularioAcceso").hidden = Boolean(usuario);
        document.getElementById("sesionPerfil").hidden = !usuario;
        document.getElementById("formularioNuevaClave").hidden = !recuperando || !usuario;
        document.getElementById("abrirNotificaciones").hidden = !usuario;
        document.getElementById("notificaciones").hidden = !usuario || !notificacionesAbiertas;
        const nombre = document.getElementById('nombrePerfil');
        nombre.textContent = perfil ? 'Publicas como @' + perfil.username + ' ' : 'Cargando tu perfil…';
        document.getElementById('miFoto').replaceChildren();
        if (perfil && usuario) { nombre.append(rangoPerfil(perfil.role)); document.getElementById('miFoto').append(fotoPerfil(usuario.id, perfil)); }
        document.getElementById('bioPerfil').value = perfil?.bio || '';
        document.getElementById('quitarFoto').disabled = !perfil?.avatar_updated_at;
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
        try {
            if (usuario) {
                const datos = resultado(await db.from("profiles").select("username,role,bio,avatar_updated_at").eq("id", usuario.id).single());
                if (revision !== revisionSesion) return;
                perfil = datos;
            }
            if (revision !== revisionSesion) return;
            actualizarAcceso();
            await cargarFeed(true);
            revisionNotificaciones++;offsetNotificaciones=0;actualizarContadorNotificaciones();
        } catch (error) {
            if (revision === revisionSesion) estadoPerfil.textContent = "No se pudo cargar tu perfil. Recarga la página para volver a intentarlo.";
        }
    }
    // Never await another Auth call inside this callback (the SDK holds a lock).
    db.auth.onAuthStateChange(function (evento, session) {
        setTimeout(function () { sincronizarSesion(session, evento); }, 0);
    });

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
                estadoPerfil.textContent = respuesta.data.session ? "Cuenta creada." : "Revisa tu correo para confirmar la cuenta antes de entrar. Si ya tienes cuenta, inicia sesión.";
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

    async function cargarFeed(reiniciar) {
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
                objetivoSeguir=perfilSolicitado;const followButton=document.getElementById('seguirPerfil');
                followButton.hidden=!usuario||usuario.id===perfilSolicitado;
                if(usuario&&usuario.id!==perfilSolicitado){
                    const existing=resultado(await db.from('follows').select('followed_id').eq('user_id',usuario.id).eq('followed_id',perfilSolicitado));
                    perfilSeguido=existing.length>0;followButton.textContent=perfilSeguido?'Dejar de seguir':'Seguir';
                }
                const followers=await db.from('follows').select('user_id',{count:'exact',head:true}).eq('followed_id',perfilSolicitado);
                const following=await db.from('follows').select('followed_id',{count:'exact',head:true}).eq('user_id',perfilSolicitado);
                document.getElementById('conteoSeguidores').textContent=(followers.count||0)+' seguidores · '+(following.count||0)+' siguiendo';
                document.getElementById("tituloPerfilPublico").textContent = "@" + publico.username;
                document.getElementById("fechaPerfilPublico").textContent = "En RedMusica desde " + new Date(publico.created_at).toLocaleDateString("es", { month: "long", year: "numeric" });
                document.getElementById("enlacePerfil").value = location.origin + location.pathname + "?perfil=" + encodeURIComponent(perfilSolicitado);
                document.getElementById("compartirPerfil").hidden = false;
            }
            let consulta = db.from("posts").select(seleccionPosts, viendoPerfil ? { count: "exact" } : {});
            if (viendoPerfil) consulta = consulta.eq("user_id", perfilSolicitado);
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

    function crearPublicacion(post, meGusta) {
        const articulo = document.createElement("article");
        articulo.dataset.postId = post.id;
        articulo.id = post.id;
        const autor = document.createElement("p");
        autor.className = "autor-publicacion";
        autor.append(fotoPerfil(post.user_id, post.profiles), enlaceUsuario(post.user_id, post.profiles.username), rangoPerfil(post.profiles.role));
        const portada = document.createElement("img");
        portada.loading = "lazy";
        portada.width = 250;
        portada.height = 250;
        asignarPortada(portada, "https://coverartarchive.org/release-group/" + post.album_id + "/front-500", post.album_title, post.album_artist);
        const titulo = document.createElement("h3");
        titulo.textContent = post.album_title;
        const artista = document.createElement("p");
        artista.textContent = post.album_artist;
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
                    await cargarFeed(true);
                });
            });
            acciones.append(editar, borrar);
            articulo.appendChild(editor);
        }
        articulo.prepend(autor, portada, titulo, artista, texto, acciones, mensaje, zona);
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
})();
