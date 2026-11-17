import {test,expect} from '@playwright/test';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

test('real file → Vite HMR → mapped DOM → cursor, styles, reconnect, recording and replay',async({page,request})=>{
 const appPath=resolve('examples/react-app/src/App.tsx');
 const cssPath=resolve('examples/react-app/src/style.css');
 const navbarPath=resolve('examples/react-app/src/Navbar.tsx');
 const originalApp=await readFile(appPath,'utf8'),originalCss=await readFile(cssPath,'utf8');
 const getEvents=async()=>((await (await request.get('/api/state')).json()).events as any[]);
 try{
   await page.goto('/');
   await expect(page.getByText('Instrumentation connected',{exact:true})).toBeVisible();
   await expect(page.frameLocator('iframe').getByRole('heading',{name:'Less noise. More intention.'})).toBeVisible();
   expect((await getEvents()).filter(e=>e.eventType==='agent.started')).toHaveLength(0);
   await writeFile(navbarPath,`export function Navbar(){return <header style={{padding:'18px 24px',borderBottom:'1px solid #bbb',display:'flex',justifyContent:'space-between'}}><strong>NEW / STUDIO NOTES</strong><button className="new-navbar-button">Explore the archive ↗</button></header>}\n`);
   await writeFile(appPath,`import {Navbar} from './Navbar';\n`+originalApp.replace('<main className="site">','<main className="site"><Navbar/>'));
   await expect(page.frameLocator('iframe').getByRole('button',{name:'Explore the archive'})).toBeVisible();
   await expect.poll(async()=>(await getEvents()).some(e=>e.eventType==='file.created'&&e.filePath==='src/Navbar.tsx')).toBe(true);
   await expect.poll(async()=>(await getEvents()).some(e=>e.metadata.dom?.componentName==='Navbar'&&e.metadata.dom?.kind==='created')).toBe(true);
   await expect(page.getByTestId('dom-selection').first()).toBeVisible({timeout:20000});
   await expect(page.getByTestId('observation-cursor').filter({hasText:'Editing Navbar'})).toBeVisible({timeout:20000});
   await page.waitForTimeout(650); // capture after arrival/draw animation, while the observed cursor is active
   await mkdir('artifacts',{recursive:true});
   await page.screenshot({path:'artifacts/swarmwatch-live.png',fullPage:true});
   await page.getByLabel('Pause visualization').click();
   await expect(page.getByTestId('cursor-layer')).toHaveAttribute('data-paused','true');
   expect(await page.getByTestId('observation-cursor').first().evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
   await page.getByLabel('Resume visualization').click();
   await expect(page.getByTestId('cursor-layer')).toHaveAttribute('data-paused','false');
   const beforeStyle=(await getEvents()).at(-1)?.sequence??0;
   await writeFile(cssPath,originalCss+'\n.new-navbar-button{background:#202020;color:white;border:1px solid #202020;padding:12px 20px;}\n');
   await expect.poll(async()=>(await getEvents()).some(e=>e.sequence>beforeStyle&&e.eventType==='style.changed'&&e.metadata.dom?.tag==='button'&&e.filePath==='src/style.css'&&e.metadata.mapping==='inferred')).toBe(true);
   const beforeText=(await getEvents()).at(-1)?.sequence??0;
   await writeFile(navbarPath,(await readFile(navbarPath,'utf8')).replace('Explore the archive','Visit our studio'));
   await expect(page.frameLocator('iframe').getByRole('button',{name:'Visit our studio'})).toBeVisible();
   await expect.poll(async()=>(await getEvents()).some(e=>e.sequence>beforeText&&e.metadata.dom?.kind==='text'&&e.metadata.dom?.text?.includes('Visit our studio'))).toBe(true);
   await expect.poll(async()=>(await getEvents()).some(e=>e.eventType==='test.passed')).toBe(true);
   const state=await (await request.get('/api/state')).json();
   const exported=await (await request.get(`/api/sessions/${state.sessionId}/export`)).json();
   expect(exported.historicalDom).toBe(false);
   expect(exported.events.some((e:any)=>e.metadata.dom?.componentName==='Navbar')).toBe(true);
   expect(new Set(exported.events.map((e:any)=>e.eventId)).size).toBe(exported.events.length);
   // A genuine socket loss: backend continues recording, dashboard catches up by sequence.
   await page.context().setOffline(true);
   await page.waitForTimeout(1800);
   await writeFile(navbarPath,(await readFile(navbarPath,'utf8'))+'\n// reconnect evidence\n');
   await expect.poll(async()=>(await getEvents()).some(e=>e.sequence>state.events.at(-1).sequence&&e.filePath==='src/Navbar.tsx'&&e.eventType==='file.modified')).toBe(true);
   await page.context().setOffline(false);
   await expect(page.getByText('Collector connected',{exact:true})).toBeVisible({timeout:15000});
   await expect(page.getByText('Instrumentation connected',{exact:true})).toBeVisible();
   await page.getByRole('tab',{name:'Replay',exact:true}).click();
   await expect(page.getByText(/Historical screen snapshots are not recorded/)).toBeVisible();
   await page.getByLabel('Playback speed').selectOption('4');
   await page.getByLabel('Resume visualization').click();
   await page.waitForTimeout(400);
   await expect(page.getByLabel('Replay position')).toHaveValue(/^[1-9]/);
   await page.screenshot({path:'artifacts/swarmwatch-replay.png',fullPage:true});
   await page.getByLabel('Filter event type').selectOption('style.');
   await expect(page.locator('.event-stream .event-row').filter({hasText:'File modified'})).toHaveCount(0);
   await page.getByRole('tab',{name:'Live preview'}).click();
   await page.getByLabel('mobile viewport').click();
   await expect(page.frameLocator('iframe').getByRole('button',{name:'Visit our studio'})).toBeVisible();
   await page.screenshot({path:'artifacts/swarmwatch-mobile-preview.png',fullPage:true});
   // Printed localhost alias also establishes the secure bridge handshake.
   await page.goto('http://localhost:4317');
   await expect(page.getByText('Instrumentation connected',{exact:true})).toBeVisible();
   await writeFile(appPath,originalApp);
   await expect(page.frameLocator('iframe').getByRole('button',{name:'Visit our studio'})).toHaveCount(0);
   await unlink(navbarPath);
   await expect.poll(async()=>(await getEvents()).some(e=>e.eventType==='file.deleted'&&e.filePath==='src/Navbar.tsx')).toBe(true);
 }finally{await page.context().setOffline(false);await writeFile(appPath,originalApp);await writeFile(cssPath,originalCss);await unlink(navbarPath).catch(()=>{});}
});
