import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installStandaloneLayout} from '../web/standalone-layout.js';
function fixture({iphone=true,standalone=true,height=874,width=402,screen}={}){
 const events={},properties=new Map(),classes=new Set();
 const doc={hidden:false,activeElement:{matches:()=>false},documentElement:{classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k)},style:{setProperty:(k,v)=>properties.set(k,v)}},addEventListener:(k,v)=>events[k]=v};
 const mode={matches:standalone,addEventListener:(k,v)=>events['mode:'+k]=v};
 const win={navigator:{userAgent:iphone?'iPhone':'Macintosh',standalone},innerWidth:width,innerHeight:height,screen,visualViewport:{height:772,scale:1},matchMedia:()=>mode,addEventListener:(k,v)=>events[k]=v,setTimeout:fn=>fn()};
 installStandaloneLayout(win,doc);
 return {win,doc,events,properties,classes,mode,height:()=>properties.get('--home-height')};
}
test('installed iPhone uses the full layout window despite a toolbar-sized visual viewport gap',()=>{
 const f=fixture();assert.equal(f.height(),'874px');assert.ok(f.classes.has('iphone-home'));
});
test('keyboard shrink cannot become the remembered full height',()=>{
 const f=fixture();f.doc.activeElement.matches=()=>true;f.win.innerHeight=500;f.events.resize();assert.equal(f.height(),'874px');
 f.doc.activeElement.matches=()=>false;f.win.innerHeight=874;f.events.focusout();assert.equal(f.height(),'874px');
});
test('rotation updates the frame to the new full height',()=>{
 const f=fixture();f.win.innerWidth=874;f.win.innerHeight=402;f.events.orientationchange();assert.equal(f.height(),'402px');
});
test('pinch zoom does not resize the app shell',()=>{
 const f=fixture();f.win.visualViewport.scale=2;f.win.innerHeight=437;f.events.resize();assert.equal(f.height(),'874px');
});
test('normal Safari and desktop layouts are untouched',()=>{
 for(const options of [{standalone:false},{iphone:false}]){
  const f=fixture(options);assert.equal(f.height(),undefined);assert.ok(!f.classes.has('iphone-home'));
 }
});
test('resume and visibility events cannot replace full height with a phantom toolbar height',()=>{
 const f=fixture();f.win.innerHeight=772;
 for(const event of ['pageshow','visibilitychange','resize','focusout']){f.events[event]();assert.equal(f.height(),'874px',event);}
});
test('keyboard dismissal cannot shrink the frame before the viewport recovers',()=>{
 const f=fixture();f.doc.activeElement.matches=()=>true;f.win.innerHeight=500;f.events.resize();
 f.doc.activeElement.matches=()=>false;f.events.focusout();assert.equal(f.height(),'874px');
 f.win.innerHeight=772;f.events.resize();assert.equal(f.height(),'874px');
});
test('rotating back restores the known portrait height even if Safari reports a short window',()=>{
 const f=fixture();f.win.innerWidth=874;f.win.innerHeight=402;f.events.orientationchange();assert.equal(f.height(),'402px');
 f.win.innerWidth=402;f.win.innerHeight=772;f.events.orientationchange();assert.equal(f.height(),'874px');
});
test('a later full measurement replaces an initially short height',()=>{
 const f=fixture();f.win.innerWidth=400;f.win.innerHeight=750;f.events.resize();assert.equal(f.height(),'750px');
 f.win.innerHeight=860;f.events.resize();assert.equal(f.height(),'860px');
 f.win.innerHeight=750;f.events.pageshow();assert.equal(f.height(),'860px');
});
test('leaving standalone restores the ordinary CSS layout',()=>{
 const f=fixture();f.mode.matches=false;f.win.navigator.standalone=false;f.events['mode:change']();assert.ok(!f.classes.has('iphone-home'));
});

test('a fresh second launch recovers full height without any previous in-memory measurement',()=>{
 const first=fixture({screen:{width:402,height:874}});assert.equal(first.height(),'874px');
 for(let restart=0;restart<3;restart++){
  const fresh=fixture({height:772,screen:{width:402,height:874}});
  assert.equal(fresh.height(),'874px');
 }
});
test('cold launch in landscape uses the matching screen axis',()=>{
 for(const screen of [{width:402,height:874},{width:874,height:402}]){
  const f=fixture({width:874,height:350,screen});assert.equal(f.height(),'402px');
 }
});
test('over-reported layout height cannot push navigation beyond the physical display',()=>{
 const f=fixture({height:950,screen:{width:402,height:874}});assert.equal(f.height(),'874px');
});
test('a nonmatching screen size falls back to layout measurements',()=>{
 const f=fixture({screen:{width:1920,height:1080}});assert.equal(f.height(),'874px');
});
test('screen dimensions never change ordinary Safari or desktop layout',()=>{
 for(const options of [{standalone:false},{iphone:false}]){
  const f=fixture({...options,height:772,screen:{width:402,height:874}});assert.equal(f.height(),undefined);
 }
});
