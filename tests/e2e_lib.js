const chromium=require('@sparticuz/chromium').default;const puppeteer=require('puppeteer-core');const fs=require('fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const URL_='http://localhost:8089/index.html';
async function launch(profile){
  return puppeteer.launch({executablePath:await chromium.executablePath(),args:[...chromium.args,'--no-sandbox','--autoplay-policy=no-user-gesture-required','--user-data-dir='+profile],headless:'shell',protocolTimeout:900000});
}
async function open(b,opts={}){
  const p=await b.newPage();await p.setViewport({width:390,height:800,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const log={errors:[],failed:[],requests:[]};
  p.on('pageerror',e=>log.errors.push('pageerror: '+e.message));
  p.on('console',m=>{if(m.type()==='error')log.errors.push('console: '+m.text().slice(0,200));});
  p.on('requestfailed',r=>log.failed.push(r.url().replace('http://localhost:8089','')+' '+(r.failure()&&r.failure().errorText)));
  p.on('request',r=>log.requests.push(r.url().replace('http://localhost:8089','')));
  if(opts.init)await p.evaluateOnNewDocument(opts.init);
  await p.goto(opts.url||URL_,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>document.querySelector('#splash')&&document.querySelector('#splash').hidden,{timeout:20000}).catch(()=>{});
  await sleep(500);
  return {p,log};
}
const rss=()=>{ // total resident memory (MB) of all browser processes
  const {execSync}=require('child_process');try{return Math.round(execSync("ps -eo rss,comm | grep -iE 'chrom|headless' | awk '{s+=$1} END {print s/1024}'").toString().trim());}catch(e){return -1;}
};
async function idb(p,store){return p.evaluate(s=>new Promise(res=>{const rq=indexedDB.open('inkleaf');rq.onsuccess=()=>{const t=rq.result.transaction(s).objectStore(s).getAll();t.onsuccess=()=>res(t.result);t.onerror=()=>res(null);};}),store);}
module.exports={launch,open,sleep,rss,idb,URL_};
