import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAppearance,readTheme,resolvedTheme,themeKey,applyTheme} from '../web/appearance.js';
import {tutorialSteps,createTutorialMemory} from '../web/tutorial.js';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
const events=()=>{const f=new Map();return{addEventListener:(k,v)=>f.set(k,v),removeEventListener:k=>f.delete(k),emit:(k,v)=>f.get(k)?.(v)};};
test('appearance follows system, persists overrides and ignores system changes in explicit mode',()=>{
 const local=storage(),media={...events(),matches:false},win=events(),applied=[];
 const a=createAppearance({storage:()=>local,media,events:win,apply:(m,d)=>applied.push(resolvedTheme(m,d))});
 assert.equal(a.mode,'system');assert.equal(applied.at(-1),'light');
 media.matches=true;media.emit('change');assert.equal(applied.at(-1),'dark');
 assert.equal(a.set('light'),true);assert.equal(local.getItem(themeKey),'light');
 media.emit('change');assert.equal(applied.at(-1),'light');
 assert.equal(readTheme(()=>local),'light');
 local.setItem(themeKey,'dark');win.emit('storage',{key:themeKey});assert.equal(a.mode,'dark');
 a.set('system');media.matches=false;media.emit('change');assert.equal(applied.at(-1),'light');a.dispose();
});
test('blocked storage still permits theme changes; invalid saved modes fall back to system',()=>{
 const blocked=()=>{throw Error('blocked');};assert.equal(readTheme(blocked),'system');
 const a=createAppearance({storage:blocked,media:{...events(),matches:false},events:events(),apply:()=>{}});
 assert.equal(a.set('dark'),false);assert.equal(a.mode,'dark');a.dispose();
 assert.equal(readTheme(()=>({getItem:()=>'<script>'})),'system');
});
test('theme updates browser chrome and color scheme with the page',()=>{
 const values={};const doc={documentElement:{dataset:{}},querySelector:s=>({setAttribute:(_,v)=>values[s]=v})};
 applyTheme('dark',false,doc);assert.equal(doc.documentElement.dataset.theme,'dark');assert.equal(values['meta[name="theme-color"]'],'#101b1b');assert.equal(values['meta[name="color-scheme"]'],'dark');
 applyTheme('light',true,doc);assert.equal(doc.documentElement.dataset.theme,'light');
});
test('tutorial content matches seeker, provider and administrator permissions',()=>{
 const ids=a=>tutorialSteps(a).map(s=>s.id);
 assert.deepEqual(ids({role:'INTERESTED',is_admin:false}),['welcome','discover','swipe','likes','requests','ai','settings']);
 assert.deepEqual(ids({role:'SHELTER',is_admin:false}),['welcome','shelter','handling','settings']);
 const master=ids({role:'ADMIN',is_admin:true});assert.ok(master.includes('shelter')&&master.includes('discover')&&master.includes('admin'));
 const delegated=ids({role:'INTERESTED',is_admin:true});assert.ok(delegated.includes('admin'));assert.ok(!delegated.includes('shelter'));
});
test('skipped/completed tutorial is remembered per account and role, with a storage fallback',()=>{
 const local=storage(),a={role:'INTERESTED',is_admin:false},m=createTutorialMemory(()=>local);
 assert.equal(m.seen('a',a),false);m.mark('a',a);assert.equal(createTutorialMemory(()=>local).seen('a',a),true);
 assert.equal(m.seen('b',a),false);assert.equal(m.seen('a',{role:'SHELTER',is_admin:false}),false);
 const fallback=createTutorialMemory(()=>{throw Error('blocked');});fallback.mark('a',a);assert.equal(fallback.seen('a',a),true);
});
