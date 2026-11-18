import {describe,it,expect} from 'vitest';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCliArgs} from './options.js';

describe('local watch / no AI boundary',()=>{
  it('observes files without requiring a framework or preview server',()=>{
    const args=parseCliArgs(['watch','--project','./vue-app']);
    expect(args.aiEnabled).toBe(false);expect(args.previewUrl).toBeUndefined();expect(args.command).toEqual([]);
    expect(parseCliArgs(['watch','--project','./app','--','npm','run','dev']).command).toEqual(['npm','run','dev']);
  });
  it('rejects all AI adapter flags in watch mode before any project operation',()=>{
    for(const flag of [['--codex','a prompt'],['--opencode','http://localhost:4096'],['--allow-agents']]){
      expect(()=>parseCliArgs(['watch','--project','./app',...flag])).toThrow('AI adapters are disabled');
    }
    expect(()=>parseCliArgs(['dev','--project','./app','--codex','prompt'])).toThrow('explicit --allow-agents');
    expect(parseCliArgs(['dev','--allow-agents','--project','./app','--codex','prompt']).aiEnabled).toBe(true);
    expect(()=>parseCliArgs(['dev','--allow-agents','--project','./app','--codex','prompt'],true)).toThrow('AI adapters are disabled');
  });
  it('the actual CLI refuses adapter execution even for a nonexistent project',()=>{
    const cli=fileURLToPath(new URL('../dist/index.js',import.meta.url));
    const result=spawnSync(process.execPath,[cli,'watch','--project','/definitely-not-a-project','--codex','do not run'],{encoding:'utf8'});
    expect(result.status).toBe(1);expect(result.stderr).toContain('AI adapters are disabled');expect(result.stderr).not.toContain('ENOENT');
  });
});

it.skipIf(process.platform==='win32')('starts Codex JSONL collection when Codex waits for stdin EOF',async()=>{
  const project=await mkdtemp(join(tmpdir(),'swarmwatch-codex-cli-'));
  try{
    // The fake Codex reads stdin just as the real CLI does with a positional prompt.
    await writeFile(join(project,'codex'),`#!/bin/sh
/bin/cat >/dev/null
printf '%s\\n' '{"type":"thread.started","thread_id":"fixture"}'
`,{mode:0o755});
    const reservation=createServer();
    reservation.listen(0,'127.0.0.1');
    await once(reservation,'listening');
    const port=(reservation.address() as {port:number}).port;
    await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
    const cli=fileURLToPath(new URL('../dist/index.js',import.meta.url));
    const child=spawn(process.execPath,[cli,'dev','--allow-agents','--project',project,'--port',String(port),'--codex','fixture'],{
      env:{...process.env,PATH:project,SWARMWATCH_NO_AI:'0'},
      stdio:'ignore',
    });
    try{
      await expect.poll(async()=>{
        try{
          const response=await fetch(`http://127.0.0.1:${port}/api/state`,{signal:AbortSignal.timeout(500)});
          return response.ok?await response.json():undefined;
        }catch{return undefined;}
      },{timeout:5000}).toMatchObject({events:expect.arrayContaining([
        expect.objectContaining({eventType:'agent.started',metadata:{adapter:'codex',transport:'exec-jsonl'}}),
      ])});
    }finally{
      if(child.exitCode===null&&child.signalCode===null){
        const exited=once(child,'exit');
        child.kill('SIGTERM');
        await exited;
      }
    }
  }finally{await rm(project,{recursive:true,force:true});}
});
