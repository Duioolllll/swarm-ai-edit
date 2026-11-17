import { z } from 'zod';

export const eventTypes = ['agent.started','agent.finished','task.started','task.completed','file.created','file.modified','file.deleted','component.detected','component.updated','style.changed','test.started','test.passed','test.failed','build.started','build.completed','error.detected'] as const;
export const EventInputSchema = z.object({
  eventId: z.string().min(1).max(120), sessionId: z.string().min(1).max(120),
  agentId: z.string().min(1).max(120), timestamp: z.string().datetime(),
  eventType: z.enum(eventTypes), filePath: z.string().max(1024).optional(),
  componentName: z.string().max(200).optional(), status: z.string().max(100).default('observed'),
  source: z.enum(['agent-hook','file-watcher','runtime']),
  confidence: z.enum(['reported','inferred','measured']), metadata: z.record(z.string(), z.unknown()).default({}),
});
export type EventInput = z.infer<typeof EventInputSchema>;
export type SwarmEvent = EventInput & { sequence: number };
export type EventType = typeof eventTypes[number];
export const RectSchema = z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().min(0).max(100000),height:z.number().min(0).max(100000)});
export const DomChangeSchema = z.object({
  id:z.string().max(150),kind:z.enum(['created','updated','text','style','image','deleted']),
  filePath:z.string().max(1024).optional(),componentName:z.string().max(200).optional(),
  tag:z.string().max(30),text:z.string().max(240).optional(),rect:RectSchema,
  viewport:z.object({width:z.number().positive().max(20000),height:z.number().positive().max(20000)}),
  capturedAt:z.string().datetime(),mapping:z.enum(['instrumented','inferred','unknown']),
  hmrId:z.string().max(120).optional(),
  observation:z.enum(['hmr','file-change']).optional(),
  triggerEventId:z.string().min(1).max(120).optional(),
});
export type DomChange = z.infer<typeof DomChangeSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type AgentState = 'Idle'|'Reading'|'Planning'|'Editing'|'Testing'|'Debugging'|'Completed'|'Error';
export function stateForEvent(type: EventType): AgentState {
  if(type==='error.detected'||type==='test.failed') return 'Error';
  if(type==='test.started'||type==='build.started') return 'Testing';
  if(type==='agent.finished'||type==='task.completed') return 'Completed';
  if(type==='agent.started') return 'Idle';
  if(type==='task.started') return 'Planning';
  if(type.startsWith('file.')||type.startsWith('component.')||type==='style.changed') return 'Editing';
  return 'Idle';
}
export function isSensitivePath(path:string):boolean {
  return path.split(/[\\/]/).some(p=> /^(node_modules|\.git|\.swarmwatch|dist|build|out|coverage|vendor|\.next|\.nuxt|\.output|\.svelte-kit|\.astro|\.vercel|\.ssh|\.aws)$/.test(p)||/^\.env(?:\.|$)/i.test(p)||/^(credentials|secrets?)(?:\.|$)/i.test(p)||/\.(pem|key|p12|pfx)$/i.test(p));
}
export function safeRelativePath(path:string):boolean {
  return !!path && !path.includes('\0') && !path.includes('\\') && !path.startsWith('/') && !/^[a-z]:/i.test(path) && !path.split('/').includes('..') && !isSensitivePath(path);
}
export function redact(value:unknown, depth=0):unknown {
  if(depth>6) return '[truncated]';
  if(typeof value==='string') return value.slice(0,4000).replace(/(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|(?:api[_-]?key|password|token|secret)\s*[:=]\s*[^\s,;]+)/gi,'[REDACTED]');
  if(Array.isArray(value)) return value.slice(0,100).map(x=>redact(x,depth+1));
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).slice(0,60).map(([k,v])=>[k,/password|secret|token|authorization|cookie|api.?key/i.test(k)?'[REDACTED]':redact(v,depth+1)]));
  return value;
}
/** Per-agent bounded FIFO; unrelated agents never block each other. */
export class AnimationScheduler<T extends {agentId:string}> {
  private queues=new Map<string,T[]>();
  constructor(readonly limit=24){}
  push(item:T){const q=this.queues.get(item.agentId)??[]; q.push(item); if(q.length>this.limit)q.shift();this.queues.set(item.agentId,q);}
  next(agentId:string){return this.queues.get(agentId)?.shift();}
  clear(){this.queues.clear();}
  get agents(){return [...this.queues.keys()];}
}
export function orderedUnique(events:SwarmEvent[]):SwarmEvent[]{
  return [...new Map(events.map(e=>[e.eventId,e])).values()].sort((a,b)=>a.sequence-b.sequence);
}
