// iPhone Home Screen WebKit can give CSS viewport units and fixed elements
// a smaller area than innerHeight. Keep the shell and its navigation in one
// explicitly sized layout instead of anchoring the nav to that fixed viewport.
export function installStandaloneLayout(win=window,doc=document){
 const mode=win.matchMedia('(display-mode: standalone)');
 if(!/iPhone|iPod/.test(win.navigator.userAgent))return;
 const fullHeightByWidth=new Map();
 function update(){
  const active=mode.matches||win.navigator.standalone===true;
  doc.documentElement.classList.toggle('iphone-home',active);
  if(!active)return;
  if((win.visualViewport?.scale??1)!==1)return;
  const height=win.innerHeight,width=win.innerWidth;
  if(!Number.isFinite(height)||height<=0||!Number.isFinite(width)||width<=0)return;
  // A standalone iPhone cannot acquire a browser toolbar. Keep the largest
  // layout height seen at this width even after focusout, resume or rotation
  // back to a known orientation. Transient smaller measurements are not a
  // new full-screen size, regardless of whether an input is still focused.
  const key=Math.round(width);
  const fullHeight=Math.max(height,fullHeightByWidth.get(key)||0);
  fullHeightByWidth.set(key,fullHeight);
  doc.documentElement.style.setProperty('--home-height',fullHeight+'px');
 }
 update();
 for(const event of ['resize','orientationchange','pageshow'])win.addEventListener(event,update);
 mode.addEventListener('change',update);
 doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)update();});
 doc.addEventListener('focusout',()=>win.setTimeout(update,450));
}
