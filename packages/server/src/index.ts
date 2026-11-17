import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,realpath,stat} from 'node:fs/promises';
import {basename,extname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer,WebSocket} from 'ws';
import {DomChangeSchema,type DomChange} from '@swarmwatch/core';
import {bridgeScript} from '@swarmwatch/bridge';
import {EventStore} from './store.js';
import {Collector} from './collector.js';
import {watchProject} from './watcher.js';
export {EventStore} from './store.js';
export {Collector} from './collector.js';

export type ServerOptions={project:string;previewUrl?:string;port?:number;dataDir?:string;projectName?:string;demo?:boolean;aiEnabled?:boolean};
export async function startServer(options:ServerOptions){
  const project=await realpath(options.project);if(!(await stat(project)).isDirectory())throw new Error('Project must be a directory');
  const preview=options.previewUrl?new URL(options.previewUrl):undefined;
  if(preview&&(!['http:','https:'].includes(preview.protocol)||!['localhost','127.0.0.1','[::1]'].includes(preview.hostname)||preview.username||preview.password))throw new Error('Preview URL must be a local HTTP(S) development server');
  const dataDir=resolve(options.dataDir??join(project,'.swarmwatch'));await mkdir(dataDir,{recursive:true});
  const store=new EventStore(join(dataDir,'sessions.sqlite'));
  const sessionId=randomUUID();const token=randomBytes(32).toString('hex');
  const projectName=options.projectName??basename(project);const previewUrl=preview?.href??'';
  store.addSession({sessionId,projectName,previewUrl,startedAt:new Date().toISOString()});
  const wss=new WebSocketServer({noServer:true,maxPayload:128*1024});
  const subscriptions=new Map<WebSocket,string>();
  const clearPendingDom=new Map<WebSocket,()=>void>();
  const send=(socket:WebSocket,events:unknown[])=>{
    if(socket.readyState!==WebSocket.OPEN)return;
    if(socket.bufferedAmount>1024*1024){socket.close(1013,'Slow consumer: reconnect with last sequence');return;}
    socket.send(JSON.stringify({type:'events',events}));
  };
  const collector=new Collector(store,sessionId,event=>{for(const [client,id]of subscriptions)if(id===sessionId)send(client,[event]);});
  let port=options.port??4317;
  const allowedHosts=()=>new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  const allowedOrigins=()=>new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  const validRequest=(request:IncomingMessage)=>allowedHosts().has(request.headers.host??'')&&(!request.headers.origin||allowedOrigins().has(request.headers.origin));
  const json=(response:ServerResponse,value:unknown,status=200)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
  const dashboard=resolve(fileURLToPath(new URL('../../../apps/dashboard/dist/',import.meta.url)));
  const http=createServer(async(request,response)=>{
    const isBridge=request.url?.split('?')[0]==='/bridge.js';
    const previewBridgeRequest=!!preview&&isBridge&&allowedHosts().has(request.headers.host??'')&&request.headers.origin===preview.origin;
    if(!validRequest(request)&&!previewBridgeRequest){json(response,{error:'Forbidden origin or host'},403);return;}
    if(request.method!=='GET'){json(response,{error:'Read-only API'},405);return;}
    try{
      const url=new URL(request.url??'/',`http://127.0.0.1:${port}`);
      if(url.pathname==='/bridge.js'){
        const headers:Record<string,string>={'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin'};
        if(previewBridgeRequest)headers['Access-Control-Allow-Origin']=preview!.origin;
        response.writeHead(200,headers);response.end(bridgeScript([...allowedOrigins()],{mode:'file-change'}));return;
      }
      if(url.pathname==='/api/state'){json(response,{sessionId,projectName,previewUrl,token,demo:options.demo??false,aiEnabled:options.aiEnabled??false,observationMode:options.aiEnabled?'agents':'watch',events:store.events(sessionId)});return;}
      if(url.pathname==='/api/sessions'){json(response,store.sessions());return;}
      const match=url.pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/(events|export)$/);
      if(match){if(!store.hasSession(match[1])){json(response,{error:'Unknown session'},404);return;}
        const events=store.events(match[1]);json(response,match[2]==='export'?{format:'swarmwatch.events.v1',session:store.sessions().find(s=>s.sessionId===match[1]),historicalDom:false,events}:events);return;}
      if(url.pathname.startsWith('/api/')){json(response,{error:'Not found'},404);return;}
      const path=resolve(dashboard,'.'+decodeURIComponent(url.pathname));
      if(path!==dashboard&&!path.startsWith(dashboard+sep)){json(response,{error:'Invalid path'},400);return;}
      let file=path;
      try{if(!(await stat(file)).isFile())file=join(dashboard,'index.html');}catch{file=join(dashboard,'index.html');}
      const body=await readFile(file);
      const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
      response.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}; frame-src ${preview?.origin??"'none'"}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`});response.end(body);
    }catch{json(response,{error:'Dashboard not built; run npm run build from the workspace root.'},503);}
  });
  http.on('upgrade',(request,socket,head)=>{
    const reject=()=>{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();};
    if(!validRequest(request)||!request.headers.origin||!allowedOrigins().has(request.headers.origin)){reject();return;}
    const url=new URL(request.url??'/',`http://127.0.0.1:${port}`);const supplied=url.searchParams.get('token')??'';
    if(url.pathname!=='/ws'||Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){reject();return;}
    const selected=url.searchParams.get('sessionId')??sessionId;const after=Number(url.searchParams.get('after')??0);
    if(!store.hasSession(selected)||!Number.isSafeInteger(after)||after<0){reject();return;}
    wss.handleUpgrade(request,socket,head,client=>{
      subscriptions.set(client,selected);
      const events=store.events(selected,after);for(let i=0;i<events.length;i+=100)send(client,events.slice(i,i+100));
      let lastWindow=Date.now(),messages=0;
      let pendingCount=0;
      const timers=new Set<ReturnType<typeof setTimeout>>();
      const clearPending=()=>{for(const timer of timers)clearTimeout(timer);timers.clear();pendingCount=0;};
      clearPendingDom.set(client,clearPending);
      client.on('message',data=>{
        if(selected!==sessionId)return;
        if(Date.now()-lastWindow>1000){lastWindow=Date.now();messages=0;}
        if(++messages>100){client.close(1008,'Rate limit');return;}
        try{
          const message=JSON.parse(data.toString());
          if(message.type!=='dom'||!Array.isArray(message.changes)||message.changes.length>50)return;
          const changes:DomChange[]=[];
          for(const raw of message.changes){const parsed=DomChangeSchema.safeParse(raw);if(parsed.success)changes.push(parsed.data);}
          if(!changes.length)return;
          if(pendingCount+changes.length>200){clearPending();client.close(1008,'DOM queue capacity exceeded');return;}
          pendingCount+=changes.length;
          // Vite can report an HMR mutation before chokidar's 100ms write-stability
          // delay. Let that file event settle before selecting between JSX and CSS.
          const timer=setTimeout(()=>{
            timers.delete(timer);pendingCount-=changes.length;
            if(client.readyState===WebSocket.OPEN)for(const change of changes)collector.dom(change);
          },200);
          timers.add(timer);
        }catch{}
      });
      const cleanup=()=>{clearPending();clearPendingDom.delete(client);subscriptions.delete(client);};
      client.on('close',cleanup);client.on('error',cleanup);
    });
  });
  try{
    await new Promise<void>((resolveListen,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',()=>{port=(http.address()as {port:number}).port;resolveListen();});});
    const watcher=await watchProject(project,collector);
    let closed=false;
    return {port,url:`http://localhost:${port}`,sessionId,collector,async close(){if(closed)return;closed=true;await watcher.close();for(const clear of clearPendingDom.values())clear();clearPendingDom.clear();for(const client of subscriptions.keys())client.terminate();wss.close();await new Promise<void>(resolveClose=>http.close(()=>resolveClose()));store.close();}};
  }catch(error){http.close();wss.close();store.close();throw error;}
}
