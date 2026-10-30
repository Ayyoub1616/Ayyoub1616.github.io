/* REWIND! 2-player edition: offline static assets only, never voice recordings. */
const CACHE='rewind-voice-minigames-v9';
const FILES=['./','./index.html','./privacidad.html','./styles.css','./app.js','./i18n.js','./games.js','./manifest.webmanifest','./assets/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('rewind-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);
 if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 e.respondWith(fetch(e.request).then(res=>{
   if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}
   return res;
 }).catch(()=>caches.match(e.request)));
});