const {launch,open,sleep,idb}=require('./e2e_lib.js');const fs=require('fs');const {execSync}=require('child_process');
const ui=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\s+/g,' ').trim():null;},sel);
const click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
(async()=>{
 fs.rmSync('/tmp/pxprof4',{recursive:true,force:true});
 const b=await launch('/tmp/pxprof4');const {p,log}=await open(b,{init:()=>{window.__PXA_FORCE_IDB=true;}});
 const inp=await p.$('#file');await inp.uploadFile('story.txt');await sleep(2500);
 await click(p,'[data-act=back]');await sleep(400);await click(p,'[data-act=ab-lib]');await sleep(1500);
 console.log('I1 storage mode (forced fallback):',await p.evaluate(()=>PixaAudio._internals.Store.mode()),'| shown:',(await ui(p,'#s-audio dl')).match(/Stored in[^A-Z]*[a-z ]+/i)?.[0]);
 await click(p,'[data-ab=model-get]');
 for(let i=0;i<150;i++){await sleep(1000);if(/Ready for offline use|not found|failed|damaged/i.test(await ui(p,'#ab-model')))break;}
 console.log('I2 model setup in the database fallback:',(await ui(p,'#ab-model')).slice(0,70),'| rtf record:',JSON.stringify(((await idb(p,'ab_model'))[0]||{}).hash));
 await p.evaluate(()=>PixaAudio.openGenerator(PX.getBooks()[0].id));await sleep(1800);
 await click(p,'[data-ab=none]');await sleep(200);await click(p,'[data-ab=toggle-ch][data-n="0"]');await sleep(200);await click(p,'[data-ab=start]');
 for(let i=0;i<150;i++){await sleep(1000);const a=(await idb(p,'ab_books'))[0];if(a&&(a.status==='done'||a.status==='error'))break;}
 const a=(await idb(p,'ab_books'))[0];console.log('I3 chapter generated in the fallback store:',a.status,'|',a.chapters[0].secs.toFixed(1)+'s',a.chapters[0].bytes+'B','| storage field:',a.storage);
 const b64=await p.evaluate(async()=>{const I=PixaAudio._internals;const id=PX.getBooks()[0].id;const f=await I.Store.get('audio/'+id+'/0.wav');const buf=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s);});
 fs.writeFileSync('/tmp/idb_ch1.wav',Buffer.from(b64,'base64'));console.log('   transcript:',execSync('python3 transcribe.py /tmp/idb_ch1.wav').toString().trim());
 await click(p,'#s-abgen [data-ab=listen]');await sleep(3500);console.log('I4 playing from the fallback store:',JSON.stringify(await p.evaluate(()=>{const a=PixaAudio._internals.Play.a;return {t:+a.currentTime.toFixed(1),paused:a.paused};})));
 console.log('errors:',log.errors.filter(e=>!/ERR_/.test(e)).join('|')||'none');
 await b.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message.slice(0,500));process.exit(1)});
