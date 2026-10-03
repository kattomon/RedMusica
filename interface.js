/* Shared presentation only: no extra database reads or persisted personal data. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    if (!$('contenidoPrincipal')) return;
    const main = $('contenidoPrincipal'), flow = $('flujoPublicaciones'), composer = $('compositorMuro');
    // Persistent controls stay outside the view that administration temporarily replaces.
    document.body.insertBefore($('notificaciones'),document.querySelector('.site-layout'));
    for(const id of ['inicioNav','actividadNav','miPerfil','musicaNav','peliculasNav','librosNav','videosNav','juegosNav','poolNav','bachilleratoNav','naipesNav','cancionNav','memesNav','amigosNav','eventosNav','diarioNav','listasNav','guardadosNav','blackjackNav'])$('navegacion').append($(id));
    const install=$('instalarApp'),installHome=install.parentElement,mobile=matchMedia('(max-width:700px)');
    const placeInstall=()=>{if(mobile.matches)main.prepend(install);else installHome.append(install);};
    mobile.addEventListener('change',placeInstall);placeInstall();
    let accountId = null;
    const paths = {
        inicioNav:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
        actividadNav:'M3 12h4l3-8 4 16 3-8h4',
        musicaNav:'M9 18V5l11-2v13M9 8l11-2M9 18c0 2-2 3-4 3s-3-1-3-2 2-3 4-3 3 1 3 2Zm11-2c0 2-2 3-4 3s-3-1-3-2 2-3 4-3 3 1 3 2Z',
        peliculasNav:'M3 4h18v17H3ZM3 9h18M7 4l4 5m3-5 4 5',
        librosNav:'M12 5v16M12 5C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 1Z',
        memesNav:'M3 4h18v16H3ZM3 16l5-5 4 4 4-7 5 8M7 8h.01',
        amigosNav:'M16 21v-3c0-3-3-4-6-4s-6 1-6 4v3M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-6c4 0 4 6 0 6m2 4c2 1 3 2 3 5',
        guardadosNav:'M6 3h12v18l-6-4-6 4Z',
        listasNav:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
        diarioNav:'M4 3h16v18H4ZM8 7h8M8 12h8M8 17h5',
        eventosNav:'M3 6h18v15H3ZM7 3v6m10-6v6M3 11h18M7 15h3',
        videosNav:'M4 3h16v18H4Zm5 5v9l7-4.5Z',
        juegosNav:'M7 7h10c3 0 4 3 5 10 0 4-4 2-6-1H8c-2 3-6 5-6 1 1-7 2-10 5-10ZM6 11v5m-2-2h5m7-2h.01m3 3h.01',
        poolNav:'M4 4h16v16H4ZM5 5l3 3m11-3-3 3M5 19l3-3m11 3-3-3M10 10h.01m4 4h.01',
        naipesNav:'M4 5h9v14H4ZM13 8l6 2-4 11-2-.7M7 9h.01M10 15h.01',
        cancionNav:'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 10l10-2',
        bachilleratoNav:'M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5M15 15l1.5 1.5L19 13',
        blackjackNav:'m7 2 13 3-4 17-13-3Zm5 6-4 4 2 4 4-4Z',
        miPerfil:'M4 21v-3c0-4 16-4 16 0v3M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'
    };
    const svg = d => { const el=document.createElementNS('http://www.w3.org/2000/svg','svg');el.setAttribute('viewBox','0 0 24 24');el.setAttribute('aria-hidden','true');const path=document.createElementNS(el.namespaceURI,'path');path.setAttribute('d',d);el.append(path);return el; };
    // Pseudo icons don't interfere with code which updates the link text (friend counts).
    for (const [id,d] of Object.entries(paths)) {
        const link=$(id);if(!link)continue;
        const icon=svg(d);link.style.setProperty('--nav-icon','url("data:image/svg+xml,'+encodeURIComponent(new XMLSerializer().serializeToString(icon).replace('<svg ','<svg fill="none" stroke="%COLOR%" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ').replace('%COLOR%','#5d625e'))+'")');
    }
    $('abrirRadio').textContent='Radio';$('abrirRadio').setAttribute('aria-label','Radio ♫');$('abrirRadio').prepend(svg(paths.musicaNav));
    $('abrirDockAmigos').prepend(svg(paths.amigosNav));
    const closeFriends=document.createElement('button');closeFriends.type='button';closeFriends.id='cerrarDockAmigos';closeFriends.textContent='×';closeFriends.setAttribute('aria-label','Cerrar lista de amigos');
    $('dockAmigos').querySelector('header').append(closeFriends);
    closeFriends.addEventListener('click',()=>{if($('dockAmigos').classList.contains('abierto'))$('abrirDockAmigos').click();$('abrirDockAmigos').focus();});

    function profileTab(tab='muro') {
        const valid=['muro','presentacion','fotos','conciertos','diario'];if(!valid.includes(tab))tab='muro';
        $('perfilPublico').dataset.tab=tab;
        document.querySelectorAll('[data-perfil-tab]').forEach(link=>link.setAttribute('aria-current',link.dataset.perfilTab===tab?'page':'false'));
        const sections={sobrePerfil:'presentacion',mediosPerfil:'fotos',conciertosPerfil:'conciertos',blogPerfil:'diario'};
        for(const [id,value] of Object.entries(sections))$(id).hidden=tab!==value && !(tab==='muro' && ['sobrePerfil','mediosPerfil'].includes(id));
        $('perfilTimeline').hidden=tab!=='muro';
    }
    function updateRoute() {
        const params=new URLSearchParams(location.search),profile=params.get('perfil'),section=params.get('seccion')||'inicio';
        document.body.dataset.section=profile?'perfil':section;
        document.body.classList.toggle('profile-page',Boolean(profile));
        flow.hidden=!profile&&['amigos','blackjack','pool','bachillerato','naipes','cancion','eventos','videos','administracion'].includes(section);
        const destination=profile?$('perfilTimeline'):main;
        if(profile){if(flow.parentElement!==destination)destination.append(flow);}
        else if(flow.parentElement!==main)main.insertBefore(flow,$('chatComunitario'));
        const own=profile&&accountId===profile;
        if(own){$('perfilTimeline').insertBefore(composer,flow);composer.hidden=false;}
        else if(composer.parentElement!==main){main.insertBefore(composer,$('seccionAmigos'));composer.hidden=Boolean(profile)||section!=='inicio'||!accountId;}
        if(profile){const link=[...document.querySelectorAll('[data-perfil-tab]')].find(link=>link.hash===location.hash);profileTab(link?.dataset.perfilTab||'muro');}
        const mi=$('miPerfil');if(mi)mi.setAttribute('aria-current',own?'page':'false');
        document.querySelectorAll('#navegacion a').forEach(link=>{if(section==='administracion')link.setAttribute('aria-current','false');if(link.getAttribute('aria-current')==='page')link.setAttribute('title','Sección actual: '+link.textContent);else link.removeAttribute('title');});
        $('compartirPerfil').classList.remove('compartir-abierto');
        $('compartirPerfilBoton').setAttribute('aria-expanded','false');
    }
    function setAccount(user,profile) {
        accountId=user?.id||null;
        for(const id of ['perfilCabecera','perfilLateral']){
            const link=$(id);link.hidden=!user||!profile;
            if(user)link.href='?perfil='+encodeURIComponent(user.id);else link.removeAttribute('href');
        }
        $('nombreLateral').textContent=profile?'@'+profile.username:'';
        $('perfilCabecera').setAttribute('aria-label',profile?'Mi perfil, @'+profile.username:'Mi perfil');
        $('perfilCabecera').querySelector('.perfil-cabecera-nombre').textContent=profile?'@'+profile.username:'Mi perfil';
        for(const id of ['avatarLateral','avatarCabecera']){const node=$('miFoto')?.firstElementChild;$(id).replaceChildren(...(node?[node.cloneNode(true)]:[]));}
    }
    document.addEventListener('click',event=>{
        const tab=event.target.closest('[data-perfil-tab]');
        if(!tab||$('perfilPublico').hidden)return;
        event.preventDefault();history.replaceState(null,'',location.pathname+location.search+tab.hash);profileTab(tab.dataset.perfilTab);
    },true);
    $('compartirPerfilBoton').addEventListener('click',()=>{
        const box=$('compartirPerfil');box.classList.toggle('compartir-abierto');
        $('compartirPerfilBoton').setAttribute('aria-expanded',String(box.classList.contains('compartir-abierto')));
        if(box.classList.contains('compartir-abierto')){$('enlacePerfil').focus();$('enlacePerfil').select();}
    });

    const search=$('buscarSeccion'),results=$('resultadosSecciones');let matches=[];
    function hideSearch(){results.hidden=true;search.setAttribute('aria-expanded','false');}
    function findSections(){
        const text=search.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        matches=text?[...$('navegacion').querySelectorAll('a,button')].filter(link=>!link.hidden&&link.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(text)).slice(0,7):[];
        results.replaceChildren();
        for(const link of matches){const button=document.createElement('button');button.type='button';button.textContent=link.textContent;button.addEventListener('click',()=>{hideSearch();search.value='';link.click();});results.append(button);}
        if(text&&!matches.length){const empty=document.createElement('p');empty.textContent='No encontramos esa sección.';results.append(empty);}
        results.hidden=!text;search.setAttribute('aria-expanded',String(Boolean(text)));
    }
    search.addEventListener('input',findSections);search.addEventListener('focus',findSections);
    $('buscadorSecciones').addEventListener('submit',event=>{event.preventDefault();if(matches[0]){const first=matches[0];hideSearch();search.value='';first.click();}});
    document.addEventListener('pointerdown',event=>{if(!$('buscadorSecciones').contains(event.target))hideSearch();});
    search.addEventListener('keydown',event=>{if(event.key==='Escape')hideSearch();if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}});
    results.addEventListener('keydown',event=>{const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(event.target);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}if(event.key==='Escape'){hideSearch();search.focus();}});
    window.redmusicaUI={updateRoute,setAccount};
    updateRoute();
})();
