import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalChangeAnalyzer,readBoundedSnapshot,supportedFileInfo} from './analyzer.js';
import {watchProject} from './watcher.js';
import {Collector} from './collector.js';
import {EventStore} from './store.js';
import type {SwarmEvent} from '@swarmwatch/core';

const cleanups:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const snapshot=(text:string)=>({bytes:Buffer.byteLength(text),content:Buffer.from(text)});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(read:()=>SwarmEvent[],predicate:(events:SwarmEvent[])=>boolean){const started=Date.now();while(Date.now()-started<5000){const value=read();if(predicate(value))return value;await delay(40);}throw new Error('Expected observed file event did not arrive');}

describe('local deterministic change analyzer',()=>{
  it('supports framework-independent source types without guessing component identity',()=>{
    for(const extension of ['vue','svelte','astro','html','htm','css','scss','sass','less','styl','pcss','js','jsx','ts','tsx','mjs','cjs','mts','cts','md','mdx','php','ejs','hbs','njk','twig','erb','py','pyi','rb','go','java','kt','kts','cs','fs','fsx','rs','ex','exs','dart','eex','heex','leex','razor','cshtml','xml','toml','graphql','gql']){
      expect(supportedFileInfo('src/view.'+extension)).toMatchObject({language:extension});
    }
    for(const extension of ['py','pyi','rb','go','java','kt','kts','cs','fs','fsx','rs','ex','exs','dart'])expect(supportedFileInfo('server/handler.'+extension)?.kind).toBe('script');
    for(const extension of ['eex','heex','leex','razor','cshtml'])expect(supportedFileInfo('views/index.'+extension)?.kind).toBe('template');
    for(const extension of ['xml','toml','graphql','gql'])expect(supportedFileInfo('data/schema.'+extension)?.kind).toBe('data');
    expect(supportedFileInfo('secrets.toml')).toBeUndefined();expect(supportedFileInfo('credentials.py')).toBeUndefined();
    expect(supportedFileInfo('.env.json')).toBeUndefined();expect(supportedFileInfo('../secret.vue')).toBeUndefined();expect(supportedFileInfo('unknown.exe')).toBeUndefined();
  });
  it('counts minimal changed lines, suppresses identical writes, tracks creates/deletes and never emits source or identifiers',()=>{
    const analyzer=new LocalChangeAnalyzer();const before='same\nprivateApiKey = "do-not-emit"\nshared\nremoved\n';const after='same\nprivateApiKey = "changed-private-value"\nshared\nadded-one\nadded-two\n';
    expect(analyzer.observe('src/View.vue',snapshot(before),'baseline')).toBeUndefined();
    expect(analyzer.observe('src/View.vue',snapshot(before),'modified')).toBeUndefined();
    const change=analyzer.observe('src/View.vue',snapshot(after),'modified')!;
    expect(change).toMatchObject({engine:'local-diff',kind:'template',bytesBefore:Buffer.byteLength(before),bytesAfter:Buffer.byteLength(after),linesAdded:3,linesRemoved:2,counting:'exact-line-diff'});
    const serialized=JSON.stringify(change);expect(serialized).not.toMatch(/privateApiKey|private-value|do-not-emit|shared|component|sha256/);
    expect(analyzer.observe('src/View.vue',undefined,'deleted')).toMatchObject({bytesAfter:0,linesAdded:0,linesRemoved:5,counting:'exact-line-diff'});
    expect(analyzer.observe('src/Plain.html',snapshot('<main>Created</main>\n'),'created')).toMatchObject({bytesBefore:0,linesAdded:1,linesRemoved:0,kind:'markup'});
  });
  it('retains unchanged interior lines rather than treating every replaced region as changed',()=>{
    const analyzer=new LocalChangeAnalyzer();analyzer.observe('src/state.js',snapshot('a\nkeep\nb\n'),'baseline');
    expect(analyzer.observe('src/state.js',snapshot('x\nkeep\ny\n'),'modified')).toMatchObject({linesAdded:2,linesRemoved:2,counting:'exact-line-diff'});
  });
  it('bounds snapshots, file sizes and diff CPU with explicit unavailable/fallback counts',()=>{
    const analyzer=new LocalChangeAnalyzer({maxFileBytes:32,maxSnapshotBytes:8,maxEntries:2,maxDiffCells:4});
    analyzer.observe('a.html',snapshot('first\n'),'baseline');analyzer.observe('b.html',snapshot('other\n'),'baseline');
    expect(analyzer.usage.snapshotBytes).toBeLessThanOrEqual(8);
    expect(analyzer.observe('a.html',snapshot('new\n'),'modified')).toMatchObject({counting:'unavailable',linesAdded:null,linesRemoved:null,truncation:'snapshot-budget'});
    analyzer.observe('c.html',snapshot('more\n'),'baseline');expect(analyzer.usage.entries).toBeLessThanOrEqual(2);expect(analyzer.usage.snapshotBytes).toBeLessThanOrEqual(8);
    expect(analyzer.observe('large.html',snapshot('x'.repeat(100)),'created')).toMatchObject({bytesAfter:100,counting:'unavailable',truncation:'file-limit'});
    const boundedDiff=new LocalChangeAnalyzer({maxDiffCells:4});boundedDiff.observe('src/a.html',snapshot('one\ntwo\nthree\n'),'baseline');expect(boundedDiff.observe('src/a.html',snapshot('four\nfive\nsix\n'),'modified')).toMatchObject({linesAdded:3,linesRemoved:3,counting:'whole-file-replacement',truncation:'diff-work-limit'});
    analyzer.clear();expect(analyzer.usage).toEqual({snapshotBytes:0,entries:0});
  });
  it('reads only bounded regular project files; rejects symlink escape and treats binary as non-text',async()=>{
    const project=await mkdtemp(join(tmpdir(),'swarmwatch-analyzer-'));cleanups.push(()=>rm(project,{recursive:true,force:true}));
    await writeFile(join(project,'large.vue'),'secret'.repeat(1000));expect(await readBoundedSnapshot(join(project,'large.vue'),project,32)).toEqual({bytes:6000,unavailable:'file-limit'});
    await symlink('/etc/passwd',join(project,'escape.vue'));await expect(readBoundedSnapshot(join(project,'escape.vue'),project)).rejects.toThrow();
    await writeFile(join(project,'binary.js'),Buffer.from([0,1,2]));const binary=await readBoundedSnapshot(join(project,'binary.js'),project);const analyzer=new LocalChangeAnalyzer();expect(analyzer.observe('binary.js',binary,'created')).toMatchObject({counting:'unavailable',truncation:'binary'});expect(analyzer.observe('binary.js',binary,'modified')).toBeUndefined();
  });
});

describe('framework-independent watcher',()=>{
  it('observes Vue/Svelte/HTML lifecycle with local summaries, unchanged-write dedup and no secret payloads',async()=>{
    const project=await mkdtemp(join(tmpdir(),'swarmwatch-frameworks-'));cleanups.push(()=>rm(project,{recursive:true,force:true}));await mkdir(join(project,'src'));
    await writeFile(join(project,'src','Existing.vue'),'<template>Initial baseline</template>\n');
    const store=new EventStore(':memory:');cleanups.push(()=>store.close());const events:SwarmEvent[]=[];const collector=new Collector(store,'session',event=>events.push(event));
    const watcher=await watchProject(project,collector);cleanups.push(()=>watcher.close());expect(events).toHaveLength(0);
    for(const extension of ['vue','svelte','html']){
      const file='src/Page.'+extension;const absolute=join(project,file);const original='<main>raw-api-identifier sk-do-not-emit-secret</main>\n';
      await writeFile(absolute,original);await waitFor(()=>events,items=>items.some(event=>event.filePath===file&&event.eventType==='file.created'));
      const count=events.filter(event=>event.filePath===file).length;await writeFile(absolute,original);await delay(250);expect(events.filter(event=>event.filePath===file)).toHaveLength(count);
      await writeFile(absolute,'<main>changed-secret-value</main>\n');await waitFor(()=>events,items=>items.some(event=>event.filePath===file&&event.eventType==='file.modified'));
      await rm(absolute);await waitFor(()=>events,items=>items.some(event=>event.filePath===file&&event.eventType==='file.deleted'));
    }
    await writeFile(join(project,'.env.json'),'never-record-this');await symlink('/etc',join(project,'outside'));await delay(200);
    const encoded=JSON.stringify(events);expect(encoded).not.toMatch(/raw-api-identifier|sk-do-not-emit-secret|changed-secret-value|never-record-this|Initial baseline/);
    expect(events.every(event=>event.filePath?.startsWith('src/')&&event.componentName===undefined&&event.metadata.analysis)).toBe(true);
    expect(events.find(event=>event.eventType==='file.modified')?.metadata.analysis).toMatchObject({engine:'local-diff',linesAdded:1,linesRemoved:1,counting:'exact-line-diff'});
  });
});
