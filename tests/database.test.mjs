import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
let db;
const ids={admin:'00000000-0000-0000-0000-000000000001',shelter:'00000000-0000-0000-0000-000000000002',other:'00000000-0000-0000-0000-000000000003',user:'00000000-0000-0000-0000-000000000004',pending:'00000000-0000-0000-0000-000000000005'};
async function rpc(who,action,payload={}) {
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]||who]);
 return (await db.query('select public.tier_rpc($1,$2) as data',[action,JSON.stringify(payload)])).rows[0].data;
}
const rejects=(fn,code)=>assert.rejects(fn,new RegExp(code));
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;`);
 await db.exec(await readFile(new URL('../supabase/migrations/001_core.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./fixtures/import.sql',import.meta.url),'utf8'));
 for(const [key,id] of Object.entries(ids)){
  await db.query('insert into auth.users values($1,$2,$3)',[id,key+'@example.com',JSON.stringify({alias:key,role:['shelter','other'].includes(key)?'SHELTER':'INTERESTED',consent:true,organization_name:key})]);
 }
 await db.exec(`update app.users set user_id=alias;
 update app.users set approved=true where alias<>'pending';
 update app.users set role='ADMIN',is_admin=true where alias='admin';
 update app.organizations set approved=true;
 insert into app.animals(animal_id,organization_id,name,species,description,status) select 'dog',organization_id,'Balu','DOG','Fiktives Tier','AVAILABLE' from app.users where user_id='shelter';
 insert into app.animals(animal_id,organization_id,name,species,description,status) select 'draft',organization_id,'Entwurf','CAT','Fiktives Tier','DRAFT' from app.users where user_id='other';
 insert into app.animals(animal_id,organization_id,name,species,description,status) select 'adopted',organization_id,'Vermittelt','DOG','Fiktives Tier','ADOPTED' from app.users where user_id='shelter';`);
});
after(async()=>db?.close());
test('pending account cannot access any app data',async()=>{await rejects(()=>rpc('pending','bootstrap'),'APPROVAL_PENDING');});
test('signup cannot grant admin through metadata',async()=>{
 const id='00000000-0000-0000-0000-000000000099';
 await db.query('insert into auth.users values($1,$2,$3)',[id,'attack@example.com',JSON.stringify({alias:'attack',role:'INTERESTED',is_admin:true,approved:true,consent:true})]);
 const u=(await db.query('select * from app.users where auth_id=$1',[id])).rows[0];assert.equal(u.is_admin,false);assert.equal(u.approved,false);
 await rejects(()=>db.query('insert into auth.users values($1,$2,$3)',['00000000-0000-0000-0000-000000000098','attack2@example.com',JSON.stringify({alias:'attack2',role:'ADMIN',consent:true})]),'ROLE_REQUIRED');
});
test('bootstrap excludes admin and other organization data',async()=>{
 const u=await rpc('user','bootstrap'); assert.deepEqual(Object.keys(u.views).sort(),['discover','likes','requests']);assert.equal(u.views.discover.length,1);
 const s=await rpc('shelter','bootstrap');assert.deepEqual(Object.keys(s.views).sort(),['requests','shelterWorkspace']);assert.equal(s.views.shelterWorkspace.animals.some(a=>a.animal_id==='draft'),false);
 await rejects(()=>rpc('shelter','details',{animal_id:'draft'}),'NOT_FOUND');
 await rejects(()=>rpc('user','adminAccounts'),'FORBIDDEN');
});
test('invalid swipe cannot target unavailable animals, including PASS with no previous row',async()=>{
 for(const decision of ['PASS','LIKE'])await rejects(()=>rpc('user','swipe',{animal_id:'adopted',decision}),'NOT_AVAILABLE');
});
test('likes are idempotent, personal and disappear from discover',async()=>{
 const a=await rpc('user','swipe',{animal_id:'dog',decision:'LIKE'}),b=await rpc('user','swipe',{animal_id:'dog',decision:'LIKE'});assert.equal(a.swipe_id,b.swipe_id);
 assert.equal((await rpc('user','discover')).length,0);assert.equal((await rpc('user','likes')).length,1);assert.equal((await rpc('admin','likes')).length,0);
});
test('view counter counts once per user, animal and view type',async()=>{
 await rpc('user','view',{animal_id:'dog',view_type:'CARD'});await rpc('user','view',{animal_id:'dog',view_type:'CARD'});
 assert.equal((await rpc('shelter','shelterWorkspace')).animals.find(a=>a.animal_id==='dog').metrics.cards,1);
});
test('request lifecycle enforces ownership and idempotency',async()=>{
 const r=await rpc('user','request',{animal_id:'dog'});assert.equal((await rpc('user','request',{animal_id:'dog'})).request_id,r.request_id);
 await rejects(()=>rpc('other','requestStatus',{request_id:r.request_id,status:'APPROVED'}),'FORBIDDEN');
 await rejects(()=>rpc('admin','requestStatus',{request_id:r.request_id,status:'WITHDRAWN'}),'FORBIDDEN');
 assert.equal((await rpc('shelter','requestStatus',{request_id:r.request_id,status:'APPROVED'})).status,'APPROVED');
 await rejects(()=>rpc('user','requestStatus',{request_id:r.request_id,status:'WITHDRAWN'}),'INVALID_TRANSITION');
});
test('foreign organization cannot edit animal even with forged organization_id',async()=>{
 await rejects(()=>rpc('other','saveAnimal',{animal_id:'dog',organization_id:'other',name:'X'}),'FORBIDDEN');
});
test('adoption closes pending requests and cannot be reversed',async()=>{
 await rpc('admin','request',{animal_id:'dog'});
 await rpc('shelter','saveAnimal',{animal_id:'dog',name:'Balu',species:'DOG',description:'Fiktives Tier',status:'ADOPTED',age_months:''});
 assert.equal((await rpc('admin','requests')).find(r=>r.alias==='admin').status,'CLOSED_UNAVAILABLE');
 await rejects(()=>rpc('shelter','saveAnimal',{animal_id:'dog',status:'AVAILABLE'}),'INVALID_TRANSITION');
 await rpc('user','swipe',{animal_id:'dog',decision:'PASS'});assert.equal((await rpc('user','likes')).length,0);
});
test('approval is checked freshly on every request, self-lock is prevented',async()=>{
 await rejects(()=>rpc('admin','adminApproval',{user_id:'admin',approved:false}),'SELF_LOCK');
 await rpc('admin','adminApproval',{user_id:'user',approved:false});await rejects(()=>rpc('user','me'),'APPROVAL_PENDING');
 await rpc('admin','adminApproval',{user_id:'user',approved:true});
 await rpc('admin','adminApproval',{user_id:'shelter',approved:false});await rejects(()=>rpc('shelter','me'),'ORGANIZATION_PENDING');
 await rpc('admin','adminApproval',{user_id:'shelter',approved:true});
});
test('private tables and unauthenticated RPC cannot be read directly',async()=>{
 await db.exec('set role anon');try{await rejects(()=>db.query("select public.tier_rpc('bootstrap')"),'permission denied');await rejects(()=>db.query('select * from app.users'),'permission denied');}finally{await db.exec('reset role');}
 await db.exec('set role authenticated');try{await rejects(()=>db.query('select * from app.users'),'permission denied');}finally{await db.exec('reset role');}
});
test('image policy rejects unrelated organization upload and draft download',async()=>{
 await rpc('user','me');assert.equal((await db.query("select public.tier_image_access('any/x.jpg',true) as ok")).rows[0].ok,false);
 const org=(await db.query("select organization_id from app.users where user_id='other'")).rows[0].organization_id;
 await rpc('shelter','me');assert.equal((await db.query('select public.tier_image_access($1,true) as ok',[org+'/x.jpg'])).rows[0].ok,false);
});
test('new image upload must belong to caller and target organization',async()=>{
 const org=(await db.query("select organization_id from app.users where user_id='shelter'")).rows[0].organization_id;
 await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('animal-images',$1,$2,$3)",[org+'/owned.jpg',ids.shelter,JSON.stringify({mimetype:'image/jpeg',size:200})]);
 const input={name:'Luna',species:'CAT',description:'Fiktiv',status:'AVAILABLE',age_months:'',storage_path:org+'/owned.jpg'};
 await rejects(()=>rpc('other','saveAnimal',input),'IMAGE_INVALID');
 const a=await rpc('shelter','saveAnimal',input);assert.ok(a.primary_image_id);
 assert.ok((await rpc('user','image',{animal_id:a.animal_id})).path.endsWith('/owned.jpg'));
 await rejects(()=>rpc('shelter','saveAnimal',input),'IMAGE_ASSIGNED');
});
test('import endpoint is inaccessible to authenticated app users',async()=>{
 await db.exec('set role authenticated');try{await rejects(()=>db.query("select public.tier_import('{}')"),'permission denied');}finally{await db.exec('reset role');}
 await rejects(()=>db.query("select public.tier_import('{}')"),'FORBIDDEN');
});
test('malformed status and preference values are rejected',async()=>{
 await rejects(()=>rpc('user','saveProfile',{alias:'Demo',species:['ADMIN']}),'VALIDATION_ERROR');
 await rejects(()=>rpc('shelter','saveAnimal',{name:'X',species:'DOG',description:'D',status:'PUBLIC'}),'check constraint');
});
