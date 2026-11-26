'use strict';
// Generates a realistic demo dataset: 100 employees, ~6 months of finances, logins and usage.
const { open, hashPassword, tx } = require('./db');

function rng(seed) { // mulberry32 - deterministic so demo data is reproducible
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OFFICES = [
  ['Hyderabad HQ', 'Hyderabad', 'India', 'HITEC City, Madhapur', 17.4483, 78.3915],
  ['Bengaluru', 'Bengaluru', 'India', 'Outer Ring Road, Bellandur', 12.9279, 77.6271],
  ['New York', 'New York', 'USA', '5th Avenue, Manhattan', 40.7536, -73.9832],
  ['London', 'London', 'UK', 'Shoreditch, EC2A', 51.5246, -0.0786],
  ['Singapore', 'Singapore', 'Singapore', 'Marina Bay', 1.2834, 103.8607],
];
const DEPTS = {
  Engineering: ['Software Engineer', 'Senior Software Engineer', 'QA Engineer', 'DevOps Engineer', 'Data Engineer'],
  Sales: ['Account Executive', 'Sales Development Rep', 'Account Manager'],
  Marketing: ['Marketing Specialist', 'Content Writer', 'Designer'],
  Finance: ['Accountant', 'Financial Analyst', 'Payroll Specialist'],
  'Human Resources': ['HR Generalist', 'Recruiter'],
  Operations: ['Operations Analyst', 'Office Administrator', 'IT Support'],
  Support: ['Support Engineer', 'Customer Success Manager'],
};
const FIRST = ['Aarav','Vivaan','Aditya','Ananya','Diya','Ishaan','Kavya','Rohan','Saanvi','Arjun','Meera','Neha','Rahul','Priya','Karthik','Sneha','Vikram','Pooja','Rajesh','Lakshmi','James','Emma','Oliver','Sophia','Liam','Mia','Noah','Ava','Lucas','Chloe','Wei','Mei','Hiro','Yuki','Omar','Fatima','Daniel','Grace','Samuel','Hannah'];
const LAST = ['Sharma','Reddy','Patel','Iyer','Nair','Gupta','Kumar','Rao','Singh','Menon','Smith','Johnson','Brown','Taylor','Wilson','Davies','Tan','Lim','Chen','Wong','Khan','Ahmed','Garcia','Martin','Clarke'];
const EXPENSE_CATS = ['Travel', 'Meals', 'Software', 'Hardware', 'Training', 'Office Supplies', 'Client Entertainment', 'Internet & Phone'];
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
];
const PAGES = ['/dashboard', '/employees', '/finances', '/logins', '/activity', '/map', '/profile'];

const DEMO_PASSWORD = 'Password@123';
const ADMIN_PASSWORD = 'Admin@123';

const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const day = (d) => d.toISOString().slice(0, 10);

function seed(db, { employees = 100, seed: s = 42 } = {}) {
  const r = rng(s);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const between = (a, b) => a + r() * (b - a);
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 86400000);
  // Hash once; per-user salts are not needed for throwaway demo accounts and this keeps seeding fast.
  const demoHash = hashPassword(DEMO_PASSWORD);

  tx(db, () => {
    const insOffice = db.prepare('INSERT INTO offices (name, city, country, address, lat, lng) VALUES (?,?,?,?,?,?)');
    const officeIds = OFFICES.map((o) => Number(insOffice.run(...o).lastInsertRowid));

    const insUser = db.prepare(`INSERT INTO users (email,password_hash,name,role,department,title,phone,salary,status,manager_id,office_id,hire_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const users = [];
    const used = new Set();
    const mkName = () => {
      for (;;) { const n = `${pick(FIRST)} ${pick(LAST)}`; if (!used.has(n)) { used.add(n); return n; } }
    };
    const email = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@acme.test`;

    // Admin
    const adminId = Number(insUser.run('admin@acme.test', hashPassword(ADMIN_PASSWORD), 'Admin User', 'admin', 'Operations',
      'CRM Administrator', '+91 90000 00000', 180000, 'active', null, officeIds[0], '2020-01-06').lastInsertRowid);
    users.push({ id: adminId, role: 'admin', department: 'Operations' });

    // One manager per department
    const managers = {};
    for (const dept of Object.keys(DEPTS)) {
      const name = mkName();
      const id = Number(insUser.run(email(name), demoHash, name, 'manager', dept, `${dept} Manager`,
        `+91 9${Math.floor(between(100000000, 999999999))}`, Math.round(between(120000, 170000) / 1000) * 1000,
        'active', adminId, pick(officeIds), day(daysAgo(between(900, 2400)))).lastInsertRowid);
      managers[dept] = id;
      users.push({ id, role: 'manager', department: dept });
    }

    // Remaining employees
    const deptNames = Object.keys(DEPTS);
    while (users.length < employees) {
      const dept = r() < 0.35 ? 'Engineering' : pick(deptNames);
      const name = mkName();
      const status = r() < 0.06 ? 'inactive' : 'active';
      const id = Number(insUser.run(email(name), demoHash, name, 'employee', dept, pick(DEPTS[dept]),
        `+91 9${Math.floor(between(100000000, 999999999))}`, Math.round(between(45000, 130000) / 500) * 500,
        status, managers[dept], pick(officeIds), day(daysAgo(between(30, 2000)))).lastInsertRowid);
      users.push({ id, role: 'employee', department: dept, status });
    }

    // Transactions: ~6 months
    const insTx = db.prepare(`INSERT INTO transactions (user_id,type,category,amount,description,status,date,reviewed_by,reviewed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const u of users) {
      const salaryRow = db.prepare('SELECT salary FROM users WHERE id = ?').get(u.id);
      for (let m = 5; m >= 0; m--) {
        const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - m);
        const payday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 28));
        if (payday.getTime() <= now && u.status !== 'inactive') {
          insTx.run(u.id, 'salary', 'Payroll', Math.round(salaryRow.salary / 12 * 100) / 100, 'Monthly salary', 'paid',
            day(payday), adminId, fmt(payday), fmt(payday));
        }
      }
      const nExp = Math.floor(between(2, 12));
      for (let i = 0; i < nExp; i++) {
        const when = daysAgo(between(0, 175));
        const cat = pick(EXPENSE_CATS);
        const amount = Math.round(between(cat === 'Hardware' ? 200 : 15, cat === 'Travel' || cat === 'Hardware' ? 2500 : 400) * 100) / 100;
        const age = (now - when.getTime()) / 86400000;
        const status = age < 10 ? (r() < 0.7 ? 'pending' : 'approved') : (r() < 0.08 ? 'rejected' : r() < 0.6 ? 'paid' : 'approved');
        const reviewer = status === 'pending' ? null : (u.role === 'employee' ? managers[u.department] : adminId);
        const reviewedAt = reviewer ? fmt(new Date(when.getTime() + between(1, 4) * 86400000)) : null;
        insTx.run(u.id, r() < 0.8 ? 'expense' : 'reimbursement', cat, amount, `${cat} - ${pick(['client visit', 'team offsite', 'project work', 'conference', 'monthly', 'quarterly'])}`,
          status, day(when), reviewer, reviewedAt, fmt(when));
      }
      if (r() < 0.15) {
        const when = daysAgo(between(0, 120));
        insTx.run(u.id, 'bonus', 'Performance Bonus', Math.round(between(1000, 8000)), 'Quarterly performance bonus', 'paid', day(when), adminId, fmt(when), fmt(when));
      }
      if (r() < 0.05) {
        const when = daysAgo(between(0, 20));
        insTx.run(u.id, 'advance', 'Salary Advance', Math.round(between(500, 3000)), 'Salary advance request', 'pending', day(when), null, null, fmt(when));
      }
    }

    // Login events, sessions durations, usage
    const insLogin = db.prepare(`INSERT INTO login_events (user_id,email,success,reason,ip,user_agent,created_at,logout_at) VALUES (?,?,?,?,?,?,?,?)`);
    const insAct = db.prepare(`INSERT INTO activity_log (user_id,action,entity,entity_id,details,ip,created_at) VALUES (?,?,?,?,?,?,?)`);
    const emailOf = db.prepare('SELECT email FROM users WHERE id = ?');
    for (const u of users) {
      const em = emailOf.get(u.id).email;
      const ip = `10.${Math.floor(between(0, 255))}.${Math.floor(between(0, 255))}.${Math.floor(between(1, 254))}`;
      const ua = pick(UAS);
      const engagement = u.status === 'inactive' ? 0 : r() < 0.08 ? 0.05 : between(0.3, 0.95); // some dormant users
      const lastDay = u.status === 'inactive' ? Math.floor(between(30, 60)) : (engagement < 0.1 ? Math.floor(between(15, 40)) : 0);
      for (let dAgo = 60; dAgo >= lastDay; dAgo--) {
        const date = daysAgo(dAgo);
        const wd = date.getUTCDay();
        if (wd === 0 || wd === 6 || r() > engagement) continue;
        const login = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(between(3, 10)), Math.floor(between(0, 59))));
        if (login.getTime() > now) continue;
        if (r() < 0.06) insLogin.run(u.id, em, 0, 'bad_credentials', ip, ua, fmt(new Date(login.getTime() - 60000)), null);
        const logout = new Date(login.getTime() + between(20, 480) * 60000);
        insLogin.run(u.id, em, 1, null, ip, ua, fmt(login), logout.getTime() < now ? fmt(logout) : null);
        insAct.run(u.id, 'login', null, null, null, ip, fmt(login));
        const views = Math.floor(between(1, 8));
        for (let v = 0; v < views; v++) {
          insAct.run(u.id, 'page_view', null, null, u.role === 'employee' ? pick(['/dashboard', '/finances', '/profile', '/logins']) : pick(PAGES),
            ip, fmt(new Date(login.getTime() + (v + 1) * between(1, 30) * 60000)));
        }
      }
    }
    // A few suspicious failed attempts for unknown accounts
    for (let i = 0; i < 12; i++) {
      insLogin.run(null, pick(['root@acme.test', 'test@acme.test', 'admin@acme.com']), 0, 'bad_credentials', `203.0.113.${Math.floor(between(1, 254))}`,
        'python-requests/2.32', fmt(daysAgo(between(0, 13))), null);
    }
  });
  return { adminEmail: 'admin@acme.test', adminPassword: ADMIN_PASSWORD, demoPassword: DEMO_PASSWORD };
}

module.exports = { seed, DEMO_PASSWORD, ADMIN_PASSWORD };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'crm.db');
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  const db = open(file);
  const info = seed(db);
  const c = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  console.log(`Seeded ${c('users')} employees, ${c('transactions')} transactions, ${c('login_events')} login events, ${c('activity_log')} activity rows.`);
  console.log(`Admin login: ${info.adminEmail} / ${info.adminPassword}   (other users: <email> / ${info.demoPassword})`);
}
