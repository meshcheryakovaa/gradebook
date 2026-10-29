const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'..');

async function openApp(t,saved){
  const errors=[];
  const console=new VirtualConsole();
  console.on('jsdomError',error=>{if(error.type==='unhandled-exception')errors.push(error.message);});
  // Keep separate script tags, as in the app, and load their exact source without network access.
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"><\/script>/g,
    (_,file)=>'<script>'+fs.readFileSync(path.join(root,file),'utf8').replaceAll('</script','<\\/script')+'</script>');
  const dom=new JSDOM(html,{
    url:'https://gradebook.test/',runScripts:'dangerously',virtualConsole:console,
    beforeParse(window){
      window.scrollTo=()=>{};window.confirm=()=>true;window.requestAnimationFrame=()=>0;
      if(saved)window.localStorage.setItem('edu_journal_db_v1',saved);
    }
  });
  t.after(()=>{dom.window.close();assert.deepEqual(errors,[]);});
  await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
  const w=dom.window,d=w.document;
  return {w,d,run:code=>w.eval(code),click:selector=>d.querySelector(selector).click(),
    input(selector,value){const el=d.querySelector(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}

function seed(app){
  app.run(`db=normalizeDB({
    groups:[{id:'g',name:'Группа',subgroups:[{id:'a',name:'1'},{id:'b',name:'2'}]},{id:'h',name:'Без занятий'}],
    students:[{id:'a',name:'Абрамов',groupId:'g',subgroupId:'a',note:'Старая заметка'},
      {id:'b',name:'Белов',groupId:'g',subgroupId:'b'},{id:'c',name:'Петров',groupId:'h'}],
    lessons:[{id:'l',date:'2026-10-01',typeId:'lecture',targets:[{groupId:'g'}]},
      {id:'p',date:'2026-10-02',typeId:'practice',targets:[{groupId:'g',subgroupId:'a'}]},
      {id:'q',date:'2026-10-03',typeId:'practice',targets:[{groupId:'g',subgroupId:'b'}]}],
    results:[{studentId:'a',lessonId:'l',value:'2',comment:'Проверить'},
      {studentId:'a',lessonId:'p',value:'4'},{studentId:'a',lessonId:'q',value:'5'},
      {studentId:'b',lessonId:'l',value:'Н'},{studentId:'b',lessonId:'q',value:'Н/А'}]
  });state.groupId='g';saveDB(false);renderMain();`);
}

function key(app,el,keyName,shiftKey=false){
  el.dispatchEvent(new app.w.KeyboardEvent('keydown',{key:keyName,shiftKey,bubbles:true,cancelable:true}));
}
function dblclick(app,el){el.dispatchEvent(new app.w.MouseEvent('dblclick',{bubbles:true,cancelable:true}));}
function cell(app,sid,lid){return app.d.querySelector(`#journalView td[data-sid="${sid}"][data-lid="${lid}"]`);}
function storedResult(app,sid,lid){
  return JSON.parse(app.w.localStorage.getItem('edu_journal_db_v1')).results.find(r=>r.studentId===sid&&r.lessonId===lid);
}

test('student card has no mini-dossier and saves grades and comments that survive reload',async t=>{
  const app=await openApp(t);seed(app);
  app.click('[data-open-student="a"]');
  for(const id of ['studentDescriptionInput','studentTagsInput','studentAverageValue'])assert.equal(app.d.getElementById(id),null,id);
  assert.equal(app.d.querySelector('.student-dossier'),null);
  app.input('[data-student-lesson="l"].student-grade-input','5');
  app.input('[data-student-lesson="l"].student-comment-input','Исправил');
  app.run("yadisk.autoSync=true;yadisk.accessToken='test-token';");
  app.click('#saveStudentResultsBtn');
  assert.equal(app.run('state.dirty'),false);
  assert.ok(app.run('yandexAutoTimer'));
  assert.equal(storedResult(app,'a','l').value,'5');
  assert.equal(storedResult(app,'a','l').comment,'Исправил');
  const reloaded=await openApp(t,app.w.localStorage.getItem('edu_journal_db_v1'));
  reloaded.click('[data-open-student="a"]');
  assert.equal(reloaded.d.querySelector('[data-student-lesson="l"].student-grade-input').value,'5');
  assert.equal(reloaded.run("currentStudent().note"),'Старая заметка');
});

test('unsaved grade edits in the student card are protected',async t=>{
  const app=await openApp(t);seed(app);app.click('[data-open-student="a"]');
  app.input('[data-student-lesson="p"].student-grade-input','3');
  app.w.confirm=()=>false;app.click('#nextStudentBtn');
  assert.equal(app.run('state.studentId'),'a');
  assert.equal(app.d.querySelector('[data-student-lesson="p"].student-grade-input').value,'3');
  app.w.confirm=()=>true;app.click('#nextStudentBtn');app.click('#previousStudentBtn');
  assert.equal(app.d.querySelector('[data-student-lesson="p"].student-grade-input').value,'4');
});

test('settings editor keeps a plain note without tags, and note survives import and cloud snapshots',async t=>{
  const app=await openApp(t);seed(app);
  app.run("studentEditModal('a');");
  assert.equal(app.d.getElementById('studentTagsModal'),null);
  assert.equal(app.d.getElementById('studentNoteModal').value,'Старая заметка');
  app.d.getElementById('studentNoteModal').value='Для экспорта';app.click('#saveStudentModal');
  app.run('closeModal();');
  const json=app.run('JSON.stringify(db)');
  app.run('db.students=[];');
  await app.w.importDB({text:async()=>json});
  assert.equal(app.run("db.students.find(s=>s.id==='a').note"),'Для экспорта');
  const snapshot=app.run('cloudPayload()');
  app.run('db.students=[];');app.w.applyCloudSnapshot(snapshot);
  assert.equal(app.run("db.students.find(s=>s.id==='a').note"),'Для экспорта');
});

test('old databases with tags still load and keep their data untouched',async t=>{
  const app=await openApp(t);
  app.run(`db=normalizeDB({groups:[{id:'g'}],students:[{id:'a',groupId:'g',name:'А',note:'Заметка',tags:['Проект']}]});`);
  assert.equal(app.run('db.students[0].note'),'Заметка');
  assert.equal(app.run('JSON.stringify(db.students[0].tags)'),'["Проект"]');
});

test('journal frames coexist with comments, filtering and print without marking other subgroups',async t=>{
  const app=await openApp(t);seed(app);
  app.run('db.settings.showComments=true;renderJournal();');
  const row=app.d.querySelector('#journalView tbody tr');
  assert.ok(row.querySelector('td.result-mark-fail.has-comment'));
  assert.equal(row.querySelectorAll('.result-marked').length,1);
  assert.equal(app.d.querySelectorAll('#journalView .result-mark-absent.result-cell').length,1);
  assert.equal(app.d.querySelectorAll('#journalView .result-mark-unattested.result-cell').length,1);
  app.run("db.results.find(r=>r.studentId==='a'&&r.lessonId==='p').value='зач';state.lessonFilter='practice';renderJournal();");
  assert.equal(app.d.querySelectorAll('#journalView td.result-mark-text').length,1);
  app.run('prepareJournalPrint();');
  assert.equal(app.d.querySelectorAll('#printJournal td.result-mark-text').length,1);
  assert.equal(app.d.querySelectorAll('#printJournal td.result-mark-unattested').length,1);
  assert.ok(app.d.querySelector('#printJournal .result-mark-legend'));
});

test('Н counts as 2 in the journal average while keeping its own frame',async t=>{
  const app=await openApp(t);seed(app);
  app.run("state.lessonFilter='all';renderJournal();");
  const row=cell(app,'b','l').parentElement;
  assert.equal(row.querySelector('.average-cell').textContent,'2,00');
  assert.equal(app.run("resultMarkKind('Н')"),'absent');
});

test('double click edits a grade in the journal, Enter saves and moves down, average updates',async t=>{
  const app=await openApp(t);seed(app);
  app.run("state.lessonFilter='all';renderJournal();");
  dblclick(app,cell(app,'a','l'));
  const input=cell(app,'a','l').querySelector('input.journal-cell-input');
  assert.ok(input);assert.equal(input.value,'2');assert.equal(app.d.activeElement,input);
  input.value='5';key(app,input,'Enter');
  assert.equal(storedResult(app,'a','l').value,'5');
  assert.equal(storedResult(app,'a','l').comment,'Проверить');
  assert.ok(cell(app,'a','l').classList.contains('result-mark-fail')===false);
  assert.equal(cell(app,'a','l').parentElement.querySelector('.average-cell').textContent,'4,50');
  const below=cell(app,'b','l').querySelector('input.journal-cell-input');
  assert.ok(below,'editing moved to the next student');assert.equal(below.value,'Н');
  key(app,below,'Escape');
  assert.equal(cell(app,'b','l').querySelector('input'),null);
  assert.equal(storedResult(app,'b','l').value,'Н');
});

test('Tab moves right skipping other subgroups, blur saves, points set stars and empty values clear results',async t=>{
  const app=await openApp(t);seed(app);
  app.run("state.lessonFilter='all';renderJournal();");
  dblclick(app,cell(app,'a','l'));
  key(app,cell(app,'a','l').querySelector('input'),'Tab');
  const right=cell(app,'a','p').querySelector('input');
  assert.ok(right);
  right.value='5 баллов';right.dispatchEvent(new app.w.FocusEvent('blur'));
  assert.equal(storedResult(app,'a','p').value,'5 баллов');
  assert.equal(storedResult(app,'a','p').stars,5);
  assert.equal(cell(app,'a','p').textContent.trim(),'5');
  dblclick(app,cell(app,'a','p'));
  const again=cell(app,'a','p').querySelector('input');
  assert.equal(again.value,'5 баллов');
  again.value='  ';key(app,again,'Enter');
  assert.equal(storedResult(app,'a','p'),undefined);
  dblclick(app,cell(app,'a','l'));
  const withComment=cell(app,'a','l').querySelector('input');
  withComment.value='';key(app,withComment,'Enter');
  assert.equal(storedResult(app,'a','l').value,'');
  assert.equal(storedResult(app,'a','l').comment,'Проверить');
});

test('double click with comments enabled edits instead of leaving the comment popover open',async t=>{
  const app=await openApp(t);seed(app);
  app.run('db.settings.showComments=true;renderJournal();');
  const popover=app.d.getElementById('commentPopover');
  cell(app,'a','l').click();
  assert.ok(popover.classList.contains('show'));
  dblclick(app,cell(app,'a','l'));
  assert.equal(popover.classList.contains('show'),false);
  const input=cell(app,'a','l').querySelector('input');
  assert.ok(input);
  input.click();
  assert.equal(popover.classList.contains('show'),false);
  key(app,input,'Escape');
});
