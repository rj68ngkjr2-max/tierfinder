// Only the public application shell is cached. Supabase requests and user data
// always use the network and never enter a service-worker cache.
const VERSION='tierfinder-shell-ea8f8d4c456f';
const ASSETS=['./','./index.html','./app.js?v=ea8f8d4c456f','./styles.css?v=ea8f8d4c456f','./manifest.webmanifest','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png'];
const STATIC=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tierfinder-shell-')&&k!==VERSION).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'&&url.pathname.startsWith(new URL(self.registration.scope).pathname)){
  event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(new URL('./index.html',self.registration.scope).href)));return;
 }
 if(!STATIC.has(url.href))return;
 event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(VERSION).then(c=>c.put(req,copy)));}return response;}).catch(()=>caches.match(req)));
});
