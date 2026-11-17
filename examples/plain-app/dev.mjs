import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('.',import.meta.url));
const dashboard=new URL(process.env.SWARMWATCH_DASHBOARD_ORIGIN??'http://127.0.0.1:4317');
if(!['127.0.0.1','localhost'].includes(dashboard.hostname)||dashboard.protocol!=='http:')throw new Error('Local dashboard origin required');
const files=new Map([['/','index.html'],['/content.html','content.html']]);
const server=createServer(async(req,res)=>{
  const path=new URL(req.url??'/', 'http://127.0.0.1').pathname;
  const file=files.get(path);if(req.method!=='GET'||!file){res.writeHead(404);res.end();return;}
  try{let body=await readFile(join(root,file),'utf8');if(file==='index.html')body=body.replace('__BRIDGE_ORIGIN__',dashboard.origin);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(body);}
  catch{res.writeHead(500);res.end('Example file could not be read');}
});
const port=Number(process.env.PLAIN_APP_PORT??5180);
server.listen(port,'127.0.0.1',()=>console.log(`Plain HTML example: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
