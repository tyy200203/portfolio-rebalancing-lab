const $ = id => document.getElementById(id);
let state, busy = false, savedPlanAwaitingList = false;
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount = value => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const date = value => new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false});
function message(text, error = false) { $('message').hidden = false; $('message').textContent = text; $('message').className = error ? 'error' : ''; }
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const output = await response.json();
  if (!response.ok) throw new Error(`${output.error.operationIndex === undefined ? '' : `第 ${output.error.operationIndex + 1} 笔：`}${output.error.message}`);
  return output;
}
async function action(work) {
  if (busy) return; busy = true; lock();
  try { await work(); } catch (error) { message(error.message || '网络请求失败，请重试', true); }
  finally { busy = false; lock(); }
}
function lock() {
  document.querySelectorAll('button').forEach(b => b.disabled = busy);
  if (!state) ['add','save','undo'].forEach(id => $(id).disabled = true);
  else { $('undo').disabled = busy || !state.operations.length || !!state.id; $('add').disabled = busy || !!state.id; $('save').disabled = busy || !!state.id; }
}
function alerts(items) { return items.length ? items.map(a => `<div class="alert">${esc(a.name)} · ${a.weight}%<small>${a.type === 'industry' ? '行业' : '单一标的'}集中度超过 ${a.threshold}% 阈值</small></div>`).join('') : '<div class="clear">✓ 未触发集中度提醒</div>'; }
function bars(items) { return items.map(i => `<div class="bar-row"><span>${esc(i.name)}</span><div class="bar-track"><div class="bar" style="width:${i.weight}%"></div></div><span>${i.weight}%</span></div>`).join(''); }
function render() {
  const {original:o, simulated:s, snapshot:p, operations:ops} = state;
  $('snapshot').textContent = `${p.name} · ${p.portfolioId}　|　行情快照 ${date(p.at)}（北京时间）`;
  $('metrics').innerHTML = [['总资产 / CNY',amount(o.total),'固定价格 · 无手续费'],['可用现金 / CNY',amount(o.cash),`占总资产 ${o.cashWeight}%`],['持仓市值 / CNY',amount(o.invested),`${o.holdingCount} 个非零持仓标的`],['集中度提醒',`${o.alerts.length} 项`,'单一标的与行业分别检查']].map(([label,value,note]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><small>${note}</small></div>`).join('');
  $('positions').innerHTML = o.positions.map(i => `<tr><td>${esc(i.name)}<small>${esc(i.symbol)} · ${esc(i.industry)}</small></td><td>${amount(i.price)}</td><td>${i.quantity}</td><td>${amount(i.marketValue)}</td><td class="${i.exceeded?'warn-text':''}">${i.weight}% ${i.exceeded?'↑':''}</td></tr>`).join('');
  $('industries').innerHTML = bars(o.industries); $('original-alerts').innerHTML = alerts(o.alerts);
  const effect = state.impact;
  const points = effect.industryDeltaPoints;
  const cashDelta = effect.cashDelta;
  $('impact-cards').innerHTML = [
    ['模拟后现金',`¥${amount(s.cash)}`,cashDelta === '+0.00' ? '与原组合持平' : `${cashDelta[0]}¥${amount(cashDelta.slice(1))}`],
    [`${esc(effect.industry)}行业占比`,`${effect.industryWeight}%`,points === '+0.00' ? '与原组合持平' : `${points[0] === '-' ? '下降' : '上升'} ${points.slice(1)} 个百分点`],
    ['模拟后告警',`${effect.alertCount} 项`,effect.alertDelta === 0 ? '告警数量不变' : `${effect.alertDelta < 0 ? '减少' : '增加'} ${Math.abs(effect.alertDelta)} 项`]
  ].map(([label,value,delta]) => `<div class="effect-card"><span>${label}</span><strong>${value}</strong><small>${delta}</small></div>`).join('');
  $('impact-note').textContent = !ops.length ? '尚未添加操作，当前与原始组合一致。' : effect.alertCount ? `仍有 ${effect.alertCount} 项超限，请结合下方集中度明细查看；占比下降不代表所有超限已解除。` : '本次模拟未触发标的或行业集中度提醒。';
  $('impact-note').className = effect.alertCount && ops.length ? 'impact-note remaining' : 'impact-note';
  $('comparison-metrics').innerHTML = [['现金',`${amount(o.cash)} → ${amount(s.cash)}`],['持仓标的',`${o.holdingCount} → ${s.holdingCount}`],['模拟总资产',amount(s.total)]].map(([a,b])=>`<div>${a}<strong>${b}</strong></div>`).join('');
  $('comparison').innerHTML = s.positions.map((i,index) => { const before = o.positions[index]; return `<tr class="${i.quantity !== before.quantity?'changed':''}"><td>${esc(i.name)}<small>${esc(i.symbol)}</small></td><td>${before.quantity} → ${i.quantity}</td><td>${amount(before.marketValue)} → ${amount(i.marketValue)}</td><td>${before.weight}% → ${i.weight}%</td></tr>`; }).join('');
  $('sim-industries').innerHTML = bars(s.industries); $('sim-alerts').innerHTML = alerts(s.alerts);
  $('count').textContent = ops.length;
  $('operations').innerHTML = ops.length ? ops.map((op,i) => `<li><span>${i+1}. ${op.side === 'buy'?'买入':'卖出'} ${esc(op.symbol)}</span><b>${op.quantity} 股</b></li>`).join('') : '<li class="empty">尚无操作，请添加第一笔交易。</li>';
  $('simulation-title').textContent = state.id ? `已保存：${state.name}` : '调仓前后对比';
  $('save-status').textContent = state.id ? '已保存方案为只读。点击“新建模拟”从原组合开始。' : '未保存的操作将在刷新后清空。';
  $('conservation').textContent = o.total === s.total ? '总资产守恒' : '总资产异常';
  lock();
}
async function loadPlans() {
  const plans = await api('/api/plans'); $('plans').replaceChildren();
  if (!plans.length) { $('plans').innerHTML = '<div class="empty">暂无方案。完成模拟后命名保存。</div>'; return; }
  plans.forEach(plan => { const button = document.createElement('button'); button.className = 'saved-plan'; button.innerHTML = `${esc(plan.name)}<small>${date(plan.createdAt)} · 点击重新查看</small>`;
    button.addEventListener('click', () => action(async () => { const next = await api(`/api/plans/${encodeURIComponent(plan.id)}`); state = next; render(); message(`已重新打开「${plan.name}」，结果由后端根据已保存快照重算。`); })); $('plans').append(button); });
}
async function initialize() {
  if (state) return;
  $('retry').hidden = true;
  try { state = await api('/api/portfolio'); $('symbol').innerHTML = state.original.positions.map(i=>`<option value="${esc(i.symbol)}">${esc(i.symbol)} · ${esc(i.name)}</option>`).join(''); render(); $('message').hidden = true; }
  catch (error) { $('retry').hidden = false; throw error; }
}
// 列表刷新只更新列表展示，不触碰当前草稿或已保存方案状态。
async function refreshPlans() {
  try {
    await loadPlans();
    savedPlanAwaitingList = false;
    $('plans-status').textContent = '';
    $('retry-plans').hidden = true;
  } catch (error) {
    $('plans-status').textContent = `${savedPlanAwaitingList ? '方案已保存，列表刷新失败' : '方案列表加载失败'}：${error.message}。请重试列表。`;
    $('retry-plans').hidden = false;
    // 失败不能被误呈现为“暂无方案”。旧条目可继续使用，并明确提示未刷新。
    if (!$('plans').querySelector('.saved-plan')) $('plans').textContent = '当前无法获取最新方案列表。';
  }
}
$('retry').onclick = () => action(async () => { await initialize(); await refreshPlans(); });
$('retry-plans').onclick = () => action(refreshPlans);
$('trade-form').addEventListener('submit', e => { e.preventDefault(); action(async () => {
  const next = [...state.operations, {symbol:$('symbol').value,side:$('side').value,quantity:Number($('quantity').value)}];
  const result = await api('/api/simulate', {operations:next}); state = result; render(); message(`第 ${next.length} 笔操作已通过校验，模拟结果已更新。`);
}); });
$('undo').onclick = () => action(async () => { state = await api('/api/simulate',{operations:state.operations.slice(0,-1)}); render(); message('已撤销末笔操作。'); });
$('reset').onclick = () => action(async () => { state = await api('/api/portfolio'); $('plan-name').value = ''; render(); message('已从原始组合开始新模拟。'); });
$('save-form').addEventListener('submit', e => { e.preventDefault(); action(async () => {
  state = await api('/api/plans',{name:$('plan-name').value,operations:state.operations}); render(); message(`方案「${state.name}」已保存。`); savedPlanAwaitingList = true; await refreshPlans();
}); });
action(async () => { await initialize(); await refreshPlans(); });


