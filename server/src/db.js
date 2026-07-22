const { Pool } = require('pg');

const SOURCE_URL = process.env.SOURCE_DATABASE_URL
  || 'postgres://postgres:postgres@db:5432/salam_development_11';
const CONSOLE_URL = process.env.CONSOLE_DATABASE_URL
  || 'postgres://postgres:postgres@db:5432/mvno_console';

const source = new Pool({ connectionString: SOURCE_URL, max: 4, statement_timeout: 60000 });
const console_ = new Pool({ connectionString: CONSOLE_URL, max: 4 });

module.exports = { source, console: console_, SOURCE_URL, CONSOLE_URL };
