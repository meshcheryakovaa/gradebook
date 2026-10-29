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
      window.scrollTo=()=>{};window.confirm=()=>true;
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

test('dossier saves description, tags and live grade changes together and survives reload',async t=>{
  const app=await openApp(t);seed(app);
  app.run("state.lessonFilter='lecture';renderJournal();");
  app.click('[data-open-student="a"]');
  assert.equal(app.d.getElementById('studentDescriptionInput').value,'Старая заметка');
  assert.equal(app.d.getElementById('studentAverageValue').textContent,'3,00');
  app.input('#studentDescriptionInput','Описание\nВторая строка');
  app.input('#studentTagsInput',' Проект ; проект, Олимпиада\n <img src=x onerror=alert(1)>');
  assert.equal(app.d.querySelectorAll('.student-tag').length,3);
  assert.equal(app.d.querySelector('#studentTagsPreview img'),null);
  app.click('[data-remove-tag="2"]');
  app.input('[data-student-lesson="l"].student-grade-input','5');
  assert.equal(app.d.getElementById('studentAverageValue').textContent,'4,50');
  assert.equal(app.run('currentStudent().note'),'Старая заметка');
  // A save must schedule auto-sync after the dirty state is cleared.
  app.run("yadisk.autoSync=true;yadisk.accessToken='test-token';");
  app.click('#saveStudentResultsBtn');
  assert.equal(app.run('state.dirty'),false);
  assert.ok(app.run('yandexAutoTimer'));
  const saved=app.w.localStorage.getItem('edu_journal_db_v1');
  const data=JSON.parse(saved);
  assert.equal(data.students[0].note,'Описание\nВторая строка');
  assert.deepEqual(data.students[0].tags,['Проект','Олимпиада']);
  assert.equal(data.results.find(r=>r.studentId==='a'&&r.lessonId==='l').value,'5');
  const reloaded=await openApp(t,saved);reloaded.click('[data-open-student="a"]');
  assert.equal(reloaded.d.getElementById('studentAverageValue').textContent,'4,50');
  assert.equal(reloaded.d.getElementById('studentDescriptionInput').value,'Описание\nВторая строка');
  assert.equal(reloaded.d.querySelectorAll('.student-tag').length,2);
});

test('unsaved profile edits are protected and profiles without lessons can be saved',async t=>{
  const app=await openApp(t);seed(app);app.click('[data-open-student="a"]');
  app.input('#studentDescriptionInput','Не сохранять');app.input('#studentTagsInput','Черновик');
  app.w.confirm=()=>false;app.click('#nextStudentBtn');
  assert.equal(app.run('state.studentId'),'a');
  assert.equal(app.d.getElementById('studentDescriptionInput').value,'Не сохранять');
  app.w.confirm=()=>true;app.click('#nextStudentBtn');app.click('#previousStudentBtn');
  assert.equal(app.d.getElementById('studentDescriptionInput').value,'Старая заметка');
  assert.equal(app.d.getElementById('studentTagsInput').value,'');
  app.click('#backFromStudentBtn');app.run("state.groupId='h';renderMain();openStudent('c');");
  assert.equal(app.d.getElementById('studentAverageValue').textContent,'—');
  app.input('#studentDescriptionInput','Только описание');app.input('#studentTagsInput','Новый');
  app.click('#saveStudentResultsBtn');
  assert.equal(app.run('currentStudent().note'),'Только описание');
  assert.equal(app.run('JSON.stringify(currentStudent().tags)'),'["Новый"]');
  // The settings editor reads and updates the same description and tags.
  app.click('#backFromStudentBtn');app.run("studentEditModal('c');");
  assert.equal(app.d.getElementById('studentNoteModal').value,'Только описание');
  app.d.getElementById('studentTagsModal').value='Другой';app.click('#saveStudentModal');
  app.run("closeModal();openStudent('c');");
  assert.equal(app.d.getElementById('studentTagsInput').value,'Другой');
});

test('JSON import and cloud snapshots preserve profile fields',async t=>{
  const app=await openApp(t);seed(app);app.click('[data-open-student="a"]');
  app.input('#studentDescriptionInput','Для экспорта');app.input('#studentTagsInput','Тег');app.click('#saveStudentResultsBtn');
  const json=app.run('JSON.stringify(db)');
  app.run('db.students=[];');
  await app.w.importDB({text:async()=>json});
  app.run("openStudent('a');");
  assert.equal(app.d.getElementById('studentDescriptionInput').value,'Для экспорта');
  const snapshot=app.run('cloudPayload()');
  app.run('closeEditingPages();db.students=[];');app.w.applyCloudSnapshot(snapshot);
  app.run("openStudent('a');");
  assert.equal(app.d.getElementById('studentTagsInput').value,'Тег');
  assert.equal(app.d.getElementById('studentDescriptionInput').value,'Для экспорта');
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

test('Н counts as 2 in journal and dossier averages while keeping its own frame',async t=>{
  const app=await openApp(t);seed(app);
  app.run("state.lessonFilter='all';renderJournal();");
  const row=[...app.d.querySelectorAll('.journal-table tbody tr')].find(tr=>tr.querySelector('[data-open-student="b"]'));
  assert.equal(row.querySelector('.average-cell').textContent,'2,00');
  app.click('[data-open-student="b"]');
  assert.equal(app.d.getElementById('studentAverageValue').textContent,'2,00');
  app.input('[data-student-lesson="q"].student-grade-input','5');
  assert.equal(app.d.getElementById('studentAverageValue').textContent,'3,50');
  assert.equal(app.run("resultMarkKind('Н')"),'absent');
});
