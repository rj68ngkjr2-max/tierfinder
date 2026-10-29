-- Avoid collision between the PL/pgSQL row variable a and the batch-query table alias.
-- CREATE OR REPLACE preserves the existing grants and authentication checks.
begin;
create or replace function public.tier_rpc(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u app.users; target app.users; a app.animals; old app.animals; r app.requests; s app.swipes;
 result jsonb; org text; aid text; iid text; path text; mime text; specs text[]; img app.animal_images;
begin
 u:=app.actor();
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'VALIDATION_ERROR'; end if;
 if action in ('discover','likes','swipe','resetPasses','view','request','reserveAi') and u.role<>'INTERESTED' and not app.master(u) then raise exception 'FORBIDDEN'; end if;
 if action in ('shelter','shelterWorkspace','saveAnimal') and u.role<>'SHELTER' and not app.master(u) then raise exception 'FORBIDDEN'; end if;
 if action in ('adminAccounts','adminApproval','adminResetTarget','aiStatus','organizations') and not u.is_admin then raise exception 'FORBIDDEN'; end if;
 case action
 when 'me' then return app.account(u);
 when 'bootstrap' then
  result:=jsonb_build_object('requests',app.request_list(u));
  if u.role='INTERESTED' or app.master(u) then result:=result||jsonb_build_object('discover',app.discover(u),'likes',app.likes(u)); end if;
  if u.role='SHELTER' or app.master(u) then result:=result||jsonb_build_object('shelterWorkspace',app.workspace(u)); end if;
  return jsonb_build_object('account',app.account(u),'views',result);
 when 'discover' then return app.discover(u);
 when 'likes' then return app.likes(u);
 when 'requests' then return app.request_list(u);
 when 'shelterWorkspace' then return app.workspace(u);
 when 'shelter' then return app.workspace(u)->'animals';
 when 'organizations' then return coalesce((select jsonb_agg(jsonb_build_object('organization_id',organization_id,'name',name)) from app.organizations),'[]');
 when 'saveProfile' then
  if length(btrim(coalesce(payload->>'alias',''))) not between 1 and 60 or jsonb_typeof(payload->'species') is distinct from 'array' then raise exception 'VALIDATION_ERROR'; end if;
  select coalesce(array_agg(distinct value),'{}') into specs from jsonb_array_elements_text(payload->'species');
  if not specs <@ array['DOG','CAT','BIRD','RABBIT'] then raise exception 'VALIDATION_ERROR'; end if;
  update app.users set alias=btrim(payload->>'alias'),species=specs,updated_at=now() where user_id=u.user_id returning * into u;
  if u.role='SHELTER' then update app.organizations set name=btrim(payload->>'organization_name'),location=coalesce(payload->>'location',''),updated_at=now() where organization_id=u.organization_id; end if;
  return app.account(u);
 when 'details' then
  select * into a from app.animals where animal_id=payload->>'animal_id';
  if a.animal_id is null or not app.can_see(u,a) then raise exception 'NOT_FOUND'; end if;
  return app.public_animal(a)||jsonb_build_object('organization',(select jsonb_build_object('name',name,'location',location) from app.organizations where organization_id=a.organization_id),
  'liked',exists(select 1 from app.swipes where user_id=u.user_id and animal_id=a.animal_id and decision='LIKE'),
  'request',(select to_jsonb(q) from app.requests q where user_id=u.user_id and animal_id=a.animal_id));
 when 'swipe' then
  if coalesce(payload->>'decision','') not in ('LIKE','PASS') then raise exception 'VALIDATION_ERROR'; end if;
  select * into a from app.animals where animal_id=payload->>'animal_id' for update;
  if a.animal_id is null then raise exception 'NOT_FOUND'; end if;
  select * into s from app.swipes where user_id=u.user_id and animal_id=a.animal_id;
  if s.decision=payload->>'decision' then return to_jsonb(s); end if;
  if a.status<>'AVAILABLE' and not coalesce(payload->>'decision'='PASS' and s.decision='LIKE',false) then raise exception 'NOT_AVAILABLE'; end if;
  insert into app.swipes(user_id,animal_id,decision) values(u.user_id,a.animal_id,payload->>'decision')
  on conflict(user_id,animal_id) do update set decision=excluded.decision,updated_at=now() returning * into s;
  return to_jsonb(s);
 when 'resetPasses' then delete from app.swipes where user_id=u.user_id and decision='PASS'; return 'true';
 when 'view' then
  if coalesce(payload->>'view_type','') not in ('CARD','PROFILE') then raise exception 'VALIDATION_ERROR'; end if;
  select * into a from app.animals where animal_id=payload->>'animal_id';
  if a.animal_id is null or not app.can_see(u,a) then raise exception 'NOT_FOUND'; end if;
  insert into app.views(user_id,animal_id,view_type) values(u.user_id,a.animal_id,payload->>'view_type') on conflict(user_id,animal_id,view_type) do nothing;
  return 'true';
 when 'request' then
  select * into a from app.animals where animal_id=payload->>'animal_id' for update;
  if a.animal_id is null then raise exception 'NOT_FOUND'; end if;
  select * into r from app.requests where user_id=u.user_id and animal_id=a.animal_id;
  if r.request_id is not null then return to_jsonb(r); end if;
  if a.status<>'AVAILABLE' then raise exception 'NOT_AVAILABLE'; end if;
  insert into app.requests(user_id,animal_id) values(u.user_id,a.animal_id) returning * into r; return to_jsonb(r);
 when 'requestStatus' then
  -- All competing mutations lock the animal first to avoid reversed lock order.
  select * into a from app.animals where animal_id=(select animal_id from app.requests where request_id=payload->>'request_id') for update;
  select * into r from app.requests where request_id=payload->>'request_id' for update;
  if r.request_id is null then raise exception 'NOT_FOUND'; end if;
  if payload->>'status'='WITHDRAWN' then
   if r.user_id<>u.user_id or (u.role<>'INTERESTED' and not app.master(u)) then raise exception 'FORBIDDEN'; end if;
  else
   if not app.can_own(u,a) then raise exception 'FORBIDDEN'; end if;
   if coalesce(payload->>'status','') not in ('APPROVED','DECLINED') then raise exception 'VALIDATION_ERROR'; end if;
  end if;
  if r.status=payload->>'status' then return to_jsonb(r); end if;
  if r.status<>'PENDING' then raise exception 'INVALID_TRANSITION'; end if;
  if payload->>'status'='APPROVED' and a.status<>'AVAILABLE' then raise exception 'NOT_AVAILABLE'; end if;
  update app.requests set status=payload->>'status',updated_at=now(),handled_by_user_id=case when app.can_own(u,a) then u.user_id else null end where request_id=r.request_id returning * into r;
  return to_jsonb(r);
 when 'saveAnimal' then
  if nullif(payload->>'animal_id','') is not null then
   select * into old from app.animals where animal_id=payload->>'animal_id' for update;
   if old.animal_id is null then raise exception 'NOT_FOUND'; end if;
   if not app.can_own(u,old) then raise exception 'FORBIDDEN'; end if;
   org:=old.organization_id; aid:=old.animal_id;
  else org:=case when app.master(u) then payload->>'organization_id' else u.organization_id end; aid:='ANM_'||gen_random_uuid(); end if;
  if org is null or not exists(select 1 from app.organizations where organization_id=org) then raise exception 'VALIDATION_ERROR'; end if;
  if old.animal_id is not null and ((old.status<>'DRAFT' and payload->>'status'='DRAFT') or (old.status='ADOPTED' and payload->>'status'<>'ADOPTED')) then raise exception 'INVALID_TRANSITION'; end if;
  iid:=nullif(payload->>'primary_image_id','');
  if iid is not null and not exists(select 1 from app.animal_images where image_id=iid and animal_id=aid) then raise exception 'IMAGE_INVALID'; end if;
  path:=nullif(payload->>'storage_path','');
  if path is not null then
   select metadata->>'mimetype' into mime from storage.objects where bucket_id='animal-images' and name=path and owner_id=auth.uid()::text and (metadata->>'size')::bigint<=2097152;
   if mime is null or mime not in ('image/jpeg','image/png') or split_part(path,'/',1)<>org then raise exception 'IMAGE_INVALID'; end if;
   if exists(select 1 from app.animal_images where storage_path=path) then raise exception 'IMAGE_ASSIGNED'; end if;
   iid:='IMG_'||gen_random_uuid();
  end if;
  if payload->>'status'='AVAILABLE' and iid is null then raise exception 'IMAGE_INVALID'; end if;
  insert into app.animals(animal_id,organization_id,name,species,breed_label,age_months,size_category,description,status,primary_image_id)
  values(aid,org,btrim(payload->>'name'),payload->>'species',coalesce(payload->>'breed_label',''),nullif(payload->>'age_months','')::integer,coalesce(payload->>'size_category',''),btrim(payload->>'description'),payload->>'status',iid)
  on conflict(animal_id) do update set name=excluded.name,species=excluded.species,breed_label=excluded.breed_label,age_months=excluded.age_months,size_category=excluded.size_category,description=excluded.description,status=excluded.status,primary_image_id=excluded.primary_image_id,updated_at=now() returning * into a;
  if path is not null then insert into app.animal_images(image_id,animal_id,storage_path,mime_type,alt_text,file_name) values(iid,aid,path,mime,a.name,a.name); end if;
  if a.status='ADOPTED' then update app.requests set status='CLOSED_UNAVAILABLE',updated_at=now() where animal_id=aid and status='PENDING'; end if;
  return to_jsonb(a);
 when 'image' then
  select * into a from app.animals where animal_id=payload->>'animal_id';
  if a.animal_id is null or not app.can_see(u,a) then raise exception 'NOT_FOUND'; end if;
  select * into img from app.animal_images where image_id=a.primary_image_id;
  if img.image_id is null then return 'null'; end if;
  return jsonb_build_object('path',img.storage_path,'mime_type',img.mime_type,'alt_text',img.alt_text);
 when 'images' then
  if jsonb_typeof(payload->'animal_ids') is distinct from 'array' or jsonb_array_length(payload->'animal_ids')>12 then raise exception 'VALIDATION_ERROR'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('animal_id',pictured.animal_id,'image',case when i.image_id is null then null else jsonb_build_object('path',i.storage_path,'mime_type',i.mime_type,'alt_text',i.alt_text) end))
   from app.animals pictured left join app.animal_images i on i.image_id=pictured.primary_image_id where pictured.animal_id in(select jsonb_array_elements_text(payload->'animal_ids')) and app.can_see(u,pictured)),'[]');
 when 'adminAccounts' then
  return coalesce((select jsonb_agg(jsonb_build_object('user_id',t.user_id,'email',t.email,'alias',t.alias,'role',t.role,'is_admin',t.is_admin,'approved',app.approved(t),
  'organization',(select jsonb_build_object('name',name,'email',email) from app.organizations where organization_id=t.organization_id)) order by t.created_at) from app.users t),'[]');
 when 'aiStatus' then return 'true';
 when 'adminApproval' then
  if jsonb_typeof(payload->'approved') is distinct from 'boolean' then raise exception 'VALIDATION_ERROR'; end if;
  select * into target from app.users where user_id=payload->>'user_id' for update;
  if target.user_id is null then raise exception 'NOT_FOUND'; end if;
  if target.user_id=u.user_id and not (payload->>'approved')::boolean then raise exception 'SELF_LOCK'; end if;
  if target.role='SHELTER' then update app.organizations set approved=(payload->>'approved')::boolean,updated_at=now() where organization_id=target.organization_id;
  else update app.users set approved=(payload->>'approved')::boolean,updated_at=now() where user_id=target.user_id; end if;
  return 'true';
 when 'adminResetTarget' then
  perform app.consume('reset:'||u.user_id,12,60);
  select * into target from app.users where user_id=payload->>'user_id';
  if target.user_id is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('email',target.email,'auth_id',target.auth_id);
 when 'reserveAi' then
  perform app.consume('ai-user:'||u.user_id,3,60);
  perform app.consume('ai-day:'||(now() at time zone 'UTC')::date,20,86400);
  return app.discover(u);
 else raise exception 'VALIDATION_ERROR';
 end case;
end $$;
revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
commit;
