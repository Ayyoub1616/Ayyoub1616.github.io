/* REWIND! minimal audio app: offline shell, network-first updates. */
const CACHE='rewind-simple-v3';
const ASSETS=['./','./index.html','./privacidad.html','./styles.css','./app.js','./manifest.webmanifest','./assets/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE && k.startsWith('rewind-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  e.respondWith(fetch(e.request).then(response=>{
    if(response.ok) {
      const copy=response.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
    }
    return response;
  }).catch(()=>caches.match(e.request)));
});