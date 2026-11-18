import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer,Collector,EventStore} from '@swarmwatch/server';

const cleanups:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
const delta=()=>({id:randomUUID(),observation:'file-change',kind:'created',tag:'header',text:'A real element',rect:{x:10,y:20,width:400,height:60},viewport:{width:1000,height:800},capturedAt:new Date().toISOString(),mapping:'unknown'});

describe('framework-independent watch integration',()=>{
  it('runs without a preview, framework, agent identity or model API',async()=>{
    const project=await mkdtemp(join(tmpdir(),'swarmwatch-no-preview-'));cleanups.push(()=>rm(project,{recursive:true,force:true}));
    const server=await startServer({project,port:0});cleanups.push(()=>server.close());
    const state=await (await fetch(`http://127.0.0.1:${server.port}/api/state`)).json() as any;
    expect(state).toMatchObject({aiEnabled:false,observationMode:'watch',previewUrl:'',events:[]});
    const html=await fetch(`http://127.0.0.1:${server.port}/`);
    expect(html.headers.get('content-security-policy')).toContain("frame-src 'none'");
    const bridge=await fetch(`http://127.0.0.1:${server.port}/bridge.js`);
    expect(bridge.status).toBe(200);expect(bridge.headers.get('content-type')).toContain('javascript');expect(await bridge.text()).not.toContain('/@vite/client');
  });
  it('allows the bridge script for the specified preview origin while keeping APIs private',async()=>{
    const project=await mkdtemp(join(tmpdir(),'swarmwatch-generic-origin-'));cleanups.push(()=>rm(project,{recursive:true,force:true}));
    const server=await startServer({project,port:0,previewUrl:'http://127.0.0.1:5180'});cleanups.push(()=>server.close());
    const url=`http://127.0.0.1:${server.port}`;
    expect((await fetch(url+'/bridge.js',{headers:{Origin:'http://127.0.0.1:5180'}})).status).toBe(200);
    expect((await fetch(url+'/api/state',{headers:{Origin:'http://127.0.0.1:5180'}})).status).toBe(403);
    expect((await fetch(url+'/bridge.js',{headers:{Origin:'https://example.org'}})).status).toBe(403);
  });
  it('requires an actual file trigger for generic measured DOM and keeps unknown mapping inferred',()=>{
    const store=new EventStore(':memory:');cleanups.push(()=>store.close());const collector=new Collector(store,'s');
    expect(collector.dom({...delta(),triggerEventId:'invented'})).toBeUndefined();
    const file=collector.file('file.modified','page.html',{analysis:{engine:'local-diff',linesAdded:1,linesRemoved:0}})!;
    const change=delta();const event=collector.dom({...change,triggerEventId:file.eventId})!;
    expect(event).toMatchObject({agentId:'file-observer',source:'runtime',confidence:'measured',filePath:'page.html',metadata:{mapping:'inferred',triggerEventId:file.eventId}});
    expect(collector.dom({...change,triggerEventId:file.eventId})).toBeUndefined();
    expect(collector.dom({...delta(),triggerEventId:file.eventId,filePath:'unrelated.html',mapping:'instrumented'})).toBeUndefined();
    expect(collector.dom({...delta(),triggerEventId:file.eventId,capturedAt:new Date(Date.now()-10000).toISOString()})).toBeUndefined();
  });
});
