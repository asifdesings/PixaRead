const {launch,open,sleep,idb}=require('./e2e_lib.js');
const ui=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\s+/g,' ').trim():null;},sel);
const click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
(async()=>{
 const b=await launch('/tmp/pxprof3');let {p,log}=await open(b);
 await click(p,'[data-act=ab-lib]');await sleep(1500);console.log('H0 before:',(await ui(p,'#ab-model')).slice(0,48));
 // simulate the browser clearing one model file
 await p.evaluate(async()=>{const r=await navigator.storage.getDirectory();const d=await (await (await r.getDirectoryHandle('model')).getDirectoryHandle('kokoro-82m-v1.0-int8'));await d.removeEntry('voices-v1.0.bin');});
 await p.reload({waitUntil:'domcontentloaded'});await sleep(3000);await click(p,'[data-act=ab-lib]');await sleep(1800);
 console.log('H1 after a model file is cleared:',(await ui(p,'#ab-model')).slice(0,230));
 await p.evaluate(()=>{PixaAudio.openGenerator(PX.getBooks()[0].id);});await sleep(1800);
 console.log('H2 generator offers Generate:',await p.evaluate(()=>{const b=document.querySelector('[data-ab=start]');return b?(b.disabled?'disabled':'enabled'):'none';}),'| preview:',await p.evaluate(()=>document.querySelector('[data-ab=preview]').disabled?'disabled':'enabled'));
 // restore: only the missing file is fetched
 const reqs0=log.requests.length;await click(p,'[data-act=back]');await sleep(300);await p.evaluate(()=>PX.go('audio'));await sleep(1200);
 await click(p,'[data-ab=model-get]');
 for(let i=0;i<60;i++){await sleep(1000);if(/Ready for offline use/.test(await ui(p,'#ab-model')))break;}
 const fetched=log.requests.slice(reqs0).filter(r=>/\/ab\/model\//.test(r));
 console.log('H3 restore ->',(await ui(p,'#ab-model')).slice(0,40),'| files requested again:',fetched.join(', '));
 // not enough storage: the device refuses a write during generation
 await p.evaluate(()=>{PixaAudio.openGenerator(PX.getBooks()[0].id);});await sleep(1500);
 await click(p,'[data-ab=none]');await sleep(200);await click(p,'[data-ab=toggle-ch][data-n="2"]');await sleep(200);
 await p.evaluate(()=>{const S=PixaAudio._internals.Store,orig=S.put;S.put=async function(path){if(/^tmp\//.test(path)){const e=new Error('quota');e.name='QuotaExceededError';e.quota=true;throw e;}return orig.apply(this,arguments);};});
 await click(p,'[data-ab=start]');
 for(let i=0;i<60;i++){await sleep(1000);const a=(await idb(p,'ab_books'))[0];if(a&&a.status==='error')break;}
 const a=(await idb(p,'ab_books'))[0];console.log('H4 storage full during generation -> status:',a.status,'| message:',a.lastError,'| chapter 1 still done:',a.chapters[0].status,'| engine released:',await p.evaluate(()=>!PixaAudio._internals.Job.cur));
 console.log('   shown to the user:',(await ui(p,'#s-abgen .scroll')).match(/The device ran out of storage[^.]*\./)?.[0]);
 console.log('errors:',log.errors.filter(e=>!/ERR_/.test(e)).join('|')||'none');
 await b.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message.slice(0,500));process.exit(1)});
