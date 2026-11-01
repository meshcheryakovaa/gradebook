/* Read-only structural check of the v14 journals on Yandex Disk.
 * Prints counts and random operation IDs only: no names, grades, authors or logins,
 * because GitHub Actions logs of a public repository are public. */
'use strict';
const {Replica,validate,dependencies,stable}=require('../js/sync-core.js');
const token=process.env.YANDEX_DISK_TOKEN;
const root=process.env.GRADEBOOK_V14_ROOT||'app:/gradebook-v14';
if(!token){console.log('YANDEX_DISK_TOKEN не задан');process.exit(0);}
const api='https://cloud-api.yandex.net/v1/disk/resources';
async function call(url){
  for(let attempt=1;;attempt++){
    const res=await fetch(url,{headers:{Authorization:'OAuth '+token,Accept:'application/json'}});
    if(res.status===429&&attempt<5){await new Promise(r=>setTimeout(r,2000*attempt));continue;}
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(`HTTP ${res.status}: ${data.error||''}`);
    return data;
  }
}
async function list(path){
  const items=[];let offset=0;
  for(;;){
    const data=await call(api+'?'+new URLSearchParams({path,limit:'200',offset:String(offset),sort:'name'}));
    items.push(...data._embedded.items);offset+=data._embedded.items.length;
    if(offset>=data._embedded.total||!data._embedded.items.length)return items;
  }
}
async function download(path){
  const link=await call(api+'/download?'+new URLSearchParams({path}));
  const res=await fetch(link.href);if(!res.ok)throw Error('HTTP '+res.status);
  return res.json();
}
async function pool(items,n,fn){
  const out=[];let i=0;
  await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k]);}}));
  return out;
}
const short=id=>{const [actor,seq]=[id.slice(0,id.lastIndexOf(':')),id.slice(id.lastIndexOf(':')+1)];return actor.slice(0,8)+'…:'+seq;};
(async()=>{
  console.log('## Диагностика журналов Gradebook v14\n');
  const workspaces=(await list(root+'/workspaces')).filter(x=>x.type==='dir');
  console.log(`Журналов на Диске: ${workspaces.length}\n`);
  for(const ws of workspaces){
    const files=(await list(`${root}/workspaces/${ws.name}`)).filter(x=>x.type==='file');
    const packets=files.filter(x=>/^packet_[a-f0-9-]+\.json$/.test(x.name));
    const broken=[],variants=new Map(),foreign=[];
    const loaded=await pool(packets,8,async f=>{try{return [f,await download(`${root}/workspaces/${ws.name}/${f.name}`)];}catch(e){broken.push(f.name+': '+e.message);return [f,null];}});
    for(const [file,packet] of loaded){
      if(!packet)continue;
      if(packet.schema!=='gradebook-v14-packet'||!Array.isArray(packet.events)){broken.push(file.name+': неизвестный формат');continue;}
      if(packet.workspace!==ws.name)foreign.push(file.name);
      for(const event of packet.events){
        try{validate(event);}catch(e){broken.push(file.name+': '+e.message);continue;}
        if(!variants.has(event.id))variants.set(event.id,new Map());
        variants.get(event.id).set(stable(event),event);
      }
    }
    const events=[...variants.values()].map(v=>[...v.values()][0]);
    const duplicates=[...variants].filter(([,v])=>v.size>1);
    const missing=new Map();
    for(const event of events)for(const dep of dependencies(event))if(!variants.has(dep)){
      if(!missing.has(dep))missing.set(dep,[]);missing.get(dep).push(event.id);
    }
    const actors=new Map();
    for(const e of events)actors.set(e.actor,Math.max(actors.get(e.actor)||0,e.seq));
    const contexts=events.map(e=>Object.keys(e.context).length);
    const dates=events.map(e=>e.createdAt).filter(Boolean).sort();
    console.log(`### Журнал ${ws.name.slice(0,8)}…\n`);
    console.log(`- пакетов: ${packets.length} (других файлов: ${files.length-packets.length}), объём: ${Math.round(files.reduce((n,f)=>n+(f.size||0),0)/1024)} КБ`);
    console.log(`- операций: ${events.length}, идентичностей устройств: ${actors.size}, наибольший вектор: ${Math.max(0,...contexts)}`);
    console.log(`- период: ${dates[0]?.slice(0,10)||'—'} … ${dates.at(-1)?.slice(0,10)||'—'}`);
    console.log(`- повреждённых пакетов/операций: ${broken.length}${broken.length?'\n  - '+broken.slice(0,10).join('\n  - '):''}`);
    console.log(`- пакетов чужого журнала: ${foreign.length}`);
    console.log(`- повторяющихся ID с разным содержимым: ${duplicates.length}${duplicates.length?' — '+duplicates.slice(0,10).map(([id,v])=>short(id)+' ×'+v.size).join(', '):''}`);
    console.log(`- отсутствующих зависимостей: ${missing.size}`);
    for(const [dep,needers] of [...missing].slice(0,15))console.log(`  - нет ${short(dep)}, нужна для ${needers.length} операций (например ${short(needers[0])})`);
    if(missing.size){
      const byActor=new Map();
      for(const dep of missing.keys()){const a=dep.slice(0,dep.lastIndexOf(':'));byActor.set(a,(byActor.get(a)||0)+1);}
      for(const [actor,count] of byActor)console.log(`  - устройство ${actor.slice(0,8)}…: не хватает ${count} операций, на Диске есть его операции до №${actors.get(actor)||0}`);
    }
    try{
      const replica=new Replica('diagnostics','');const waiting=replica.mergeReady([...variants.values()].flatMap(v=>[...v.values()]));
      console.log(`- сборка журнала: ${waiting.length?`не хватает зависимостей у ${waiting.length} операций`:'успешно'}, спорных полей: ${replica.conflicts().length}`);
    }catch(e){console.log('- сборка журнала: ошибка — '+e.message);}
    console.log('');
  }
})().catch(e=>{console.log('Ошибка диагностики: '+e.message);process.exit(1);});
