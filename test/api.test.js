'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');

let server, base, db;
before(async () => {
  db = open(':memory:');
  seed(db, { employees: 30 });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, url, { body, cookie } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'crm', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const login = async (email, password) => (await call('POST', '/api/auth/login', { body: { email, password } })).cookie;
const emailFor = (role) => db.prepare(`SELECT email FROM users WHERE role = ? AND status='active' LIMIT 1`).get(role).email;

test('rejects unauthenticated access', async () => {
  assert.equal((await call('GET', '/api/employees')).status, 401);
});

test('login success and failure are recorded', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { email: 'admin@acme.test', password: 'nope' } });
  assert.equal(bad.status, 401);
  const cookie = await login('admin@acme.test', 'Admin@123');
  assert.ok(cookie);
  const ev = await call('GET', '/api/login-events?search=admin@acme.test', { cookie });
  assert.ok(ev.json.rows.some((r) => r.success === 0 && r.reason === 'bad_credentials'));
  assert.ok(ev.json.rows.some((r) => r.success === 1));
});

test('requires CSRF header on writes', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('locks account after repeated failures', async () => {
  const email = db.prepare(`SELECT email FROM users WHERE role='employee' AND status='active' ORDER BY id DESC LIMIT 1`).get().email;
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { email, password: 'wrong' } });
  const r = await call('POST', '/api/auth/login', { body: { email, password: 'Password@123' } });
  assert.equal(r.status, 429);
});

test('admin sees all employees; employee sees only self and no salary of others', async () => {
  const admin = await login('admin@acme.test', 'Admin@123');
  const all = await call('GET', '/api/employees?limit=100', { cookie: admin });
  assert.equal(all.json.total, 30);
  const emp = await login(emailFor('employee'), 'Password@123');
  const mine = await call('GET', '/api/employees', { cookie: emp });
  assert.equal(mine.json.total, 1);
  const other = all.json.rows.find((r) => r.email !== mine.json.rows[0].email && r.role === 'employee');
  assert.equal((await call('GET', `/api/employees/${other.id}`, { cookie: emp })).status, 404);
});

test('manager sees only own department', async () => {
  const m = db.prepare(`SELECT email, department FROM users WHERE role='manager' LIMIT 1`).get();
  const cookie = await login(m.email, 'Password@123');
  const list = await call('GET', '/api/employees?limit=100', { cookie });
  assert.ok(list.json.rows.every((r) => r.department === m.department));
});

test('expense workflow: employee submits, manager approves, admin pays', async () => {
  const e = db.prepare(`SELECT u.email, u.department FROM users u WHERE role='employee' AND status='active'
    AND EXISTS (SELECT 1 FROM users m WHERE m.role='manager' AND m.department=u.department) LIMIT 1 OFFSET 1`).get();
  const emp = await login(e.email, 'Password@123');
  const created = await call('POST', '/api/transactions', { cookie: emp, body: { type: 'expense', category: 'Travel', amount: 123.456, date: '2026-11-01' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.transaction.amount, 123.46);
  assert.equal((await call('POST', '/api/transactions', { cookie: emp, body: { type: 'salary', amount: 5 } })).status, 403);
  assert.equal((await call('PATCH', `/api/transactions/${created.json.transaction.id}/status`, { cookie: emp, body: { status: 'approved' } })).status, 403);

  const mEmail = db.prepare(`SELECT email FROM users WHERE role='manager' AND department=?`).get(e.department).email;
  const mgr = await login(mEmail, 'Password@123');
  const ok = await call('PATCH', `/api/transactions/${created.json.transaction.id}/status`, { cookie: mgr, body: { status: 'approved' } });
  assert.equal(ok.json.transaction.status, 'approved');
  const admin = await login('admin@acme.test', 'Admin@123');
  const paid = await call('PATCH', `/api/transactions/${created.json.transaction.id}/status`, { cookie: admin, body: { status: 'paid' } });
  assert.equal(paid.json.transaction.status, 'paid');
  const again = await call('PATCH', `/api/transactions/${created.json.transaction.id}/status`, { cookie: admin, body: { status: 'approved' } });
  assert.equal(again.status, 400);
});

test('admin CRUD on employees is audited', async () => {
  const admin = await login('admin@acme.test', 'Admin@123');
  const c = await call('POST', '/api/employees', { cookie: admin, body: { name: 'New Hire', email: 'new.hire@acme.test', password: 'Welcome@123', department: 'Sales', office_id: 1 } });
  assert.equal(c.status, 201);
  const u = await call('PUT', `/api/employees/${c.json.employee.id}`, { cookie: admin, body: { title: 'AE', salary: 60000 } });
  assert.equal(u.json.employee.salary, 60000);
  const act = await call('GET', `/api/activity?user_id=${db.prepare(`SELECT id FROM users WHERE email='admin@acme.test'`).get().id}`, { cookie: admin });
  assert.ok(act.json.rows.some((r) => r.action === 'update' && r.entity_id === c.json.employee.id));
  assert.equal((await call('DELETE', `/api/employees/${c.json.employee.id}`, { cookie: admin })).status, 200);
});

test('employee cannot escalate own role', async () => {
  const emp = await login(emailFor('employee'), 'Password@123');
  const me = (await call('GET', '/api/auth/me', { cookie: emp })).json.user;
  await call('PUT', `/api/employees/${me.id}`, { cookie: emp, body: { role: 'admin', salary: 1e9, phone: '123' } });
  const after = db.prepare('SELECT role, salary, phone FROM users WHERE id = ?').get(me.id);
  assert.equal(after.role, 'employee');
  assert.notEqual(after.salary, 1e9);
  assert.equal(after.phone, '123');
});

test('dashboard, offices, CSV export and logout', async () => {
  const admin = await login('admin@acme.test', 'Admin@123');
  const d = await call('GET', '/api/dashboard', { cookie: admin });
  assert.equal(d.status, 200);
  assert.ok(d.json.people.total >= 30);
  const o = await call('GET', '/api/offices', { cookie: admin });
  assert.equal(o.json.rows.length, 5);
  const csv = await call('GET', '/api/transactions.csv', { cookie: admin });
  assert.match(csv.json, /^id,date,employee_name/);
  await call('POST', '/api/auth/logout', { cookie: admin });
  assert.equal((await call('GET', '/api/auth/me', { cookie: admin })).status, 401);
});
