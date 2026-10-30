-- Add public organization context and an owner-only meeting indicator.
begin;
create or replace function app.public_animal(a app.animals) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('animal_id',a.animal_id,'name',a.name,'species',a.species,'breed_label',a.breed_label,
 'age_months',coalesce(to_jsonb(a.age_months),'""'::jsonb),'size_category',a.size_category,'description',a.description,
 'location',coalesce((select o.location from app.organizations o where o.organization_id=a.organization_id),''),
 'organization_name',coalesce((select o.name from app.organizations o where o.organization_id=a.organization_id),''),
 'status',a.status,'deleted',a.deleted_at is not null,'has_image',a.deleted_at is null and a.primary_image_id is not null,'image_version',coalesce(a.primary_image_id,'')||':'||a.updated_at)
$$;
create or replace function app.workspace(u app.users) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('animals',coalesce((select jsonb_agg(to_jsonb(a)||app.public_animal(a)||jsonb_build_object(
 'has_confirmed_meeting',exists(select 1 from app.requests r where r.animal_id=a.animal_id and r.status='APPROVED'),
 'metrics',jsonb_build_object(
 'likes',(select count(*) from app.swipes s where s.animal_id=a.animal_id and s.decision='LIKE'),
 'cards',(select count(*) from app.views v where v.animal_id=a.animal_id and v.view_type='CARD'),
 'profiles',(select count(*) from app.views v where v.animal_id=a.animal_id and v.view_type='PROFILE'),
 'pending',(select count(*) from app.requests r where r.animal_id=a.animal_id and r.status='PENDING')),
 'images',coalesce((select jsonb_agg(jsonb_build_object('image_id',i.image_id,'label',coalesce(nullif(i.alt_text,''),i.file_name))) from app.animal_images i where i.animal_id=a.animal_id),'[]')) order by a.created_at desc)
 from app.animals a where a.deleted_at is null and app.can_own(u,a)),'[]'),
 'organizations',case when app.master(u) then coalesce((select jsonb_agg(jsonb_build_object('organization_id',organization_id,'name',name) order by name) from app.organizations),'[]') else '[]'::jsonb end)
$$;
revoke all on function app.public_animal(app.animals), app.workspace(app.users) from public, anon, authenticated;
commit;
