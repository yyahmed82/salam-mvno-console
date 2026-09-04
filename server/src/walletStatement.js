/* DEALER WALLET STATEMENT — reproduces the report Ops raises tickets for.
 *
 * THE ASK (INC0020115, 19 Aug 2026): "commission deposit report for pos_016740 from 10 Aug to
 * 19 Aug". Today that is a P4 ticket to the app team; the sample they returned is pos_016740.xlsx.
 *
 * WHAT THE SAMPLE ACTUALLY IS — worth being precise, because the name misleads:
 * it is a WALLET STATEMENT, not a commission report. 202 rows, 11 columns:
 *   username · updated_on · amount · account_from · account_to · comments · status ·
 *   transaction_type · source_system · net_amount · running_balance
 * transaction_type ∈ {CASH, COMMISSION, WALLET_TRANSFER, BULK_WALLET_TRANSFER};
 * source_system ∈ {TRMS, TRMS_COMMISSION}. Commission is one movement type among several, so a
 * report built from commission_history alone would MISS the cash-outs and top-ups that explain
 * the balance — which is usually the actual question behind the ticket.
 *
 * TWO RULES VERIFIED AGAINST THE SAMPLE, NOT ASSUMED:
 *   1. net_amount = +amount when account_to is the dealer's wallet, −amount when account_from is.
 *      Checked across the file: holds without exception.
 *   2. running_balance is NOT a cumulative sum of the listed rows. In the sample it breaks
 *      exactly where the requested window starts (row 20, 10 Aug): the rows before it are older
 *      history, so the carried figure comes from the source system, not from adding up what is
 *      shown. Therefore: if the source table stores a balance-after column we output it as-is; if
 *      it does not, we compute a running total from an opening balance and SAY SO in the file.
 *      Silently computing a number the business reads as authoritative would be the wrong move.
 *
 * The source table is DISCOVERED, not hard-coded: trms_wallet has nine tables and we have
 * inspected two. Any table carrying the from/to/amount/type shape is accepted, and if none is
 * found the caller is told which tables exist so the gap can be closed in one step.
 *
 * Read-only.
 */
'use strict';

const D = require('./dmsDb');
const SCH = 'trms_wallet';

/* column synonyms — the schema is inconsistent elsewhere (external_refrence, fpe_vlaue_type),
 * so every field is matched against the spellings it plausibly uses */
const SYN = {
  /* Broadened after wallet_payment_commit / _initiate failed to match at all: they hold the bulk
   * of the data (1.9 M / 5.8 M rows) yet were not even candidates, which means their account
   * columns are spelled differently again. Cheap to widen; the alternative is missing the ledger. */
  from: ['account_from', 'from_account', 'source_account', 'debit_account', 'sender_account',
    'from_account_number', 'payer_account', 'src_account', 'account_number_from', 'wallet_from'],
  to: ['account_to', 'to_account', 'destination_account', 'credit_account', 'receiver_account',
    'to_account_number', 'payee_account', 'dest_account', 'account_number_to', 'wallet_to'],
  amount: ['amount', 'txn_amount', 'transaction_amount', 'value'],
  when: ['updated_on', 'created_on', 'transaction_date', 'txn_date', 'updated_at', 'created_at', 'insert_date'],
  type: ['transaction_type', 'txn_type', 'type', 'trans_type'],
  status: ['status', 'txn_status', 'transaction_status'],
  comments: ['comments', 'comment', 'remarks', 'description', 'narration'],
  source: ['source_system', 'system', 'source'],
  balance: ['running_balance', 'balance_after', 'closing_balance', 'available_balance', 'balance'],
  ref: ['reference', 'reference_id', 'txn_id', 'transaction_id', 'external_refrence', 'external_reference']
};

/* THE LEDGER IS `wallet_payment_initiate` — and my earlier reasoning about it was WRONG.
 * I argued "initiate = attempts, commit = completed movements, so counting initiates inflates the
 * money". The actual columns say otherwise:
 *   wallet_payment_initiate (13 cols): amount · transaction_type · source_system · account_to ·
 *     account_from · comments · status · created_on · updated_on · signature · created_by
 *     → every single source column of the sample report, including STATUS.
 *   wallet_payment_commit (5 cols): id · payment_initiate_id · created_on · created_by · comments
 *     → no amount, no accounts. It is a CHILD record marking which initiate was committed.
 *   payment_history (9 cols): the same shape as initiate, but empty.
 * So an initiate row is not a discarded attempt: it carries the status the report prints (PAID),
 * and commit merely references it. The name misled me; the schema did not.
 *
 * INDEXES: on wallet_payment_initiate only `id` (PRI) and `signature` (UNI) are indexed — NOT
 * account_from/account_to, and not the timestamps. Any per-dealer query is therefore a scan of
 * 5.8 M rows / 2.7 GB. It is attempted only when a date range bounds it, with a 60 s budget, and
 * the plan says so plainly. The durable fix is an index; see `index_recommendation` below. */
let _tableCache = null;
async function findTable() {
  if (_tableCache) return _tableCache;
  /* Row counts come with the table list now. The first attempt chose `payment_history` — it has
   * exactly the right column shape AND a promising name, and it holds ZERO ROWS. Shape and name
   * are both cheap to fake; only content makes a table the ledger. An empty table is disqualified
   * outright rather than merely down-weighted, because no amount of structural elegance makes it
   * the answer. */
  const meta = await D.q(
    `SELECT table_name, table_rows, round((data_length+index_length)/1024/1024) mb
       FROM information_schema.tables WHERE table_schema = ?`, [SCH]);
  const rowsOf = new Map(meta.map(r => [String(r.TABLE_NAME || r.table_name).toLowerCase(),
    { rows: Number(r.TABLE_ROWS || r.table_rows || 0), mb: Number(r.mb || 0) }]));
  const tables = meta.map(r => String(r.TABLE_NAME || r.table_name));
  const forced = String(process.env.DMS_WALLET_TABLE || '').trim();
  const scored = [], rejected = [];
  for (const t of tables) {
    const cols = await D.columnsOf(SCH, t);
    if (!cols.size) continue;
    const pick = keys => keys.find(k => cols.has(k.toLowerCase())) || null;
    const m = {
      table: t, from: pick(SYN.from), to: pick(SYN.to), amount: pick(SYN.amount),
      when: pick(SYN.when), type: pick(SYN.type), status: pick(SYN.status),
      comments: pick(SYN.comments), source: pick(SYN.source), balance: pick(SYN.balance),
      ref: pick(SYN.ref), columns: [...cols]
    };
    /* Indexed account columns dominate the score: they decide whether a per-dealer query is
     * servable at all. Table NAME is deliberately not scored — it pointed at the wrong table
     * twice (`payment_history` for its name, `initiate` for a meaning it does not have). */
    const idx = await D.indexedCols(SCH, t);
    const size = rowsOf.get(t.toLowerCase()) || { rows: 0, mb: 0 };
    m.est_rows = size.rows; m.mb = size.mb;
    m.indexed = { from: idx.has(String(m.from || '').toLowerCase()), to: idx.has(String(m.to || '').toLowerCase()),
      when: idx.has(String(m.when || '').toLowerCase()) };
    m.queryable = m.indexed.from || m.indexed.to || m.indexed.when;
    if (!(m.from && m.to && m.amount)) continue;                       // wrong shape entirely
    /* `information_schema.table_rows` is an ESTIMATE for InnoDB and can read 0 for a table that
     * holds data, when statistics were never gathered. Rejecting payment_history on that number
     * alone would repeat exactly the mistake made earlier today, when per-node data_length was
     * read as proof that Galera nodes had diverged. An estimate is a hint; only a read is proof.
     * So confirm emptiness with a single indexed-free `LIMIT 1` — costs nothing, settles it. */
    if (m.est_rows <= 0 && !(forced && forced.toLowerCase() === t.toLowerCase())) {
      let reallyEmpty = true;
      try { const probe = await D.q(`SELECT 1 AS x FROM \`${SCH}\`.\`${t}\` LIMIT 1`); reallyEmpty = !probe.length; }
      catch (e) { reallyEmpty = true; }
      if (reallyEmpty) { rejected.push({ table: t, why: 'empty — confirmed by SELECT 1 LIMIT 1', est_rows: 0 }); continue; }
      m.est_rows = -1;   // has rows; the estimate was stale
      m.stale_stats = true;
    }
    m.score = (m.when ? 1 : 0) + (m.type ? 1 : 0) + (m.status ? 1 : 0) + (m.source ? 1 : 0)
      + (m.indexed.from || m.indexed.to ? 6 : 0)   // a per-dealer query we can actually serve
      + (m.indexed.when ? 2 : 0)
      // the sample's full shape — status + source_system + comments + type together are the
      // signature of the report; no name-based bonus, since names misled twice already
      + (m.status && m.source && m.comments && m.type ? 3 : 0);
    scored.push(m);
  }
  scored.sort((a, b) => b.score - a.score);
  const chosen = (forced && scored.find(s => s.table.toLowerCase() === forced.toLowerCase())) || scored[0] || null;
  /* If nothing usable was found, the answer is in the columns of the tables we could not match —
   * hand those back rather than making the next person go and look. */
  let unmatched = [];
  if (!scored.length) {
    const big = meta.slice().sort((a, b) => Number(b.TABLE_ROWS || b.table_rows || 0) - Number(a.TABLE_ROWS || a.table_rows || 0)).slice(0, 4);
    for (const b of big) {
      const nm = String(b.TABLE_NAME || b.table_name);
      unmatched.push({ table: nm, est_rows: Number(b.TABLE_ROWS || b.table_rows || 0), columns: [...(await D.columnsOf(SCH, nm))] });
    }
  }
  _tableCache = {
    chosen, considered: tables, forced: forced || null, rejected, unmatched,
    /* Keep the runners-up visible. If the report ever looks wrong, the first question is "did it
     * read attempts instead of commits?", and the answer should be one field away, not a
     * re-investigation. */
    alternatives: scored.filter(s => chosen && s.table !== chosen.table)
      .map(s => ({ table: s.table, score: s.score, est_rows: s.est_rows, mb: s.mb, indexed: s.indexed,
        has: { from: s.from, to: s.to, amount: s.amount, when: s.when, type: s.type, status: s.status, balance: s.balance } }))
  };
  return _tableCache;
}

const D2 = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* rows for one dealer wallet account within [from,to] */
async function statement(dealer, { from, to, limit = 5000 } = {}) {
  if (!D.configured()) return { ok: false, error: 'DMS database not configured' };
  const acct = dealer && dealer.account_number;
  if (!acct) return { ok: false, error: 'This dealer has no wallet account_number, so there is no statement to produce.' };

  const t = await findTable();
  if (!t.chosen) return { ok: false,
    error: 'No usable wallet transaction table found in trms_wallet (tables with the right shape were empty, or none matched).',
    tables_considered: t.considered, rejected: t.rejected, unmatched_columns: t.unmatched,
    hint: 'Run: node dms-discover.cjs --list trms_wallet   then --columns for the likely table.' };
  const M = t.chosen;

  const cols = [];
  const add = (c, alias) => { if (c) cols.push(`\`${c}\` AS \`${alias}\``); else cols.push(`NULL AS \`${alias}\``); };
  add(M.when, 'updated_on'); add(M.amount, 'amount'); add(M.from, 'account_from'); add(M.to, 'account_to');
  add(M.comments, 'comments'); add(M.status, 'status'); add(M.type, 'transaction_type');
  add(M.source, 'source_system'); add(M.balance, 'src_balance'); add(M.ref, 'reference');

  /* WHY THIS IS NOT ONE `WHERE from = ? OR to = ?`
   * The first live run died with "Query inactivity timeout". An OR across two columns very often
   * defeats the index (MySQL must either merge two index scans or fall back to a full scan), and
   * wallet_payment_initiate is 5.8 M rows / 2.7 GB — a scan there will never finish inside a
   * request. So: check which columns are actually INDEXED, then run the two sides as separate
   * indexed lookups and merge with UNION ALL. If neither account column is indexed, say so and
   * stop, rather than issuing a query that is guaranteed to time out. */
  const idx = await D.indexedCols(SCH, M.table);
  const fromIdx = idx.has(String(M.from).toLowerCase());
  const toIdx = idx.has(String(M.to).toLowerCase());
  const whenIdx = M.when && idx.has(String(M.when).toLowerCase());
  const cap = Math.min(20000, Number(limit) || 5000);

  const timeWhere = [], timeParams = [];
  if (M.when && from) { timeWhere.push(`\`${M.when}\` >= ?`); timeParams.push(from); }
  if (M.when && to) { timeWhere.push(`\`${M.when}\` <= ?`); timeParams.push(to); }
  const tw = timeWhere.length ? ' AND ' + timeWhere.join(' AND ') : '';

  let rows, plan;
  if (fromIdx || toIdx) {
    /* Two indexed lookups, unioned. Each side is a single-column equality — the shape an index
     * serves best — and the date range narrows it further. */
    const side = c => `SELECT ${cols.join(', ')} FROM \`${SCH}\`.\`${M.table}\` WHERE \`${c}\` = ?${tw}`;
    const parts = [], params = [];
    if (fromIdx) { parts.push(side(M.from)); params.push(acct, ...timeParams); }
    if (toIdx) { parts.push(side(M.to)); params.push(acct, ...timeParams); }
    // if only one side is indexed the other is still needed for correctness — add it, but the
    // date range keeps it bounded, and we flag the plan so a slow report is explainable
    if (fromIdx && !toIdx) { parts.push(side(M.to)); params.push(acct, ...timeParams); }
    if (toIdx && !fromIdx) { parts.push(side(M.from)); params.push(acct, ...timeParams); }
    const sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) x ${M.when ? `ORDER BY \`updated_on\` ASC` : ''} LIMIT ${cap}`;
    plan = `indexed union (${fromIdx ? M.from : ''}${fromIdx && toIdx ? ' + ' : ''}${toIdx ? M.to : ''})`;
    rows = await D.qSlow(sql, params, 60000);
  } else if (whenIdx && from && to) {
    plan = `time-range scan on ${M.when} (account columns are NOT indexed)`;
    rows = await D.qSlow(
      `SELECT ${cols.join(', ')} FROM \`${SCH}\`.\`${M.table}\`
        WHERE ${timeWhere.join(' AND ')} AND (\`${M.from}\` = ? OR \`${M.to}\` = ?)
        ORDER BY \`${M.when}\` ASC LIMIT ${cap}`, [...timeParams, acct, acct], 60000);
  } else if (from && to) {
    /* Nothing useful is indexed, but the ledger IS this table — refusing outright would leave the
     * report unbuildable forever. A date-bounded scan is attempted instead, with the slow budget,
     * and the plan says exactly what it is so a timeout is understood rather than mysterious.
     * Narrow windows (a ticket asks for 10 days) are what this is sized for. */
    plan = `FULL SCAN of ${SCH}.${M.table} (~${M.mb || '?'} MB) — no index on ${M.from}/${M.to} or ${M.when}. Bounded by the date range; narrow the window if it times out.`;
    rows = await D.qSlow(
      `SELECT ${cols.join(', ')} FROM \`${SCH}\`.\`${M.table}\`
        WHERE (\`${M.from}\` = ? OR \`${M.to}\` = ?)${tw}
        ${M.when ? `ORDER BY \`${M.when}\` ASC` : ''} LIMIT ${cap}`,
      [acct, acct, ...timeParams], 60000);
  } else {
    return { ok: false,
      error: `A date range is required for this dealer: ${SCH}.${M.table} has no index on ${M.from}/${M.to} or ${M.when || 'any timestamp'}, `
        + `so an unbounded per-dealer query would scan the whole table (~${M.mb || '?'} MB) and time out.`,
      indexed_columns: [...idx],
      chosen_table: { table: M.table, est_rows: M.est_rows, mb: M.mb },
      index_recommendation: `CREATE INDEX idx_${M.table}_acct_from ON ${SCH}.${M.table} (${M.from}, ${M.when}); `
        + `CREATE INDEX idx_${M.table}_acct_to ON ${SCH}.${M.table} (${M.to}, ${M.when});`,
      fix: 'Pick a from/to range (a 10-day window is what the ticket asks for), or ask the DMS DBA for the two indexes above.' };
  }

  /* Opening balance: the figure the statement starts from. Only meaningful if we must compute
   * the running total ourselves — see the header note. */
  let computed = !M.balance, opening = null;
  if (computed && M.when && from) {
    try {
      const p = await D.q(
        `SELECT sum(CASE WHEN \`${M.to}\` = ? THEN ${'`' + M.amount + '`'} ELSE -${'`' + M.amount + '`'} END) bal
           FROM \`${SCH}\`.\`${M.table}\` WHERE (\`${M.from}\` = ? OR \`${M.to}\` = ?) AND \`${M.when}\` < ?`,
        [acct, acct, acct, from]);
      opening = D2(p[0] && p[0].bal);
    } catch (e) { opening = null; }
  }

  let run = opening || 0;
  const out = rows.map(r => {
    const amt = D2(r.amount);
    const inbound = String(r.account_to) === String(acct);
    const net = inbound ? amt : -amt;
    run += net;
    return {
      username: dealer.username, updated_on: r.updated_on, amount: amt,
      account_from: r.account_from, account_to: r.account_to,
      comments: r.comments, status: r.status, transaction_type: r.transaction_type,
      source_system: r.source_system, net_amount: net,
      running_balance: M.balance && r.src_balance != null ? D2(r.src_balance) : run,
      reference: r.reference
    };
  });

  const sum = (f) => out.reduce((a, r) => a + f(r), 0);
  return {
    ok: true, account_number: acct, rows: out, count: out.length,
    window: { from: from || null, to: to || null },
    totals: {
      in: sum(r => r.net_amount > 0 ? r.net_amount : 0),
      out: sum(r => r.net_amount < 0 ? r.net_amount : 0),
      net: sum(r => r.net_amount),
      commission: sum(r => /commission/i.test(String(r.transaction_type || '')) ? r.net_amount : 0),
      closing: out.length ? out[out.length - 1].running_balance : null
    },
    /* The sample is PAID-only. Rather than filter silently — which would hide a pending or failed
     * movement the dealer is asking about — every status is returned and counted here, so a row
     * count that differs from the official report is explainable at a glance. */
    by_status: Object.entries(out.reduce((m, r) => {
      const k = r.status || '—'; m[k] = (m[k] || 0) + 1; return m;
    }, {})).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    by_type: Object.entries(out.reduce((m, r) => {
      const k = r.transaction_type || '—'; m[k] = m[k] || { n: 0, net: 0 }; m[k].n++; m[k].net += r.net_amount; return m;
    }, {})).map(([type, v]) => ({ type, count: v.n, net: v.net })).sort((a, b) => b.count - a.count),
    source: { schema: SCH, table: M.table, balance_column: M.balance || null,
      chosen_by: t.forced ? 'DMS_WALLET_TABLE' : 'shape + content + indexes', query_plan: plan,
      est_rows: M.est_rows, mb: M.mb, indexed: M.indexed, rejected: t.rejected,
      index_recommendation: (M.indexed.from || M.indexed.to) ? null
        : `CREATE INDEX idx_${M.table}_acct_from ON ${SCH}.${M.table} (${M.from}, ${M.when}); `
          + `CREATE INDEX idx_${M.table}_acct_to ON ${SCH}.${M.table} (${M.to}, ${M.when});`,
      alternatives: t.alternatives,
      columns_used: { from: M.from, to: M.to, amount: M.amount, when: M.when, type: M.type,
        status: M.status, comments: M.comments, source_system: M.source, balance: M.balance },
      running_balance_basis: M.balance
        ? `taken from the source column \`${M.balance}\``
        : `COMPUTED here (the table has no balance-after column)${opening != null ? `, from an opening balance of ${opening}` : ', with no opening balance available — treat it as a movement total, not a wallet balance'}` },
    truncated: out.length >= Math.min(20000, Number(limit) || 5000)
  };
}

module.exports = { statement, findTable };
