export class BusinessError extends Error {
  constructor(message, code = 'VALIDATION_ERROR', operationIndex) {
    super(message); this.code = code; this.operationIndex = operationIndex;
  }
}
const fail = message => { throw new BusinessError(message); };
export function cents(value) {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) fail('金额必须为非负的两位小数字符串');
  return BigInt(value.replace('.', ''));
}
export const money = n => `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
const signedMoney = n => `${n < 0n ? '-' : '+'}${money(n < 0n ? -n : n)}`;
// 展示变化也由后端生成；行业采用原组合市值最高的行业，避免前端另算口径。
export function impact(original, simulated) {
  const focus = original.industries.reduce((best, item) => !best || cents(item.marketValue) > cents(best.marketValue) ? item : best, null);
  const after = simulated.industries.find(item => item.name === focus.name);
  return {cashDelta: signedMoney(cents(simulated.cash) - cents(original.cash)),
    industry: focus.name, industryWeight: after.weight,
    industryDeltaPoints: signedMoney(cents(after.weight) - cents(focus.weight)),
    alertCount: simulated.alerts.length, alertDelta: simulated.alerts.length - original.alerts.length};
}
function percentage(value, total) {
  const rounded = total ? (value * 10000n + total / 2n) / total : 0n;
  return money(rounded);
}
export function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.instruments) || !snapshot.instruments.length) fail('行情快照缺少标的');
  cents(snapshot.cash);
  const symbols = new Set();
  for (const item of snapshot.instruments) {
    if (!item.symbol || symbols.has(item.symbol) || !item.industry || !item.name) fail('标的资料不完整或代码重复');
    symbols.add(item.symbol);
    if (cents(item.price) <= 0n) fail('行情价格必须大于零');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) fail('初始持仓必须为非负安全整数');
  }
  if (snapshot.rules?.single_instrument_threshold !== '0.30' || snapshot.rules?.industry_threshold !== '0.50' ||
    snapshot.rules?.comparison !== 'strictly_greater_than' || snapshot.rules?.cash_in_denominator !== true ||
    snapshot.rules?.cash_in_industry !== false || snapshot.rules?.fees !== '0.00' || snapshot.rules?.quantity !== 'positive_integer') fail('仅支持任务书指定规则');
}
export function analyze(snapshot, operations = []) {
  validateSnapshot(snapshot);
  if (!Array.isArray(operations) || operations.length > 100) fail('操作必须为数组且最多 100 笔');
  const holdings = snapshot.instruments.map(item => ({...item}));
  let cash = cents(snapshot.cash);
  operations.forEach((op, index) => {
    try {
      if (!op || typeof op !== 'object' || !['buy', 'sell'].includes(op.side)) fail('交易方向必须为 buy 或 sell');
      if (!Number.isSafeInteger(op.quantity) || op.quantity <= 0) fail('交易数量必须为安全范围内的正整数');
      const item = holdings.find(i => i.symbol === op.symbol);
      if (!item) fail('不支持的标的代码');
      const amount = cents(item.price) * BigInt(op.quantity);
      if (op.side === 'buy') {
        if (amount > cash) fail('现金不足，无法完成买入');
        if (!Number.isSafeInteger(item.quantity + op.quantity)) fail('持仓数量超出安全范围');
        cash -= amount; item.quantity += op.quantity;
      } else {
        if (op.quantity > item.quantity) fail('卖出数量超过当前模拟持仓');
        cash += amount; item.quantity -= op.quantity;
      }
    } catch (error) { error.operationIndex = index; throw error; }
  });
  const total = holdings.reduce((sum, i) => sum + cents(i.price) * BigInt(i.quantity), cash);
  const industries = new Map(); const alerts = [];
  const positions = holdings.map(item => {
    const value = cents(item.price) * BigInt(item.quantity);
    industries.set(item.industry, (industries.get(item.industry) || 0n) + value);
    const weight = percentage(value, total); const exceeded = value * 100n > total * 30n;
    if (exceeded) alerts.push({type: 'instrument', name: item.name, symbol: item.symbol, weight, threshold: '30.00'});
    return {...item, marketValue: money(value), weight, exceeded};
  });
  const distribution = [...industries].map(([name, value]) => {
    const weight = percentage(value, total); const exceeded = value * 100n > total * 50n;
    if (exceeded) alerts.push({type: 'industry', name, weight, threshold: '50.00'});
    return {name, marketValue: money(value), weight, exceeded};
  });
  return {total: money(total), cash: money(cash), invested: money(total - cash), cashWeight: percentage(cash, total),
    holdingCount: positions.filter(i => i.quantity > 0).length, positions, industries: distribution, alerts};
}
