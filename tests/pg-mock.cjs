// A real Postgres (PGlite, in memory) behind a minimal model of the Supabase REST API:
// POST /rest/v1/rpc/<function> with JSON arguments, executed as the public "anon" role.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const HOST='db.test',API_KEY='sb_publishable_test';
async function createDatabase(){
  const {PGlite}=await import('@electric-sql/pglite');
  const pg=new PGlite();
  await pg.exec('create role anon nologin; create role authenticated nologin;');
  const schema=fs.readFileSync(path.join(__dirname,'..','supabase','schema.sql'),'utf8');
  // Applying twice checks that a repeated run of the script is safe.
  await pg.exec(schema.replace(/notify pgrst[^;]*;/,''));await pg.exec(schema.replace(/notify pgrst[^;]*;/,''));
  const db={
    pg,url:'https://'+HOST,apiKey:API_KEY,calls:0,dropNext:0,
    async addKey(key){
      const hash=crypto.createHash('sha256').update(key,'utf8').digest('hex');
      await pg.query('insert into public.gradebook_keys (key_hash) values ($1)',[hash]);
    },
    async rows(){return (await pg.query('select path, data from public.gradebook_files order by path')).rows;},
    async fetch(input,options={}){
      const url=new URL(input),result=(status,data)=>({ok:status>=200&&status<300,status,text:async()=>data===undefined?'':JSON.stringify(data)});
      if(url.hostname!==HOST)throw TypeError('unexpected host '+url.hostname);
      if(this.dropNext>0){this.dropNext--;throw new TypeError('fetch failed');}
      const headers=new Map(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
      if(headers.get('apikey')!==API_KEY)return result(401,{message:'Invalid API key'});
      const match=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if(options.method!=='POST'||!match)return result(404,{code:'PGRST202',message:'not found'});
      this.calls++;
      const args=JSON.parse(options.body||'{}'),names=Object.keys(args);
      if(names.some(n=>!/^p_[a-z]+$/.test(n)))return result(400,{message:'bad argument'});
      const sql=`select public.${match[1]}(${names.map((n,i)=>`${n} => $${i+1}`).join(', ')}) as r`;
      // PostgREST turns a JSON array into a Postgres array for array parameters (here: text[]).
      const values=names.map(n=>Array.isArray(args[n])&&n==='p_paths'?args[n]:typeof args[n]==='object'&&args[n]!==null?JSON.stringify(args[n]):args[n]);
      try{
        const res=await pg.transaction(async tx=>{await tx.exec('set local role anon');return tx.query(sql,values);});
        return result(200,res.rows[0].r);
      }catch(e){
        if(e.code==='42883')return result(404,{code:'PGRST202',message:e.message});
        return result(e.code==='28000'||e.code==='42501'?403:400,{code:e.code,message:e.message});
      }
    }
  };
  return db;
}
module.exports={createDatabase};
