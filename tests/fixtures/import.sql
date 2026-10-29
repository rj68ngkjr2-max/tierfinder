-- Temporary server-only importer. Revoke/drop after the verified migration.
begin;
create function public.tier_import(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x jsonb; uid uuid; counts jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'FORBIDDEN'; end if;
 for x in select value from jsonb_array_elements(payload->'Organizations') loop
  insert into app.organizations(organization_id,name,email,location,approved,created_at,updated_at)
  values(x->>'organization_id',x->>'name',coalesce(x->>'email',''),coalesce(x->>'location',''),(x->>'approved')::boolean,coalesce(nullif(x->>'created_at','')::timestamptz,now()),coalesce(nullif(x->>'updated_at','')::timestamptz,now()))
  on conflict(organization_id) do update set name=excluded.name,email=excluded.email,location=excluded.location,approved=excluded.approved,updated_at=excluded.updated_at;
 end loop;
 for x in select value from jsonb_array_elements(payload->'Users') loop
  uid:=(payload->'auth_map'->>(x->>'user_id'))::uuid;
  if uid is null or not exists(select 1 from auth.users where id=uid and lower(email)=lower(x->>'email')) then raise exception 'IMPORT_USER_MISSING'; end if;
  update app.users set user_id=x->>'user_id',email=lower(x->>'email'),alias=x->>'alias',role=x->>'role',organization_id=nullif(x->>'organization_id',''),
  state=case when x->>'state'='ACTIVE' then 'ACTIVE' else 'DISABLED' end,approved=case when x->>'approved'='true' then true else false end,is_admin=(x->>'is_admin')='true',
  consent_version=coalesce(x->>'consent_version','privacy-2'),consent_at=coalesce(nullif(x->>'consent_at','')::timestamptz,now()),created_at=coalesce(nullif(x->>'created_at','')::timestamptz,now()),updated_at=coalesce(nullif(x->>'updated_at','')::timestamptz,now()) where auth_id=uid;
  if not found then raise exception 'IMPORT_PROFILE_MISSING'; end if;
 end loop;
 for x in select value from jsonb_array_elements(payload->'Preferences') loop
  update app.users set species=array(select jsonb_array_elements_text((x->>'species_json')::jsonb)) where user_id=x->>'user_id';
 end loop;
 for x in select value from jsonb_array_elements(payload->'Animals') loop
  insert into app.animals(animal_id,organization_id,name,species,breed_label,age_months,size_category,description,status,created_at,updated_at)
  values(x->>'animal_id',x->>'organization_id',x->>'name',x->>'species',coalesce(x->>'breed_label',''),nullif(x->>'age_months','')::integer,coalesce(x->>'size_category',''),x->>'description',x->>'status',coalesce(nullif(x->>'created_at','')::timestamptz,now()),coalesce(nullif(x->>'updated_at','')::timestamptz,now()))
  on conflict(animal_id) do update set name=excluded.name,species=excluded.species,breed_label=excluded.breed_label,age_months=excluded.age_months,size_category=excluded.size_category,description=excluded.description,status=excluded.status,updated_at=excluded.updated_at;
 end loop;
 for x in select value from jsonb_array_elements(payload->'AnimalImages') loop
  insert into app.animal_images(image_id,animal_id,storage_path,mime_type,file_name,alt_text,source_url,usage_note,updated_at)
  values(x->>'image_id',x->>'animal_id',x->>'storage_path',x->>'mime_type',coalesce(x->>'file_name',''),coalesce(x->>'alt_text',''),coalesce(x->>'source_url',''),coalesce(x->>'usage_note',''),coalesce(nullif(x->>'updated_at','')::timestamptz,now()))
  on conflict(image_id) do update set storage_path=excluded.storage_path,mime_type=excluded.mime_type,file_name=excluded.file_name,alt_text=excluded.alt_text,updated_at=excluded.updated_at;
 end loop;
 for x in select value from jsonb_array_elements(payload->'Animals') loop update app.animals set primary_image_id=nullif(x->>'primary_image_id','') where animal_id=x->>'animal_id'; end loop;
 for x in select value from jsonb_array_elements(payload->'Swipes') loop
  insert into app.swipes(swipe_id,user_id,animal_id,decision,created_at,updated_at) values(x->>'swipe_id',x->>'user_id',x->>'animal_id',x->>'decision',coalesce(nullif(x->>'created_at','')::timestamptz,now()),coalesce(nullif(x->>'updated_at','')::timestamptz,now()))
  on conflict(user_id,animal_id) do update set decision=excluded.decision,updated_at=excluded.updated_at;
 end loop;
 for x in select value from jsonb_array_elements(payload->'Requests') loop
  insert into app.requests(request_id,user_id,animal_id,status,handled_by_user_id,created_at,updated_at) values(x->>'request_id',x->>'user_id',x->>'animal_id',x->>'status',nullif(x->>'handled_by_user_id',''),coalesce(nullif(x->>'created_at','')::timestamptz,now()),coalesce(nullif(x->>'updated_at','')::timestamptz,now()))
  on conflict(user_id,animal_id) do update set status=excluded.status,handled_by_user_id=excluded.handled_by_user_id,updated_at=excluded.updated_at;
 end loop;
 for x in select value from jsonb_array_elements(payload->'Views') loop
  insert into app.views(view_id,user_id,animal_id,view_type,first_viewed_at) values(x->>'view_id',x->>'user_id',x->>'animal_id',x->>'view_type',coalesce(nullif(x->>'first_viewed_at','')::timestamptz,now())) on conflict(user_id,animal_id,view_type) do nothing;
 end loop;
 return jsonb_build_object('users',(select count(*) from app.users),'organizations',(select count(*) from app.organizations),'animals',(select count(*) from app.animals),'images',(select count(*) from app.animal_images),'swipes',(select count(*) from app.swipes),'requests',(select count(*) from app.requests),'views',(select count(*) from app.views));
end $$;
revoke all on function public.tier_import(jsonb) from public, anon, authenticated;
grant execute on function public.tier_import(jsonb) to service_role;
commit;
