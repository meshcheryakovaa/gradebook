const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function journal(){
  const context=vm.createContext({localStorage:{getItem:()=>null}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/part-01.js'),'utf8'),context);
  return code=>vm.runInContext(code,context);
}

test('averages count Н as 2, ignore other text and respect lesson membership and selection',()=>{
  const run=journal();
  run(`
    db.groups=[{id:'g',subgroups:[{id:'a'},{id:'b'}]}];
    db.students=[{id:'s',groupId:'g',subgroupId:'a',name:'Иванов'}];
    db.lessons=Array.from({length:7},(_,i)=>({id:String(i),targets:[{groupId:'g',subgroupId:i===6?'b':null}]}));
    db.results=['5','3','н','зач','5 баллов','', '2'].map((value,i)=>({studentId:'s',lessonId:String(i),value}));
  `);
  assert.equal(run('studentAverage(db.students[0],db.lessons)'),10/3);
  assert.equal(run('studentAverage(db.students[0],db.lessons.slice(0,1))'),5);
  assert.equal(run('studentAverage(db.students[0],db.lessons.slice(2))'),2);
  assert.equal(run('studentAverage(db.students[0],db.lessons.slice(3))'),null);
  assert.equal(run('studentAverage(db.students[0],[])'),null);
});

test('statistics exclude ungraded students and compare unrounded means',()=>{
  const run=journal();
  const stats=JSON.parse(run('JSON.stringify(performanceStatistics([5,4,3.99,3,2.99,2,null]))'));
  assert.deepEqual(stats,{total:7,graded:6,absolute:4,quality:2});
  assert.deepEqual(JSON.parse(run('JSON.stringify(performanceStatistics([null,null]))')),
    {total:2,graded:0,absolute:0,quality:0});
});

test('decimal grades are accepted without treating statuses or points as grades',()=>{
  const run=journal();
  for(const value of ['4,5','4.5',' 4,50 '])assert.equal(run(`numericGrade(${JSON.stringify(value)})`),4.5);
  for(const value of ['',null,'н','б','зач','4 балла','45','1','5.1','4/5','4abc']){
    assert.equal(run(`numericGrade(${JSON.stringify(value)})`),null);
  }
  for(const value of ['н','Н',' Н '])assert.equal(run(`averageGrade(${JSON.stringify(value)})`),2);
  for(const value of ['н/а','Н / А','нб','б','зач','5 баллов',''])assert.equal(run(`averageGrade(${JSON.stringify(value)})`),null);
  assert.equal(run("averageGrade('4,5')"),4.5);
  assert.equal(run('formatAverage(null)'),'—');
  assert.equal(run('formatAverage(4.5)'),'4,50');
});

test('Russian alphabetical order ignores legacy order, case and extra whitespace',()=>{
  const run=journal();
  run(`db.students=[
    {id:'z',groupId:'g',name:'Яковлев',order:0},
    {id:'b',groupId:'g',name:'Белов',order:1},
    {id:'a',groupId:'g',name:'  абрамов   Иван',order:99},
    {id:'other',groupId:'other',name:'Агеев'}
  ];`);
  assert.equal(run("studentsOf('g').map(s=>s.id).join(',')"),'a,b,z');
  assert.equal(run("db.students.map(s=>s.id).join(',')"),'z,b,a,other');
});

test('grade frames distinguish failures and text without marking point scores',()=>{
  const run=journal();
  const cases={'2':'fail',' 2,0 ':'fail','н':'absent',' Н ':'absent','Н / а':'unattested',
    'зач':'text','Б':'text','незач':'text','N/A':'text','':'','4':'','4,5':'','2 балла':'','5 баллов':''};
  for(const [value,expected] of Object.entries(cases))assert.equal(run(`resultMarkKind(${JSON.stringify(value)})`),expected,value);
});

test('old student notes survive migration',()=>{
  const run=journal();
  run(`db=normalizeDB({groups:[{id:'g'}],students:[{id:'a',groupId:'g',note:'Старая заметка'},{id:'b',groupId:'g'}]});`);
  assert.equal(run('db.students[0].note'),'Старая заметка');
  assert.equal(run('db.students[1].note'),'');
});
