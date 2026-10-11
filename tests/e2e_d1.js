const {launch,open,sleep,idb}=require('./e2e_lib.js');const fs=require('fs');
const ui=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\s+/g,' ').trim():null;},sel);
const click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
(async()=>{
 fs.rmSync('/tmp/pxprof3',{recursive:true,force:true});
 const b=await launch('/tmp/pxprof3');let {p,log}=await open(b);
 await p.evaluate(async()=>{await navigator.serviceWorker.ready;});
 // wait until the worker has cached the whole shell
 const cached=await p.evaluate(async()=>{for(let i=0;i<30;i++){const ks=await caches.keys();if(ks.length){const c=await caches.open(ks[0]);const n=(await c.keys()).length;if(n>=17)return {cache:ks[0],files:n};}await new Promise(r=>setTimeout(r,500));}return null;});
 console.log('F1 app shell cached by the service worker:',JSON.stringify(cached));
 const inp=await p.$('#file');await inp.uploadFile('story.txt');await sleep(2500);
 await click(p,'[data-act=back]');await sleep(400);await click(p,'[data-act=ab-lib]');await sleep(1200);
 await click(p,'[data-ab=model-get]');
 for(let i=0;i<120;i++){await sleep(1000);if(/Ready for offline use/.test(await ui(p,'#ab-model')))break;}
 console.log('F2 model:',(await ui(p,'#ab-model')).slice(0,60));
 await p.evaluate(()=>PX.getBooks()[0]&&PixaAudio.openGenerator(PX.getBooks()[0].id));await sleep(2000);
 await click(p,'[data-ab=none]');await sleep(200);await click(p,'[data-ab=toggle-ch][data-n="0"]');await sleep(200);
 await click(p,'[data-ab=start]');
 for(let i=0;i<120;i++){await sleep(1000);const a=(await idb(p,'ab_books'))[0];if(a&&a.status==='done')break;}
 const a=(await idb(p,'ab_books'))[0];console.log('F3 chapter 1 made while online ->',a.chapters.map(c=>c.selected===false?'(not selected)':c.status).join(' | '));
 await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,500));process.exit(1)});
