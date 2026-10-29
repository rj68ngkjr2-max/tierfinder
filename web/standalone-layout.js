// iPhone Home Screen WebKit can give CSS viewport units and fixed elements
// a smaller area than innerHeight. Keep the shell and its navigation in one
// explicitly sized layout instead of anchoring the nav to that fixed viewport.
export function installStandaloneLayout(win=window,doc=document){
 const mode=win.matchMedia('(display-mode: standalone)');
 if(!/iPhone|iPod/.test(win.navigator.userAgent))return;
 let fullHeight=0,lastWidth=0;
 function update(){
  const active=mode.matches||win.navigator.standalone===true;
  doc.documentElement.classList.toggle('iphone-home',active);
  if(!active)return;
  if((win.visualViewport?.scale??1)!==1)return;
  const height=win.innerHeight,width=win.innerWidth;
  if(!Number.isFinite(height)||height<=0)return;
  const editing=doc.activeElement?.matches('input,textarea,select,[contenteditable=true]');
  // A keyboard may resize the window. Do not retain that reduced height
  // after login; orientation changes still get their own full-size baseline.
  if(!fullHeight||width!==lastWidth||!editing||height>fullHeight)fullHeight=height;
  lastWidth=width;
  doc.documentElement.style.setProperty('--home-height',fullHeight+'px');
 }
 update();
 for(const event of ['resize','orientationchange','pageshow'])win.addEventListener(event,update);
 mode.addEventListener('change',update);
 doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)update();});
 doc.addEventListener('focusout',()=>win.setTimeout(update,450));
}
