const {launch,open,sleep}=require('./e2e_lib.js');
const click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
async function audit(p,name){
 return p.evaluate(name=>{const vw=document.documentElement.clientWidth;const sc=document.querySelector('.screen:not([hidden])');
   const over=[...sc.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>vw+1||r.left<-1)&&getComputedStyle(e).position!=='fixed';}).map(e=>e.tagName+'.'+(e.className||'').toString().slice(0,18)).slice(0,4);
   const small=[...sc.querySelectorAll('button,select,input[type=range]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.height<40||r.width<40)&&!e.closest('[hidden]');}).map(e=>(e.dataset.ab||e.dataset.act||e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height));
   return {screen:name,pageScrollsSideways:document.documentElement.scrollWidth>vw||sc.scrollWidth>vw+1,overflowing:over,smallTargets:[...new Set(small)].slice(0,8)};},name);
}
(async()=>{
 const b=await launch('/tmp/pxprof3');
 for(const w of [360,390]){
  const {p}=await open(b);await p.setViewport({width:w,height:780,deviceScaleFactor:1,isMobile:true,hasTouch:true});await p.reload({waitUntil:'domcontentloaded'});await sleep(2500);
  await click(p,'[data-act=ab-lib]');await sleep(1800);console.log(w,'px',JSON.stringify(await audit(p,'audiobooks')));if(w===390)await p.screenshot({path:'lay_lib.png'});
  await p.evaluate(()=>PixaAudio.openGenerator(PX.getBooks()[0].id));await sleep(2200);console.log(w,'px',JSON.stringify(await audit(p,'generator')));
  if(w===390){await p.screenshot({path:'lay_gen1.png'});await p.evaluate(()=>{document.querySelector('#s-abgen .scroll').scrollTop=900;});await sleep(300);await p.screenshot({path:'lay_gen2.png'});}
  await click(p,'#s-abgen [data-ab=listen]');await sleep(2500);console.log(w,'px',JSON.stringify(await audit(p,'player')));if(w===390){await p.screenshot({path:'lay_play.png'});await p.evaluate(()=>PixaAudio._internals.Play.a.pause());}
  await p.close();
 }
 await b.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message.slice(0,400));process.exit(1)});
