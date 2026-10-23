function bulkStudentModal(){
  openModal(`
    <div class="modal-head">
      <h3>Вставить список студентов</h3>
    </div>
    <div class="modal-body">
      <div class="field">
        <label>Подгруппа для добавляемых студентов</label>
        <select id="bulkStudentsSubgroup">
          <option value="">— Без подгруппы —</option>
          ${subgroupsOf(state.groupId).map(sg=>`<option value="${sg.id}">${esc(sg.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin-top:10px">
        <label>По одному студенту на строку</label>
        <textarea id="bulkStudentsModal" rows="14" placeholder="Иванов Иван&#10;Петров Пётр"></textarea>
      </div>
      <div class="hint">Новые записи будут добавлены к текущему списку группы.</div>
    </div>
    <div class="modal-foot">
      <button class="btn" id="cancelBulkStudents">Отмена</button>
      <button class="btn primary" id="saveBulkStudents">Добавить</button>
    </div>
  `,true);

  document.getElementById('cancelBulkStudents').onclick=()=>settingsModal('students');

  document.getElementById('saveBulkStudents').onclick=()=>{
    const names=document.getElementById('bulkStudentsModal').value
      .split(/\r?\n/)
      .map(x=>x.trim())
      .filter(Boolean);

    let order=studentsOf(state.groupId).length;
    const subgroupId=document.getElementById('bulkStudentsSubgroup').value||null;

    names.forEach(name=>{
      db.students.push({
        id:uid('s'),
        groupId:state.groupId,
        subgroupId,
        name,
        note:'',
        order:order++
      });
    });

    saveDB();
    renderMain();
    settingsModal('students');
    toast(`Добавлено: ${names.length}`);
  };
}

function renderLessonsSettings(){
  const gid=state.groupId;

  return `
    <div class="settings-section">
      <h4>Занятия</h4>

      ${db.groups.length?`
        <div class="field" style="max-width:360px;margin-bottom:12px">
          <label>Группа</label>
          <select id="settingsLessonGroup">
            ${db.groups.map(x=>`
              <option value="${x.id}" ${x.id===gid?'selected':''}>${esc(x.name)}</option>
            `).join('')}
          </select>
        </div>

        <button class="btn primary" id="addLessonSettingsBtn" style="margin-bottom:12px">+ Занятие</button>

        <div class="settings-list">
          ${lessonsOf(gid).length?lessonsOf(gid).map(l=>`
            <div class="settings-row">
              <div>
                <div class="name"><b>${formatDate(l.date)}</b> · ${esc(l.topic||'Без темы')}</div>
                <div class="hint">${esc(lessonTypeName(l))} · ${esc(l.hours||'')} ч. · ${esc(lessonGroupNames(l))}</div>
              </div>
              <div class="actions">
                <button class="btn open-lesson-settings" data-id="${l.id}">Открыть</button>
                <button class="btn edit-lesson-settings" data-id="${l.id}">Изменить</button>
                <button class="btn danger del-lesson-settings" data-id="${l.id}">Удалить</button>
              </div>
            </div>
          `).join(''):'<div class="empty" style="padding:30px 10px">Занятий нет.</div>'}
        </div>
      `:'<div class="empty" style="padding:30px 10px">Сначала создайте группу.</div>'}
    </div>
  `;
}

function wireLessonSettings(){
  const sel=document.getElementById('settingsLessonGroup');
  if(sel){
    sel.onchange=()=>{
      state.groupId=sel.value;
      renderMain();
      renderSettingsContent();
    };
  }

  const addBtn=document.getElementById('addLessonSettingsBtn');
  if(addBtn)addBtn.onclick=()=>lessonEditModal();

  document.querySelectorAll('.open-lesson-settings').forEach(b=>{
    b.onclick=()=>{
      closeModal();
      openLesson(b.dataset.id);
    };
  });

  document.querySelectorAll('.edit-lesson-settings').forEach(b=>{
    b.onclick=()=>lessonEditModal(b.dataset.id);
  });

  document.querySelectorAll('.del-lesson-settings').forEach(b=>{
    b.onclick=()=>{
      if(!deleteLesson(b.dataset.id))return;
      renderSettingsContent();
    };
  });
}

function deleteLesson(id){
  const lesson=db.lessons.find(l=>l.id===id);
  if(!lesson)return false;
  const groups=lessonGroupNames(lesson);
  if(!confirm(`Удалить занятие ${formatDate(lesson.date)} «${lesson.topic||'Без темы'}» и все его результаты?\nГруппы: ${groups}.\nОбъединённое занятие будет удалено из журналов всех перечисленных групп.`))return false;
  db.lessons=db.lessons.filter(l=>l.id!==id);
  db.results=db.results.filter(r=>r.lessonId!==id);
  db.layouts=db.layouts.filter(l=>l.lessonId!==id&&l.scopeKey!==`lesson:${id}`);
  if(state.lessonId===id){state.dirty=false;returnToJournal();}
  saveDB();
  renderMain();
  toast('Занятие удалено');
  return true;
}

function lessonEditModal(id=null,initialDate=null,fromCalendar=false){
  const l=id?db.lessons.find(x=>x.id===id):null;

  openModal(`
    <div class="modal-head">
      <h3>${l?'Редактировать занятие':'Новое занятие'}</h3>
    </div>

    <div class="modal-body">
      <div class="row">
        <div class="field">
          <label>Дата</label>
          <input type="date" id="lessonDateModal" value="${esc(l?.date||initialDate||calendarDateKey(new Date()))}">
        </div>
        <div class="field">
          <label>Часы</label>
          <input type="number" min="1" max="12" id="lessonHoursModal" value="${esc(l?.hours||'2')}">
        </div>
      </div>

      <div class="field" style="margin-top:10px">
        <label>Группы и подгруппы на занятии</label>
        <div class="group-choice-list">
          ${lessonTargetChoicesMarkup(
            l?lessonTargets(l):[{groupId:fromCalendar&&state.calendarGroup!=='all'?state.calendarGroup:state.groupId,subgroupId:null}],
            'lessonTargetChoice'
          )}
        </div>
        <div class="hint">Можно объединять целые группы и отдельные подгруппы в одном занятии.</div>
      </div>

      <div class="field" style="margin-top:10px">
        <label>Тема занятия</label>
        <textarea id="lessonTopicModal" rows="3">${esc(l?.topic||'')}</textarea>
      </div>

      <div class="field" style="margin-top:10px">
        <label>Вид занятия</label>
        <select id="lessonTypeModal">
          ${lessonTypeOptions(l?.typeId,l?.type)}
        </select>
      </div>
    </div>

    <div class="modal-foot">
      <button class="btn" id="cancelLessonModal">Отмена</button>
      <button class="btn primary" id="saveLessonModal">Сохранить</button>
    </div>
  `,true);

  wireLessonTargetChoices('lessonTargetChoice');
  document.getElementById('cancelLessonModal').onclick=()=>{
    if(fromCalendar)closeModal();else settingsModal('lessons');
  };

  document.getElementById('saveLessonModal').onclick=()=>{
    const targets=selectedLessonTargets('lessonTargetChoice');
    const typeId=document.getElementById('lessonTypeModal').value;
    const type=lessonTypeById(typeId);
    const groupIds=[...new Set(targets.map(t=>t.groupId))];
    const obj={
      date:document.getElementById('lessonDateModal').value,
      hours:document.getElementById('lessonHoursModal').value,
      topic:document.getElementById('lessonTopicModal').value.trim(),
      typeId,
      type:type?.name||'Занятие',
      targets,
      groupIds
    };

    if(!obj.date)return;
    if(!targets.length){
      toast('Выберите хотя бы одну группу или подгруппу');
      return;
    }

    const primary=groupIds.includes(state.groupId)?state.groupId:groupIds[0];

    if(l){
      Object.assign(l,obj,{groupId:primary});
    }else{
      db.lessons.push({
        id:uid('l'),
        groupId:primary,
        createdAt:Date.now(),
        ...obj
      });
    }

    saveDB();
    renderMain();
    if(fromCalendar)closeModal();else settingsModal('lessons');
    toast('Занятие сохранено');
  };
}


function renderLessonTypesSettings(){
  const types=db.lessonTypes.slice().sort((a,b)=>a.order-b.order);

  return `
    <div class="settings-section">
      <h4>Типы занятий</h4>

      <div class="row" style="align-items:end;margin-bottom:12px">
        <div class="field">
          <label>Название нового типа</label>
          <input id="newLessonTypeName" placeholder="Например: Семинар">
        </div>
        <div style="display:flex;gap:8px;align-items:end">
          <div class="field" style="min-width:90px">
            <label>Обозначение</label>
            <input id="newLessonTypePrefix" maxlength="12" placeholder="Например: А" style="width:100px">
          </div>
          <div class="field" style="min-width:70px">
            <label>Цвет</label>
            <input type="color" id="newLessonTypeColor" value="#d97706">
          </div>
          <button class="btn primary" id="addLessonTypeBtn">Добавить</button>
        </div>
      </div>

      <div class="hint" style="margin-bottom:10px">
        Номер слева соответствует кнопке фильтра на главной странице. Кнопка 0 всегда означает «Все занятия». Обозначение над датой: Л1, ПР1, ЛР1, А1. Нумерация отдельная для каждого типа внутри группы, по датам; подгруппы используют общую последовательность группы.
      </div>

      <div class="settings-list">
        ${types.map((t,i)=>`
          <div class="settings-row type-row">
            <div class="type-number" style="border-color:${esc(t.color)};color:${esc(t.color)}">${i+1}</div>
            <input type="text" class="type-name-input" data-id="${t.id}" value="${esc(t.name)}">
            <input type="text" class="type-prefix-input" maxlength="12" aria-label="Обозначение типа" title="Буквы перед номером занятия" data-id="${t.id}" value="${esc(t.prefix??defaultTypePrefix(t.name,t.id))}">
            <input type="color" class="type-color-input" data-id="${t.id}" value="${esc(t.color)}">
            <div class="actions">
              <button class="btn save-type" data-id="${t.id}">Сохранить</button>
              <button class="btn danger delete-type" data-id="${t.id}">Удалить</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function wireLessonTypesSettings(){
  document.getElementById('addLessonTypeBtn').onclick=()=>{
    const name=document.getElementById('newLessonTypeName').value.trim();
    const color=document.getElementById('newLessonTypeColor').value;
    if(!name)return;
    if(db.lessonTypes.some(t=>t.name.toLowerCase()===name.toLowerCase())){
      toast('Тип с таким названием уже существует');
      return;
    }
    db.lessonTypes.push({
      id:uid('type'),
      name,
      prefix:document.getElementById('newLessonTypePrefix').value.trim()||defaultTypePrefix(name),
      color,
      order:db.lessonTypes.length+1
    });
    saveDB();
    renderMain();
    renderSettingsContent();
    toast('Тип занятия добавлен');
  };

  document.querySelectorAll('.save-type').forEach(btn=>{
    btn.onclick=()=>{
      const type=db.lessonTypes.find(t=>t.id===btn.dataset.id);
      if(!type)return;
      const name=document.querySelector(`.type-name-input[data-id="${type.id}"]`).value.trim();
      const color=document.querySelector(`.type-color-input[data-id="${type.id}"]`).value;
      if(!name)return;

      type.name=name;
      type.prefix=document.querySelector(`.type-prefix-input[data-id="${type.id}"]`).value.trim();
      type.color=color;
      db.lessons.forEach(l=>{
        if(l.typeId===type.id)l.type=type.name;
      });

      saveDB();
      renderMain();
      renderSettingsContent();
      toast('Тип занятия обновлён');
    };
  });

  document.querySelectorAll('.delete-type').forEach(btn=>{
    btn.onclick=()=>{
      const type=db.lessonTypes.find(t=>t.id===btn.dataset.id);
      if(!type)return;
      const used=db.lessons.filter(l=>lessonTypeId(l)===type.id).length;

      if(used){
        alert(`Тип «${type.name}» используется в занятиях: ${used}. Сначала назначьте этим занятиям другой тип.`);
        return;
      }
      if(db.lessonTypes.length<=1){
        toast('Должен остаться хотя бы один тип занятия');
        return;
      }
      if(!confirm(`Удалить тип «${type.name}»?`))return;

      db.lessonTypes=db.lessonTypes
        .filter(t=>t.id!==type.id)
        .map((t,i)=>({...t,order:i+1}));

      if(state.lessonFilter===type.id)state.lessonFilter='all';
      saveDB();
      renderMain();
      renderSettingsContent();
      toast('Тип занятия удалён');
    };
  });
}
