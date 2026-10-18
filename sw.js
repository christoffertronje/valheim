/* Valheim Companion: offline-ready shell, online-first documents. */
const CACHE='valheim-companion-v6';
const ROOT=new URL('./',self.location.href);
const SHELL=['./','./index.html','./food/','./food/index.html','./creatures/','./creatures/index.html','./crafting/','./crafting/index.html','./assets/favicon-64.png','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./data/equipment-upgrades.json','./manifest.webmanifest'].map(p=>new URL(p,ROOT).href);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('valheim-companion-')&&key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()]))});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
if(req.mode==='navigate'){event.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{})}return res}).catch(async()=>await caches.match(req)||await caches.match(new URL('./index.html',ROOT).href)));return;}
event.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{})}return res}).catch(()=>caches.match(req)));});
