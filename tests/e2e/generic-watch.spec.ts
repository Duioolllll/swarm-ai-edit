import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startServer} from '@swarmwatch/server';

test('plain HTML file edits produce local diffs and measured cursors without Vite or AI',async({page})=>{
  const project=await mkdtemp(join(tmpdir(),'swarmwatch-plain-e2e-'));
  await copyFile(resolve('examples/plain-app/content.html'),join(project,'content.html'));
  const shell=await readFile(resolve('examples/plain-app/index.html'),'utf8');
  let dashboardUrl='';
  const app=createServer(async(req,res)=>{
    try{const content=req.url?.split('?')[0]==='/content.html'?await readFile(join(project,'content.html'),'utf8'):shell.replace('__BRIDGE_ORIGIN__',dashboardUrl);res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(500);res.end();}
  });
  await new Promise<void>(done=>app.listen(0,'127.0.0.1',done));
  const appPort=(app.address() as {port:number}).port;
  const server=await startServer({project,previewUrl:`http://127.0.0.1:${appPort}`,port:0});
  dashboardUrl=`http://127.0.0.1:${server.port}`;
  const externalRequests:string[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(!['127.0.0.1','localhost'].includes(url.hostname))externalRequests.push(request.url());});
  const events=async()=>((await (await fetch(dashboardUrl+'/api/state')).json()) as any).events as any[];
  try{
    await page.goto(dashboardUrl);
    await expect(page.getByTestId('local-watch-mode')).toBeVisible();
    await expect(page.getByText('Instrumentation connected',{exact:true})).toBeVisible();
    await expect(page.frameLocator('iframe').getByRole('heading',{name:'Code changes. Made visible.'})).toBeVisible();
    expect((await events()).filter(e=>e.eventType==='agent.started')).toHaveLength(0);
    const original=await readFile(join(project,'content.html'),'utf8');
    await writeFile(join(project,'content.html'),'<header class="example-navbar"><strong>Local Navbar</strong><button>Open the local collection</button></header>\n'+original);
    await expect(page.frameLocator('iframe').getByRole('button',{name:'Open the local collection'})).toBeVisible();
    await expect.poll(async()=>(await events()).some(e=>e.eventType==='file.modified'&&e.metadata.analysis?.engine==='local-diff'&&e.metadata.analysis?.language==='html'&&e.metadata.analysis?.linesAdded===1)).toBe(true);
    await expect.poll(async()=>(await events()).some(e=>e.metadata.dom?.observation==='file-change'&&e.metadata.dom?.tag==='header'&&e.metadata.mapping==='inferred')).toBe(true);
    await expect(page.getByTestId('observation-cursor')).toBeVisible({timeout:20000});
    await page.waitForTimeout(500);
    await page.locator('.file-tree button').filter({hasText:'content.html'}).click();
    await expect(page.getByTestId('local-analysis')).toContainText('html');
    await page.screenshot({path:'artifacts/swarmwatch-local-watch.png',fullPage:true});
    const first=(await events()).filter(e=>e.eventType==='file.modified').at(-1)!;
    await writeFile(join(project,'content.html'),(await readFile(join(project,'content.html'),'utf8')).replace('Open the local collection','A second local edit'));
    await expect(page.frameLocator('iframe').getByRole('button',{name:'A second local edit'})).toBeVisible();
    await expect.poll(async()=>(await events()).some(e=>e.metadata.dom?.text==='A second local edit'&&e.metadata.triggerEventId!==first.eventId)).toBe(true);
    await page.waitForTimeout(500);const before=(await events()).filter(e=>e.metadata.dom).length;
    await page.frameLocator('iframe').getByRole('button',{name:'Try a local interaction'}).click();
    await expect(page.frameLocator('iframe').getByRole('button',{name:'Clicked locally'})).toBeVisible();
    await page.waitForTimeout(600);
    expect((await events()).filter(e=>e.metadata.dom)).toHaveLength(before);
    expect((await events()).some(e=>e.source==='agent-hook')).toBe(false);
    expect(externalRequests).toEqual([]);
  }finally{await page.close();await server.close();await new Promise<void>(done=>app.close(()=>done()));await rm(project,{recursive:true,force:true});}
});

test('Vue and Svelte files are observed without installing their frameworks or a preview',async({page})=>{
  const project=await mkdtemp(join(tmpdir(),'swarmwatch-files-only-'));
  const server=await startServer({project,port:0});const url=`http://127.0.0.1:${server.port}`;
  const events=async()=>((await (await fetch(url+'/api/state')).json()) as any).events as any[];
  try{
    await page.goto(url);
    await expect(page.getByTestId('local-watch-mode')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await writeFile(join(project,'Counter.vue'),'<template>\n<button>Local Vue source</button>\n</template>\n');
    await expect.poll(async()=>(await events()).some(e=>e.filePath==='Counter.vue'&&e.metadata.analysis?.language==='vue'&&e.metadata.analysis.linesAdded===3)).toBe(true);
    await page.locator('.file-tree button').filter({hasText:'Counter.vue'}).click();
    await expect(page.getByTestId('local-analysis')).toContainText('vue');
    await expect(page.getByTestId('local-analysis')).toContainText('+3 added');
    await writeFile(join(project,'Card.svelte'),'<h2>A plain source file</h2>\n');
    await expect.poll(async()=>(await events()).some(e=>e.filePath==='Card.svelte'&&e.metadata.analysis?.kind==='template')).toBe(true);
    await expect(page.locator('.file-tree button').filter({hasText:'Card.svelte'})).toBeVisible();
    await page.screenshot({path:'artifacts/swarmwatch-file-only.png',fullPage:true});
    expect((await events()).some(e=>e.source==='agent-hook'||e.metadata.dom)).toBe(false);
  }finally{await page.close();await server.close();await rm(project,{recursive:true,force:true});}
});
