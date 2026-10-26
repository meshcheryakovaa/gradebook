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

test('averages use numeric grades only and respect lesson membership and selection',()=>{
  const run=journal();
  run(`
    db.groups=[{id:'g',subgroups:[{id:'a'},{id:'b'}]}];
    db.students=[{id:'s',groupId:'g',subgroupId:'a',name:'Иванов'}];
    db.lessons=Array.from({length:7},(_,i)=>({id:String(i),targets:[{groupId:'g',subgroupId:i===6?'b':null}]}));
    db.results=['5','3','н','зач','5 баллов','', '2'].map((value,i)=>({studentId:'s',lessonId:String(i),value}));
  `);
  assert.equal(run('studentAverage(db.students[0],db.lessons)'),4);
  assert.equal(run('studentAverage(db.students[0],db.lessons.slice(0,1))'),5);
  assert.equal(run('studentAverage(db.students[0],db.lessons.slice(2))'),null);
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
