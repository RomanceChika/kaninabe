---
doc_type: architecture
scope: common
id: ARCH-0001
norms: [PRIN-0003, PRIN-0005, PRIN-0009]
decisions: [ADR-0007, ADR-0010]
---

# ARCH-0001 — 計算基盤の配置ポリシー

## 目的

「この処理をどこで動かすか」を毎回考えなくて済むよう、処理の種類から実行場所が一意に決まる表を定める。デプロイ先が複数ランタイムに分裂して、テスト戦略と仕様突合が系統ごとに割れる事態を防ぐ。

## 概要

- **計算は Vercel に一元化する**。Cloudflare は前段の守り（DNS・CDN・WAF・レート制限）に徹し、Supabase はデータ基盤（DB・認証・Storage・Realtime）に徹する。
- **Supabase Edge Functions は使わない**。**Cloudflare Workers 等での計算も既定では使わない**（いずれも昇格条件を定めて温存する。ADR-0007）。
- 処理の種類ごとの配置は下記「配置決定表」を正とする。
- ホスティングの制約（実行時間・配達保証なし・常駐不可・ボディサイズ）は、**設計で吸収済み**である。吸収の仕方も表で示す。

## スコープ

- **対象**: アプリケーションの処理をどのサービス・どの実行形態に置くか、各サービスの責務の線引き、既定から外れる場合の昇格条件、ホスティング制約への対処。
- **対象外**:
  - 層構成・依存方向（→ ARCH-BE-0001）
  - Server Action / 外部連携 / ジョブの内部構造（→ ARCH-BE-0013 / 0014 / 0015）
  - 判断の理由と検討した選択肢（→ ADR-0007）

---

## 構成

### サービスの責務

| サービス | 責務 | 置かないもの |
|---------|------|------------|
| **Vercel** | アプリの計算すべて（RSC・Server Action・Route Handler・Cron・ジョブワーカー） | 永続ディスクを要する処理、常駐プロセス |
| **Cloudflare** | DNS・CDN・WAF・レート制限（前段の守り） | 業務ロジック、データ変換 |
| **Supabase** | Postgres・認証・Storage・Realtime・RLS・（DB 内で閉じる定期メンテ、または Vercel の口を叩くだけのトリガとして）pg_cron + pg_net | アプリケーションの計算（Edge Functions は使わない。業務ロジックは pg_cron の migration に書かない） |

### 配置決定表

| 処理の種類 | 実行場所 | 補足 |
|-----------|---------|------|
| 同期処理（画面に紐づく書き込み） | Server Action（Vercel） | 定型 4 手順（ARCH-BE-0013） |
| 読み取り | RSC + クエリ関数（Vercel） | Server Action にしない |
| ストリーミング応答（AI チャット等） | Route Handler（Vercel） | LLM クライアントは IF 注入でユニットテスト可能にする |
| 非同期の副作用（通知・外部連携） | outbox ジョブ + ワーカー（Vercel） | 同一トランザクションで積む（ARCH-BE-0015） |
| Webhook 受信 | Route Handler `/api/webhooks/{service}`（Vercel） | 署名検証 → 重複排除 → ジョブ積み → 即 200（ARCH-BE-0014） |
| 定時処理（業務。日次以下の頻度） | Vercel Cron → operation | ジョブの掃除役もここ。Vercel Hobby プランは 1 日 1 回までの制約がある(job_spec の `runner: vercel_cron`・J4 が機械で見る) |
| 定時処理（業務。10 分間隔等、Vercel Cron の頻度制約を超える） | pg_cron + pg_net（Supabase）→ Vercel の Route Handler を HTTP で叩く | **業務ロジックを含めない**。pg_cron は「叩くだけのトリガ」であり、計算は変わらず Vercel 側が担う(job_spec の `runner: pg_cron`・J3 が機械で見る。ADR-0010) |
| 定時処理（DB 内で閉じるメンテ） | pg_cron（Supabase） | 業務ロジックを含めない |
| 大きなファイルのアップロード | 署名 URL で Storage へ直接（Supabase） | サーバーを経由させない |
| リアルタイム通知 | Supabase Realtime | WebSocket サーバーを自前で持たない |
| 静的配信・DNS・WAF・レート制限 | Cloudflare | 前段のみ |

### 既定から外れる場合の昇格条件

既定を外れるのは、以下の条件が**実測で**成立したときに限る。外れる場合は ADR を書く。

| 昇格先 | 条件 |
|--------|------|
| Cloudflare Workers 等での計算 | Vercel の関数実行上限に収まらない処理が出た / エッジでの前処理が体感品質に効くと実測できた |
| Supabase Edge Functions | DB に極めて近い場所でしか成立しない処理が出た（現時点では想定なし） |
| 専用ジョブ基盤（Inngest / QStash 等） | ARCH-BE-0015 の昇格条件に該当 |
| Cloudflare Cron Triggers | プラン都合で Vercel Cron の頻度が足りない（掃除役設計のため、代替は容易）。**実際に頻度不足へ当たった 2026-09 時点では、新しいサービスを増やさずに済む Supabase pg_cron + pg_net（上表の「業務。Vercel Cron の頻度制約を超える」行)を採った(ADR-0010)。**どちらも「叩くだけのトリガ」であり計算を移さないため、この表の意味では「昇格」ではなくプラン差の吸収として扱う（ADR-0007 の Neutral と同じ扱い） |

---

## 制約・不変条件

- **MUST**: アプリケーションの計算は Vercel 上の実行形態（RSC / Server Action / Route Handler / Cron）のいずれかに置く。
- **MUST**: DB アクセスはサーバー経由に限る。ブラウザから Supabase に直接アクセスしない（PRIN-0009）。
- **MUST**: 外部サービスの認証情報はサーバー側の環境変数にのみ置く。
- **MUST NOT**: 既定の実行場所を外れる実装を、ADR なしに追加しない。ランタイムが増えるとテスト戦略と仕様突合が分裂するため、これは構造の問題として扱う。
- **MUST NOT**: 常駐プロセス・自前 WebSocket サーバー・永続ディスクを前提とした設計を持ち込まない。
- **SHOULD**: 実行環境に依存する API（`waitUntil` 等）の利用箇所は `src/app` に閉じる。operation から先はプレーンな TS に保つ（PRIN-0003）。

### 制約への対処（設計で吸収済みのもの）

| ホスティングの制約 | 設計上の対処 |
|-------------------|------------|
| 配達保証がない（関数が落ちれば副作用は消える） | outbox + ワーカー（ARCH-BE-0015） |
| Cron の頻度・精度が限られる | Cron は掃除役に徹し、即時実行は `waitUntil`。遅れても壊れない |
| 関数の実行時間に上限がある | ワーカーは時間予算内の件数だけ処理する |
| リクエストボディのサイズ上限 | 大きなファイルは署名 URL で Storage に直接アップロード |
| 常駐プロセス・WebSocket サーバーが持てない | Supabase Realtime を使う |
| 永続ディスクがない | 生成物はリポジトリにコミット（ADR-0006）、実行時の一時ファイルに依存しない |

---

## 実装配置

- path: `app/src/app/api/cron/` — Cron から叩かれるエンドポイント
- path: `app/src/app/api/webhooks/{service}/` — Webhook 受信口
- path: `supabase/migrations/` — テーブル・RLS・pg_cron のジョブ定義
