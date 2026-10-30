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
let inIsolated=false;
const rejects=async(fn,code)=>{if(inIsolated)await db.exec('savepoint expected_failure');try{await assert.rejects(fn,new RegExp(code));}finally{if(inIsolated)await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');}};
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
 await db.exec(await readFile(new URL('../supabase/migrations/003_batch_image_lookup.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/004_lookalike_candidates.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/005_ai_daily_budget.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/006_animal_lifecycle.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/007_listing_context.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/008_meeting_chat.sql',import.meta.url),'utf8'));
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
 await rpc('admin','request',{animal_id:'dog'});
 const r=await rpc('user','request',{animal_id:'dog'});assert.equal((await rpc('user','request',{animal_id:'dog'})).request_id,r.request_id);
 await rejects(()=>rpc('other','requestStatus',{request_id:r.request_id,status:'APPROVED'}),'FORBIDDEN');
 await rejects(()=>rpc('admin','requestStatus',{request_id:r.request_id,status:'WITHDRAWN'}),'FORBIDDEN');
 assert.equal((await rpc('shelter','requestStatus',{request_id:r.request_id,status:'APPROVED'})).status,'APPROVED');
 assert.equal((await rpc('shelter','details',{animal_id:'dog'})).status,'PAUSED');
 assert.equal((await rpc('admin','discover')).some(a=>a.animal_id==='dog'),false);
 const waiting=(await rpc('shelter','requests')).find(q=>q.alias==='admin');assert.equal(waiting.status,'PENDING');
 await rejects(()=>rpc('shelter','requestStatus',{request_id:waiting.request_id,status:'APPROVED'}),'NOT_AVAILABLE');
 assert.equal((await rpc('shelter','requestStatus',{request_id:r.request_id,status:'APPROVED'})).status,'APPROVED');
 await rejects(()=>rpc('user','requestStatus',{request_id:r.request_id,status:'WITHDRAWN'}),'INVALID_TRANSITION');
});
test('foreign organization cannot edit animal even with forged organization_id',async()=>{
 await rejects(()=>rpc('other','saveAnimal',{animal_id:'dog',organization_id:'other',name:'X'}),'FORBIDDEN');
});
test('adoption closes pending requests and cannot be reversed',async()=>{
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
test('batched image lookup returns authorized image paths and handles missing images',async()=>{
 const pictured=(await db.query("select a.animal_id,i.storage_path from app.animals a join app.animal_images i on i.image_id=a.primary_image_id where a.name='Luna'")).rows[0];
 const payload={animal_ids:[pictured.animal_id,'draft','dog']};
 const viewer=await rpc('user','images',payload);
 assert.equal(viewer.length,2);assert.equal(viewer.some(a=>a.animal_id==='draft'),false);
 assert.equal(viewer.find(a=>a.animal_id===pictured.animal_id).image.path,pictured.storage_path);
 assert.equal(viewer.find(a=>a.animal_id==='dog').image,null);
 const admin=await rpc('admin','images',payload);
 assert.equal(admin.length,3);assert.equal(admin.find(a=>a.animal_id==='dog').image,null);
 assert.deepEqual(await rpc('user','images',{animal_ids:[]}),[]);
});
test('malformed status and preference values are rejected',async()=>{
 await rejects(()=>rpc('user','saveProfile',{alias:'Demo',species:['ADMIN']}),'VALIDATION_ERROR');
 await rejects(()=>rpc('shelter','saveAnimal',{name:'X',species:'DOG',description:'D',status:'PUBLIC'}),'check constraint');
});

async function aiCandidates(who,includeSeen=false,reserve=false){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]]);
 return (await db.query('select public.tier_ai_candidates($1,$2) as data',[includeSeen,reserve])).rows[0].data;
}
test('AI pool includes seen animals only when selected and never changes the swipe deck',async()=>{
 const before=await aiCandidates('user');assert.equal(before.length,1);const id=before[0].animal_id;
 await rpc('user','swipe',{animal_id:id,decision:'LIKE'});
 assert.equal((await aiCandidates('user')).length,0);
 assert.equal((await aiCandidates('user',true)).length,1);
 assert.equal((await rpc('user','discover')).some(a=>a.animal_id===id),false);
 await rpc('user','saveProfile',{alias:'Demo',species:['BIRD']});assert.equal((await aiCandidates('user',true)).length,0);
 await rpc('user','saveProfile',{alias:'Demo',species:['DOG','CAT']});
 await db.query("update app.animals set status='PAUSED' where animal_id=$1",[id]);assert.equal((await aiCandidates('user',true)).length,0);
 await db.query("update app.animals set status='AVAILABLE' where animal_id=$1",[id]);
});
test('AI candidate endpoint enforces approval and roles, with no anonymous access',async()=>{
 await rejects(()=>aiCandidates('pending',true),'APPROVAL_PENDING');await rejects(()=>aiCandidates('shelter',true),'FORBIDDEN');
 await db.exec('set role anon');try{await rejects(()=>db.query('select public.tier_ai_candidates(true,false)'),'permission denied');}finally{await db.exec('reset role');}
});
test('AI reservation is rate limited, while read-only eligibility checks consume nothing',async()=>{
 for(let i=0;i<5;i++)await aiCandidates('user',true,false);
 assert.equal((await db.query("select count(*)::int as n from app.rate_limits where key='ai-user:user'")).rows[0].n,0);
 for(let i=0;i<3;i++)await aiCandidates('user',true,true);
 await rejects(()=>aiCandidates('user',true,true),'RATE_LIMIT');
});

test('daily AI budget permits 21 through 100, shares the legacy limit and rejects 101',async()=>{
 await db.query("delete from app.rate_limits where key='ai-user:user'");
 await db.query("update app.rate_limits set count=20 where key='ai-day:'||(now() at time zone 'UTC')::date");
 await aiCandidates('user',true,true);
 assert.equal((await db.query("select count from app.rate_limits where key='ai-day:'||(now() at time zone 'UTC')::date")).rows[0].count,21);
 await db.query("update app.rate_limits set count=99 where key='ai-day:'||(now() at time zone 'UTC')::date");
 await rpc('user','reserveAi');
 assert.equal((await db.query("select count from app.rate_limits where key='ai-day:'||(now() at time zone 'UTC')::date")).rows[0].count,100);
 await rejects(()=>aiCandidates('user',true,true),'AI_DAILY_LIMIT');
 await rejects(()=>rpc('user','reserveAi'),'RATE_LIMIT');
 await db.exec(await readFile(new URL('../supabase/migrations/005_ai_daily_budget.sql',import.meta.url),'utf8'));
 assert.equal((await db.query("select count from app.rate_limits where key='ai-day:'||(now() at time zone 'UTC')::date")).rows[0].count,100);
});

async function isolated(fn){await db.exec('begin');inIsolated=true;try{await fn();}finally{inIsolated=false;await db.exec('rollback');}}
async function pet(id,species='DOG'){
 await db.query(`insert into app.animals(animal_id,organization_id,name,species,description,status)
 select $1,organization_id,$1,$2,'Fiktiver Test','AVAILABLE' from app.users where user_id='shelter'`,[id,species]);
}
test('undo restores newest eligible personal pass, preserves likes and other accounts',()=>isolated(async()=>{
 await db.exec('delete from app.swipes');
 for(const id of ['skip-old','skip-new','keep-like'])await pet(id);
 await rpc('user','swipe',{animal_id:'skip-old',decision:'PASS'});
 await db.query("update app.swipes set updated_at=now()-interval '1 hour' where animal_id='skip-old'");
 await rpc('user','swipe',{animal_id:'skip-new',decision:'PASS'});
 await rpc('user','swipe',{animal_id:'keep-like',decision:'LIKE'});
 await rpc('admin','swipe',{animal_id:'skip-new',decision:'PASS'});
 assert.equal((await rpc('user','undoPass',{animal_id:'keep-like',user_id:'admin'})).animal_id,'skip-new');
 assert.equal((await rpc('user','undoPass')).animal_id,'skip-old');
 assert.equal(await rpc('user','undoPass'),null);
 assert.equal((await rpc('user','likes'))[0].animal_id,'keep-like');
 assert.equal((await rpc('admin','undoPass')).animal_id,'skip-new');
 await rejects(()=>rpc('shelter','undoPass'),'FORBIDDEN');
 await rejects(()=>rpc('pending','undoPass'),'APPROVAL_PENDING');
}));
test('undo excludes paused, deleted and filtered species without losing their passes',()=>isolated(async()=>{
 await db.exec('delete from app.swipes');
 for(const id of ['undo-paused','undo-deleted']){await pet(id);await rpc('user','swipe',{animal_id:id,decision:'PASS'});}
 await pet('undo-bird','BIRD');await rpc('user','swipe',{animal_id:'undo-bird',decision:'PASS'});
 await db.query("update app.animals set status='PAUSED' where animal_id='undo-paused'");
 await rpc('shelter','deleteAnimal',{animal_id:'undo-deleted'});
 assert.equal(await rpc('user','undoPass'),null);
 assert.equal((await db.query("select count(*)::int as n from app.swipes where user_id='user'")).rows[0].n,3);
 await rpc('user','saveProfile',{alias:'Demo',species:['BIRD']});
 assert.equal((await rpc('user','undoPass')).animal_id,'undo-bird');
}));
test('deletion is owner-only, idempotent and hides listing and images while retaining request history',()=>isolated(async()=>{
 await pet('delete-me');
 await db.exec(`insert into app.animal_images(image_id,animal_id,storage_path,mime_type) values('delete-img','delete-me','test/delete.jpg','image/jpeg');
 update app.animals set primary_image_id='delete-img' where animal_id='delete-me';`);
 await rpc('user','swipe',{animal_id:'delete-me',decision:'LIKE'});
 const request=await rpc('user','request',{animal_id:'delete-me'});
 const waiting=await rpc('admin','request',{animal_id:'delete-me'});
 await rejects(()=>rpc('other','deleteAnimal',{animal_id:'delete-me'}),'FORBIDDEN');
 await rejects(()=>rpc('user','deleteAnimal',{animal_id:'delete-me'}),'FORBIDDEN');
 await rpc('shelter','requestStatus',{request_id:request.request_id,status:'APPROVED'});
 await rpc('shelter','deleteAnimal',{animal_id:'delete-me'});
 assert.equal(await rpc('shelter','deleteAnimal',{animal_id:'delete-me'}),true);
 for(const who of ['user','admin']){
  assert.equal((await rpc(who,'discover')).some(a=>a.animal_id==='delete-me'),false);
  assert.equal((await rpc(who,'likes')).some(a=>a.animal_id==='delete-me'),false);
  assert.equal((await aiCandidates(who,true)).some(a=>a.animal_id==='delete-me'),false);
  await rejects(()=>rpc(who,'details',{animal_id:'delete-me'}),'NOT_FOUND');
  await rejects(()=>rpc(who,'image',{animal_id:'delete-me'}),'NOT_FOUND');
  assert.deepEqual(await rpc(who,'images',{animal_ids:['delete-me']}),[]);
  await rejects(()=>rpc(who,'swipe',{animal_id:'delete-me',decision:'LIKE'}),'NOT_FOUND');
  await rejects(()=>rpc(who,'request',{animal_id:'delete-me'}),'NOT_FOUND');
  assert.equal((await db.query("select public.tier_image_access('test/delete.jpg',false) as ok")).rows[0].ok,false);
 }
 const history=await rpc('shelter','requests');
 for(const id of [request.request_id,waiting.request_id]){const row=history.find(r=>r.request_id===id);assert.equal(row.status,'CLOSED_UNAVAILABLE');assert.equal(row.animal.deleted,true);assert.equal(row.animal.has_image,false);}
 assert.equal((await rpc('shelter','shelterWorkspace')).animals.some(a=>a.animal_id==='delete-me'),false);
 await rejects(()=>rpc('shelter','saveAnimal',{animal_id:'delete-me',status:'AVAILABLE'}),'NOT_FOUND');
 assert.equal((await db.query("select count(*)::int as n from app.animals where animal_id='delete-me' and deleted_at is not null")).rows[0].n,1);
}));

test('discover follows saved preferences across all species, reset and bootstrap',()=>isolated(async()=>{
 for(const species of ['DOG','CAT','BIRD','RABBIT'])await pet('preferences-'+species,species);
 for(const species of [['CAT'],['BIRD','RABBIT'],[]]){
  await rpc('user','saveProfile',{alias:'Demo',species});
  await rpc('user','resetPasses');
  const deck=await rpc('user','discover');
  assert.ok(deck.every(a=>species.includes(a.species)));
  for(const selected of species)assert.ok(deck.some(a=>a.animal_id==='preferences-'+selected));
  const boot=await rpc('user','bootstrap');
  assert.deepEqual([...boot.account.species].sort(),[...species].sort());
  assert.ok(boot.views.discover.every(a=>species.includes(a.species)));
  if(!species.length)assert.deepEqual(deck,[]);
 }
}));

test('listing context includes organization location without contact details and meeting flag stays owner-only',()=>isolated(async()=>{
 await pet('listing-context');await db.exec("update app.organizations set location='Stuttgart' where organization_id=(select organization_id from app.animals where animal_id='listing-context')");
 const a=(await rpc('user','discover')).find(a=>a.animal_id==='listing-context');assert.equal(a.location,'Stuttgart');assert.equal(a.organization_name,'shelter');assert.equal(a.email,undefined);assert.equal(a.has_confirmed_meeting,undefined);
 await rpc('user','swipe',{animal_id:a.animal_id,decision:'LIKE'});assert.equal((await rpc('user','likes')).find(x=>x.animal_id===a.animal_id).location,'Stuttgart');
 assert.equal((await rpc('shelter','shelterWorkspace')).animals.find(x=>x.animal_id===a.animal_id).has_confirmed_meeting,false);
 const r=await rpc('user','request',{animal_id:a.animal_id});await rpc('shelter','requestStatus',{request_id:r.request_id,status:'APPROVED'});
 assert.equal((await rpc('shelter','shelterWorkspace')).animals.find(x=>x.animal_id===a.animal_id).has_confirmed_meeting,true);
 assert.equal((await rpc('other','shelterWorkspace')).animals.some(x=>x.animal_id===a.animal_id),false);
}));

async function meeting(who,action,payload={}){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]||who]);
 return (await db.query('select public.tier_meeting_rpc($1,$2) as data',[action,JSON.stringify(payload)])).rows[0].data;
}
async function conversation(name,approved=true){
 await pet(name);
 await db.query("insert into app.animal_images(image_id,animal_id,storage_path,mime_type) values($1,$2,$3,'image/jpeg')",[name+'-image',name,name+'.jpg']);
 await db.query('update app.animals set primary_image_id=$1 where animal_id=$2',[name+'-image',name]);
 const r=await rpc('user','request',{animal_id:name});
 if(approved)await rpc('shelter','requestStatus',{request_id:r.request_id,status:'APPROVED'});
 return {request_id:r.request_id};
}
const uuid=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
test('chat opens only on approval and excludes unrelated users, shelters and nonparticipating master admins',()=>isolated(async()=>{
 const p=await conversation('chat-access',false);
 assert.equal((await meeting('user','meeting',p)).can_send,false);
 await rejects(()=>meeting('user','sendMessage',{...p,body:'Hallo',client_id:uuid(1)}),'CHAT_CLOSED');
 for(const who of ['other','admin'])for(const action of ['meeting','sendMessage','readMeeting','cancelMeeting'])await rejects(()=>meeting(who,action,{...p,body:'Hallo',client_id:uuid(1),event_id:'1',reopen:false}),'NOT_FOUND');
 await rpc('shelter','requestStatus',{...p,status:'APPROVED'});
 assert.equal((await meeting('user','meeting',p)).can_send,true);
 await meeting('user','sendMessage',{...p,body:'Hallo aus dem Test',client_id:uuid(1)});
 const result=await meeting('shelter','meeting',p);assert.equal(result.events.at(-1).body,'Hallo aus dem Test');assert.equal(result.events.at(-1).mine,false);
 await rejects(()=>meeting('pending','meeting',p),'APPROVAL_PENDING');
 await rpc('admin','adminApproval',{user_id:'user',approved:false});await rejects(()=>meeting('user','meeting',p),'APPROVAL_PENDING');
}));
test('chat messages validate content, cannot spoof sender and retry idempotently',()=>isolated(async()=>{
 const p=await conversation('chat-retry');
 for(const body of ['', '   ', 'x'.repeat(2001), null, {}])await rejects(()=>meeting('user','sendMessage',{...p,body,client_id:uuid(2)}),'MESSAGE_INVALID');
 await rejects(()=>meeting('user','sendMessage',{...p,body:'Hallo',client_id:'bad'}),'VALIDATION_ERROR');
 const input={...p,body:' <b>Nur Text</b> ',client_id:uuid(2),sender_user_id:'shelter'};
 const a=await meeting('user','sendMessage',input),b=await meeting('user','sendMessage',input);assert.equal(a.event_id,b.event_id);
 const events=(await meeting('user','meeting',p)).events.filter(e=>e.kind==='MESSAGE');assert.equal(events.length,1);assert.equal(events[0].mine,true);assert.equal(events[0].body,'<b>Nur Text</b>');
 await rejects(()=>meeting('user','sendMessage',{...input,body:'Anderer Inhalt'}),'VALIDATION_ERROR');
}));
test('unread notifications are personal and acknowledge only the actually observed cursor',()=>isolated(async()=>{
 const p=await conversation('chat-unread',false);
 const unread=async who=>(await meeting(who,'notifications')).find(x=>x.request_id===p.request_id)?.unread_count||0;
 assert.equal(await unread('shelter'),1);assert.equal(await unread('user'),0);assert.equal(await unread('other'),0);assert.equal(await unread('admin'),0);
 const opened=await meeting('shelter','meeting',p),cursor=opened.events.at(-1).event_id;
 assert.equal(await unread('shelter'),1); // Fetching alone does not mark read.
 await meeting('shelter','readMeeting',{...p,event_id:cursor});assert.equal(await unread('shelter'),0);
 await rpc('shelter','requestStatus',{...p,status:'APPROVED'});assert.equal(await unread('user'),1);
 const first=(await meeting('user','meeting',p)).events.at(-1).event_id;
 await meeting('shelter','sendMessage',{...p,body:'Neue Nachricht nach dem Laden',client_id:uuid(3)});
 await meeting('user','readMeeting',{...p,event_id:first});assert.equal(await unread('user'),1);
 const latest=(await meeting('user','meeting',p)).events.at(-1).event_id;
 await meeting('user','readMeeting',{...p,event_id:latest});await meeting('user','readMeeting',{...p,event_id:first});assert.equal(await unread('user'),0);
 const foreign=await conversation('chat-foreign');const foreignId=(await meeting('user','meeting',foreign)).events.at(-1).event_id;
 await rejects(()=>meeting('user','readMeeting',{...p,event_id:foreignId}),'VALIDATION_ERROR');
}));
test('only owning shelter can set meeting details; attendees receive the update',()=>isolated(async()=>{
 const p=await conversation('chat-schedule'),time=new Date(Date.now()+86400000).toISOString(),payload={...p,meeting_at:time,place:'Treffpunkt am Eingang',notes:'Bitte zehn Minuten vorher kommen.'};
 await rejects(()=>meeting('user','saveMeeting',payload),'FORBIDDEN');
 await rejects(()=>meeting('shelter','saveMeeting',{...payload,meeting_at:'2020-01-01'}),'MEETING_DATE_INVALID');
 await rejects(()=>meeting('shelter','saveMeeting',{...payload,meeting_at:'wrong'}),'VALIDATION_ERROR');
 await meeting('shelter','saveMeeting',payload);await meeting('shelter','saveMeeting',payload);
 const data=await meeting('user','meeting',p);assert.equal(new Date(data.meeting_at).toISOString(),time);assert.equal(data.meeting_place,payload.place);assert.equal(data.meeting_notes,payload.notes);assert.equal(data.events.filter(e=>e.kind==='MEETING').length,1);
 assert.equal((await rpc('user','requests')).find(r=>r.request_id===p.request_id).meeting_place,payload.place);
}));
test('attendee cancellation closes chat but preserves history and does not reopen the animal',()=>isolated(async()=>{
 const p=await conversation('chat-cancel');await meeting('user','sendMessage',{...p,body:'Hallo',client_id:uuid(4)});
 await rejects(()=>meeting('user','cancelMeeting',{...p,reopen:true}),'FORBIDDEN');
 await meeting('user','cancelMeeting',{...p,reopen:false});
 const closed=await meeting('shelter','meeting',p);assert.equal(closed.status,'CANCELLED');assert.equal(closed.can_send,false);assert.ok(closed.events.some(e=>e.body==='Hallo'));
 assert.equal((await rpc('shelter','details',{animal_id:'chat-cancel'})).status,'PAUSED');
 await rejects(()=>meeting('shelter','sendMessage',{...p,body:'Neue Nachricht',client_id:uuid(5)}),'CHAT_CLOSED');
 assert.equal(await meeting('user','cancelMeeting',{...p,reopen:false}),true);
}));
test('shelter cancellation can explicitly reopen only eligible animals',()=>isolated(async()=>{
 const p=await conversation('chat-reopen');assert.equal((await meeting('shelter','meeting',p)).can_reopen,true);
 await meeting('shelter','cancelMeeting',{...p,reopen:true});assert.equal((await rpc('shelter','details',{animal_id:'chat-reopen'})).status,'AVAILABLE');
 const q=await conversation('chat-multiple');
 await db.query("insert into app.requests(user_id,animal_id,status) values('admin','chat-multiple','APPROVED')");
 assert.equal((await meeting('shelter','meeting',q)).can_reopen,false);
 await rejects(()=>meeting('shelter','cancelMeeting',{...q,reopen:true}),'REOPEN_UNAVAILABLE');
 await meeting('shelter','cancelMeeting',{...q,reopen:false});assert.equal((await rpc('shelter','details',{animal_id:'chat-multiple'})).status,'PAUSED');
}));
test('deletion and adoption retain approved chat history but prevent further sending',()=>isolated(async()=>{
 for(const mode of ['deleted','adopted']){
  const p=await conversation('chat-'+mode);await meeting('user','sendMessage',{...p,body:'Gespeicherter Verlauf',client_id:uuid(6)});
  if(mode==='deleted')await rpc('shelter','deleteAnimal',{animal_id:'chat-'+mode});
  else await rpc('shelter','saveAnimal',{animal_id:'chat-'+mode,name:'Fiktiv',species:'DOG',description:'Fiktiv',status:'ADOPTED',age_months:''});
  const result=await meeting('user','meeting',p);assert.equal(result.can_send,false);assert.equal(result.can_cancel,false);assert.ok(result.events.some(e=>e.body==='Gespeicherter Verlauf'));
  await rejects(()=>meeting('user','sendMessage',{...p,body:'Zu spät',client_id:uuid(7)}),'CHAT_CLOSED');
 }
}));
test('conversation tables and helper functions are not accessible directly or anonymously',async()=>{
 await db.exec('set role anon');try{await rejects(()=>db.query("select public.tier_meeting_rpc('notifications')"),'permission denied');}finally{await db.exec('reset role');}
 await db.exec('set role authenticated');try{
  for(const table of ['request_events','request_reads'])await rejects(()=>db.query('select * from app.'+table),'permission denied');
  await rejects(()=>db.query('select app.meeting_participant(null,null)'),'permission denied');
 }finally{await db.exec('reset role');}
});
test('chat history is paginated without gaps and notification counts exclude own messages',()=>isolated(async()=>{
 const p=await conversation('chat-pages');
 await db.query("insert into app.request_events(request_id,sender_user_id,kind,body) select $1,'shelter','MESSAGE','Beitrag '||n from generate_series(1,60) n",[p.request_id]);
 const last=await meeting('user','meeting',p);assert.equal(last.events.length,50);assert.equal(last.has_older,true);assert.equal(last.events.at(-1).body,'Beitrag 60');
 const older=await meeting('user','meeting',{...p,before:last.events[0].event_id});assert.equal(older.events.length,12);assert.equal(older.has_older,false);
 assert.equal(new Set([...older.events,...last.events].map(e=>e.event_id)).size,62);
 assert.equal((await meeting('user','notifications')).find(r=>r.request_id===p.request_id).unread_count,61);
 assert.equal((await meeting('shelter','notifications')).find(r=>r.request_id===p.request_id).unread_count,1);
}));
test('message rate limit bounds new messages while accepted-message retries remain idempotent',()=>isolated(async()=>{
 const p=await conversation('chat-rate');
 for(let n=100;n<130;n++)await meeting('user','sendMessage',{...p,body:'Test '+n,client_id:uuid(n)});
 await rejects(()=>meeting('user','sendMessage',{...p,body:'Zu viele',client_id:uuid(130)}),'RATE_LIMIT');
 assert.ok((await meeting('user','sendMessage',{...p,body:'Test 100',client_id:uuid(100)})).event_id);
}));
