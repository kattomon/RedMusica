(function(){
 const db=window.redmusicaClient;if(!db)return;
 const nav=document.getElementById('navegacion');
 const toggle=document.createElement('button');toggle.type='button';toggle.textContent='Administración';toggle.hidden=true;nav.append(toggle);
 const panel=document.createElement('section');panel.id='administracion';panel.hidden=true;
 panel.innerHTML=`<h2>Administración</h2><p id="adminRango"></p><p id="adminEstado" role="status"></p>
 <details id="adminAjustes"><summary>Ajustes del sitio</summary><form id="adminSettings">
 <label for="adminTitle">Nombre del sitio</label><input id="adminTitle" maxlength="60" required>
 <label for="adminDescription">Descripción</label><textarea id="adminDescription" maxlength="300"></textarea>
 <label><input id="adminPosts" type="checkbox"> Permitir nuevas publicaciones</label><button>Guardar ajustes</button></form></details>
 <details open><summary>Moderación y usuarios</summary><form id="adminFilter" class="fila-controles"><select id="adminKind" aria-label="Administrar"><option value="posts">Publicaciones</option><option value="comments">Comentarios</option><option value="users">Usuarios</option><option value="audit">Registro de acciones</option></select><input id="adminQuery" placeholder="Buscar texto o usuario" aria-label="Buscar en administración" maxlength="100"><button>Buscar / Actualizar</button></form><div id="adminList"></div><button id="adminPrev" type="button">Anterior</button> <button id="adminNext" type="button">Siguiente</button></details>
 <details open><summary>Cabina de radio</summary><p>Dirige la selección musical de toda la sala. Los oyentes recibirán los cambios en hasta 15 segundos. No incluye micrófono ni mezcla de audio.</p><div class="acciones"><button id="adminRadioRefresh" type="button">Actualizar cola</button><button id="adminSkip" type="button">Saltar para todos</button><button id="adminRadioToggle" type="button">Pausar radio</button></div><div id="adminQueue"></div></details>`;
 document.getElementById('cuenta').after(panel);
 const $=id=>document.getElementById(id);let role='member',page=0,paused=false,busy=false,revision=0;
 toggle.setAttribute('aria-controls','administracion');toggle.setAttribute('aria-expanded','false');
 async function call(action,data={}){
  const {data:auth}=await db.auth.getSession();if(!auth.session)throw Error('Inicia sesión.');
  const r=await fetch(window.REDMUSICA_CONFIG.supabaseUrl+'/functions/v1/admin',{method:'POST',headers:{'Content-Type':'application/json',apikey:window.REDMUSICA_CONFIG.supabasePublishableKey,Authorization:'Bearer '+auth.session.access_token},body:JSON.stringify({action,data}),signal:AbortSignal.timeout(15000)});
  const value=await r.json();if(!r.ok)throw Error(value.error||'No se pudo completar la acción.');return value;
 }
 async function action(work){if(busy)return;busy=true;$('adminEstado').textContent='Procesando…';try{await work();$('adminEstado').textContent='Listo.';}catch(e){$('adminEstado').textContent=e.message;}finally{busy=false;}}
 function button(label,work){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>action(work));return b;}
 function line(text){const p=document.createElement('p');p.textContent=text;return p;}
 async function settings(){const {data,error}=await db.from('site_settings').select('*').eq('id',1).maybeSingle();if(error||!data||typeof data.title!=='string')return;
  document.querySelector('main > h1').textContent=data.title;document.querySelector('main > p').textContent=data.description;
  $('adminTitle').value=data.title;$('adminDescription').value=data.description;$('adminPosts').checked=data.accept_posts;
 }
 async function list(){const ticket=revision;const kind=$('adminKind').value;const result=await call('list',{kind,offset:page*30,query:$('adminQuery').value});if(ticket!==revision)return;
  $('adminList').replaceChildren();$('adminPrev').disabled=page===0;$('adminNext').disabled=result.items.length<30;
  for(const item of result.items){const row=document.createElement('article');
   if(kind==='users'){
    row.append(line('@'+item.username+' · '+item.role+(item.suspended?' · Suspendido':'')));
    if(item.role!=='owner'){
     row.append(button(item.suspended?'Reactivar':'Suspender',async()=>{if(!confirm('¿Cambiar el estado de @'+item.username+'?'))return;await call('suspend',{id:item.id,suspended:!item.suspended});await list();}));
     if(role==='owner')row.append(button(item.role==='admin'?'Retirar admin':'Dar rango admin',async()=>{if(!confirm('¿Cambiar el rango de @'+item.username+'?'))return;await call('role',{id:item.id,role:item.role==='admin'?'member':'admin'});await list();}));
    }
   }else if(kind==='audit'){row.append(line(item.created_at+' · @'+(item.username||'cuenta eliminada')+' · '+item.action));}
   else{
    row.append(line('@'+item.username+(item.album_title?' · '+item.album_title:'')),line(item.body),line(item.hidden?'Oculto':'Visible'));
    row.append(button(item.hidden?'Restaurar':'Ocultar',async()=>{await call('moderate',{kind,id:item.id,hidden:!item.hidden});await list();$('actualizarFeed')?.click();}));
   }
   $('adminList').append(row);
  }
  if(!result.items.length)$('adminList').append(line('Sin resultados.'));
 }
 async function radio(){const ticket=revision;const r=await fetch(window.REDMUSICA_CONFIG.supabaseUrl+'/functions/v1/radio',{method:'POST',headers:{'Content-Type':'application/json',apikey:window.REDMUSICA_CONFIG.supabasePublishableKey},body:JSON.stringify({action:'state'}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw Error(data.error);if(ticket!==revision)return;
  paused=data.paused;$('adminRadioToggle').textContent=paused?'Reanudar radio':'Pausar radio';$('adminQueue').replaceChildren();
  for(const s of data.queue){const row=document.createElement('article');row.append(line(s.title+' · '+(s.username?'@'+s.username:'Rotación')));
   for(const [label,cmd] of [['Poner ahora','play_now'],['Poner siguiente','priority'],['Quitar','remove']])row.append(button(label,async()=>{if(cmd==='play_now'&&!confirm('¿Cambiar la canción de toda la sala?'))return;await call(cmd,{id:s.id});await radio();}));
   $('adminQueue').append(row);
  }
 }
 toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)action(async()=>{await settings();await list();await radio();});});
 $('adminFilter').addEventListener('submit',e=>{e.preventDefault();page=0;action(list);});
 $('adminPrev').addEventListener('click',()=>{if(busy)return;page=Math.max(0,page-1);action(list);});
 $('adminNext').addEventListener('click',()=>{if(busy)return;page++;action(list);});
 $('adminRadioRefresh').addEventListener('click',()=>action(radio));
 $('adminSkip').addEventListener('click',()=>action(async()=>{if(!confirm('¿Saltar la canción para todos?'))return;await call('skip');await radio();}));
 $('adminRadioToggle').addEventListener('click',()=>action(async()=>{await call('radio_toggle',{enabled:paused});await radio();}));
 $('adminSettings').addEventListener('submit',e=>{e.preventDefault();action(async()=>{await call('settings',{title:$('adminTitle').value,description:$('adminDescription').value,accept_posts:$('adminPosts').checked});await settings();});});
 async function sync(){const ticket=++revision;toggle.hidden=true;panel.hidden=true;toggle.setAttribute('aria-expanded','false');$('adminList').replaceChildren();$('adminQueue').replaceChildren();
  try{const me=await call('me');if(ticket!==revision)return;role=me.role;toggle.hidden=!['owner','admin'].includes(role);toggle.textContent='Administración · '+role;$('adminRango').textContent='Tu rango: '+role;$('adminAjustes').hidden=role!=='owner';}catch{role='member';}
 }
 db.auth.onAuthStateChange(()=>setTimeout(sync,0));sync();settings();
})();
