function calendarScrollToDay(){
  const sections=[...document.querySelectorAll('#calendarView [data-agenda-date]')];
  const target=sections.find(el=>el.dataset.agendaDate>=state.calendarDate)||sections.at(-1);
  target?.scrollIntoView({behavior:'smooth',block:'start'});
}
function navigateCalendar(direction){
  const date=calendarParseDate(state.calendarDate)||new Date();
  state.calendarDate=calendarDateKey(state.calendarMode==='week'?calendarAddDays(date,direction*7):new Date(date.getFullYear(),date.getMonth()+direction,1,12));
  renderCalendar();
}

document.getElementById('mainJournalTab').onclick=()=>{state.mainView='journal';renderMainView();};
document.getElementById('mainCalendarTab').onclick=()=>{state.mainView='calendar';renderMainView();};
document.getElementById('calendarView').onclick=e=>{
  const card=e.target.closest('[data-calendar-lesson]');
  if(card){openLesson(card.dataset.calendarLesson);return;}
  const mode=e.target.closest('[data-calendar-mode]');
  if(mode){state.calendarMode=mode.dataset.calendarMode;renderCalendar();return;}
  const nav=e.target.closest('[data-calendar-nav]');
  if(nav){navigateCalendar(Number(nav.dataset.calendarNav));return;}
  if(e.target.closest('[data-calendar-today]')){
    state.calendarDate=calendarDateKey(new Date());renderCalendar();if(state.calendarMode==='list')calendarScrollToDay();return;
  }
  const day=e.target.closest('[data-calendar-day]');
  if(day){state.calendarDate=day.dataset.calendarDay;state.calendarMode='list';renderCalendar();calendarScrollToDay();return;}
  const add=e.target.closest('[data-calendar-add]');
  if(add){
    if(!db.groups.length){toast('Сначала создайте группу в настройках');return;}
    lessonEditModal(null,add.dataset.calendarAdd,true);
  }
};

function renderJournal(){
  const el=document.getElementById('journalView');
  const g=currentGroup();

  if(!g){
    el.innerHTML=`<div class="empty">
      Групп пока нет. Откройте <b>Настройки → Группы</b> и создайте первую группу.
    </div>`;
    return;
  }

  const ss=studentsOf(g.id);
  const allLessons=lessonsOf(g.id);
  const ls=state.lessonFilter==='all'
    ? allLessons
    : allLessons.filter(l=>lessonTypeId(l)===state.lessonFilter);
  const averages=ss.map(student=>studentAverage(student,ls));
  const statistics=performanceStatistics(averages);

  if(!ss.length){
    el.innerHTML=`<div class="empty">
      В группе <b>${esc(g.name)}</b> пока нет студентов.<br>
      Добавьте их через <b>Настройки → Студенты</b>.
    </div>`;
    return;
  }

  // Number all group lessons before filtering so labels remain stable in each view.
  const counts=new Map(), labels=new Map();
  allLessons.forEach(l=>{
    const type=lessonTypeForLesson(l), key=type?.id||'';
    const n=(counts.get(key)||0)+1;
    counts.set(key,n);
    labels.set(l.id,`${type?.prefix??defaultTypePrefix(type?.name,key)}${n}`);
  });
  const head=ls.map(l=>{
    const jd=journalDateParts(l.date);
    const fullTip=`${labels.get(l.id)} · ${formatDate(l.date)} · ${lessonTypeName(l)}${l.topic?' · '+l.topic:''}`;
    const color=lessonTypeColor(l);
    const allStyle=state.lessonFilter==='all'
      ? `background:color-mix(in srgb,${color} 20%,var(--panel));`
      : '';
    return `
      <th class="lesson-head" title="${esc(fullTip)}" style="${allStyle}">
        <button type="button" class="lesson-open-btn" data-lid="${l.id}" aria-label="Открыть занятие ${formatDate(l.date)}. ${esc(l.topic||'')}">
          <div class="lesson-number">${esc(labels.get(l.id))}</div>
          <div class="date" style="${state.lessonFilter==='all'?`color:${color}`:''}">
            <div class="day">${jd.day}</div>
            <div class="month">${jd.month}</div>
          </div>
        </button>
      </th>
    `;
  }).join('');

  const rows=ss.map((s,i)=>`
    <tr>
      <td class="sticky1">${i+1}</td>
      <td class="sticky2"><button type="button" class="student-name-btn" data-open-student="${esc(s.id)}" title="Открыть оценки и комментарии студента">${esc(s.name)}</button></td>
      ${ls.map(l=>{
        const r=resultFor(s.id,l.id);
        const val=(r?.value||'').trim();
        const comment=(r?.comment||'').trim();
        const low=val.toLowerCase();
        const cls=low==='н'?'status-n':low==='б'?'status-a':val?'status-g':'';
        const mark=resultMarkKind(val);
        const commentsOn=!!db.settings.showComments;
        const included=studentIncludedInLesson(s,l);
        const color=lessonTypeColor(l);

        const pointsMatch=val.match(/^(\d+)\s+бал(?:л|ла|лов)?$/iu);
        const displayVal=pointsMatch?pointsMatch[1]:val;
        const allStyle=state.lessonFilter==='all'&&included
          ? `background:color-mix(in srgb,${color} 20%,var(--panel));`
          : '';

        if(!included){
          return `<td class="result-cell" style="opacity:.28">·</td>`;
        }

        return `<td
          class="result-cell editable-result ${cls} ${mark?'result-marked result-mark-'+mark:''} ${commentsOn?'comment-enabled':''} ${commentsOn&&comment?'has-comment':''}"
          style="${allStyle}"
          data-sid="${esc(s.id)}" data-lid="${esc(l.id)}"
          title="Двойной щелчок — изменить оценку"
          ${commentsOn?`data-comment-sid="${s.id}" data-comment-lid="${l.id}"`:''}>
          ${displayVal?esc(displayVal):'<span class="result-empty">—</span>'}
        </td>`;
      }).join('')}
      <td class="average-cell" title="Средний балл по оценкам выбранных занятий; «Н» считается как 2">${formatAverage(averages[i])}</td>
    </tr>
  `).join('');

  el.innerHTML=`
    <div class="print-title">
      <h2>Журнал учебных занятий</h2>
      <div>
        Группа: ${esc(g.name)} ·
        Дисциплина: ${esc(db.settings.subject||'—')} ·
        Учебный год: ${esc(db.settings.year||'—')}
      </div>
    </div>

    ${!ls.length?'<div class="empty">Занятий для выбранного фильтра пока нет.</div>':''}
    <div class="table-wrap">
      <table class="journal-table">
        <thead>
          <tr>
            <th class="sticky1">№</th>
            <th class="sticky2">ФИО студента</th>
            ${head}
            <th class="average-head" scope="col">Средний<br>балл</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="result-mark-legend" aria-label="Обозначения рамок">
      <span><i class="result-mark-fail" aria-hidden="true"></i>2</span>
      <span><i class="result-mark-absent" aria-hidden="true"></i>Н</span>
      <span><i class="result-mark-unattested" aria-hidden="true"></i>Н/А</span>
      <span><i class="result-mark-text" aria-hidden="true"></i>Другие текстовые оценки</span>
      <span class="journal-edit-hint">Двойной щелчок по клетке — изменить оценку. Enter — сохранить и перейти ниже, Tab — вправо, Esc — отменить.</span>
    </div>
    ${renderPerformanceStatistics(statistics)}
  `;

  el.querySelectorAll('.lesson-open-btn').forEach(btn=>{
    btn.addEventListener('click',()=>openLesson(btn.dataset.lid));
  });
  el.querySelectorAll('td.editable-result').forEach(cell=>{
    cell.addEventListener('dblclick',e=>{e.preventDefault();startJournalEdit(cell);});
  });

  if(db.settings.showComments){
    el.querySelectorAll('[data-comment-sid][data-comment-lid]').forEach(cell=>{
      cell.addEventListener('click',e=>{
        const sid=cell.dataset.commentSid;
        const lid=cell.dataset.commentLid;
        const student=db.students.find(x=>x.id===sid);
        const lesson=db.lessons.find(x=>x.id===lid);
        const r=resultFor(sid,lid);
        openCommentPopover(
          cell,
          r?.comment||'',
          student?.name||'Студент',
          lesson?formatDate(lesson.date):''
        );
        e.stopPropagation();
      });
    });
  }
}

function saveJournalResult(studentId,lessonId,rawValue){
  const value=String(rawValue??'').trim();
  const current=resultFor(studentId,lessonId);
  if(value===String(current?.value||'').trim())return false;
  const comment=String(current?.comment||'');
  const match=value.match(/^(\d+)\s+бал(?:л|ла|лов)?$/iu);
  db.results=db.results.filter(r=>r.studentId!==studentId||r.lessonId!==lessonId);
  if(value||comment.trim()){
    db.results.push({...(current||{}),id:current?.id||uid('r'),studentId,lessonId,value,comment,stars:match?Number(match[1]):null});
  }
  saveDB();
  return true;
}
function journalNeighborCell(cell,direction){
  const row=cell.parentElement;
  if(direction==='left'||direction==='right'){
    const cells=[...row.querySelectorAll('td.editable-result')];
    return cells[cells.indexOf(cell)+(direction==='right'?1:-1)]||null;
  }
  const rows=[...row.parentElement.rows];
  const step=direction==='down'?1:-1;
  for(let i=rows.indexOf(row)+step;i>=0&&i<rows.length;i+=step){
    const target=[...rows[i].querySelectorAll('td.editable-result')].find(td=>td.dataset.lid===cell.dataset.lid);
    if(target)return target;
  }
  return null;
}
function findJournalCell(studentId,lessonId){
  return [...document.querySelectorAll('#journalView td.editable-result')]
    .find(td=>td.dataset.sid===studentId&&td.dataset.lid===lessonId)||null;
}
function startJournalEdit(cell){
  if(!cell||cell.classList.contains('editing'))return;
  closeCommentPopover();
  const studentId=cell.dataset.sid,lessonId=cell.dataset.lid;
  const student=db.students.find(s=>s.id===studentId);
  const lesson=db.lessons.find(l=>l.id===lessonId);
  const original=String(resultFor(studentId,lessonId)?.value||'');
  cell.classList.add('editing');
  cell.innerHTML='<input class="journal-cell-input" maxlength="24" autocomplete="off" spellcheck="false">';
  const input=cell.firstElementChild;
  input.value=original;
  input.setAttribute('aria-label',`Оценка: ${student?.name||'студент'}, ${lesson?formatDate(lesson.date):''}`);
  let finished=false;
  const finish=(save,direction)=>{
    if(finished)return;
    finished=true;
    const next=direction?journalNeighborCell(cell,direction):null;
    const target=next?{sid:next.dataset.sid,lid:next.dataset.lid}:null;
    const changed=save&&saveJournalResult(studentId,lessonId,input.value);
    const wrap=document.querySelector('#journalView .table-wrap');
    const left=wrap?.scrollLeft||0,top=wrap?.scrollTop||0;
    renderJournal();
    const newWrap=document.querySelector('#journalView .table-wrap');
    if(newWrap){newWrap.scrollLeft=left;newWrap.scrollTop=top;}
    if(changed)toast('Оценка сохранена');
    if(target){
      const nextCell=findJournalCell(target.sid,target.lid);
      nextCell?.scrollIntoView?.({block:'nearest',inline:'nearest'});
      startJournalEdit(nextCell);
    }
  };
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();finish(true,e.shiftKey?'up':'down');}
    else if(e.key==='Tab'){e.preventDefault();finish(true,e.shiftKey?'left':'right');}
    else if(e.key==='Escape'){e.preventDefault();finish(false);}
  });
  input.addEventListener('blur',()=>finish(true));
  input.addEventListener('click',e=>e.stopPropagation());
  input.addEventListener('dblclick',e=>e.stopPropagation());
  input.focus();
  input.select();
}

function renderPerformanceStatistics(statistics){
  const percent=count=>statistics.graded
    ? `${(100*count/statistics.graded).toLocaleString('ru-RU',{maximumFractionDigits:1})} %`
    : '—';
  const fraction=count=>statistics.graded?`${count} из ${statistics.graded} студентов с оценками`:'Нет числовых оценок';
  return `<section class="performance-statistics" aria-label="Статистика успеваемости">
    <h3>Статистика успеваемости</h3>
    <div class="performance-cards">
      <div class="performance-card"><span>Абсолютная успеваемость</span><strong>${percent(statistics.absolute)}</strong><small>${fraction(statistics.absolute)}</small></div>
      <div class="performance-card"><span>Качественная успеваемость</span><strong>${percent(statistics.quality)}</strong><small>${fraction(statistics.quality)}</small></div>
      <div class="performance-card"><span>Студентов с оценками</span><strong>${statistics.graded} из ${statistics.total}</strong><small>Без числовых оценок: ${statistics.total-statistics.graded}</small></div>
    </div>
    <p class="hint">Расчёт по выбранным занятиям и оценкам от 2 до 5; пропуск «Н» считается как 2. Абсолютная: доля студентов со средним баллом ≥ 3; качественная: ≥ 4. Порог проверяется без округления среднего балла. Студенты без оценок исключены из расчёта процентов; «Н/А», зачёты и баллы не учитываются.</p>
  </section>`;
}

function currentStudent(){
  return db.students.find(s=>s.id===state.studentId)||null;
}
function lessonsOfStudent(student){
  if(!student)return [];
  return lessonsOf(student.groupId).filter(lesson=>studentIncludedInLesson(student,lesson));
}
function loadStudentDraft(){
  const student=currentStudent();
  state.studentDraftResults={};state.studentDraftComments={};state.studentOriginalResults={};
  lessonsOfStudent(student).forEach(lesson=>{
    const result=resultFor(student.id,lesson.id);
    state.studentDraftResults[lesson.id]=String(result?.value||'');
    state.studentDraftComments[lesson.id]=String(result?.comment||'');
    state.studentOriginalResults[lesson.id]=result?clone(result):null;
  });
}
function openStudent(studentId){
  const student=db.students.find(s=>s.id===studentId);
  if(!student)return;
  if(state.dirty&&!confirm('Есть несохранённые изменения. Открыть карточку студента без их сохранения?'))return;
  if(!state.studentId)state.studentReturnLessonId=state.lessonId;
  state.studentId=studentId;
  state.lessonId=null;
  state.lessonDraft=null;
  state.dirty=false;
  loadStudentDraft();
  closeCommentPopover();
  document.getElementById('mainPage').classList.add('hidden');
  document.getElementById('lessonPage').classList.remove('active');
  document.getElementById('studentPage').classList.add('active');
  renderStudentPage();updateSaveState();
  window.scrollTo({top:0,behavior:'instant'});
}
function studentNavigationList(){
  const student=currentStudent();
  if(!student)return [];
  const lesson=db.lessons.find(l=>l.id===state.studentReturnLessonId);
  return lesson?studentsOfLesson(lesson):studentsOf(student.groupId);
}
function navigateStudent(direction){
  const students=studentNavigationList();
  const index=students.findIndex(s=>s.id===state.studentId);
  const next=index<0?null:students[index+direction];
  if(next)openStudent(next.id);
}
function renderStudentPage(){
  const student=currentStudent();
  if(!student)return;
  const lessons=lessonsOfStudent(student),group=db.groups.find(g=>g.id===student.groupId);
  const counts=new Map(),numbers=new Map();
  lessonsOf(student.groupId).forEach(lesson=>{
    const type=lessonTypeForLesson(lesson),key=type?.id||'';
    const n=(counts.get(key)||0)+1;counts.set(key,n);
    numbers.set(lesson.id,`${type?.prefix??defaultTypePrefix(type?.name,key)}${n}`);
  });
  document.getElementById('studentPageTitle').textContent=student.name;
  document.getElementById('studentPageMeta').textContent=`${group?.name||'Группа'} · ${db.settings.subject||'Дисциплина не указана'} · Занятий: ${lessons.length}`;
  document.getElementById('backFromStudentBtn').textContent=state.studentReturnLessonId?'← К занятию':state.mainView==='calendar'?'← К календарю':'← К журналу';
  const students=studentNavigationList(),index=students.findIndex(s=>s.id===student.id);
  const previous=students[index-1],next=index<0?null:students[index+1];
  const previousButton=document.getElementById('previousStudentBtn'),nextButton=document.getElementById('nextStudentBtn');
  previousButton.disabled=!previous;nextButton.disabled=!next;
  previousButton.title=previous?`Предыдущий: ${previous.name}`:'Начало списка';
  nextButton.title=next?`Следующий: ${next.name}`:'Конец списка';
  document.getElementById('studentPosition').textContent=index<0?'':`${index+1} / ${students.length}`;
  const root=document.getElementById('studentResultsView');
  root.innerHTML=lessons.length?`<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Тип занятия</th><th>Тема</th><th>Оценка</th><th>Комментарий</th></tr></thead><tbody>${lessons.map(lesson=>`
    <tr>
      <td class="student-date-cell"><span class="student-lesson-number">${esc(numbers.get(lesson.id)||'')}</span>${esc(formatDate(lesson.date))}</td>
      <td class="student-type-cell" style="--student-type-color:${lessonTypeColor(lesson)}">${esc(lessonTypeName(lesson))}</td>
      <td class="student-topic-cell">${esc(lesson.topic||'Без темы')}</td>
      <td class="student-grade-cell"><input class="mark-input student-grade-input" data-student-lesson="${esc(lesson.id)}" value="${esc(state.studentDraftResults[lesson.id]||'')}" placeholder="5 / 4 / зач / н / б" maxlength="24" aria-label="Оценка за ${formatDate(lesson.date)}. ${esc(lesson.topic||'Без темы')}"></td>
      <td class="student-comment-cell"><textarea class="comment-input student-comment-input" data-student-lesson="${esc(lesson.id)}" rows="2" placeholder="Комментарий к результату" aria-label="Комментарий за ${formatDate(lesson.date)}. ${esc(lesson.topic||'Без темы')}">${esc(state.studentDraftComments[lesson.id]||'')}</textarea></td>
    </tr>`).join('')}</tbody></table></div>`:'<div class="empty">Для этого студента пока нет занятий.</div>';
  root.querySelectorAll('.student-grade-input').forEach(input=>{
    input.oninput=()=>{state.studentDraftResults[input.dataset.studentLesson]=input.value;markDirty();};
  });
  root.querySelectorAll('.student-comment-input').forEach(input=>{
    input.oninput=()=>{state.studentDraftComments[input.dataset.studentLesson]=input.value;markDirty();};
  });
}
function saveStudentPage(){
  const student=currentStudent();
  if(!student){toast('Студент не найден. Вернитесь к журналу');return;}
  const changes=[];
  lessonsOfStudent(student).forEach(lesson=>{
    if(!Object.hasOwn(state.studentDraftResults||{},lesson.id))return;
    const original=state.studentOriginalResults[lesson.id];
    const value=String(state.studentDraftResults[lesson.id]||'').trim();
    const comment=String(state.studentDraftComments[lesson.id]||'').trim();
    if(value===String(original?.value||'')&&comment===String(original?.comment||''))return;
    const valueChanged=value!==String(original?.value||'');
    const match=value.match(/^(\d+)\s+бал(?:л|ла|лов)?$/iu);
    const stars=valueChanged?(match?Number(match[1]):null):(original?.stars??null);
    const current=resultFor(student.id,lesson.id);
    changes.push({lessonId:lesson.id,result:value||comment||stars!==null?{
      ...(current||{}),id:current?.id||uid('r'),studentId:student.id,lessonId:lesson.id,value,comment,stars
    }:null});
  });
  if(changes.length){
    const changedLessons=new Set(changes.map(change=>change.lessonId));
    db.results=db.results.filter(result=>result.studentId!==student.id||!changedLessons.has(result.lessonId));
    changes.forEach(change=>{if(change.result)db.results.push(change.result);});
  }
  state.dirty=false;
  if(changes.length)saveDB();
  loadStudentDraft();updateSaveState();renderStudentPage();renderMain();
  toast(changes.length?'Оценки и комментарии сохранены':'Нет изменений для сохранения');
}
