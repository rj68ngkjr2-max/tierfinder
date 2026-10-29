import {compareLookalike} from './lookalike.js';
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const fail=(code:string)=>{throw new Error(code);};
async function body(req:Request){
 const reader=req.body?.getReader();if(!reader)fail('VALIDATION_ERROR');let size=0,parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader!.read();if(done)break;size+=value.length;if(size>2900000){await reader!.cancel();fail('IMAGE_INVALID');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('VALIDATION_ERROR');}
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:cors});
 if(req.method!=='POST')return reply({ok:false,error:{code:'VALIDATION_ERROR'}},405);
 try{
  const auth=req.headers.get('Authorization')||'';if(!auth.startsWith('Bearer '))fail('NOT_AUTHENTICATED');
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)fail('NOT_AUTHENTICATED');
  const input=await body(req),action=input?.action,p=input?.payload||{};
  const rpc=async(action:string,payload:Record<string,unknown>={})=>{const {data,error}=await client.rpc('tier_rpc',{action,payload});if(error)fail(error.message);return data;};
  let result;
  if(action==='adminCreateReset'){
   const target=await rpc('adminResetTarget',{user_id:p.user_id});
   const origin=Deno.env.get('APP_URL');if(!origin||!/^https:\/\/[^?#]+\/$/.test(origin))fail('CONFIGURATION');
   const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
   const {data,error}=await admin.auth.admin.generateLink({type:'recovery',email:target.email,options:{redirectTo:origin}});
   if(error||!data?.properties?.hashed_token)fail('AUTH_UNAVAILABLE');
   result={email:target.email,url:origin+'?type=recovery&token_hash='+encodeURIComponent(data.properties.hashed_token)};
  }else if(action==='aiStatus'){
   await rpc('aiStatus');const configured=!!Deno.env.get('GEMINI_API_KEY')&&!!Deno.env.get('GEMINI_MODEL')&&Deno.env.get('GEMINI_FREE_TIER_CONFIRMED')==='true';
   result={configured,message:configured?'KI eingerichtet. Maximal 20 Vergleiche pro Tag für die gesamte App; zusätzlich gelten Anbieterlimits.':'Der KI-Zugang ist noch nicht eingerichtet. Entdecken, Likes und Anfragen sind verfügbar.'};
  }else if(action==='lookalike'){
   result=await compareLookalike(p,{
    key:Deno.env.get('GEMINI_API_KEY'),model:Deno.env.get('GEMINI_MODEL'),freeTier:Deno.env.get('GEMINI_FREE_TIER_CONFIRMED'),
    candidates:async(includeSeen:boolean,reserve:boolean)=>{const {data,error}=await client.rpc('tier_ai_candidates',{include_seen:includeSeen,reserve});if(error)fail(error.message);return data;},
    images:async(ids:string[])=>await rpc('images',{animal_ids:ids}),
    download:async(path:string)=>{
     // Storage uses the caller's JWT; no service-role bypass for private animal photos.
     const response=await fetch(url+'/storage/v1/object/authenticated/animal-images/'+path.split('/').map(encodeURIComponent).join('/'),{headers:{Authorization:auth,apikey:anon},signal:AbortSignal.timeout(10000)});
     if(!response.ok||Number(response.headers.get('content-length')||0)>2097152)return null;
     const reader=response.body?.getReader();if(!reader)return null;let size=0;const chunks:Uint8Array[]=[];
     while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2097152){await reader.cancel();return null;}chunks.push(value);}
     return new Blob(chunks);
    }
   });
  }else fail('VALIDATION_ERROR');
  return reply({ok:true,data:result});
 }catch(e){const allowed=['VALIDATION_ERROR','NOT_AUTHENTICATED','FORBIDDEN','NOT_FOUND','APPROVAL_PENDING','ORGANIZATION_PENDING','RATE_LIMIT','CONFIGURATION','AUTH_UNAVAILABLE','IMAGE_INVALID','CONSENT_REQUIRED','AI_IMAGES_UNAVAILABLE','AI_IMAGE_UNSUITABLE','AI_DAILY_LIMIT','AI_TIMEOUT','AI_CONFIGURATION','AI_SETUP_REQUIRED','AI_UNAVAILABLE','AI_QUOTA','NO_CANDIDATES','AI_INVALID','NOT_AVAILABLE'];
  const code=allowed.includes(e.message)?e.message:'INTERNAL_ERROR';return reply({ok:false,error:{code}});
 }
});
