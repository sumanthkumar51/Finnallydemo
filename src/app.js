'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { hashPassword, verifyPassword } = require('./db');

const SESSION_HOURS = 12;
const COOKIE = 'crm_session';
const ROLES = ['admin', 'manager', 'employee'];
const TX_TYPES = ['expense', 'reimbursement', 'salary', 'bonus', 'advance'];
const TX_STATUSES = ['pending', 'approved', 'rejected', 'paid'];
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

function intParam(v, def, min = 1, max = 500) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function createApp(db, opts = {}) {
  const app = express();
  app.set('trust proxy', opts.trustProxy ?? 'loopback');
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // ---------- helpers ----------
  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    session: db.prepare(`SELECT s.*, u.status AS user_status FROM sessions s JOIN users u ON u.id = s.user_id
                         WHERE s.token_hash = ? AND s.expires_at > datetime('now')`),
    touchSession: db.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?`),
    log: db.prepare(`INSERT INTO activity_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)`),
  };

  function audit(req, action, entity = null, entityId = null, details = null) {
    q.log.run(req.user?.id ?? null, action, entity, entityId,
      details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)), clientIp(req));
  }

  // Scope: which user ids can the current user see?
  // admin -> all, manager -> own department, employee -> self.
  function scopeSql(user, col = 'u') {
    if (user.role === 'admin') return { sql: '1=1', params: [] };
    if (user.role === 'manager') return { sql: `${col}.department = ?`, params: [user.department] };
    return { sql: `${col}.id = ?`, params: [user.id] };
  }

  function canSeeUser(viewer, target) {
    if (!target) return false;
    if (viewer.role === 'admin' || viewer.id === target.id) return true;
    return viewer.role === 'manager' && viewer.department === target.department;
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) throw new HttpError(403, 'You do not have permission for this action');
      next();
    };
  }

  // ---------- auth middleware ----------
  app.use('/api', (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const s = q.session.get(sha256(token));
      if (s && s.user_status === 'active') {
        q.touchSession.run(s.token_hash);
        req.user = q.userById.get(s.user_id);
        req.sessionHash = s.token_hash;
        req.loginEventId = s.login_event_id;
      }
    }
    next();
  });

  // CSRF mitigation: state-changing API calls must be JSON from same origin.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.headers['x-requested-with'] !== 'crm') throw new HttpError(403, 'Missing request header');
    }
    next();
  });

  // ---------- auth ----------
  const recentFails = db.prepare(`SELECT COUNT(*) AS n FROM login_events
    WHERE email = ? AND success = 0 AND created_at > datetime('now', ?)`);
  const lastSuccess = db.prepare(`SELECT MAX(created_at) AS t FROM login_events WHERE email = ? AND success = 1`);
  const insertLogin = db.prepare(`INSERT INTO login_events (user_id, email, success, reason, ip, user_agent) VALUES (?,?,?,?,?,?)`);

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) throw new HttpError(400, 'Email and password are required');
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);

    const fails = recentFails.get(email, `-${LOCK_MINUTES} minutes`).n;
    const last = lastSuccess.get(email).t;
    // Only count failures since the last successful login.
    const failsSince = last
      ? db.prepare(`SELECT COUNT(*) AS n FROM login_events WHERE email = ? AND success = 0
                    AND created_at > ? AND created_at > datetime('now', ?)`).get(email, last, `-${LOCK_MINUTES} minutes`).n
      : fails;
    const user = q.userByEmail.get(email);

    if (failsSince >= MAX_FAILS) {
      insertLogin.run(user?.id ?? null, email, 0, 'locked', ip, ua);
      throw new HttpError(429, `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
    }
    if (!user || !verifyPassword(password, user.password_hash)) {
      insertLogin.run(user?.id ?? null, email, 0, 'bad_credentials', ip, ua);
      throw new HttpError(401, 'Invalid email or password');
    }
    if (user.status !== 'active') {
      insertLogin.run(user.id, email, 0, 'inactive', ip, ua);
      throw new HttpError(403, 'Account is inactive');
    }

    const ev = insertLogin.run(user.id, email, 1, null, ip, ua);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessions (token_hash, user_id, login_event_id, expires_at)
                VALUES (?, ?, ?, datetime('now', ?))`).run(sha256(token), user.id, ev.lastInsertRowid, `+${SESSION_HOURS} hours`);
    req.user = user;
    audit(req, 'login');
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}` +
      (opts.secureCookies ? '; Secure' : ''));
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.user) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
      if (req.loginEventId) db.prepare(`UPDATE login_events SET logout_at = datetime('now') WHERE id = ?`).run(req.loginEventId);
      audit(req, 'logout');
    }
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // Public, non-secret client configuration (analytics / maps IDs) read from environment variables.
  // Each integration stays disabled in the browser until its ID is set.
  app.get('/api/public-config', (req, res) => {
    const env = opts.env || process.env;
    res.json({
      gaMeasurementId: env.GA_MEASUREMENT_ID || '',
      gtmContainerId: env.GTM_CONTAINER_ID || '',
      clarityProjectId: env.CLARITY_PROJECT_ID || '',
      pendoApiKey: env.PENDO_API_KEY || '',
      googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || '',
    });
  });

  // Everything below requires login.
  app.use('/api', (req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Not signed in');
    next();
  });

  app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

  app.post('/api/auth/password', (req, res) => {
    const { current, next: newPw } = req.body || {};
    if (!verifyPassword(String(current || ''), req.user.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    if (String(newPw || '').length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(newPw)), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, req.sessionHash);
    audit(req, 'password_change', 'user', req.user.id);
    res.json({ ok: true });
  });

  // Client-side page-view tracking (usage analytics).
  app.post('/api/track', (req, res) => {
    const page = String(req.body?.page || '').slice(0, 100);
    if (page) audit(req, 'page_view', null, null, page);
    res.json({ ok: true });
  });

  // ---------- meta ----------
  app.get('/api/meta', (req, res) => {
    const departments = db.prepare('SELECT DISTINCT department FROM users ORDER BY department').all().map((r) => r.department);
    const categories = db.prepare('SELECT DISTINCT category FROM transactions ORDER BY category').all().map((r) => r.category);
    const offices = db.prepare('SELECT id, name, city, country FROM offices ORDER BY name').all();
    res.json({ roles: ROLES, txTypes: TX_TYPES, txStatuses: TX_STATUSES, departments, categories, offices });
  });

  // Offices with headcount (for the map), scoped to what the viewer may see.
  app.get('/api/offices', (req, res) => {
    const sc = scopeSql(req.user);
    const rows = db.prepare(`SELECT o.*, COUNT(u.id) AS headcount
      FROM offices o LEFT JOIN users u ON u.office_id = o.id AND u.status = 'active' AND ${sc.sql}
      GROUP BY o.id ORDER BY o.name`).all(...sc.params);
    res.json({ rows });
  });

  // ---------- dashboard ----------
  app.get('/api/dashboard', (req, res) => {
    const sc = scopeSql(req.user);
    const one = (sql, ...p) => db.prepare(sql).get(...sc.params, ...p);
    const all = (sql, ...p) => db.prepare(sql).all(...sc.params, ...p);

    const people = one(`SELECT COUNT(*) AS total, SUM(status='active') AS active,
                          SUM(CASE WHEN status='active' THEN salary ELSE 0 END) AS payroll
                        FROM users u WHERE ${sc.sql}`);
    const money = one(`SELECT
        SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN t.status='pending' THEN t.amount ELSE 0 END) AS pending_amount,
        SUM(CASE WHEN t.type IN ('expense','reimbursement') AND t.status IN ('approved','paid')
                  AND t.date >= date('now','start of month') THEN t.amount ELSE 0 END) AS spend_this_month
      FROM transactions t JOIN users u ON u.id = t.user_id WHERE ${sc.sql}`);
    const logins = one(`SELECT
        SUM(CASE WHEN l.success=1 AND l.created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS ok_24h,
        SUM(CASE WHEN l.success=0 AND l.created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS failed_24h,
        COUNT(DISTINCT CASE WHEN l.success=1 AND l.created_at >= datetime('now','-7 days') THEN l.user_id END) AS active_users_7d
      FROM login_events l JOIN users u ON u.id = l.user_id WHERE ${sc.sql}`);

    const spendByCategory = all(`SELECT t.category, ROUND(SUM(t.amount),2) AS total
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE ${sc.sql} AND t.type IN ('expense','reimbursement') AND t.status IN ('approved','paid')
        AND t.date >= date('now','-90 days')
      GROUP BY t.category ORDER BY total DESC LIMIT 8`);
    const spendByMonth = all(`SELECT substr(t.date,1,7) AS month, ROUND(SUM(t.amount),2) AS total
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE ${sc.sql} AND t.type IN ('expense','reimbursement') AND t.status IN ('approved','paid')
        AND t.date >= date('now','start of month','-5 months')
      GROUP BY month ORDER BY month`);
    const loginsByDay = all(`SELECT date(l.created_at) AS day, SUM(l.success=1) AS ok, SUM(l.success=0) AS failed
      FROM login_events l JOIN users u ON u.id = l.user_id
      WHERE ${sc.sql} AND l.created_at >= date('now','-13 days')
      GROUP BY day ORDER BY day`);
    const headcountByDept = all(`SELECT u.department, COUNT(*) AS n FROM users u WHERE ${sc.sql} AND u.status='active'
      GROUP BY u.department ORDER BY n DESC`);
    const recentLogins = all(`SELECT l.id, l.email, l.success, l.reason, l.ip, l.created_at, u.name
      FROM login_events l JOIN users u ON u.id = l.user_id WHERE ${sc.sql}
      ORDER BY l.created_at DESC, l.id DESC LIMIT 8`);
    const inactive = all(`SELECT u.id, u.name, u.department,
        (SELECT MAX(created_at) FROM login_events WHERE user_id = u.id AND success = 1) AS last_login
      FROM users u WHERE ${sc.sql} AND u.status='active'
      AND COALESCE((SELECT MAX(created_at) FROM login_events WHERE user_id = u.id AND success = 1), '0') < datetime('now','-14 days')
      ORDER BY last_login LIMIT 8`);

    res.json({ people, money, logins, spendByCategory, spendByMonth, loginsByDay, headcountByDept, recentLogins, inactive });
  });

  // ---------- employees ----------
  const EMP_FIELDS = ['name', 'email', 'role', 'department', 'title', 'phone', 'salary', 'status', 'manager_id', 'office_id', 'hire_date'];

  function validateEmployee(body, partial) {
    const out = {};
    for (const f of EMP_FIELDS) if (body[f] !== undefined) out[f] = body[f];
    if (!partial) {
      if (!out.name || !out.email) throw new HttpError(400, 'Name and email are required');
    }
    if (out.name !== undefined) { out.name = String(out.name).trim(); if (!out.name) throw new HttpError(400, 'Name cannot be empty'); }
    if (out.email !== undefined) {
      out.email = String(out.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new HttpError(400, 'Invalid email');
    }
    if (out.role !== undefined && !ROLES.includes(out.role)) throw new HttpError(400, 'Invalid role');
    if (out.status !== undefined && !['active', 'inactive'].includes(out.status)) throw new HttpError(400, 'Invalid status');
    if (out.salary !== undefined) {
      out.salary = Number(out.salary);
      if (!Number.isFinite(out.salary) || out.salary < 0) throw new HttpError(400, 'Invalid salary');
    }
    if (out.manager_id !== undefined) out.manager_id = out.manager_id ? Number(out.manager_id) : null;
    if (out.office_id !== undefined) out.office_id = out.office_id ? Number(out.office_id) : null;
    for (const f of ['department', 'title', 'phone', 'hire_date']) if (out[f] !== undefined) out[f] = String(out[f] ?? '').trim();
    return out;
  }

  app.get('/api/employees', (req, res) => {
    const sc = scopeSql(req.user);
    const where = [sc.sql]; const params = [...sc.params];
    if (req.query.search) {
      where.push('(u.name LIKE ? OR u.email LIKE ? OR u.title LIKE ?)');
      const s = `%${req.query.search}%`; params.push(s, s, s);
    }
    if (req.query.department) { where.push('u.department = ?'); params.push(String(req.query.department)); }
    if (req.query.role) { where.push('u.role = ?'); params.push(String(req.query.role)); }
    if (req.query.status) { where.push('u.status = ?'); params.push(String(req.query.status)); }
    if (req.query.office_id) { where.push('u.office_id = ?'); params.push(Number(req.query.office_id)); }
    const sortable = { name: 'u.name', department: 'u.department', salary: 'u.salary', hire_date: 'u.hire_date', last_login: 'last_login' };
    const sort = sortable[req.query.sort] || 'u.name';
    const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
    const limit = intParam(req.query.limit, 25); const page = intParam(req.query.page, 1, 1, 100000);
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${whereSql}`).get(...params).n;
    const rows = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.department, u.title, u.phone, u.status, u.hire_date,
        ${req.user.role === 'employee' ? 'NULL' : 'u.salary'} AS salary, m.name AS manager_name, o.name AS office_name,
        (SELECT MAX(created_at) FROM login_events WHERE user_id = u.id AND success = 1) AS last_login
      FROM users u LEFT JOIN users m ON m.id = u.manager_id LEFT JOIN offices o ON o.id = u.office_id
      WHERE ${whereSql} ORDER BY ${sort} ${dir}, u.id LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ total, page, limit, rows });
  });

  app.get('/api/employees/:id', (req, res) => {
    const target = q.userById.get(Number(req.params.id));
    if (!canSeeUser(req.user, target)) throw new HttpError(404, 'Employee not found');
    const manager = target.manager_id ? q.userById.get(target.manager_id) : null;
    const office = target.office_id ? db.prepare('SELECT * FROM offices WHERE id = ?').get(target.office_id) : null;
    const finance = db.prepare(`SELECT
        COUNT(*) AS count,
        ROUND(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),2) AS pending,
        ROUND(SUM(CASE WHEN type IN ('expense','reimbursement') AND status IN ('approved','paid') THEN amount ELSE 0 END),2) AS spend,
        ROUND(SUM(CASE WHEN type IN ('salary','bonus') AND status IN ('approved','paid') THEN amount ELSE 0 END),2) AS paid_out
      FROM transactions WHERE user_id = ?`).get(target.id);
    const loginStats = db.prepare(`SELECT COUNT(*) AS total, SUM(success=1) AS ok, SUM(success=0) AS failed,
        MAX(CASE WHEN success=1 THEN created_at END) AS last_login
      FROM login_events WHERE user_id = ?`).get(target.id);
    const transactions = db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 15`).all(target.id);
    const logins = db.prepare(`SELECT * FROM login_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 15`).all(target.id);
    const activity = db.prepare(`SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 15`).all(target.id);
    const reports = db.prepare(`SELECT id, name, title FROM users WHERE manager_id = ? ORDER BY name`).all(target.id);
    const employee = publicUser(target);
    if (req.user.role === 'employee' && req.user.id !== target.id) employee.salary = null;
    audit(req, 'view', 'employee', target.id);
    res.json({ employee, manager: manager && { id: manager.id, name: manager.name }, office, finance, loginStats, transactions, logins, activity, reports });
  });

  app.post('/api/employees', requireRole('admin'), (req, res) => {
    const e = validateEmployee(req.body || {}, false);
    const password = String(req.body.password || '');
    if (password.length < 8) throw new HttpError(400, 'Initial password must be at least 8 characters');
    if (q.userByEmail.get(e.email)) throw new HttpError(409, 'Email already in use');
    const r = db.prepare(`INSERT INTO users (name,email,password_hash,role,department,title,phone,salary,status,manager_id,office_id,hire_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.name, e.email, hashPassword(password), e.role || 'employee', e.department || 'General',
      e.title || '', e.phone || '', e.salary || 0, e.status || 'active', e.manager_id ?? null, e.office_id ?? null, e.hire_date || new Date().toISOString().slice(0, 10));
    audit(req, 'create', 'employee', Number(r.lastInsertRowid), { email: e.email });
    res.status(201).json({ employee: publicUser(q.userById.get(r.lastInsertRowid)) });
  });

  app.put('/api/employees/:id', (req, res) => {
    const target = q.userById.get(Number(req.params.id));
    if (!canSeeUser(req.user, target)) throw new HttpError(404, 'Employee not found');
    let e = validateEmployee(req.body || {}, true);
    if (req.user.role !== 'admin') {
      // Non-admins can only edit their own contact details.
      if (req.user.id !== target.id) throw new HttpError(403, 'Only admins can edit other employees');
      e = Object.fromEntries(Object.entries(e).filter(([k]) => ['name', 'phone'].includes(k)));
    }
    if (req.user.id === target.id && (e.role && e.role !== target.role || e.status === 'inactive')) {
      throw new HttpError(400, 'You cannot change your own role or deactivate yourself');
    }
    if (e.email && e.email !== target.email && q.userByEmail.get(e.email)) throw new HttpError(409, 'Email already in use');
    if (e.manager_id === target.id) throw new HttpError(400, 'An employee cannot manage themselves');
    const keys = Object.keys(e);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => e[k]), target.id);
      if (e.status === 'inactive') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      const changes = {};
      for (const k of keys) if (String(target[k] ?? '') !== String(e[k] ?? '')) changes[k] = { from: target[k], to: e[k] };
      audit(req, 'update', 'employee', target.id, changes);
    }
    res.json({ employee: publicUser(q.userById.get(target.id)) });
  });

  app.delete('/api/employees/:id', requireRole('admin'), (req, res) => {
    const target = q.userById.get(Number(req.params.id));
    if (!target) throw new HttpError(404, 'Employee not found');
    if (target.id === req.user.id) throw new HttpError(400, 'You cannot delete yourself');
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    audit(req, 'delete', 'employee', target.id, { email: target.email, name: target.name });
    res.json({ ok: true });
  });

  // ---------- transactions / finances ----------
  function txQuery(req) {
    const sc = scopeSql(req.user);
    const where = [sc.sql]; const params = [...sc.params];
    const eq = { type: 't.type', status: 't.status', category: 't.category', department: 'u.department' };
    for (const [k, col] of Object.entries(eq)) if (req.query[k]) { where.push(`${col} = ?`); params.push(String(req.query[k])); }
    if (req.query.user_id) { where.push('t.user_id = ?'); params.push(Number(req.query.user_id)); }
    if (req.query.from) { where.push('t.date >= ?'); params.push(String(req.query.from)); }
    if (req.query.to) { where.push('t.date <= ?'); params.push(String(req.query.to)); }
    if (req.query.search) { where.push('(t.description LIKE ? OR u.name LIKE ?)'); const s = `%${req.query.search}%`; params.push(s, s); }
    return { whereSql: where.join(' AND '), params };
  }
  const TX_SELECT = `SELECT t.*, u.name AS employee_name, u.department, r.name AS reviewer_name
    FROM transactions t JOIN users u ON u.id = t.user_id LEFT JOIN users r ON r.id = t.reviewed_by`;

  app.get('/api/transactions', (req, res) => {
    const { whereSql, params } = txQuery(req);
    const limit = intParam(req.query.limit, 25); const page = intParam(req.query.page, 1, 1, 100000);
    const summary = db.prepare(`SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(t.amount),0),2) AS total
      FROM transactions t JOIN users u ON u.id = t.user_id WHERE ${whereSql}`).get(...params);
    const rows = db.prepare(`${TX_SELECT} WHERE ${whereSql} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    res.json({ total: summary.n, sum: summary.total, page, limit, rows });
  });

  app.get('/api/transactions.csv', (req, res) => {
    const { whereSql, params } = txQuery(req);
    const rows = db.prepare(`${TX_SELECT} WHERE ${whereSql} ORDER BY t.date DESC, t.id DESC LIMIT 50000`).all(...params);
    const cols = ['id', 'date', 'employee_name', 'department', 'type', 'category', 'amount', 'status', 'description', 'reviewer_name', 'reviewed_at'];
    const esc = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    audit(req, 'export', 'transactions', null, { rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
  });

  app.post('/api/transactions', (req, res) => {
    const b = req.body || {};
    let userId = Number(b.user_id || req.user.id);
    const target = q.userById.get(userId);
    if (!canSeeUser(req.user, target)) throw new HttpError(404, 'Employee not found');
    if (req.user.role === 'employee' && userId !== req.user.id) throw new HttpError(403, 'You can only file your own transactions');
    const type = String(b.type || 'expense');
    if (!TX_TYPES.includes(type)) throw new HttpError(400, 'Invalid type');
    if (req.user.role === 'employee' && !['expense', 'reimbursement', 'advance'].includes(type)) {
      throw new HttpError(403, 'Employees can only submit expenses, reimbursements and advances');
    }
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new HttpError(400, 'Amount must be a positive number');
    const date = String(b.date || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Date must be YYYY-MM-DD');
    const category = String(b.category || 'Other').trim().slice(0, 50) || 'Other';
    const description = String(b.description || '').trim().slice(0, 500);
    const r = db.prepare(`INSERT INTO transactions (user_id,type,category,amount,description,date) VALUES (?,?,?,?,?,?)`)
      .run(userId, type, category, amount, description, date);
    audit(req, 'create', 'transaction', Number(r.lastInsertRowid), { type, amount, for_user: userId });
    res.status(201).json({ transaction: db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(r.lastInsertRowid) });
  });

  app.patch('/api/transactions/:id/status', requireRole('admin', 'manager'), (req, res) => {
    const t = db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(Number(req.params.id));
    if (!t || !canSeeUser(req.user, { id: t.user_id, department: t.department })) throw new HttpError(404, 'Transaction not found');
    const status = String(req.body?.status || '');
    if (!['approved', 'rejected', 'paid'].includes(status)) throw new HttpError(400, 'Invalid status');
    if (t.user_id === req.user.id) throw new HttpError(403, 'You cannot review your own transactions');
    const allowed = { pending: ['approved', 'rejected'], approved: ['paid', 'rejected'], rejected: [], paid: [] };
    if (!allowed[t.status].includes(status)) throw new HttpError(400, `Cannot move a ${t.status} transaction to ${status}`);
    const note = String(req.body?.note || '').slice(0, 300) || null;
    db.prepare(`UPDATE transactions SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?`)
      .run(status, req.user.id, note, t.id);
    audit(req, status, 'transaction', t.id, { from: t.status, amount: t.amount });
    res.json({ transaction: db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(t.id) });
  });

  // ---------- login activity ----------
  app.get('/api/login-events', (req, res) => {
    const sc = scopeSql(req.user);
    const where = [sc.sql]; const params = [...sc.params];
    if (req.query.success === '1' || req.query.success === '0') { where.push('l.success = ?'); params.push(Number(req.query.success)); }
    if (req.query.user_id) { where.push('l.user_id = ?'); params.push(Number(req.query.user_id)); }
    if (req.query.search) { where.push('(l.email LIKE ? OR l.ip LIKE ? OR u.name LIKE ?)'); const s = `%${req.query.search}%`; params.push(s, s, s); }
    if (req.query.from) { where.push('l.created_at >= ?'); params.push(String(req.query.from)); }
    if (req.query.to) { where.push("l.created_at < date(?, '+1 day')"); params.push(String(req.query.to)); }
    // Admins also see failed attempts for unknown emails.
    const join = req.user.role === 'admin' ? 'LEFT JOIN' : 'JOIN';
    const whereSql = req.user.role === 'admin' ? where.slice(1).join(' AND ') || '1=1' : where.join(' AND ');
    const limit = intParam(req.query.limit, 50); const page = intParam(req.query.page, 1, 1, 100000);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM login_events l ${join} users u ON u.id = l.user_id WHERE ${whereSql}`).get(...(req.user.role === 'admin' ? params.slice(sc.params.length) : params)).n;
    const rows = db.prepare(`SELECT l.*, u.name, u.department,
        CAST(ROUND((julianday(l.logout_at) - julianday(l.created_at)) * 1440) AS INTEGER) AS session_minutes
      FROM login_events l ${join} users u ON u.id = l.user_id WHERE ${whereSql}
      ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`)
      .all(...(req.user.role === 'admin' ? params.slice(sc.params.length) : params), limit, (page - 1) * limit);
    res.json({ total, page, limit, rows });
  });

  app.get('/api/sessions', requireRole('admin'), (req, res) => {
    const rows = db.prepare(`SELECT u.id AS user_id, u.name, u.department, s.created_at, s.last_seen_at, s.expires_at, l.ip, l.user_agent
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN login_events l ON l.id = s.login_event_id
      WHERE s.expires_at > datetime('now') ORDER BY s.last_seen_at DESC`).all();
    res.json({ rows });
  });

  // ---------- usage / audit log ----------
  app.get('/api/activity', requireRole('admin', 'manager'), (req, res) => {
    const sc = scopeSql(req.user);
    const where = [sc.sql]; const params = [...sc.params];
    if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)); }
    if (req.query.user_id) { where.push('a.user_id = ?'); params.push(Number(req.query.user_id)); }
    if (req.query.search) { where.push('(u.name LIKE ? OR a.details LIKE ?)'); const s = `%${req.query.search}%`; params.push(s, s); }
    const whereSql = where.join(' AND ');
    const limit = intParam(req.query.limit, 50); const page = intParam(req.query.page, 1, 1, 100000);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM activity_log a JOIN users u ON u.id = a.user_id WHERE ${whereSql}`).get(...params).n;
    const rows = db.prepare(`SELECT a.*, u.name FROM activity_log a JOIN users u ON u.id = a.user_id
      WHERE ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    const topUsers = db.prepare(`SELECT u.id, u.name, COUNT(*) AS n FROM activity_log a JOIN users u ON u.id = a.user_id
      WHERE ${sc.sql} AND a.created_at >= datetime('now','-30 days') GROUP BY u.id ORDER BY n DESC LIMIT 10`).all(...sc.params);
    const byAction = db.prepare(`SELECT a.action, COUNT(*) AS n FROM activity_log a JOIN users u ON u.id = a.user_id
      WHERE ${sc.sql} AND a.created_at >= datetime('now','-30 days') GROUP BY a.action ORDER BY n DESC`).all(...sc.params);
    const topPages = db.prepare(`SELECT a.details AS page, COUNT(*) AS n FROM activity_log a JOIN users u ON u.id = a.user_id
      WHERE ${sc.sql} AND a.action = 'page_view' AND a.created_at >= datetime('now','-30 days')
      GROUP BY a.details ORDER BY n DESC LIMIT 8`).all(...sc.params);
    res.json({ total, page, limit, rows, topUsers, byAction, topPages });
  });

  app.use('/api', (req, res) => { throw new HttpError(404, 'Not found'); });

  // ---------- static frontend ----------
  // Serves the Angular production build; unknown non-API paths fall back to index.html (client-side routing).
  const staticDir = opts.staticDir || path.join(__dirname, '..', 'client', 'dist', 'crm-client', 'browser');
  app.use(express.static(staticDir, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    res.sendFile(path.join(staticDir, 'index.html'), (err) => err && next());
  });

  // ---------- errors ----------
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}

module.exports = { createApp };
