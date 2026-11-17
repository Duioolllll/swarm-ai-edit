import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {extname,sep} from 'node:path';
import {safeRelativePath} from '@swarmwatch/core';

export type FileKind='markup'|'style'|'script'|'data'|'asset'|'template'|'unknown';
export type Analysis={engine:'local-diff';language:string;kind:FileKind;bytesBefore:number|null;bytesAfter:number;linesAdded:number|null;linesRemoved:number|null;counting:'exact-line-diff'|'whole-file-replacement'|'unavailable';truncation?:'file-limit'|'snapshot-budget'|'binary'|'missing-baseline'|'diff-work-limit'};
type FileInfo={language:string;kind:FileKind};
export function supportedFileInfo(path:string):FileInfo|undefined{
  if(!safeRelativePath(path))return;
  const ext=extname(path).toLowerCase().slice(1);
  if(/^[cm]?[jt]sx?$/.test(ext)||['py','pyi','rb','go','java','kt','kts','cs','fs','fsx','rs','ex','exs','dart'].includes(ext))return {language:ext,kind:'script'};
  if(['html','htm','xhtml','md','markdown','mdx'].includes(ext))return {language:ext,kind:'markup'};
  if(['css','scss','sass','less','styl','stylus','pcss','postcss'].includes(ext))return {language:ext,kind:'style'};
  if(['vue','svelte','astro','php','ejs','hbs','handlebars','njk','nunjucks','twig','erb','eex','heex','leex','razor','cshtml'].includes(ext))return {language:ext,kind:'template'};
  if(['json','jsonc','yaml','yml','xml','toml','graphql','gql'].includes(ext))return {language:ext,kind:'data'};
  if(['svg','png','jpg','jpeg','webp','gif','avif','ico'].includes(ext))return {language:ext,kind:'asset'};
}
export type FileSnapshot={bytes:number;content?:Buffer;unavailable?:'file-limit'|'binary'};
/** Read one small regular file; reject final symlinks and paths escaping the allowed root. */
export async function readBoundedSnapshot(path:string,root:string,maxBytes=256*1024):Promise<FileSnapshot>{
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const descriptor=await handle.stat();const current=await lstat(path);const canonical=await realpath(path);
    if(!descriptor.isFile()||current.isSymbolicLink()||descriptor.ino!==current.ino||descriptor.dev!==current.dev||!canonical.startsWith(root+sep))throw new Error('File escaped project confinement');
    if(descriptor.size>maxBytes)return {bytes:descriptor.size,unavailable:'file-limit'};
    const buffer=Buffer.allocUnsafe(maxBytes+1);
    let bytesRead=0;
    while(bytesRead<buffer.length){const result=await handle.read(buffer,bytesRead,buffer.length-bytesRead,bytesRead);if(!result.bytesRead)break;bytesRead+=result.bytesRead;}
    if(bytesRead>maxBytes)return {bytes:Math.max(descriptor.size,bytesRead),unavailable:'file-limit'};
    const content=Buffer.from(buffer.subarray(0,bytesRead));
    if(content.includes(0))return {bytes:bytesRead,content,unavailable:'binary'};
    try{new TextDecoder('utf-8',{fatal:true}).decode(content);}catch{return {bytes:bytesRead,content,unavailable:'binary'};}
    return {bytes:bytesRead,content};
  }finally{await handle.close();}
}
type Stored={bytes:number;hash?:string;content?:Buffer;unavailable?:FileSnapshot['unavailable']|'snapshot-budget'};
const lines=(text:string)=>text.match(/[^\n]*\n|[^\n]+$/g)??[];

/** Minimal insert/delete line counts with a deterministic CPU bound; no source leaves this module. */
function lineCounts(before:Buffer,after:Buffer,maxCells:number){
  const oldLines=lines(before.toString('utf8')),newLines=lines(after.toString('utf8'));
  let prefix=0;while(prefix<oldLines.length&&prefix<newLines.length&&oldLines[prefix]===newLines[prefix])prefix++;
  let oldEnd=oldLines.length,newEnd=newLines.length;
  while(oldEnd>prefix&&newEnd>prefix&&oldLines[oldEnd-1]===newLines[newEnd-1]){oldEnd--;newEnd--;}
  const removed=oldEnd-prefix,added=newEnd-prefix;
  if(removed*added>maxCells)return {linesAdded:newLines.length,linesRemoved:oldLines.length,counting:'whole-file-replacement' as const,truncation:'diff-work-limit' as const};
  const row=new Uint32Array(added+1);
  for(let i=prefix;i<oldEnd;i++){
    let diagonal=0;
    for(let j=1;j<=added;j++){const above=row[j];row[j]=oldLines[i]===newLines[prefix+j-1]?diagonal+1:Math.max(row[j],row[j-1]);diagonal=above;}
  }
  const common=row[added];return {linesAdded:added-common,linesRemoved:removed-common,counting:'exact-line-diff' as const};
}

/** Framework-independent, deterministic local summaries. Never emits content, identifiers or hashes. */
export class LocalChangeAnalyzer{
  private snapshots=new Map<string,Stored>();private retainedBytes=0;
  readonly maxFileBytes:number;readonly maxSnapshotBytes:number;readonly maxEntries:number;readonly maxDiffCells:number;
  constructor(options:{maxFileBytes?:number;maxSnapshotBytes?:number;maxEntries?:number;maxDiffCells?:number}={}){
    this.maxFileBytes=options.maxFileBytes??256*1024;this.maxSnapshotBytes=options.maxSnapshotBytes??16*1024*1024;this.maxEntries=options.maxEntries??10000;this.maxDiffCells=options.maxDiffCells??1000000;
  }
  get usage(){return {snapshotBytes:this.retainedBytes,entries:this.snapshots.size};}
  has(path:string){return this.snapshots.has(path);}
  observe(path:string,snapshot:FileSnapshot|undefined,operation:'baseline'|'created'|'modified'|'deleted'):Analysis|undefined{
    const info=supportedFileInfo(path);if(!info)return;
    const previous=this.snapshots.get(path);
    if(operation==='deleted'){
      this.remove(path);
      return {...info,engine:'local-diff',bytesBefore:previous?.bytes??null,bytesAfter:0,linesAdded:previous?.content?0:null,linesRemoved:previous?.content?lines(previous.content.toString('utf8')).length:null,counting:previous?.content?'exact-line-diff':'unavailable',...(!previous?.content?{truncation:previous?.unavailable??'missing-baseline' as const}:{})};
    }
    if(!snapshot)return;
    const validContent=snapshot.content&&snapshot.content.byteLength<=this.maxFileBytes?snapshot.content:undefined;
    const hash=validContent?createHash('sha256').update(validContent).digest('hex'):undefined;
    const same=previous&&hash&&hash===previous.hash;
    // Assets need byte/hash evidence only. Never decode them or count SVG markup as source.
    const content=info.kind==='asset'||snapshot.unavailable==='binary'?undefined:validContent;
    const next:Stored={bytes:snapshot.bytes,hash,content,unavailable:snapshot.unavailable??(!validContent?'file-limit':info.kind==='asset'?'binary':undefined)};
    let result:Analysis|undefined;
    if(operation!=='baseline'&&!same){
      const before=operation==='created'?Buffer.alloc(0):previous?.content;
      result={...info,engine:'local-diff',bytesBefore:operation==='created'?0:previous?.bytes??null,bytesAfter:snapshot.bytes,linesAdded:null,linesRemoved:null,counting:'unavailable'};
      if(before&&content)Object.assign(result,lineCounts(before,content,this.maxDiffCells));
      else result.truncation=next.unavailable??previous?.unavailable??'missing-baseline';
    }
    this.remove(path);
    if(next.content&&next.content.length>this.maxSnapshotBytes){next.content=undefined;next.unavailable='snapshot-budget';}
    while(next.content&&this.retainedBytes+next.content.length>this.maxSnapshotBytes){
      const victim=[...this.snapshots.values()].find(entry=>entry.content);
      if(!victim)break;this.retainedBytes-=victim.content!.length;victim.content=undefined;victim.unavailable='snapshot-budget';
    }
    this.snapshots.set(path,next);this.retainedBytes+=next.content?.length??0;
    while(this.snapshots.size>this.maxEntries)this.remove(this.snapshots.keys().next().value!);
    return result;
  }
  private remove(path:string){const previous=this.snapshots.get(path);if(previous)this.retainedBytes-=previous.content?.length??0;this.snapshots.delete(path);}
  clear(){this.snapshots.clear();this.retainedBytes=0;}
}
