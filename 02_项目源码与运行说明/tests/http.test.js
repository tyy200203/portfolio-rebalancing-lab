import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
test('AC-05 HTTP 保存、进程重启、重开与隔离；输入错误',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'portfolio-test-')); let child, base;
  async function start(){ child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:'0',DB_PATH:join(dir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
    base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('启动超时')),10000); child.once('error',reject); child.once('exit',()=>reject(new Error('服务意外退出'))); child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127.0.0.1:\d+/); if(match){clearTimeout(timeout);resolve(match[0]);}});}); }
  async function stop(){const done=once(child,'exit'); child.kill(); await done; child=null;}
  const request=async(path,data)=>{const r=await fetch(base+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  try {
    await start(); const ops=[{symbol:'A01',side:'sell',quantity:100},{symbol:'A02',side:'buy',quantity:100}];
    const saved=await request('/api/plans',{name:'重启恢复验收',operations:ops}); assert.equal(saved.status,201); assert.equal(saved.data.simulated.cash,'25000.00');
    assert.equal((await request('/api/plans',{name:' ',operations:[]})).status,400);
    assert.equal((await request('/api/simulate',{operations:[{...ops[0],side:'buy',quantity:201}]})).status,400);
    assert.equal((await request('/api/plans',{name:'无效不得入库',operations:[{...ops[0],quantity:401}]})).status,400);
    assert.equal((await request('/api/plans')).data.length,1);
    // 在测试数据库注入真实 INSERT 失败；不向生产接口添加测试开关。
    const inspection = new DatabaseSync(join(dir,'test.sqlite'));
    try {
      const beforeCount=inspection.prepare('SELECT COUNT(*) AS n FROM plans').get().n;
      inspection.exec("CREATE TRIGGER reject_test_insert BEFORE INSERT ON plans BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;");
      const failedSave=await request('/api/plans',{name:'数据库失败不得保存',operations:ops});
      assert.equal(failedSave.status,500); assert.equal(failedSave.data.error.code,'INTERNAL_ERROR');
      assert.equal(inspection.prepare('SELECT COUNT(*) AS n FROM plans').get().n,beforeCount);
      assert.equal((await request('/api/plans')).data.length,beforeCount);
      inspection.exec('DROP TRIGGER reject_test_insert');
    } finally {inspection.close();}
    assert.equal((await request('/api/simulate',{})).status,400);
    const invalid=await fetch(base+'/api/simulate',{method:'POST',body:'{'}); assert.equal(invalid.status,400);
    assert.equal((await request('/api/plans/missing')).status,404);
    await stop(); await start();
    const reopened=await request('/api/plans/'+saved.data.id); assert.deepEqual(reopened.data,saved.data);
    const original=(await request('/api/portfolio')).data.original; assert.equal(original.cash,'20000.00'); assert.equal(original.positions[0].quantity,400); assert.equal(original.positions[1].quantity,400);
    assert.equal((await request('/api/plans')).data[0].name,'重启恢复验收');
  } finally {if(child) await stop(); await rm(dir,{recursive:true,force:true});}
});
