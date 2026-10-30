const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function swipeDecision(dx,dy,width,velocity=0){
 if(Math.abs(dx)<Math.abs(dy)*1.25)return null;
 if(Math.abs(dx)<Math.min(110,width*.28)&&!(Math.abs(dx)>=48&&Math.abs(velocity)>.65))return null;
 return dx>0?'LIKE':'PASS';
}
export function tabAtPoint(tabs,x,y){return tabs.find(tab=>{const r=tab.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top-12&&y<=r.bottom+12;})||null;}
export function installCardSwipe(card,{onDecision,disabled=()=>false}){
 let gesture=null,suppressUntil=0;
 const reset=()=>{card.classList.remove('is-dragging','is-leaving');card.style.removeProperty('--drag-x');card.style.removeProperty('--drag-y');card.style.removeProperty('--drag-angle');card.style.removeProperty('--like-opacity');card.style.removeProperty('--pass-opacity');};
 const release=id=>{if(card.hasPointerCapture(id))card.releasePointerCapture(id);};
 card.addEventListener('dragstart',e=>e.preventDefault());
 card.addEventListener('click',e=>{if(e.detail!==0&&Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
 card.addEventListener('pointerdown',e=>{
  if(disabled()||e.isPrimary===false||e.button!==0||e.target.closest('button,a,input,select,textarea'))return;
  gesture={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,time:e.timeStamp,velocity:0,locked:false};
  // Touch implicitly captures the photo child. Own the pointer from the start
  // so transferring that capture later cannot cancel an in-progress swipe.
  card.setPointerCapture(e.pointerId);
 });
 card.addEventListener('pointermove',e=>{
  const g=gesture;if(!g||g.id!==e.pointerId)return;
  const dx=e.clientX-g.x,dy=e.clientY-g.y;
  if(!g.locked){
   if(Math.abs(dy)>=22&&Math.abs(dy)>Math.abs(dx)*1.35){gesture=null;release(e.pointerId);return;}
   if(Math.abs(dx)<12||Math.abs(dx)<Math.abs(dy)*1.15)return;
   g.locked=true;card.classList.add('is-dragging');
  }
  e.preventDefault();const dt=e.timeStamp-g.time;if(dt>0)g.velocity=(e.clientX-g.lastX)/dt;g.lastX=e.clientX;g.time=e.timeStamp;
  const strength=Math.min(1,Math.abs(dx)/(card.clientWidth*.28));
  card.style.setProperty('--drag-x',dx+'px');card.style.setProperty('--drag-y',dy*.18+'px');card.style.setProperty('--drag-angle',Math.max(-14,Math.min(14,dx/card.clientWidth*16))+'deg');
  card.style.setProperty('--like-opacity',dx>0?strength:0);card.style.setProperty('--pass-opacity',dx<0?strength:0);
 },{passive:false});
 card.addEventListener('pointerup',e=>{
  const g=gesture;if(!g||g.id!==e.pointerId)return;gesture=null;release(e.pointerId);
  if(!g.locked)return;e.preventDefault();suppressUntil=Date.now()+500;
  const velocity=e.timeStamp-g.time<100?g.velocity:0;
  const decision=swipeDecision(e.clientX-g.x,e.clientY-g.y,card.clientWidth,velocity);
  card.classList.remove('is-dragging');if(decision&&!disabled())onDecision(decision);else reset();
 });
 const cancel=e=>{if(gesture?.id!==e.pointerId)return;gesture=null;release(e.pointerId);reset();};
 card.addEventListener('pointercancel',cancel);
 // A descendant losing its implicit touch capture bubbles here too. Only
 // losing our own capture means that this card gesture was interrupted.
 card.addEventListener('lostpointercapture',e=>{if(e.target===card)cancel(e);});
 return {reset,async exit(decision){
  card.classList.remove('is-dragging');card.classList.add('is-leaving');
  card.style.setProperty(decision==='LIKE'?'--like-opacity':'--pass-opacity',1);
  if(reducedMotion())return;
  const direction=decision==='LIKE'?1:-1;
  const animation=card.animate([{transform:getComputedStyle(card).transform,opacity:1},{transform:`translate3d(${direction*(window.innerWidth+card.clientWidth)}px,30px,0) rotate(${direction*22}deg)`,opacity:0}],{duration:280,easing:'cubic-bezier(.3,.05,.7,.7)',fill:'forwards'});
  // Keep it out of the way while saving, but make failures reversible.
  card.exitAnimation=animation;try{await animation.finished;}catch{}
 },restore(){card.exitAnimation?.cancel();reset();}};
}
export function installTabScrub(nav,onSelect){
 const controller=new AbortController(),options={signal:controller.signal};let gesture=null;
 const clear=()=>{gesture=null;nav.classList.remove('is-scrubbing');nav.querySelectorAll('.scrub-target').forEach(b=>b.classList.remove('scrub-target'));};
 const highlight=target=>{nav.querySelectorAll('.scrub-target').forEach(b=>b.classList.remove('scrub-target'));if(!target)return;target.classList.add('scrub-target');const r=target.getBoundingClientRect(),n=nav.getBoundingClientRect();nav.style.setProperty('--scrub-x',r.left-n.left+'px');nav.style.setProperty('--scrub-width',r.width+'px');};
 nav.addEventListener('click',e=>{if(e.detail!==0&&Date.now()<Number(nav.dataset.suppressClickUntil||0)){e.preventDefault();e.stopImmediatePropagation();}}, {...options,capture:true});
 nav.addEventListener('pointerdown',e=>{const target=e.target.closest('button[data-route]');if(!target||e.button!==0||e.isPrimary===false)return;gesture={id:e.pointerId,x:e.clientX,y:e.clientY,dragged:false};nav.setPointerCapture(e.pointerId);highlight(target);},options);
 nav.addEventListener('pointermove',e=>{const g=gesture;if(!g||g.id!==e.pointerId)return;if(!g.dragged&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<8)return;g.dragged=true;e.preventDefault();nav.classList.add('is-scrubbing');highlight(tabAtPoint([...nav.querySelectorAll('button[data-route]')],e.clientX,e.clientY));},{...options,passive:false});
 nav.addEventListener('pointerup',e=>{const g=gesture;if(!g||g.id!==e.pointerId)return;const target=tabAtPoint([...nav.querySelectorAll('button[data-route]')],e.clientX,e.clientY);clear();if(nav.hasPointerCapture(e.pointerId))nav.releasePointerCapture(e.pointerId);e.preventDefault();nav.dataset.suppressClickUntil=String(Date.now()+500);if(target)onSelect(target.dataset.route);},options);
 const cancel=e=>{if(gesture?.id!==e.pointerId)return;nav.dataset.suppressClickUntil=String(Date.now()+500);clear();if(nav.hasPointerCapture(e.pointerId))nav.releasePointerCapture(e.pointerId);};
 nav.addEventListener('pointercancel',cancel,options);nav.addEventListener('lostpointercapture',e=>{if(e.target===nav)cancel(e);},options);
 return ()=>{if(gesture&&nav.hasPointerCapture(gesture.id))nav.releasePointerCapture(gesture.id);clear();controller.abort();};
}
