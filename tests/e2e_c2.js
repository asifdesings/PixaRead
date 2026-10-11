const {launch,open,sleep,idb}=require('./e2e_lib.js');
const ui=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\s+/g,' ').trim():null;},sel);
const au=p=>p.evaluate(()=>{const a=PixaAudio._internals.Play;return {n:a.n,t:+(a.a?a.a.currentTime:0).toFixed(2),dur:+(a.a&&isFinite(a.a.duration)?a.a.duration:0).toFixed(2),paused:a.a?a.a.paused:null,rate:a.a?a.a.playbackRate:null,missing:a.missing};});
const click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
(async()=>{
 let b=await launch('/tmp/pxprof');let {p,log}=await open(b);
 await click(p,'[data-act=ab-lib]');await sleep(1500);
 await click(p,'#s-audio [data-ab=listen]');await sleep(2500);
 console.log('E1 player opened:',await ui(p,'#s-aplay .rinfo'),'|',JSON.stringify(await au(p)),'| screen visible:',await p.evaluate(()=>!document.querySelector('#s-aplay').hidden));
 await sleep(2500);const t1=(await au(p)).t;console.log('E2 playing (position advances):',t1>1.5?'yes':'NO','t =',t1,'| button shows:',await ui(p,'#ab-pp'));
 await click(p,'[data-ab=toggle]');await sleep(400);console.log('E3 pause:',(await au(p)).paused,'| button:',await ui(p,'#ab-pp'));
 await click(p,'[data-ab=toggle]');await sleep(400);console.log('   play again:',!(await au(p)).paused);
 await click(p,'[data-ab=pspeed][data-v="1.5"]');await sleep(300);console.log('E4 speed 1.5x -> playbackRate:',(await au(p)).rate);
 await click(p,'[data-ab=next]');await sleep(1500);console.log('E5 next chapter ->',JSON.stringify(await au(p)),'|',await ui(p,'#ab-p-ch'));
 await click(p,'[data-ab=prev]');await sleep(1500);console.log('   previous chapter -> chapter index',(await au(p)).n);
 // auto-advance at the end of a chapter
 await p.evaluate(()=>{const a=PixaAudio._internals.Play.a;a.currentTime=a.duration-0.6;});await sleep(3500);
 const adv=await au(p);console.log('E6 end of chapter 1 -> automatically continued with chapter index',adv.n,'| playing:',!adv.paused);
 // sleep timer: stop at the end of this chapter
 await click(p,'[data-ab=sleep][data-v="chapter"]');await sleep(300);
 await p.evaluate(()=>{const a=PixaAudio._internals.Play.a;a.currentTime=a.duration-0.6;});await sleep(3500);
 const sl=await au(p);console.log('E7 sleep timer "end of chapter" -> stayed on chapter index',sl.n,'| paused:',sl.paused);
 // save a position, leave, restart the browser
 await p.evaluate(()=>{const a=PixaAudio._internals.Play.a;a.currentTime=3;a.pause();});await sleep(800);
 await click(p,'#s-aplay [data-act=back]');await sleep(500);
 const ab=(await idb(p,'ab_books'))[0];console.log('E8 saved listening position:',JSON.stringify(ab.lastPos),'| leaving the player pauses audio:',(await au(p)).paused);
 await b.close();
 b=await launch('/tmp/pxprof');({p,log}=await open(b));
 await click(p,'[data-act=ab-lib]');await sleep(1500);
 console.log('E9 after browser restart, card says:',(await ui(p,'#s-audio .abrow')).match(/STOPPED AT[^·]*/i)?.[0]);
 await click(p,'#s-audio [data-ab=listen]');await sleep(2500);const rs=await au(p);console.log('   Listen resumes at chapter index',rs.n,'position',rs.t,'s');
 // a missing / cleared file is recoverable
 await click(p,'#s-aplay [data-act=back]');await sleep(300);
 await p.evaluate(async()=>{const I=PixaAudio._internals;const id=(await I.getAB((await new Promise(r=>{const q=indexedDB.open('inkleaf');q.onsuccess=()=>{const t=q.result.transaction('ab_books').objectStore('ab_books').getAll();t.onsuccess=()=>r(t.result[0].id);};})))).id;await I.Store.del('audio/'+id+'/2.wav');});
 await click(p,'#s-audio [data-ab=listen]');await sleep(1500);await click(p,'[data-ab=play-ch][data-n="2"]');await sleep(1200);
 console.log('E10 file removed -> player says:',(await ui(p,'#s-aplay .scroll')).slice(0,170),'| regenerate button:',await p.evaluate(()=>!!document.querySelector('[data-ab=regen]')));
 await click(p,'[data-ab=regen]');await sleep(2500);
 console.log('    Regenerate opens the generator with that chapter ready:',await p.evaluate(()=>!document.querySelector('#s-abgen').hidden),'| selected:',await p.evaluate(()=>[...document.querySelectorAll('#s-abgen [data-ab=toggle-ch]')].map(x=>x.innerText.trim().slice(0,3)).join(' ')));
 await click(p,'[data-ab=start]');
 for(let i=0;i<90;i++){await sleep(1000);const a=(await idb(p,'ab_books'))[0];if(a.chapters[2].status==='done')break;}
 console.log('    chapter regenerated:',(await idb(p,'ab_books'))[0].chapters[2].status);
 // delete the audiobook: books are untouched
 const bookBefore=(await idb(p,'books'))[0],contBefore=(await idb(p,'content'))[0];
 await click(p,'#s-abgen [data-act=back]');await sleep(500);await p.evaluate(()=>{if(document.querySelector('#s-audio').hidden)document.querySelector('[data-act=ab-lib]')&&0;});
 await p.evaluate(()=>PX.go('audio'));await sleep(1200);
 await click(p,'#s-audio [data-ab=delete]');await sleep(500);console.log('E11 delete asks first:',(await ui(p,'#modal')).slice(0,170));
 await p.evaluate(()=>{[...document.querySelectorAll('#modal button')].find(x=>/Delete audio/i.test(x.textContent)).click();});await sleep(1500);
 const left=await p.evaluate(async()=>{const r=await navigator.storage.getDirectory();const out=[];const walk=async(d,pre)=>{for await(const [n,h] of d.entries()){if(h.kind==='file')out.push(pre+n);else await walk(h,pre+n+'/');}};await walk(r,'');return out.filter(x=>!/^model\//.test(x));});
 const bookAfter=(await idb(p,'books'))[0],contAfter=(await idb(p,'content'))[0];
 console.log('    audio left on device:',left.length?left.join(','):'none','| audiobook records:',(await idb(p,'ab_books')).length,'| book kept:',!!bookAfter&&bookAfter.title===bookBefore.title,'| chapters kept:',contAfter.chapters.length===contBefore.chapters.length,'| reading position unchanged:',JSON.stringify(bookAfter.pos)===JSON.stringify(bookBefore.pos),'| model still ready:',/Ready for offline/.test(await ui(p,'#ab-model')));
 console.log('errors (excluding offline fonts):',log.errors.filter(e=>!/ERR_NAME_NOT_RESOLVED/.test(e)).join(' | ')||'none');
 await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,500));process.exit(1)});
