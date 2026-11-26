'use strict';
const { open } = require('./db');
const { createApp } = require('./app');

const db = open();
const empty = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
if (empty) {
  console.log('Empty database - seeding demo data (100 employees)...');
  require('./seed').seed(db);
}

const port = Number(process.env.PORT || 3000);
const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === '1' });
app.listen(port, () => console.log(`CRM running on http://localhost:${port}`));
