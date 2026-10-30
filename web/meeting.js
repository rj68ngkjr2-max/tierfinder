// One conversation belongs to one request. No chat data is persisted on this device.
export const meetingTime=value=>value?new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Termin noch offen';
export function localMeetingInput(value){if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function nextMeetingStep(data){
 if(data.status==='PENDING')return data.can_manage?'Prüfe diese Anfrage. In der Übersicht kannst du sie bestätigen oder ablehnen. Der Chat öffnet nach deiner Bestätigung.':'Die Vermittlung prüft deine Anfrage. Nach der Bestätigung könnt ihr hier schreiben.';
 if(data.status==='APPROVED'&&!data.can_send)return 'Das Tier ist nicht mehr verfügbar. Der bisherige Verlauf bleibt lesbar.';
 if(data.status==='APPROVED')return data.meeting_at?'Euer Termin steht. Klärt offene Fragen direkt im Chat.':'Stimmt euch im Chat ab. Die Vermittlung kann anschließend Termin und Treffpunkt eintragen.';
 return 'Diese Anfrage ist abgeschlossen. Der bisherige Verlauf bleibt lesbar.';
}
export function mountMeeting(root,id,{api,onRead,onChange}){
 let disposed=false,busy=false,timer,data=null,lastRead='0',metadata='',editing=false,retry=null;
 const events=new Map();
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const error=el('p','meeting-error');error.setAttribute('role','alert');error.hidden=true;
 const run=async(b,fn)=>{if(b.disabled)return;b.disabled=true;error.hidden=true;try{await fn();}catch(e){if(!disposed){error.textContent=e.message;error.hidden=false;}}finally{if(!disposed)b.disabled=false;}};
 const btn=(text,fn,cls='secondary')=>{const b=el('button',cls,text);b.type='button';b.onclick=()=>run(b,()=>fn(b));return b;};
 const summary=el('section','meeting-summary'),tools=el('div','meeting-tools'),log=el('div','chat-log');
 log.setAttribute('role','log');log.setAttribute('aria-label','Verlauf des Kennenlernens');log.setAttribute('aria-live','polite');log.tabIndex=0;
 const older=btn('Ältere Beiträge laden',async()=>{const first=[...events.keys()].sort((a,b)=>Number(a)-Number(b))[0];const result=await api('meeting',{request_id:id,before:first});if(disposed)return;const height=log.scrollHeight;merge(result.events);draw();log.scrollTop+=log.scrollHeight-height;older.hidden=!result.has_older;});older.hidden=true;
 const jump=btn('Neue Beiträge ↓',()=>{log.scrollTop=log.scrollHeight;markRead();});jump.hidden=true;
 const composer=el('form','chat-composer'),label=el('label','','Deine Nachricht'),input=el('textarea');
 input.id='meetingMessage';label.htmlFor=input.id;input.rows=2;input.maxLength=2000;input.required=true;input.placeholder='Schreibe der anderen Seite …';
 const submit=el('button','','Senden');submit.type='submit';const hint=el('p','small','Nur für dich und die zuständige Vermittlung. Keine E-Mail- oder Push-Benachrichtigung.');
 composer.append(label,input,submit,hint);composer.hidden=true;
 const refresh=btn('Aktualisieren',()=>refreshData(true),'subtle');
 root.replaceChildren(summary,tools,older,log,jump,composer,error,refresh);
 const nearBottom=()=>log.scrollHeight-log.scrollTop-log.clientHeight<48;
 async function markRead(){
  if(disposed||document.hidden||!nearBottom()||!events.size)return;
  const lastVisible=log.lastElementChild?.getBoundingClientRect(),bounds=root.getBoundingClientRect(),visibleBottom=Math.min(bounds.bottom,window.visualViewport?window.visualViewport.offsetTop+window.visualViewport.height:window.innerHeight);
  if(!lastVisible||lastVisible.bottom>visibleBottom+2||lastVisible.bottom<bounds.top||log.getBoundingClientRect().bottom<bounds.top)return;
  const newest=[...events.keys()].sort((a,b)=>Number(a)-Number(b)).at(-1);
  if(Number(newest)<=Number(lastRead))return;
  try{await api('readMeeting',{request_id:id,event_id:newest});if(!disposed){lastRead=String(Math.max(Number(lastRead),Number(newest)));jump.hidden=true;onRead();}}catch{/* A failed acknowledgement stays unread and is retried at the next refresh. */}
 }
 log.addEventListener('scroll',()=>{if(nearBottom())markRead();});
 root.addEventListener('scroll',markRead,{passive:true});
 function merge(items){items.forEach(item=>events.set(item.event_id,item));}
 function draw(){
  log.replaceChildren();for(const item of [...events.values()].sort((a,b)=>Number(a.event_id)-Number(b.event_id))){
   const node=el('article',item.kind==='MESSAGE'?'chat-message'+(item.mine?' mine':''):'chat-event');
   if(item.kind==='MESSAGE')node.append(el('strong','chat-sender',item.mine?'Du':item.sender));
   node.append(el('p','',item.body),el('time','',meetingTime(item.created_at)));log.append(node);
  }
 }
 function renderMeta(){
  const key=JSON.stringify([data.status,data.meeting_at,data.meeting_place,data.meeting_notes,data.can_send,data.can_reopen]);if(key===metadata)return;metadata=key;
  summary.replaceChildren(el('h2','',data.animal_name),el('p','meeting-next',nextMeetingStep(data)));
  if(data.chat_opened){summary.append(el('strong','',meetingTime(data.meeting_at)),el('p','',data.meeting_place||'Treffpunkt noch offen'));if(data.meeting_notes)summary.append(el('p','meeting-notes',data.meeting_notes));}
  composer.hidden=!data.can_send;if(!data.can_send)editing=false;
  if(!data.can_send&&data.chat_opened)summary.append(el('p','small','Chat geschlossen. Es können keine neuen Nachrichten gesendet werden.'));
  if(editing)return;
  tools.replaceChildren();
  if(data.can_manage&&data.can_send){
   const details=el('details','meeting-edit'),heading=el('summary','','Termin & Treffpunkt bearbeiten'),form=el('form');
   const date=el('input'),place=el('input'),notes=el('textarea');date.type='datetime-local';date.value=localMeetingInput(data.meeting_at);place.value=data.meeting_place;place.maxLength=240;notes.value=data.meeting_notes;notes.maxLength=2000;notes.rows=3;
   for(const [name,field,text] of [['date',date,'Termin (deine lokale Zeit)'],['place',place,'Treffpunkt'],['notes',notes,'Hinweise zum Kennenlernen']]){field.id='meeting-'+name;const l=el('label','',text);l.htmlFor=field.id;form.append(l,field);field.oninput=()=>editing=true;}
   form.append(el('p','small','Leere Felder bleiben offen. Beide Seiten sehen die gespeicherten Angaben.'));
   const save=el('button','','Angaben speichern');save.type='submit';form.append(save);
   form.onsubmit=e=>{e.preventDefault();run(save,async()=>{await api('saveMeeting',{request_id:id,meeting_at:date.value?new Date(date.value).toISOString():null,place:place.value,notes:notes.value});editing=false;metadata='';onChange();await refreshData(true);});};
   details.append(heading,form);tools.append(details);
  }
  if(data.can_cancel){
   const details=el('details','meeting-cancel'),heading=el('summary','','Kennenlernen absagen'),body=el('div');
   body.append(el('p','small','Die andere Seite wird in der App informiert. Der Verlauf bleibt erhalten; der Chat wird geschlossen.'));
   let reopen=null;
   if(data.can_manage){reopen=el('input');reopen.type='checkbox';reopen.disabled=!data.can_reopen;const label=el('label','check');label.append(reopen,el('span','','Tier anschließend wieder verfügbar machen'));body.append(label);if(!data.can_reopen)body.append(el('p','small','Wiederfreigabe ist hier nicht möglich, z. B. wegen eines weiteren bestätigten Kennenlernens. Prüfe die Tierverwaltung.'));}
   else body.append(el('p','small','Die Verfügbarkeit des Tiers bleibt unverändert. Die Vermittlung entscheidet über eine erneute Freigabe.'));
   body.append(btn('Kennenlernen verbindlich absagen',async()=>{await api('cancelMeeting',{request_id:id,reopen:reopen?.checked===true});editing=false;metadata='';onChange();await refreshData(true);root.scrollTop=0;},'danger'));details.append(heading,body);tools.append(details);
  }
 }
 async function refreshData(force=false){
  if(disposed||busy||(!force&&document.hidden))return;busy=true;
  try{
   const result=await api('meeting',{request_id:id});if(disposed)return;
   const initial=!data,atBottom=nearBottom(),oldScroll=log.scrollTop,oldSize=events.size;data=result;merge(result.events);renderMeta();
   if(initial||events.size!==oldSize){draw();if(initial||atBottom)log.scrollTop=log.scrollHeight;else{log.scrollTop=oldScroll;jump.hidden=false;}}
   if(initial)older.hidden=!result.has_older;
   await markRead();
  }catch(e){if(!disposed){error.textContent=e.message;error.hidden=false;}}
  finally{busy=false;clearTimeout(timer);if(!disposed)timer=setTimeout(()=>refreshData(),5000);}
 }
 composer.onsubmit=e=>{e.preventDefault();const body=input.value.trim();if(!body)return;
  run(submit,async()=>{
   if(!retry||retry.body!==body)retry={body,client_id:crypto.randomUUID()};
   await api('sendMessage',{request_id:id,...retry});if(disposed)return;
   if(input.value.trim()===body)input.value='';retry=null;onChange();log.scrollTop=log.scrollHeight;await refreshData(true);
  });
 };
 const visibility=()=>{if(!document.hidden)refreshData(true);};document.addEventListener('visibilitychange',visibility);
 refreshData(true);
 return ()=>{disposed=true;clearTimeout(timer);events.clear();input.value='';retry=null;document.removeEventListener('visibilitychange',visibility);root.removeEventListener('scroll',markRead);};
}
