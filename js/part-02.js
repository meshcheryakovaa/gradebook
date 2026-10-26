function createDefaultLayoutForLesson(lesson){
  const targets=lessonTargets(lesson);
  return {
    id:uid('layout'),
    scopeKey:layoutScopeKeyForLesson(lesson),
    groupId:targets.length===1&&!targets[0].subgroupId?targets[0].groupId:null,
    lessonId:null,
    rows:4,
    cols:6,
    seats:{}
  };
}
function lessonTargetChoicesMarkup(selectedTargets=[],inputName='lessonTargetChoice'){
  const selected=new Set(
    normalizeTargets(selectedTargets).map(t=>`${t.groupId}|${t.subgroupId||''}`)
  );
  return db.groups
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'))
    .map(g=>{
      const wholeKey=`${g.id}|`;
      const subs=subgroupsOf(g.id);
      return `
        <div class="target-group-box" data-target-group="${g.id}">
          <label class="group-choice">
            <input
              type="checkbox"
              name="${inputName}"
              data-target-kind="group"
              data-group-id="${g.id}"
              value="${g.id}|"
              ${selected.has(wholeKey)?'checked':''}>
            <span><b>${esc(g.name)}</b> — вся группа</span>
          </label>
          ${subs.length?`
            <div class="target-subgroups">
              ${subs.map(s=>{
                const key=`${g.id}|${s.id}`;
                return `
                  <label class="group-choice">
                    <input
                      type="checkbox"
                      name="${inputName}"
                      data-target-kind="subgroup"
                      data-group-id="${g.id}"
                      data-subgroup-id="${s.id}"
                      value="${g.id}|${s.id}"
                      ${selected.has(key)?'checked':''}>
                    <span>${esc(s.name)}</span>
                  </label>
                `;
              }).join('')}
            </div>
          `:''}
        </div>
      `;
    }).join('');
}
function wireLessonTargetChoices(inputName){
  const boxes=[...document.querySelectorAll(`input[name="${inputName}"]`)];
  boxes.forEach(box=>{
    box.onchange=()=>{
      const gid=box.dataset.groupId;
      const same=boxes.filter(x=>x.dataset.groupId===gid);
      if(box.checked&&box.dataset.targetKind==='group'){
        same.filter(x=>x!==box).forEach(x=>x.checked=false);
      }else if(box.checked&&box.dataset.targetKind==='subgroup'){
        same.filter(x=>x.dataset.targetKind==='group').forEach(x=>x.checked=false);
      }
    };
  });
}
function selectedLessonTargets(inputName){
  return normalizeTargets(
    [...document.querySelectorAll(`input[name="${inputName}"]:checked`)]
      .map(x=>{
        const [groupId,subgroupId='']=x.value.split('|');
        return {groupId,subgroupId:subgroupId||null};
      })
  );
}
function lessonTypeById(id){
  return db.lessonTypes.find(t=>t.id===id)||null;
}
function lessonTypeForLesson(lesson){
  return lessonTypeById(lesson?.typeId) ||
    db.lessonTypes.find(t=>t.name===lesson?.type) ||
    db.lessonTypes[0] || null;
}
function lessonTypeId(lesson){
  return lessonTypeForLesson(lesson)?.id||'';
}
function lessonTypeName(lesson){
  return lessonTypeForLesson(lesson)?.name||lesson?.type||'Занятие';
}
function lessonTypeColor(lesson){
  return lessonTypeForLesson(lesson)?.color||'#68727d';
}
function lessonTypeOptions(selectedId='',selectedName=''){
  let sid=selectedId;
  if(!sid&&selectedName){
    sid=db.lessonTypes.find(t=>t.name===selectedName)?.id||'';
  }
  return db.lessonTypes
    .slice()
    .sort((a,b)=>a.order-b.order)
    .map(t=>`<option value="${t.id}" ${t.id===sid?'selected':''}>${esc(t.name)}</option>`)
    .join('');
}
function renderLessonFilters(){
  const wrap=document.getElementById('lessonFilters');
  if(!wrap)return;

  if(state.lessonFilter!=='all'&&!db.lessonTypes.some(t=>t.id===state.lessonFilter)){
    state.lessonFilter='all';
  }

  wrap.innerHTML=`
    <button class="lesson-filter all ${state.lessonFilter==='all'?'active':''}"
      data-filter="all" title="0 — Все занятия" aria-label="Все занятия">0</button>
    ${db.lessonTypes
      .slice()
      .sort((a,b)=>a.order-b.order)
      .map((t,i)=>`
        <button
          class="lesson-filter dynamic-type ${state.lessonFilter===t.id?'active':''}"
          data-filter="${t.id}"
          title="${i+1} — ${esc(t.name)}"
          aria-label="${esc(t.name)}"
          style="--type-color:${esc(t.color)}">${i+1}</button>
      `).join('')}
  `;
}

function seatKey(row,col){
  return `${row}:${col}`;
}
function studentSeatKey(layout,studentId){
  if(!layout||!layout.seats)return null;
  return Object.keys(layout.seats).find(k=>layout.seats[k]===studentId)||null;
}
function splitStudentName(name=''){
  const parts=String(name).trim().split(/\s+/).filter(Boolean);
  return {
    surname:parts[0]||'',
    first:parts[1]||parts[0]||'',
    rest:parts.slice(2).join(' ')
  };
}
function pointsText(count){
  const n=Math.max(0,Number(count)||0);
  const mod10=n%10, mod100=n%100;
  let word='баллов';
  if(mod10===1&&mod100!==11)word='балл';
  else if(mod10>=2&&mod10<=4&&(mod100<12||mod100>14))word='балла';
  return `${n} ${word}`;
}
function formatDate(s){
  if(!s)return '';
  const [y,m,d]=s.split('-');
  return `${d}.${m}.${y}`;
}
function journalDateParts(s){
  if(!s)return {day:'',month:''};
  const [,m,d]=s.split('-');
  const months=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return {
    day:String(Number(d)),
    month:months[Math.max(0,Math.min(11,Number(m)-1))]||''
  };
}
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  localStorage.setItem(THEME_KEY,theme);
  document.getElementById('themeMenuItem').textContent=
    theme==='dark'?'Светлая тема':'Тёмная тема';
}
db.settings.theme=db.settings.theme||localStorage.getItem(THEME_KEY)||'light';
applyTheme(db.settings.theme);

if(!db.meta?.updatedAt){
  db.meta=db.meta||{};
  db.meta.updatedAt=Date.now();
  saveDB(false);
}

function renderMain(){
  if(state.groupId&&!db.groups.some(g=>g.id===state.groupId)){
    state.groupId=db.groups[0]?.id||null;
  }

  const groupSelect=document.getElementById('groupSelect');
  groupSelect.innerHTML=db.groups.map(g=>
    `<option value="${g.id}" ${g.id===state.groupId?'selected':''}>${esc(g.name)}</option>`
  ).join('');
  groupSelect.disabled=!db.groups.length;

  document.getElementById('subjectInput').value=db.settings.subject||'';
  document.getElementById('yearInput').value=db.settings.year||'';

  renderLessonFilters();
  renderJournal();
  renderMainView();
}


function calendarParseDate(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return null;
  const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12);
  return calendarDateKey(date)===value?date:null;
}
function calendarAddDays(date,days){
  return new Date(date.getFullYear(),date.getMonth(),date.getDate()+days,12);
}
function calendarWeekStart(date){
  return calendarAddDays(date,-((date.getDay()+6)%7));
}
function calendarPeriod(){
  const anchor=calendarParseDate(state.calendarDate)||new Date();
  if(state.calendarMode==='week'){
    const start=calendarWeekStart(anchor);
    return {start,end:calendarAddDays(start,6),gridStart:start,days:7};
  }
  const start=new Date(anchor.getFullYear(),anchor.getMonth(),1,12);
  const end=new Date(anchor.getFullYear(),anchor.getMonth()+1,0,12);
  const gridStart=calendarWeekStart(start);
  const offset=(start.getDay()+6)%7;
  return {start,end,gridStart,days:Math.max(35,Math.ceil((offset+end.getDate())/7)*7)};
}
function calendarFilteredLessons(){
  // Work from the shared lesson list to avoid duplicate cards for combined groups.
  return db.lessons.filter(l=>calendarParseDate(l.date)&&
    (state.calendarGroup==='all'||lessonTargets(l).some(t=>t.groupId===state.calendarGroup))&&
    (state.calendarType==='all'||lessonTypeId(l)===state.calendarType)
  ).slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0)||a.id.localeCompare(b.id));
}
function calendarEventMarkup(lesson){
  const type=lessonTypeForLesson(lesson),color=lessonTypeColor(lesson);
  const groupNames=lessonGroupNames(lesson)||'Группы не указаны';
  const description=`${formatDate(lesson.date)} · ${lessonTypeName(lesson)} · ${lesson.topic||'Без темы'} · ${groupNames}`;
  return `<button type="button" class="calendar-event" data-calendar-lesson="${esc(lesson.id)}" style="--event-color:${color}" title="${esc(description)}" aria-label="${esc(description)}">
    <div class="calendar-event-type">${esc(type?.prefix||lessonTypeName(lesson))} · ${esc(lessonTypeName(lesson))}${lesson.hours?` · ${esc(lesson.hours)} ч.`:''}</div>
    <div class="calendar-event-topic">${esc(lesson.topic||'Без темы')}</div>
    <div class="calendar-event-groups">${esc(groupNames)}</div>
  </button>`;
}
function renderMainView(){
  const calendar=state.mainView==='calendar';
  document.getElementById('journalView').hidden=calendar;
  document.getElementById('journalToolbar').hidden=calendar;
  document.getElementById('calendarView').hidden=!calendar;
  ['mainJournalTab','mainCalendarTab'].forEach((id,i)=>{
    const active=i===Number(calendar),button=document.getElementById(id);
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  document.getElementById('printBtn').textContent=calendar?'Печать журнала A4':'Печать A4';
  if(calendar)renderCalendar();
}
function renderCalendar(){
  const root=document.getElementById('calendarView');
  if(state.calendarGroup!=='all'&&!db.groups.some(g=>g.id===state.calendarGroup))state.calendarGroup='all';
  if(state.calendarType!=='all'&&!db.lessonTypes.some(t=>t.id===state.calendarType))state.calendarType='all';
  if(!calendarParseDate(state.calendarDate))state.calendarDate=calendarDateKey(new Date());
  const lessons=calendarFilteredLessons(),period=calendarPeriod();
  const byDay=new Map();
  lessons.forEach(l=>{if(!byDay.has(l.date))byDay.set(l.date,[]);byDay.get(l.date).push(l);});
  const today=calendarDateKey(new Date()),isList=state.calendarMode==='list';
  const rangeStart=calendarDateKey(period.start),rangeEnd=calendarDateKey(period.end);
  const visibleLessons=isList?lessons:lessons.filter(l=>l.date>=rangeStart&&l.date<=rangeEnd);
  const hours=visibleLessons.reduce((sum,l)=>sum+(Number(l.hours)||0),0);
  const title=isList?'Все занятия':state.calendarMode==='week'
    ?`${period.start.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})} — ${period.end.toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'})}`
    :period.start.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  let content='';
  if(isList){
    content=byDay.size?`<div class="calendar-agenda">${[...byDay].map(([date,items])=>`
      <section class="calendar-agenda-day ${date===today?'is-today':''} ${date===state.calendarDate?'is-selected':''}" data-agenda-date="${date}">
        <div class="calendar-agenda-head"><div><h3>${esc(calendarParseDate(date).toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}${date===today?' · Сегодня':''}</h3><span>Занятий: ${items.length}</span></div><button type="button" class="calendar-day-add" data-calendar-add="${date}" aria-label="Добавить занятие ${formatDate(date)}">+</button></div>
        <div class="calendar-agenda-events">${items.map(calendarEventMarkup).join('')}</div>
      </section>`).join('')}</div>`:'<div class="empty">Занятий с выбранными фильтрами пока нет.</div>';
  }else{
    const week=state.calendarMode==='week';
    const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const days=Array.from({length:period.days},(_,i)=>{
      const date=calendarAddDays(period.gridStart,i),key=calendarDateKey(date),items=byDay.get(key)||[];
      const outside=!week&&(key<rangeStart||key>rangeEnd);
      const label=week?date.toLocaleDateString('ru-RU',{weekday:'short',day:'numeric',month:'short'}):String(date.getDate());
      return `<div class="calendar-day ${outside?'outside-month':''} ${key===today?'is-today':''} ${key===state.calendarDate?'is-selected':''}" data-calendar-date="${key}">
        <div class="calendar-day-top"><button type="button" class="calendar-day-date" data-calendar-day="${key}" aria-label="Занятия на ${formatDate(key)}">${esc(label)}${key===today?' · Сегодня':''}</button><button type="button" class="calendar-day-add" data-calendar-add="${key}" aria-label="Добавить занятие ${formatDate(key)}">+</button></div>
        ${items.map(calendarEventMarkup).join('')||'<div class="calendar-day-empty">Нет занятий</div>'}
      </div>`;
    }).join('');
    content=`<div class="calendar-scroll">${week?'':`<div class="calendar-weekdays">${weekdays.map(w=>`<div>${w}</div>`).join('')}</div>`}<div class="calendar-grid ${week?'week-grid':''}">${days}</div></div>`;
  }
  root.innerHTML=`
    <div class="calendar-controls">
      <div class="calendar-switch" aria-label="Вид календаря">
        ${[['month','Месяц'],['week','Неделя'],['list','Список']].map(([id,label])=>`<button type="button" class="view-btn ${state.calendarMode===id?'active':''}" data-calendar-mode="${id}" aria-pressed="${state.calendarMode===id}">${label}</button>`).join('')}
      </div>
      <div class="calendar-navigation">
        ${isList?'':`<button type="button" class="btn" data-calendar-nav="-1" aria-label="Предыдущий ${state.calendarMode==='week'?'период недели':'месяц'}">←</button>`}
        <button type="button" class="btn" data-calendar-today>Сегодня</button>
        ${isList?'':`<button type="button" class="btn" data-calendar-nav="1" aria-label="Следующий ${state.calendarMode==='week'?'период недели':'месяц'}">→</button>`}
      </div>
    </div>
    <div class="calendar-filters">
      <div class="field"><label for="calendarGroupFilter">Группа</label><select id="calendarGroupFilter"><option value="all">Все группы</option>${db.groups.map(g=>`<option value="${esc(g.id)}" ${state.calendarGroup===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="calendarTypeFilter">Тип занятия</label><select id="calendarTypeFilter"><option value="all">Все типы занятий</option>${db.lessonTypes.slice().sort((a,b)=>a.order-b.order).map(t=>`<option value="${esc(t.id)}" ${state.calendarType===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field" style="flex:0;min-width:160px"><label for="calendarDatePicker">${isList?'Перейти к дате':'Дата'}</label><input type="date" id="calendarDatePicker" value="${state.calendarDate}"></div>
    </div>
    <div class="calendar-heading"><div><h2 class="calendar-period">${esc(title)}</h2><div class="calendar-summary">Занятий: ${visibleLessons.length} · Часов: ${hours}${isList?' · Дней: '+byDay.size:''}</div></div><button type="button" class="btn primary" data-calendar-add="${state.calendarDate}" ${db.groups.length?'':'disabled'}>+ Занятие</button></div>
    ${content}
    <div class="calendar-legend">${db.lessonTypes.map(t=>`<span><i style="--event-color:${esc(t.color)}"></i>${esc(t.name)}</span>`).join('')}</div>
    <div class="hint">Нажмите на занятие, чтобы открыть его журнал. Нажатие на число дня открывает список с переходом к этому дню; «+» добавляет занятие на выбранную дату. Объединённые занятия показаны один раз.</div>`;
  document.getElementById('calendarGroupFilter').onchange=e=>{state.calendarGroup=e.target.value;renderCalendar();};
  document.getElementById('calendarTypeFilter').onchange=e=>{state.calendarType=e.target.value;renderCalendar();};
  document.getElementById('calendarDatePicker').onchange=e=>{
    if(!calendarParseDate(e.target.value))return;
    state.calendarDate=e.target.value;renderCalendar();if(isList)calendarScrollToDay();
  };
}
