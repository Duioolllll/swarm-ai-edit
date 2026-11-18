import { DatabaseSync } from 'node:sqlite';
import type { EventInput, SwarmEvent } from '@swarmwatch/core';

export type Session = {sessionId:string; projectName:string; previewUrl:string; startedAt:string};
export class EventStore {
  readonly db:DatabaseSync;
  constructor(path:string){
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_session ON events(session_id,sequence)');
  }
  addSession(session:Session){this.db.prepare('INSERT INTO sessions(id,data) VALUES (?,?)').run(session.sessionId,JSON.stringify(session));}
  sessions():Session[]{return (this.db.prepare('SELECT data FROM sessions ORDER BY rowid DESC').all() as {data:string}[]).map(r=>JSON.parse(r.data));}
  hasSession(id:string){return !!this.db.prepare('SELECT id FROM sessions WHERE id=?').get(id);}
  append(event:EventInput):SwarmEvent|undefined {
    const result=this.db.prepare('INSERT OR IGNORE INTO events(event_id,session_id,data) VALUES (?,?,?)').run(event.eventId,event.sessionId,JSON.stringify(event));
    return result.changes ? {...event,sequence:Number(result.lastInsertRowid)} : undefined;
  }
  events(sessionId:string, after=0,limit=100000):SwarmEvent[]{
    return (this.db.prepare('SELECT sequence,data FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(sessionId,after,limit) as {sequence:number;data:string}[]).map(r=>({...JSON.parse(r.data),sequence:r.sequence}));
  }
  count(sessionId:string){return Number((this.db.prepare('SELECT count(*) AS count FROM events WHERE session_id=?').get(sessionId) as {count:number}).count);}
  close(){this.db.close();}
}
