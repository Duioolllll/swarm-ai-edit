import chokidar from 'chokidar';
import {lstat,realpath} from 'node:fs/promises';
import {relative,resolve,sep} from 'node:path';
import {isSensitivePath,safeRelativePath} from '@swarmwatch/core';
import type {Collector} from './collector.js';

export async function watchProject(project:string,collector:Collector){
  const root=await realpath(project);const known=new Set<string>();
  const inside=(path:string)=>path===root||path.startsWith(root+sep);
  const watcher=chokidar.watch(root,{ignoreInitial:false,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:100,pollInterval:25},ignored:(path)=>isSensitivePath(relative(root,path))});
  let ready=false,closed=false;
  const handle=async(kind:'add'|'change'|'unlink',absolute:string)=>{
    const wasReady=ready;
    const path=relative(root,absolute).split(sep).join('/');
    if(!safeRelativePath(path)||!/\.(?:[cm]?[jt]sx?|css|scss|sass|less|html|json|svg|png|jpe?g|webp|gif)$/.test(path))return;
    if(kind==='unlink') {if(ready&&known.delete(path))collector.file('file.deleted',path);return;}
    try{
      if(!inside(await realpath(absolute))||(await lstat(absolute)).isSymbolicLink())return;
      known.add(path);
      if(wasReady&&!closed)collector.file(kind==='add'?'file.created':'file.modified',path);
    }catch{} // disappeared between fs notification and stat
  };
  watcher.on('add',p=>void handle('add',p)).on('change',p=>void handle('change',p)).on('unlink',p=>void handle('unlink',p));
  await new Promise<void>((resolveReady,reject)=>{watcher.once('ready',()=>{ready=true;resolveReady();});watcher.once('error',reject);});
  watcher.on('error',()=>collector.emit({eventId:crypto.randomUUID(),sessionId:collector.sessionId,agentId:'file-observer',timestamp:new Date().toISOString(),eventType:'error.detected',status:'watcher-error',source:'runtime',confidence:'reported',metadata:{message:'Filesystem watcher reported an error.'}}));
  return {async close(){closed=true;await watcher.close();}};
}
