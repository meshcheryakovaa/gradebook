function scheduleYandexAutoPush(){
  clearTimeout(yandexAutoTimer);
  if(!yadisk.autoSync||!yadisk.accessToken||state.dirty)return;

  yandexAutoTimer=setTimeout(async()=>{
    if(yandexSyncBusy){scheduleYandexAutoPush();return;}
    if(!navigator.onLine)return;
    yandexSyncBusy=true;
    try{
      await yandexUploadSnapshot(true);
    }catch(e){
      console.warn('Yandex auto sync:',e);
    }finally{
      yandexSyncBusy=false;
    }
  },2200);
}

window.addEventListener('online',()=>{
  if(yadisk.autoSync&&yadisk.accessToken){
    if(yandexSyncBusy)return;
    yandexSyncBusy=true;
    yandexSyncNow(true).catch(e=>console.warn('Yandex sync:',e)).finally(()=>{yandexSyncBusy=false;});
  }
});

function openCommentPopover(anchor,comment,studentName,dateText){
  const pop=document.getElementById('commentPopover');
  document.getElementById('commentPopoverTitle').textContent=studentName;
  document.getElementById('commentPopoverMeta').textContent=dateText?`Комментарий · ${dateText}`:'Комментарий';
  document.getElementById('commentPopoverBody').textContent=
    String(comment||'').trim()||'Комментарий не добавлен.';

  pop.classList.add('show');

  const rect=anchor.getBoundingClientRect();
  const pad=10;
  const width=Math.min(330,window.innerWidth-24);
  let left=rect.left+(rect.width/2)-(width/2);
  left=Math.max(12,Math.min(left,window.innerWidth-width-12));

  pop.style.width=width+'px';
  pop.style.left=left+'px';
  pop.style.top='12px';

  requestAnimationFrame(()=>{
    const ph=pop.getBoundingClientRect().height;
    let top=rect.bottom+8;
    if(top+ph>window.innerHeight-12){
      top=rect.top-ph-8;
    }
    top=Math.max(12,Math.min(top,window.innerHeight-ph-12));
    pop.style.top=top+'px';
  });
}

function closeCommentPopover(){
  document.getElementById('commentPopover').classList.remove('show');
}

function exportDB(){
  const payload={...db,exportedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`journal_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('База экспортирована');
}

async function importDB(file){
  try{
    const data=JSON.parse(await file.text());

    if(
      !data||
      !Array.isArray(data.groups)||
      !Array.isArray(data.students)||
      !Array.isArray(data.lessons)||
      !Array.isArray(data.results)
    ){
      throw new Error();
    }

    if(!confirm('Импорт заменит текущую базу. Продолжить?'))return;

    db=normalizeDB(data);
    state.groupId=db.groups[0]?.id||null;
    closeEditingPages();
    saveDB();
    renderMain();
    toast('База импортирована');
  }catch(e){
    alert('Не удалось импортировать файл: неверный формат базы.');
  }
}

function resetDB(){
  if(!confirm('Полностью удалить все группы, студентов, занятия и результаты?'))return;
  db=clone(defaultDB);
  state.groupId=null;
  closeEditingPages();
  saveDB();
  renderMain();
  toast('База очищена');
}

/* events */
document.getElementById('groupSelect').onchange=e=>{
  state.groupId=e.target.value;
  renderMain();
};

document.getElementById('subjectInput').onchange=e=>{
  db.settings.subject=e.target.value.trim();
  saveDB();
  renderJournal();
};

document.getElementById('yearInput').onchange=e=>{
  db.settings.year=e.target.value.trim();
  saveDB();
  renderJournal();
};

const fullscreenBtn=document.getElementById('fullscreenBtn');

async function toggleFullscreen(){
  try{
    if(!(document.fullscreenElement||document.webkitFullscreenElement)){
      const target=document.documentElement;
      if(target.requestFullscreen){
        await target.requestFullscreen();
      }else if(target.webkitRequestFullscreen){
        target.webkitRequestFullscreen();
      }else{
        alert('Полноэкранный режим не поддерживается этим браузером.');
      }
    }else{
      if(document.exitFullscreen){
        await document.exitFullscreen();
      }else if(document.webkitExitFullscreen){
        document.webkitExitFullscreen();
      }
    }
  }catch(err){
    alert('Браузер не разрешил открыть полноэкранный режим.');
  }
}

function updateFullscreenButton(){
  const active=!!(document.fullscreenElement||document.webkitFullscreenElement);
  fullscreenBtn.textContent=active?'⛶ Выйти':'⛶ На весь экран';
  fullscreenBtn.title=active?'Вернуться к обычному режиму':'Скрыть панели браузера и открыть журнал на весь экран';
}

fullscreenBtn.onclick=toggleFullscreen;
document.addEventListener('fullscreenchange',updateFullscreenButton);
document.addEventListener('webkitfullscreenchange',updateFullscreenButton);

function prepareJournalPrint(){
  let target=document.getElementById('printJournal');
  if(!target){target=document.createElement('div');target.id='printJournal';document.body.appendChild(target);}
  target.className='measuring';
  target.innerHTML=`<div class="print-sheet">${document.getElementById('journalView').innerHTML}</div>`;
  const sheet=target.firstElementChild;
  const mm=96/25.4, availableHeight=274*mm, availableWidth=190*mm;
  // Reduce row padding first, preserving font size for a typical 31-student group.
  for(let pad=2;pad>=0.39;pad-=0.2){
    sheet.style.setProperty('--print-pad',`${pad.toFixed(1)}mm`);
    if(sheet.getBoundingClientRect().height<=availableHeight)break;
  }
  const width=Math.max(sheet.scrollWidth,sheet.getBoundingClientRect().width);
  const height=sheet.getBoundingClientRect().height;
  sheet.style.setProperty('--print-scale',String(Math.min(1,availableWidth/width,availableHeight/height)));
  target.className='';
}
window.addEventListener('beforeprint',prepareJournalPrint);
window.addEventListener('afterprint',()=>document.getElementById('printJournal')?.remove());
document.getElementById('printBtn').onclick=()=>{prepareJournalPrint();window.print();};
document.getElementById('quickAddLessonBtn').onclick=quickAddLesson;

document.getElementById('lessonFilters').onclick=e=>{
  const btn=e.target.closest('.lesson-filter');
  if(!btn)return;
  state.lessonFilter=btn.dataset.filter;
  renderLessonFilters();
  renderJournal();
  renderMainView();
};

document.getElementById('settingsBtn').onclick=e=>{
  e.stopPropagation();
  document.getElementById('settingsMenu').classList.toggle('show');
};

document.addEventListener('click',e=>{
  if(!e.target.closest('.menu-wrap')){
    document.getElementById('settingsMenu').classList.remove('show');
  }
  if(!e.target.closest('#commentPopover')&&!e.target.closest('[data-comment-sid][data-comment-lid]')){
    closeCommentPopover();
  }
});

document.getElementById('commentPopoverClose').onclick=closeCommentPopover;
window.addEventListener('resize',closeCommentPopover);
window.addEventListener('scroll',closeCommentPopover,true);

document.getElementById('settingsMenu').onclick=e=>{
  const btn=e.target.closest('[data-action]');
  if(!btn)return;

  const action=btn.dataset.action;
  document.getElementById('settingsMenu').classList.remove('show');

  if(action==='open-settings-groups')settingsModal('groups');
  if(action==='open-settings-students')settingsModal('students');
  if(action==='open-settings-lessons')settingsModal('lessons');
  if(action==='export')exportDB();
  if(action==='import')document.getElementById('importFile').click();
  if(action==='yadisk')yandexDiskModal();
  if(action==='theme'){
    const current=document.documentElement.dataset.theme||'light';
    db.settings.theme=current==='dark'?'light':'dark';
    applyTheme(db.settings.theme);
    saveDB();
  }
  if(action==='reset')resetDB();
};

document.getElementById('importFile').onchange=async e=>{
  const file=e.target.files?.[0];
  if(file)await importDB(file);
  e.target.value='';
};

document.getElementById('backToJournalBtn').onclick=returnToJournal;
document.getElementById('backFromStudentBtn').onclick=returnFromStudent;
document.getElementById('saveStudentResultsBtn').onclick=saveStudentPage;
document.getElementById('previousStudentBtn').onclick=()=>navigateStudent(-1);
document.getElementById('nextStudentBtn').onclick=()=>navigateStudent(1);
document.getElementById('journalView').addEventListener('click',e=>{
  const button=e.target.closest('[data-open-student]');
  if(button)openStudent(button.dataset.openStudent);
});
document.getElementById('lessonResultsView').addEventListener('click',e=>{
  const button=e.target.closest('[data-open-student]');
  if(button)openStudent(button.dataset.openStudent);
});
document.getElementById('saveLessonResultsBtn').onclick=saveLessonPage;
document.getElementById('copyLessonGradesBtn').onclick=copyLessonGrades;
document.getElementById('pasteLessonGradesBtn').onclick=pasteLessonGrades;
document.getElementById('deleteLessonBtn').onclick=()=>deleteLesson(state.lessonId);

document.getElementById('lessonViewTableBtn').onclick=()=>switchLessonView('table');
document.getElementById('lessonViewMatrixBtn').onclick=()=>switchLessonView('matrix');
document.getElementById('matrixArrangeBtn').onclick=()=>switchMatrixMode('arrange');
document.getElementById('matrixConductBtn').onclick=()=>switchMatrixMode('conduct');

['lessonDateInput','lessonHoursInput','lessonTypeInput','lessonTopicInput'].forEach(id=>{
  document.getElementById(id).addEventListener('input',()=>{
    syncLessonDraftFromFields();
    markDirty();
    if(id==='lessonDateInput'||id==='lessonTopicInput'){
      document.getElementById('lessonPageTitle').textContent=
        `${formatDate(state.lessonDraft.date)} · ${state.lessonDraft.topic||'Занятие'}`;
    }
  });
  document.getElementById(id).addEventListener('change',()=>{
    syncLessonDraftFromFields();
    markDirty();
  });
});

document.getElementById('modalBackdrop').onclick=e=>{
  if(e.target.id==='modalBackdrop')closeModal();
};

window.addEventListener('beforeunload',e=>{
  if(state.dirty){
    e.preventDefault();
    e.returnValue='';
  }
});

renderMain();
