import {createHash,randomUUID} from 'node:crypto';
import {DomChangeSchema,EventInputSchema,redact,safeRelativePath,type DomChange,type EventInput,type SwarmEvent} from '@swarmwatch/core';
import type {EventStore} from './store.js';

export class Collector {
  private recent:SwarmEvent[]=[];
  private seenDom=new Set<string>();
  private pendingDom=new Map<string,{change:DomChange;receivedAt:number}>();
  constructor(readonly store:EventStore, readonly sessionId:string,private publish:(event:SwarmEvent)=>void=()=>{}){}
  emit(input:EventInput):SwarmEvent|undefined {
    const parsed=EventInputSchema.safeParse(input);
    if(!parsed.success) return;
    const event=parsed.data;
    if(event.sessionId!==this.sessionId || (event.filePath&&!safeRelativePath(event.filePath)))return;
    if(this.store.count(this.sessionId)>=100000)return; // bounded local session, never unbounded memory
    event.metadata=redact(event.metadata) as Record<string,unknown>;
    if(Buffer.byteLength(JSON.stringify(event))>64000)return;
    const saved=this.store.append(event);
    if(saved){
      if(saved.eventType.startsWith('file.')) {this.recent.push(saved);this.recent=this.recent.slice(-300);}
      this.publish(saved);
      if(saved.eventType.startsWith('file.')){
        // Vite HMR can complete before the debounced filesystem notification arrives.
        // Retry only actual measured DOM changes, briefly, without inventing a target.
        const pending=[...this.pendingDom.values()];this.pendingDom.clear();
        for(const item of pending)if(Date.now()-item.receivedAt<2000)this.dom(item.change,item.receivedAt);
      }
    }
    return saved;
  }
  file(eventType:'file.created'|'file.modified'|'file.deleted',filePath:string){
    return this.emit({eventId:randomUUID(),sessionId:this.sessionId,agentId:'file-observer',timestamp:new Date().toISOString(),eventType,filePath,status:'observed',source:'file-watcher',confidence:'inferred',metadata:{reason:'File change observed; author and internal agent intent are unknown.'}});
  }
  dom(raw:unknown,receivedAt=Date.now()):SwarmEvent|undefined {
    const parsed=DomChangeSchema.safeParse(raw);if(!parsed.success)return;
    const dom=parsed.data;
    if(!dom.hmrId?.trim())return; // Live visualization requires an observed Vite HMR burst, not arbitrary UI interaction.
    if(dom.filePath&&!safeRelativePath(dom.filePath))return;
    if(this.seenDom.has(dom.id))return;
    const now=Date.now();const captured=Date.parse(dom.capturedAt);
    if(Math.abs(now-captured)>30000)return;
    const candidates=this.recent.filter(e=>Math.abs(captured-Date.parse(e.timestamp))<15000);
    // Source mapping identifies a JSX element, but a newer stylesheet edit can be
    // its actual trigger. CSS-to-element attribution remains explicitly inferred.
    const matching=dom.filePath?candidates.filter(e=>e.filePath===dom.filePath):[];
    const exact=matching.findLast(e=>e.source==='agent-hook')??matching.at(-1);
    const css=dom.kind==='style'?candidates.findLast(e=>/\.(css|scss|sass|less)$/.test(e.filePath??'')):undefined;
    const cssIsNewer=!!css&&(!exact||Date.parse(css.timestamp)>Date.parse(exact.timestamp)||(css.timestamp===exact.timestamp&&css.sequence>exact.sequence));
    const trigger=cssIsNewer?css:exact??css;
    if(!trigger){
      // Bounded race buffer; unmatched interaction changes expire without becoming events.
      for(const [id,item]of this.pendingDom)if(now-item.receivedAt>=2000)this.pendingDom.delete(id);
      if(now-receivedAt<2000){this.pendingDom.set(dom.id,{change:dom,receivedAt});if(this.pendingDom.size>200)this.pendingDom.delete(this.pendingDom.keys().next().value!);}
      return;
    }
    this.pendingDom.delete(dom.id);
    this.seenDom.add(dom.id);if(this.seenDom.size>4000)this.seenDom.delete(this.seenDom.values().next().value!);
    const mappedToSource=trigger===exact;
    const isAgent=trigger.source==='agent-hook';
    return this.emit({eventId:'dom:'+createHash('sha256').update(dom.id).digest('hex'),sessionId:this.sessionId,
      agentId:isAgent?trigger.agentId:'file-observer',timestamp:dom.capturedAt,
      eventType:dom.kind==='style'?'style.changed':dom.kind==='created'||dom.kind==='image'?'component.detected':'component.updated',
      filePath:trigger.filePath,componentName:dom.componentName,status:dom.kind==='deleted'?'removed':'observed',source:'runtime',confidence:'measured',
      metadata:{dom,triggerEventId:trigger.eventId,mapping:mappedToSource?dom.mapping:'inferred',reason:!mappedToSource?'Style difference observed during Vite HMR after a CSS change; target source attribution and exact causation are inferred.':isAgent?'DOM change observed during Vite HMR and correlated to a reported agent file change; temporal correlation does not prove exact AI causation.':'DOM change observed during Vite HMR and mapped to source; file author and exact causation are unknown.'}});
  }
}
