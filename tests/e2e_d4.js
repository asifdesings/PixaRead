const {launch,open,sleep,idb}=require('./e2e_lib.js');const fs=require('fs');const {execSync}=require('child_process');
const ui=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\s+/g,' ').trim():null;},sel);
const click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
(async()=>{
 try{execSync("pkill -f 'serve.js pwa 8089'");}catch(e){}
 await sleep(800);let dead='';try{execSync('curl -s -m 3 http://localhost:8089/index.html -o /dev/null');}catch(e){dead='refused';}
 console.log('K0 server stopped:',dead||'STILL UP');
 const b=await launch('/tmp/pxprof3');const {p,log}=await open(b);
 console.log('K1 cold start, no network:',await p.title(),'| controlled by service worker:',await p.evaluate(()=>!!navigator.serviceWorker.controller));
 // importing NEW books offline (the EPUB and PDF libraries ship with the app)
 for(const f of ['./pics.epub','./hier.pdf','sample.md']){const inp=await p.$('#file');await inp.uploadFile(f);for(let i=0;i<60;i++){await sleep(400);if(await p.evaluate(()=>!document.querySelector('#s-details').hidden))break;}
  const bk=(await idb(p,'books')).sort((a,b)=>b.added-a.added)[0];console.log('K2 imported offline:',f.split('/').pop().padEnd(11),'->',bk.format,'|',bk.title,'|',bk.chapterCount,'chapters');
  await click(p,'#s-details [data-act=back]');await sleep(400);}
 // audiobook for the story book
 await click(p,'[data-act=ab-lib]');await sleep(1800);
 console.log('K3 library card:',(await ui(p,'#s-audio .abrow')).slice(0,100));
 await click(p,'#s-audio [data-ab=gen]');await sleep(1800);
 await click(p,'[data-ab=none]');await sleep(200);await click(p,'[data-ab=toggle-ch][data-n="1"]');await sleep(200);
 const t0=Date.now();await click(p,'[data-ab=start]');
 for(let i=0;i<150;i++){await sleep(1000);const a=(await idb(p,'ab_books'))[0];if(a&&(a.chapters[1].status==='done'||a.status==='error'))break;}
 const a=(await idb(p,'ab_books'))[0];console.log('K4 chapter 2 generated offline:',a.chapters.map(c=>c.status).join(' | '),'| took',Math.round((Date.now()-t0)/1000),'s | error:',a.lastError||'none');
 await click(p,'#s-abgen [data-act=back]');await sleep(500);await p.evaluate(()=>PX.go('audio'));await sleep(1500);
 console.log('K5 library card now:',(await ui(p,'#s-audio .abrow')).slice(0,100));
 await click(p,'#s-audio [data-ab=listen]');await sleep(3500);console.log('K6 playing offline:',JSON.stringify(await p.evaluate(()=>{const a=PixaAudio._internals.Play.a;return {t:+a.currentTime.toFixed(1),paused:a.paused};})));
 const other=log.failed.filter(x=>!/fonts\.googleapis\.com/.test(x));
 console.log('K7 failed requests other than the optional Google Fonts links:',other.length?other.join(' | '):'none','| model-file requests:',log.requests.filter(r=>/\/ab\/model\//.test(r)).length);
 console.log('   errors:',log.errors.filter(e=>!/ERR_NAME|ERR_CONNECTION|ERR_INTERNET/.test(e)).join(' | ')||'none');
 await b.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message.slice(0,500));process.exit(1)});
