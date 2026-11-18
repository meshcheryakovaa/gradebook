/* Postgres (Supabase) storage for v14: the same immutable account and packet files as on
 * Yandex Disk, kept as table rows. The browser calls only the functions from
 * supabase/schema.sql through the Supabase REST API; each checks the team key. */
const PG_CONFIG_KEY='gradebook_pg_config';
function loadPgConfig(){
  const empty={url:'',apiKey:'',teamKey:'',enabled:false};
  try{return {...empty,...JSON.parse(localStorage.getItem(PG_CONFIG_KEY)||'{}')};}catch(e){return empty;}
}
let pgConfig=loadPgConfig();
function savePgConfig(){localStorage.setItem(PG_CONFIG_KEY,JSON.stringify(pgConfig));}
function pgConnected(){return !!(pgConfig.enabled&&pgConfig.url&&pgConfig.apiKey&&pgConfig.teamKey);}
// Any configured transport: Yandex Disk or the database.
function cloudConnected(){return pgConnected()||!!yadisk.accessToken;}
function pgBaseUrl(url=pgConfig.url){
  let base=String(url||'').trim().replace(/\/+$/,'').replace(/\/rest\/v1$/,'');
  if(base&&!/^https?:\/\//i.test(base))base='https://'+base;
  if(!/^https?:\/\/[^\s/]+$/i.test(base))throw Error('Укажите адрес проекта вида https://xxxx.supabase.co');
  return base;
}
function pgErrorText(status,data){
  const message=String(data?.message||'');
  if(data?.code==='28000'||/неверный ключ команды/.test(message))
    return 'Неверный ключ команды. Проверьте ключ или добавьте его хеш в таблицу gradebook_keys.';
  if(status===404||data?.code==='PGRST202')
    return 'В базе нет функций журнала. Выполните supabase/schema.sql в SQL Editor проекта.';
  if(status===401||/api key/i.test(message))return 'Неверный publishable (anon) key проекта.';
  return 'База данных: '+(message||'HTTP '+status);
}
async function pgRpc(name,args,config=pgConfig){
  const key=String(config.apiKey||'').trim();
  const headers={'Content-Type':'application/json',Accept:'application/json',apikey:key};
  // Legacy anon keys are JWTs; the new sb_publishable_ keys go only in apikey.
  if(/^eyJ/.test(key))headers.Authorization='Bearer '+key;
  const body=JSON.stringify(name==='gradebook_ping'?{}:{p_key:config.teamKey,...args});
  // Every call is idempotent (put never overwrites and is verified by a read), so a
  // dropped connection is retried.
  for(let attempt=1;;attempt++){
    let res;
    try{res=await fetch(pgBaseUrl(config.url)+'/rest/v1/rpc/'+name,{method:'POST',headers,body});}
    catch(e){
      if(attempt>=3)throw Error('Нет связи с базой данных: '+e.message);
      await new Promise(resolve=>setTimeout(resolve,1000*attempt));continue;
    }
    const text=await res.text();
    let data=null;try{data=text?JSON.parse(text):null;}catch(e){}
    if(!res.ok)throw Error(pgErrorText(res.status,data));
    return data;
  }
}
const GradebookPostgres={
  get id(){return 'pg:'+pgBaseUrl();},
  async ensureFolder(){},
  async read(path){return pgRpc('gradebook_get',{p_path:path});},
  async put(path,data){return pgRpc('gradebook_put',{p_path:path,p_data:data});},
  async list(folder){
    // Keyset pagination by name: uploads during listing cannot shift pages.
    const names=[];
    for(let after='';;){
      const page=await pgRpc('gradebook_list',{p_folder:folder,p_after:after,p_limit:1000});
      if(!Array.isArray(page))throw Error('Неверный ответ базы данных при чтении списка пакетов');
      names.push(...page);
      if(page.length<1000)return names;
      after=page[page.length-1];
    }
  },
  async check(config=pgConfig){await pgRpc('gradebook_list',{p_folder:'app:/gradebook-check',p_after:'',p_limit:1},config);}
};
function pgTeamKey(){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function pgKeySql(hash){return `insert into public.gradebook_keys (key_hash, note) values ('${hash}', 'команда');`;}
function databaseModal(){
  const connected=pgConnected();
  openModal(`<div class="modal-head"><h3>База данных (Supabase Postgres)</h3><button class="btn" id="pgClose">Закрыть</button></div>
    <div class="modal-body">
    <div class="cloud-card">
      <div class="cloud-status"><span class="cloud-dot ${connected?'ok':'warn'}"></span><div>
        <b>${connected?'База данных подключена':'База данных не подключена'}</b>
        <div class="hint" style="margin:1px 0 0">${connected?`Последний обмен: ${esc(yandexLastSyncText())}`:'Общие журналы хранятся на Яндекс Диске, пока база не подключена.'}</div>
      </div></div>
      <p class="hint">Аккаунты, общие и личные журналы работают так же, как с Яндекс Диском, но хранятся в вашей базе Postgres.
      Все участники вводят одинаковые адрес, publishable key и ключ команды. Инструкция: docs/DATABASE.md в репозитории.</p>
      <div class="field"><label for="pgUrl">Адрес проекта (Project URL)</label>
        <input id="pgUrl" value="${esc(pgConfig.url)}" placeholder="https://xxxx.supabase.co" autocomplete="off"></div>
      <div class="field"><label for="pgApiKey">Publishable key (или anon key)</label>
        <input id="pgApiKey" value="${esc(pgConfig.apiKey)}" placeholder="sb_publishable_…" autocomplete="off"></div>
      <div class="field"><label for="pgTeamKey">Ключ команды</label>
        <input id="pgTeamKey" type="password" value="${esc(pgConfig.teamKey)}" autocomplete="off"></div>
      <div class="cloud-actions">
        <button class="btn" id="pgShowKey">Показать ключ</button>
        <button class="btn" id="pgGenerate">Сгенерировать ключ команды</button>
      </div>
      <div id="pgKeySql" hidden>
        <p class="hint">Выполните эту строку в SQL Editor проекта, затем передайте ключ команды остальным участникам
        (лично или в мессенджере, не публикуйте). В базе хранится только его хеш.</p>
        <div class="cloud-path" id="pgKeySqlText" style="user-select:all"></div>
      </div>
      <label class="check-row"><input type="checkbox" id="pgAutoSync" ${yadisk.autoSync?'checked':''}>
        <div><strong>Автосинхронизация</strong><span>Сохранённые правки отправляются с задержкой, входящие проверяются раз в минуту.</span></div></label>
      <p id="pgError" role="alert"></p>
      <div class="cloud-actions">
        <button class="btn primary" id="pgSave">Сохранить и проверить</button>
        <button class="btn" id="pgAccounts">Аккаунты и журналы</button>
        <button class="btn" id="pgSyncNow" ${connected?'':'disabled'}>Синхронизировать сейчас</button>
        <button class="btn danger" id="pgDisconnect" ${pgConfig.enabled?'':'disabled'}>Отключить</button>
      </div>
      <div class="cloud-security">Publishable key сам по себе не даёт доступа к журналам. Доступ даёт ключ команды:
      храните его только у участников. Ключ хранится в этом браузере и не входит в экспорт базы.
      При первом обмене с новой базой этот браузер отправляет в неё всю свою историю журнала; повторы объединяются.</div>
    </div></div>`);
  const $=id=>document.getElementById(id),error=$('pgError');
  $('pgClose').onclick=closeModal;
  $('pgAccounts').onclick=v14AccountsModal;
  $('pgShowKey').onclick=()=>{const input=$('pgTeamKey');input.type=input.type==='password'?'text':'password';};
  $('pgGenerate').onclick=async()=>{
    try{
      const key=pgTeamKey();$('pgTeamKey').value=key;$('pgTeamKey').type='text';
      $('pgKeySqlText').textContent=pgKeySql(await v14Digest(key));$('pgKeySql').hidden=false;
    }catch(e){error.textContent=e.message;}
  };
  $('pgAutoSync').onchange=e=>{
    yadisk.autoSync=e.target.checked;saveYandexConfig();
    if(e.target.checked)scheduleYandexAutoPush();
  };
  $('pgSave').onclick=async()=>{
    const next={url:$('pgUrl').value.trim(),apiKey:$('pgApiKey').value.trim(),teamKey:$('pgTeamKey').value.trim(),enabled:true};
    const buttons=[...document.querySelectorAll('#modalBackdrop button')];
    error.textContent='';
    try{
      if(v14NetworkBusy||yandexSyncBusy)throw Error('Дождитесь завершения синхронизации.');
      next.url=pgBaseUrl(next.url);
      if(!next.apiKey)throw Error('Укажите publishable key проекта.');
      if(next.teamKey.length<20)throw Error('Ключ команды должен содержать не менее 20 символов. Нажмите «Сгенерировать ключ команды».');
      buttons.forEach(b=>b.disabled=true);
      await GradebookPostgres.check(next);
      pgConfig=next;savePgConfig();
      toast('База данных подключена');databaseModal();
      if(yadisk.autoSync)scheduleYandexAutoPush();
    }catch(e){error.textContent=e.message;buttons.forEach(b=>b.disabled=false);}
  };
  $('pgSyncNow').onclick=async()=>{
    await withYandexUiTask(()=>v14Sync(false));
    if(document.getElementById('pgSyncNow'))databaseModal();
  };
  $('pgDisconnect').onclick=()=>{
    if(v14NetworkBusy||yandexSyncBusy){toast('Дождитесь завершения синхронизации');return;}
    pgConfig={...pgConfig,enabled:false};savePgConfig();
    toast('База данных отключена. Обмен снова идёт через Яндекс Диск, если он подключён.');databaseModal();
  };
}
