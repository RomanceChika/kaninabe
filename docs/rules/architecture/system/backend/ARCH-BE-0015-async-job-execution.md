---
doc_type: architecture
scope: backend
id: ARCH-BE-0015
norms: [PRIN-0001, PRIN-0003, PRIN-0005, PRIN-0008, ARCH-BE-0001, ARCH-SP-0002]
decisions: [ADR-0004, ADR-0007]
---

# ARCH-BE-0015 — 非同期ジョブ実行基盤（outbox + ワーカー）

## 目的

配達保証のないホスティング環境（Vercel）の上で、ドメインの `effects`（通知・外部連携などの副作用）が**確実に 1 回以上実行される**構造を作る。同時に、リトライ方針をプレーンな TS + SQL に置き、ユニットテストと仕様突合の対象にする。

## 概要

- ドメインの書き込みと**同一トランザクション**でジョブ行を挿入する（outbox パターン）。副作用の実行はトランザクションの外に出す。
- ジョブテーブルは `status` / `attempts` / `next_run_at` / `last_error` を持つ単一テーブルとする。
- 実行は**二段構え**: Server Action の直後に `waitUntil()` で即時処理し、**Vercel Cron は取り残しの掃除役**とする。Cron 間隔が粗くても「遅れるだけで壊れない」設計にする。
- リトライは指数バックオフ、`max_attempts` 超過で `dead` に落とす（dead letter）。
- **ワーカーは特別な実行系ではない**。ジョブを受けて operation 関数を呼ぶだけであり、同じ層構成・同じ仕様突合・同じテスト戦略に乗る。

## スコープ

- **対象**: ジョブテーブルの構造、ジョブの積み方・取り出し方、リトライと dead letter、実行トリガー（`waitUntil` / Cron）、`effects` との対応。
- **対象外**:
  - 外部サービスの呼び出し方・Webhook 受信（→ ARCH-BE-0014）
  - どこで実行するか・プラン制約（→ ARCH-0001）
  - 通知文面などの副作用の中身（→ `docs/specs/backend/external/`）
  - **時間駆動のドメインイベント**（`loan.report_overdue` のような `by: [system]` の遷移）。同じく Cron から起動されるが**ジョブではない**。ジョブは「起きた書き込みの後始末」であり `effects[].do` に宣言があるのに対し、こちらは**イベントそのもの**を起こす（走査 → エンジンへの照会 → 遷移）。仕様上の裏付けが違うものを同じ台帳に乗せると、`jobs.type` が `effects` の値域でなくなる。受け口は同じ規約（[route-handlers.md](../../../process/backend/system/standards/conventions/route-handlers.md)）に従い、走査そのものは起こすイベントの operation に同居させる

---

## 構成

| 要素 | 責務 | 置き場所 |
|------|------|---------|
| ジョブテーブル | 未処理の副作用の台帳。ドメイン書き込みと同一トランザクションで積む | `supabase/migrations/`（テーブル名: `jobs`） |
| ジョブ登録 | `effects` に対応する行の挿入 | `app/src/infrastructure/jobs/` (`JobQueue` IF の実装) |
| ワーカー | ジョブを取り出し、対応する operation 関数を呼ぶ | `app/src/operation/jobs/run-due-jobs.ts` |
| リトライ方針 | 次回実行時刻の算出、dead 判定 | `app/src/domain/jobs/retry.ts`（純粋関数） |
| 即時トリガー | Server Action 応答後の `waitUntil()` | `app/src/app/_actions/` |
| 掃除役トリガー | Cron から叩く Route Handler | `app/src/app/api/jobs/run/route.ts` |

### ジョブテーブルの列

| 列 | 型 | 意味 |
|----|----|------|
| `id` | uuid | ジョブ識別子。冪等キーの導出元 |
| `type` | text | ジョブ種別。`state_spec` の `effects[].do` の ID と一致させる |
| `payload` | jsonb | 実行に必要な最小限の識別子（エンティティ ID 等）。スナップショットを持たない |
| `idempotency_key` | text | 外部呼び出しに渡す冪等キー。`{type}:{id}` から決定的に導く |
| `status` | text | `pending` / `running` / `succeeded` / `failed` / `dead` |
| `attempts` | integer | 実行回数 |
| `max_attempts` | integer | 上限。超過で `dead` |
| `next_run_at` | timestamptz | 次に実行してよい時刻（バックオフの結果） |
| `last_error` | text | 直近の失敗理由（分類 + メッセージ） |
| `locked_at` / `locked_by` | timestamptz / text | 実行中のリース。放置検出に使う |
| `created_at` / `updated_at` | timestamptz | 監査用 |

---

## フロー

1. **積む**: operation がドメインの状態を書き込むトランザクションの中で、`effects` に対応するジョブ行を `status: pending`, `next_run_at: now` で挿入する。
2. **即時実行**: Server Action は応答を返した後、`waitUntil()` でワーカーを起動する。ユーザーの待ち時間には影響しない。
3. **取り出し**: ワーカーは `status = pending AND next_run_at <= now` の行を、行ロック（`FOR UPDATE SKIP LOCKED`）で取り出し `running` にする。並行実行しても同じ行を二重に処理しない。
4. **実行**: ジョブ `type` に対応する operation 関数を呼ぶ。成功で `succeeded`。
5. **失敗**: `attempts` を増やし、`next_run_at` を指数バックオフで先送りして `pending` に戻す。`attempts >= max_attempts` なら `dead` にして人間の対象にする。
6. **掃除**: Cron が定期的にワーカーを起動し、①即時実行が起きなかったジョブ ②リース切れの `running` ③リトライ待ちのジョブ を拾う。

ワーカーは**実行時間の予算内で処理できる件数だけ**を処理し、残りは次回に回す。1 回の起動で全件を捌く前提を置かない。

---

## 制約・不変条件

- **MUST**: ジョブの挿入はドメイン書き込みと同一トランザクションで行う。副作用の実行は同一トランザクションの中で行わない。
- **MUST**: ジョブ種別（`type`）は `state_spec` の `effects[].do` に宣言された ID と一致させる。仕様に無い副作用をジョブとして積んではならない（PRIN-0001 / PRIN-0008）。
- **MUST**: ワーカーが呼ぶのは operation 関数とする。ワーカー内にドメインロジックを書かない。
- **MUST**: リトライ方針（バックオフの算出・dead 判定）は純粋関数として `src/domain` に置き、ユニットテストする（PRIN-0003）。
- **MUST**: 外部の状態を変えるジョブは `idempotency_key` を外部呼び出しに渡す。少なくとも 1 回（at-least-once）の実行を前提に、二重実行が害にならないようにする。
- **MUST NOT**: `payload` に業務データのスナップショットを持たせない（識別子のみ）。実行時に最新を読み直す。
- **MUST NOT**: 実行順序に依存する副作用を設計しない。ジョブ間の順序は保証しない。
- **SHOULD**: `dead` の発生は運用上の異常として可視化する。件数の監視先が決まるまでは、少なくとも一覧できるクエリを用意する。

---

## 実装配置

- path: `supabase/migrations/*_jobs.sql` — テーブルと索引（`(status, next_run_at)`）
- path: `supabase/migrations/*_claim_due_jobs.sql` — 取り出しの RPC（`FOR UPDATE SKIP LOCKED`）
- path: `app/src/domain/jobs/retry.ts` — バックオフ・dead 判定（純粋関数）
- path: `app/src/operation/jobs/` — ワーカー（`run-due-jobs.ts`）・ハンドラの登録機構（`registry.ts`）・ジョブ種別ごとのハンドラ（`handlers.ts`）
- path: `app/src/infrastructure/jobs/` — `JobQueue` の Supabase 実装
- path: `app/src/infrastructure/console-logger.ts` — 構造化ログの出力口（ジョブ専用ではないので層の直下。[logging.md](../../../process/backend/system/standards/conventions/logging.md)）
- path: `app/src/app/api/jobs/run/route.ts` — Cron から叩かれる掃除役（[route-handlers.md](../../../process/backend/system/standards/conventions/route-handlers.md) の規約に従う）

---

## 境界・レイヤーに関する追加情報

### 仕様との対応

| 仕様側 | 実装側 |
|--------|--------|
| `state_spec` の `effects[].on`（ドメインイベント） | ジョブを積む位置（そのイベントを処理する operation） |
| `state_spec` の `effects[].do`（副作用 ID） | ジョブの `type` とハンドラ |
| `specs/backend/external` の連携仕様 | ハンドラが呼ぶアダプタ（ARCH-BE-0014） |

### 昇格条件

自作ワーカーで足りなくなる条件と移行先を先に決めておく（ADR-0007 の昇格条件と同じ運用）。

| 条件 | 移行先 |
|------|--------|
| ジョブが関数実行時間の上限に収まらない（長時間処理・大量バッチ） | 専用ジョブ基盤（Inngest / QStash 等）または処理の分割 |
| 秒単位のスケジュール精度が必要 | 専用ジョブ基盤 |
| 遅延・失敗の可視化を運用が要求する | 専用ジョブ基盤の管理 UI |

移行時は ADR を書く。移行しても**ジョブ = operation 関数**という構造は保ち、トリガーだけを差し替える。

---

## 実装のきまり・コード例

- テストの書き方: [process/backend/system/standards/conventions/testing/](../../../process/backend/system/standards/conventions/testing/README.md)
- Cron から叩く受け口の書き方: [process/backend/system/standards/conventions/route-handlers.md](../../../process/backend/system/standards/conventions/route-handlers.md)
- 外部連携の構造: [ARCH-BE-0014](./ARCH-BE-0014-external-integration.md)
- ジョブの実行が残すログ（`job_id` / `job_type` / `duration_ms`）: [logging.md](../../../process/backend/system/standards/conventions/logging.md)
