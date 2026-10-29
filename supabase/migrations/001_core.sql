-- TierFinder: private application data, authenticated transactional API.
begin;
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

create table app.organizations (
 organization_id text primary key default ('ORG_'||gen_random_uuid()),
 name text not null check(length(btrim(name)) between 1 and 100), email text not null default '',
 location text not null default '' check(length(location)<=80), approved boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app.users (
 user_id text primary key default ('USR_'||gen_random_uuid()),
 auth_id uuid unique not null references auth.users(id) on delete cascade,
 email text unique not null, alias text not null check(length(btrim(alias)) between 1 and 60),
 role text not null check(role in ('INTERESTED','SHELTER','ADMIN')),
 organization_id text references app.organizations,
 state text not null default 'ACTIVE' check(state in ('ACTIVE','DISABLED')),
 approved boolean not null default false, is_admin boolean not null default false,
 species text[] not null default array['DOG','CAT'] check(species <@ array['DOG','CAT','BIRD','RABBIT']),
 consent_version text not null default 'privacy-3', consent_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(role <> 'SHELTER' or organization_id is not null), check(role <> 'ADMIN' or is_admin)
);
create table app.animals (
 animal_id text primary key default ('ANM_'||gen_random_uuid()),
 organization_id text not null references app.organizations,
 name text not null check(length(btrim(name)) between 1 and 60),
 species text not null check(species in ('DOG','CAT','BIRD','RABBIT')),
 breed_label text not null default '' check(length(breed_label)<=80),
 age_months integer check(age_months between 0 and 1200),
 size_category text not null default '' check(size_category in ('','SMALL','MEDIUM','LARGE')),
 temperament_tags jsonb not null default '[]',
 description text not null check(length(btrim(description)) between 1 and 2000),
 status text not null default 'DRAFT' check(status in ('DRAFT','AVAILABLE','PAUSED','ADOPTED')),
 primary_image_id text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app.animal_images (
 image_id text primary key default ('IMG_'||gen_random_uuid()),
 animal_id text not null references app.animals on delete cascade,
 storage_path text not null unique, mime_type text not null check(mime_type in ('image/jpeg','image/png')),
 file_name text not null default '', alt_text text not null default '', sort_order integer not null default 1,
 source_url text not null default '', usage_note text not null default '', updated_at timestamptz not null default now(),
 unique(animal_id,image_id)
);
alter table app.animals add constraint animal_primary_image_fk foreign key(animal_id,primary_image_id)
 references app.animal_images(animal_id,image_id) deferrable initially deferred;
create table app.swipes (
 swipe_id text primary key default ('SWP_'||gen_random_uuid()),
 user_id text not null references app.users on update cascade on delete cascade,
 animal_id text not null references app.animals on delete cascade,
 decision text not null check(decision in ('LIKE','PASS')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,animal_id)
);
create table app.requests (
 request_id text primary key default ('REQ_'||gen_random_uuid()),
 user_id text not null references app.users on update cascade on delete cascade,
 animal_id text not null references app.animals on delete cascade,
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','DECLINED','WITHDRAWN','CLOSED_UNAVAILABLE')),
 handled_by_user_id text references app.users on update cascade,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,animal_id)
);
create table app.views (
 view_id text primary key default ('VIW_'||gen_random_uuid()),
 user_id text not null references app.users on update cascade on delete cascade,
 animal_id text not null references app.animals on delete cascade,
 view_type text not null check(view_type in ('CARD','PROFILE')),
 first_viewed_at timestamptz not null default now(), unique(user_id,animal_id,view_type)
);
create table app.rate_limits(key text primary key, count integer not null, expires_at timestamptz not null);
create index animals_discovery on app.animals(species,animal_id) where status='AVAILABLE';
create index animals_organization on app.animals(organization_id);
create index images_animal on app.animal_images(animal_id);
create index swipes_animal_decision on app.swipes(animal_id,decision);
create index requests_animal_status on app.requests(animal_id,status);
create index views_animal_type on app.views(animal_id,view_type);
create index users_organization on app.users(organization_id);
alter table app.organizations enable row level security;
alter table app.users enable row level security;
alter table app.animals enable row level security;
alter table app.animal_images enable row level security;
alter table app.swipes enable row level security;
alter table app.requests enable row level security;
alter table app.views enable row level security;
alter table app.rate_limits enable row level security;

create function app.approved(u app.users) returns boolean language sql stable set search_path='' as $$
 select u.state='ACTIVE' and case when u.role='SHELTER' then exists(select 1 from app.organizations o where o.organization_id=u.organization_id and o.approved)
 else u.approved and (u.role<>'ADMIN' or u.is_admin) end
$$;
create function app.actor() returns app.users language plpgsql stable set search_path='' as $$
declare u app.users;
begin
 select * into u from app.users where auth_id=auth.uid();
 if u.user_id is null or u.state<>'ACTIVE' then raise exception 'NOT_AUTHENTICATED'; end if;
 if not app.approved(u) then
  if u.role='SHELTER' then raise exception 'ORGANIZATION_PENDING'; else raise exception 'APPROVAL_PENDING'; end if;
 end if;
 return u;
end $$;
create function app.master(u app.users) returns boolean language sql immutable set search_path='' as $$select u.role='ADMIN' and u.is_admin$$;
create function app.can_own(u app.users,a app.animals) returns boolean language sql immutable set search_path='' as $$
 select app.master(u) or (u.role='SHELTER' and a.organization_id=u.organization_id)
$$;
create function app.can_see(u app.users,a app.animals) returns boolean language sql stable set search_path='' as $$
 select app.can_own(u,a) or (u.role='INTERESTED' and (a.status='AVAILABLE' or
 (a.status<>'DRAFT' and (exists(select 1 from app.swipes s where s.user_id=u.user_id and s.animal_id=a.animal_id and s.decision='LIKE')
 or exists(select 1 from app.requests r where r.user_id=u.user_id and r.animal_id=a.animal_id)))))
$$;
create function app.account(u app.users) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('alias',u.alias,'email',u.email,'role',u.role,'is_admin',u.is_admin,'species',u.species,
 'organization',(select jsonb_build_object('organization_id',o.organization_id,'name',o.name,'location',o.location) from app.organizations o where o.organization_id=u.organization_id))
$$;
create function app.public_animal(a app.animals) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('animal_id',a.animal_id,'name',a.name,'species',a.species,'breed_label',a.breed_label,
 'age_months',coalesce(to_jsonb(a.age_months),'""'::jsonb),'size_category',a.size_category,'description',a.description,
 'status',a.status,'has_image',a.primary_image_id is not null,'image_version',coalesce(a.primary_image_id,'')||':'||a.updated_at)
$$;
create function app.discover(u app.users) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(app.public_animal(a) order by a.animal_id),'[]') from app.animals a
 where a.status='AVAILABLE' and a.species=any(u.species)
 and not exists(select 1 from app.swipes s where s.user_id=u.user_id and s.animal_id=a.animal_id)
$$;
create function app.likes(u app.users) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(app.public_animal(a) order by a.name),'[]') from app.animals a
 join app.swipes s on s.animal_id=a.animal_id and s.user_id=u.user_id and s.decision='LIKE' where a.status<>'DRAFT'
$$;
create function app.request_list(u app.users) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('request_id',r.request_id,'animal',app.public_animal(a),'status',r.status,
 'created_at',r.created_at,'alias',case when app.can_own(u,a) then person.alias else '' end) order by r.created_at desc),'[]')
 from app.requests r join app.animals a using(animal_id) join app.users person on person.user_id=r.user_id
 where app.can_own(u,a) or (u.role='INTERESTED' and r.user_id=u.user_id)
$$;
create function app.workspace(u app.users) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('animals',coalesce((select jsonb_agg(to_jsonb(a)||app.public_animal(a)||jsonb_build_object(
 'metrics',jsonb_build_object(
 'likes',(select count(*) from app.swipes s where s.animal_id=a.animal_id and s.decision='LIKE'),
 'cards',(select count(*) from app.views v where v.animal_id=a.animal_id and v.view_type='CARD'),
 'profiles',(select count(*) from app.views v where v.animal_id=a.animal_id and v.view_type='PROFILE'),
 'pending',(select count(*) from app.requests r where r.animal_id=a.animal_id and r.status='PENDING')),
 'images',coalesce((select jsonb_agg(jsonb_build_object('image_id',i.image_id,'label',coalesce(nullif(i.alt_text,''),i.file_name))) from app.animal_images i where i.animal_id=a.animal_id),'[]')) order by a.created_at desc)
 from app.animals a where app.can_own(u,a)),'[]'),
 'organizations',case when app.master(u) then coalesce((select jsonb_agg(jsonb_build_object('organization_id',organization_id,'name',name) order by name) from app.organizations),'[]') else '[]'::jsonb end)
$$;
create function app.consume(k text,maximum integer,seconds integer) returns void language plpgsql set search_path='' as $$
declare n integer;
begin
 insert into app.rate_limits values(k,1,now()+make_interval(secs=>seconds))
 on conflict(key) do update set count=case when app.rate_limits.expires_at<=now() then 1 else app.rate_limits.count+1 end,
 expires_at=case when app.rate_limits.expires_at<=now() then now()+make_interval(secs=>seconds) else app.rate_limits.expires_at end returning count into n;
 if n>maximum then raise exception 'RATE_LIMIT'; end if;
end $$;

-- Never derive administrative privileges from user-editable auth metadata.
create function app.on_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb:=new.raw_user_meta_data; org text;
begin
 if coalesce(m->>'role','') not in ('INTERESTED','SHELTER') then raise exception 'ROLE_REQUIRED'; end if;
 if coalesce(m->>'consent','false')<>'true' then raise exception 'CONSENT_REQUIRED'; end if;
 if length(btrim(coalesce(m->>'alias',''))) not between 1 and 60 then raise exception 'ALIAS_REQUIRED'; end if;
 if m->>'role'='SHELTER' then
  if length(btrim(coalesce(m->>'organization_name',''))) not between 1 and 100 then raise exception 'ORGANIZATION_REQUIRED'; end if;
  insert into app.organizations(name,email,location) values(btrim(m->>'organization_name'),lower(new.email),coalesce(m->>'location','')) returning organization_id into org;
 end if;
 insert into app.users(auth_id,email,alias,role,organization_id) values(new.id,lower(new.email),btrim(m->>'alias'),m->>'role',org);
 return new;
end $$;
create trigger tierfinder_signup after insert on auth.users for each row execute function app.on_signup();

create function public.tier_rpc(action text,payload jsonb default '{}') returns jsonb
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
  return coalesce((select jsonb_agg(jsonb_build_object('animal_id',a.animal_id,'image',case when i.image_id is null then null else jsonb_build_object('path',i.storage_path,'mime_type',i.mime_type,'alt_text',i.alt_text) end))
   from app.animals a left join app.animal_images i on i.image_id=a.primary_image_id where a.animal_id in(select jsonb_array_elements_text(payload->'animal_ids')) and app.can_see(u,a)),'[]');
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
revoke all on function public.tier_rpc(text,jsonb) from public, anon;
grant execute on function public.tier_rpc(text,jsonb) to authenticated;

-- Only already-authorized viewers can download; only the organization can upload.
create function public.tier_image_access(path text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare u app.users;
begin
 select * into u from app.users where auth_id=auth.uid();
 if u.user_id is null or not app.approved(u) then return false; end if;
 if writing then return exists(select 1 from app.organizations o where o.organization_id=split_part(path,'/',1) and (app.master(u) or (u.role='SHELTER' and u.organization_id=o.organization_id))); end if;
 return exists(select 1 from app.animal_images i join app.animals a using(animal_id) where i.storage_path=path and app.can_see(u,a));
end $$;
revoke all on function public.tier_image_access(text,boolean) from public, anon;
grant execute on function public.tier_image_access(text,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('animal-images','animal-images',false,2097152,array['image/jpeg','image/png']);
create policy tierfinder_image_read on storage.objects for select to authenticated using(bucket_id='animal-images' and public.tier_image_access(name,false));
create policy tierfinder_image_upload on storage.objects for insert to authenticated with check(bucket_id='animal-images' and public.tier_image_access(name,true));
commit;
