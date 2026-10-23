function openStarControl(studentId){
  const student=db.students.find(s=>s.id===studentId);
  if(!student)return;

  if(state.draftStars[studentId]===null||
     state.draftStars[studentId]===undefined||
     state.draftStars[studentId]===''||
     !Number.isFinite(Number(state.draftStars[studentId]))){
    state.draftStars[studentId]=0;
  }

  openModal(`
    <div class="modal-head">
      <h3>${esc(student.name)}</h3>
      <button class="btn" id="closeStarModal">Готово</button>
    </div>
    <div class="modal-body">
      <div class="star-control">
        <button id="starMinusBtn" aria-label="Убрать звезду">−</button>
        <div class="star-count">
          <div id="starCountValue">★ ${Number(state.draftStars[studentId])}</div>
          <small>заработано за занятие</small>
        </div>
        <button id="starPlusBtn" aria-label="Добавить звезду">+</button>
      </div>
    </div>
  `,true);

  const redraw=()=>{
    document.getElementById('starCountValue').textContent=`★ ${Number(state.draftStars[studentId]||0)}`;
    renderLessonMatrix();
  };

  document.getElementById('starMinusBtn').onclick=()=>{
    state.draftStars[studentId]=Math.max(0,Number(state.draftStars[studentId]||0)-1);
    markDirty();
    redraw();
  };
  document.getElementById('starPlusBtn').onclick=()=>{
    state.draftStars[studentId]=Number(state.draftStars[studentId]||0)+1;
    markDirty();
    redraw();
  };
  document.getElementById('closeStarModal').onclick=closeModal;
}

function syncResultsFromStars(){
  if(!state.layoutDraft||!state.matrixScoringActive)return;

  const assigned=new Set(Object.values(state.layoutDraft.seats||{}).filter(Boolean));
  let changed=false;

  assigned.forEach(studentId=>{
    const stars=Number.isFinite(Number(state.draftStars[studentId]))
      ? Number(state.draftStars[studentId])
      : 0;

    state.draftStars[studentId]=stars;
    const next=pointsText(stars);

    if(state.draftResults[studentId]!==next){
      state.draftResults[studentId]=next;
      changed=true;
    }
  });

  if(changed)markDirty();
}

function switchLessonView(view){
  if(view==='table'&&state.lessonView==='matrix'){
    syncResultsFromStars();
  }
  state.lessonView=view;
  renderLessonPage();
}

function switchMatrixMode(mode){
  state.lessonView='matrix';
  state.matrixMode=mode;
  if(mode==='conduct'){
    state.matrixScoringActive=true;
  }
  renderLessonPage();
}

function markDirty(){
  state.dirty=true;
  updateSaveState();
}
function updateSaveState(){
  const wrap=document.getElementById('saveState');
  const text=document.getElementById('saveStateText');
  wrap.classList.toggle('dirty',state.dirty);
  text.textContent=state.dirty?'Есть несохранённые изменения':'Все изменения сохранены';
  document.getElementById('studentSaveState').classList.toggle('dirty',state.dirty);
  document.getElementById('studentSaveStateText').textContent=text.textContent;
}

function syncLessonDraftFromFields(){
  if(!state.lessonDraft)return;
  state.lessonDraft.date=document.getElementById('lessonDateInput').value;
  state.lessonDraft.hours=document.getElementById('lessonHoursInput').value;
  const typeId=document.getElementById('lessonTypeInput').value;
  const type=lessonTypeById(typeId);
  state.lessonDraft.typeId=typeId;
  state.lessonDraft.type=type?.name||'Занятие';
  state.lessonDraft.topic=document.getElementById('lessonTopicInput').value.trim();
}


const GRADES_CLIPBOARD_SCHEMA='edu-journal-grades-v1';
function gradesClipboardPayload(){
  const lesson=currentLesson();
  if(!lesson)return null;
  syncResultsFromStars();
  return {
    schema:GRADES_CLIPBOARD_SCHEMA,
    source:{lessonId:lesson.id,date:state.lessonDraft?.date||lesson.date,topic:state.lessonDraft?.topic||lesson.topic||''},
    grades:studentsOfLesson(lesson).map(student=>{
      const value=String(state.draftResults?.[student.id]||'').trim();
      const match=value.match(/^(\d+)\s+бал(?:л|ла|лов)?$/iu);
      return {studentId:student.id,studentName:student.name,value,stars:match?Number(match[1]):null};
    }).filter(row=>row.value!=='')
  };
}
async function copyLessonGrades(){
  const payload=gradesClipboardPayload();
  if(!payload?.grades.length){toast('В занятии пока нет заполненных оценок');return;}
  const text=JSON.stringify(payload,null,2);
  try{
    if(!navigator.clipboard?.writeText)throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
  }catch(e){
    const active=document.activeElement,area=document.createElement('textarea');
    area.value=text;area.setAttribute('readonly','');
    Object.assign(area.style,{position:'fixed',left:'-10000px',top:'0'});
    document.body.appendChild(area);area.select();
    let copied=false;
    try{copied=!!document.execCommand?.('copy');}catch(e){}
    area.remove();active?.focus?.();
    if(!copied){showManualGradesCopy(text);return;}
  }
  toast(`Оценки скопированы: ${payload.grades.length}`);
}
function showManualGradesCopy(text){
  openModal(`<div class="modal-head"><h3>Скопировать оценки</h3></div>
    <div class="modal-body"><p>Браузер не разрешил автоматическое копирование. Скопируйте выделенный текст сочетанием Ctrl+C или через меню выделения.</p>
      <div class="field"><label for="gradesCopyText">Данные оценок</label><textarea id="gradesCopyText" rows="8" readonly></textarea></div></div>
    <div class="modal-foot"><button class="btn" id="closeGradesCopy">Закрыть</button></div>`,true);
  const area=document.getElementById('gradesCopyText');area.value=text;area.focus();area.select();
  document.getElementById('closeGradesCopy').onclick=closeModal;
}
function planClipboardGrades(text,lessonId){
  if(state.lessonId!==lessonId||!currentLesson())throw new Error('Откройте нужное занятие и повторите вставку.');
  let data;
  try{data=JSON.parse(text);}catch(e){throw new Error('В буфере нет оценок журнала. Сначала нажмите «Скопировать оценки» в исходном занятии.');}
  if(data?.schema!==GRADES_CLIPBOARD_SCHEMA||!Array.isArray(data.grades))throw new Error('Неверный формат. Используйте кнопку «Скопировать оценки» в журнале.');
  const ids=new Set(),students=new Set(studentsOfLesson(currentLesson()).map(s=>s.id));
  const rows=[];let skipped=0;
  data.grades.forEach(row=>{
    if(!row||typeof row.studentId!=='string'||typeof row.value!=='string'||row.value.length>24||ids.has(row.studentId)){
      throw new Error('Данные оценок повреждены или содержат повторяющихся студентов. Скопируйте оценки заново.');
    }
    ids.add(row.studentId);
    const value=row.value.trim();
    if(!value||!students.has(row.studentId)){skipped++;return;}
    const match=value.match(/^(\d+)\s+бал(?:л|ла|лов)?$/iu);
    rows.push({studentId:row.studentId,value,stars:match?Number(match[1]):null});
  });
  if(!rows.length)throw new Error('Нет оценок для студентов этого занятия. Возможно, скопированы оценки другой группы.');
  const replaced=rows.filter(row=>String(state.draftResults?.[row.studentId]||'').trim()!=='').length;
  return {rows,skipped,replaced,sourceDate:typeof data.source?.date==='string'?data.source.date:''};
}
function applyClipboardGrades(text,lessonId){
  const plan=planClipboardGrades(text,lessonId);
  const source=calendarParseDate(plan.sourceDate)?` от ${formatDate(plan.sourceDate)}`:'';
  const message=`Вы уверены, что хотите вставить оценки${source}?\n\nОценок для вставки: ${plan.rows.length}.\nИз них заменят заполненные оценки: ${plan.replaced}.${plan.skipped?`\nПропущено записей: ${plan.skipped}.`:''}\n\nОценки сопоставляются по студентам. Пустые оценки и оценки других студентов не вставляются. Комментарии сохраняются.\nПосле вставки нажмите «Сохранить».`;
  if(!confirm(message))return false;
  // Finish pending matrix scoring, then preserve pasted grades when saving the table.
  syncResultsFromStars();
  state.matrixScoringActive=false;
  plan.rows.forEach(row=>{state.draftResults[row.studentId]=row.value;state.draftStars[row.studentId]=row.stars;});
  state.lessonView='table';
  markDirty();renderLessonPage();
  toast(`Оценки вставлены: ${plan.rows.length}. Нажмите «Сохранить»`);
  return true;
}
async function pasteLessonGrades(){
  const lessonId=state.lessonId;
  if(!currentLesson())return;
  let text;
  try{
    if(!navigator.clipboard?.readText)throw new Error('Clipboard API unavailable');
    text=await navigator.clipboard.readText();
  }catch(e){
    if(state.lessonId===lessonId)showManualGradesPaste(lessonId);
    return;
  }
  if(state.lessonId!==lessonId){toast('Занятие изменилось. Повторите вставку');return;}
  if(!text.trim()){toast('Буфер обмена пуст');return;}
  try{applyClipboardGrades(text,lessonId);}catch(e){alert(e.message||String(e));}
}
function showManualGradesPaste(lessonId){
  openModal(`<div class="modal-head"><h3>Вставить из буфера</h3></div>
    <div class="modal-body"><p>Браузер не разрешил автоматическое чтение буфера. Вставьте скопированные оценки сочетанием Ctrl+V или через меню вставки.</p>
      <div class="field"><label for="gradesPasteText">Данные оценок</label><textarea id="gradesPasteText" rows="8" placeholder="Вставьте сюда данные, полученные кнопкой «Скопировать оценки»"></textarea></div>
      <div class="hint" id="gradesPasteError" role="status" style="color:var(--danger)"></div></div>
    <div class="modal-foot"><button class="btn" id="cancelGradesPaste">Отмена</button><button class="btn primary" id="confirmGradesPaste">Продолжить</button></div>`,true);
  document.getElementById('gradesPasteText').focus();
  document.getElementById('cancelGradesPaste').onclick=closeModal;
  document.getElementById('confirmGradesPaste').onclick=()=>{
    try{
      if(applyClipboardGrades(document.getElementById('gradesPasteText').value,lessonId))closeModal();
    }catch(e){document.getElementById('gradesPasteError').textContent=e.message||String(e);}
  };
}

function saveLessonPage(){
  if(!state.lessonId||!state.lessonDraft)return;

  syncLessonDraftFromFields();

  const idx=db.lessons.findIndex(l=>l.id===state.lessonId);
  if(idx<0)return;

  db.lessons[idx]={...db.lessons[idx],...state.lessonDraft};

  const lessonId=state.lessonId;
  const original=db.lessons[idx];
  const studentIds=new Set(studentsOfLesson(original).map(s=>s.id));

  db.results=db.results.filter(r=>
    !(r.lessonId===lessonId && studentIds.has(r.studentId))
  );

  syncResultsFromStars();

  const draftStudentIds=new Set([
    ...Object.keys(state.draftResults||{}),
    ...Object.keys(state.draftComments||{}),
    ...Object.keys(state.draftStars||{})
  ]);

  draftStudentIds.forEach(studentId=>{
    const v=String(state.draftResults?.[studentId]||'').trim();
    const comment=String(state.draftComments?.[studentId]||'').trim();
    const rawStars=state.draftStars?.[studentId];
    const hasStars=
      rawStars!==null&&
      rawStars!==undefined&&
      rawStars!==''&&
      Number.isFinite(Number(rawStars));
    const stars=hasStars?Math.max(0,Number(rawStars)):null;

    if(v||comment||hasStars){
      db.results.push({
        id:uid('r'),
        studentId,
        lessonId,
        value:v,
        comment,
        stars
      });
    }
  });

  if(state.layoutTouched&&state.layoutDraft){
    const key=state.layoutDraft.scopeKey||layoutScopeKeyForLesson(original);
    state.layoutDraft.scopeKey=key;
    const li=db.layouts.findIndex(l=>layoutRecordKey(l)===key);
    const cleanLayout=clone(state.layoutDraft);
    if(li>=0)db.layouts[li]=cleanLayout;
    else db.layouts.push(cleanLayout);
    state.layoutTouched=false;
  }

  saveDB();

  state.lessonDraft=clone(db.lessons[idx]);
  state.dirty=false;
  updateSaveState();
  renderLessonPage();
  renderMain();
  scheduleYandexAutoPush();
  toast('Изменения сохранены');
}

function returnToJournal(){
  if(state.dirty){
    const ok=confirm('Есть несохранённые изменения. Выйти без сохранения?');
    if(!ok)return;
  }
  state.lessonId=null;
  state.lessonDraft=null;
  state.lessonView='table';
  state.matrixMode='arrange';
  state.matrixScoringActive=false;
  state.layoutDraft=null;
  state.layoutTouched=false;
  state.draftResults=null;
  state.draftComments=null;
  state.draftStars=null;
  state.dirty=false;

  document.getElementById('lessonPage').classList.remove('active');
  document.getElementById('mainPage').classList.remove('hidden');

  renderMain();
  window.scrollTo({top:0,behavior:'instant'});
}
