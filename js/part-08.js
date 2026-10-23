function renderGeneralSettings(){
  return `
    <div class="settings-section">
      <h4>Общие настройки</h4>

      <div class="field" style="max-width:520px">
        <label>Дисциплина</label>
        <input id="generalSubject" value="${esc(db.settings.subject||'')}">
      </div>

      <div class="field" style="max-width:300px;margin-top:10px">
        <label>Учебный год</label>
        <input id="generalYear" value="${esc(db.settings.year||'')}">
      </div>

      <label class="check-row">
        <input type="checkbox" id="generalShowComments" ${db.settings.showComments?'checked':''}>
        <div>
          <strong>Просмотр комментариев в общей таблице</strong>
          <span>Если включено, нажмите на результат студента в журнале — откроется небольшое окно с комментарием.</span>
        </div>
      </label>

      <div style="margin-top:16px">
        <button class="btn primary" id="saveGeneralSettings">Сохранить</button>
      </div>

      <div class="hint" style="margin-top:16px">
        Эти параметры отображаются в шапке журнала и при печати.
      </div>
    </div>
  `;
}

function wireGeneralSettings(){
  document.getElementById('saveGeneralSettings').onclick=()=>{
    db.settings.subject=document.getElementById('generalSubject').value.trim();
    db.settings.year=document.getElementById('generalYear').value.trim();
    db.settings.showComments=document.getElementById('generalShowComments').checked;
    saveDB();
    renderMain();
    toast('Настройки сохранены');
  };
}

function quickAddLesson(){
  if(!state.groupId||!currentGroup()){
    toast('Сначала создайте группу');
    settingsModal('groups');
    return;
  }

  openModal(`
    <div class="modal-head">
      <h3>Новое занятие</h3>
    </div>

    <div class="modal-body">
      <div class="row">
        <div class="field">
          <label>Дата</label>
          <input type="date" id="quickLessonDate" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="field">
          <label>Часы</label>
          <input type="number" min="1" max="12" id="quickLessonHours" value="2">
        </div>
      </div>

      <div class="field" style="margin-top:10px">
        <label>Группы и подгруппы на занятии</label>
        <div class="group-choice-list">
          ${lessonTargetChoicesMarkup(
            [{groupId:state.groupId,subgroupId:null}],
            'quickLessonTargetChoice'
          )}
        </div>
        <div class="hint">Можно выбрать всю группу или только одну/несколько её подгрупп.</div>
      </div>

      <div class="field" style="margin-top:10px">
        <label>Тема занятия</label>
        <textarea id="quickLessonTopic" rows="3" placeholder="Введите тему занятия"></textarea>
      </div>

      <div class="field" style="margin-top:10px">
        <label>Вид занятия</label>
        <select id="quickLessonType">
          ${lessonTypeOptions()}
        </select>
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn" id="cancelQuickLesson">Отмена</button>
      <button class="btn primary" id="saveQuickLesson">Создать и открыть</button>
    </div>
  `,true);

  wireLessonTargetChoices('quickLessonTargetChoice');
  document.getElementById('cancelQuickLesson').onclick=closeModal;
  document.getElementById('saveQuickLesson').onclick=()=>{
    const date=document.getElementById('quickLessonDate').value;
    if(!date){
      toast('Укажите дату занятия');
      return;
    }

    const targets=selectedLessonTargets('quickLessonTargetChoice');
    if(!targets.length){
      toast('Выберите хотя бы одну группу или подгруппу');
      return;
    }

    const groupIds=[...new Set(targets.map(t=>t.groupId))];
    const primary=groupIds.includes(state.groupId)?state.groupId:groupIds[0];
    const typeId=document.getElementById('quickLessonType').value;
    const type=lessonTypeById(typeId);

    const lesson={
      id:uid('l'),
      groupId:primary,
      groupIds,
      targets,
      createdAt:Date.now(),
      date,
      hours:document.getElementById('quickLessonHours').value||'2',
      topic:document.getElementById('quickLessonTopic').value.trim(),
      typeId,
      type:type?.name||'Занятие'
    };

    db.lessons.push(lesson);
    saveDB();
    closeModal();
    renderMain();
    openLesson(lesson.id);
    toast('Занятие создано');
  };
}



function base64UrlFromBytes(bytes){
  let bin='';
  bytes.forEach(b=>bin+=String.fromCharCode(b));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function randomPkceVerifier(){
  const bytes=new Uint8Array(48);
  if(window.crypto?.getRandomValues){
    crypto.getRandomValues(bytes);
  }else{
    for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  }
  return base64UrlFromBytes(bytes);
}

async function buildPkce(){
  const verifier=randomPkceVerifier();
  if(window.crypto?.subtle){
    try{
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
      return {
        verifier,
        challenge:base64UrlFromBytes(new Uint8Array(digest)),
        method:'S256'
      };
    }catch(e){}
  }
  return {verifier,challenge:verifier,method:'plain'};
}

function yandexConnected(){
  return !!yadisk.accessToken;
}

function yandexLastSyncText(){
  if(!yadisk.lastSyncAt)return 'ещё не выполнялась';
  try{return new Date(yadisk.lastSyncAt).toLocaleString('ru-RU')}
  catch(e){return '—'}
}

function yandexDiskModal(){
  const connected=yandexConnected();

  openModal(`
    <div class="modal-head">
      <h3>Синхронизация с Яндекс Диском</h3>
      <button class="btn" id="closeYandexModal">Закрыть</button>
    </div>

    <div class="modal-body">
      <div class="cloud-card">
        <div class="cloud-status">
          <span class="cloud-dot ${connected?'ok':'warn'}"></span>
          <div>
            <b>${connected?'Яндекс Диск подключён':'Яндекс Диск не подключён'}</b>
            <div class="hint" style="margin:1px 0 0">
              ${connected?`Последняя синхронизация: ${esc(yandexLastSyncText())}`:'Настройте OAuth-доступ один раз на этом устройстве.'}
            </div>
          </div>
        </div>

        <div class="field">
          <label>Client ID приложения Яндекс OAuth</label>
          <input id="yandexClientId" value="${esc(yadisk.clientId||'')}" placeholder="Client ID">
        </div>

        <div style="margin-top:9px">
          <label class="mini">Облачный файл журнала</label>
          <div class="cloud-path">${YADISK_PATH}</div>
        </div>

        <ol class="cloud-steps">
          <li>Создайте OAuth-приложение Яндекса с доступом к <b>папке приложения на Диске</b>.</li>
          <li>Redirect URI: <b>https://oauth.yandex.ru/verification_code</b>.</li>
          <li>Нажмите «Получить код», разрешите доступ и вставьте выданный код ниже.</li>
        </ol>

        <div class="cloud-actions">
          <button class="btn" id="yandexOpenOAuthBtn">1. Получить код OAuth</button>
        </div>

        <div class="cloud-code-row">
          <input id="yandexAuthCode" placeholder="Код подтверждения">
          <button class="btn primary" id="yandexExchangeCodeBtn">2. Подключить</button>
        </div>

        <details style="margin-top:10px">
          <summary>Ручной OAuth-токен</summary>
          <div class="cloud-code-row">
            <input id="yandexManualToken" type="password" placeholder="OAuth-токен">
            <button class="btn" id="yandexManualTokenBtn">Сохранить токен</button>
          </div>
          <div class="cloud-security">
            Резервный вариант, если браузер блокирует обмен OAuth-кода из локального HTML.
          </div>
        </details>

        <div class="cloud-security">
          Client Secret в HTML не используется. Токен хранится только локально в браузере и не входит в экспорт базы.
        </div>
      </div>

      <div class="cloud-card">
<h4>Синхронизация базы и настроек</h4>
        <p class="hint">В каждой версии сохраняются группы, студенты, занятия, результаты и настройки, включая цвета, обозначения типов и тему. OAuth-токены остаются на устройстве. Перед заменой облачного файла сохраняются его предыдущая и новая версии в папке journal-versions. История хранится без автоматического удаления.</p>
        <label class="check-row" style="margin-top:0">
          <input type="checkbox" id="yandexAutoSync" ${yadisk.autoSync?'checked':''} ${connected?'':'disabled'}>
          <div>
            <strong>Автосинхронизация</strong>
            <span>После сохранения изменений база будет отправляться на Яндекс Диск с небольшой задержкой.</span>
          </div>
        </label>

        <div class="cloud-actions">
          <button class="btn primary" id="yandexSyncNowBtn" ${connected?'':'disabled'}>Синхронизировать сейчас</button>
          <button class="btn" id="yandexUploadBtn" ${connected?'':'disabled'}>Отправить на Диск</button>
          <button class="btn" id="yandexDownloadBtn" ${connected?'':'disabled'}>Загрузить с Диска</button>
          <button class="btn" id="yandexVersionsBtn" ${connected?'':'disabled'}>История версий</button>
          <button class="btn danger" id="yandexDisconnectBtn" ${connected?'':'disabled'}>Отключить</button>
        </div>
      </div>
    </div>
  `);

  document.getElementById('closeYandexModal').onclick=closeModal;

  document.getElementById('yandexOpenOAuthBtn').onclick=startYandexAuthorization;
  document.getElementById('yandexExchangeCodeBtn').onclick=exchangeYandexAuthorizationCode;
  document.getElementById('yandexManualTokenBtn').onclick=async()=>{
    const token=document.getElementById('yandexManualToken').value.trim();
    const clientId=document.getElementById('yandexClientId').value.trim();
    if(!token){
      toast('Введите OAuth-токен');
      return;
    }
    yadisk.accessToken=token;
    yadisk.clientId=clientId||yadisk.clientId;
    yadisk.refreshToken='';
    yadisk.expiresAt=0;
    saveYandexConfig();
    try{
      await yandexTestConnection();
      toast('Яндекс Диск подключён');
      yandexDiskModal();
    }catch(e){
      alert(`Токен сохранён, но проверка доступа не прошла:\n${e.message}`);
      yandexDiskModal();
    }
  };

  const auto=document.getElementById('yandexAutoSync');
  if(auto){
    auto.onchange=()=>{
      yadisk.autoSync=auto.checked;
      saveYandexConfig();
      if(auto.checked)scheduleYandexAutoPush();
    };
  }

  const syncBtn=document.getElementById('yandexSyncNowBtn');
  if(syncBtn)syncBtn.onclick=async()=>{
    await withYandexUiTask(async()=>yandexSyncNow(false));
    yandexDiskModal();
  };

  const uploadBtn=document.getElementById('yandexUploadBtn');
  if(uploadBtn)uploadBtn.onclick=async()=>{
    await withYandexUiTask(async()=>yandexUploadSnapshot(false));
    yandexDiskModal();
  };

  const downloadBtn=document.getElementById('yandexDownloadBtn');
  if(downloadBtn)downloadBtn.onclick=async()=>{
    if(state.dirty){
      toast('Сначала сохраните текущие изменения');
      return;
    }
    if(!confirm('Заменить локальную базу версией с Яндекс Диска?'))return;
    await withYandexUiTask(async()=>{
      const snapshot=await yandexDownloadSnapshot();
      if(!snapshot)throw new Error('Облачная база ещё не создана');
      await archiveYandexSnapshot(cloudPayload());
      applyCloudSnapshot(snapshot);
      toast('База загружена с Яндекс Диска');
    });
    yandexDiskModal();
  };

  document.getElementById('yandexVersionsBtn').onclick=()=>yandexVersionsModal();

  const disc=document.getElementById('yandexDisconnectBtn');
  if(disc)disc.onclick=()=>{
    if(!confirm('Отключить Яндекс Диск на этом устройстве?'))return;
    yadisk={
      clientId:yadisk.clientId||'',
      accessToken:'',
      refreshToken:'',
      expiresAt:0,
      autoSync:false,
      lastSyncAt:0,
      pkceVerifier:'',
      pkceMethod:''
    };
    saveYandexConfig();
    toast('Яндекс Диск отключён');
    yandexDiskModal();
  };
}

async function yandexListVersions(offset=0){
  const query=new URLSearchParams({path:YADISK_VERSIONS_PATH,limit:'20',offset:String(offset),sort:'-name'});
  const res=await yandexApiFetch('https://cloud-api.yandex.net/v1/disk/resources?'+query);
  if(res.status===404)return {items:[],total:0};
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||`ошибка чтения истории (${res.status})`);
  return {items:(data._embedded?.items||[]).filter(x=>x.type==='file'&&/^journal_.*\.json$/.test(x.name)),total:data._embedded?.total||0};
}
