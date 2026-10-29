-- Increase the application-wide demo budget without resetting consumed calls.
-- Keep authorization, candidate filtering and the per-user minute limit unchanged.
begin;
do $migration$
declare signature text; definition text;
 old_limit text := 'app.consume(''ai-day:''||(now() at time zone ''UTC'')::date,20,86400)';
 new_limit text := 'app.consume(''ai-day:''||(now() at time zone ''UTC'')::date,100,86400)';
begin
 foreach signature in array array['public.tier_ai_candidates(boolean,boolean)','public.tier_rpc(text,jsonb)'] loop
  definition := pg_get_functiondef(signature::regprocedure);
  if position(old_limit in definition)>0 then
   execute replace(definition,old_limit,new_limit);
  elsif position(new_limit in definition)=0 then
   raise exception 'Unexpected AI quota definition in %',signature;
  end if;
 end loop;
end
$migration$;
commit;
