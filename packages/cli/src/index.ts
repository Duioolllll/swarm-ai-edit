#!/usr/bin/env node
import {spawn, type ChildProcess} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {startServer} from '@swarmwatch/server';
import {createCodexAdapter,connectOpenCode} from './adapters.js';

const help=`SwarmWatch — Watch your agents build a web application, live.

swarmwatch dev --project ./my-app -- npm run dev
swarmwatch dev --project ./my-app --url http://localhost:5173

  --port 4317               Dashboard port (loopback only)
  --url URL                 Existing or spawned preview URL (default :5173)
  --data-dir PATH           SQLite session directory
  --codex PROMPT            Run codex exec --json with this prompt
  --opencode URL            Subscribe to an existing OpenCode v1 local server
  --test-command COMMAND    Run an explicit local test command and record exit
  --build-command COMMAND   Run an explicit local build command and record exit
  --demo                    Label this session as a live example project

Install @swarmwatch/vite-plugin in the preview app for DOM visualization.
Commands after -- run inside --project. No agent is fabricated in file mode.
Requires Node.js >=24. See README.md for bridge setup and limitations.`;

async function main(){
 const argv=process.argv.slice(2);
 if(argv.includes('--help')||argv.length===0){console.log(help);return;}
 if(argv[0]!=='dev')throw new Error('Expected dev. Use --help for usage.');
 const split=argv.indexOf('--');
 const command=split<0?[]:argv.slice(split+1);
 const {values}=parseArgs({args:argv.slice(1,split<0?undefined:split),options:{project:{type:'string'},url:{type:'string'},port:{type:'string'},'data-dir':{type:'string'},codex:{type:'string'},opencode:{type:'string'},'test-command':{type:'string'},'build-command':{type:'string'},demo:{type:'boolean'}}});
 if(!values.project)throw new Error('--project is required');
 const project=await realpath(resolve(values.project));
 if(!(await stat(project)).isDirectory())throw new Error('Project must be a directory');
 const previewUrl=values.url??'http://127.0.0.1:5173';
 const parsed=new URL(previewUrl);
 if(parsed.protocol!=='http:'||!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.username||parsed.password)throw new Error('Preview URL must be a credential-free local HTTP URL');
 const port=Number(values.port??4317);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid dashboard port');
 const server=await startServer({project,previewUrl,port,dataDir:values['data-dir']?resolve(values['data-dir']):undefined,demo:values.demo});
 const ctx={project,sessionId:server.sessionId,emit:server.collector.emit.bind(server.collector)};
 const children:ChildProcess[]=[];
 const controller=new AbortController();
 let closing=false;
 async function stop(){if(closing)return;closing=true;controller.abort();for(const child of children){if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}}await server.close();}
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().finally(()=>process.exit(0));});
 const env={...process.env,SWARMWATCH_DASHBOARD_ORIGIN:`http://127.0.0.1:${server.port}`};
 function run(exe:string,args:string[],stdio:'inherit'|'pipe'='inherit',shell=false){
   const child=spawn(exe,args,{cwd:project,env,stdio,detached:true,shell});children.push(child);
   child.on('error',error=>{ctx.emit({eventId:randomUUID(),sessionId:server.sessionId,agentId:'local-runtime',timestamp:new Date().toISOString(),eventType:'error.detected',status:'failed',source:'runtime',confidence:'reported',metadata:{message:error.message}});console.error(`Could not start ${exe}: ${error.message}`);});
   return child;
 }
 if(command.length){const child=run(command[0]!,command.slice(1));child.once('exit',(code)=>{console.log(`Preview process exited (${code??'signal'}); dashboard remains available for replay.`);});}
 if(values.codex){
   const adapter=createCodexAdapter(ctx);
   const child=run('codex',['exec','--json',values.codex],'pipe');
   const lines=createInterface({input:child.stdout!});
   lines.on('line',line=>{try{adapter.ingest(JSON.parse(line));}catch{/* non-JSON never becomes a made-up event */}});
   child.stderr?.pipe(process.stderr);child.once('exit',()=>adapter.finish());
 }
 if(values.opencode){void connectOpenCode(values.opencode,ctx,controller.signal,process.env.OPENCODE_SERVER_USERNAME,process.env.OPENCODE_SERVER_PASSWORD).catch(error=>{if(!controller.signal.aborted)console.error(`OpenCode: ${error.message}`);});}
 async function check(kind:'test'|'build',command:string){
   const emit=(eventType:'test.started'|'test.passed'|'test.failed'|'build.started'|'build.completed'|'error.detected',status:string,exitCode?:number|null)=>ctx.emit({eventId:randomUUID(),sessionId:server.sessionId,agentId:'local-check',timestamp:new Date().toISOString(),eventType,status,source:'runtime',confidence:'reported',metadata:{kind,exitCode,reason:'Explicit user-supplied local check; process exit observed'}});
   emit(`${kind}.started`,'running');
   const child=run(command,[],'inherit',true);
   child.once('exit',code=>emit(kind==='test'?(code===0?'test.passed':'test.failed'):(code===0?'build.completed':'error.detected'),code===0?'passed':'failed',code));
 }
 if(values['test-command'])await check('test',values['test-command']);
 if(values['build-command'])await check('build',values['build-command']);
 console.log(`\nSwarmWatch  ${server.url}\nProject     ${project}\nPreview     ${previewUrl}\nSession     ${server.sessionId}\nMode        ${values.codex||values.opencode?'Agent + file observation':'File observation (inferred work)'}\nCtrl+C to stop owned processes.\n`);
}
main().catch(error=>{console.error(`SwarmWatch: ${error.message}`);process.exitCode=1;});
