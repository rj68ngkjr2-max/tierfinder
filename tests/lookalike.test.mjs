import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareLookalike,chooseCandidates,parseMatch,imageBytes,geminiRequest,IMAGE_BUDGET} from '../supabase/functions/tierfinder-api/lookalike.js';
const jpeg=new Uint8Array([255,216,255,0,0]);
const reference={data:Buffer.from(jpeg).toString('base64'),mime_type:'image/jpeg',generated_demo_image:true,include_seen:true};
const animal=(i,species='DOG')=>({animal_id:'a'+i,species,status:'AVAILABLE',has_image:true,image_version:'v1'});
const answer=(id='a0',status='MATCH')=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({status,animal_id:id})}]}}]});
function setup(pool=[animal(0)],overrides={}){
 const calls={reserves:0,requests:[],batches:[],candidateReads:0};
 const dependencies={key:'test-key',model:'gemini-test',freeTier:'true',
 candidates:async(seen,reserve)=>{assert.equal(seen,true);calls.candidateReads++;if(reserve)calls.reserves++;return pool;},
 images:async ids=>{calls.batches.push(ids);return ids.map(id=>({animal_id:id,image:{path:id,mime_type:'image/jpeg'}}));},
 download:async()=>new Blob([jpeg]),
 fetcher:async(url,options)=>{calls.requests.push(JSON.parse(options.body));return Response.json(answer());},...overrides};
 return {calls,dependencies};
}
test('candidate cap balances species and rejects unavailable or imageless entries',()=>{
 const pool=[...Array.from({length:40},(_,i)=>animal(i)),animal('bird','BIRD'),{...animal('draft'),status:'DRAFT'},{...animal('none'),has_image:false}];
 const selected=chooseCandidates(pool);assert.equal(selected.length,32);assert.equal(selected[1].species,'BIRD');assert.equal(selected.some(a=>['adraft','anone'].includes(a.animal_id)),false);
});
test('Gemini request contains real image bytes and constrains IDs',()=>{
 const request=geminiRequest(reference,[{...reference,animal_id:'known'}]);
 assert.equal(request.contents[0].parts.filter(p=>p.inlineData).length,2);
 assert.deepEqual(request.generationConfig.responseSchema.properties.animal_id.enum,['NONE','known']);
});
test('full comparison batches 25 images, reserves once and checks availability again',async()=>{
 const {calls,dependencies}=setup(Array.from({length:25},(_,i)=>animal(i)));
 const result=await compareLookalike(reference,dependencies);
 assert.equal(result.animal.animal_id,'a0');assert.equal(result.candidate_count,25);assert.equal(calls.reserves,1);assert.equal(calls.candidateReads,3);
 assert.deepEqual(calls.batches.map(b=>b.length),[12,12,1]);assert.equal(calls.requests.length,1);
});
test('invalid reference or consent never calls database or Gemini',async()=>{
 const {calls,dependencies}=setup();
 await assert.rejects(()=>compareLookalike({...reference,generated_demo_image:false},dependencies),/CONSENT_REQUIRED/);
 await assert.rejects(()=>compareLookalike({...reference,data:'not base64'},dependencies),/IMAGE_INVALID/);
 await assert.rejects(()=>compareLookalike({...reference,include_seen:'true'},dependencies),/VALIDATION_ERROR/);
 assert.equal(calls.candidateReads,0);assert.equal(calls.requests.length,0);
 assert.throws(()=>imageBytes('','image/jpeg'),/IMAGE_INVALID/);
});
test('no candidate or inaccessible photos do not consume a model call',async()=>{
 let fixture=setup([]);await assert.rejects(()=>compareLookalike(reference,fixture.dependencies),/NO_CANDIDATES/);assert.equal(fixture.calls.reserves,0);
 fixture=setup([animal(0)],{download:async()=>{throw Error('offline');}});await assert.rejects(()=>compareLookalike(reference,fixture.dependencies),/AI_IMAGES_UNAVAILABLE/);assert.equal(fixture.calls.requests.length,0);assert.equal(fixture.calls.reserves,0);
});
test('total image payload respects byte budget',async()=>{
 const bytes=new Uint8Array(2*1024*1024);bytes.set(jpeg);
 const {calls,dependencies}=setup(Array.from({length:7},(_,i)=>animal(i)),{download:async()=>new Blob([bytes])});
 const result=await compareLookalike(reference,dependencies);assert.equal(result.candidate_count,IMAGE_BUDGET/bytes.length);assert.equal(calls.requests.length,1);
});
test('made-up IDs, malformed JSON, blocked and truncated outputs are rejected',()=>{
 assert.throws(()=>parseMatch(answer('foreign'),['a0']),/AI_INVALID/);
 assert.throws(()=>parseMatch({candidates:[]},['a0']),/AI_INVALID/);
 assert.throws(()=>parseMatch({promptFeedback:{blockReason:'SAFETY'}},['a0']),/AI_IMAGE_UNSUITABLE/);
 assert.throws(()=>parseMatch({candidates:[{...answer().candidates[0],finishReason:'MAX_TOKENS'}]},['a0']),/AI_INVALID/);
 assert.deepEqual(parseMatch(answer('','NO_MATCH'),['a0']),{status:'NO_MATCH',animal_id:''});
 assert.deepEqual(parseMatch(answer('NONE','NO_MATCH'),['a0']),{status:'NO_MATCH',animal_id:''});
});
test('changed image or availability after comparison never produces stale result',async()=>{
 let reads=0;const fixture=setup([animal(0)],{candidates:async()=>++reads===3?[{...animal(0),image_version:'v2'}]:[animal(0)]});
 await assert.rejects(()=>compareLookalike(reference,fixture.dependencies),/NOT_AVAILABLE/);
});
test('approval revocation before send prevents image transmission',async()=>{
 let reads=0;const fixture=setup([animal(0)],{candidates:async()=>{if(++reads===2)throw Error('APPROVAL_PENDING');return [animal(0)];}});
 await assert.rejects(()=>compareLookalike(reference,fixture.dependencies),/APPROVAL_PENDING/);assert.equal(fixture.calls.requests.length,0);
});
test('provider errors map to useful messages without exposing responses or credentials',async()=>{
 for(const [status,code] of [[429,'AI_QUOTA'],[403,'AI_CONFIGURATION'],[404,'AI_CONFIGURATION'],[503,'AI_UNAVAILABLE']]){
  const fixture=setup([animal(0)],{fetcher:async()=>new Response('secret detail',{status})});
  await assert.rejects(()=>compareLookalike(reference,fixture.dependencies),new RegExp('^Error: '+code+'$'));
 }
 const fixture=setup([animal(0)],{fetcher:async()=>{throw new DOMException('timeout','TimeoutError');}});
 await assert.rejects(()=>compareLookalike(reference,fixture.dependencies),/AI_TIMEOUT/);
});
