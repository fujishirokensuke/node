/* Body Recomp — フロントエンド (素のJS、ビルドなし)
   思想: ジャッジしない記録係。主指標は週平均。欠測は静かに空白。 */

'use strict';

// ---------- 状態 ----------
const state = {
  token: localStorage.getItem('br_token') || '',
  entries: [],          // date昇順
  history: { daily: [], yearly: [] },
  settings: { scale_offset: '1.5' },
  view: 'record',
  rangeDays: 0,         // 0 = 全期間
  feelingTouched: false,
};

const EVENT_TAGS = ['CC', 'Heart Reunion', 'リトリート', '宿泊', 'ケンカ'];
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + state.token,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) { showAuthGate(); throw new Error('unauthorized'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// ---------- 日付ユーティリティ ----------
const DAY = 86400000;
const toDate = (s) => new Date(s + 'T00:00:00Z');
const fmtISO = (d) => d.toISOString().slice(0, 10);
const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const fmtMD = (s) => { const d = toDate(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const fmtMDW = (s) => { const d = toDate(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${WD[d.getUTCDay()]}`; };
// 週 = 月曜はじまり。weekStart(date string) → その週の月曜 (ISO)
function weekStart(s) {
  const d = toDate(s);
  const dow = (d.getUTCDay() + 6) % 7; // 月=0
  return fmtISO(new Date(d.getTime() - dow * DAY));
}

// ---------- 換算 ----------
const offset = () => parseFloat(state.settings.scale_offset) || 0;
// 堀内基準へ換算。堀内/機種不明 → 実測のまま、秋谷 → -offset
function conv(e) {
  if (e.weight == null) return null;
  return e.scale === 'akiya' ? +(e.weight - offset()).toFixed(2) : e.weight;
}
const isConverted = (e) => e.weight != null && e.scale === 'akiya';
const fmtW = (v) => v == null ? '—' : v.toFixed(1);

// ---------- 集計 ----------
function weeksOf(entries) {
  const map = new Map();
  for (const e of entries) {
    const wk = weekStart(e.date);
    if (!map.has(wk)) map.set(wk, []);
    map.get(wk).push(e);
  }
  return map; // Map<weekStartISO, entries[]>
}
function avg(nums) {
  const xs = nums.filter((n) => n != null && Number.isFinite(n));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function weekAvgWeight(entries) {
  return avg(entries.map(conv));
}
function weekStats(weekEntries) {
  const measured = weekEntries.filter((e) => e.weight != null).length;
  const recorded = weekEntries.length;
  const alcoholFree = weekEntries.filter((e) => e.alcohol === 0).length;
  const noCarbs = weekEntries.filter((e) => e.no_evening_carbs === 1).length;
  const exercise = weekEntries.filter((e) => e.exercise === 1).length;
  const spend = avg(weekEntries.map((e) => e.spending));
  const feeling = avg(weekEntries.map((e) => e.feeling));
  return { measured, recorded, alcoholFree, noCarbs, exercise, spend, feeling };
}

// ---------- 認証 ----------
function showAuthGate() {
  $('#auth-gate').hidden = false;
  setTimeout(() => $('#auth-input').focus(), 50);
}
async function tryAuth(token) {
  const res = await fetch('/api/me', { headers: { authorization: 'Bearer ' + token } });
  return res.ok;
}
$('#auth-btn').addEventListener('click', async () => {
  const t = $('#auth-input').value.trim();
  if (!t) return;
  if (await tryAuth(t)) {
    state.token = t;
    localStorage.setItem('br_token', t);
    $('#auth-gate').hidden = true;
    $('#auth-err').textContent = '';
    boot();
  } else {
    $('#auth-err').textContent = '合いません。もう一度。';
  }
});
$('#auth-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('#auth-btn').click(); });

// ---------- ビュー切替 ----------
function switchView(v) {
  state.view = v;
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'chart') renderChartView();
  if (v === 'weekly') renderWeekly();
  if (v === 'ledger') renderLedger();
  if (v === 'settings') renderSettings();
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

// ---------- 記録フォーム ----------
function segValue(id) {
  const sel = document.querySelector(`#${id} button.selected`);
  return sel ? sel.dataset.v : '';
}
function segSet(id, v) {
  $$(`#${id} button`).forEach((b) => b.classList.toggle('selected', String(b.dataset.v) === String(v ?? '')));
}
function initSeg(id, onChange) {
  $$(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
    segSet(id, b.dataset.v);
    if (onChange) onChange(b.dataset.v);
  }));
}
initSeg('f-scale', () => { $('#f-bodyfat-wrap').hidden = segValue('f-scale') !== 'akiya'; });
initSeg('f-carbs');
initSeg('f-alcohol', (v) => { $('#f-alcohol-detail-wrap').hidden = v !== '1'; });
initSeg('f-exercise', (v) => { $('#f-exercise-detail-wrap').hidden = v !== '1'; });

// イベントチップ
const evWrap = $('#f-events');
for (const tag of EVENT_TAGS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip-btn';
  b.textContent = tag;
  b.dataset.tag = tag;
  b.addEventListener('click', () => b.classList.toggle('selected'));
  evWrap.appendChild(b);
}

// 通便クイックボタン: 記号 + 現在時刻を追記
$$('#bowel-btns button').forEach((b) => b.addEventListener('click', () => {
  const now = new Date();
  const t = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const ta = $('#f-bowel');
  ta.value = (ta.value ? ta.value.replace(/\s*$/, '') + '\n' : '') + `${b.dataset.q} ${t}`;
}));

$('#f-feeling').addEventListener('input', () => {
  state.feelingTouched = true;
  $('#feeling-value').textContent = $('#f-feeling').value;
});

function clearForm() {
  ['f-weight', 'f-bodyfat', 'f-meal-b', 'f-meal-l', 'f-meal-d', 'f-meal-s',
   'f-alcohol-detail', 'f-alcohol-g', 'f-exercise-detail', 'f-bowel',
   'f-sleep-start', 'f-sleep-end', 'f-sleep-note', 'f-spending', 'f-events-free', 'f-note']
    .forEach((id) => { $('#' + id).value = ''; });
  segSet('f-scale', localStorage.getItem('br_last_scale') || '');
  segSet('f-carbs', ''); segSet('f-alcohol', ''); segSet('f-exercise', '');
  $('#f-bodyfat-wrap').hidden = segValue('f-scale') !== 'akiya';
  $('#f-alcohol-detail-wrap').hidden = true;
  $('#f-exercise-detail-wrap').hidden = true;
  $$('#f-events .chip-btn').forEach((b) => b.classList.remove('selected'));
  state.feelingTouched = false;
  $('#f-feeling').value = 3;
  $('#feeling-value').textContent = '—';
  $('#save-status').textContent = '';
}

function fillForm(e) {
  clearForm();
  if (!e) return;
  const set = (id, v) => { $('#' + id).value = v ?? ''; };
  set('f-weight', e.weight);
  segSet('f-scale', e.scale ?? (localStorage.getItem('br_last_scale') || ''));
  $('#f-bodyfat-wrap').hidden = segValue('f-scale') !== 'akiya';
  set('f-bodyfat', e.body_fat);
  set('f-meal-b', e.meal_breakfast); set('f-meal-l', e.meal_lunch);
  set('f-meal-d', e.meal_dinner); set('f-meal-s', e.meal_snack);
  segSet('f-carbs', e.no_evening_carbs);
  segSet('f-alcohol', e.alcohol);
  $('#f-alcohol-detail-wrap').hidden = e.alcohol !== 1;
  set('f-alcohol-detail', e.alcohol_detail); set('f-alcohol-g', e.alcohol_g);
  segSet('f-exercise', e.exercise);
  $('#f-exercise-detail-wrap').hidden = e.exercise !== 1;
  set('f-exercise-detail', e.exercise_detail);
  set('f-bowel', e.bowel);
  set('f-sleep-start', e.sleep_start); set('f-sleep-end', e.sleep_end); set('f-sleep-note', e.sleep_note);
  if (e.feeling != null) {
    $('#f-feeling').value = e.feeling;
    $('#feeling-value').textContent = String(e.feeling);
    state.feelingTouched = true;
  }
  set('f-spending', e.spending);
  const tags = (e.events || '').split(',').map((s) => s.trim()).filter(Boolean);
  const free = [];
  for (const t of tags) {
    const chip = document.querySelector(`#f-events .chip-btn[data-tag="${CSS.escape(t)}"]`);
    if (chip) chip.classList.add('selected'); else free.push(t);
  }
  $('#f-events-free').value = free.join(', ');
  set('f-note', e.note);
}

async function loadFormDate(date) {
  const local = state.entries.find((e) => e.date === date);
  fillForm(local || null);
  if (!local) {
    try {
      const { entry } = await api('/api/entries/' + date);
      if (entry && $('#f-date').value === date) fillForm(entry);
    } catch { /* オフライン等は静かに */ }
  }
}
$('#f-date').addEventListener('change', () => loadFormDate($('#f-date').value));

function numOrNull(v) {
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

$('#save-btn').addEventListener('click', async () => {
  const date = $('#f-date').value;
  const status = $('#save-status');
  if (!date) { status.textContent = '日付を入れてください'; return; }
  const weight = numOrNull($('#f-weight').value);
  const scale = segValue('f-scale') || null;
  if (weight != null && !scale) { status.textContent = 'どちらの体重計か選んでください'; return; }
  if (scale) localStorage.setItem('br_last_scale', scale);

  const seg = (id) => { const v = segValue(id); return v === '' ? null : Number(v); };
  const tags = $$('#f-events .chip-btn.selected').map((b) => b.dataset.tag)
    .concat($('#f-events-free').value.split(',').map((s) => s.trim()).filter(Boolean));

  const body = {
    weight, scale,
    body_fat: scale === 'akiya' ? numOrNull($('#f-bodyfat').value) : null,
    meal_breakfast: $('#f-meal-b').value.trim() || null,
    meal_lunch: $('#f-meal-l').value.trim() || null,
    meal_dinner: $('#f-meal-d').value.trim() || null,
    meal_snack: $('#f-meal-s').value.trim() || null,
    no_evening_carbs: seg('f-carbs'),
    alcohol: seg('f-alcohol'),
    alcohol_detail: $('#f-alcohol-detail').value.trim() || null,
    alcohol_g: numOrNull($('#f-alcohol-g').value),
    exercise: seg('f-exercise'),
    exercise_detail: $('#f-exercise-detail').value.trim() || null,
    bowel: $('#f-bowel').value.trim() || null,
    sleep_start: $('#f-sleep-start').value.trim() || null,
    sleep_end: $('#f-sleep-end').value.trim() || null,
    sleep_note: $('#f-sleep-note').value.trim() || null,
    feeling: state.feelingTouched ? parseFloat($('#f-feeling').value) : null,
    spending: numOrNull($('#f-spending').value),
    events: tags.length ? tags.join(',') : null,
    note: $('#f-note').value.trim() || null,
    source: 'manual',
  };

  status.textContent = '保存中…';
  try {
    const { entry } = await api('/api/entries/' + date, { method: 'PUT', body: JSON.stringify(body) });
    const i = state.entries.findIndex((e) => e.date === date);
    if (i >= 0) state.entries[i] = entry;
    else { state.entries.push(entry); state.entries.sort((a, b) => a.date < b.date ? -1 : 1); }
    const now = new Date();
    status.textContent = `保存しました ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  } catch (err) {
    status.textContent = '保存できませんでした: ' + err.message;
  }
});

// 欠測が続いたあとの再開 — 静かに迎える
function renderWelcome() {
  const note = $('#welcome-note');
  const recorded = state.entries.filter((e) => e.weight != null || e.note || e.meal_dinner);
  if (!recorded.length) { note.hidden = true; return; }
  const last = recorded[recorded.length - 1].date;
  const gap = Math.round((toDate(todayISO()) - toDate(last)) / DAY);
  if (gap >= 3) {
    note.textContent = 'おかえりなさい。今日のぶんだけ、淡々と。';
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

// ---------- 推移 (ダッシュボード) ----------
$$('#range-filter .chip-btn').forEach((b) => b.addEventListener('click', () => {
  $$('#range-filter .chip-btn').forEach((x) => x.classList.remove('selected'));
  b.classList.add('selected');
  state.rangeDays = Number(b.dataset.days);
  renderChartView();
}));

function visibleEntries() {
  if (!state.rangeDays) return state.entries;
  const cutoff = fmtISO(new Date(toDate(todayISO()).getTime() - state.rangeDays * DAY));
  return state.entries.filter((e) => e.date >= cutoff);
}

function renderChartView() {
  renderTiles();
  renderChart();
  renderRules();
  renderLongChart();
}

function renderTiles() {
  const el = $('#tiles');
  el.textContent = '';
  const entries = state.entries;
  const weeks = weeksOf(entries);
  const thisWk = weekStart(todayISO());
  const lastWk = fmtISO(new Date(toDate(thisWk).getTime() - 7 * DAY));
  const firstWk = entries.length ? weekStart(entries[0].date) : null;

  const latest = [...entries].reverse().find((e) => e.weight != null);
  const wThis = weeks.has(thisWk) ? weekAvgWeight(weeks.get(thisWk)) : null;
  const wLast = weeks.has(lastWk) ? weekAvgWeight(weeks.get(lastWk)) : null;
  const wFirst = firstWk && weeks.has(firstWk) ? weekAvgWeight(weeks.get(firstWk)) : null;
  const ref = wThis ?? wLast;

  const tiles = [
    {
      label: '直近測定',
      value: latest ? fmtW(conv(latest)) : '—',
      sub: latest ? `${fmtMDW(latest.date)}${isConverted(latest) ? ' ※換算' : ''}` : '記録なし',
    },
    {
      label: '今週平均',
      value: fmtW(wThis),
      sub: wThis != null && wLast != null ? `先週比 ${(wThis - wLast) >= 0 ? '+' : ''}${(wThis - wLast).toFixed(1)}` : `測定 ${weeks.get(thisWk)?.filter((e) => e.weight != null).length ?? 0}日`,
    },
    { label: '先週平均', value: fmtW(wLast), sub: lastWk ? `${fmtMD(lastWk)}〜` : '' },
    {
      label: '開始週比',
      value: ref != null && wFirst != null ? `${(ref - wFirst) >= 0 ? '+' : ''}${(ref - wFirst).toFixed(1)}` : '—',
      sub: wFirst != null ? `開始週 ${fmtW(wFirst)}` : '',
    },
  ];
  for (const t of tiles) {
    const div = document.createElement('div');
    div.className = 'tile';
    const l = document.createElement('div'); l.className = 'label'; l.textContent = t.label;
    const v = document.createElement('div'); v.className = 'value'; v.textContent = t.value;
    if (t.value !== '—' && !t.label.includes('比')) {
      const u = document.createElement('span'); u.className = 'unit'; u.textContent = ' kg'; v.appendChild(u);
    }
    const s = document.createElement('div'); s.className = 'sub'; s.textContent = t.sub || '';
    div.append(l, v, s);
    el.appendChild(div);
  }
}

// ゾーン (堀内基準)
const ZONES = [
  { from: 78, to: Infinity, wash: 'var(--wash-danger)', label: 'DANGER' },
  { from: 76, to: 78, wash: 'var(--wash-watch)', label: 'WATCH' },
  { from: 73, to: 76, wash: 'none', label: 'PHASE 1' },
  { from: 70, to: 72, wash: 'var(--wash-goal)', label: 'GOAL' },
];

const CHART = { W: 700, H: 320, top: 18, right: 64, bottom: 26, left: 40 };
let chartMap = null; // tooltip用の座標マッピング

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderChart() {
  const svg = $('#chart');
  svg.textContent = '';
  const { W, H, top, right, bottom, left } = CHART;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const entries = visibleEntries();
  const measured = entries.filter((e) => e.weight != null);
  if (!measured.length) {
    const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 12 });
    t.textContent = 'まだ表示できる測定がありません';
    svg.appendChild(t);
    chartMap = null;
    return;
  }

  const d0 = toDate(entries[0].date).getTime();
  const d1 = Math.max(toDate(entries[entries.length - 1].date).getTime(), toDate(todayISO()).getTime());
  const span = Math.max(d1 - d0, DAY);
  const xOf = (dateStr) => left + (toDate(dateStr).getTime() - d0) / span * (W - left - right);

  const vals = measured.map(conv);
  let yMin = Math.floor(Math.min(...vals) - 0.6);
  let yMax = Math.ceil(Math.max(...vals) + 0.6);
  const yOf = (v) => top + (yMax - v) / (yMax - yMin) * (H - top - bottom);

  // ゾーン帯 (薄い塗り + 右端に小さなラベル)
  for (const z of ZONES) {
    const zTop = Math.min(z.to === Infinity ? yMax : z.to, yMax);
    const zBot = Math.max(z.from, yMin);
    if (zBot >= yMax || zTop <= yMin || zTop <= zBot) continue;
    if (z.wash !== 'none') {
      svg.appendChild(svgEl('rect', {
        x: left, y: yOf(zTop), width: W - left - right, height: yOf(zBot) - yOf(zTop), fill: z.wash,
      }));
    }
    const lbl = svgEl('text', {
      x: W - right + 6, y: yOf((zTop + zBot) / 2) + 3, fill: 'var(--muted)', 'font-size': 9, 'letter-spacing': '0.08em',
    });
    lbl.textContent = z.label;
    svg.appendChild(lbl);
  }

  // 横グリッド (1kg刻み、hairline)
  for (let v = yMin; v <= yMax; v++) {
    svg.appendChild(svgEl('line', { x1: left, y1: yOf(v), x2: W - right, y2: yOf(v), stroke: 'var(--hairline)', 'stroke-width': 1 }));
    const t = svgEl('text', { x: left - 6, y: yOf(v) + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 10 });
    t.textContent = v;
    svg.appendChild(t);
  }

  // X軸ラベル (週の月曜)
  let cursor = weekStart(entries[0].date);
  while (toDate(cursor).getTime() <= d1) {
    const x = xOf(cursor);
    if (x >= left - 1 && x <= W - right + 1) {
      const t = svgEl('text', { x, y: H - 8, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 });
      t.textContent = fmtMD(cursor);
      svg.appendChild(t);
    }
    cursor = fmtISO(new Date(toDate(cursor).getTime() + 7 * DAY));
  }

  // 日次ライン: 連続する測定日だけつなぐ (欠測はギャップ = 静かな空白)
  let path = '';
  for (let i = 0; i < measured.length; i++) {
    const e = measured[i];
    const prev = measured[i - 1];
    const gapDays = prev ? (toDate(e.date) - toDate(prev.date)) / DAY : Infinity;
    path += (gapDays <= 1.5 ? 'L' : 'M') + xOf(e.date).toFixed(1) + ' ' + yOf(conv(e)).toFixed(1) + ' ';
  }
  svg.appendChild(svgEl('path', {
    d: path.trim(), fill: 'none', stroke: 'var(--data-gray)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.75,
  }));

  // 週平均 (主指標、アクセント): 週の範囲に水平セグメント
  const weeks = weeksOf(measured);
  for (const [wk, wkEntries] of weeks) {
    const a = weekAvgWeight(wkEntries);
    if (a == null) continue;
    const x1 = Math.max(xOf(wk), left);
    const x2 = Math.min(xOf(fmtISO(new Date(toDate(wk).getTime() + 6 * DAY))), W - right);
    svg.appendChild(svgEl('line', {
      x1, y1: yOf(a), x2, y2: yOf(a), stroke: 'var(--accent)', 'stroke-width': 2.5, 'stroke-linecap': 'round',
    }));
  }

  // 日次ドット (サーフェスリング付き)
  for (const e of measured) {
    svg.appendChild(svgEl('circle', {
      cx: xOf(e.date), cy: yOf(conv(e)), r: 4,
      fill: 'var(--data-gray)', stroke: 'var(--card)', 'stroke-width': 2,
    }));
  }

  // イベントマーカー (上端に ▾)
  for (const e of entries) {
    if (!e.events) continue;
    const t = svgEl('text', { x: xOf(e.date), y: top - 5, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 });
    t.textContent = '▾';
    svg.appendChild(t);
  }

  // クロスヘア
  const cross = svgEl('line', { x1: 0, y1: top, x2: 0, y2: H - bottom, stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0 });
  svg.appendChild(cross);

  chartMap = { entries, xOf, d0, span, cross, weeks };
  attachChartPointer(svg);
}

let pointerAttached = false;
function attachChartPointer(svg) {
  if (pointerAttached) return;
  pointerAttached = true;
  const tip = $('#chart-tooltip');

  const onMove = (clientX, clientY) => {
    if (!chartMap) return;
    const rect = svg.getBoundingClientRect();
    const vx = (clientX - rect.left) / rect.width * CHART.W;
    // 最寄りの記録日にスナップ
    let best = null, bestDist = Infinity;
    for (const e of chartMap.entries) {
      const d = Math.abs(chartMap.xOf(e.date) - vx);
      if (d < bestDist) { bestDist = d; best = e; }
    }
    if (!best || bestDist > 40) { hide(); return; }

    const x = chartMap.xOf(best.date);
    chartMap.cross.setAttribute('x1', x);
    chartMap.cross.setAttribute('x2', x);
    chartMap.cross.setAttribute('opacity', 0.5);

    tip.textContent = '';
    const dt = document.createElement('div');
    dt.className = 'tt-date';
    dt.textContent = fmtMDW(best.date);
    tip.appendChild(dt);

    const addRow = (label, value, keyColor) => {
      const row = document.createElement('div');
      row.className = 'tt-row';
      const l = document.createElement('span');
      if (keyColor) {
        const k = document.createElement('span');
        k.className = 'tt-key';
        k.style.background = keyColor;
        l.appendChild(k);
      }
      l.appendChild(document.createTextNode(label));
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = value;
      row.append(l, v);
      tip.appendChild(row);
    };

    if (best.weight != null) {
      addRow('堀内基準', fmtW(conv(best)) + (isConverted(best) ? ' ※' : ''), 'var(--data-gray)');
      addRow(`実測 (${best.scale === 'akiya' ? '秋谷' : '堀内'})`, fmtW(best.weight));
      if (best.body_fat != null) addRow('体脂肪率', best.body_fat.toFixed(1) + '%');
    } else {
      addRow('測定', 'なし');
    }
    const wkAvg = chartMap.weeks.get(weekStart(best.date));
    if (wkAvg) {
      const a = weekAvgWeight(wkAvg);
      if (a != null) addRow('週平均', fmtW(a), 'var(--accent)');
    }
    if (best.events) {
      const evRow = document.createElement('div');
      evRow.className = 'tt-date';
      evRow.textContent = '▾ ' + best.events;
      tip.appendChild(evRow);
    }

    tip.style.display = 'block';
    const wrap = svg.parentElement.getBoundingClientRect();
    const px = clientX - wrap.left;
    tip.style.left = Math.min(Math.max(px + 12, 4), wrap.width - 150) + 'px';
    tip.style.top = Math.max(clientY - wrap.top - 70, 4) + 'px';
  };
  const hide = () => {
    tip.style.display = 'none';
    if (chartMap) chartMap.cross.setAttribute('opacity', 0);
  };

  svg.addEventListener('pointermove', (ev) => onMove(ev.clientX, ev.clientY));
  svg.addEventListener('pointerdown', (ev) => onMove(ev.clientX, ev.clientY));
  svg.addEventListener('pointerleave', hide);
}

// 今週のB運用 — 淡々とした事実の表
function renderRules() {
  const card = $('#rules-card');
  card.textContent = '';
  const thisWk = weekStart(todayISO());
  const wkEntries = state.entries.filter((e) => weekStart(e.date) === thisWk);
  const st = weekStats(wkEntries);
  const elapsed = Math.min(Math.round((toDate(todayISO()) - toDate(thisWk)) / DAY) + 1, 7);

  const table = document.createElement('table');
  table.className = 'rules';
  const rows = [
    ['酒なし', `${st.alcoholFree}日`, '週3日'],
    ['夜の炭水化物なし', `${st.noCarbs}日`, '記録した日のうち'],
    ['朝測定', `${st.measured} / ${elapsed}日`, '欠測は責めない'],
    ['生活費 平均', st.spend != null ? `¥${Math.round(st.spend).toLocaleString()}` : '—', '目安 ¥6,000/日'],
    ['運動', `${st.exercise}日`, ''],
  ];
  const thead = document.createElement('tr');
  for (const h of ['ルール', '今週', 'めやす']) {
    const th = document.createElement('th'); th.textContent = h; thead.appendChild(th);
  }
  table.appendChild(thead);
  for (const [a, b, c] of rows) {
    const tr = document.createElement('tr');
    const t1 = document.createElement('td'); t1.className = 'txt'; t1.textContent = a;
    const t2 = document.createElement('td'); t2.textContent = b;
    const t3 = document.createElement('td'); t3.className = 'txt'; t3.style.color = 'var(--muted)'; t3.style.fontSize = '11px'; t3.textContent = c;
    tr.append(t1, t2, t3);
    table.appendChild(tr);
  }
  card.appendChild(table);
}

// ---------- 長期チャート (年次平均 + レンジ) ----------
function yearlyPoints() {
  // weightbot 日次 (2013-2015前半) から 2013/2014 を計算し、
  // Apple Health 分析 (2015-2025) と現行プロジェクト (2026-) を重ねる
  const pts = new Map(); // year -> {avg, low, high, note, source}
  const byYear = new Map();
  for (const h of state.history.daily) {
    const y = +h.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(h.weight);
  }
  for (const [y, ws] of byYear) {
    pts.set(y, {
      avg: ws.reduce((a, b) => a + b, 0) / ws.length,
      low: Math.min(...ws), high: Math.max(...ws),
      note: 'weightbot 実測', source: 'weightbot',
    });
  }
  for (const r of state.history.yearly) {
    pts.set(r.year, { avg: r.avg, low: r.low, high: r.high, note: r.note, source: r.source });
  }
  // 現行プロジェクト (堀内基準)
  const cur = state.entries.map(conv).filter((v) => v != null);
  if (cur.length) {
    const y = +todayISO().slice(0, 4);
    pts.set(y, {
      avg: cur.reduce((a, b) => a + b, 0) / cur.length,
      low: Math.min(...cur), high: Math.max(...cur),
      note: 'このプロジェクト (堀内基準)', source: 'project',
    });
  }
  return [...pts.entries()].sort((a, b) => a[0] - b[0]);
}

function renderLongChart() {
  const svg = $('#chart-long');
  svg.textContent = '';
  const pts = yearlyPoints();
  if (!pts.length) return;
  const W = 700, H = 220, top = 14, right = 16, bottom = 24, left = 40;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const y0 = pts[0][0], y1 = pts[pts.length - 1][0];
  const xOf = (yr) => left + (yr - y0) / Math.max(y1 - y0, 1) * (W - left - right);
  const lows = pts.map(([, p]) => p.low ?? p.avg);
  const highs = pts.map(([, p]) => p.high ?? p.avg);
  const vMin = Math.floor(Math.min(...lows) - 0.5);
  const vMax = Math.ceil(Math.max(...highs) + 0.5);
  const yOf = (v) => top + (vMax - v) / (vMax - vMin) * (H - top - bottom);

  for (let v = vMin; v <= vMax; v += 2) {
    svg.appendChild(svgEl('line', { x1: left, y1: yOf(v), x2: W - right, y2: yOf(v), stroke: 'var(--hairline)', 'stroke-width': 1 }));
    const t = svgEl('text', { x: left - 6, y: yOf(v) + 3, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 10 });
    t.textContent = v;
    svg.appendChild(t);
  }
  for (const [yr] of pts) {
    const t = svgEl('text', { x: xOf(yr), y: H - 8, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 9 });
    t.textContent = "'" + String(yr).slice(2);
    svg.appendChild(t);
  }

  // 年内レンジ (whisker) → 平均の折れ線 → ドット
  for (const [yr, p] of pts) {
    if (p.low != null && p.high != null) {
      svg.appendChild(svgEl('line', {
        x1: xOf(yr), y1: yOf(p.low), x2: xOf(yr), y2: yOf(p.high),
        stroke: 'var(--data-gray)', 'stroke-width': 1, opacity: 0.45,
      }));
    }
  }
  let d = '';
  pts.forEach(([yr, p], i) => { d += (i ? 'L' : 'M') + xOf(yr).toFixed(1) + ' ' + yOf(p.avg).toFixed(1) + ' '; });
  svg.appendChild(svgEl('path', {
    d: d.trim(), fill: 'none', stroke: 'var(--data-gray)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.75,
  }));
  for (const [yr, p] of pts) {
    svg.appendChild(svgEl('circle', {
      cx: xOf(yr), cy: yOf(p.avg), r: 4,
      fill: p.source === 'project' ? 'var(--accent)' : 'var(--data-gray)',
      stroke: 'var(--card)', 'stroke-width': 2,
    }));
  }

  // ホバー: 最寄りの年
  const tip = $('#long-tooltip');
  const onMove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const vx = (ev.clientX - rect.left) / rect.width * W;
    let best = null, bd = Infinity;
    for (const [yr, p] of pts) {
      const dd = Math.abs(xOf(yr) - vx);
      if (dd < bd) { bd = dd; best = [yr, p]; }
    }
    if (!best || bd > 40) { tip.style.display = 'none'; return; }
    const [yr, p] = best;
    tip.textContent = '';
    const dt = document.createElement('div'); dt.className = 'tt-date'; dt.textContent = String(yr);
    const r1 = document.createElement('div'); r1.className = 'tt-row';
    const l1 = document.createElement('span'); l1.textContent = '平均';
    const v1 = document.createElement('span'); v1.className = 'v'; v1.textContent = p.avg.toFixed(1);
    r1.append(l1, v1);
    tip.append(dt, r1);
    if (p.low != null && p.high != null) {
      const r2 = document.createElement('div'); r2.className = 'tt-row';
      const l2 = document.createElement('span'); l2.textContent = 'レンジ';
      const v2 = document.createElement('span'); v2.className = 'v'; v2.textContent = `${p.low.toFixed(1)}–${p.high.toFixed(1)}`;
      r2.append(l2, v2);
      tip.appendChild(r2);
    }
    if (p.note) {
      const n = document.createElement('div'); n.className = 'tt-date'; n.textContent = p.note;
      tip.appendChild(n);
    }
    tip.style.display = 'block';
    const wrap = svg.parentElement.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(ev.clientX - wrap.left + 12, 4), wrap.width - 160) + 'px';
    tip.style.top = '8px';
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerdown', onMove);
  svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
}

// ---------- 週次サマリー ----------
function renderWeekly() {
  const wrap = $('#weekly-list');
  wrap.textContent = '';
  const weeks = [...weeksOf(state.entries).entries()].sort((a, b) => a[0] < b[0] ? 1 : -1);
  let prevAvg = new Map();
  // 前週平均を引くために昇順で平均を先に計算
  const avgByWeek = new Map();
  for (const [wk, es] of weeks) avgByWeek.set(wk, weekAvgWeight(es));

  for (const [wk, es] of weeks) {
    const a = avgByWeek.get(wk);
    const prevWk = fmtISO(new Date(toDate(wk).getTime() - 7 * DAY));
    const pa = avgByWeek.get(prevWk);
    const st = weekStats(es);
    const end = fmtISO(new Date(toDate(wk).getTime() + 6 * DAY));

    const card = document.createElement('div');
    card.className = 'card week-card';

    const head = document.createElement('div');
    head.className = 'wk-head';
    const range = document.createElement('span');
    range.className = 'wk-range';
    range.textContent = `${fmtMD(wk)} – ${fmtMD(end)}`;
    const avgEl = document.createElement('span');
    avgEl.className = 'wk-avg';
    avgEl.textContent = a != null ? a.toFixed(1) : '—';
    if (a != null) {
      const u = document.createElement('span'); u.className = 'unit'; u.textContent = ' kg';
      avgEl.appendChild(u);
      if (pa != null) {
        const dl = document.createElement('span');
        dl.className = 'delta';
        const d = a - pa;
        dl.textContent = `  前週 ${d >= 0 ? '+' : ''}${d.toFixed(1)}`;
        avgEl.appendChild(dl);
      }
    }
    head.append(range, avgEl);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'wk-stats';
    const stats = [
      ['測定', `${st.measured} / 7日`],
      ['酒なし', `${st.alcoholFree}日`],
      ['夜炭なし', `${st.noCarbs}日`],
      ['運動', `${st.exercise}日`],
      ['生活費平均', st.spend != null ? `¥${Math.round(st.spend).toLocaleString()}` : '—'],
      ['体感平均', st.feeling != null ? st.feeling.toFixed(1) : '—'],
    ];
    for (const [l, v] of stats) {
      const s = document.createElement('div');
      s.className = 'wk-stat';
      s.textContent = l;
      const vv = document.createElement('span'); vv.className = 'v'; vv.textContent = v;
      s.prepend(vv);
      grid.appendChild(s);
    }
    card.appendChild(grid);
    wrap.appendChild(card);
    prevAvg = a;
  }
}

// ---------- 台帳 ----------
function renderLedger() {
  const wrap = $('#ledger-list');
  wrap.textContent = '';
  const list = [...state.entries].reverse();
  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'ledger-row';

    const d = document.createElement('span'); d.className = 'd'; d.textContent = fmtMDW(e.date);
    const w = document.createElement('span');
    w.className = 'w' + (e.weight == null ? ' empty' : '');
    if (e.weight != null) {
      w.textContent = fmtW(conv(e));
      if (isConverted(e)) {
        const cv = document.createElement('span'); cv.className = 'cv'; cv.textContent = ' ※';
        w.appendChild(cv);
      }
    } else {
      w.textContent = '—';
    }
    const meta = document.createElement('span');
    meta.className = 'meta';
    const bits = [];
    if (e.alcohol === 0) bits.push('酒なし');
    else if (e.alcohol === 1) bits.push(e.alcohol_detail || '酒あり');
    if (e.exercise === 1) bits.push(e.exercise_detail || '運動');
    if (e.events) bits.push('▾' + e.events);
    if (e.note) bits.push(e.note);
    meta.textContent = bits.join(' · ');

    row.append(d, w, meta);
    row.addEventListener('click', () => {
      $('#f-date').value = e.date;
      fillForm(e);
      switchView('record');
    });
    wrap.appendChild(row);
  }
}

// ---------- 設定 ----------
function renderSettings() {
  $('#s-offset').value = state.settings.scale_offset ?? '1.5';
  const recipe = [
    `URL: ${location.origin}/api/health-sync`,
    `方法: POST`,
    `ヘッダ: Authorization: Bearer <パスコード>`,
    `本文(JSON):`,
    `{`,
    `  "scale": "akiya",`,
    `  "samples": [{ "date": "2026-07-05", "weight": 77.6, "body_fat": 23.4 }]`,
    `}`,
  ].join('\n');
  $('#hs-recipe').textContent = recipe;
}
$('#s-offset-save').addEventListener('click', async () => {
  const v = parseFloat($('#s-offset').value);
  const status = $('#s-offset-status');
  if (!Number.isFinite(v) || v < 0 || v > 5) { status.textContent = '0〜5の範囲で'; return; }
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ scale_offset: v }) });
    state.settings.scale_offset = String(v);
    status.textContent = '更新しました';
    renderChartView();
  } catch (err) {
    status.textContent = '更新できませんでした: ' + err.message;
  }
});
$('#s-logout').addEventListener('click', () => {
  localStorage.removeItem('br_token');
  location.reload();
});

// ---------- 起動 ----------
async function boot() {
  $('#masthead-date').textContent = fmtMDW(todayISO()) + ' ' + new Date().getFullYear();
  try {
    const [{ entries }, { settings }, history] = await Promise.all([
      api('/api/entries'),
      api('/api/settings'),
      api('/api/history').catch(() => ({ daily: [], yearly: [] })),
    ]);
    state.entries = entries;
    state.settings = settings;
    state.history = history;
  } catch (err) {
    if (err.message === 'unauthorized') return; // ゲート表示済み
    console.error(err);
  }
  $('#f-date').value = todayISO();
  renderWelcome();
  await loadFormDate(todayISO());
  switchView(state.view);
}

(async () => {
  if (!state.token || !(await tryAuth(state.token))) {
    showAuthGate();
  } else {
    boot();
  }
})();
