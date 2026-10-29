import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuthStorage} from '../web/auth-storage.js';

const key='sb-test-auth-token';
function store(){const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
function setup(){const local=store(),session=store();return {local,session,auth:createAuthStorage({local:()=>local,session:()=>session})};}

test('default session survives reload but not a new browser session',()=>{
 const {local,session,auth}=setup();auth.setItem(key,'session');
 assert.equal(createAuthStorage({local:()=>local,session:()=>session}).getItem(key),'session');
 assert.equal(createAuthStorage({local:()=>local,session:()=>store()}).getItem(key),null);
 assert.equal(local.getItem(key),null);
});
test('remembered session and refreshed token survive reopening',()=>{
 const {local,auth}=setup();auth.setRemember(true);auth.setItem(key,'initial-token');
 const reopened=createAuthStorage({local:()=>local,session:()=>store()});
 assert.equal(reopened.remembered,true);assert.equal(reopened.getItem(key),'initial-token');
 reopened.setItem(key,'refreshed-token');
 assert.equal(createAuthStorage({local:()=>local,session:()=>store()}).getItem(key),'refreshed-token');
});
test('turning remember off removes the persistent token',()=>{
 const {local,session,auth}=setup();auth.setRemember(true);auth.setItem(key,'token');auth.setRemember(false);
 assert.equal(local.getItem(key),null);assert.equal(session.getItem(key),'token');
 assert.equal(createAuthStorage({local:()=>local,session:()=>store()}).getItem(key),null);
});
test('signout removes session from both stores and memory',()=>{
 const {local,session,auth}=setup();auth.setRemember(true);auth.setItem(key,'token');session.setItem(key,'older-token');
 auth.removeItem(key);
 assert.equal(auth.getItem(key),null);assert.equal(local.getItem(key),null);assert.equal(session.getItem(key),null);
 assert.equal(createAuthStorage({local:()=>local,session:()=>store()}).getItem(key),null);
});
test('existing tab session can be moved into remembered storage',()=>{
 const {local,session,auth}=setup();session.setItem(key,'existing-session');
 assert.equal(auth.getItem(key),'existing-session');auth.setRemember(true);
 assert.equal(session.getItem(key),null);assert.equal(local.getItem(key),'existing-session');
});
test('blocked browser storage falls back to memory and signout still clears it',()=>{
 const blocked=()=>{throw Error('Storage unavailable');};
 const auth=createAuthStorage({local:blocked,session:blocked});
 auth.setRemember(true);auth.setItem(key,'token');assert.equal(auth.getItem(key),'token');
 auth.removeItem(key);assert.equal(auth.getItem(key),null);
});
