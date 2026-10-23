function returnFromStudent(){
  if(state.dirty&&!confirm('Есть несохранённые изменения. Выйти без сохранения?'))return;
  const returnLessonId=state.studentReturnLessonId;
  state.studentId=null;state.studentReturnLessonId=null;
  state.studentDraftResults=null;state.studentDraftComments=null;state.studentOriginalResults=null;
  state.dirty=false;
  document.getElementById('studentPage').classList.remove('active');
  if(returnLessonId&&db.lessons.some(lesson=>lesson.id===returnLessonId)){
    openLesson(returnLessonId);
  }else{
    document.getElementById('mainPage').classList.remove('hidden');
    renderMain();window.scrollTo({top:0,behavior:'instant'});
  }
}
function closeEditingPages(){
  state.lessonId=null;state.lessonDraft=null;
  state.studentId=null;state.studentReturnLessonId=null;
  state.studentDraftResults=null;state.studentDraftComments=null;state.studentOriginalResults=null;
  state.dirty=false;
  document.getElementById('lessonPage').classList.remove('active');
  document.getElementById('studentPage').classList.remove('active');
  document.getElementById('mainPage').classList.remove('hidden');
  updateSaveState();
}

function openLesson(lessonId){
  const lesson=db.lessons.find(l=>l.id===lessonId);
  if(!lesson)return;

  state.studentId=null;
  document.getElementById('studentPage').classList.remove('active');
  state.lessonId=lessonId;
  state.lessonDraft=clone(lesson);

  const ss=studentsOfLesson(lesson);
  state.lessonView='table';
  state.matrixMode='arrange';
  state.matrixScoringActive=false;
  state.layoutTouched=false;
  state.layoutDraft=clone(layoutForLesson(lesson)||createDefaultLayoutForLesson(lesson));
  state.draftResults={};
  state.draftComments={};
  state.draftStars={};

  ss.forEach(s=>{
    const r=resultFor(s.id,lessonId);
    state.draftResults[s.id]=r?.value||'';
    state.draftComments[s.id]=r?.comment||'';
    if(r&&r.stars!==null&&r.stars!==undefined&&r.stars!==''&&Number.isFinite(Number(r.stars))){
      state.draftStars[s.id]=Number(r.stars);
    }else{
      const m=String(r?.value||'').match(/^(\d+)\s+бал/iu);
      state.draftStars[s.id]=m?Number(m[1]):null;
    }
  });

  state.dirty=false;

  document.getElementById('mainPage').classList.add('hidden');
  document.getElementById('lessonPage').classList.add('active');

  renderLessonPage();
  updateSaveState();
  window.scrollTo({top:0,behavior:'instant'});
}

function renderLessonPage(){
  const l=state.lessonDraft;
  const original=currentLesson();
  if(!l||!original)return;

  const groupNames=lessonGroupNames(original)||'Группа';
  document.getElementById('backToJournalBtn').textContent=state.mainView==='calendar'?'← К календарю':'← К журналу';

  document.getElementById('lessonPageTitle').textContent=
    `${formatDate(l.date)} · ${l.topic||'Занятие'}`;

  document.getElementById('lessonPageMeta').textContent=
    `${groupNames} · ${db.settings.subject||'Дисциплина не указана'}`;

  document.getElementById('lessonDateInput').value=l.date||'';
  document.getElementById('lessonHoursInput').value=l.hours||'2';
  const typeSelect=document.getElementById('lessonTypeInput');
  typeSelect.innerHTML=lessonTypeOptions(l.typeId,l.type);
  typeSelect.value=lessonTypeForLesson(l)?.id||db.lessonTypes[0]?.id||'';
  document.getElementById('lessonTopicInput').value=l.topic||'';

  updateLessonViewControls();

  if(state.lessonView==='matrix'){
    renderLessonMatrix();
  }else{
    renderLessonTable();
  }
}

function updateLessonViewControls(){
  const tableBtn=document.getElementById('lessonViewTableBtn');
  const matrixBtn=document.getElementById('lessonViewMatrixBtn');
  const modeWrap=document.getElementById('matrixModeSwitch');
  const arrangeBtn=document.getElementById('matrixArrangeBtn');
  const conductBtn=document.getElementById('matrixConductBtn');

  tableBtn.classList.toggle('active',state.lessonView==='table');
  matrixBtn.classList.toggle('active',state.lessonView==='matrix');
  modeWrap.hidden=state.lessonView!=='matrix';

  arrangeBtn.classList.toggle('active',state.matrixMode==='arrange');
  conductBtn.classList.toggle('active',state.matrixMode==='conduct');
}

function renderLessonTable(){
  const original=currentLesson();
  if(!original)return;

  const blocks=studentGroupsForLesson(original);
  const el=document.getElementById('lessonResultsView');

  const body=blocks.map(block=>`
    <tr class="lesson-group-row">
      <td colspan="4">
        ${esc(block.label)}
        <span class="group-student-count">${block.students.length} студ.</span>
      </td>
    </tr>
    ${block.students.map((s,i)=>`
      <tr>
        <td>${i+1}</td>
        <td><button type="button" class="student-name-btn" data-open-student="${esc(s.id)}" title="Открыть оценки и комментарии студента">${esc(s.name)}</button></td>
        <td>
          <input
            class="mark-input"
            data-sid="${s.id}"
            value="${esc(state.draftResults[s.id]||'')}"
            placeholder="5 / 4 / зач / н / б"
            maxlength="24">
        </td>
        <td>
          <textarea
            class="comment-input"
            data-sid="${s.id}"
            rows="1"
            placeholder="Комментарий к результату">${esc(state.draftComments[s.id]||'')}</textarea>
        </td>
      </tr>
    `).join('')}
  `).join('');

  el.innerHTML=`
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:58px">№</th>
            <th>ФИО студента</th>
            <th style="width:160px">Результат</th>
            <th style="min-width:260px">Комментарий</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="hint">
      После изменений нажмите <b>«Сохранить»</b>.
    </div>
  `;

  el.querySelectorAll('.mark-input').forEach(inp=>{
    inp.oninput=()=>{
      state.draftResults[inp.dataset.sid]=inp.value.trim();
      markDirty();
    };
  });

  el.querySelectorAll('.comment-input').forEach(inp=>{
    inp.oninput=()=>{
      state.draftComments[inp.dataset.sid]=inp.value;
      markDirty();
    };
  });
}

function renderLessonMatrix(){
  const original=currentLesson();
  if(!original||!state.layoutDraft)return;

  const el=document.getElementById('lessonResultsView');
  const layout=state.layoutDraft;
  const rows=Math.max(1,Number(layout.rows)||1);
  const cols=Math.max(1,Number(layout.cols)||1);

  let seats='';
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const key=seatKey(r,c);
      const sid=layout.seats?.[key]||'';
      const student=db.students.find(s=>s.id===sid&&studentIncludedInLesson(s,original));
      const seatNo=r*cols+c+1;

      if(state.matrixMode==='conduct'){
        if(student){
          const parts=splitStudentName(student.name);
          const stars=Number(state.draftStars?.[student.id]??0);
          seats+=`
            <button class="matrix-seat conduct occupied" data-star-sid="${student.id}" title="${esc(student.name)}">
              <span class="seat-number">${seatNo}</span>
              <div class="seat-surname">${esc(parts.surname)}</div>
              <div class="seat-name">${esc(parts.first)}</div>
              <div class="seat-stars">★ ${stars}</div>
            </button>
          `;
        }else{
          seats+=`
            <div class="matrix-seat conduct empty">
              <span class="seat-number">${seatNo}</span>
              <div class="seat-surname">свободно</div>
            </div>
          `;
        }
      }else{
        if(student){
          seats+=`
            <button class="matrix-seat occupied" data-seat-key="${key}" title="Изменить место: ${esc(student.name)}">
              <span class="seat-number">${seatNo}</span>
              <div class="seat-fullname">${esc(student.name)}</div>
            </button>
          `;
        }else{
          seats+=`
            <button class="matrix-seat empty" data-seat-key="${key}" title="Назначить студента">
              <span class="seat-number">${seatNo}</span>
              <div>+ студент</div>
            </button>
          `;
        }
      }
    }
  }

  const tools=state.matrixMode==='arrange'?`
    <div class="matrix-tools">
      <div class="field">
        <label>Строки</label>
        <input id="matrixRowsInput" type="number" min="1" max="12" value="${rows}">
      </div>
      <div class="field">
        <label>Столбцы</label>
        <input id="matrixColsInput" type="number" min="1" max="12" value="${cols}">
      </div>
      <button class="btn" id="applyMatrixSizeBtn">Применить сетку</button>
      <div class="matrix-help">Нажмите на место, чтобы назначить или заменить студента.</div>
    </div>
  `:`
    <div class="matrix-tools">
      <div>
        <b>Режим проведения занятия</b>
        <div class="hint" style="margin:2px 0 0">Нажмите на студента, чтобы добавить или убрать звезду.</div>
      </div>
    </div>
  `;

  el.innerHTML=`
    ${tools}
    <div class="classroom-front">Доска / преподаватель</div>
    <div class="matrix-scroll">
      <div class="classroom-grid" style="grid-template-columns:repeat(${cols},120px)">
        ${seats}
      </div>
    </div>
  `;

  if(state.matrixMode==='arrange'){
    document.getElementById('applyMatrixSizeBtn').onclick=applyMatrixSize;
    el.querySelectorAll('[data-seat-key]').forEach(cell=>{
      cell.onclick=()=>openSeatAssignment(cell.dataset.seatKey);
    });
  }else{
    el.querySelectorAll('[data-star-sid]').forEach(cell=>{
      cell.onclick=()=>openStarControl(cell.dataset.starSid);
    });
  }
}

function applyMatrixSize(){
  if(!state.layoutDraft)return;

  const rows=Math.max(1,Math.min(12,Number(document.getElementById('matrixRowsInput').value)||1));
  const cols=Math.max(1,Math.min(12,Number(document.getElementById('matrixColsInput').value)||1));

  const nextSeats={};
  let removed=0;

  Object.entries(state.layoutDraft.seats||{}).forEach(([key,sid])=>{
    const [r,c]=key.split(':').map(Number);
    if(r<rows&&c<cols){
      nextSeats[key]=sid;
    }else{
      removed++;
    }
  });

  if(removed&&!confirm(`При уменьшении сетки будет освобождено мест: ${removed}. Продолжить?`)){
    return;
  }

  state.layoutDraft.rows=rows;
  state.layoutDraft.cols=cols;
  state.layoutDraft.seats=nextSeats;
  state.layoutTouched=true;
  markDirty();
  renderLessonMatrix();
}

function openSeatAssignment(key){
  const original=currentLesson();
  if(!original||!state.layoutDraft)return;

  const currentSid=state.layoutDraft.seats?.[key]||'';
  const ss=studentsOfLesson(original);

  const studentButtons=ss.map(s=>{
    const occupiedKey=studentSeatKey(state.layoutDraft,s.id);
    const note=occupiedKey&&occupiedKey!==key
      ? `Сейчас находится на месте ${Number(occupiedKey.split(':')[0])*state.layoutDraft.cols+Number(occupiedKey.split(':')[1])+1}`
      : occupiedKey===key?'Сейчас на этом месте':'';
    return `
      <button class="seat-select-item ${s.id===currentSid?'current':''}" data-seat-student="${s.id}">
        ${esc(s.name)}
        <span class="student-group-tag">${esc(
          (db.groups.find(g=>g.id===s.groupId)?.name||'') +
          (s.subgroupId?` · ${subgroupName(s.groupId,s.subgroupId)}`:'')
        )}</span>
        ${note?`<span class="seat-select-note">${esc(note)}</span>`:''}
      </button>
    `;
  }).join('');

  openModal(`
    <div class="modal-head">
      <h3>Выбор студента</h3>
      <button class="btn" id="closeSeatModal">Закрыть</button>
    </div>
    <div class="modal-body">
      <button class="seat-select-item ${!currentSid?'current':''}" data-seat-student="">
        — Оставить место свободным —
      </button>
      <div class="seat-select-list">${studentButtons}</div>
    </div>
  `,true);

  document.getElementById('closeSeatModal').onclick=closeModal;

  document.querySelectorAll('[data-seat-student]').forEach(btn=>{
    btn.onclick=()=>{
      const chosen=btn.dataset.seatStudent;

      if(chosen){
        Object.keys(state.layoutDraft.seats||{}).forEach(k=>{
          if(state.layoutDraft.seats[k]===chosen){
            delete state.layoutDraft.seats[k];
          }
        });
        state.layoutDraft.seats[key]=chosen;
      }else{
        delete state.layoutDraft.seats[key];
      }

      state.layoutTouched=true;
      markDirty();
      closeModal();
      renderLessonMatrix();
    };
  });
}
