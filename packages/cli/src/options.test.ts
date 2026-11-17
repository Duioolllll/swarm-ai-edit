import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
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
