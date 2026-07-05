# 藤代 健介｜KENSUKE FUJISHIRO — Website

https://fujishirokensuke.studio.site/ (STUDIO) から完全移植した静的サイト。
外部サービスへの依存はなく、このディレクトリ単体でホスティングできます。

## ページ構成

| パス | 内容 |
|---|---|
| `/` | トップ（場 / Ba） |
| `/framework/` | FRAMEWORK — 和の配置｜Arrangement for harmony |
| `/community/` | COMMUNITY — 対話のリトリート｜Dialogue Retreat |
| `/architecture/` | ARCHITECTURE — JOMON ほか |
| `/about/` | ABOUT |
| `/contact/` | CONTACT（お問い合わせフォーム） |

## ディレクトリ構成

```
website/
├── index.html               # トップページ
├── <page>/index.html        # 各サブページ（クリーンURL形式）
└── assets/
    ├── css/entry.css        # サイト本体のスタイル（旧 STUDIO /_nuxt/entry.css）
    ├── css/fonts.css        # Webフォント定義（旧 Google Fonts CSS を統合）
    ├── fonts/               # woff2 セルフホスト（Zen Old Mincho / Zen Kaku Gothic Antique / Lato / Playfair Display / Material Icons ほか）
    └── img/                 # 全画像（旧 storage.googleapis.com）
```

## ローカルプレビュー

```
cd website && python3 -m http.server 8000
# http://localhost:8000
```

※ ルート相対パス（`/assets/...`）を使用しているため、ドメイン直下（またはサブドメイン直下）での
ホスティングを想定しています。サブディレクトリ配下に置く場合はパスの書き換えが必要です。

## 移植時のメモ

- STUDIO の Nuxt ランタイム（JS）は除去済み。表示は完全に静的で、レイアウト・レスポンシブは CSS のみで再現されます（デスクトップ/モバイルともオリジナルとスクリーンショット比較で一致確認済み）。
- 左下の「Created in STUDIO」バッジは削除しました。
- `/architecture/` の YouTube 埋め込み（`youtube.com/embed/u1K-WVgg7tw`）はそのまま残してあり、公開環境で動作します。
- `/contact/` のフォームは STUDIO のバックエンドに送信していたため、静的化後は送信先がありません。公開前に Formspree / Cloudflare Workers 等の送信先を接続する必要があります（送信ボタンのラベルが空なのはオリジナル通り）。
- SEO メタ（title / description / og:image / favicon）は全ページ移植済み。og:image もローカル化しています。
