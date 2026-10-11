const {launch,open,sleep,rss,idb}=require('./e2e_lib.js');const fs=require('fs');const {execSync}=require('child_process');
const ui=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);return e?e.innerText.replace(/\s+/g,' ').trim():null;},sel);
const stats=p=>p.evaluate(()=>PixaAudio.stats.synth);
async function pull(p,n,file){const b64=await p.evaluate(async n=>{const I=PixaAudio._internals;const ab=await I.getAB(I.UI.genBook?I.UI.genBook.meta.id:(await I.Store.init(),(await new Promise(r=>{const q=indexedDB.open('inkleaf');q.onsuccess=()=>{const t=q.result.transaction('ab_books').objectStore('ab_books').getAll();t.onsuccess=()=>r(t.result[0].id);};}))));const f=await I.Store.get('audio/'+ab.id+'/'+n+'.wav');if(!f)return null;const buf=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s);},n);if(!b64)return null;fs.writeFileSync(file,Buffer.from(b64,'base64'));return fs.statSync(file).size;}
(async()=>{
 const b=await launch('/tmp/pxprof');let {p,log}=await open(b);
 await p.evaluate(()=>document.querySelector('[data-act=ab-lib]').click());await sleep(1500);
 console.log('C1 library card:',(await ui(p,'#s-audio .abrow')).slice(0,120));
 await p.evaluate(()=>document.querySelector('#s-audio [data-ab=gen]').click());await sleep(1800);
 const t0=Date.now();await p.evaluate(()=>document.querySelector('[data-ab=start]').click());
 for(let i=0;i<120;i++){await sleep(1000);const a=(await idb(p,'ab_books'))[0];if(a.status==='done'||a.status==='error')break;}
 const a=(await idb(p,'ab_books'))[0];
 console.log('C2 resumed and finished in',Math.round((Date.now()-t0)/1000),'s | status',a.status,'| chapters',a.chapters.map(c=>c.status+' '+c.secs.toFixed(1)+'s '+c.bytes+'B').join(' | '));
 console.log('   passages generated in this session (only the 1 missing one is expected):',await stats(p));
 const left=await p.evaluate(async()=>{const r=await navigator.storage.getDirectory();const out=[];const walk=async(d,pre)=>{for await(const [n,h] of d.entries()){if(h.kind==='file')out.push(pre+n+' '+(await h.getFile()).size);else await walk(h,pre+n+'/');}};await walk(r,'');return out.filter(x=>!/^model\//.test(x));});
 console.log('   audio files kept (no leftover temporary passages):',left.join(' | '));
 // verify each WAV and transcribe it with an independent recogniser
 const want=[/lighthouse|sea|keeper|lamp/,/anyone|voice|rocks|boat/,/storm|boat|sea|calm/];
 for(let n=0;n<3;n++){const f='/tmp/ch'+n+'.wav';const size=await pull(p,n,f);const buf=fs.readFileSync(f);
   const ok=buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WAVE'&&buf.readUInt32LE(4)===size-8&&buf.readUInt32LE(40)===size-44&&buf.readUInt32LE(24)===24000;
   const tr=execSync('python3 transcribe.py '+f).toString().trim();
   console.log('C3 chapter',n+1,'| header consistent:',ok,'| length|transcript:',tr,'| expected topic words found:',want[n].test(tr));}
 // reuse: same text, same voice -> nothing is generated again
 const before=await stats(p);await p.evaluate(()=>document.querySelector('[data-ab=start]').click());await sleep(4000);
 const a2=(await idb(p,'ab_books'))[0];console.log('C4 pressed Generate again with nothing changed -> new passages generated:',(await stats(p))-before,'| status',a2.status);
 console.log('errors (excluding offline fonts):',log.errors.filter(e=>!/ERR_NAME_NOT_RESOLVED/.test(e)).join(' | ')||'none');
 await b.close();
})().catch(e=>{console.log('ERR',e.message.slice(0,500));process.exit(1)});
