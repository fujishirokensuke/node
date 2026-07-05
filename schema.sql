-- Body Recomp: D1 schema
-- 日次エントリ。1日1行、date が主キー。
-- 「途中保存」(朝に体重だけ→夜に食事追記) は同じ行への部分更新で実現する。

CREATE TABLE IF NOT EXISTS entries (
  date             TEXT PRIMARY KEY,            -- YYYY-MM-DD
  weight           REAL,                        -- 実測値 (機種の生値のまま保存)
  scale            TEXT CHECK (scale IN ('akiya', 'horiuchi')),
  body_fat         REAL,                        -- 体脂肪率 (秋谷のみ)
  meal_breakfast   TEXT,
  meal_lunch       TEXT,
  meal_dinner      TEXT,
  meal_snack       TEXT,
  alcohol          INTEGER,                     -- 1=あり 0=なし NULL=未記録
  alcohol_detail   TEXT,                        -- 種類・量 (自由テキスト)
  alcohol_g        REAL,                        -- 純アルコールg (概算)
  exercise         INTEGER,                     -- 1=あり 0=なし NULL=未記録
  exercise_detail  TEXT,                        -- 散歩/ラン/水泳など
  bowel            TEXT,                        -- 「◎ 10:02」など行分けテキスト、複数回対応
  sleep_start      TEXT,                        -- "23:00" / "25:30" 表記も許容するため TEXT
  sleep_end        TEXT,
  sleep_note       TEXT,                        -- 分断メモ
  feeling          REAL,                        -- 体感 1-5 (0.5刻み)
  spending         INTEGER,                     -- 生活費 (円)
  events           TEXT,                        -- カンマ区切りタグ: CC,Heart Reunion,リトリート,宿泊,ケンカ...
  no_evening_carbs INTEGER,                     -- 夜の炭水化物なし 1=達成 0=食べた NULL=未記録
  note             TEXT,
  source           TEXT DEFAULT 'manual',       -- manual | health (iOSショートカット経由)
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

-- 過去の体重ログ (weightbot バックアップ等)。プロジェクト外の長期文脈データ。
CREATE TABLE IF NOT EXISTS history_weights (
  date   TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  source TEXT DEFAULT 'weightbot'
);

-- 年次平均 (Apple Health 分析、00_historical_data.md より)
CREATE TABLE IF NOT EXISTS history_yearly (
  year   INTEGER PRIMARY KEY,
  avg    REAL,
  low    REAL,
  high   REAL,
  note   TEXT,
  source TEXT DEFAULT 'apple_health'
);

-- 設定 (換算係数など)。key-value。
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 推定機種差: 秋谷は堀内より約 +1.5kg 高く出る (中央値)。
-- 同日両機種計測が取れたら設定画面から更新する。
INSERT OR IGNORE INTO settings (key, value) VALUES ('scale_offset', '1.5');
