begin;
-- Lookalike has its own candidate pool. The swipe deck is unchanged.
create or replace function public.tier_ai_candidates(include_seen boolean default false, reserve boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u app.users; result jsonb;
begin
 u:=app.actor();
 if u.role<>'INTERESTED' and not app.master(u) then raise exception 'FORBIDDEN'; end if;
 select coalesce(jsonb_agg(app.public_animal(pool.animal) order by pool.species_rank, (pool.animal).species, (pool.animal).animal_id),'[]') into result
 from (
  select a as animal, row_number() over(partition by a.species order by a.animal_id) as species_rank
  from app.animals a
  join app.animal_images i on i.image_id=a.primary_image_id and i.animal_id=a.animal_id
  where a.status='AVAILABLE' and a.species=any(u.species) and app.can_see(u,a)
  and (coalesce(include_seen,false) or not exists(select 1 from app.swipes s where s.user_id=u.user_id and s.animal_id=a.animal_id))
  order by species_rank,a.species,a.animal_id limit 128
 ) pool;
 if coalesce(reserve,false) and jsonb_array_length(result)>0 then
  perform app.consume('ai-user:'||u.user_id,3,60);
  begin
   perform app.consume('ai-day:'||(now() at time zone 'UTC')::date,20,86400);
  exception when others then
   if sqlerrm='RATE_LIMIT' then raise exception 'AI_DAILY_LIMIT'; else raise; end if;
  end;
 end if;
 return result;
end $$;
revoke all on function public.tier_ai_candidates(boolean,boolean) from public,anon;
grant execute on function public.tier_ai_candidates(boolean,boolean) to authenticated;
commit;
