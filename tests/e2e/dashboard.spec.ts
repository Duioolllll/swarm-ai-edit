import {test,expect} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '@swarmwatch/server';

test('the open dashboard reconnects after the collector starts a new session',async({page})=>{
  const project=await mkdtemp(join(tmpdir(),'swarmwatch-restart-e2e-'));
  let server:Awaited<ReturnType<typeof startServer>>|undefined;
  try{
    server=await startServer({project,port:0});
    const {port,sessionId}=server;
    const sessionLabel=(id:string)=>'SESSION '+id.slice(0,8).toUpperCase();
    await page.goto(`http://127.0.0.1:${port}`);
    await expect(page.getByText('Collector connected',{exact:true})).toBeVisible();
    await expect(page.getByText(sessionLabel(sessionId),{exact:true})).toBeVisible();

    await server.close();
    await expect(page.getByText('Collector reconnecting',{exact:true})).toBeVisible();
    server=await startServer({project,port});
    await expect(page.getByText(sessionLabel(server.sessionId),{exact:true})).toBeVisible();
    await expect(page.getByText('Collector connected',{exact:true})).toBeVisible();
    await writeFile(join(project,'after-restart.html'),'<p>Recorded after restart</p>');
    await expect(page.locator('.file-tree button')).toHaveText(/after-restart\.html/);
  }finally{
    await page.close();
    await server?.close();
    await rm(project,{recursive:true,force:true});
  }
});

test('Replay shows its final visual event and can play it again',async({page})=>{
  const project=await mkdtemp(join(tmpdir(),'swarmwatch-replay-e2e-'));
  let server:Awaited<ReturnType<typeof startServer>>|undefined;
  try{
    server=await startServer({project,port:0});
    const file=server.collector.file('file.modified','content.html')!;
    const text='Final replay animation';
    const recorded=server.collector.dom({
      id:'last-dom',filePath:file.filePath,kind:'text',tag:'p',text,
      capturedAt:new Date(Date.parse(file.timestamp)+500).toISOString(),
      rect:{x:100,y:100,width:200,height:30},viewport:{width:1040,height:680},
      mapping:'instrumented',observation:'file-change',triggerEventId:file.eventId,
    });
    expect(recorded).toBeDefined();

    await page.goto(`http://127.0.0.1:${server.port}`);
    await expect(page.getByText('Collector connected',{exact:true})).toBeVisible();
    await page.getByRole('tab',{name:'Replay',exact:true}).click();
    const resume=page.getByLabel('Resume visualization');
    const finalAnimation=page.getByTestId('dom-selection').getByText(text,{exact:true});
    await resume.click();
    await expect(finalAnimation).toBeVisible();
    await expect(resume).toBeVisible();
    await expect(finalAnimation).toHaveCount(0);
    await resume.click();
    await expect(finalAnimation).toBeVisible();
  }finally{
    await page.close();
    await server?.close();
    await rm(project,{recursive:true,force:true});
  }
});
