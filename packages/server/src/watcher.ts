import chokidar from 'chokidar';
import {realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {relative,sep} from 'node:path';
import {isSensitivePath,safeRelativePath} from '@swarmwatch/core';
import type {Collector} from './collector.js';
import {LocalChangeAnalyzer,readBoundedSnapshot,supportedFileInfo} from './analyzer.js';

export async function watchProject(project:string,collector:Collector){
  const root=await realpath(project);const analyzer=new LocalChangeAnalyzer();
  const watcher=chokidar.watch(root,{ignoreInitial:false,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:100,pollInterval:25},ignored:(path)=>isSensitivePath(relative(root,path))});
  let ready=false,closed=false,pumping=false,reportedOverflow=false;
  const pending=new Map<string,{kind:'add'|'change'|'unlink';baseline:boolean}>();
  const waiters:(()=>void)[]=[];
  const reportError=(status:string,message:string)=>{if(!closed)collector.emit({eventId:randomUUID(),sessionId:collector.sessionId,agentId:'file-observer',timestamp:new Date().toISOString(),eventType:'error.detected',status,source:'runtime',confidence:'reported',metadata:{message}});};
  const handle=async(absolute:string,kind:'add'|'change'|'unlink',baseline:boolean)=>{
    const path=relative(root,absolute).split(sep).join('/');
    if(!safeRelativePath(path)||!supportedFileInfo(path)||closed)return;
    try{
      if(kind==='unlink'){
        if(!analyzer.has(path))return;
        const analysis=analyzer.observe(path,undefined,'deleted');
        if(!baseline&&!closed&&analysis)collector.file('file.deleted',path,{analysis});return;
      }
      const snapshot=await readBoundedSnapshot(absolute,root,analyzer.maxFileBytes);
      if(closed)return;
      const analysis=analyzer.observe(path,snapshot,baseline?'baseline':kind==='add'?'created':'modified');
      if(analysis)collector.file(kind==='add'?'file.created':'file.modified',path,{analysis});
    }catch{} // disappeared or ceased to be an allowed regular file between notification and read
  };
  const pump=async()=>{
    if(pumping)return;pumping=true;
    try{while(pending.size&&!closed){const [path,job]=pending.entries().next().value!;pending.delete(path);await handle(path,job.kind,job.baseline);}}
    finally{pumping=false;for(const resolve of waiters.splice(0))resolve();}
  };
  const enqueue=(kind:'add'|'change'|'unlink',path:string)=>{
    if(closed)return;
    const relativePath=relative(root,path).split(sep).join('/');
    if(!safeRelativePath(relativePath)||!supportedFileInfo(relativePath))return;
    if(pending.size>=2000&&!pending.has(path)){
      if(ready&&!reportedOverflow){reportedOverflow=true;reportError('watcher-backpressure','Local file-analysis queue reached its 2000-file bound; some changes were skipped.');}return;
    }
    const previous=pending.get(path);
    pending.set(path,{kind:previous?.kind==='add'&&kind==='change'?'add':kind,baseline:previous?.baseline??!ready});void pump();
  };
  watcher.on('add',p=>enqueue('add',p)).on('change',p=>enqueue('change',p)).on('unlink',p=>enqueue('unlink',p));
  await new Promise<void>((resolveReady,reject)=>{watcher.once('ready',resolveReady);watcher.once('error',reject);});
  if(pumping)await new Promise<void>(resolve=>waiters.push(resolve));ready=true;
  watcher.on('error',()=>reportError('watcher-error','Filesystem watcher reported an error.'));
  return {async close(){closed=true;pending.clear();await watcher.close();if(pumping)await new Promise<void>(resolve=>waiters.push(resolve));analyzer.clear();}};
}
