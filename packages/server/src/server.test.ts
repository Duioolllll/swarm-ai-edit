import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {Collector} from './collector.js';
import {EventStore} from './store.js';
import {startServer} from './index.js';
import type {EventInput,SwarmEvent} from '@swarmwatch/core';

const cleanups:(()=>Promise<unknown>|unknown)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually<T>(read:()=>Promise<T>,valid:(x:T)=>boolean){const start=Date.now();while(Date.now()-start<5000){const value=await read();if(valid(value))return value;await delay(50);}throw new Error('Timed out waiting for observed event');}
const input=(sessionId:string,overrides:Partial<EventInput>={}):EventInput=>({eventId:randomUUID(),sessionId,agentId:'codex-main',timestamp:new Date().toISOString(),eventType:'file.modified',filePath:'src/Navbar.tsx',status:'completed',source:'agent-hook',confidence:'reported',metadata:{},...overrides});
const dom=()=>({id:randomUUID(),kind:'created',filePath:'src/Navbar.tsx',componentName:'Navbar',tag:'nav',text:'Navigation',rect:{x:10,y:20,width:400,height:70},viewport:{width:1000,height:800},capturedAt:new Date().toISOString(),mapping:'instrumented',hmrId:randomUUID()});

describe('ordered event collector',()=>{
  it('deduplicates, rejects unsafe paths and session confusion, redacts secrets and persists ordered events',async()=>{
    const folder=await mkdtemp(join(tmpdir(),'swarmwatch-store-'));cleanups.push(()=>rm(folder,{recursive:true,force:true}));
    const store=new EventStore(join(folder,'events.sqlite'));const sessionId='test-session';store.addSession({sessionId,projectName:'Test',previewUrl:'http://localhost:5173',startedAt:new Date().toISOString()});
    const collector=new Collector(store,sessionId);const event=input(sessionId,{metadata:{token:'do-not-store',message:'password=private'}});
    const saved=collector.emit(event)!;expect(saved.sequence).toBeGreaterThan(0);expect(collector.emit(event)).toBeUndefined();
    expect(collector.emit(input(sessionId,{filePath:'../secrets.json'}))).toBeUndefined();expect(collector.emit(input(sessionId,{filePath:'.env.local'}))).toBeUndefined();expect(collector.emit(input('wrong-session'))).toBeUndefined();
    collector.emit(input(sessionId));expect(store.events(sessionId,saved.sequence)).toHaveLength(1);expect(JSON.stringify(store.events(sessionId))).not.toContain('do-not-store');expect(JSON.stringify(store.events(sessionId))).not.toContain('private');
    store.close();const restored=new EventStore(join(folder,'events.sqlite'));expect(restored.events(sessionId)).toHaveLength(2);expect(restored.sessions()[0].sessionId).toBe(sessionId);restored.close();
  });
  it('animates measured DOM only after matching source changes, with honest attribution',()=>{
    const store=new EventStore(':memory:');cleanups.push(()=>store.close());const collector=new Collector(store,'session');
    expect(collector.dom(dom())).toBeUndefined();collector.file('file.created','src/Navbar.tsx');
    const observed=dom();const event=collector.dom(observed)!;expect(event.agentId).toBe('file-observer');expect(event.confidence).toBe('measured');expect(event.metadata.dom).toEqual(observed);expect(collector.dom(observed)).toBeUndefined();
    expect(collector.dom({...dom(),hmrId:undefined})).toBeUndefined();expect(collector.dom({...dom(),hmrId:' '})).toBeUndefined();
    collector.emit(input('session'));const agentEvent=collector.dom(dom())!;expect(agentEvent.agentId).toBe('codex-main');expect(agentEvent.eventType).toBe('component.detected');
    expect(collector.dom({...dom(),filePath:'src/Other.tsx'})).toBeUndefined();
    collector.file('file.modified','src/theme.css');const style=collector.dom({...dom(),kind:'style',filePath:'src/Other.tsx'})!;expect(style.eventType).toBe('style.changed');expect(style.metadata.mapping).toBe('inferred');expect(style.agentId).toBe('file-observer');
  });
  it('recovers HMR-before-watcher races without publishing unmatched DOM interactions',()=>{
    const store=new EventStore(':memory:');cleanups.push(()=>store.close());const published:SwarmEvent[]=[];const collector=new Collector(store,'session',event=>published.push(event));
    const change=dom();expect(collector.dom(change)).toBeUndefined();expect(published).toHaveLength(0);
    collector.file('file.created','src/Other.tsx');expect(published).toHaveLength(1);
    collector.file('file.created','src/Navbar.tsx');expect(published.map(event=>event.eventType)).toEqual(['file.created','file.created','component.detected']);expect(published.at(-1)?.timestamp).toBe(change.capturedAt);
    expect(collector.dom(change)).toBeUndefined();
  });
  it('uses newer CSS changes instead of a stale JSX source match for measured style differences',()=>{
    const store=new EventStore(':memory:');cleanups.push(()=>store.close());const collector=new Collector(store,'session');
    collector.emit(input('session',{timestamp:new Date(Date.now()-5000).toISOString()}));
    const css=collector.file('file.modified','src/theme.css')!;
    const style=collector.dom({...dom(),kind:'style'})!;
    expect(style.filePath).toBe('src/theme.css');expect(style.metadata.triggerEventId).toBe(css.eventId);expect(style.metadata.mapping).toBe('inferred');expect(style.agentId).toBe('file-observer');
    const reportedCss=collector.emit(input('session',{filePath:'src/theme.css',agentId:'css-worker'}))!;
    const reportedStyle=collector.dom({...dom(),kind:'style'})!;
    expect(reportedStyle.filePath).toBe('src/theme.css');expect(reportedStyle.agentId).toBe('css-worker');expect(reportedStyle.metadata.mapping).toBe('inferred');expect(reportedStyle.metadata.triggerEventId).toBe(reportedCss.eventId);
  });
});

describe('local server and watcher',()=>{
  async function fixture(){const project=await mkdtemp(join(tmpdir(),'swarmwatch-project-'));cleanups.push(()=>rm(project,{recursive:true,force:true}));await mkdir(join(project,'src'));await writeFile(join(project,'src','Initial.tsx'),'export default null');const server=await startServer({project,previewUrl:'http://127.0.0.1:5173',port:0});cleanups.push(()=>server.close());return {project,server,base:`http://127.0.0.1:${server.port}`};}
  it('observes create, modify and delete without reporting initial files or secret/symlink changes',async()=>{
    const {project,server,base}=await fixture();const events=async()=>((await (await fetch(base+'/api/state')).json())as {events:SwarmEvent[]}).events;
    await delay(200);expect(await events()).toHaveLength(0);
    await writeFile(join(project,'src','Navbar.tsx'),'export const Navbar = () => <nav/>');await eventually(events,e=>e.some(x=>x.eventType==='file.created'&&x.filePath==='src/Navbar.tsx'));
    await writeFile(join(project,'src','Navbar.tsx'),'export const Navbar = () => <nav>Changed</nav>');await eventually(events,e=>e.some(x=>x.eventType==='file.modified'&&x.filePath==='src/Navbar.tsx'));
    await writeFile(join(project,'.env.local'),'API_KEY=do-not-watch');await symlink('/etc',join(project,'outside'));await delay(250);expect((await events()).some(e=>e.filePath?.includes('.env')||e.filePath?.includes('outside'))).toBe(false);
    await rm(join(project,'src','Navbar.tsx'));await eventually(events,e=>e.some(x=>x.eventType==='file.deleted'));
    const response=await fetch(base+`/api/sessions/${server.sessionId}/export`);expect((await response.json()).historicalDom).toBe(false);
  });
  it('validates HTTP origin and websocket token; resumes after sequence across reconnect',async()=>{
    const {server,base}=await fixture();expect((await fetch(base+'/api/state',{headers:{Origin:'https://attacker.invalid'}})).status).toBe(403);expect((await fetch(base+'/api/state',{method:'POST'})).status).toBe(405);
    const state=await (await fetch(base+'/api/state')).json() as {token:string};
    await new Promise<void>((resolveTest,reject)=>{const denied=new WebSocket(base.replace('http:','ws:')+'/ws?token=wrong',{origin:base});denied.on('unexpected-response',(_req,res)=>{expect(res.statusCode).toBe(403);res.resume();resolveTest();});denied.on('error',reject);});
    const first=server.collector.emit(input(server.sessionId))!;const second=server.collector.emit(input(server.sessionId))!;
    const connect=()=>new WebSocket(base.replace('http:','ws:')+`/ws?token=${state.token}&sessionId=${server.sessionId}&after=${first.sequence}`,{origin:base});
    const client=connect();cleanups.push(()=>client.terminate());const received=await new Promise<{events:SwarmEvent[]}>((resolveTest,reject)=>{client.on('message',data=>resolveTest(JSON.parse(data.toString())));client.on('error',reject);});expect(received.events.map(e=>e.sequence)).toEqual([second.sequence]);client.close();
    const third=server.collector.emit(input(server.sessionId))!;
    const reconnected=new WebSocket(base.replace('http:','ws:')+`/ws?token=${state.token}&sessionId=${server.sessionId}&after=${second.sequence}`,{origin:base});cleanups.push(()=>reconnected.terminate());const resumed=await new Promise<{events:SwarmEvent[]}>((resolveTest,reject)=>{reconnected.on('message',data=>resolveTest(JSON.parse(data.toString())));reconnected.on('error',reject);});expect(resumed.events.map(e=>e.sequence)).toEqual([third.sequence]);
  });
  it('settles websocket DOM batches before attributing CSS HMR that beats the watcher',async()=>{
    const {server,base}=await fixture();
    const state=await (await fetch(base+'/api/state')).json() as {token:string};
    server.collector.emit(input(server.sessionId,{timestamp:new Date(Date.now()-5000).toISOString()}));
    const client=new WebSocket(base.replace('http:','ws:')+`/ws?token=${state.token}&sessionId=${server.sessionId}`,{origin:base});cleanups.push(()=>client.terminate());
    await new Promise<void>((resolveOpen,reject)=>{client.once('open',resolveOpen);client.once('error',reject);});
    client.send(JSON.stringify({type:'dom',changes:[{...dom(),kind:'style'}]}));
    await delay(100);
    const css=server.collector.file('file.modified','src/theme.css')!;
    const events=await eventually(async()=>((await (await fetch(base+'/api/state')).json()) as {events:SwarmEvent[]}).events,items=>items.some(event=>event.eventType==='style.changed'));
    const changed=events.find(event=>event.eventType==='style.changed')!;
    expect(changed.filePath).toBe('src/theme.css');expect(changed.metadata.triggerEventId).toBe(css.eventId);expect(changed.metadata.mapping).toBe('inferred');
  });
});
