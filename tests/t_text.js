const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});const w=dom.window;
Object.defineProperty(w,'crypto',{value:require('crypto').webcrypto});w.TextEncoder=TextEncoder;
w.eval(fs.readFileSync('../ab/text-prep.js','utf8'));const T=w.PXText;
let pass=0,fail=0;const check=(n,ok,d)=>{(ok?pass++:fail++);console.log((ok?'PASS ':'FAIL ')+n+(d?'  -> '+d:''));};
// 1 sentences
let s=T.splitSentences('Dr. Smith met Mr. Jones at 5 p.m. on Jan. 3. "Stop!" he said. She left. J. R. Tolkien wrote it; e.g. this one. The end...');
check('abbreviations and initials do not split sentences',s.length===5&&/^Dr\. Smith met Mr\. Jones/.test(s[0]),JSON.stringify(s.map(x=>x.slice(0,28))));
check('dialogue splits after the closing quote',s[1]==='"Stop!" he said.'||/Stop/.test(s[1]),s[1]);
// 2 chapter html -> segments
const html='<div class="ch-head"><div class="ch-label">CHAPTER 2</div><h1>MONEY AND MARKETS</h1></div><p>First paragraph with a note.<sup>1</sup> It goes on.</p><h2>A SUBHEADING HERE</h2><p>Second paragraph.</p><ul><li>One apple</li><li>Two pears</li></ul><ol><li>First</li><li>Second</li></ol><blockquote><p>A quoted line of text.</p></blockquote><pre>def f(x): return x</pre><table><tr><td>Name</td><td>Age</td></tr><tr><td>Ann</td><td>31</td></tr></table><figure><img src="data:image/png;base64,AAAA"><figcaption>Figure 1. A map</figcaption></figure><p class="altimg">[Image: x]</p><p class="fn">1 The footnote text.</p><hr><p>After the break.</p>';
const r=T.toSegments(html,{});const k=r.segs.map(x=>x.k).join(' ');
check('structure kinds in order',k==='title para head para list list list list quote table table cap foot break para',k);
check('title read as words, not shouted',r.segs[0].text==='Chapter 2. Money and Markets',r.segs[0].text);
check('footnote mark is not read as a number',r.segs[1].text==='First paragraph with a note. It goes on.',r.segs[1].text);
check('ordered list keeps its numbers',r.segs.filter(x=>x.k==='list').map(x=>x.text).join('|')==='One apple|Two pears|1. First|2. Second');
check('code and pictures are counted, not read',r.stats.code===1&&r.stats.images>=1&&!/def f/.test(JSON.stringify(r.segs)),JSON.stringify(r.stats));
check('table rows are read row by row',r.segs.filter(x=>x.k==='table').map(x=>x.text).join('|')==='Name, Age|Ann, 31');
const r2=T.toSegments(html,{skipFootnotes:true});check('footnotes can be skipped (and counted)',!r2.segs.some(x=>x.k==='foot')&&r2.stats.skippedFootnotes===1);
// 3 chunks: no cut words, pauses, nothing lost
const long='This is a sentence, with several clauses; it keeps going for quite a while, and then it keeps going some more, because the author liked long sentences, and wanted them read exactly as written, with every single word preserved in order. '.repeat(3);
const ch=T.makeChunks([{k:'para',text:long},{k:'head',text:'Next Part'},{k:'para',text:'Short one.'}],{});
const joined=ch.map(c=>c.t).join(' ').replace(/\s+/g,' ');
check('no words lost or reordered by chunking',joined.replace(/\s/g,'')===(long+'Next Part'+'Short one.').replace(/\s/g,''),ch.length+' chunks');
check('chunks respect the size limit',ch.every(c=>c.t.length<=250),'max '+Math.max(...ch.map(c=>c.t.length)));
check('no chunk starts or ends in the middle of a word',ch.every(c=>/^\S/.test(c.t)&&/\S$/.test(c.t)&&!/\w-$/.test(c.t)));
check('pause before a heading is longer than inside a paragraph',ch.find(c=>c.t==='Next Part')&&ch[ch.findIndex(c=>c.t==='Next Part')-1].gap>=1.0&&ch[0].gap<0.2);
check('last chunk has no trailing pause',ch[ch.length-1].gap===0);
// 4 grouping of stored pieces
const g=T.groupChapters([{title:'One',html:'a'},{title:'One',html:'b',cont:true},{title:'Two',html:'c'}]);check('continuation pieces join their chapter',g.length===2&&g[0].pieces.length===2&&g[1].title==='Two');
const pc=T.prepareChapter({title:'Img',pieces:[{html:'<p class="altimg">[Image: a]</p><figure><img src="x"></figure>'}]},{});check('picture-only chapter is reported, not narrated',pc.chars===0&&/only pictures/.test(pc.problem),pc.problem);
const pe=T.prepareChapter({title:'E',pieces:[{html:''}]},{});check('empty chapter is reported',pe.chars===0&&/no text/.test(pe.problem));
// 5 language and names
check('Latin share detects non-Latin text',T.latinShare('Hello world')>0.99&&T.latinShare('\u0986\u09AE\u09BF \u09AC\u0987 \u09AA\u09A1\u09BC\u09BF')<0.1);
check('safe file names',T.safeName('A/B:C*D?"E<F>G|H\u0000.. ')==='A B C D E F G H'&&T.safeName('')==='Untitled'&&T.safeName('x'.repeat(200)).length===80,T.safeName('A/B:C*D?"E<F>G|H\u0000.. '));
T.fingerprint([{t:'a',gap:0}],{voice:'af_heart'}).then(a=>T.fingerprint([{t:'a',gap:0}],{voice:'af_heart'}).then(b=>T.fingerprint([{t:'a',gap:0}],{voice:'am_adam'}).then(c=>{check('fingerprint is stable and changes with the voice',a===b&&a!==c&&a.length===64);console.log('\n'+pass+' passed, '+fail+' failed');})));
