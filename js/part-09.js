async function yandexVersionsModal(offset=0){
  if(yandexSyncBusy){toast('Синхронизация уже выполняется');return;}
  openModal(`<div class="modal-head"><h3>История версий</h3><button class="btn" id="versionsBack">Назад</button></div><div class="modal-body" id="versionsBody">Загрузка…</div>`);
  document.getElementById('versionsBack').onclick=yandexDiskModal;
  const body=document.getElementById('versionsBody');
  yandexSyncBusy=true;
  try{
    const {items,total}=await yandexListVersions(offset);
    if(document.getElementById('versionsBody')!==body)return;
    body.innerHTML=`<p class="hint">Восстановление заменяет базу целиком, включая настройки. Перед ним текущая локальная база и облачная версия сохраняются в истории. Восстановленная версия сразу отправляется на Диск.</p>
      <div class="settings-list">${items.length?items.map((v,i)=>{
        const stamp=v.name.match(/^journal_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
        const date=stamp?new Date(`${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}.${stamp[5]}Z`).toLocaleString('ru-RU'):v.modified;
        return `<div class="settings-row"><div><b>${esc(date||v.name)}</b><div class="hint">${esc(v.name)} · ${Math.ceil((v.size||0)/1024)} КБ</div></div><button class="btn restore-version" data-index="${i}">Восстановить</button></div>`;
      }).join(''):'<p>Версий пока нет. Они появятся после отправки базы на Диск.</p>'}</div>
      <div class="cloud-actions"><button class="btn" id="versionsPrev" ${offset===0?'disabled':''}>← Новее</button><span>${total?`${offset+1}–${Math.min(offset+20,total)} из ${total}`:'0 версий'}</span><button class="btn" id="versionsNext" ${offset+20>=total?'disabled':''}>Старее →</button></div>`;
    document.getElementById('versionsPrev').onclick=()=>yandexVersionsModal(Math.max(0,offset-20));
    document.getElementById('versionsNext').onclick=()=>yandexVersionsModal(offset+20);
    body.querySelectorAll('.restore-version').forEach(btn=>btn.onclick=async()=>{
      if(state.dirty){toast('Сначала сохраните текущие изменения');return;}
      if(!confirm('Восстановить выбранную версию базы и настроек? Текущие данные будут сохранены в истории.'))return;
      await withYandexUiTask(async()=>{
        const item=items[Number(btn.dataset.index)];
        // Use our own app path; API metadata can return the canonical disk:/ path.
        const snapshot=await yandexDownloadSnapshot(`${YADISK_VERSIONS_PATH}/${item.name}`);
        if(!snapshot)throw new Error('Версия не найдена');
        await archiveYandexSnapshot(cloudPayload());
        const previous=await yandexDownloadSnapshot();
        await archiveYandexSnapshot(previous);
        applyCloudSnapshot(snapshot);
        db.meta.updatedAt=Date.now();
        saveDB(false);
        await yandexUploadSnapshot(true);
        toast('Версия восстановлена и отправлена на Диск');
      });
      await yandexVersionsModal(offset);
    });
  }catch(e){if(document.getElementById('versionsBody')===body)body.textContent=`Не удалось загрузить историю: ${e.message||e}`;}
  finally{yandexSyncBusy=false;}
}

async function withYandexUiTask(fn){
  if(yandexSyncBusy){
    toast('Синхронизация уже выполняется');
    return;
  }
  yandexSyncBusy=true;
  try{
    await fn();
  }catch(e){
    alert(`Яндекс Диск: ${e.message||e}`);
  }finally{
    yandexSyncBusy=false;
  }
}

async function startYandexAuthorization(){
  const clientId=document.getElementById('yandexClientId').value.trim();
  if(!clientId){
    toast('Введите Client ID');
    return;
  }

  const popup=window.open('about:blank','_blank');
  const pkce=await buildPkce();

  yadisk.clientId=clientId;
  yadisk.pkceVerifier=pkce.verifier;
  yadisk.pkceMethod=pkce.method;
  saveYandexConfig();

  const params=new URLSearchParams({
    response_type:'code',
    client_id:clientId,
    redirect_uri:'https://oauth.yandex.ru/verification_code',
    force_confirm:'yes',
    scope:'cloud_api:disk.app_folder',
    code_challenge:pkce.challenge,
    code_challenge_method:pkce.method
  });

  const url='https://oauth.yandex.ru/authorize?'+params.toString();

  if(popup){
    popup.location.href=url;
  }else{
    window.open(url,'_blank');
  }
}

async function exchangeYandexAuthorizationCode(){
  const clientId=document.getElementById('yandexClientId').value.trim()||yadisk.clientId;
  const code=document.getElementById('yandexAuthCode').value.trim();

  if(!clientId||!code||!yadisk.pkceVerifier){
    toast('Сначала получите код OAuth, затем вставьте его');
    return;
  }

  await withYandexUiTask(async()=>{
    const body=new URLSearchParams({
      grant_type:'authorization_code',
      code,
      client_id:clientId,
      code_verifier:yadisk.pkceVerifier
    });

    let res;
    try{
      res=await fetch('https://oauth.yandex.ru/token',{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body
      });
    }catch(e){
      throw new Error('браузер заблокировал обмен OAuth-кода. Используйте ручной OAuth-токен ниже.');
    }

    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      throw new Error(data.error_description||data.error||`OAuth HTTP ${res.status}`);
    }

    yadisk.clientId=clientId;
    yadisk.accessToken=data.access_token||'';
    yadisk.refreshToken=data.refresh_token||'';
    yadisk.expiresAt=data.expires_in?Date.now()+Number(data.expires_in)*1000-60000:0;
    yadisk.pkceVerifier='';
    yadisk.pkceMethod='';
    saveYandexConfig();

    await yandexTestConnection();
    toast('Яндекс Диск подключён');
  });

  yandexDiskModal();
}

async function refreshYandexAccessToken(){
  if(!yadisk.refreshToken||!yadisk.clientId)return false;

  try{
    const body=new URLSearchParams({
      grant_type:'refresh_token',
      refresh_token:yadisk.refreshToken,
      client_id:yadisk.clientId
    });

    const res=await fetch('https://oauth.yandex.ru/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body
    });

    if(!res.ok)return false;

    const data=await res.json();
    if(!data.access_token)return false;

    yadisk.accessToken=data.access_token;
    if(data.refresh_token)yadisk.refreshToken=data.refresh_token;
    yadisk.expiresAt=data.expires_in?Date.now()+Number(data.expires_in)*1000-60000:0;
    saveYandexConfig();
    return true;
  }catch(e){
    return false;
  }
}

async function ensureYandexToken(){
  if(!yadisk.accessToken)throw new Error('Яндекс Диск не подключён');

  if(yadisk.expiresAt&&Date.now()>=yadisk.expiresAt){
    const ok=await refreshYandexAccessToken();
    if(!ok)throw new Error('OAuth-токен истёк. Подключите Яндекс Диск заново.');
  }
  return yadisk.accessToken;
}

async function yandexApiFetch(url,options={},retry=true){
  const token=await ensureYandexToken();
  const headers=new Headers(options.headers||{});
  headers.set('Authorization',`OAuth ${token}`);
  headers.set('Accept','application/json');

  const res=await fetch(url,{...options,headers});

  if(res.status===401&&retry&&yadisk.refreshToken){
    const ok=await refreshYandexAccessToken();
    if(ok)return yandexApiFetch(url,options,false);
  }

  return res;
}

async function yandexTestConnection(){
  const url='https://cloud-api.yandex.net/v1/disk/resources?'+new URLSearchParams({
    path:'app:/',
    limit:'1'
  }).toString();

  const res=await yandexApiFetch(url);
  if(!res.ok){
    const data=await res.json().catch(()=>({}));
    throw new Error(data.message||data.description||`HTTP ${res.status}`);
  }
  return true;
}

function cloudPayload(){
  return {
    schema:'edu-journal-sync-v1',
    versionId:uid('v'),
    updatedAt:Number(db.meta?.updatedAt||Date.now()),
    savedAt:new Date().toISOString(),
    db:clone(db)
  };
}

// Immutable snapshots are written before the current file is replaced.
async function ensureYandexVersionsFolder(){
  const res=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources?'+new URLSearchParams({path:YADISK_VERSIONS_PATH}),{method:'PUT'});
  if(!res.ok&&res.status!==409)throw new Error(`не удалось создать папку версий (${res.status})`);
}
function snapshotVersionPath(snapshot){
  // Include a content hash for legacy files that have no versionId.
  const source=JSON.stringify(snapshot), bytes=new TextEncoder().encode(source);
  let h=2166136261;
  bytes.forEach(c=>{h=Math.imul(h^c,16777619)>>>0;});
  const rawDate=snapshot.savedAt||snapshot.updatedAt||snapshot.db?.meta?.updatedAt||0;
  const d=new Date(rawDate), stamp=Number.isFinite(d.getTime())?d.toISOString().replace(/[:.]/g,'-'):'unknown';
  const id=String(snapshot.versionId||'legacy').replace(/[^a-z0-9_-]/gi,'').slice(0,80);
  return `${YADISK_VERSIONS_PATH}/journal_${stamp}_${id}_${h.toString(16)}.json`;
}
async function yandexWriteSnapshot(path,snapshot,overwrite=false){
  const query=new URLSearchParams({path,overwrite:String(overwrite)});
  const res=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources/upload?'+query);
  const data=await res.json().catch(()=>({}));
  if(res.status===409&&!overwrite&&data.error==='DiskResourceAlreadyExistsError')return;
  if(!res.ok||!data.href)throw new Error(data.message||data.description||`не удалось получить ссылку загрузки (${res.status})`);
  const upload=await fetch(data.href,{
    method:data.method||'PUT',headers:{'Content-Type':'application/json;charset=utf-8'},body:JSON.stringify(snapshot,null,2)
  });
  if(!upload.ok)throw new Error(`ошибка загрузки файла (${upload.status})`);
}
async function archiveYandexSnapshot(snapshot){
  if(!snapshot)return;
  await ensureYandexVersionsFolder();
  // Do not alter old snapshots, so their archive path remains identical on retries.
  await yandexWriteSnapshot(snapshotVersionPath(snapshot),snapshot,false);
}
async function yandexUploadSnapshot(silent=false){
  if(state.dirty)throw new Error('сначала сохраните текущие изменения');
  const snapshot=cloudPayload();
  const previous=await yandexDownloadSnapshot();
  await archiveYandexSnapshot(previous);
  await archiveYandexSnapshot(snapshot);
  await yandexWriteSnapshot(YADISK_PATH,snapshot,true);
  yadisk.lastSyncAt=Date.now();
  saveYandexConfig();
  if(!silent)toast('База и версия сохранены на Яндекс Диске');
}

async function yandexDownloadSnapshot(path=YADISK_PATH){
  const query=new URLSearchParams({path}).toString();
  const linkRes=await yandexApiFetch(
    'https://cloud-api.yandex.net/v1/disk/resources/download?'+query
  );

  if(linkRes.status===404)return null;

  const linkData=await linkRes.json().catch(()=>({}));
  if(!linkRes.ok||!linkData.href){
    throw new Error(linkData.message||linkData.description||`не удалось получить ссылку скачивания (${linkRes.status})`);
  }

  const fileRes=await fetch(linkData.href);
  if(!fileRes.ok)throw new Error(`ошибка скачивания файла (${fileRes.status})`);

  const snapshot=await fileRes.json();
  validateCloudSnapshot(snapshot);
  return snapshot;
}

function validateCloudSnapshot(snapshot){
  if(!snapshot?.db||!['groups','students','lessons','results'].every(k=>Array.isArray(snapshot.db[k]))){
    throw new Error('облачный файл имеет неверный формат');
  }
}
function applyCloudSnapshot(snapshot){
  validateCloudSnapshot(snapshot);
  clearTimeout(yandexAutoTimer);
  db=normalizeDB(snapshot.db);
  db.settings.theme=db.settings.theme||document.documentElement.dataset.theme||'light';
  applyTheme(db.settings.theme);
  if(snapshot.updatedAt){
    db.meta=db.meta||{};
    db.meta.updatedAt=Number(snapshot.updatedAt);
  }
  saveDB(false);

  if(!db.groups.some(g=>g.id===state.groupId)){
    state.groupId=db.groups[0]?.id||null;
  }

  closeEditingPages();

  yadisk.lastSyncAt=Date.now();
  saveYandexConfig();
  renderMain();
}

async function yandexSyncNow(silent=false){
  if(state.dirty)throw new Error('сначала сохраните текущие изменения');
  const startedAt=Number(db.meta?.updatedAt||0);
  const snapshot=await yandexDownloadSnapshot();
  if(state.dirty||Number(db.meta?.updatedAt||0)!==startedAt)throw new Error('база изменилась во время синхронизации; повторите после сохранения');

  if(!snapshot){
    await yandexUploadSnapshot(silent);
    return;
  }

  const cloudTs=Number(snapshot.updatedAt||snapshot.db?.meta?.updatedAt||0);
  const localTs=Number(db.meta?.updatedAt||0);

  if(cloudTs>localTs){
    await archiveYandexSnapshot(cloudPayload());
    applyCloudSnapshot(snapshot);
    if(!silent)toast('Получена более новая версия с Яндекс Диска');
  }else if(localTs>cloudTs){
    await yandexUploadSnapshot(silent);
  }else{
    yadisk.lastSyncAt=Date.now();
    saveYandexConfig();
    if(!silent)toast('База уже синхронизирована');
  }
}
