import http from 'node:http';
import {readFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {analyze, impact, BusinessError} from './domain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(resolve(root, 'data/portfolio.json'), 'utf8'));
analyze(snapshot); // fail fast on broken input data
const dbPath = process.env.DB_PATH || resolve(root, 'storage/plans.sqlite');
mkdirSync(dirname(dbPath), {recursive: true});
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
  snapshot TEXT NOT NULL, operations TEXT NOT NULL, calculation_version INTEGER NOT NULL
);`);
function result(base, operations) {
  const original = analyze(base), simulated = analyze(base, operations);
  return {snapshot: {id: base.snapshot_id, at: base.snapshot_at, portfolioId: base.portfolio_id, name: base.name, currency: base.currency},
    original, simulated, impact: impact(original, simulated), operations};
}
function send(res, status, body) { res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(body)); }
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new BusinessError('请求体超过 64 KB', 'PAYLOAD_TOO_LARGE'); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString()); if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0; return data; }
  catch { throw new BusinessError('请求体必须为 JSON 对象', 'INVALID_JSON'); }
}
const assets = {'/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']};
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && assets[url.pathname]) {
      const [file, type] = assets[url.pathname]; res.writeHead(200, {'Content-Type': `${type}; charset=utf-8`}); res.end(readFileSync(resolve(root, 'public', file))); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/portfolio') return send(res, 200, result(snapshot, []));
    if (req.method === 'POST' && ['/api/simulate', '/api/plans'].includes(url.pathname)) {
      const input = await body(req);
      if (!Array.isArray(input.operations)) throw new BusinessError('operations 必须为数组');
      const output = result(snapshot, input.operations);
      if (url.pathname === '/api/simulate') return send(res, 200, output);
      if (typeof input.name !== 'string' || !input.name.trim() || [...input.name.trim()].length > 60) throw new BusinessError('方案名称须为 1–60 个字符');
      const id = randomUUID(), createdAt = new Date().toISOString(), name = input.name.trim();
      db.prepare('INSERT INTO plans VALUES (?, ?, ?, ?, ?, ?)').run(id, name, createdAt, JSON.stringify(snapshot), JSON.stringify(input.operations), 1);
      return send(res, 201, {...output, id, name, createdAt});
    }
    if (req.method === 'GET' && url.pathname === '/api/plans') return send(res, 200, db.prepare('SELECT id, name, created_at AS createdAt FROM plans ORDER BY created_at DESC, id DESC').all());
    if (req.method === 'GET' && url.pathname.startsWith('/api/plans/')) {
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(url.pathname.slice(11));
      if (!plan) return send(res, 404, {error: {code: 'NOT_FOUND', message: '方案不存在'}});
      if (plan.calculation_version !== 1) throw new Error('Unsupported calculation version');
      return send(res, 200, {...result(JSON.parse(plan.snapshot), JSON.parse(plan.operations)), id: plan.id, name: plan.name, createdAt: plan.created_at});
    }
    send(res, 404, {error: {code: 'NOT_FOUND', message: '接口不存在'}});
  } catch (error) {
    const known = error instanceof BusinessError;
    if (!known) console.error(error);
    send(res, known ? (error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400) : 500, {error: {code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务暂时无法处理请求，请稍后重试', operationIndex: error.operationIndex}});
  }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Portfolio Lab http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => {db.close(); process.exit(0);}));
