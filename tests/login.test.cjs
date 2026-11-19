const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const {createDatabase}=require('./pg-mock.cjs');
const root=path.join(__dirname,'..');
const TEAM_KEY='team-key-for-tests-0123456789';

// Minimal Yandex Disk: non-overwriting uploads and downloads by path.
function disk(){
  const files=new Map(),folders=new Set(['app:/']);
  const result=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>JSON.parse(JSON.stringify(data))});
  return {files,offline:false,async fetch(input,options={}){
    if(this.offline)throw new TypeError('Failed to fetch');
    const url=new URL(input),p=url.searchParams.get('path'),method=options.method||'GET';
    if(url.hostname==='download.test')return files.has(p)?result(200,files.get(p)):result(404,{});
    if(url.hostname==='upload.test'){if(files.has(p))return result(409,{});files.set(p,JSON.parse(options.body));return result(201,{});}
    if(url.pathname.endsWith('/upload'))return files.has(p)?result(409,{}):result(200,{href:'https://upload.test/?path='+encodeURIComponent(p)});
    if(url.pathname.endsWith('/download'))return files.has(p)?result(200,{href:'https://download.test/?path='+encodeURIComponent(p)}):result(404,{});
    if(method==='PUT'){if(folders.has(p))return result(409,{});folders.add(p);return result(201,{});}
    if(folders.has(p))return result(200,{type:'dir',_embedded:{items:[],total:0}});
    return result(404,{});
  }};
}
async function app(t,transport,saved,config){
  const errors=[],vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(e.type==='unhandled-exception')errors.push(e.message);});
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"><\/script>/g,
    (_,file)=>'<script>'+fs.readFileSync(path.join(root,file),'utf8').replaceAll('</script','<\\/script')+'</script>');
  const dom=new JSDOM(html,{url:'https://gradebook.test/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.Headers=Headers;
    w.fetch=(...args)=>transport.fetch(...args);w.scrollTo=()=>{};w.confirm=()=>true;w.alert=m=>errors.push('alert: '+m);
    w.requestAnimationFrame=()=>0;
    if(config)w.GRADEBOOK_CONFIG=config;
    for(const [key,value] of saved?.local||[])w.localStorage.setItem(key,value);
    for(const [key,value] of saved?.session||[])w.sessionStorage.setItem(key,value);
  }});
  t.after(()=>{dom.window.close();assert.deepEqual(errors,[]);});
  await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
  const w=dom.window,d=w.document;
  return {w,d,run:code=>w.eval(code),
    saved:()=>({local:Object.entries(w.localStorage),session:Object.entries(w.sessionStorage)}),
    page:()=>!d.getElementById('loginPage').hidden,
    error:()=>d.getElementById('loginError').textContent,
    fill(values){
      for(const [id,value] of Object.entries(values)){
        const el=d.getElementById(id);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));
      }
    },
    storage(kind){const radio=d.querySelector(`input[name="loginStorage"][value="${kind}"]`);radio.checked=true;radio.dispatchEvent(new w.Event('change',{bubbles:true}));},
    submit:()=>w.loginSubmit()};
}

test('the login page opens first; a new account is created on Yandex Disk and the journal opens',async t=>{
  const yandex=disk(),a=await app(t,yandex);
  assert.ok(a.page(),'login page is shown without a session');
  assert.ok(a.d.body.classList.contains('login-open'));
  a.storage('yandex');
  a.d.getElementById('loginRegisterToggle').click();
  assert.equal(a.d.getElementById('loginNameField').hidden,false);
  a.fill({loginUser:'Teacher',loginPassword:'a-good-password',loginName:'Анна Петровна',loginYaToken:'token-1',loginWorkspace:'кафедра'});
  await a.submit();
  assert.equal(a.error(),'');
  assert.equal(a.page(),false,'page closes after sign-in');
  assert.equal(a.run('v14Session.user.login'),'teacher');
  assert.equal(a.run('v14Session.label'),'кафедра');
  assert.equal(a.run('yadisk.accessToken'),'token-1');
  assert.ok([...yandex.files.keys()].some(p=>/accounts\/[a-f0-9]{64}\.json$/.test(p)));
  const prefs=JSON.parse(a.w.localStorage.getItem('gradebook_login_prefs'));
  assert.deepEqual(prefs,{login:'teacher',mode:'shared',workspace:'кафедра',storage:'yandex'});
  assert.ok(!JSON.stringify(a.saved()).includes('a-good-password'),'password is never stored');
  // Signing out returns to the login page with the login filled in.
  a.w.v14Logout();
  assert.ok(a.page());
  assert.equal(a.d.getElementById('loginUser').value,'teacher');
  assert.equal(a.d.getElementById('loginPassword').value,'');
});

test('online sign-in checks the password against the stored account',async t=>{
  const yandex=disk(),a=await app(t,yandex);
  a.run("yadisk.accessToken='token';saveYandexConfig();");
  await a.w.v14Authenticate('teacher','a-good-password',true,'Учитель');
  const b=await app(t,yandex);
  b.storage('yandex');b.fill({loginUser:'teacher',loginPassword:'wrong-password',loginYaToken:'token'});
  await b.submit();
  assert.match(b.error(),/Неверный логин или пароль/);assert.ok(b.page());
  b.fill({loginPassword:'a-good-password'});await b.submit();
  assert.equal(b.page(),false);assert.equal(b.run('v14Session.user.name'),'Учитель');
});

test('offline sign-in works without a network for an account used on this device, with either storage',async t=>{
  const yandex=disk(),a=await app(t,yandex);
  a.storage('yandex');a.fill({loginUser:'teacher',loginPassword:'a-good-password',loginYaToken:'token'});
  a.d.getElementById('loginRegisterToggle').click();a.fill({loginName:'Учитель'});
  await a.submit();assert.equal(a.page(),false);
  a.w.v14Logout();
  yandex.offline=true;
  const b=await app(t,yandex,a.saved());
  assert.ok(b.page());
  b.d.getElementById('loginTabOffline').click();
  assert.equal(b.d.getElementById('loginRegisterToggle').hidden,true,'no registration offline');
  assert.equal(b.d.getElementById('loginSubmit').textContent,'Войти офлайн');
  b.fill({loginPassword:'wrong-password'});await b.submit();
  assert.match(b.error(),/Неверный логин или пароль/);
  b.fill({loginUser:'nobody',loginPassword:'a-good-password'});await b.submit();
  assert.match(b.error(),/ещё не сохранён на этом устройстве/);
  // Supabase chosen offline: settings are only validated and saved, the database is not called.
  b.storage('supabase');
  b.fill({loginUser:'teacher',loginPassword:'a-good-password',loginPgUrl:'',loginPgApiKey:'',loginPgTeamKey:''});
  await b.submit();assert.match(b.error(),/параметры Supabase/);
  b.fill({loginPgUrl:'db.test',loginPgApiKey:'sb_publishable_test',loginPgTeamKey:TEAM_KEY});
  await b.submit();
  assert.equal(b.error(),'');assert.equal(b.page(),false);
  assert.equal(b.run('v14Session.user.login'),'teacher');
  assert.deepEqual(JSON.parse(b.run('JSON.stringify(pgConfig)')),{url:'https://db.test',apiKey:'sb_publishable_test',teamKey:TEAM_KEY,enabled:true});
  assert.equal(b.run('v14Backend()===GradebookPostgres'),true);
});

test('when the storage is unreachable, online sign-in offers the offline fallback',async t=>{
  const yandex=disk(),a=await app(t,yandex);
  a.run("yadisk.accessToken='token';saveYandexConfig();");
  await a.w.v14Authenticate('teacher','a-good-password',true,'Учитель');
  a.run('V14_RELIST_MS=1');
  yandex.offline=true;
  a.storage('yandex');a.fill({loginUser:'teacher',loginPassword:'a-good-password',loginYaToken:'token'});
  await a.submit();
  assert.match(a.error(),/можете войти офлайн/);
  const fallback=a.d.getElementById('loginOfflineFallback');
  assert.equal(fallback.hidden,false);
  fallback.click();
  for(let i=0;i<50&&a.page();i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(a.page(),false);assert.equal(a.run('v14Session.user.login'),'teacher');
});

test('online sign-in with Supabase checks the database first and registers the account there',async t=>{
  const database=await createDatabase();await database.addKey(TEAM_KEY);
  const a=await app(t,database);
  a.storage('supabase');
  a.d.getElementById('loginRegisterToggle').click();
  a.fill({loginUser:'teacher',loginPassword:'a-good-password',loginName:'Учитель',loginPgUrl:database.url,loginPgApiKey:database.apiKey,loginPgTeamKey:'wrong-team-key-0123456789'});
  await a.submit();
  assert.match(a.error(),/Неверный ключ команды/);
  assert.equal(a.run('pgConfig.enabled'),false,'a failed check does not change the settings');
  a.fill({loginPgTeamKey:TEAM_KEY});await a.submit();
  assert.equal(a.page(),false);
  assert.ok((await database.rows()).some(r=>/\/accounts\/[a-f0-9]{64}\.json$/.test(r.path)));
});

test('the page can be skipped for the local journal and reopened from «Аккаунты»',async t=>{
  const a=await app(t,disk());
  a.d.getElementById('loginSkip').click();
  assert.equal(a.page(),false);
  const b=await app(t,disk(),a.saved());
  assert.equal(b.page(),false,'skipping lasts for this tab');
  b.d.getElementById('accountsBtn').click();
  assert.ok(b.page());
  assert.equal(b.d.getElementById('modalBackdrop').classList.contains('show'),false);
  // Storage dialogs open above the page.
  b.d.getElementById('loginPgSettings').click();
  assert.ok(b.d.getElementById('modalBackdrop').classList.contains('show'));
  b.d.getElementById('pgClose').click();
  assert.ok(b.page());
});

test('the web version takes the Supabase project from its config; only the team key is typed in',async t=>{
  const database=await createDatabase();await database.addKey(TEAM_KEY);
  const a=await app(t,database,null,{supabaseUrl:database.url+'/',supabasePublishableKey:database.apiKey});
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(pgConfig)')),{url:database.url,apiKey:database.apiKey,teamKey:'',enabled:true});
  assert.equal(a.d.querySelector('input[name="loginStorage"]:checked').value,'supabase');
  const hidden=id=>a.d.getElementById(id).closest('.field').hidden;
  assert.equal(hidden('loginPgUrl'),true);assert.equal(hidden('loginPgApiKey'),true);assert.equal(hidden('loginPgTeamKey'),false);
  assert.match(a.d.getElementById('loginStorageText').textContent,/заданы в web-версии/);
  a.d.getElementById('loginRegisterToggle').click();
  a.fill({loginUser:'teacher',loginPassword:'a-good-password',loginName:'Учитель',loginPgTeamKey:TEAM_KEY});
  await a.submit();
  assert.equal(a.error(),'');assert.equal(a.page(),false);
  assert.ok((await database.rows()).some(r=>/\/accounts\/[a-f0-9]{64}\.json$/.test(r.path)));
  // A device with its own database settings keeps them.
  const own=await app(t,database,{local:[['gradebook_pg_config',JSON.stringify({url:'https://own.test',apiKey:'k',teamKey:'x'.repeat(24),enabled:true})]]},
    {supabaseUrl:database.url,supabasePublishableKey:database.apiKey});
  assert.equal(own.run('pgConfig.url'),'https://own.test');
  assert.equal(own.d.getElementById('loginPgUrl').closest('.field').hidden,false);
});

test('with every secret preset the page asks only for the login and password',async t=>{
  const database=await createDatabase();await database.addKey(TEAM_KEY);
  const a=await app(t,database,null,{supabaseUrl:database.url,supabasePublishableKey:database.apiKey,teamKey:TEAM_KEY,yandexToken:'ya-token'});
  assert.equal(a.run('pgConnected()'),true);
  assert.equal(a.run('yadisk.accessToken'),'ya-token');
  assert.equal(a.d.getElementById('loginStorageDetails').hidden,true);
  a.storage('yandex');
  assert.equal(a.d.getElementById('loginStorageDetails').hidden,true);
  a.storage('supabase');
  a.d.getElementById('loginRegisterToggle').click();
  a.fill({loginUser:'teacher',loginPassword:'a-good-password',loginName:'Учитель'});
  await a.submit();
  assert.equal(a.error(),'');assert.equal(a.page(),false);
});
