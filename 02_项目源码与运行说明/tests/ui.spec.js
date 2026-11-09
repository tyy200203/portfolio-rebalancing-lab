import {test,expect} from '@playwright/test';
test('完整页面流程：初始、边界、连续、错误保留、保存、刷新重开',async({page})=>{
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#positions tr')).toHaveCount(6);
  await expect(page.locator('#original-alerts .alert')).toHaveCount(2);
  await expect(page.locator('#metrics')).toContainText('100,000.00');
  await expect(page.locator('#plans')).toContainText('暂无方案');
  await page.screenshot({path:'screenshots/01-initial.png',fullPage:true});
  await page.locator('#quantity').fill('100'); await page.locator('#add').click();
  await expect(page.locator('#sim-alerts')).toContainText('未触发');
  await expect(page.locator('#comparison-metrics')).toContainText('30,000.00');
  await page.locator('#symbol').selectOption('A02'); await page.locator('#side').selectOption('buy');
  await page.locator('#add').click(); await expect(page.locator('#count')).toHaveText('2');
  await expect(page.locator('#sim-alerts')).toContainText('55.00%');
  await expect(page.locator('#comparison-metrics')).toContainText('25,000.00');
  await expect(page.locator('#impact-cards')).toContainText('+¥5,000.00');
  await expect(page.locator('#impact-cards')).toContainText('下降 5.00 个百分点');
  await expect(page.locator('#impact-cards')).toContainText('减少 1 项');
  await expect(page.locator('#impact-note')).toContainText('仍有 1 项超限');
  await page.screenshot({path:'screenshots/02-comparison.png',fullPage:true});
  const before=await page.locator('#comparison').innerHTML();
  await page.locator('#symbol').selectOption('A01'); await page.locator('#quantity').fill('251'); await page.locator('#add').click();
  await expect(page.locator('#message')).toContainText('现金不足');
  await expect(page.locator('#count')).toHaveText('2'); expect(await page.locator('#comparison').innerHTML()).toBe(before);
  await page.screenshot({path:'screenshots/03-error.png',fullPage:true});
  const name='科技集中度部分降低方案';
  await page.locator('#plan-name').fill(name); await page.locator('#save').click();
  await expect(page.locator('#save-status')).toContainText('已保存方案为只读');
  await page.reload(); await expect(page.locator('#count')).toHaveText('0');
  await page.getByRole('button',{name:new RegExp(name)}).click();
  await expect(page.locator('#count')).toHaveText('2');
  await expect(page.locator('#simulation-title')).toContainText(name);
  await expect(page.locator('#comparison-metrics')).toContainText('25,000.00');
  await expect(page.locator('#metrics')).toContainText('20,000.00');
  await expect(page.locator('#add')).toBeDisabled();
  await page.screenshot({path:'screenshots/04-saved.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'screenshots/05-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('API 500 和网络失败均保留有效操作、金额、效果卡及未保存状态',async({page})=>{
  await page.goto('/'); await expect(page.locator('#positions tr')).toHaveCount(6);
  await page.locator('#quantity').fill('100'); await page.locator('#add').click();
  await expect(page.locator('#count')).toHaveText('1');
  const selectors=['#comparison','#comparison-metrics','#impact-cards','#operations','#save-status'];
  const before=await Promise.all(selectors.map(s=>page.locator(s).innerHTML()));
  const unchanged=async()=>{
    expect(await Promise.all(selectors.map(s=>page.locator(s).innerHTML()))).toEqual(before);
    await expect(page.locator('#count')).toHaveText('1'); await expect(page.locator('#add')).toBeEnabled();
  };
  await page.route('**/api/simulate',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'模拟服务测试故障'}})}));
  await page.locator('#add').click(); await expect(page.locator('#message')).toContainText('模拟服务测试故障'); await unchanged();
  await page.unroute('**/api/simulate');
  await page.route('**/api/simulate',route=>route.abort('failed'));
  await page.locator('#add').click(); await expect(page.locator('#message')).toHaveClass('error');
  await expect(page.locator('#add')).toBeEnabled(); await unchanged();
  await page.route('**/api/plans',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'保存服务测试故障'}})}));
  await page.locator('#plan-name').fill('不应保存'); await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('保存服务测试故障'); await unchanged();
  await expect(page.locator('#save')).toBeEnabled();
});

test('方案列表失败后只重试列表，保留已完成的模拟草稿',async({page})=>{
  let listFails=true, portfolioRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/portfolio') portfolioRequests++;});
  await page.route('**/api/plans',route=>listFails
    ? route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'列表测试故障'}})})
    : route.continue());
  await page.goto('/');
  await expect(page.locator('#plans-status')).toContainText('方案列表加载失败');
  await expect(page.locator('#retry')).toBeHidden();
  await page.locator('#quantity').fill('100'); await page.locator('#add').click();
  await expect(page.locator('#count')).toHaveText('1');
  await expect(page.locator('#comparison-metrics')).toContainText('30,000.00');
  const selectors=['#comparison','#comparison-metrics','#impact-cards','#operations','#save-status'];
  const before=await Promise.all(selectors.map(s=>page.locator(s).innerHTML()));
  await page.locator('#retry-plans').click();
  await expect(page.locator('#retry-plans')).toBeEnabled();
  expect(await Promise.all(selectors.map(s=>page.locator(s).innerHTML()))).toEqual(before);
  listFails=false;
  await page.locator('#retry-plans').click();
  await expect(page.locator('#retry-plans')).toBeHidden();
  expect(await Promise.all(selectors.map(s=>page.locator(s).innerHTML()))).toEqual(before);
  await expect(page.locator('#count')).toHaveText('1');
  await expect(page.locator('#comparison-metrics')).toContainText('30,000.00');
  expect(portfolioRequests).toBe(1);
  await page.screenshot({path:'screenshots/06-list-retry-draft.png',fullPage:true});
});

test('保存成功而列表刷新失败：保留成功反馈，只重试GET且不重复保存',async({page,request})=>{
  let listFails=false, saveRequests=0;
  page.on('request',req=>{if(new URL(req.url()).pathname==='/api/plans' && req.method()==='POST') saveRequests++;});
  await page.route('**/api/plans',route=>{
    if(route.request().method()!=='GET') return route.continue();
    if(listFails) return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'列表刷新测试故障'}})});
    // 显式模拟最初为空，验证保存后列表失败不会继续显示过时的“暂无方案”。
    if(saveRequests===0) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    return route.continue();
  });
  await page.goto('/'); await expect(page.locator('#positions tr')).toHaveCount(6);
  await expect(page.locator('#plans')).toContainText('暂无方案');
  await expect(page.locator('#add')).toBeEnabled();
  await page.locator('#quantity').fill('100'); await page.locator('#add').click();
  await expect(page.locator('#count')).toHaveText('1');
  const name='保存成功但列表刷新失败回归方案';
  const beforeList=await (await request.get('/api/plans')).json();
  listFails=true;
  await page.locator('#plan-name').fill(name); await page.locator('#save').click();
  await expect(page.locator('#plans-status')).toContainText('方案已保存，列表刷新失败');
  await expect(page.locator('#message')).toContainText(`方案「${name}」已保存`);
  await expect(page.locator('#message')).not.toHaveClass('error');
  await expect(page.locator('#save-status')).toContainText('已保存方案为只读');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#plans')).not.toContainText('暂无方案');
  const afterSave=await (await request.get('/api/plans')).json();
  expect(afterSave.length).toBe(beforeList.length+1);
  const plan=afterSave.find(p=>p.name===name); expect(plan).toBeTruthy();
  const stored=await (await request.get(`/api/plans/${plan.id}`)).json();
  expect(stored.simulated.cash).toBe('30000.00'); expect(stored.operations).toHaveLength(1);
  const selectors=['#comparison','#comparison-metrics','#impact-cards','#operations','#save-status'];
  const before=await Promise.all(selectors.map(s=>page.locator(s).innerHTML()));
  await page.screenshot({path:'screenshots/07-saved-list-failure.png',fullPage:true});
  // 再失败一次仍不能重复POST，随后恢复接口并重试。
  await page.locator('#retry-plans').click();
  await expect(page.locator('#retry-plans')).toBeEnabled();
  await expect(page.locator('#plans-status')).toContainText('方案已保存，列表刷新失败');
  listFails=false; await page.locator('#retry-plans').click();
  await expect(page.locator('#retry-plans')).toBeHidden();
  await expect(page.locator('#plans-status')).toBeEmpty();
  await expect(page.getByRole('button',{name:new RegExp(name)})).toBeVisible();
  expect(await Promise.all(selectors.map(s=>page.locator(s).innerHTML()))).toEqual(before);
  expect(saveRequests).toBe(1);
  expect((await (await request.get('/api/plans')).json()).length).toBe(afterSave.length);
});
