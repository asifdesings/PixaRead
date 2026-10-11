const {launch,open,sleep,rss,idb}=require('./e2e_lib.js');const fs=require('fs');const {execSync}=require('child_process');
const ui=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\s+/g,' ').trim():null;},sel);
async function dumpChapters(p,tag){const a=(await idb(p,'ab_books'))[0];const ch=await idb(p,'ab_chunks');console.log(tag,'status',a&&a.status,'| chapters',a&&a.chapters.map(c=>c.status+'('+c.done+'/'+c.nChunks+')').join(' '),'| partial chunk records',ch.length);return a;}
(async()=>{
 const b=await launch('/tmp/pxprof');let {p,log}=await open(b);
 console.log('B1 after browser restart, model card:',(await ui(p,'#s-library')?'':'')+'(opening audiobooks)');
 await p.evaluate(()=>document.querySelector('[data-ab=x]')||document.querySelector('[data-act=ab-lib]').click());await sleep(1500);
 console.log('   ',(await ui(p,'#ab-model')).slice(0,150));
 // book details -> Audiobook
 await p.evaluate(()=>{const P=window.PX;P.go&&0;});
 await p.evaluate(()=>document.querySelector('#s-audio [data-act=back]').click());await sleep(500);
 await p.evaluate(()=>{const c=document.querySelector('#s-library .book');c.click();});await sleep(800);
 await p.evaluate(()=>document.querySelector('[data-act=ab-book]').click());await sleep(1800);
 console.log('B2 generator shows:',(await ui(p,'#s-abgen .scroll')).slice(0,330));
 const chapRows=await p.evaluate(()=>[...document.querySelectorAll('#s-abgen [data-ab=toggle-ch]')].map(b=>b.innerText.replace(/\s+/g,' ')));console.log('   chapter rows:',chapRows.join(' || '));
 // voice preview (real inference)
 await p.evaluate(()=>document.querySelector('[data-ab=preview]').click());
 for(let i=0;i<60;i++){await sleep(1000);const m=await ui(p,'#ab-prev-msg');if(/Played in|failed/.test(m)){console.log('B3 preview:',m);break;}}
 // generate
 await p.evaluate(()=>document.querySelector('[data-ab=start]').click());
 let t0=Date.now(),stopped=false;
 for(let i=0;i<200;i++){await sleep(1000);const a=await idb(p,'ab_books');const ab=a[0];if(!ab)continue;
   const c1=ab.chapters[0].status==='done',c2=ab.chapters[1];
   if(c1&&c2.done>=1&&!stopped){console.log('B4 chapter 1 done, chapter 2 has',c2.done,'passage(s) done -> pressing Cancel after',Math.round((Date.now()-t0)/1000),'s');
     console.log('   progress panel:',(await ui(p,'#ab-prog'))||'(none)');
     await p.evaluate(()=>document.querySelector('[data-ab=stop]').click());stopped=true;
     for(let j=0;j<60;j++){await sleep(1000);const x=(await idb(p,'ab_books'))[0];if(x.status!=='running')break;}
     break;}}
 const a1=await dumpChapters(p,'B5 after cancel:');
 console.log('   card text:',(await ui(p,'#s-abgen .scroll')).match(/Generate \/ resume|Generate audiobook/)?.[0]);
 // simulate the app being closed in the middle of work: resume, then reload abruptly
 await p.evaluate(()=>document.querySelector('[data-ab=start]').click());
 for(let i=0;i<60;i++){await sleep(700);const ab=(await idb(p,'ab_books'))[0];if(ab.chapters[1].done>=2||ab.chapters[2].done>=1){break;}}
 const live=await dumpChapters(p,'B6 just before the app is killed:');
 await p.reload({waitUntil:'domcontentloaded'});await sleep(3500);
 const rec=await dumpChapters(p,'B7 after reload:');
 await p.evaluate(()=>document.querySelector('[data-act=ab-lib]').click());await sleep(1500);
 console.log('   library card:',(await ui(p,'#s-audio .abrow')).slice(0,170));
 console.log('errors (excluding offline fonts):',log.errors.filter(e=>!/ERR_NAME_NOT_RESOLVED/.test(e)).join(' | ')||'none');
 await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,500));process.exit(1)});
