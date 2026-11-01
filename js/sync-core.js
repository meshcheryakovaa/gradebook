/* Dependency-free field MV-register with causal version vectors. No wall-clock ordering.
 * Transport stores immutable packets; see docs/SYNC-V14.md for the protocol. */
(function(root){
  'use strict';
  const tables=['groups','students','lessonTypes','lessons','results','layouts'];
  const copy=x=>JSON.parse(JSON.stringify(x));
  const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  // Shared initial state. Every device creates the identical event and every other
  // operation implicitly follows it, so a late joiner cannot revert earlier edits.
  const GENESIS='genesis';
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
    const touched=new Map(); // record -> changed fields
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
      const row=JSON.stringify([table,id]);
      if(!touched.has(row))touched.set(row,new Set());
      touched.get(row).add(field);
    }
    // Keep ancestor deletions visible when another peer edits/creates a child.
    // Otherwise a newly entered grade could survive only as an invisible orphan.
    // The whole subgroups array is re-asserted only when a record's own subgroup reference
    // changed; re-asserting it for every grade conflicted with concurrent subgroup renames.
    const visited=new Set(touched.keys());
    function retain(table,id,subgroup){
      if(!id)return;
      const key=JSON.stringify([table,id,'$exists']);
      if(!b.has(key))return;
      changes.set(key,{key,value:true});
      if(subgroup&&table==='groups'){
        const field=JSON.stringify([table,id,'subgroups']);
        if(b.has(field))changes.set(field,{key:field,value:copy(b.get(field))});
      }
      const row=JSON.stringify([table,id]);
      if(!visited.has(row)){visited.add(row);follow(table,id,null);}
    }
    function follow(table,id,fields){
      if(table==='settings')return;
      const row=(after[table]||[]).find(r=>identity(table,r)===id);
      if(!row)return;
      const changed=name=>!!fields&&(fields.has(name)||fields.has('$exists'));
      if(table==='students')retain('groups',row.groupId,changed('subgroupId')||changed('groupId')?row.subgroupId:null);
      if(table==='results'){retain('students',row.studentId);retain('lessons',row.lessonId);}
      if(table==='lessons'){
        retain('lessonTypes',row.typeId);retain('groups',row.groupId);
        for(const target of row.targets||[])retain('groups',target.groupId,changed('targets')?target.subgroupId:null);
        for(const groupId of row.groupIds||[])retain('groups',groupId);
      }
      if(table==='layouts'){
        retain('groups',row.groupId);retain('lessons',row.lessonId);
        for(const studentId of Object.values(row.seats||{}))retain('students',studentId);
      }
    }
    for(const [key,fields] of touched){const [table,id]=JSON.parse(key);follow(table,id,fields);}
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
  const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
  class Replica{
    constructor(actor,author,events=[]){
      if(!safe(actor))throw Error('Неверный идентификатор устройства');
      this.actor=actor;this.author=author;this.events=new Map();this.clock=Object.create(null);
      this.registers=new Map();
      // Effective vectors, only for operations built on a duplicated ID (see merge).
      this.eff=new Map();this.collided=new Set();
      this.lost=[];this.duplicateActors=new Set();
      this.merge(events);
    }
    seen(by,target){
      if(target.actor===GENESIS)return by.actor!==GENESIS;
      return ((this.eff.get(by.id)||by.context)[target.actor]||0)>=target.seq;
    }
    /* Two operations with one ID and different content mean that one device identity
     * was used by two writers. Sync must not stop forever: every replica keeps the same
     * canonical variant (smallest canonical JSON). Operations built on the other variant
     * get an effective vector that also covers the canonical one, so the causal order
     * stays transitive and all replicas converge. */
    merge(events){
      const incoming=new Map();
      for(const event of events){
        validate(event);
        const other=incoming.get(event.id);
        if(other&&stable(other)!==stable(event)){
          this.collided.add(event.id);this.duplicateActors.add(event.actor);
          if(stable(event)>stable(other))continue;
        }
        incoming.set(event.id,event);
      }
      const replace=[],collided=[];
      for(const [id,event] of [...incoming]){
        const old=this.events.get(id);
        if(!old)continue;
        incoming.delete(id);
        const a=stable(old),b=stable(event);
        if(a===b)continue;
        collided.push(event);
        if(b<a)replace.push([old,event]);
      }
      const has=id=>this.events.has(id)||incoming.has(id);
      // A partial listing must not let a client claim unseen causal changes.
      for(const event of incoming.values()){
        for(const [actor,seq] of Object.entries(event.context))
          if(seq&&!has(actor+':'+seq))throw Error('Не все зависимости загружены; повторите синхронизацию');
        if(event.seq>1&&!has(event.actor+':'+(event.seq-1)))throw Error('Неполный журнал изменений');
      }
      // All checks passed: only now mutate the replica.
      for(const event of collided){this.collided.add(event.id);this.duplicateActors.add(event.actor);}
      for(const [old,event] of replace){this.lost.push(old);this.events.set(event.id,copy(event));}
      const rebuild=replace.length>0;
      for(const event of incoming.values()){
        const stored=copy(event);
        this.events.set(stored.id,stored);
        this.clock[stored.actor]=Math.max(this.clock[stored.actor]||0,stored.seq);
      }
      if(rebuild||this.collided.size&&[...incoming.keys()].some(id=>this.collided.has(id))){this.rebuild();return this;}
      for(const event of this.order([...incoming.keys()].map(id=>this.events.get(id)))){
        this.effective(event);this.apply(event);
      }
      return this;
    }
    // Dependencies first; deterministic for a given set of operations.
    order(list){
      const pending=new Map(list.map(e=>[e.id,e])),out=[],state=new Map();
      const visit=root=>{
        const stack=[[root,0]];state.set(root.id,1);
        while(stack.length){
          const top=stack[stack.length-1],[event]=top;
          const deps=Object.entries(event.context).filter(([,s])=>s>0).map(([a,s])=>a+':'+s).sort();
          if(top[1]<deps.length){
            const dep=pending.get(deps[top[1]++]);
            if(dep&&!state.has(dep.id)){state.set(dep.id,1);stack.push([dep,0]);}
          }else{stack.pop();out.push(event);}
        }
      };
      for(const event of [...pending.values()].sort(byId))if(!state.has(event.id))visit(event);
      return out;
    }
    effective(event){
      let eff=null;
      for(const [actor,seq] of Object.entries(event.context)){
        const id=actor+':'+seq;
        if(!seq||!(this.collided.has(id)||this.eff.has(id)))continue;
        const dep=this.events.get(id);
        for(const [a,n] of Object.entries(this.eff.get(id)||dep.context)){
          if(n<=((eff||event.context)[a]||0))continue;
          eff=eff||{...event.context};eff[a]=n;
        }
      }
      if(eff)this.eff.set(event.id,eff);else this.eff.delete(event.id);
    }
    apply(event){
      for(const change of event.changes){
        const current=this.registers.get(change.key)||[];
        if(current.some(c=>this.seen(c.event,event)))continue;
        const candidates=current.filter(c=>!this.seen(event,c.event));
        candidates.push({event,change});
        candidates.sort((a,b)=>byId(a.event,b.event));
        this.registers.set(change.key,candidates);
      }
    }
    rebuild(){
      this.registers=new Map();this.eff=new Map();
      for(const event of this.order([...this.events.values()]))this.effective(event);
      for(const event of [...this.events.values()].sort(byId))this.apply(event);
    }
    // Local operations replaced by the canonical variant of a duplicated ID.
    takeDuplicates(){
      const out={lost:this.lost,actors:this.duplicateActors};
      this.lost=[];this.duplicateActors=new Set();return out;
    }
    // Re-applies lost local values only where the canonical variant is still current.
    reissue(lost){
      const changes=new Map();
      for(const event of [...lost].sort((a,b)=>a.seq-b.seq))for(const change of event.changes){
        if(this.registers.get(change.key)?.some(c=>c.event.id===event.id))changes.set(change.key,copy(change));
      }
      return this.append([...changes.values()]);
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
  function genesis(initial){
    return {schema:14,id:GENESIS+':1',actor:GENESIS,seq:1,context:{},author:'Gradebook',
      createdAt:'2026-11-01T00:00:00.000Z',changes:difference({settings:{}},initial)};
  }
  /* Local storage encoding. Sorted by time, each context is stored as a difference from
   * the previous one: vectors that grew with every device no longer cost O(events·devices). */
  function pack(events){
    const list=[...events].sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:byId(a,b));
    let prev=new Map();
    return list.map(event=>{
      const {context,...rest}=event,cx={},cd=[];
      for(const [k,v] of Object.entries(context))if(prev.get(k)!==v)cx[k]=v;
      for(const k of prev.keys())if(!Object.hasOwn(context,k))cd.push(k);
      prev=new Map(Object.entries(context));
      const out={...rest,cx};if(cd.length)out.cd=cd;return out;
    });
  }
  function unpack(list){
    let prev=new Map();
    return list.map(item=>{
      if(item.context){prev=new Map(Object.entries(item.context));return item;}
      const {cx,cd,...rest}=item,ctx=new Map(prev);
      for(const k of cd||[])ctx.delete(k);
      for(const [k,v] of Object.entries(cx||{}))ctx.set(k,v);
      prev=ctx;return {...rest,context:Object.fromEntries(ctx)};
    });
  }
  const api={Replica,flatten,difference,stable,validate,genesis,GENESIS,pack,unpack};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GradebookSync=api;
})(globalThis);
