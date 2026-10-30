export const themeKey='tierfinder.appearance';
export const validTheme=value=>['light','dark','system'].includes(value)?value:'system';
export function readTheme(storage=()=>localStorage){try{return validTheme(storage().getItem(themeKey));}catch{return 'system';}}
export const resolvedTheme=(mode,systemDark)=>mode==='dark'||(validTheme(mode)==='system'&&systemDark)?'dark':'light';
export function applyTheme(mode,systemDark,doc=document){
 const theme=resolvedTheme(mode,systemDark);doc.documentElement.dataset.theme=theme;
 doc.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#101b1b':'#f2f7f5');
 doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content',theme);return theme;
}
export function createAppearance({storage=()=>localStorage,media=matchMedia('(prefers-color-scheme: dark)'),apply=applyTheme,events=window}={}){
 let mode=readTheme(storage);const listeners=new Set();
 const update=()=>{apply(mode,media.matches);listeners.forEach(fn=>fn(mode));};
 const sync=e=>{if(e.key===themeKey||e.key===null){mode=readTheme(storage);update();}};
 media.addEventListener('change',update);events.addEventListener('storage',sync);update();
 return {get mode(){return mode;},set(value){mode=validTheme(value);let saved=true;try{storage().setItem(themeKey,mode);}catch{saved=false;}update();return saved;},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},dispose(){media.removeEventListener('change',update);events.removeEventListener('storage',sync);listeners.clear();}};
}
