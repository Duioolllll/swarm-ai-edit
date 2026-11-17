import {parseArgs} from 'node:util';

/** Validate the no-AI boundary before starting servers, processes, or adapters. */
export function parseCliArgs(argv:string[], noAi=false){
  const mode=argv[0];
  if(mode!=='watch'&&mode!=='dev')throw new Error('Expected watch or dev. Use --help for usage.');
  const split=argv.indexOf('--');
  const command=split<0?[]:argv.slice(split+1);
  const {values}=parseArgs({args:argv.slice(1,split<0?undefined:split),options:{project:{type:'string'},url:{type:'string'},port:{type:'string'},'data-dir':{type:'string'},codex:{type:'string'},opencode:{type:'string'},'test-command':{type:'string'},'build-command':{type:'string'},demo:{type:'boolean'},'allow-agents':{type:'boolean'}}});
  if((mode==='watch'||noAi)&&(values.codex!==undefined||values.opencode!==undefined||values['allow-agents']))throw new Error('AI adapters are disabled in watch / SWARMWATCH_NO_AI mode. No agent was started.');
  const aiEnabled=values.codex!==undefined||values.opencode!==undefined;
  if(aiEnabled&&!values['allow-agents'])throw new Error('Agent execution requires explicit --allow-agents in dev mode. Use watch for local file observation without AI calls.');
  if(!values.project)throw new Error('--project is required');
  const port=Number(values.port??4317);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid dashboard port');
  const previewUrl=values.url??(command.length?'http://127.0.0.1:5173':undefined);
  if(previewUrl){const url=new URL(previewUrl);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password)throw new Error('Preview URL must be a credential-free local HTTP URL');}
  return {mode,values,command,port,previewUrl,aiEnabled};
}
