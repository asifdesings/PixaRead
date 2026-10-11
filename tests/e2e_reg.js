const {launch,sleep,idb}=require('./e2e_lib.js');const fs=require('fs');
const req=require('module').createRequire('/home/claude/x.js');
(async()=>{
 fs.rmSync('/tmp/pxprof6',{recursive:true,force:true});
 const b=await launch('/tmp/pxprof6');const p=await b.newPage();await p.setViewport({width:390,height:800,deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://localhost:8089/index.html',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.querySelector('#splash').hidden,{timeout:20000}).catch(()=>{});await sleep(800);
 const files=['story.txt','sample.html','sample.md','./pics.epub','./hier.pdf','long.txt'];
 for(const f of files){const inp=await p.$('#file');await inp.uploadFile(f);for(let i=0;i<60;i++){await sleep(400);if(await p.evaluate(()=>!document.querySelector('#s-details').hidden))break;}
   const bk=await idb(p,'books');const last=bk.sort((a,b)=>b.added-a.added)[0];console.log('import',f.split('/').pop().padEnd(12),'->',last.format,'|',last.title,'|',last.chapterCount,'chapters');
   await p.evaluate(()=>document.querySelector('#s-details [data-act=back]').click());await sleep(400);}
 console.log('books in library:',(await idb(p,'books')).length,'(+ the built-in guide book counts if present)');
 // bookmarks and progress on the TXT book
 await p.evaluate(()=>{const b=[...document.querySelectorAll('#s-library .book')].find(x=>/story/i.test(x.innerText));b.click();});await sleep(700);
 await p.evaluate(()=>document.querySelector('#s-details [data-act=read]').click());await sleep(1800);
 const co=await p.$('#coach');if(co){await p.tap('#coach [data-act=coach-ok]');await sleep(300);}
 await p.touchscreen.tap(195,380);await sleep(400);await p.evaluate(()=>document.querySelector('[data-act=bookmark]').click());await sleep(1500);
 for(let i=0;i<3;i++){await p.touchscreen.tap(360,380);await sleep(600);}await sleep(2500);
 const bk=(await idb(p,'books')).find(x=>/long/i.test(x.title));console.log('bookmarks saved:',bk.bookmarks.length,'| reading position:',JSON.stringify(bk.pos),'| progress:',Math.round(bk.progress*100)+'%');
 await p.reload({waitUntil:'domcontentloaded'});await sleep(3000);
 const bk2=(await idb(p,'books')).find(x=>/long/i.test(x.title));console.log('after reload -> bookmarks:',bk2.bookmarks.length,'| position kept:',JSON.stringify(bk2.pos)===JSON.stringify(bk.pos),'| library shows:',await p.evaluate(()=>[...document.querySelectorAll('#s-library .book')].find(x=>/long/i.test(x.innerText)).innerText.replace(/\s+/g,' ').slice(0,60)));
 console.log('page errors:',errs.join('|')||'none');await b.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message.slice(0,400));process.exit(1)});
