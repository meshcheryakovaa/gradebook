function openModal(content,small=false){
  const modal=document.getElementById('modal');
  modal.className='modal'+(small?' small':'');
  modal.innerHTML=content;
  document.getElementById('modalBackdrop').classList.add('show');
}
function closeModal(){
  document.getElementById('modalBackdrop').classList.remove('show');
}

function settingsModal(tab='groups'){
  state.settingsTab=tab;

  openModal(`
    <div class="modal-head">
      <h3>Настройки журнала</h3>
      <button class="btn" id="closeSettings">Закрыть</button>
    </div>

    <div class="modal-body">
      <div class="settings-grid">
        <div class="settings-nav">
          <button data-tab="groups">Группы</button>
          <button data-tab="students">Студенты</button>
          <button data-tab="lessons">Занятия</button>
          <button data-tab="types">Типы занятий</button>
          <button data-tab="general">Общие</button>
        </div>

        <div id="settingsContent"></div>
      </div>
    </div>
  `);

  document.getElementById('closeSettings').onclick=closeModal;

  document.querySelectorAll('.settings-nav button').forEach(b=>{
    b.onclick=()=>{
      state.settingsTab=b.dataset.tab;
      renderSettingsContent();
    };
  });

  renderSettingsContent();
}

function renderSettingsContent(){
  document.querySelectorAll('.settings-nav button').forEach(b=>{
    b.classList.toggle('active',b.dataset.tab===state.settingsTab);
  });

  const el=document.getElementById('settingsContent');
  if(!el)return;

  if(state.settingsTab==='groups'){
    el.innerHTML=renderGroupsSettings();
    wireGroupSettings();
  }else if(state.settingsTab==='students'){
    el.innerHTML=renderStudentsSettings();
    wireStudentSettings();
  }else if(state.settingsTab==='lessons'){
    el.innerHTML=renderLessonsSettings();
    wireLessonSettings();
  }else if(state.settingsTab==='types'){
    el.innerHTML=renderLessonTypesSettings();
    wireLessonTypesSettings();
  }else{
    el.innerHTML=renderGeneralSettings();
    wireGeneralSettings();
  }
}

function renderGroupsSettings(){
  return `
    <div class="settings-section">
      <h4>Группы и подгруппы</h4>

      <div class="field" style="max-width:420px;margin-bottom:12px">
        <label>Новая группа</label>
        <div style="display:flex;gap:8px">
          <input id="newGroupName" placeholder="ТО-1-26р" style="flex:1">
          <button class="btn primary" id="addGroupSettingsBtn">Добавить</button>
        </div>
      </div>

      <div class="settings-list">
        ${db.groups.length?db.groups.map(g=>`
          <div class="settings-row" style="align-items:flex-start">
            <div style="min-width:0;flex:1">
              <div class="name"><b>${esc(g.name)}</b></div>
              <div class="hint">
                ${studentsOf(g.id).length} студ. · ${subgroupsOf(g.id).length} подгр.
              </div>

              <div class="subgroup-list">
                ${subgroupsOf(g.id).map(s=>`
                  <span class="subgroup-chip">
                    ${esc(s.name)}
                    <button class="edit-subgroup" data-gid="${g.id}" data-sid="${s.id}" title="Переименовать">✎</button>
                    <button class="delete-subgroup" data-gid="${g.id}" data-sid="${s.id}" title="Удалить">×</button>
                  </span>
                `).join('')}
                <button class="btn add-subgroup" data-gid="${g.id}" style="padding:4px 8px">+ Подгруппа</button>
              </div>
            </div>
            <div class="actions">
              <button class="btn edit-group" data-id="${g.id}">Переименовать</button>
              <button class="btn danger del-group" data-id="${g.id}">Удалить</button>
            </div>
          </div>
        `).join(''):'<div class="empty" style="padding:30px 10px">Групп пока нет.</div>'}
      </div>
    </div>
  `;
}
function wireGroupSettings(){
  document.getElementById('addGroupSettingsBtn').onclick=()=>{
    const inp=document.getElementById('newGroupName');
    const name=inp.value.trim();
    if(!name)return;
    const g={id:uid('g'),name,subgroups:[]};
    db.groups.push(g);
    state.groupId=g.id;
    saveDB();
    renderMain();
    renderSettingsContent();
    toast('Группа добавлена');
  };

  document.querySelectorAll('.add-subgroup').forEach(b=>{
    b.onclick=()=>{
      const g=db.groups.find(x=>x.id===b.dataset.gid);
      if(!g)return;
      const name=prompt('Название подгруппы:',`Подгруппа ${subgroupsOf(g.id).length+1}`);
      if(name===null||!name.trim())return;
      g.subgroups=g.subgroups||[];
      g.subgroups.push({
        id:uid('sg'),
        name:name.trim(),
        order:g.subgroups.length+1
      });
      saveDB();
      renderSettingsContent();
      toast('Подгруппа добавлена');
    };
  });

  document.querySelectorAll('.edit-subgroup').forEach(b=>{
    b.onclick=()=>{
      const g=db.groups.find(x=>x.id===b.dataset.gid);
      const s=g?.subgroups?.find(x=>x.id===b.dataset.sid);
      if(!s)return;
      const name=prompt('Новое название подгруппы:',s.name);
      if(name===null||!name.trim())return;
      s.name=name.trim();
      saveDB();
      renderMain();
      renderSettingsContent();
    };
  });

  document.querySelectorAll('.delete-subgroup').forEach(b=>{
    b.onclick=()=>{
      const g=db.groups.find(x=>x.id===b.dataset.gid);
      const s=g?.subgroups?.find(x=>x.id===b.dataset.sid);
      if(!g||!s)return;

      const count=db.students.filter(st=>st.groupId===g.id&&st.subgroupId===s.id).length;
      if(!confirm(
        `Удалить подгруппу "${s.name}"? `+
        `${count?`У ${count} студентов назначение подгруппы будет снято. `:''}`+
        `Занятия этой подгруппы будут переведены на всю группу.`
      ))return;

      g.subgroups=g.subgroups.filter(x=>x.id!==s.id);
      db.students.forEach(st=>{
        if(st.groupId===g.id&&st.subgroupId===s.id)st.subgroupId=null;
      });

      db.lessons.forEach(l=>{
        let changed=false;
        l.targets=lessonTargets(l).map(t=>{
          if(t.groupId===g.id&&t.subgroupId===s.id){
            changed=true;
            return {groupId:g.id,subgroupId:null};
          }
          return t;
        });
        if(changed){
          l.targets=normalizeTargets(l.targets);
          l.groupIds=lessonGroupIds(l);
          if(!l.groupIds.includes(l.groupId))l.groupId=l.groupIds[0]||null;
        }
      });

      saveDB();
      renderMain();
      renderSettingsContent();
      toast('Подгруппа удалена');
    };
  });

  document.querySelectorAll('.edit-group').forEach(b=>{
    b.onclick=()=>{
      const g=db.groups.find(x=>x.id===b.dataset.id);
      if(!g)return;
      const name=prompt('Новое название группы:',g.name);
      if(name===null)return;
      const v=name.trim();
      if(!v)return;
      g.name=v;
      saveDB();
      renderMain();
      renderSettingsContent();
    };
  });

  document.querySelectorAll('.del-group').forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.id;
      const g=db.groups.find(x=>x.id===id);
      if(!g)return;
      if(!confirm(`Удалить группу "${g.name}" и её студентов? Совместные занятия сохранятся у остальных групп.`))return;

      const studentIds=new Set(db.students.filter(s=>s.groupId===id).map(s=>s.id));
      const deletedLessonIds=new Set();
      const keptLessons=[];

      db.lessons.forEach(l=>{
        const remaining=lessonTargets(l).filter(t=>t.groupId!==id);
        if(!remaining.length){
          deletedLessonIds.add(l.id);
          return;
        }
        l.targets=normalizeTargets(remaining);
        l.groupIds=lessonGroupIds(l);
        if(!l.groupIds.includes(l.groupId))l.groupId=l.groupIds[0]||null;
        keptLessons.push(l);
      });

      db.groups=db.groups.filter(x=>x.id!==id);
      db.students=db.students.filter(s=>s.groupId!==id);
      db.lessons=keptLessons;
      db.results=db.results.filter(r=>!studentIds.has(r.studentId)&&!deletedLessonIds.has(r.lessonId));

      db.layouts=db.layouts.filter(layout=>
        layout.groupId!==id &&
        !(layout.lessonId&&deletedLessonIds.has(layout.lessonId))
      );
      db.layouts.forEach(layout=>{
        Object.keys(layout.seats||{}).forEach(k=>{
          if(studentIds.has(layout.seats[k]))delete layout.seats[k];
        });
      });

      state.groupId=db.groups[0]?.id||null;
      saveDB();
      renderMain();
      renderSettingsContent();
    };
  });
}
function renderStudentsSettings(){
  const gid=state.groupId;
  const g=currentGroup();

  return `
    <div class="settings-section">
      <h4>Студенты</h4>

      ${db.groups.length?`
        <div class="field" style="max-width:360px;margin-bottom:12px">
          <label>Группа</label>
          <select id="settingsStudentGroup">
            ${db.groups.map(x=>`
              <option value="${x.id}" ${x.id===gid?'selected':''}>${esc(x.name)}</option>
            `).join('')}
          </select>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn primary" id="addOneStudentBtn">+ Студент</button>
          <button class="btn" id="bulkAddStudentsBtn">Вставить список</button>
        </div>

        <div class="settings-list">
          ${studentsOf(gid).length?studentsOf(gid).map((s,i)=>`
            <div class="settings-row">
              <div class="name">
                ${i+1}. ${esc(s.name)}
                ${s.subgroupId?`<span class="student-group-tag">${esc(subgroupName(gid,s.subgroupId))}</span>`:''}
              </div>
              <div class="actions">
                <button class="btn edit-student" data-id="${s.id}">Изменить</button>
                <button class="btn danger del-student" data-id="${s.id}">Удалить</button>
              </div>
            </div>
          `).join(''):'<div class="empty" style="padding:30px 10px">В выбранной группе студентов нет.</div>'}
        </div>
      `:'<div class="empty" style="padding:30px 10px">Сначала создайте группу.</div>'}
    </div>
  `;
}

function wireStudentSettings(){
  const sel=document.getElementById('settingsStudentGroup');
  if(sel){
    sel.onchange=()=>{
      state.groupId=sel.value;
      renderMain();
      renderSettingsContent();
    };
  }

  const addBtn=document.getElementById('addOneStudentBtn');
  if(addBtn){
    addBtn.onclick=()=>studentEditModal();
  }

  const bulkBtn=document.getElementById('bulkAddStudentsBtn');
  if(bulkBtn){
    bulkBtn.onclick=()=>bulkStudentModal();
  }

  document.querySelectorAll('.edit-student').forEach(b=>{
    b.onclick=()=>studentEditModal(b.dataset.id);
  });

  document.querySelectorAll('.del-student').forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.id;
      if(!confirm('Удалить студента и все его результаты?'))return;
      db.students=db.students.filter(s=>s.id!==id);
      db.results=db.results.filter(r=>r.studentId!==id);
      db.layouts.forEach(layout=>{
        Object.keys(layout.seats||{}).forEach(k=>{
          if(layout.seats[k]===id)delete layout.seats[k];
        });
      });
      saveDB();
      renderMain();
      renderSettingsContent();
    };
  });
}

function studentEditModal(id=null){
  const s=id?db.students.find(x=>x.id===id):null;
  openModal(`
    <div class="modal-head">
      <h3>${s?'Редактировать студента':'Новый студент'}</h3>
    </div>
    <div class="modal-body">
      <div class="field">
        <label>ФИО</label>
        <input id="studentNameModal" value="${esc(s?.name||'')}" placeholder="Фамилия Имя Отчество">
      </div>
      <div class="field" style="margin-top:10px">
        <label>Подгруппа</label>
        <select id="studentSubgroupModal">
          <option value="">— Без подгруппы —</option>
          ${subgroupsOf(state.groupId).map(sg=>`
            <option value="${sg.id}" ${s?.subgroupId===sg.id?'selected':''}>${esc(sg.name)}</option>
          `).join('')}
        </select>
      </div>
      <div class="field" style="margin-top:10px">
        <label>Примечание</label>
        <input id="studentNoteModal" value="${esc(s?.note||'')}">
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" id="cancelStudentModal">Отмена</button>
      <button class="btn primary" id="saveStudentModal">Сохранить</button>
    </div>
  `,true);

  document.getElementById('cancelStudentModal').onclick=()=>settingsModal('students');

  document.getElementById('saveStudentModal').onclick=()=>{
    const name=document.getElementById('studentNameModal').value.trim();
    const note=document.getElementById('studentNoteModal').value.trim();
    const subgroupId=document.getElementById('studentSubgroupModal').value||null;
    if(!name)return;

    if(s){
      s.name=name;
      s.note=note;
      s.subgroupId=subgroupId;
    }else{
      db.students.push({
        id:uid('s'),
        groupId:state.groupId,
        subgroupId,
        name,
        note,
        order:studentsOf(state.groupId).length
      });
    }

    saveDB();
    renderMain();
    settingsModal('students');
    toast('Сохранено');
  };
}
