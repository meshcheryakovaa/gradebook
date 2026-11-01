/* Dependency-free field MV-register with causal version vectors. No wall-clock ordering.
 * Transport stores immutable packets; see docs/SYNC-V14.md for the protocol. */
(function(root){
  'use strict';
  const tables=['groups','students','lessonTypes','lessons','results','layouts'];
  const copy=x=>JSON.parse(JSON.stringify(x));
  const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const safe=s=>typeof s==='string'&&s.length>0&&!['__proto__','prototype','constructor'].includes(s);
  function jsonSafe(x){
    if(x===null||typeof x==='string'||typeof x==='boolean')return true;
    if(typeof x==='number')return Number.isFinite(x);
    if(Array.isArray(x))return x.every(jsonSafe);
    return !!x&&typeof x==='object'&&Object.entries(x).every(([k,v])=>safe(k)&&jsonSafe(v));
  }
  function identity(table,row){
    if(table==='results')return JSON.stringify([row.studentId,row.lessonId]);
    if(table==='layouts')return row.scopeKey||(row.lessonId?`lesson:${row.lessonId}`:`group:${row.groupId}`);
    return row.id;
  }
  function flatten(db){
    const map=new Map();
    for(const table of [...tables,'settings']){
      const rows=table==='settings'?[db.settings||{}]:(db[table]||[]);
      for(const row of rows){
        const id=table==='settings'?'settings':identity(table,row);
        if(!safe(id)||!jsonSafe(row))throw Error('Некорректная запись '+table);
        map.set(JSON.stringify([table,id,'$exists']),true);
        for(const [field,value] of Object.entries(row)){
          if(table==='layouts'&&field==='id')continue;
          if(field==='$exists')throw Error('Зарезервированное поле');
          map.set(JSON.stringify([table,id,field]),value);
        }
      }
    }
    return map;
  }
  function difference(before,after){
    const a=flatten(before),b=flatten(after),changes=new Map();
    const touched=new Set();
    for(const key of new Set([...a.keys(),...b.keys()])){
      const [table,id,field]=JSON.parse(key),exist=JSON.stringify([table,id,'$exists']);
      if(!b.has(exist)){
        if(field==='$exists')changes.set(key,{key,value:false});
        continue;
      }
      if(stable(a.get(key))===stable(b.get(key)))continue;
      changes.set(key,b.has(key)?{key,value:copy(b.get(key))}:{key,unset:true});
      // An update concurrent with deletion must remain a visible conflict.
      changes.set(exist,{key:exist,value:true});
      touched.add(JSON.stringify([table,id]));
    }
    // Keep ancestor deletions visible when another peer edits/creates a child.
    // Otherwise a newly entered grade could survive only as an invisible orphan.
    const visited=new Set();
    function retain(table,id,subgroup){
      if(!id)return;
      const key=JSON.stringify([table,id,'$exists']);
      if(!b.has(key))return;
      changes.set(key,{key,value:true});
      if(subgroup&&table==='groups'){
        const field=JSON.stringify([table,id,'subgroups']);
        if(b.has(field))changes.set(field,{key:field,value:copy(b.get(field))});
      }
      follow(table,id);
    }
    function follow(table,id){
      if(table==='settings')return;
      const key=JSON.stringify([table,id]);if(visited.has(key))return;visited.add(key);
      const row=(after[table]||[]).find(r=>identity(table,r)===id);
      if(!row)return;
      if(table==='students')retain('groups',row.groupId,row.subgroupId);
      if(table==='results'){retain('students',row.studentId);retain('lessons',row.lessonId);}
      if(table==='lessons'){
        retain('lessonTypes',row.typeId);retain('groups',row.groupId);
        for(const target of row.targets||[])retain('groups',target.groupId,target.subgroupId);
        for(const groupId of row.groupIds||[])retain('groups',groupId);
      }
      if(table==='layouts'){
        retain('groups',row.groupId);retain('lessons',row.lessonId);
        for(const studentId of Object.values(row.seats||{}))retain('students',studentId);
      }
    }
    for(const key of touched){const [table,id]=JSON.parse(key);follow(table,id);}
    return [...changes.values()];
  }
  function validate(event){
    if(!event||event.schema!==14||!safe(event.actor)||!Number.isSafeInteger(event.seq)||event.seq<1||
      event.id!==event.actor+':'+event.seq||!jsonSafe(event.context)||Array.isArray(event.context)||
      !event.context||typeof event.author!=='string'||!Array.isArray(event.changes)||!event.changes.length)
      throw Error('Повреждённый пакет изменений');
    for(const [actor,seq] of Object.entries(event.context)){
      if(!safe(actor)||!Number.isSafeInteger(seq)||seq<0||actor===event.actor&&seq!==event.seq-1)
        throw Error('Некорректные причинные зависимости');
    }
    if((event.context[event.actor]||0)!==event.seq-1)throw Error('Пропущена предыдущая операция');
    const seen=new Set();
    for(const change of event.changes){
      let key;try{key=JSON.parse(change.key);}catch(e){throw Error('Неверный ключ изменения');}
      if(!Array.isArray(key)||key.length!==3||!key.every(safe)||
        JSON.stringify(key)!==change.key||
        ![...tables,'settings'].includes(key[0])||seen.has(change.key)||
        !(change.unset===true||Object.hasOwn(change,'value')&&jsonSafe(change.value))||
        key[2]==='$exists'&&(typeof change.value!=='boolean'||change.unset))
        throw Error('Неверное изменение');
      if(key[0]==='results'){
        let tuple;try{tuple=JSON.parse(key[1]);}catch(e){throw Error('Неверная ссылка результата');}
        if(!Array.isArray(tuple)||tuple.length!==2||!tuple.every(safe))throw Error('Неверная ссылка результата');
      }
      seen.add(change.key);
    }
  }
  class Replica{
    constructor(actor,author,events=[]){
      if(!safe(actor))throw Error('Неверный идентификатор устройства');
      this.actor=actor;this.author=author;this.events=new Map();this.clock=Object.create(null);
      this.registers=new Map();this.merge(events);
    }
    merge(events){
      // Validate the complete incoming set before mutating the replica.
      const incoming=new Map();
      for(const event of events){
        validate(event);
        const old=this.events.get(event.id)||incoming.get(event.id);
        if(old&&stable(old)!==stable(event))throw Error('Повторный ID с другим содержимым');
        incoming.set(event.id,event);
      }
      const all=new Map([...this.events,...incoming]);
      // A partial listing must not let a client claim unseen causal changes.
      for(const event of incoming.values())for(const [actor,seq] of Object.entries(event.context)){
        if(seq&&!all.has(actor+':'+seq))throw Error('Не все зависимости загружены; повторите синхронизацию');
        const dependency=seq?all.get(actor+':'+seq):null;
        if(dependency)for(const [parent,n] of Object.entries(dependency.context)){
          if(n>(event.context[parent]||0))throw Error('Нарушен причинный порядок изменений');
        }
      }
      // Existing dependencies are complete; verify newly received actor chains too.
      for(const event of incoming.values())if(event.seq>1&&!all.has(event.actor+':'+(event.seq-1)))
        throw Error('Неполный журнал изменений');
      for(const raw of incoming.values()){
        if(this.events.has(raw.id))continue;
        const event=copy(raw);
        this.events.set(event.id,event);
        this.clock[event.actor]=Math.max(this.clock[event.actor]||0,event.seq);
        for(const change of event.changes){
          const current=this.registers.get(change.key)||[];
          if(current.some(c=>(c.event.context[event.actor]||0)>=event.seq))continue;
          const candidates=current.filter(c=>(event.context[c.event.actor]||0)<c.event.seq);
          candidates.push({event,change});
          candidates.sort((a,b)=>a.event.id<b.event.id?-1:a.event.id>b.event.id?1:0);
          this.registers.set(change.key,candidates);
        }
      }
      return this;
    }
    append(changes){
      if(!changes.length)return null;
      const seq=(this.clock[this.actor]||0)+1;
      const event={schema:14,id:this.actor+':'+seq,actor:this.actor,seq,context:{...this.clock},
        author:this.author,createdAt:new Date().toISOString(),changes:copy(changes)};
      this.merge([event]);return event;
    }
    capture(before,after){return this.append(difference(before,after));}
    list(){return [...this.events.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
    conflicts(){
      return [...this.registers].filter(([,c])=>new Set(c.map(x=>stable(x.change))).size>1)
        .map(([key,candidates])=>({key,candidates:copy(candidates)}));
    }
    resolve(key,eventId){
      const candidate=this.registers.get(key)?.find(c=>c.event.id===eventId);
      if(!candidate)throw Error('Вариант конфликта не найден');
      return this.append([candidate.change]);
    }
    materialize(){
      const records=new Map(),out={version:1,meta:{updatedAt:0},settings:{}};
      for(const table of tables)out[table]=[];
      for(const [key,candidates] of this.registers){
        const [table,id,field]=JSON.parse(key),rowKey=JSON.stringify([table,id]);
        if(!records.has(rowKey))records.set(rowKey,Object.create(null));
        const change=candidates[candidates.length-1].change;
        if(!change.unset)records.get(rowKey)[field]=copy(change.value);
      }
      for(const [key,row] of [...records].sort(([a],[b])=>a<b?-1:a>b?1:0)){
        if(!row.$exists)continue;
        delete row.$exists;
        const [table,id]=JSON.parse(key);
        if(table==='settings')out.settings=row;
        else{if(table==='layouts')row.id=id;out[table].push(row);}
      }
      return out;
    }
  }
  const api={Replica,flatten,difference,stable,validate};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GradebookSync=api;
})(globalThis);
