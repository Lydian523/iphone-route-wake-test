const CACHE_NAME='route-wake-test-v11';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./service-worker.js','./icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil((async()=>{await self.clients.claim();const ks=await caches.keys();await Promise.all(ks.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))})()));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request))));
