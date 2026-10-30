-- Request-scoped meetings, private conversation history and per-account read cursors.
begin;
alter table app.requests drop constraint requests_status_check;
alter table app.requests add constraint requests_status_check check(status in ('PENDING','APPROVED','DECLINED','WITHDRAWN','CLOSED_UNAVAILABLE','CANCELLED'));
alter table app.requests add column meeting_at timestamptz;
alter table app.requests add column meeting_place text not null default '' check(length(meeting_place)<=240);
alter table app.requests add column meeting_notes text not null default '' check(length(meeting_notes)<=2000);
alter table app.requests add column chat_opened_at timestamptz;
update app.requests set chat_opened_at=updated_at where status='APPROVED';
create table app.request_events (
 event_id bigint generated always as identity primary key,
 request_id text not null references app.requests on delete cascade,
 sender_user_id text references app.users on update cascade,
 kind text not null check(kind in ('REQUEST','STATUS','MEETING','MESSAGE')),
 body text not null check(length(body) between 1 and 2000),
 client_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,sender_user_id,client_id)
);
create index request_events_thread on app.request_events(request_id,event_id);
create table app.request_reads (
 request_id text not null references app.requests on delete cascade,
 user_id text not null references app.users on update cascade on delete cascade,
 last_event_id bigint not null default 0,
 primary key(request_id,user_id)
);
alter table app.request_events enable row level security;
alter table app.request_reads enable row level security;
revoke all on app.request_events,app.request_reads from public,anon,authenticated;

create function app.meeting_participant(u app.users,r app.requests) returns boolean language sql stable set search_path='' as $$
 select r.user_id=u.user_id or (u.role='SHELTER' and exists(select 1 from app.animals a where a.animal_id=r.animal_id and a.organization_id=u.organization_id))
$$;
create function app.request_activity() returns trigger language plpgsql set search_path='' as $$
declare sender text; label text;
begin
 select user_id into sender from app.users where auth_id=auth.uid();
 if TG_OP='INSERT' then
  insert into app.request_events(request_id,sender_user_id,kind,body) values(new.request_id,new.user_id,'REQUEST','Kennenlernen angefragt.');
 elsif new.status is distinct from old.status then
  label:=case new.status when 'APPROVED' then 'Kennenlernen bestätigt. Der Chat ist jetzt geöffnet.' when 'DECLINED' then 'Die Anfrage wurde abgelehnt.' when 'WITHDRAWN' then 'Die Anfrage wurde zurückgezogen.' when 'CANCELLED' then 'Das Kennenlernen wurde abgesagt. Der Chat ist geschlossen.' else 'Die Anfrage wurde geschlossen. Das Tier ist nicht mehr verfügbar.' end;
  insert into app.request_events(request_id,sender_user_id,kind,body) values(new.request_id,sender,'STATUS',label);
 end if;
 return new;
end $$;
create function app.open_request_chat() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='APPROVED' and new.chat_opened_at is null then new.chat_opened_at:=clock_timestamp(); end if;
 return new;
end $$;
create trigger request_chat_open before insert or update on app.requests for each row execute function app.open_request_chat();
create trigger request_activity after insert or update of status on app.requests for each row execute function app.request_activity();
-- Existing open requests and confirmations become discoverable without inventing chat messages.
insert into app.request_events(request_id,sender_user_id,kind,body,created_at)
 select request_id,case when status='PENDING' then user_id else handled_by_user_id end,
 case when status='PENDING' then 'REQUEST' else 'STATUS' end,
 case when status='PENDING' then 'Kennenlernen angefragt.' else 'Kennenlernen bestätigt. Der Chat ist jetzt geöffnet.' end,updated_at
 from app.requests where status in ('PENDING','APPROVED');

create or replace function app.request_list(u app.users) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('request_id',r.request_id,'animal',app.public_animal(a),'status',r.status,
 'created_at',r.created_at,'alias',case when app.can_own(u,a) then person.alias else '' end,
 'meeting_at',r.meeting_at,'meeting_place',r.meeting_place,'meeting_notes',r.meeting_notes,
 'chat_opened',r.chat_opened_at is not null,'participant',app.meeting_participant(u,r),
 'can_manage',u.role='SHELTER' and u.organization_id=a.organization_id,
 'unread_count',case when app.meeting_participant(u,r) then (select count(*) from app.request_events e where e.request_id=r.request_id and e.sender_user_id is distinct from u.user_id and e.event_id>coalesce((select last_event_id from app.request_reads where request_id=r.request_id and user_id=u.user_id),0)) else 0 end)
 order by r.created_at desc),'[]')
 from app.requests r join app.animals a using(animal_id) join app.users person on person.user_id=r.user_id
 where app.can_own(u,a) or r.user_id=u.user_id
$$;

create function public.tier_meeting_rpc(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u app.users; r app.requests; a app.animals; e app.request_events; result jsonb; cursor_id bigint; before_id bigint; seen_id bigint; text_body text; cid uuid; at_time timestamptz; owner boolean;
begin
 u:=app.actor();
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'VALIDATION_ERROR'; end if;
 if action='notifications' then
  return coalesce((select jsonb_agg(jsonb_build_object('request_id',q.request_id,'unread_count',q.n)) from (
   select r0.request_id,count(e0.event_id) n from app.requests r0
   join app.request_events e0 on e0.request_id=r0.request_id
   left join app.request_reads rd on rd.request_id=r0.request_id and rd.user_id=u.user_id
   where app.meeting_participant(u,r0) and e0.sender_user_id is distinct from u.user_id and e0.event_id>coalesce(rd.last_event_id,0)
   group by r0.request_id) q),'[]');
 end if;
 -- Consistent lock order with approval, listing edits and deletion. Reads need no locks.
 if action in ('sendMessage','saveMeeting','cancelMeeting') then
  select * into a from app.animals where animal_id=(select animal_id from app.requests where request_id=payload->>'request_id') for update;
  select * into r from app.requests where request_id=payload->>'request_id' for update;
 else
  select * into r from app.requests where request_id=payload->>'request_id';
  select * into a from app.animals where animal_id=r.animal_id;
 end if;
 if r.request_id is null or not app.meeting_participant(u,r) then raise exception 'NOT_FOUND'; end if;
 owner:=u.role='SHELTER' and u.organization_id=a.organization_id;
 case action
 when 'meeting' then
  if payload ? 'before' then
   if coalesce(payload->>'before','') !~ '^[0-9]{1,18}$' then raise exception 'VALIDATION_ERROR'; end if;
   before_id:=(payload->>'before')::bigint;
  end if;
  select coalesce(jsonb_agg(q.item order by q.event_id),'[]') into result from (
   select ev.event_id,jsonb_build_object('event_id',ev.event_id::text,'kind',ev.kind,'body',ev.body,'created_at',ev.created_at,
    'mine',ev.sender_user_id=u.user_id,'sender',coalesce(p.alias,'TierFinder')) item
   from app.request_events ev left join app.users p on p.user_id=ev.sender_user_id
   where ev.request_id=r.request_id and (before_id is null or ev.event_id<before_id)
   order by ev.event_id desc limit 50) q;
  return jsonb_build_object('request_id',r.request_id,'animal_name',a.name,'status',r.status,
   'can_manage',owner,'chat_opened',r.chat_opened_at is not null,
   'can_send',r.status='APPROVED' and a.deleted_at is null and a.status<>'ADOPTED',
   'can_cancel',r.status='APPROVED' and a.deleted_at is null and a.status<>'ADOPTED',
   'can_reopen',owner and a.status='PAUSED' and a.deleted_at is null and a.primary_image_id is not null and not exists(select 1 from app.requests other where other.animal_id=a.animal_id and other.request_id<>r.request_id and other.status='APPROVED'),
   'meeting_at',r.meeting_at,'meeting_place',r.meeting_place,'meeting_notes',r.meeting_notes,
   'events',result,'has_older',exists(select 1 from app.request_events ev where ev.request_id=r.request_id and ev.event_id<(result->0->>'event_id')::bigint));
 when 'readMeeting' then
  if coalesce(payload->>'event_id','') !~ '^[0-9]{1,18}$' then raise exception 'VALIDATION_ERROR'; end if;
  seen_id:=(payload->>'event_id')::bigint;
  if not exists(select 1 from app.request_events where request_id=r.request_id and event_id=seen_id) then raise exception 'VALIDATION_ERROR'; end if;
  insert into app.request_reads(request_id,user_id,last_event_id) values(r.request_id,u.user_id,seen_id)
  on conflict(request_id,user_id) do update set last_event_id=greatest(app.request_reads.last_event_id,excluded.last_event_id);
  return 'true';
 when 'sendMessage' then
  if jsonb_typeof(payload->'body') is distinct from 'string' or length(btrim(payload->>'body')) not between 1 and 2000 then raise exception 'MESSAGE_INVALID'; end if;
  text_body:=btrim(payload->>'body');
  if coalesce(payload->>'client_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'VALIDATION_ERROR'; end if;
  cid:=(payload->>'client_id')::uuid;
  select * into e from app.request_events where request_id=r.request_id and sender_user_id=u.user_id and client_id=cid;
  if e.event_id is not null then
   if e.body<>text_body then raise exception 'VALIDATION_ERROR'; end if;
   return jsonb_build_object('event_id',e.event_id::text);
  end if;
  if r.status<>'APPROVED' or a.deleted_at is not null or a.status='ADOPTED' then raise exception 'CHAT_CLOSED'; end if;
  perform app.consume('chat:'||u.user_id,30,60);
  insert into app.request_events(request_id,sender_user_id,kind,body,client_id) values(r.request_id,u.user_id,'MESSAGE',text_body,cid) returning * into e;
  return jsonb_build_object('event_id',e.event_id::text);
 when 'saveMeeting' then
  if not owner then raise exception 'FORBIDDEN'; end if;
  if r.status<>'APPROVED' or a.deleted_at is not null or a.status='ADOPTED' then raise exception 'CHAT_CLOSED'; end if;
  if jsonb_typeof(payload->'place') is distinct from 'string' or jsonb_typeof(payload->'notes') is distinct from 'string' or length(payload->>'place')>240 or length(payload->>'notes')>2000 then raise exception 'VALIDATION_ERROR'; end if;
  begin at_time:=nullif(payload->>'meeting_at','')::timestamptz; exception when others then raise exception 'VALIDATION_ERROR'; end;
  if at_time is not null and (at_time<now() or at_time>now()+interval '2 years') then raise exception 'MEETING_DATE_INVALID'; end if;
  if row(r.meeting_at,r.meeting_place,r.meeting_notes) is distinct from row(at_time,btrim(payload->>'place'),btrim(payload->>'notes')) then
   update app.requests set meeting_at=at_time,meeting_place=btrim(payload->>'place'),meeting_notes=btrim(payload->>'notes'),updated_at=now() where request_id=r.request_id;
   insert into app.request_events(request_id,sender_user_id,kind,body) values(r.request_id,u.user_id,'MEETING','Die Vermittlung hat Termin, Treffpunkt oder Hinweise aktualisiert.');
  end if;
  return 'true';
 when 'cancelMeeting' then
  if jsonb_typeof(payload->'reopen') is distinct from 'boolean' then raise exception 'VALIDATION_ERROR'; end if;
  if (payload->>'reopen')::boolean and not owner then raise exception 'FORBIDDEN'; end if;
  if r.status='CANCELLED' then return 'true'; end if;
  if r.status<>'APPROVED' or a.deleted_at is not null or a.status='ADOPTED' then raise exception 'INVALID_TRANSITION'; end if;
  if (payload->>'reopen')::boolean then
   if a.status<>'PAUSED' or a.primary_image_id is null or exists(select 1 from app.requests other where other.animal_id=a.animal_id and other.request_id<>r.request_id and other.status='APPROVED') then raise exception 'REOPEN_UNAVAILABLE'; end if;
   update app.animals set status='AVAILABLE',updated_at=now() where animal_id=a.animal_id;
  end if;
  update app.requests set status='CANCELLED',updated_at=now(),handled_by_user_id=u.user_id where request_id=r.request_id;
  return 'true';
 else raise exception 'VALIDATION_ERROR';
 end case;
end $$;
revoke all on all functions in schema app from public,anon,authenticated;
revoke all on function public.tier_meeting_rpc(text,jsonb) from public,anon;
grant execute on function public.tier_meeting_rpc(text,jsonb) to authenticated;
commit;
