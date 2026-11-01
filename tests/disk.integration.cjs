/* Two full app instances exchanging changes through the real Yandex Disk API.
 * Runs only with YANDEX_DISK_TOKEN, in a temporary folder app:/gradebook-ci/<run>,
 * never in the real journal folder. The folder goes to the Disk trash afterwards. */
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const token=process.env.YANDEX_DISK_TOKEN;
const run=(process.env.GITHUB_RUN_ID||'local')+'-'+(process.env.GITHUB_RUN_ATTEMPT||Date.now());
const root='app:/gradebook-ci/'+run;
const api='https://cloud-api.yandex.net/v1/disk/resources';
const headers={Authorization:'OAuth '+token,Accept:'application/json'};
// Network trace for CI: method, host, kind of request, status and time. No URLs, paths or
// tokens are printed (upload/download links are signed).
async function traced(input,options={}){
  const url=new URL(String(input)),started=Date.now();
  const kind=url.pathname.endsWith('/upload')?'upload-link':url.pathname.endsWith('/download')?'download-link':
    url.hostname==='cloud-api.yandex.net'?'resource':'file';
  try{
    const res=await fetch(input,options);
    console.log(`net ${options.method||'GET'} ${url.hostname} ${kind} ${res.status} ${Date.now()-started}ms`);
    return res;
  }catch(e){
    console.log(`net ${options.method||'GET'} ${url.hostname} ${kind} FAILED ${e.cause?.code||e.message} ${Date.now()-started}ms`);
    throw e;
  }
}

async function app(){
  const errors=[],dir=path.join(__dirname,'..'),vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(e.type==='unhandled-exception')errors.push(e.message);});
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/<script src="([^"]+)"><\/script>/g,
    (_,file)=>'<script>'+fs.readFileSync(path.join(dir,file),'utf8').replaceAll('</script','<\\/script')+'</script>');
  const dom=new JSDOM(html,{url:'https://gradebook.test/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.Headers=Headers;
    w.fetch=traced;w.scrollTo=()=>{};w.confirm=()=>true;w.alert=m=>errors.push('alert: '+m);
    w.requestAnimationFrame=()=>0;w.GRADEBOOK_V14_ROOT=root;
  }});
  after(()=>dom.window.close());
  await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
  const w=dom.window;w.eval(`yadisk.accessToken=${JSON.stringify(token)};V14_RELIST_MS=3000;`);
  assert.equal(w.eval('V14_ROOT'),root,'the test must never touch the real journal folder');
  return {w,errors,run:code=>w.eval(code),plain:code=>JSON.parse(w.eval('JSON.stringify('+code+')'))};
}
after(async()=>{
  if(!token)return;
  await fetch(api+'?'+new URLSearchParams({path:root,permanently:'false'}),{method:'DELETE',headers}).catch(()=>{});
});

test('real Yandex Disk: accounts, shared journal, concurrent edits, conflict and resolution',{skip:!token&&'YANDEX_DISK_TOKEN не задан',timeout:600000},async()=>{
  const a=await app(),b=await app();
  // Parent folder for this run (the app creates its own subfolders).
  await traced(api+'?'+new URLSearchParams({path:'app:/gradebook-ci'}),{method:'PUT',headers});
  const userA=await a.w.v14Authenticate('ci-a-'+run.slice(-6),'ci-password-A',true,'Учитель А');
  const userB=await b.w.v14Authenticate('ci-b-'+run.slice(-6),'ci-password-B',true,'Учитель Б');
  await assert.rejects(b.w.v14Authenticate(userA.login,'wrong-password'),/пароль/);
  await a.w.v14Activate(userA,'shared','ci');await b.w.v14Activate(userB,'shared','ci');
  a.run(`db.groups=[{id:'g',name:'Группа',subgroups:[]}];db.students=[{id:'s',name:'Студент',groupId:'g'},{id:'t',name:'Второй',groupId:'g'}];
    db.lessons=[{id:'l',date:'2026-11-01',groupId:'g',typeId:'lecture'}];db.results=[{studentId:'s',lessonId:'l',value:'3',comment:''}];saveDB();`);
  await a.w.v14Sync();await b.w.v14Sync();
  assert.equal(b.plain('db.results')[0].value,'3');
  // Independent edits merge; the same cell becomes a conflict with both values kept.
  a.run("db.results[0].comment='А проверил';db.students[1].name='Второй А';saveDB();");
  b.run("db.results.push({studentId:'t',lessonId:'l',value:'5',comment:''});saveDB();");
  await Promise.all([a.w.v14Sync(),b.w.v14Sync()]);
  a.run("db.results.find(r=>r.studentId==='s').value='4';saveDB();");b.run("db.results.find(r=>r.studentId==='s').value='5';saveDB();");
  await Promise.all([a.w.v14Sync(),b.w.v14Sync()]);
  await a.w.v14Sync();await b.w.v14Sync();
  assert.deepEqual(a.plain('db.results'),b.plain('db.results'));
  assert.equal(a.plain('db.students').find(s=>s.id==='t').name,'Второй А');
  const conflict=a.run("JSON.stringify(v14Conflicts().find(c=>JSON.parse(c.key)[2]==='value'))");
  assert.ok(conflict,'same-cell edits must be kept as a conflict');
  const {key,candidates}=JSON.parse(conflict);
  a.run(`v14Append([${JSON.stringify(candidates.find(c=>c.change.value==='4').change)}]);db=v14Project();v14Persist(v14MergeLocal());v14AdoptProjection();`);
  await a.w.v14Sync();await b.w.v14Sync();
  assert.equal(b.plain('db.results').find(r=>r.studentId==='s').value,'4');
  assert.equal(b.run('v14Conflicts().length'),0);
  // A third, fresh participant receives the whole journal.
  const c=await app();await c.w.v14Activate(await c.w.v14Authenticate(userA.login,'ci-password-A'),'shared','ci');
  await c.w.v14Sync();
  assert.deepEqual(c.plain('db.results'),a.plain('db.results'));
  for(const x of [a,b,c])assert.deepEqual(x.errors,[]);
});
