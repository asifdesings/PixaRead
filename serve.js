// Tiny static server for testing: correct MIME types, Range support, no framework.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[3]||__dirname),port=+process.argv[2]||8089;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.onnx':'application/octet-stream','.bin':'application/octet-stream','.txt':'text/plain','.md':'text/plain'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';
  const f=path.join(root,p);if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('not found');}
  const st=fs.statSync(f),type=MIME[path.extname(f)]||'application/octet-stream';
  const h={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':'no-cache'};
  const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
  if(m){const s=+m[1],e=m[2]?+m[2]:st.size-1;res.writeHead(206,{...h,'Content-Range':`bytes ${s}-${e}/${st.size}`,'Content-Length':e-s+1});fs.createReadStream(f,{start:s,end:e}).pipe(res);}
  else{res.writeHead(200,{...h,'Content-Length':st.size});fs.createReadStream(f).pipe(res);}
}).listen(port,()=>console.log('serving',root,'on',port));
