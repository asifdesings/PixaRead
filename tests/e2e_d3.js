const {launch,open,sleep}=require('./e2e_lib.js');
const click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
const mock=()=>{window.__spoken=[];const syn={speaking:false,paused:false,pending:false,onvoiceschanged:null,getVoices:()=>[{name:'Fake English',lang:'en-US',voiceURI:'Fake',localService:true,default:true}],addEventListener(){},removeEventListener(){},cancel(){syn.speaking=false;window.__spoken.push('cancel');},pause(){syn.paused=true;window.__spoken.push('pause');},resume(){syn.paused=false;window.__spoken.push('resume');},speak(u){syn.speaking=true;window.__spoken.push('speak('+(u.voice&&u.voice.name)+',rate='+u.rate+'):'+u.text.slice(0,28));}};Object.defineProperty(window,'speechSynthesis',{value:syn,configurable:true});window.SpeechSynthesisUtterance=function(t){this.text=t;this.rate=1;this.pitch=1;this.voice=null;this.lang='';};};
(async()=>{
 const b=await launch('/tmp/pxprof3');const {p,log}=await open(b,{init:mock});
 await p.evaluate(()=>document.querySelector('#s-library .book').click());await sleep(600);await click(p,'#s-details [data-act=read]');await sleep(1800);
 const co=await p.$('#coach');if(co){await p.tap('#coach [data-act=coach-ok]');await sleep(300);}
 await p.touchscreen.tap(195,380);await sleep(500);
 await p.evaluate(()=>document.querySelector('[data-act=sheet][data-k=dim]').click());await sleep(600);
 console.log('reader control present:',await p.evaluate(()=>!!document.querySelector('[data-act=tts]')));
 await p.evaluate(()=>document.querySelector('[data-act=tts]').click());await sleep(1200);
 console.log('Read aloud started ->',JSON.stringify(await p.evaluate(()=>window.__spoken)));
 console.log('player bar shown:',await p.evaluate(()=>!!document.querySelector('[data-act=tts-pause],[data-act=speak-pause],#ttsbar,.ttsbar')));
 await p.evaluate(()=>document.querySelector('[data-act=tts]').click());await sleep(500);
 console.log('Read aloud stopped ->',JSON.stringify(await p.evaluate(()=>window.__spoken.slice(-2))));
 console.log('audiobook feature present at the same time:',await p.evaluate(()=>!!PixaAudio&&!!PX.ab),'| errors:',log.errors.filter(e=>!/ERR_/.test(e)).join('|')||'none');
 await b.close();process.exit(0);
})().catch(e=>{console.log('ERR',e.message.slice(0,400));process.exit(1)});
