// Body Recomp — Cloudflare Worker
// /api/* を処理し、それ以外は public/ の静的アセットを返す。
// 認証: 単一ユーザー想定のトークン (AUTH_TOKEN secret)。過剰にしない。

const ENTRY_COLUMNS = [
  'weight', 'scale', 'body_fat',
  'meal_breakfast', 'meal_lunch', 'meal_dinner', 'meal_snack',
  'alcohol', 'alcohol_detail', 'alcohol_g',
  'exercise', 'exercise_detail', 'bowel',
  'sleep_start', 'sleep_end', 'sleep_note',
  'feeling', 'spending', 'events', 'no_evening_carbs', 'note', 'source',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

function getToken(request, url) {
  const h = request.headers.get('authorization');
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return url.searchParams.get('token');
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (!env.AUTH_TOKEN) {
    return json({ error: 'AUTH_TOKEN が未設定です。`wrangler secret put AUTH_TOKEN`(本番) か .dev.vars(ローカル) で設定してください。' }, 500);
  }
  const token = getToken(request, url);
  if (!token || !timingSafeEqual(token, env.AUTH_TOKEN)) return unauthorized();

  // GET /api/me — トークン確認用
  if (path === '/api/me' && method === 'GET') {
    return json({ ok: true });
  }

  // GET /api/entries?from=YYYY-MM-DD&to=YYYY-MM-DD
  if (path === '/api/entries' && method === 'GET') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    let sql = 'SELECT * FROM entries';
    const cond = [];
    const binds = [];
    if (from && DATE_RE.test(from)) { cond.push('date >= ?'); binds.push(from); }
    if (to && DATE_RE.test(to)) { cond.push('date <= ?'); binds.push(to); }
    if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
    sql += ' ORDER BY date ASC';
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ entries: results });
  }

  // /api/entries/:date
  const entryMatch = path.match(/^\/api\/entries\/(\d{4}-\d{2}-\d{2})$/);
  if (entryMatch) {
    const date = entryMatch[1];

    if (method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM entries WHERE date = ?').bind(date).first();
      return json({ entry: row ?? null });
    }

    // PUT: 部分更新可の upsert。body に含まれるキーだけ書き換える (途中保存対応)。
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
      const keys = ENTRY_COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(body, c));
      if (keys.length === 0) return json({ error: 'no updatable fields' }, 400);
      if (body.scale != null && !['akiya', 'horiuchi'].includes(body.scale)) {
        return json({ error: 'scale must be akiya|horiuchi' }, 400);
      }

      const insertCols = ['date', ...keys, 'updated_at'];
      const placeholders = insertCols.map(() => '?');
      const updates = keys.map((k) => `${k} = excluded.${k}`).concat(`updated_at = excluded.updated_at`);
      const sql = `INSERT INTO entries (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})
                   ON CONFLICT(date) DO UPDATE SET ${updates.join(', ')}`;
      const now = new Date().toISOString();
      const binds = [date, ...keys.map((k) => body[k] === '' ? null : body[k]), now];
      await env.DB.prepare(sql).bind(...binds).run();
      const row = await env.DB.prepare('SELECT * FROM entries WHERE date = ?').bind(date).first();
      return json({ entry: row });
    }

    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM entries WHERE date = ?').bind(date).run();
      return json({ ok: true });
    }
  }

  // GET /api/history — 長期文脈 (weightbot 日次 + 年次平均)
  if (path === '/api/history' && method === 'GET') {
    const [daily, yearly] = await Promise.all([
      env.DB.prepare('SELECT date, weight, source FROM history_weights ORDER BY date ASC').all(),
      env.DB.prepare('SELECT year, avg, low, high, note, source FROM history_yearly ORDER BY year ASC').all(),
    ]);
    return json({ daily: daily.results, yearly: yearly.results });
  }

  // GET /api/settings
  if (path === '/api/settings' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
    const settings = Object.fromEntries(results.map((r) => [r.key, r.value]));
    if (!('scale_offset' in settings)) settings.scale_offset = '1.5';
    return json({ settings });
  }

  // PUT /api/settings — {key: value, ...}
  if (path === '/api/settings' && method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
    const stmts = Object.entries(body)
      .filter(([k]) => /^[a-z_]{1,64}$/.test(k))
      .map(([k, v]) => env.DB.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(k, String(v)));
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true });
  }

  // POST /api/health-sync — iOSショートカットからの体重取り込み。
  // body: { scale: "akiya"|"horiuchi", samples: [{date, weight, body_fat?}] }
  // または単発: { date, weight, body_fat?, scale }
  // 手入力を尊重し、weight が未記録の日だけ埋める (上書きしない)。
  if (path === '/api/health-sync' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
    const scale = body.scale;
    if (!['akiya', 'horiuchi'].includes(scale)) {
      return json({ error: 'scale must be akiya|horiuchi (どちらの体重計で測ったか)' }, 400);
    }
    const samples = Array.isArray(body.samples) ? body.samples : [body];
    const now = new Date().toISOString();
    let filled = 0, skipped = 0;
    for (const s of samples) {
      const date = String(s.date ?? '').slice(0, 10);
      const weight = Number(s.weight);
      if (!DATE_RE.test(date) || !Number.isFinite(weight) || weight < 30 || weight > 200) { skipped++; continue; }
      const existing = await env.DB.prepare('SELECT weight FROM entries WHERE date = ?').bind(date).first();
      if (existing && existing.weight != null) { skipped++; continue; }
      const bodyFat = Number.isFinite(Number(s.body_fat)) ? Number(s.body_fat) : null;
      await env.DB.prepare(
        `INSERT INTO entries (date, weight, scale, body_fat, source, updated_at)
         VALUES (?, ?, ?, ?, 'health', ?)
         ON CONFLICT(date) DO UPDATE SET
           weight = excluded.weight, scale = excluded.scale,
           body_fat = COALESCE(excluded.body_fat, entries.body_fat),
           updated_at = excluded.updated_at`
      ).bind(date, weight, scale, bodyFat, now).run();
      filled++;
    }
    return json({ ok: true, filled, skipped });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return json({ error: String(e?.message ?? e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
