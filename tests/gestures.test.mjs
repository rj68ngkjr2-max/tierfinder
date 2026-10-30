import {test} from 'node:test';
import assert from 'node:assert/strict';
import {swipeDecision,tabAtPoint,installCardSwipe,installTabScrub} from '../web/gestures.js';
class Element extends EventTarget{
 constructor(rect={left:0,right:360,top:0,bottom:500}){super();this.rect=rect;this.clientWidth=rect.right-rect.left;this.dataset={};this.children=[];this.capture=null;this.values=new Map();this.classes=new Set();this.style={setProperty:(k,v)=>this.values.set(k,v),removeProperty:k=>this.values.delete(k)};this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x))};}
 closest(){return this.routeButton||null;}
 getBoundingClientRect(){return {...this.rect,width:this.clientWidth};}
 setPointerCapture(id){this.capture=id;} hasPointerCapture(id){return this.capture===id;} releasePointerCapture(){this.capture=null;}
 querySelectorAll(selector){return selector==='.scrub-target'?this.children.filter(b=>b.classes.has('scrub-target')):this.children;}
}
function pointer(el,type,x,y,extra={}){const e=new Event(type,{cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:1,isPrimary:true,button:0,...extra});el.dispatchEvent(e);return e;}
test('card decisions require deliberate horizontal distance or a meaningful flick',()=>{
 assert.equal(swipeDecision(115,5,360),'LIKE');assert.equal(swipeDecision(-115,5,360),'PASS');
 assert.equal(swipeDecision(35,0,360,2),null);assert.equal(swipeDecision(65,5,360,.8),'LIKE');
 assert.equal(swipeDecision(120,180,360,2),null);assert.equal(swipeDecision(60,0,360,.2),null);
});
test('card follows the gesture, submits once, and cancellation or vertical scrolling never submits',()=>{
 const card=new Element(),decisions=[];const swipe=installCardSwipe(card,{onDecision:d=>decisions.push(d)});
 pointer(card,'pointerdown',140,150);pointer(card,'pointermove',270,160);assert.equal(card.values.get('--drag-x'),'130px');
 pointer(card,'pointerup',270,160);pointer(card,'pointerup',270,160);assert.deepEqual(decisions,['LIKE']);
 swipe.reset();pointer(card,'pointerdown',140,150);pointer(card,'pointermove',20,150);pointer(card,'pointercancel',20,150);
 assert.equal(card.values.has('--drag-x'),false);assert.equal(decisions.length,1);
 pointer(card,'pointerdown',140,150);pointer(card,'pointermove',150,230);pointer(card,'pointerup',290,230);assert.equal(decisions.length,1);
});
test('disabled cards and presses on controls never start a swipe',()=>{
 const card=new Element();let count=0;installCardSwipe(card,{onDecision:()=>count++,disabled:()=>true});
 pointer(card,'pointerdown',10,10);pointer(card,'pointermove',200,10);pointer(card,'pointerup',200,10);assert.equal(count,0);
});
test('tab scrubbing supports a tap, selects only on release, and cancels outside the bar',()=>{
 const nav=new Element({left:0,right:300,top:600,bottom:670}),tabs=['discover','likes','profile'].map((route,i)=>{const b=new Element({left:i*100,right:i*100+100,top:600,bottom:670});b.dataset.route=route;return b;});nav.children=tabs;nav.routeButton=tabs[0];const selected=[];const cleanup=installTabScrub(nav,key=>selected.push(key));
 pointer(nav,'pointerdown',50,635);pointer(nav,'pointerup',50,635);assert.deepEqual(selected,['discover']);
 pointer(nav,'pointerdown',50,635);pointer(nav,'pointermove',150,635);assert.equal(selected.length,1);assert.ok(tabs[1].classes.has('scrub-target'));pointer(nav,'pointerup',150,635);assert.deepEqual(selected,['discover','likes']);
 pointer(nav,'pointerdown',50,635);pointer(nav,'pointermove',150,520);pointer(nav,'pointerup',150,520);assert.equal(selected.length,2);
 pointer(nav,'pointerdown',50,635);pointer(nav,'pointermove',250,635);pointer(nav,'pointercancel',250,635);assert.equal(selected.length,2);assert.equal(nav.classes.has('is-scrubbing'),false);
 assert.equal(tabAtPoint(tabs,500,635),null);cleanup();pointer(nav,'pointerdown',50,635);pointer(nav,'pointerup',50,635);assert.equal(selected.length,2);
});

test('touch capture transfer from the image does not cancel the card swipe',()=>{
 const card=new Element(),image=new Element(),decisions=[];installCardSwipe(card,{onDecision:d=>decisions.push(d)});
 pointer(card,'pointerdown',140,150,{pointerType:'touch'});
 pointer(card,'pointermove',210,154,{pointerType:'touch'});
 const transfer=new Event('lostpointercapture');Object.defineProperties(transfer,{target:{value:image},pointerId:{value:1}});card.dispatchEvent(transfer);
 assert.equal(card.values.get('--drag-x'),'70px');assert.ok(card.classes.has('is-dragging'));
 pointer(card,'pointermove',280,158,{pointerType:'touch'});pointer(card,'pointerup',280,158,{pointerType:'touch'});
 assert.deepEqual(decisions,['LIKE']);assert.equal(card.capture,null);
});
test('a slightly diagonal touch start can become a deliberate horizontal swipe',()=>{
 const card=new Element(),decisions=[];installCardSwipe(card,{onDecision:d=>decisions.push(d)});
 pointer(card,'pointerdown',140,150,{pointerType:'touch'});pointer(card,'pointermove',150,162,{pointerType:'touch'});
 pointer(card,'pointermove',270,170,{pointerType:'touch'});pointer(card,'pointerup',270,170,{pointerType:'touch'});
 assert.deepEqual(decisions,['LIKE']);
});
test('touch capture lost on the card itself and touch cancellation restore without a decision',()=>{
 for(const event of ['lostpointercapture','pointercancel']){
  const card=new Element(),decisions=[];installCardSwipe(card,{onDecision:d=>decisions.push(d)});
  pointer(card,'pointerdown',140,150,{pointerType:'touch'});pointer(card,'pointermove',270,155,{pointerType:'touch'});pointer(card,event,270,155,{pointerType:'touch'});pointer(card,'pointerup',270,155,{pointerType:'touch'});
  assert.deepEqual(decisions,[]);assert.equal(card.values.has('--drag-x'),false);assert.equal(card.capture,null);
 }
});
test('touch presses on action buttons stay available to their ordinary click handler',()=>{
 const card=new Element();card.routeButton={};let count=0;installCardSwipe(card,{onDecision:()=>count++});
 pointer(card,'pointerdown',10,10,{pointerType:'touch'});pointer(card,'pointermove',200,10,{pointerType:'touch'});pointer(card,'pointerup',200,10,{pointerType:'touch'});assert.equal(count,0);assert.equal(card.capture,null);
});
