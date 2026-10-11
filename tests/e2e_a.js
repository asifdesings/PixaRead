const {launch,open,sleep,rss,idb}=require('./e2e_lib.js');const fs=require('fs');
(async()=>{
 fs.rmSync('/tmp/pxprof',{recursive:true,force:true});
 const b=await launch('/tmp/pxprof');const {p,log}=await open(b);
 const sw=await p.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return {scope:r.scope.replace(location.origin,''),state:(r.active||{}).state};});
 console.log('A1 service worker active:',JSON.stringify(sw),'| secure context:',await p.evaluate(()=>isSecureContext));
 const inp=await p.$('#file');await inp.uploadFile('story.txt');await sleep(2500);
 const bk=await idb(p,'books');console.log('A2 imported:',bk.map(x=>x.title+' ('+x.chapterCount+' chapters)').join(', '));
 // open audiobook library from the library header button
 await p.evaluate(()=>document.querySelector('[data-act=back]')&&document.querySelector('[data-act=back]').click());await sleep(500);
 await p.evaluate(()=>document.querySelector('[data-act=ab-lib]').click());await sleep(1500);
 const card=await p.evaluate(()=>document.querySelector('#ab-model').innerText.replace(/\s+/g,' ').slice(0,260));console.log('A3 first launch model card:',card);
 console.log('   memory before model (MB, all browser processes):',rss());
 const t0=Date.now();
 await p.evaluate(()=>document.querySelector('[data-ab=model-get]').click());
 let seen=[];for(let i=0;i<400;i++){await sleep(500);const t=await p.evaluate(()=>(document.querySelector('#ab-m-step')||{}).textContent||(document.querySelector('#ab-model')||{innerText:''}).innerText.slice(0,60));if(!seen.length||seen[seen.length-1]!==t.slice(0,22))seen.push(t.slice(0,22));
   const done=await p.evaluate(()=>/Ready for offline use/.test(document.querySelector('#ab-model').innerText));if(done)break;
   const err=await p.evaluate(()=>/not found|failed|missing|damaged/i.test(document.querySelector('#ab-model').innerText)&&!document.querySelector('#ab-m-step'));if(err){console.log('ERROR shown:',await p.evaluate(()=>document.querySelector('#ab-model').innerText));break;}}
 console.log('A4 model setup stages seen:',seen.join(' > '),'| took',Math.round((Date.now()-t0)/1000),'s');
 const rec=(await idb(p,'ab_model'))[0];console.log('A5 verified record:',JSON.stringify({ready:rec&&rec.ready,hash:rec&&rec.hash,rtf:rec&&+rec.rtf.toFixed(2),modelId:rec&&rec.modelId}));
 console.log('   card now:',await p.evaluate(()=>document.querySelector('#ab-model').innerText.replace(/\s+/g,' ').slice(0,200)));
 console.log('   memory with model loaded (MB):',rss());
 const files=await p.evaluate(async()=>{const r=await navigator.storage.getDirectory();const out=[];const walk=async(d,pre)=>{for await(const [n,h] of d.entries()){if(h.kind==='file')out.push(pre+n+' '+(await h.getFile()).size);else await walk(h,pre+n+'/');}};await walk(r,'');return out;});
 console.log('A6 files in private storage:',files.join(' | '));
 console.log('   persistent storage granted:',await p.evaluate(()=>navigator.storage.persisted()));
 console.log('errors:',log.errors.join(' | ')||'none');
 await p.screenshot({path:'ab_lib.png'});
 await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,400));process.exit(1)});
