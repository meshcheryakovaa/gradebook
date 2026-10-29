const DB_KEY='edu_journal_db_v1';
const THEME_KEY='edu_journal_theme_v1';
const YADISK_KEY='edu_journal_yadisk_v1';
const YADISK_PATH='app:/journal-sync.json';
const YADISK_VERSIONS_PATH='app:/journal-versions';

const defaultDB={
  version:1,
  meta:{updatedAt:0},
  settings:{subject:'',year:'2026/2027',showComments:false,theme:null},
  groups:[],
  students:[],
  lessonTypes:[
    {id:'lecture',name:'Лекция',prefix:'Л',color:'#2f9a57',order:1},
    {id:'practice',name:'Практическое занятие',prefix:'ПР',color:'#347fd1',order:2},
    {id:'lab',name:'Лабораторная работа',prefix:'ЛР',color:'#8a55d1',order:3}
  ],
  lessons:[],
  results:[],
  layouts:[]
};

let db=loadDB();

function calendarDateKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

let state={
  groupId:db.groups[0]?.id||null,
  lessonId:null,
  studentId:null,
  studentReturnLessonId:null,
  studentDraftResults:null,
  studentDraftComments:null,
  studentOriginalResults:null,
  lessonFilter:'all',
  lessonDraft:null,
  lessonView:'table',
  matrixMode:'arrange',
  matrixScoringActive:false,
  layoutDraft:null,
  layoutTouched:false,
  draftResults:null,
  draftComments:null,
  draftStars:null,
  dirty:false,
  settingsTab:'groups',
  mainView:'journal',
  calendarMode:'month',
  calendarDate:calendarDateKey(new Date()),
  calendarGroup:'all',
  calendarType:'all'
};

let yandexAutoTimer=null;
let yandexSyncBusy=false;

function loadYandexConfig(){
  try{
    const raw=localStorage.getItem(YADISK_KEY);
    if(!raw)return {
      clientId:'',
      accessToken:'',
      refreshToken:'',
      expiresAt:0,
      autoSync:false,
      lastSyncAt:0,
      pkceVerifier:'',
      pkceMethod:''
    };
    return {
      clientId:'',
      accessToken:'',
      refreshToken:'',
      expiresAt:0,
      autoSync:false,
      lastSyncAt:0,
      pkceVerifier:'',
      pkceMethod:'',
      ...JSON.parse(raw)
    };
  }catch(e){
    return {
      clientId:'',
      accessToken:'',
      refreshToken:'',
      expiresAt:0,
      autoSync:false,
      lastSyncAt:0,
      pkceVerifier:'',
      pkceMethod:''
    };
  }
}
let yadisk=loadYandexConfig();

function saveYandexConfig(){
  localStorage.setItem(YADISK_KEY,JSON.stringify(yadisk));
}

function uid(prefix='id'){
  return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
}
function clone(v){return JSON.parse(JSON.stringify(v))}
function esc(s=''){
  return String(s).replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
}
function loadDB(){
  try{
    const raw=localStorage.getItem(DB_KEY);
    if(!raw) return clone(defaultDB);
    return normalizeDB(JSON.parse(raw));
  }catch(e){
    return clone(defaultDB);
  }
}
function defaultTypePrefix(name='',id=''){
  const n=String(name).toLowerCase();
  if(id==='lecture'||n.includes('лекц'))return 'Л';
  if(id==='practice'||n.includes('практ'))return 'ПР';
  if(id==='lab'||n.includes('лаборат'))return 'ЛР';
  if(n.includes('аттест'))return 'А';
  return String(name).trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,4)||'З';
}
function normalizeDB(d){
  const out=clone(defaultDB);
  out.version=1;
  out.meta={...out.meta,...(d.meta||{})};
  out.settings={...out.settings,...(d.settings||{})};

  out.groups=Array.isArray(d.groups)?d.groups:[];
  out.groups.forEach(g=>{
    g.subgroups=Array.isArray(g.subgroups)?g.subgroups:[];
    g.subgroups=g.subgroups
      .filter(s=>s&&s.id&&s.name)
      .map((s,i)=>({
        id:String(s.id),
        name:String(s.name),
        order:Number.isFinite(Number(s.order))?Number(s.order):i+1
      }));
  });

  out.students=Array.isArray(d.students)?d.students:[];
  out.students.forEach(s=>{
    s.note=String(s.note??'');
    const group=out.groups.find(g=>g.id===s.groupId);
    if(!group||!group.subgroups.some(x=>x.id===s.subgroupId)){
      s.subgroupId=null;
    }
  });

  out.lessonTypes=Array.isArray(d.lessonTypes)&&d.lessonTypes.length
    ? d.lessonTypes
    : clone(defaultDB.lessonTypes);

  out.lessonTypes=out.lessonTypes
    .filter(t=>t&&t.id&&t.name)
    .map((t,i)=>({
      id:String(t.id),
      name:String(t.name),
      prefix:String(t.prefix ?? defaultTypePrefix(t.name,t.id)).trim().slice(0,12),
      color:/^#[0-9a-f]{6}$/i.test(String(t.color||''))?String(t.color):'#68727d',
      order:Number.isFinite(Number(t.order))?Number(t.order):i+1
    }))
    .sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ru'));

  out.lessons=Array.isArray(d.lessons)?d.lessons:[];

  const ensureLegacyType=(name)=>{
    const n=String(name||'').trim()||'Занятие';
    let found=out.lessonTypes.find(t=>t.name.toLowerCase()===n.toLowerCase());
    if(found)return found;

    const low=n.toLowerCase();
    if(low.includes('лаб'))found=out.lessonTypes.find(t=>t.id==='lab');
    else if(low.includes('практ'))found=out.lessonTypes.find(t=>t.id==='practice');
    else if(low.includes('лекц'))found=out.lessonTypes.find(t=>t.id==='lecture');
    if(found)return found;

    const colors=['#d97706','#dc2626','#0891b2','#4f46e5','#be185d','#65a30d'];
    const type={
      id:'type_'+Math.random().toString(36).slice(2,9),
      name:n,
      prefix:defaultTypePrefix(n),
      color:colors[out.lessonTypes.length%colors.length],
      order:out.lessonTypes.length+1
    };
    out.lessonTypes.push(type);
    return type;
  };

  out.lessons.forEach(l=>{
    if(!Array.isArray(l.targets)||!l.targets.length){
      const ids=Array.isArray(l.groupIds)&&l.groupIds.length
        ? l.groupIds
        : (l.groupId?[l.groupId]:[]);
      l.targets=ids.map(groupId=>({groupId,subgroupId:null}));
    }

    const normalized=[];
    l.targets.forEach(t=>{
      const group=out.groups.find(g=>g.id===t?.groupId);
      if(!group)return;
      const subgroupId=group.subgroups.some(s=>s.id===t.subgroupId)?t.subgroupId:null;
      const key=`${group.id}|${subgroupId||''}`;
      if(!normalized.some(x=>`${x.groupId}|${x.subgroupId||''}`===key)){
        normalized.push({groupId:group.id,subgroupId});
      }
    });

    const wholeGroups=new Set(normalized.filter(t=>!t.subgroupId).map(t=>t.groupId));
    l.targets=normalized.filter(t=>!t.subgroupId||!wholeGroups.has(t.groupId));

    l.groupIds=[...new Set(l.targets.map(t=>t.groupId))];
    if(!l.groupIds.length&&l.groupId&&out.groups.some(g=>g.id===l.groupId)){
      l.targets=[{groupId:l.groupId,subgroupId:null}];
      l.groupIds=[l.groupId];
    }
    if(!l.groupId||!l.groupIds.includes(l.groupId))l.groupId=l.groupIds[0]||null;

    let type=out.lessonTypes.find(t=>t.id===l.typeId);
    if(!type)type=ensureLegacyType(l.type);
    l.typeId=type.id;
    l.type=type.name;
  });

  out.lessonTypes=out.lessonTypes
    .sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ru'))
    .map((t,i)=>({...t,order:i+1}));

  out.results=Array.isArray(d.results)?d.results:[];
  out.layouts=Array.isArray(d.layouts)?d.layouts:[];
  return out;
}
function saveDB(touch=true){
  if(touch){
    db.meta=db.meta||{};
    db.meta.updatedAt=Date.now();
  }
  localStorage.setItem(DB_KEY,JSON.stringify(db));
  if(touch)scheduleYandexAutoPush();
}
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),1900);
}
function currentGroup(){
  return db.groups.find(g=>g.id===state.groupId)||null;
}
function currentLesson(){
  return db.lessons.find(l=>l.id===state.lessonId)||null;
}
function compareStudentNames(a,b){
  const name=s=>String(s.name||'').trim().replace(/\s+/g,' ');
  return name(a).localeCompare(name(b),'ru',{sensitivity:'base',numeric:true});
}
function studentsOf(gid){
  return db.students
    .filter(s=>s.groupId===gid)
    .sort(compareStudentNames);
}
function numericGrade(value){
  const text=String(value??'').trim();
  if(!/^[2-5](?:[.,]\d+)?$/.test(text))return null;
  const grade=Number(text.replace(',','.'));
  return grade>=2&&grade<=5?grade:null;
}
function averageGrade(value){
  if(String(value??'').trim().toLocaleLowerCase('ru')==='н')return 2;
  return numericGrade(value);
}
function resultMarkKind(value){
  const text=String(value??'').trim();
  if(!text)return '';
  if(numericGrade(text)===2)return 'fail';
  const compact=text.toLocaleLowerCase('ru').replace(/\s+/g,'');
  if(compact==='н')return 'absent';
  if(compact==='н/а')return 'unattested';
  if(/^\d+\s+бал(?:л|ла|лов)?$/iu.test(text)||/^[+-]?\d+(?:[.,]\d+)?$/.test(text))return '';
  return 'text';
}
function studentAverage(student,lessons){
  const grades=lessons.filter(l=>studentIncludedInLesson(student,l))
    .map(l=>averageGrade(resultFor(student.id,l.id)?.value))
    .filter(grade=>grade!==null);
  return grades.length?grades.reduce((sum,grade)=>sum+grade,0)/grades.length:null;
}
function performanceStatistics(averages){
  const graded=averages.filter(average=>average!==null);
  return {
    total:averages.length,
    graded:graded.length,
    absolute:graded.filter(average=>average>=3).length,
    quality:graded.filter(average=>average>=4).length
  };
}
function formatAverage(average){
  return average===null?'—':average.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function subgroupsOf(groupId){
  const g=db.groups.find(x=>x.id===groupId);
  return (g?.subgroups||[])
    .slice()
    .sort((a,b)=>(a.order??999)-(b.order??999)||a.name.localeCompare(b.name,'ru'));
}
function subgroupById(groupId,subgroupId){
  return subgroupsOf(groupId).find(s=>s.id===subgroupId)||null;
}
function subgroupName(groupId,subgroupId){
  return subgroupById(groupId,subgroupId)?.name||'';
}
function lessonTargets(lesson){
  if(!lesson)return [];
  if(Array.isArray(lesson.targets)&&lesson.targets.length)return lesson.targets;
  const ids=Array.isArray(lesson.groupIds)&&lesson.groupIds.length
    ? lesson.groupIds
    : (lesson.groupId?[lesson.groupId]:[]);
  return ids.map(groupId=>({groupId,subgroupId:null}));
}
function normalizeTargets(targets){
  const clean=[];
  (targets||[]).forEach(t=>{
    const g=db.groups.find(x=>x.id===t.groupId);
    if(!g)return;
    const subgroupId=g.subgroups?.some(s=>s.id===t.subgroupId)?t.subgroupId:null;
    const key=`${g.id}|${subgroupId||''}`;
    if(!clean.some(x=>`${x.groupId}|${x.subgroupId||''}`===key)){
      clean.push({groupId:g.id,subgroupId});
    }
  });
  const whole=new Set(clean.filter(t=>!t.subgroupId).map(t=>t.groupId));
  return clean.filter(t=>!t.subgroupId||!whole.has(t.groupId));
}
function lessonGroupIds(lesson){
  return [...new Set(lessonTargets(lesson).map(t=>t.groupId))]
    .filter(id=>db.groups.some(g=>g.id===id));
}
function lessonGroupObjects(lesson){
  return lessonGroupIds(lesson)
    .map(id=>db.groups.find(g=>g.id===id))
    .filter(Boolean)
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function targetLabel(target){
  const group=db.groups.find(g=>g.id===target.groupId);
  if(!group)return '';
  const sub=target.subgroupId?subgroupById(group.id,target.subgroupId):null;
  return sub?`${group.name} — ${sub.name}`:group.name;
}
function lessonGroupNames(lesson){
  return lessonTargets(lesson)
    .slice()
    .sort((a,b)=>targetLabel(a).localeCompare(targetLabel(b),'ru'))
    .map(targetLabel)
    .filter(Boolean)
    .join(' + ');
}
function studentIncludedInLesson(student,lesson){
  return lessonTargets(lesson).some(t=>
    t.groupId===student.groupId &&
    (!t.subgroupId||t.subgroupId===student.subgroupId)
  );
}
function studentGroupsForLesson(lesson){
  return lessonTargets(lesson)
    .slice()
    .sort((a,b)=>{
      const ga=db.groups.find(g=>g.id===a.groupId)?.name||'';
      const gb=db.groups.find(g=>g.id===b.groupId)?.name||'';
      const gc=ga.localeCompare(gb,'ru');
      if(gc)return gc;
      return (subgroupName(a.groupId,a.subgroupId)||'').localeCompare(
        subgroupName(b.groupId,b.subgroupId)||'','ru'
      );
    })
    .map(target=>{
      const group=db.groups.find(g=>g.id===target.groupId);
      const subgroup=target.subgroupId?subgroupById(target.groupId,target.subgroupId):null;
      const students=studentsOf(target.groupId)
        .filter(s=>!target.subgroupId||s.subgroupId===target.subgroupId);
      return {
        group,
        subgroup,
        label:subgroup?`${group.name} — ${subgroup.name}`:group.name,
        students
      };
    });
}
function studentsOfLesson(lesson){
  const seen=new Set();
  return studentGroupsForLesson(lesson)
    .flatMap(block=>block.students)
    .filter(s=>{
      if(seen.has(s.id))return false;
      seen.add(s.id);
      return true;
    });
}
function lessonsOf(gid){
  return db.lessons
    .filter(l=>lessonTargets(l).some(t=>t.groupId===gid))
    .sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0));
}
function resultFor(studentId,lessonId){
  return db.results.find(r=>r.studentId===studentId&&r.lessonId===lessonId);
}
function lessonTargetSignature(lesson){
  return lessonTargets(lesson)
    .map(t=>`${t.groupId}:${t.subgroupId||'*'}`)
    .sort()
    .join('+');
}
function layoutScopeKeyForLesson(lesson){
  const targets=lessonTargets(lesson);
  if(targets.length===1&&!targets[0].subgroupId){
    return `group:${targets[0].groupId}`;
  }
  return `targets:${lessonTargetSignature(lesson)}`;
}
function layoutRecordKey(layout){
  if(layout?.scopeKey)return layout.scopeKey;
  if(layout?.lessonId)return `lesson:${layout.lessonId}`;
  if(layout?.groupId)return `group:${layout.groupId}`;
  return '';
}
function layoutForLesson(lesson){
  const key=layoutScopeKeyForLesson(lesson);
  return db.layouts.find(l=>layoutRecordKey(l)===key)||null;
}
