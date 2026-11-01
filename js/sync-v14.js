/* Accounts, durable local outbox and immutable Yandex Disk transport for v14. */
const V14_ROOT='app:/gradebook-v14';
const V14_CACHE='gradebook_v14_accounts';
const V14_SESSION='gradebook_v14_session';
let v14Session=null,v14Replica=null,v14Baseline=null,v14Revision=0,v14NetworkBusy=false;
let v14LastError='';
const v14Actor=v14RandomId(); // Fresh per page/tab, including copied browser profiles.

function v14RandomId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function v14Key(session=v14Session){return `gradebook_v14:${session.user.id}:${session.workspace}`;}
function v14Author(user=v14Session.user){return `${user.name} [${user.login}]`;}
function v14Read(key){
  const raw=localStorage.getItem(key);
  return raw?JSON.parse(raw):null; // Never silently replace an unreadable journal.
}
function v14Envelope(){return v14Read(v14Key())||{events:[],ack:[],packet:null};}
function v14Persist(envelope){
  // One atomic localStorage write contains BOTH the projection and durable outbox.
  localStorage.setItem(v14Key(),JSON.stringify({...envelope,schema:14,db,events:v14Replica.list()}));
}
function v14MergeLocal(){
  const envelope=v14Envelope();
  v14Replica.merge(envelope.events);
  return envelope;
}
window.v14Save=function(touch){
  if(!v14Session){localStorage.setItem(DB_KEY,JSON.stringify(db));return;}
  if(touch){
    // Capture only this tab's edits before merging another tab's saved changes.
    const changes=GradebookSync.difference(v14Baseline,db);
    const envelope=v14MergeLocal();
    v14Replica.append(changes);
    db=normalizeDB(v14Replica.materialize());
    db.meta.updatedAt=Date.now();
    v14Persist(envelope);
    v14Baseline=clone(db);v14Revision++;
  }else{
    // UI normalisation may save without a user edit. Do not drop the outbox.
    v14Persist(v14MergeLocal());v14Baseline=clone(db);
  }
  v14UpdateBadge();
};
function v14UpdateBadge(){
  const button=document.getElementById('accountsBtn');
  if(!button)return;
  const count=v14Replica?.conflicts().length||0;
  button.textContent=v14Session?`${v14Session.user.name} · ${v14Session.label}${count?' · ⚠ '+count:''}`:'Аккаунты';
  const status=document.getElementById('syncStatus');
  status.hidden=!v14Session;
  if(v14Session){
    const ack=new Set(v14Envelope().ack);
    const pending=v14Replica.list().filter(e=>!ack.has(e.id)).length;
    status.textContent=v14LastError?'Ошибка синхронизации: '+v14LastError:
      v14NetworkBusy?'Синхронизация…':pending?`Сохранено на этом устройстве · ожидают отправки: ${pending}`:
      `Изменения отправлены · последний обмен: ${yandexLastSyncText()}`;
  }
  const notice=document.getElementById('syncConflictNotice');
  notice.hidden=!count;
  notice.textContent=count?`Есть спорные изменения (${count}). Оба варианта сохранены. Открыть и выбрать…`:'';
}
function v14AdoptProjection(){
  db=normalizeDB(v14Replica.materialize());
  db.settings.theme=db.settings.theme||'light';applyTheme(db.settings.theme);
  v14Baseline=clone(db);v14Revision++;
  state.groupId=db.groups.some(g=>g.id===state.groupId)?state.groupId:db.groups[0]?.id||null;
  closeEditingPages();renderMain();v14UpdateBadge();
}
async function v14Digest(text){
  if(!crypto?.subtle)throw Error('Для аккаунтов нужен современный браузер. Откройте HTML через localhost или HTTPS.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function v14LoginName(login){
  const name=String(login).normalize('NFKC').trim().toLowerCase();
  if(!/^[a-zа-яё0-9_.-]{3,40}$/u.test(name))throw Error('Логин: 3–40 букв, цифр, точек, дефисов или подчёркиваний.');
  return name;
}
async function v14Password(password,salt){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:310000,hash:'SHA-256'},key,256);
  return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');
}
async function v14EnsureFolder(path){
  const res=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources?'+new URLSearchParams({path}),{method:'PUT'});
  if(res.status===409){
    const check=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources?'+new URLSearchParams({path}));
    if(!check.ok||(await check.json()).type!=='dir')throw Error('Вместо папки найден файл: '+path);
  }else if(!res.ok)throw Error('Не удалось создать папку: HTTP '+res.status);
}
async function v14ReadCloud(path){
  const res=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources/download?'+new URLSearchParams({path}));
  if(res.status===404)return null;
  const data=await res.json();
  if(!res.ok||!data.href)throw Error(data.message||'Не удалось получить файл: HTTP '+res.status);
  const file=await fetch(data.href);
  if(!file.ok)throw Error('Не удалось скачать файл: HTTP '+file.status);
  return file.json();
}
async function v14WriteImmutable(path,data){
  const res=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources/upload?'+new URLSearchParams({path,overwrite:'false'}));
  const link=await res.json();
  if(res.status!==409){
    if(!res.ok||!link.href)throw Error(link.message||'Не удалось начать загрузку: HTTP '+res.status);
    const upload=await fetch(link.href,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    if(!upload.ok&&upload.status!==409)throw Error('Не удалось отправить пакет: HTTP '+upload.status);
  }
  // Also verifies retries after a lost response, and simultaneous registration.
  const actual=await v14ReadCloud(path);
  if(GradebookSync.stable(actual)!==GradebookSync.stable(data))throw Error('Файл уже существует с другим содержимым. Данные не перезаписаны.');
}
function v14ValidateAccount(user,id){
  if(!user||user.schema!==14||user.id!==id||typeof user.name!=='string'||user.name.length>100||
    !/^[a-f0-9]{64}$/.test(user.passwordHash)||!/^[a-f0-9-]{20,100}$/.test(user.salt))
    throw Error('Некорректный файл аккаунта');
}
async function v14Authenticate(login,password,register=false,name='',offline=false){
  login=v14LoginName(login);
  const id=await v14Digest('gradebook-account:'+login),path=`${V14_ROOT}/accounts/${id}.json`;
  const cache=v14Read(V14_CACHE)||{};
  let user;
  if(register){
    if(password.length<8)throw Error('Пароль должен содержать не менее 8 символов.');
    if(!name.trim()||name.trim().length>100)throw Error('Укажите имя (до 100 символов).');
    await v14EnsureFolder(V14_ROOT);await v14EnsureFolder(V14_ROOT+'/accounts');
    if(await v14ReadCloud(path))throw Error('Этот логин уже занят. Войдите в аккаунт.');
    const salt=v14RandomId();
    user={schema:14,id,login,name:name.trim(),salt,passwordHash:await v14Password(password,salt)};
    await v14WriteImmutable(path,user);
  }else{
    user=offline?cache[id]:await v14ReadCloud(path);
    if(!user)throw Error(offline?'Аккаунт ещё не сохранён на этом устройстве. Сначала войдите с интернетом.':'Неверный логин или пароль.');
    v14ValidateAccount(user,id);
    if(await v14Password(password,user.salt)!==user.passwordHash)throw Error('Неверный логин или пароль.');
  }
  v14ValidateAccount(user,id);
  const latest=v14Read(V14_CACHE)||{};latest[id]=user;
  localStorage.setItem(V14_CACHE,JSON.stringify(latest));return user;
}
async function v14Activate(user,mode,sharedName){
  if(state.dirty)throw Error('Сначала сохраните текущие изменения.');
  const label=mode==='shared'?String(sharedName||'').normalize('NFKC').trim().toLowerCase():'Личный журнал';
  if(!label||label.length>80)throw Error('Укажите имя общего журнала (до 80 символов).');
  const workspace=await v14Digest(mode==='shared'?'shared:'+label:'private:'+user.id);
  const session={user:{id:user.id,name:user.name,login:user.login},workspace,label,mode};
  const envelope=v14Read(v14Key(session));
  const replica=new GradebookSync.Replica(v14Actor,v14Author(user),envelope?.events||[]);
  if(!envelope)replica.capture({settings:{}},clone(defaultDB));
  // Save the new profile first; storage failure leaves the active profile intact.
  const nextDB=normalizeDB(replica.materialize());
  localStorage.setItem(v14Key(session),JSON.stringify({schema:14,events:replica.list(),ack:[],packet:null,db:nextDB,...envelope}));
  sessionStorage.setItem(V14_SESSION,JSON.stringify(session));
  clearTimeout(yandexAutoTimer);v14Session=session;v14Replica=replica;v14LastError='';
  v14AdoptProjection();closeModal();
  toast('Открыт '+label+'. Для старой базы используйте импорт JSON.');
  if(yadisk.autoSync)scheduleYandexAutoPush();
}
function v14Logout(){
  if(v14NetworkBusy||yandexSyncBusy)throw Error('Дождитесь завершения синхронизации.');
  if(state.dirty)throw Error('Сначала сохраните текущие изменения.');
  clearTimeout(yandexAutoTimer);sessionStorage.removeItem(V14_SESSION);
  v14Session=null;v14Replica=null;v14Baseline=null;v14Revision++;v14LastError='';
  db=loadDB();state.groupId=db.groups[0]?.id||null;
  closeEditingPages();applyTheme(db.settings.theme||'light');renderMain();v14UpdateBadge();
}
function v14AccountsModal(){
  if(v14NetworkBusy||yandexSyncBusy){toast('Дождитесь завершения синхронизации');return;}
  const active=v14Session;
  openModal(`<div class="modal-head"><h3>Аккаунты · версия 14</h3><button class="btn" id="accountClose">Закрыть</button></div>
    <div class="modal-body">
    ${active?`<div class="cloud-card"><b>${esc(active.user.name)}</b> · ${esc(active.user.login)}<p>Журнал: ${esc(active.label)}</p>
      <button class="btn" id="accountConflicts">Спорные изменения (${v14Replica.conflicts().length})</button>
      <button class="btn" id="accountLogout">Выйти</button></div>`:''}
    <p>Один Яндекс Диск и общий OAuth-токен для всех устройств. Каждый преподаватель входит под своим логином.</p>
    <div class="row"><div class="field"><label for="accountLogin">Логин</label><input id="accountLogin" autocomplete="username"></div>
    <div class="field"><label for="accountPassword">Пароль</label><input id="accountPassword" type="password" autocomplete="current-password"></div></div>
    <div class="field"><label for="accountName">Имя для нового аккаунта</label><input id="accountName" maxlength="100" autocomplete="name"></div>
    <div class="row"><div class="field"><label for="accountMode">Какой журнал открыть</label><select id="accountMode">
      <option value="shared">Общий: совместная работа</option><option value="private">Личный: отдельная база</option></select></div>
      <div class="field"><label for="accountWorkspace">Имя общего журнала</label><input id="accountWorkspace" value="основной" maxlength="80"></div></div>
    <p class="hint">Для совместной работы выберите одинаковое имя журнала. Личные журналы сохраняются отдельно.
    Старая локальная база остаётся доступна после выхода. Перенесите её через экспорт и импорт JSON один раз.</p>
    <label class="check-row"><input type="checkbox" id="accountOffline"><span>Войти офлайн в ранее использованный аккаунт</span></label>
    <p class="cloud-security">Пароль проверяет вход в интерфейс. Владельцы общего токена имеют доступ ко всем файлам на Диске: личные журналы не зашифрованы. Используйте общий токен только в доверенной команде.</p>
    <p id="accountError" role="alert"></p>
    <div class="cloud-actions"><button class="btn primary" id="accountSignIn">Войти / открыть журнал</button>
      <button class="btn" id="accountRegister">Создать аккаунт</button><button class="btn" id="accountDisk">Настроить Яндекс Диск</button></div></div>`);
  document.getElementById('accountClose').onclick=closeModal;
  document.getElementById('accountDisk').onclick=yandexDiskModal;
  document.getElementById('accountMode').onchange=e=>{document.getElementById('accountWorkspace').disabled=e.target.value==='private';};
  if(active){
    document.getElementById('accountConflicts').onclick=v14ConflictsModal;
    document.getElementById('accountLogout').onclick=()=>{try{v14Logout();v14AccountsModal();}catch(e){alert(e.message);}};
  }
  const act=async register=>{
    const login=document.getElementById('accountLogin').value,password=document.getElementById('accountPassword').value;
    const name=document.getElementById('accountName').value,mode=document.getElementById('accountMode').value;
    const workspace=document.getElementById('accountWorkspace').value,offline=document.getElementById('accountOffline').checked;
    const error=document.getElementById('accountError');
    const buttons=[...document.querySelectorAll('#modalBackdrop button')];buttons.forEach(b=>b.disabled=true);
    yandexSyncBusy=true;
    try{
      if(state.dirty)throw Error('Сначала сохраните текущие изменения.');
      const user=await v14Authenticate(login,password,register,name,offline);
      await v14Activate(user,mode,workspace);
    }catch(e){error.textContent=e.message;}
    finally{yandexSyncBusy=false;buttons.forEach(b=>b.disabled=false);}
  };
  document.getElementById('accountSignIn').onclick=()=>act(false);
  document.getElementById('accountRegister').onclick=()=>act(true);
}
async function v14ListPackets(folder){
  // Stable name sorting + full listing on every pass. No mutable manifest/cursor.
  const items=[];let offset=0;
  while(true){
    const res=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources?'+new URLSearchParams({path:folder,limit:'200',offset:String(offset),sort:'name'}));
    const data=await res.json();
    if(!res.ok||!data._embedded)throw Error(data.message||'Не удалось прочитать журнал изменений');
    const page=data._embedded.items;items.push(...page.filter(x=>x.type==='file'&&/^packet_[a-f0-9-]+\.json$/.test(x.name)));
    offset+=page.length;
    if(offset>=data._embedded.total)break;
    if(!page.length)throw Error('Неполный список файлов; повторите синхронизацию');
  }
  return items;
}
function v14CheckPacket(packet){
  if(!packet||packet.schema!=='gradebook-v14-packet'||packet.workspace!==v14Session.workspace||!Array.isArray(packet.events))
    throw Error('Несовместимый или чужой пакет изменений');
  packet.events.forEach(GradebookSync.validate);
}
async function v14Sync(silent=false){
  if(!v14Session)throw Error('Откройте «Аккаунты» и войдите. Старая база переносится через экспорт/импорт JSON.');
  if(v14NetworkBusy)throw Error('Синхронизация уже выполняется');
  if(state.dirty||document.querySelector('.journal-cell-input'))throw Error('Сначала сохраните текущие изменения.');
  v14NetworkBusy=true;v14LastError='';v14UpdateBadge();
  const revision=v14Revision;
  try{
    await v14EnsureFolder(V14_ROOT);await v14EnsureFolder(V14_ROOT+'/workspaces');
    const folder=V14_ROOT+'/workspaces/'+v14Session.workspace;
    await v14EnsureFolder(folder);
    let envelope=v14MergeLocal();
    // Persist before network access; retries use exactly the same packet and filename.
    if(!envelope.packet){
      const ack=new Set(envelope.ack);
      const events=v14Replica.list().filter(e=>!ack.has(e.id));
      if(events.length)envelope.packet={name:'packet_'+v14RandomId()+'.json',data:{schema:'gradebook-v14-packet',workspace:v14Session.workspace,events}};
      v14Persist(envelope);
    }
    if(envelope.packet){
      await v14WriteImmutable(folder+'/'+envelope.packet.name,envelope.packet.data);
      // A tab may save new changes during the upload; keep its envelope/outbox.
      const latest=v14MergeLocal();
      latest.ack=[...new Set([...latest.ack,...envelope.packet.data.events.map(e=>e.id)])];
      if(latest.packet?.name===envelope.packet.name)latest.packet=null;
      v14Persist(latest);envelope=latest;
    }
    const received=[],downloaded=[];
    // Fetch every packet metadata; already known event IDs stay deduplicated.
    const known=new Set(envelope.downloaded||[]);
    for(const file of await v14ListPackets(folder)){
      if(known.has(file.name))continue;
      const packet=await v14ReadCloud(folder+'/'+file.name);
      v14CheckPacket(packet);received.push(...packet.events);downloaded.push(file.name);
    }
    if(state.dirty||document.querySelector('.journal-cell-input')||revision!==v14Revision)
      throw Error('Правки сохранены; база изменилась во время обмена. Повторите синхронизацию.');
    // Stage validation so a broken packet cannot partially alter the local replica.
    const next=new GradebookSync.Replica(v14Actor,v14Author(),[...v14Replica.list(),...received]);
    const latest=v14MergeLocal();next.merge(v14Replica.list());
    v14Replica=next;
    db=normalizeDB(next.materialize());v14Baseline=clone(db);
    latest.ack=[...new Set([...latest.ack,...received.map(e=>e.id)])];
    latest.downloaded=[...new Set([...(latest.downloaded||[]),...downloaded])];
    v14Persist(latest);v14AdoptProjection();
    yadisk.lastSyncAt=Date.now();saveYandexConfig();
    if(!silent)toast(next.conflicts().length?'Обмен завершён. Проверьте спорные изменения.':'Все доступные изменения объединены');
    // A concurrent upload can appear just after listing: the next poll retrieves it.
  }catch(e){v14LastError=e.message;throw e;}
  finally{v14NetworkBusy=false;v14UpdateBadge();}
}
function v14ConflictLabel(key){
  const [table,id,field]=JSON.parse(key);
  const names={groups:'Группа',students:'Студент',lessonTypes:'Тип занятия',lessons:'Занятие',results:'Оценка',layouts:'Рассадка',settings:'Настройки'};
  const fields={value:'результат',comment:'комментарий',stars:'баллы',name:'название',note:'заметка','$exists':'удаление / сохранение'};
  let record=id;
  if(table==='results'){
    const [sid,lid]=JSON.parse(id),student=db.students.find(s=>s.id===sid),lesson=db.lessons.find(l=>l.id===lid);
    record=(student?.name||sid)+' · '+(lesson?.date||lid);
  }else record=db[table]?.find?.(r=>r.id===id)?.name||record;
  return `${names[table]}: ${record} · ${fields[field]||field}`;
}
function v14ConflictsModal(){
  if(!v14Replica)return v14AccountsModal();
  const conflicts=v14Replica.conflicts();
  openModal(`<div class="modal-head"><h3>Спорные изменения</h3><button class="btn" id="conflictsClose">Закрыть</button></div>
    <div class="modal-body"><p>Выберите нужное значение. Решение будет отправлено при синхронизации. Исходные варианты сохраняются в истории пакетов.
    Пока спор не решён, журнал показывает один и тот же временный вариант на всех устройствах.</p>
    ${conflicts.length?conflicts.map((c,i)=>`<div class="cloud-card"><b>${esc(v14ConflictLabel(c.key))}</b>${c.candidates.map((v,j)=>{
      const [, ,field]=JSON.parse(c.key);
      const value=v.change.unset?'Поле удалено':field==='$exists'?(v.change.value?'Сохранить запись':'Удалить запись'):JSON.stringify(v.change.value);
      return `<div class="settings-row"><div><strong>${esc(value)}</strong><div class="hint">${esc(v.event.author)} · ${esc(v.event.createdAt)}</div></div>
      <button class="btn" data-resolve="${i}" data-candidate="${j}">Выбрать</button></div>`;
    }).join('')}</div>`).join(''):'<p>Спорных изменений нет.</p>'}</div>`);
  document.getElementById('conflictsClose').onclick=closeModal;
  document.querySelectorAll('[data-resolve]').forEach(button=>button.onclick=()=>{
    try{
      if(state.dirty||yandexSyncBusy||v14NetworkBusy)throw Error('Сначала сохраните правки и дождитесь синхронизации.');
      const c=conflicts[Number(button.dataset.resolve)],candidate=c.candidates[Number(button.dataset.candidate)];
      const envelope=v14MergeLocal();v14Replica.resolve(c.key,candidate.event.id);
      db=normalizeDB(v14Replica.materialize());v14Persist(envelope);v14AdoptProjection();
      scheduleYandexAutoPush();v14ConflictsModal();
    }catch(e){alert(e.message);}
  });
}
// Replace every legacy entry point. Never write journal-sync.json from v14.
yandexSyncNow=v14Sync;
yandexUploadSnapshot=v14Sync;
yandexVersionsModal=function(){
  if(!v14Session){toast('Войдите в аккаунт');return;}
  const events=v14Replica.list().slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  openModal(`<div class="modal-head"><h3>История изменений</h3><button class="btn" id="historyClose">Закрыть</button></div>
    <div class="modal-body"><p>Все пакеты хранятся без автоматического удаления. Для восстановления импортируйте JSON: он станет новым набором изменений.</p>
    ${events.map(e=>`<div class="settings-row"><div>${esc(e.author)} · ${esc(e.createdAt)}<div class="hint">${e.changes.length} полей · ${esc(e.id)}</div></div></div>`).join('')}</div>`);
  document.getElementById('historyClose').onclick=closeModal;
};
const v14OldDiskModal=yandexDiskModal;
yandexDiskModal=function(){
  v14OldDiskModal();
  const card=document.getElementById('yandexSyncNowBtn').closest('.cloud-card');
  card.querySelector('.hint').textContent='Версия 14 объединяет изменения по полям. Для обмена войдите в аккаунт. Отправка и получение выполняют одинаковый безопасный обмен; спорные значения сохраняются.';
  document.querySelector('.cloud-path').textContent=v14Session?V14_ROOT+'/workspaces/'+v14Session.workspace:V14_ROOT;
  document.getElementById('yandexDownloadBtn').onclick=async()=>{
    await withYandexUiTask(()=>v14Sync(false));yandexDiskModal();
  };
  const accountButton=document.createElement('button');accountButton.className='btn';accountButton.textContent='Аккаунты и журналы';
  accountButton.onclick=v14AccountsModal;card.querySelector('.cloud-actions').prepend(accountButton);
};
document.getElementById('accountsBtn').onclick=v14AccountsModal;
document.getElementById('syncConflictNotice').onclick=v14ConflictsModal;
// Other tabs retain their own drafts; their next save merges the durable local log.
window.addEventListener('storage',event=>{
  if(!v14Session||event.key!==v14Key()||state.dirty||document.querySelector('.journal-cell-input')||v14NetworkBusy)return;
  try{v14MergeLocal();v14AdoptProjection();}catch(e){alert('Не удалось прочитать изменения другой вкладки: '+e.message);}
});
try{
  const saved=JSON.parse(sessionStorage.getItem(V14_SESSION)||'null');
  if(saved){
    const envelope=v14Read(v14Key(saved));
    if(!envelope)throw Error('Локальный журнал аккаунта не найден. Войдите заново.');
    v14Replica=new GradebookSync.Replica(v14Actor,v14Author(saved.user),envelope.events);
    v14Session=saved;db=normalizeDB(v14Replica.materialize());v14Baseline=clone(db);
    state.groupId=db.groups[0]?.id||null;applyTheme(db.settings.theme||'light');
  }
}catch(e){sessionStorage.removeItem(V14_SESSION);alert('Не удалось открыть аккаунт: '+e.message);}
v14UpdateBadge();
