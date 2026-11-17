#!/usr/bin/env node
import {spawn, type ChildProcess} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {startServer} from '@swarmwatch/server';
import {parseCliArgs} from './options.js';

const help=`SwarmWatch — Watch your agents build a web application, live.

swarmwatch watch --project ./my-app
swarmwatch watch --project ./my-app --url http://localhost:5173
swarmwatch watch --project ./my-app -- npm run dev

  --port 4317               Dashboard port (loopback only)
  --url URL                 Optional local preview; file observation works without it
  --data-dir PATH           SQLite session directory
  --allow-agents            Explicit dev-mode opt-in; rejected by watch mode
  --codex PROMPT            Optional dev --allow-agents: runs Codex (may consume tokens)
  --opencode URL            Optional dev --allow-agents: subscribes to OpenCode
  --test-command COMMAND    Run an explicit local test command and record exit
  --build-command COMMAND   Run an explicit local build command and record exit
  --demo                    Label this session as a live example project

Watch mode uses deterministic local file analysis, never AI adapters or model APIs.
For generic DOM observation add /bridge.js to your app; Vite may use the plugin.
Commands after -- run inside --project and can have their own external costs.
SWARMWATCH_NO_AI=1 also blocks agent opt-in in dev mode.
Requires Node.js >=24. See README.md for bridge setup and limitations.`;

async function main(){
 const argv=process.argv.slice(2);
 if(argv.includes('--help')||argv.length===0){console.log(help);return;}
 const {values,command,port,previewUrl,aiEnabled}=parseCliArgs(argv,process.env.SWARMWATCH_NO_AI==='1');
 const project=await realpath(resolve(values.project!));
 if(!(await stat(project)).isDirectory())throw new Error('Project must be a directory');
 const server=await startServer({project,previewUrl,port,dataDir:values['data-dir']?resolve(values['data-dir']):undefined,demo:values.demo,aiEnabled});
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
   const {createCodexAdapter}=await import('./adapters.js');
   const adapter=createCodexAdapter(ctx);
   const child=run('codex',['exec','--json',values.codex],'pipe');
   const lines=createInterface({input:child.stdout!});
   lines.on('line',line=>{try{adapter.ingest(JSON.parse(line));}catch{/* non-JSON never becomes a made-up event */}});
   child.stderr?.pipe(process.stderr);child.once('exit',()=>adapter.finish());
 }
 if(values.opencode){const {connectOpenCode}=await import('./adapters.js');void connectOpenCode(values.opencode,ctx,controller.signal,process.env.OPENCODE_SERVER_USERNAME,process.env.OPENCODE_SERVER_PASSWORD).catch(error=>{if(!controller.signal.aborted)console.error(`OpenCode: ${error.message}`);});}
 async function check(kind:'test'|'build',command:string){
   const emit=(eventType:'test.started'|'test.passed'|'test.failed'|'build.started'|'build.completed'|'error.detected',status:string,exitCode?:number|null)=>ctx.emit({eventId:randomUUID(),sessionId:server.sessionId,agentId:'local-check',timestamp:new Date().toISOString(),eventType,status,source:'runtime',confidence:'reported',metadata:{kind,exitCode,reason:'Explicit user-supplied local check; process exit observed'}});
   emit(`${kind}.started`,'running');
   const child=run(command,[],'inherit',true);
   child.once('exit',code=>emit(kind==='test'?(code===0?'test.passed':'test.failed'):(code===0?'build.completed':'error.detected'),code===0?'passed':'failed',code));
 }
 if(values['test-command'])await check('test',values['test-command']);
 if(values['build-command'])await check('build',values['build-command']);
 console.log(`\nSwarmWatch  ${server.url}\nProject     ${project}\nPreview     ${previewUrl??'Not connected (file observation only)'}\nSession     ${server.sessionId}\nMode        ${aiEnabled?'Explicit agent opt-in + file observation':'LOCAL WATCH · No AI calls by SwarmWatch'}\nBridge      Add <script src="http://127.0.0.1:${server.port}/bridge.js"></script> to a non-Vite app for measured DOM changes.\nCtrl+C to stop owned processes.\n`);
}
main().catch(error=>{console.error(`SwarmWatch: ${error.message}`);process.exitCode=1;});
