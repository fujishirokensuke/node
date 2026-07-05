# Body Recomp

体重・食事・生活の記録を「淡々と」続けるための単一ユーザーWebアプリ。
Cloudflare Workers + D1 (SQLite) + 静的アセット。ビルドなし（素のHTML/JS）。

> 目的は体重を落とすことではなく「記録し続ける人間になる」こと。
> アプリはジャッジしない記録係。欠測は責めず、週平均で語る。

設計の背景・データ仕様・コーチング原則は [`docs/HANDOFF_webapp.md`](docs/HANDOFF_webapp.md) を参照。

## 構成

```
wrangler.jsonc   Workers設定 (D1バインディング DB / アセット public/)
schema.sql       D1スキーマ (entries / settings)
seed.sql         初期データ (2026/5/19〜7/6)
src/index.js     Worker: /api/* のAPI、それ以外は静的アセット
public/          フロントエンド (index.html / app.js / style.css)
```

## ローカル開発

```sh
npm install
cp .dev.vars.example .dev.vars        # AUTH_TOKEN を好きな値に
npm run db:schema:local
npm run db:seed:local
npm run dev                            # http://localhost:8787
```

## デプロイ (Cloudflare)

D1 データベース `body-recomp` は作成済みで、`wrangler.jsonc` に database_id が入っている。

```sh
npx wrangler login                     # 初回のみ
npm run db:schema:remote               # スキーマ投入 (済みなら不要)
npm run db:seed:remote                 # シード投入 (済みなら不要)
npx wrangler secret put AUTH_TOKEN     # アプリのパスコードを設定
npm run deploy
```

GitHubリポジトリを Cloudflare Workers Builds に接続すれば push で自動デプロイも可。

## API

すべて `Authorization: Bearer <AUTH_TOKEN>` が必要。

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/me` | トークン確認 |
| GET | `/api/entries?from&to` | エントリ一覧 (date昇順) |
| GET | `/api/entries/:date` | 1日分 |
| PUT | `/api/entries/:date` | upsert。**bodyに含まれるキーだけ更新**(途中保存対応) |
| DELETE | `/api/entries/:date` | 削除 |
| GET / PUT | `/api/settings` | 設定 (scale_offset など) |
| POST | `/api/health-sync` | iOSショートカットからの体重取り込み。手入力済みの日は上書きしない |

## 体重計2台問題

- 全データは機種タグ (`akiya` / `horiuchi`) 付きの実測値で保存
- 表示時に堀内基準へ換算 (秋谷は `-scale_offset`、既定 1.5kg、設定画面で変更可)
- 秋谷実測の換算値には ※ を付けて表示
