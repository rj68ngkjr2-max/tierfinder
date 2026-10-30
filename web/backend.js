import {createClient} from '@supabase/supabase-js';
import {config} from './config.js';
import {messages} from './messages.js';
import {createAuthStorage} from './auth-storage.js';

const storage=createAuthStorage();
export const db=createClient(config.url,config.publishableKey,{auth:{storage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'}});
const authErrors={invalid_credentials:'AUTH_FAILED',email_exists:'EMAIL_IN_USE',user_already_exists:'EMAIL_IN_USE',weak_password:'PASSWORD_POLICY',over_request_rate_limit:'RATE_LIMIT',over_email_send_rate_limit:'RATE_LIMIT',email_not_confirmed:'EMAIL_CONFIRMATION',otp_expired:'RESET_INVALID',validation_failed:'VALIDATION_ERROR',user_banned:'NOT_AUTHENTICATED',session_not_found:'NOT_AUTHENTICATED',refresh_token_not_found:'NOT_AUTHENTICATED'};
function failure(e){
 const code=messages[e?.message]?e.message:authErrors[e?.code]||(['23514','23502','22P02','23503'].includes(e?.code)?'VALIDATION_ERROR':'INTERNAL_ERROR');
 return {ok:false,error:{code,message:messages[code]||messages.INTERNAL_ERROR}};
}
async function query(action,payload={}){const {data,error}=await db.rpc('tier_rpc',{action,payload});if(error)throw error;return data;}
async function edge(action,payload={}){const {data,error}=await db.functions.invoke('tierfinder-api',{body:{action,payload}});if(error)throw new Error('SERVICE_UNAVAILABLE');if(!data?.ok)throw new Error(data?.error?.code||'INTERNAL_ERROR');return data.data;}
async function signImage(image){if(!image)return null;const {data,error}=await db.storage.from('animal-images').createSignedUrl(image.path,300);if(error)return null;return {...image,url:data.signedUrl};}
let recovery=false;
export const backend={
 get rememberLogin(){return storage.remembered;},
 async ready(){
  const params=new URLSearchParams(location.search),hash=params.get('token_hash');
  if(hash&&params.get('type')==='recovery'){
   const {error}=await db.auth.verifyOtp({token_hash:hash,type:'recovery'});
   history.replaceState(null,'',location.pathname);
   if(error)throw {message:'RESET_INVALID'};recovery=true;return {recovery:true};
  }
  if(params.has('code')){const {error}=await db.auth.exchangeCodeForSession(params.get('code'));history.replaceState(null,'',location.pathname);if(error)throw error;}
  const {data:{session}}=await db.auth.getSession();return {token:session?.user.id||''};
 },
 async rpc(action,payload={}){
  try{
   let result;
   if(action==='login'){
    storage.setRemember(payload.remember===true);
    const {data,error}=await db.auth.signInWithPassword({email:payload.email.trim().toLowerCase(),password:payload.password});if(error)throw error;
    try{result={token:data.user.id,account:await query('me')};}catch(e){await db.auth.signOut({scope:'local'});throw e;}
   }else if(action==='register'){
    const {data,error}=await db.auth.signUp({email:payload.email.trim().toLowerCase(),password:payload.password,options:{data:{alias:payload.alias,role:payload.role,organization_name:payload.organization_name||'',location:payload.location||'',consent:payload.consent},emailRedirectTo:new URL('./',document.baseURI).href}});
    if(error)throw error;
    if(data.user?.identities?.length===0)throw new Error('EMAIL_IN_USE');
    const confirmation=!data.session;await db.auth.signOut({scope:'local'});
    result={pending_approval:true,email:payload.email.trim().toLowerCase(),role:payload.role,confirmation};
   }else if(action==='logout'){
    const {error}=await db.auth.signOut({scope:'local'});if(error)throw error;result=true;
   }else if(action==='resetPassword'){
    if(!recovery)throw new Error('RESET_INVALID');
    const {data,error}=await db.auth.updateUser({password:payload.password});if(error)throw error;recovery=false;await db.auth.signOut({scope:'global'});result={email:data.user.email};
   }else if(['lookalike','adminCreateReset','aiStatus'].includes(action))result=await edge(action,payload);
   else if(action==='image')result=await signImage(await query(action,payload));
   else if(action==='images'){
    const rows=await query(action,payload),withImages=rows.filter(r=>r.image);
    if(withImages.length){const {data,error}=await db.storage.from('animal-images').createSignedUrls(withImages.map(r=>r.image.path),300);if(error)throw error;
     for(let i=0;i<withImages.length;i++)withImages[i].image=data[i]?.signedUrl?{...withImages[i].image,url:data[i].signedUrl}:null;}
    result=rows;
   }else if(action==='saveAnimal'&&payload.upload){
    const account=await query('me'),org=account.role==='ADMIN'?(payload.animal_id?(await query('shelterWorkspace')).animals.find(a=>a.animal_id===payload.animal_id)?.organization_id:payload.organization_id):account.organization?.organization_id;
    if(!org)throw new Error('ORGANIZATION_REQUIRED');
    const bytes=Uint8Array.from(atob(payload.upload.data),c=>c.charCodeAt(0));
    if(bytes.length>2097152||!['image/jpeg','image/png'].includes(payload.upload.mime_type))throw new Error('IMAGE_INVALID');
    const path=org+'/'+crypto.randomUUID()+(payload.upload.mime_type==='image/png'?'.png':'.jpg');
    const {error}=await db.storage.from('animal-images').upload(path,bytes,{contentType:payload.upload.mime_type,upsert:false,cacheControl:'300'});if(error)throw error;
    const {upload,...fields}=payload;result=await query('saveAnimal',{...fields,storage_path:path});
   }else if(['notifications','meeting','readMeeting','sendMessage','saveMeeting','cancelMeeting'].includes(action)){const {data,error}=await db.rpc('tier_meeting_rpc',{action,payload});if(error)throw error;result=data;}
   else result=await query(action,payload);
   return {ok:true,data:result};
  }catch(e){return failure(e);}
 }
};
