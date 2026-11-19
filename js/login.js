/* Login page (v14.5). Shown instead of the journal until the user signs in.
 * - «Вход»: login and password are checked against the account stored in the chosen
 *   storage (Supabase or Yandex Disk); a new account can be created there.
 * - «Офлайн-вход»: the fallback without a network. The password is checked against the
 *   account saved on this device by an earlier online sign-in; edits stay in this browser
 *   and go to the chosen storage once it is reachable (an account moves there with them).
 * Passwords are never stored: only the login, journal and storage choice are remembered. */
const LOGIN_PREFS_KEY='gradebook_login_prefs';
const LOGIN_SKIP_KEY='gradebook_login_skipped';
let loginOffline=false,loginRegistering=false,loginBusy=false;

function loginEl(id){return document.getElementById(id);}
function loginPrefs(){
  try{const prefs=JSON.parse(localStorage.getItem(LOGIN_PREFS_KEY)||'{}');return prefs&&typeof prefs==='object'?prefs:{};}
  catch(e){return {};}
}
function saveLoginPrefs(prefs){
  try{localStorage.setItem(LOGIN_PREFS_KEY,JSON.stringify({...loginPrefs(),...prefs}));}catch(e){}
}
function loginStorageChoice(){
  return document.querySelector('input[name="loginStorage"]:checked')?.value||'supabase';
}
function loginDefaultStorage(){
  if(pgConnected()||pgPresetFields().project&&pgConfig.enabled)return 'supabase';
  if(yadisk.accessToken)return 'yandex';
  const saved=loginPrefs().storage;
  return saved==='yandex'||saved==='supabase'?saved:'supabase';
}
function loginPgReady(){return !!(pgConfig.url&&pgConfig.apiKey&&pgConfig.teamKey);}
function loginPgHost(){try{return pgBaseUrl().replace(/^https?:\/\//,'');}catch(e){return pgConfig.url;}}
function loginStorageName(kind){return kind==='supabase'?'Supabase':'Яндекс Диск';}

function loginRefreshStorage(){
  const kind=loginStorageChoice(),supabase=kind==='supabase';
  // Settings that come from the web version (js/config.js) are not shown at all.
  const preset=pgPresetFields(),yaPreset=!!GRADEBOOK_PRESET.yandexToken&&yadisk.accessToken===GRADEBOOK_PRESET.yandexToken;
  let ok,text;
  if(supabase){
    ok=loginPgReady();
    text=pgConnected()?'База данных подключена: '+loginPgHost()+'.':
      ok?'База данных настроена: '+loginPgHost()+'. Будет включена при входе.':
      preset.project?'Адрес и ключ проекта заданы в web-версии. Введите ключ команды (один раз на этом устройстве).':
      'База данных не настроена: укажите адрес проекта, publishable key и ключ команды.';
    if(ok&&preset.project)text+=preset.teamKey?' Все параметры заданы в web-версии.':' Адрес и ключ проекта заданы в web-версии.';
  }else{
    ok=!!yadisk.accessToken;
    text=ok?(pgConnected()?'Яндекс Диск подключён. Будет использоваться вместо базы данных.':'Яндекс Диск подключён.'):
      'Яндекс Диск не подключён: вставьте OAuth-токен или подключите Диск через OAuth.';
    if(yaPreset)text+=' Токен задан в web-версии.';
  }
  loginEl('loginStorageStatus').querySelector('.cloud-dot').className='cloud-dot '+(ok?'ok':'warn');
  loginEl('loginStorageText').textContent=text;
  loginEl('loginSupabaseFields').hidden=!supabase;
  loginEl('loginYandexFields').hidden=supabase;
  const field=id=>loginEl(id).closest('.field');
  field('loginPgUrl').hidden=field('loginPgApiKey').hidden=preset.project;
  field('loginPgTeamKey').hidden=preset.teamKey;
  field('loginYaToken').hidden=yaPreset;
  loginEl('loginStorageDetails').hidden=supabase?preset.teamKey:yaPreset;
  if(!ok)loginEl('loginStorageDetails').open=true;
}
function loginFillStorageFields(){
  loginEl('loginPgUrl').value=pgConfig.url||'';
  loginEl('loginPgApiKey').value=pgConfig.apiKey||'';
  loginEl('loginPgTeamKey').value=pgConfig.teamKey||'';
  loginEl('loginYaToken').value=yadisk.accessToken||'';
}
function loginRender(){
  const online=!loginOffline,register=online&&loginRegistering;
  for(const [id,active] of [['loginTabOnline',online],['loginTabOffline',!online]]){
    loginEl(id).classList.toggle('active',active);loginEl(id).setAttribute('aria-selected',String(active));
  }
  loginEl('loginSubtitle').textContent=register?'Новый аккаунт':online?'Вход по логину и паролю':'Вход без интернета';
  loginEl('loginNote').textContent=register?
    'Логин и пароль (не менее 8 символов) сохраняются в выбранном хранилище. Пароль хранится только в виде проверочного хеша.':
    online?'Логин и пароль проверяются по аккаунту в выбранном хранилище.':
    'Запасной вариант, когда нет связи с интернетом, базой данных или Диском. Пароль проверяется по аккаунту, в который вы уже входили на этом устройстве. Правки сохраняются в браузере и отправятся в выбранное хранилище, когда появится связь.';
  loginEl('loginNameField').hidden=!register;
  loginEl('loginPassword').autocomplete=register?'new-password':'current-password';
  loginEl('loginSubmit').textContent=register?'Создать аккаунт и войти':online?'Войти':'Войти офлайн';
  loginEl('loginRegisterToggle').hidden=!online;
  loginEl('loginRegisterToggle').textContent=register?'У меня уже есть аккаунт':'Создать аккаунт';
  loginEl('loginWorkspace').disabled=loginEl('loginMode').value==='private';
  loginEl('loginOfflineFallback').hidden=true;
  loginRefreshStorage();
}
function loginSetOffline(offline){
  loginOffline=offline;loginEl('loginError').textContent='';loginRender();
}
function showLoginPage(){
  const page=loginEl('loginPage');
  if(!page)return;
  if(page.hidden){
    const prefs=loginPrefs();
    loginEl('loginUser').value=prefs.login||'';
    loginEl('loginPassword').value='';
    loginEl('loginMode').value=prefs.mode==='private'?'private':'shared';
    loginEl('loginWorkspace').value=prefs.workspace||'основной';
    const storage=loginDefaultStorage();
    document.querySelectorAll('input[name="loginStorage"]').forEach(r=>{r.checked=r.value===storage;});
    loginFillStorageFields();
    loginEl('loginStorageDetails').open=false;
    loginEl('loginError').textContent='';
    loginRegistering=false;
    loginOffline=navigator.onLine===false;
  }
  page.hidden=false;document.body.classList.add('login-open');
  loginRender();
  try{(loginEl('loginUser').value?loginEl('loginPassword'):loginEl('loginUser')).focus();}catch(e){}
}
function hideLoginPage(){
  const page=loginEl('loginPage');
  if(!page)return;
  page.hidden=true;document.body.classList.remove('login-open');
  loginEl('loginPassword').value='';
}

/* Saves the storage chosen on the page. Online, a database is checked before use;
 * offline, settings are only validated and are checked by the first exchange. */
async function loginApplyStorage(kind,offline){
  if(kind==='supabase'){
    const next={url:loginEl('loginPgUrl').value.trim(),apiKey:loginEl('loginPgApiKey').value.trim(),
      teamKey:loginEl('loginPgTeamKey').value.trim(),enabled:true};
    if(!next.url&&!next.apiKey&&!next.teamKey)
      throw Error('Укажите параметры Supabase (адрес проекта, publishable key и ключ команды) или выберите Яндекс Диск.');
    next.url=pgBaseUrl(next.url);
    if(!next.apiKey)throw Error('Укажите publishable key проекта Supabase.');
    if(next.teamKey.length<20)throw Error('Ключ команды должен содержать не менее 20 символов.');
    const same=pgConfig.enabled&&pgConfig.url===next.url&&pgConfig.apiKey===next.apiKey&&pgConfig.teamKey===next.teamKey;
    if(!same&&!offline)await GradebookPostgres.check(next);
    pgConfig=next;savePgConfig();
  }else{
    const token=loginEl('loginYaToken').value.trim();
    if(!token&&!offline)throw Error('Укажите OAuth-токен Яндекс Диска или нажмите «Подключить через OAuth…».');
    if(token&&token!==yadisk.accessToken){
      yadisk.accessToken=token;yadisk.refreshToken='';yadisk.expiresAt=0;saveYandexConfig();
    }
    if(pgConfig.enabled){pgConfig={...pgConfig,enabled:false};savePgConfig();}
  }
}
function loginNetworkError(e){
  return /Нет связи|Failed to fetch|NetworkError|Load failed|network|сеть|соединени/i.test(String(e?.message||e));
}
async function loginCachedAccount(login){
  try{
    const id=await v14Digest('gradebook-account:'+v14LoginName(login));
    return !!(v14Read(V14_CACHE)||{})[id];
  }catch(e){return false;}
}
async function loginSubmit(event){
  event?.preventDefault();
  if(loginBusy)return;
  const offline=loginOffline,register=!offline&&loginRegistering;
  const login=loginEl('loginUser').value,password=loginEl('loginPassword').value,name=loginEl('loginName').value;
  const mode=loginEl('loginMode').value,workspace=loginEl('loginWorkspace').value,storage=loginStorageChoice();
  const error=loginEl('loginError'),fallback=loginEl('loginOfflineFallback');
  error.textContent='';fallback.hidden=true;
  if(v14NetworkBusy||yandexSyncBusy){error.textContent='Дождитесь завершения синхронизации.';return;}
  const controls=[...loginEl('loginForm').querySelectorAll('button,input,select')];
  const disabled=controls.map(c=>c.disabled);
  loginBusy=true;yandexSyncBusy=true;controls.forEach(c=>c.disabled=true);
  loginEl('loginSubmit').textContent=offline?'Проверка…':'Вход…';
  let ok=false,offerOffline=false;
  try{
    if(!String(login).trim())throw Error('Введите логин.');
    if(!password)throw Error('Введите пароль.');
    if(state.dirty)throw Error('Сначала сохраните текущие изменения.');
    await loginApplyStorage(storage,offline);
    const user=await v14Authenticate(login,password,register,name,offline);
    saveLoginPrefs({login:user.login,mode,workspace:String(workspace).trim()||'основной',storage});
    await v14Activate(user,mode,workspace);
    ok=true;
    if(offline)toast(`Офлайн-вход. Правки сохраняются на этом устройстве и отправятся в ${loginStorageName(storage)}, когда появится связь.`);
  }catch(e){
    error.textContent=e.message||String(e);
    if(!offline&&!register&&loginNetworkError(e)&&await loginCachedAccount(login)){
      error.textContent+=' Вы уже входили в этот аккаунт на этом устройстве и можете войти офлайн.';
      offerOffline=true;
    }
  }finally{
    loginBusy=false;yandexSyncBusy=false;
    controls.forEach((c,i)=>c.disabled=disabled[i]);
    if(!ok){loginRender();fallback.hidden=!offerOffline;}
  }
  // Signed in offline while the network is in fact back: exchange as usual.
  if(ok&&yadisk.autoSync&&navigator.onLine!==false)scheduleYandexAutoPush();
}

// Keep the page in step with the rest of the app.
const loginBaseActivate=v14Activate;
v14Activate=async function(...args){
  await loginBaseActivate(...args);
  hideLoginPage();
};
const loginBaseLogout=v14Logout;
v14Logout=function(...args){
  const result=loginBaseLogout(...args);
  showLoginPage();
  return result;
};
// Signed out, «Аккаунты» and the sync button open the login page instead of the dialog.
const loginBaseAccountsModal=v14AccountsModal;
v14AccountsModal=function(...args){
  if(v14Session)return loginBaseAccountsModal(...args);
  closeModal();showLoginPage();
};
document.getElementById('accountsBtn').onclick=()=>v14AccountsModal();
// Storage dialogs opened from the page refresh its status when they close.
const loginBaseCloseModal=closeModal;
closeModal=function(...args){
  loginBaseCloseModal(...args);
  if(!loginEl('loginPage').hidden){loginFillStorageFields();loginRefreshStorage();}
};

loginEl('loginForm').addEventListener('submit',loginSubmit);
loginEl('loginTabOnline').onclick=()=>loginSetOffline(false);
loginEl('loginTabOffline').onclick=()=>loginSetOffline(true);
loginEl('loginRegisterToggle').onclick=()=>{loginRegistering=!loginRegistering;loginEl('loginError').textContent='';loginRender();};
loginEl('loginMode').onchange=loginRender;
document.querySelectorAll('input[name="loginStorage"]').forEach(r=>r.onchange=loginRefreshStorage);
loginEl('loginOfflineFallback').onclick=()=>{loginSetOffline(true);loginSubmit();};
loginEl('loginPgSettings').onclick=()=>databaseModal();
loginEl('loginYaSettings').onclick=()=>yandexDiskModal();
loginEl('loginSkip').onclick=()=>{
  try{sessionStorage.setItem(LOGIN_SKIP_KEY,'1');}catch(e){}
  hideLoginPage();toast('Работа без входа: журнал хранится только в этом браузере. Войти можно кнопкой «Аккаунты».');
};
window.addEventListener('offline',()=>{
  if(!loginEl('loginPage').hidden&&!loginBusy&&!loginOffline)loginSetOffline(true);
});

let loginSkipped=false;
try{loginSkipped=sessionStorage.getItem(LOGIN_SKIP_KEY)==='1';}catch(e){}
if(!v14Session&&!loginSkipped)showLoginPage();
