const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom');
const {Replica}=require('../js/sync-core.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const empty={settings:{},groups:[],students:[],lessonTypes:[],lessons:[],results:[],layouts:[]};
const initial={...copy(empty),groups:[{id:'g',name:'Группа'}],students:[{id:'s',name:'Студент',groupId:'g'}],
  lessons:[{id:'l',date:'2026-11-01',groupId:'g',typeId:'lecture'}],results:[{studentId:'s',lessonId:'l',value:'3',comment:''}]};
function pair(){
  const seed=new Replica('seed','Начальная база');seed.capture(empty,initial);
  return [new Replica('a','Александр',seed.list()),new Replica('b','Борис',seed.list())];
}
function converge(a,b){const all=[...a.list(),...b.list()];a.merge(all);b.merge(all.reverse());assert.deepEqual(a.materialize(),b.materialize());}

test('independent fields and students converge in either order, including duplicates',()=>{
  const [a,b]=pair(),x=a.materialize(),y=b.materialize();
  x.results[0].value='5';y.results[0].comment='Проверено';y.students.push({id:'new',name:'Новый',groupId:'g'});
  a.capture(initial,x);b.capture(initial,y);converge(a,b);converge(a,b);
  assert.equal(a.materialize().results[0].value,'5');assert.equal(a.materialize().results[0].comment,'Проверено');
  assert.equal(a.materialize().students.length,2);assert.equal(a.conflicts().length,0);
});
test('concurrent same-cell edits retain both values; an explicit resolution propagates',()=>{
  const [a,b]=pair(),x=a.materialize(),y=b.materialize();x.results[0].value='4';y.results[0].value='5';
  a.capture(initial,x);b.capture(initial,y);converge(a,b);
  const conflict=a.conflicts().find(c=>JSON.parse(c.key)[2]==='value');
  assert.deepEqual(conflict.candidates.map(c=>c.change.value).sort(),['4','5']);
  a.resolve(conflict.key,conflict.candidates.find(c=>c.change.value==='4').event.id);converge(a,b);
  assert.equal(b.materialize().results[0].value,'4');assert.equal(b.conflicts().length,0);
});
test('delete vs stale unchanged copy stays deleted; concurrent editing preserves deletion conflict',()=>{
  const [a,b]=pair(),x=a.materialize();x.results=[];a.capture(initial,x);converge(a,b);
  assert.deepEqual(b.materialize().results,[]);
  const [c,d]=pair(),y=c.materialize(),z=d.materialize();y.results=[];z.results[0].comment='Изменено офлайн';
  c.capture(initial,y);d.capture(initial,z);converge(c,d);
  const conflict=c.conflicts().find(c=>JSON.parse(c.key)[2]==='$exists');assert.ok(conflict);
  c.resolve(conflict.key,conflict.candidates.find(c=>c.change.value===true).event.id);converge(c,d);
  assert.equal(d.materialize().results[0].comment,'Изменено офлайн');
});
test('same-valued concurrent writes are not conflicts, later causal edits replace them',()=>{
  const [a,b]=pair(),x=a.materialize();x.results[0].value='5';a.capture(initial,x);b.capture(initial,x);converge(a,b);
  assert.equal(a.conflicts().length,0);
  const before=a.materialize(),after=copy(before);after.results[0].value='2';a.capture(before,after);converge(a,b);
  assert.equal(b.materialize().results[0].value,'2');assert.equal(b.conflicts().length,0);
});
test('deleting a group versus adding a new grade keeps ancestor deletion conflicts visible',()=>{
  const [a,b]=pair(),deleted=copy(empty),edited=b.materialize();
  edited.results.push({studentId:'s',lessonId:'new-lesson',value:'5'});
  edited.lessons.push({id:'new-lesson',date:'2026-11-02',groupId:'g'});
  a.capture(initial,deleted);b.capture(initial,edited);converge(a,b);
  assert.ok(a.conflicts().some(c=>c.key==='["groups","g","$exists"]'));
  assert.ok(a.conflicts().some(c=>c.key==='["students","s","$exists"]'));
  assert.ok(a.list().some(e=>e.changes.some(c=>c.change?.value==='5'||c.value==='5')));
});
test('out-of-order delivery converges, missing dependencies and tampered IDs are rejected atomically',()=>{
  const [a]=pair(),x=a.materialize(),y=copy(x);y.results[0].value='5';a.capture(x,y);
  const next=copy(y);next.results[0].value='4';a.capture(y,next);
  const restored=new Replica('restored','Восстановление',a.list().reverse());assert.deepEqual(restored.materialize(),a.materialize());
  const blank=new Replica('blank','');assert.throws(()=>blank.merge([a.list().find(e=>e.id==='a:2')]),/зависимости|журнал/);
  assert.equal(blank.list().length,0);
  const altered=copy(a.list());altered[0].author='Подмена';assert.throws(()=>a.merge(altered),/Повторный ID/);
});
test('random delivery permutations of three peers preserve grades, notes, and conflicts across reloads',()=>{
  const [a,b]=pair(),c=new Replica('c','Третий',a.list());
  for(const [peer,value] of [[a,'4'],[b,'5'],[c,'2']]){
    const before=peer.materialize(),after=copy(before);after.results[0].value=value;peer.capture(before,after);
  }
  const all=[...a.list(),...b.list(),...c.list()];
  for(let seed=1;seed<=20;seed++){
    let n=seed;const shuffled=[...all];
    for(let i=shuffled.length-1;i>0;i--){n=(n*1664525+1013904223)>>>0;const j=n%(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    const peer=new Replica('reload'+seed,'',shuffled);
    assert.deepEqual(peer.materialize(),new Replica('expected','',all).materialize());
    assert.deepEqual(peer.conflicts().find(c=>JSON.parse(c.key)[2]==='value').candidates.map(c=>c.change.value).sort(),['2','4','5']);
  }
});
test('malformed/prototype-polluting changes cannot enter the log',()=>{
  const [a]=pair(),event=copy(a.list()[0]);event.changes[0].key='["students","s","__proto__"]';
  assert.throws(()=>new Replica('x','',[event]),/изменение/);assert.equal({}.polluted,undefined);
});

// In-memory Disk models non-overwriting uploads, links, full pagination and failures.
class Disk{
  constructor(){this.files=new Map();this.folders=new Set(['app:/']);this.failAfterPut=false;this.blockPut=null;this.listPage=2;}
  async fetch(input,options={}){
    const url=new URL(input);const params=url.searchParams,p=params.get('path'),method=options.method||'GET';
    const result=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>copy(data)});
    if(url.hostname==='download.test')return this.files.has(p)?result(200,this.files.get(p)):result(404,{});
    if(url.hostname==='upload.test'){
      if(this.blockPut)await this.blockPut();
      if(this.files.has(p))return result(409,{});
      this.files.set(p,JSON.parse(options.body));
      if(this.failAfterPut){this.failAfterPut=false;throw Error('Соединение оборвалось после PUT');}
      return result(201,{});
    }
    if(url.pathname.endsWith('/download'))return this.files.has(p)?result(200,{href:'https://download.test/?'+new URLSearchParams({path:p})}):result(404,{});
    if(url.pathname.endsWith('/upload')){
      assert.equal(params.get('overwrite'),'false','v14 must never overwrite a shared file');
      return this.files.has(p)?result(409,{}):result(200,{href:'https://upload.test/?'+new URLSearchParams({path:p})});
    }
    if(method==='PUT'){
      if(this.folders.has(p))return result(409,{});
      this.folders.add(p);return result(201,{});
    }
    if(!this.folders.has(p))return result(404,{});
    const items=[...this.files.keys()].filter(x=>x.startsWith(p+'/')&&!x.slice(p.length+1).includes('/')).sort()
      .map(x=>({name:x.slice(p.length+1),type:'file'}));
    const offset=Number(params.get('offset')||0),limit=Math.min(Number(params.get('limit')||200),this.listPage);
    return result(200,{type:'dir',_embedded:{items:items.slice(offset,offset+limit),total:items.length}});
  }
}
async function app(t,disk,saved){
  const errors=[],root=path.join(__dirname,'..'),vc=new VirtualConsole();
  vc.on('jsdomError',e=>{if(e.type==='unhandled-exception')errors.push(e.message);});
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"><\/script>/g,
    (_,file)=>'<script>'+fs.readFileSync(path.join(root,file),'utf8').replaceAll('</script','<\\/script')+'</script>');
  const dom=new JSDOM(html,{url:'https://gradebook.test/',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.Headers=Headers;
    w.fetch=disk.fetch.bind(disk);w.scrollTo=()=>{};w.confirm=()=>true;w.alert=message=>errors.push('alert: '+message);
    w.requestAnimationFrame=()=>0;
    for(const [key,value] of saved?.local||[])w.localStorage.setItem(key,value);
    for(const [key,value] of saved?.session||[])w.sessionStorage.setItem(key,value);
  }});
  t.after(()=>{dom.window.close();assert.deepEqual(errors,[]);});
  await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
  const w=dom.window,run=code=>w.eval(code);
  run("yadisk.accessToken='shared-test-token';");
  return {w,run,plain:code=>JSON.parse(run('JSON.stringify('+code+')')),saved:()=>({local:Object.entries(w.localStorage),session:Object.entries(w.sessionStorage)})};
}
async function openUser(a,name,mode='shared',workspace='общий'){
  const id=await a.w.v14Digest('test:'+name);
  await a.w.v14Activate({id,name,login:name},mode,workspace);
}
async function seedApp(a){a.run(`db=normalizeDB(${JSON.stringify(initial)});saveDB();`);await a.w.v14Sync();}

test('two real app instances exchange simultaneous offline changes through paginated immutable packets',async t=>{
  const disk=new Disk(),a=await app(t,disk),b=await app(t,disk);
  await openUser(a,'Александр');await openUser(b,'Борис');await seedApp(a);await b.w.v14Sync();
  a.run("db.results[0].value='5';saveDB();");b.run("db.results[0].comment='Борис проверил';saveDB();");
  await Promise.all([a.w.v14Sync(),b.w.v14Sync()]);await a.w.v14Sync();await b.w.v14Sync();
  assert.deepEqual(a.plain('db.results'),b.plain('db.results'));
  assert.equal(a.plain('db.results')[0].value,'5');assert.equal(a.plain('db.results')[0].comment,'Борис проверил');
  assert.equal(a.run('v14Replica.conflicts().length'),0);
  assert.ok(!disk.files.has('app:/journal-sync.json'));
});
test('same-cell UI conflict resolution converges after restart and backup merge retains log',async t=>{
  const disk=new Disk(),a=await app(t,disk),b=await app(t,disk);
  await openUser(a,'a');await openUser(b,'b');await seedApp(a);await b.w.v14Sync();
  a.run("db.results[0].value='4';saveDB();");b.run("db.results[0].value='5';saveDB();");
  await Promise.all([a.w.v14Sync(),b.w.v14Sync()]);await a.w.v14Sync();await b.w.v14Sync();
  const reloaded=await app(t,disk,a.saved());
  assert.equal(reloaded.run("v14Replica.conflicts().filter(c=>JSON.parse(c.key)[2]==='value').length"),1);
  assert.equal(reloaded.w.document.getElementById('syncConflictNotice').hidden,false);
  reloaded.w.v14ConflictsModal();
  const choose=[...reloaded.w.document.querySelectorAll('[data-resolve]')].find(btn=>btn.parentElement.querySelector('strong').textContent==='"4"');
  assert.ok(choose);choose.click();await reloaded.w.v14Sync();await b.w.v14Sync();
  assert.equal(b.plain('db.results')[0].value,'4');assert.equal(b.run('v14Replica.conflicts().length'),0);
});
test('lost upload response leaves a durable packet; restart retries once without duplicate edits',async t=>{
  const disk=new Disk(),a=await app(t,disk);await openUser(a,'a');await seedApp(a);
  a.run("db.results[0].value='5';saveDB();");disk.failAfterPut=true;
  await assert.rejects(a.w.v14Sync(),/оборвалось/);
  assert.ok(a.run('v14Envelope().packet'));
  const count=disk.files.size,reloaded=await app(t,disk,a.saved());await reloaded.w.v14Sync();
  assert.equal(disk.files.size,count);assert.equal(reloaded.run('v14Envelope().packet'),null);
  assert.equal(reloaded.plain('db.results')[0].value,'5');
});
test('a local save during upload is retained and sent on the next sync',async t=>{
  const disk=new Disk(),a=await app(t,disk);await openUser(a,'a');await seedApp(a);
  a.run("db.results[0].value='4';saveDB();");
  let release,started;const blocked=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  disk.blockPut=async()=>{started();await gate;};
  const syncing=a.w.v14Sync();await blocked;
  a.run("db.results[0].comment='Во время загрузки';saveDB();");release();
  await assert.rejects(syncing,/изменилась/);disk.blockPut=null;await a.w.v14Sync();
  const b=await app(t,disk);await openUser(b,'b');await b.w.v14Sync();
  assert.equal(b.plain('db.results')[0].value,'4');assert.equal(b.plain('db.results')[0].comment,'Во время загрузки');
});
test('personal namespaces and account switching isolate data while anonymous v13 data stays intact',async t=>{
  const disk=new Disk(),a=await app(t,disk),b=await app(t,disk);
  a.run("db.groups=[{id:'legacy',name:'Старая база',subgroups:[]}];saveDB();");
  await openUser(a,'a','private');await openUser(b,'b','private');await seedApp(a);await b.w.v14Sync();
  assert.equal(b.plain('db.groups').length,0);a.w.v14Logout();assert.equal(a.plain('db.groups')[0].id,'legacy');
  await openUser(a,'a','private');assert.equal(a.plain('db.results')[0].value,'3');
});
test('accounts register on disk; passwords are verified online and offline without storing plaintext',async t=>{
  const disk=new Disk(),a=await app(t,disk),b=await app(t,disk);
  const user=await a.w.v14Authenticate('Teacher','a-good-password',true,'Преподаватель');
  assert.equal(user.login,'teacher');
  const logged=await b.w.v14Authenticate('TEACHER','a-good-password');assert.equal(logged.id,user.id);
  await assert.rejects(b.w.v14Authenticate('teacher','wrong'),/пароль/);
  await assert.rejects(b.w.v14Authenticate('teacher','another-password',true,'Другой'),/занят/);
  const offline=await b.w.v14Authenticate('teacher','a-good-password',false,'',true);assert.equal(offline.id,user.id);
  assert.ok(!JSON.stringify([...disk.files]).includes('a-good-password'));
  assert.ok(!JSON.stringify(b.saved()).includes('a-good-password'));
});
test('malformed cloud packet aborts merge and leaves the local journal and pending edits intact',async t=>{
  const disk=new Disk(),a=await app(t,disk);await openUser(a,'a');await seedApp(a);
  const before=a.plain('db'),folder='app:/gradebook-v14/workspaces/'+a.run('v14Session.workspace');
  disk.files.set(folder+'/packet_deadbeef.json',{schema:'unexpected',events:[]});
  await assert.rejects(a.w.v14Sync(),/Несовместимый/);assert.deepEqual(a.plain('db'),before);
});
test('two tabs with the same local profile merge saved edits without overwriting each other',async t=>{
  const disk=new Disk(),a=await app(t,disk);await openUser(a,'same');await seedApp(a);
  const b=await app(t,disk,a.saved());
  a.run("db.results[0].value='5';saveDB();");
  // Browser localStorage is shared; copy its current value while keeping B's old view/draft.
  const key=a.run('v14Key()');b.w.localStorage.setItem(key,a.w.localStorage.getItem(key));
  b.run("db.results[0].comment='Вторая вкладка';saveDB();");
  a.w.localStorage.setItem(key,b.w.localStorage.getItem(key));await a.w.v14Sync();
  assert.equal(a.plain('db.results')[0].value,'5');assert.equal(a.plain('db.results')[0].comment,'Вторая вкладка');
  assert.equal(a.run('v14Replica.conflicts().length'),0);
});
test('backup merges retain unresolved variants and never acknowledge unsent operations',async t=>{
  const disk=new Disk(),a=await app(t,disk),b=await app(t,disk);await openUser(a,'a');await openUser(b,'b');
  await seedApp(a);await b.w.v14Sync();
  a.run("db.results[0].value='4';saveDB();");b.run("db.results[0].value='5';saveDB();");
  await a.w.v14Sync();await b.w.v14Sync();await a.w.v14Sync();
  const backup=a.plain('({...db,syncV14:{workspace:v14Session.workspace,events:v14Replica.list()}})');
  const c=await app(t,disk);await openUser(c,'c');
  await c.w.importDB({text:async()=>JSON.stringify(backup)});
  assert.equal(c.run("v14Replica.conflicts().filter(c=>JSON.parse(c.key)[2]==='value').length"),1);
  assert.ok(c.run('v14Replica.list().length>v14Envelope().ack.length'));
  await c.w.v14Sync();assert.equal(c.run("v14Replica.conflicts().filter(c=>JSON.parse(c.key)[2]==='value').length"),1);
});
test('simultaneous registration of one login yields exactly one successful identity',async t=>{
  const disk=new Disk(),a=await app(t,disk),b=await app(t,disk);
  const outcomes=await Promise.allSettled([
    a.w.v14Authenticate('teacher','password-A',true,'А'),
    b.w.v14Authenticate('teacher','password-B',true,'Б')
  ]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const winner=outcomes.find(x=>x.status==='fulfilled').value;
  assert.equal([...disk.files.values()].filter(x=>x.login==='teacher').length,1);
  assert.equal([...disk.files.values()].find(x=>x.login==='teacher').passwordHash,winner.passwordHash);
});
