#!/usr/bin/env node
/* leads-key.cjs — alpha.166 (Fixed › Leads): puts the section's protection key in /apps/unified/.env ONCE.
 * LEADS_PII_KEY (64 hex) encrypts imported contacts and hashes mobile / ID numbers for matching; without it the harvest and
 * the batch import stay paused. Generated here with the OS random source, written with the file's own permissions, NEVER
 * printed. A key already set is left alone — changing it would orphan every hash already stored.
 *   cd /apps/unified/server && node scripts/leads-key.cjs        (then restart the PM2 apps from the ecosystem file) */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ENV = process.env.LEADS_ENV_FILE || path.join(__dirname, '..', '..', '.env');
if (!fs.existsSync(ENV)) { console.log('FAILED no .env at', ENV); process.exit(1); }
const text = fs.readFileSync(ENV, 'utf8');
const lines = text.split('\n');
const at = lines.findIndex(l => /^\s*LEADS_PII_KEY\s*=/.test(l));
const cur = at >= 0 ? lines[at].slice(lines[at].indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
if (/^[0-9a-f]{64}$/i.test(cur) || cur.length >= 32) { console.log('LEADS_PII_KEY already set in', ENV, '— unchanged'); process.exit(0); }
const key = crypto.randomBytes(32).toString('hex');
const mode = fs.statSync(ENV).mode & 0o777;
fs.copyFileSync(ENV, ENV + '.bak-leads-key'); fs.chmodSync(ENV + '.bak-leads-key', 0o600);
if (at >= 0) lines[at] = 'LEADS_PII_KEY=' + key;
else { if (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push('# Fixed › Leads (alpha.166) — protection key, set once, never change', 'LEADS_PII_KEY=' + key, ''); }
fs.writeFileSync(ENV, lines.join('\n'), { mode });
const check = fs.readFileSync(ENV, 'utf8').split('\n').filter(l => /^LEADS_PII_KEY=[0-9a-f]{64}$/.test(l)).length;
console.log(check === 1 ? `LEADS_PII_KEY ${at >= 0 ? 'filled in' : 'added to'} ${ENV} (64 hex, not shown) · backup ${path.basename(ENV)}.bak-leads-key` : 'FAILED the key line is not in place — restore from the backup');
process.exit(check === 1 ? 0 : 1);
