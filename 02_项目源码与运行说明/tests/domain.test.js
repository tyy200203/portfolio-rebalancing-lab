import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze, impact} from '../src/domain.js';
const snapshot = JSON.parse(readFileSync(new URL('../data/portfolio.json', import.meta.url)));
const sell = {symbol:'A01',side:'sell',quantity:100};
const buy = {symbol:'A02',side:'buy',quantity:100};
test('AC-01 基准总资产、现金与两项告警', () => {
  const r = analyze(snapshot); assert.equal(r.total,'100000.00'); assert.equal(r.cash,'20000.00');
  assert.equal(r.positions[0].weight,'40.00'); assert.equal(r.industries[0].weight,'60.00');
  assert.equal(r.alerts.length,2); assert.equal(r.holdingCount,6);
});
test('AC-02 等于阈值不告警', () => {
  const r=analyze(snapshot,[sell]); assert.equal(r.cash,'30000.00'); assert.equal(r.positions[0].marketValue,'30000.00');
  assert.equal(r.positions[0].weight,'30.00'); assert.equal(r.industries[0].weight,'50.00'); assert.equal(r.alerts.length,0); assert.equal(r.total,'100000.00');
});
test('AC-03 连续操作与守恒', () => {
  const r=analyze(snapshot,[sell,buy]); assert.equal(r.cash,'25000.00'); assert.equal(r.positions[1].quantity,500);
  assert.equal(r.positions[1].marketValue,'25000.00'); assert.equal(r.industries[0].weight,'55.00'); assert.equal(r.alerts.length,1); assert.equal(r.total,'100000.00');
});
for (const [name,op] of [['现金不足',{...sell,side:'buy',quantity:201}],['超卖',{...sell,quantity:401}],... [0,-1,1.5,'100',null,Number.MAX_SAFE_INTEGER+1].map(quantity=>[`非法数量 ${quantity}`,{...sell,quantity}]), ['未知标的',{...sell,symbol:'XXX'}],['未知方向',{...sell,side:'other'}]]) {
  test(`AC-04 ${name} 拒绝且原始不变`,()=>{const before=JSON.stringify(snapshot); assert.throws(()=>analyze(snapshot,[op])); assert.equal(JSON.stringify(snapshot),before);});
}
test('操作使用前序现金；逆序失败',()=>{const ops=[sell,{...sell,side:'buy',quantity:250}]; assert.equal(analyze(snapshot,ops).cash,'5000.00'); assert.throws(()=>analyze(snapshot,ops.toReversed()),/现金不足/);});
test('后续失败不污染已计算结果',()=>{const good=analyze(snapshot,[sell]); assert.throws(()=>analyze(snapshot,[sell,{...sell,quantity:301}]),e=>e.operationIndex===1); assert.deepEqual(analyze(snapshot,[sell]),good);});
test('清仓后标的数与现金、再买回',()=>{const ops=snapshot.instruments.map(i=>({symbol:i.symbol,side:'sell',quantity:i.quantity})); const r=analyze(snapshot,ops); assert.equal(r.cash,'100000.00'); assert.equal(r.holdingCount,0); assert.equal(r.alerts.length,0); assert.equal(analyze(snapshot,[...ops,{...sell,side:'buy'}]).holdingCount,1);});
test('使用舍入前阈值：显示 30.00% 仍可超限',()=>{const data=structuredClone(snapshot); data.cash='19999.99'; const r=analyze(data,[sell]); assert.equal(r.positions[0].weight,'30.00'); assert.equal(r.positions[0].exceeded,true);});
test('操作上限与零资产',()=>{assert.throws(()=>analyze(snapshot,Array(101).fill(sell))); const zero=structuredClone(snapshot); zero.cash='0.00'; zero.instruments.forEach(i=>i.quantity=0); assert.equal(analyze(zero).positions[0].weight,'0.00');});

for (const [cash, expected, label] of [['20000.01',false,'略低'],['20000.00',false,'恰好等于'],['19999.99',true,'略高']]) {
  test(`阈值三点：标的30%及行业50% ${label}`,()=>{
    const data=structuredClone(snapshot); data.cash=cash;
    const r=analyze(data,[sell]);
    assert.equal(r.positions[0].weight,'30.00'); assert.equal(r.industries[0].weight,'50.00');
    assert.equal(r.positions[0].exceeded,expected); assert.equal(r.industries[0].exceeded,expected);
    assert.equal(r.alerts.length,expected?2:0);
  });
}
// 独立预期以纸面算式固化，不用被测函数生成期望值。
const conservationCases=[
  ['跨行业换仓', [{symbol:'A01',side:'sell',quantity:123},{symbol:'A03',side:'buy',quantity:77},{symbol:'A04',side:'buy',quantity:31}], '23050.00', '76950.00', [277,400,177,131,30,20]],
  ['用尽现金再卖出', [{symbol:'A02',side:'buy',quantity:400},{symbol:'A03',side:'sell',quantity:100}], '10000.00','90000.00',[400,800,0,100,30,20]],
  ['同标的往返', [{symbol:'A05',side:'sell',quantity:30},{symbol:'A05',side:'buy',quantity:30}], '20000.00','80000.00',[400,400,100,100,30,20]]
];
for(const [name,operations,cash,invested,quantities] of conservationCases) test(`独立金额守恒：${name}`,()=>{
  const r=analyze(snapshot,operations); assert.equal(r.cash,cash); assert.equal(r.invested,invested);
  assert.equal(r.total,'100000.00'); assert.deepEqual(r.positions.map(p=>p.quantity),quantities);
  // 每个合法前缀也必须守恒。
  for(let i=1;i<=operations.length;i++) assert.equal(analyze(snapshot,operations.slice(0,i)).total,'100000.00');
});
test('小数价格按分精确计算及超安全整数金额',()=>{
  const data=structuredClone(snapshot); data.cash='0.30'; data.instruments.forEach(i=>i.quantity=0); data.instruments[0].price='0.10';
  const r=analyze(data,[{symbol:'A01',side:'buy',quantity:3}]);
  assert.equal(r.cash,'0.00'); assert.equal(r.invested,'0.30'); assert.equal(r.total,'0.30');
  data.cash='90071992547409.93'; assert.equal(analyze(data,[{symbol:'A01',side:'buy',quantity:1}]).cash,'90071992547409.83');
});
test('业务效果由后端生成：部分降低后仍有一项告警',()=>{
  assert.deepEqual(impact(analyze(snapshot),analyze(snapshot,[sell,buy])),{
    cashDelta:'+5000.00',industry:'科技',industryWeight:'55.00',industryDeltaPoints:'-5.00',alertCount:1,alertDelta:-1
  });
});
