---
doc_type: architecture
scope: backend
id: ARCH-BE-0014
norms: [PRIN-0001, PRIN-0003, PRIN-0005, PRIN-0008, PRIN-0009, ARCH-BE-0001, ARCH-SP-0002]
decisions: [ADR-0004, ADR-0007]
---

# ARCH-BE-0014 — 外部連携の構造（アウトバウンド / インバウンド）

## 目的

決済・通知・LLM など連携先が増えても**仕様体系と層構成を増築しなくて済む**よう、外部連携を方向で 2 パターンに正規化する。連携先ごとの作法をアダプタに閉じ込め、ドメインの語彙だけが内側に残る状態を保つ。

## 概要

- 外部連携は **アウトバウンド（こちらから呼ぶ）** と **インバウンド（Webhook で呼ばれる）** の 2 パターンに正規化する。第 3 のパターンを作らない。
- アウトバウンド: operation は**業務語彙の IF**（`PaymentGateway` 等）だけを知る。SDK は `src/infrastructure` のアダプタに閉じ、DI で注入する。**外部の状態を変える呼び出しは outbox ジョブ経由 + 冪等キー**を標準とする。
- インバウンド: `Route Handler /api/webhooks/{service}` の責務は「**署名検証 → イベント ID で重複排除・永続化 → ジョブを積んで即 200**」まで。ロジックを書かない。
- **Webhook イベントは UI 操作と同型の「ドメインイベントの発火元」**として状態機械に接続する（例: `payment_succeeded` → `payment.confirm`、`by: [system]`）。これにより発火元の網羅を既存のトレース検証で機械検証できる。
- シークレットはサーバー側の環境変数にのみ置く。

## スコープ

- **対象**: 外部サービスとの境界の作り方、IF とアダプタの分割、Webhook 受信口の責務、外部イベントとドメインイベントの接続、テスト戦略上の位置づけ。
- **対象外**:
  - ジョブテーブル・リトライ・ワーカーの設計（→ ARCH-BE-0015）
  - どこで実行するか（→ ARCH-0001）
  - 連携先ごとの具体仕様(向き・効果・縮退・リトライ・送る情報。この版は outbound のみ)(→ `external_spec`。ARCH-SP-BE-0001 §外部連携仕様)

---

## 構成

| 要素 | 責務 | 置き場所 |
|------|------|---------|
| 業務語彙の IF | operation が知る唯一の外部の姿（`PaymentGateway.charge` 等）。SDK の型を露出しない | `app/src/operation/{aggregate}/ports.ts` |
| アダプタ | IF の実装。SDK 呼び出し・認証・レスポンス変換・エラー変換 | `app/src/infrastructure/{service}/`(`external_spec` の `vocabulary.service[].adapter_root`。X1 が閉世界を検査。SDK のパッケージは同じ行の `sdk_packages` に宣言し、**この置き場の下でだけ** import できる —— X1 の (d) と ESLint の層の境界) |
| Webhook 受信口（**生成物**） | 署名検証 → 受信の RPC を 1 回 → 応答 | `app/src/app/api/inbound/{連携}/route.ts` |
| 受信口の配線（**生成物**） | 鍵・呼び出す RPC・拒否の返し方を宣言から組む | `app/src/composition/inbound/{連携}.ts` |
| 受信の RPC（**生成物**） | 記録と遷移を**1 トランザクション**で起こす plpgsql | `supabase/migrations/{migration}`（宣言する） |
| 受信の段取り（1 回だけ書く実体） | 上の 3 段の並びと HTTP の状態 | `@kaninabe/runtime/inbound`（`framework/runtime/src/inbound/run-inbound.ts`） |
| 受信イベントの記録 | 外部イベント ID の単一列の一意索引を持つテーブル | `docs/specs/backend/data/tables/{表}.md` |
| ワーカー | ジョブを operation 関数として実行する | `app/src/operation/jobs/`（ARCH-BE-0015） |

---

## フロー

### アウトバウンド

1. operation はドメインの書き込みと同一トランザクションで **outbox ジョブ**を積む（`effects` の実体）。
2. ワーカーがジョブを取り出し、composition から注入されたアダプタ（IF）を呼ぶ。
3. アダプタは**冪等キー**（ジョブ ID から決定的に導く）を外部 API に渡す。再試行で二重実行にならないことを外部側の冪等性で担保する。
4. 失敗はリトライ、上限超過で dead letter（ARCH-BE-0015）。

同期的に外部を呼ぶのは、**外部の状態を変えない読み取り**（為替レート取得等）と、ユーザー操作と不可分な応答（LLM ストリーミング）に限る。

### インバウンド（Webhook）

**この口は生成物である**（束 ⑲-2b）。`external_spec` に `direction: inbound` の行を 1 本足すと
`app/src/app/api/inbound/{連携}/route.ts`（Route Handler）と `app/src/composition/inbound/{連携}.ts`
（配線）が生成され、段取りの実体は `@kaninabe/runtime/inbound`（`framework/runtime/src/inbound/run-inbound.ts`） に 1 回だけ書かれている。

1. `POST /api/inbound/{連携}` が**宣言された方式**（`signature`）と**名前で指した鍵**（`signature_key`）で署名を検証する。失敗は 401 で即返す（鍵が未設定の環境でも 401 = 口が開いていない）。
2. アダプタ（`port` の実装）が本文を読み、外部イベント ID と RPC に渡す本文を取り出す。読めなければ 400。
3. **生成された受信の RPC**（`api.inbound_{連携}`）を 1 回実行する。この 1 本のトランザクションの中で、外部イベント ID が宣言された表（`event_id_table`）へ記録され、写像されたドメインイベント（`emits`）の遷移 RPC が呼び出される。
4. 結果を応答に写す。実行できたら 200 / 同じ外部イベント ID の再送は 200 の no-op（`duplicate`）/ 遷移が拒否されたら**宣言どおり**（`on_conflict: retry` は 5xx・`ack` は 200）。

**なぜ記録と遷移が同じトランザクションでなければならないか**（束 ⑲-2b-b の是正）。記録だけが成功して
遷移が落ちると（DB の一時障害・関数のタイムアウト・プロセス断）、相手が再送しても**記録済みの外部
イベント ID が「反映済み」と判定されて no-op になる** —— その通知は永久に失われる（入金通知を
取りこぼす形）。同じトランザクションなら、遷移が 0 行（宣言された `from` と実際の状態が食い違う）の
ときに記録も戻るので、相手の再送がそのまま再試行になる。ADR-0011 §4「保存点の内側は全部か無しか」を
受信に当てたものであり、複合 RPC とまったく同じ形である。

**なぜワーカーを挟まないか**（2026-09-12 の見直し）。以前の版はここに「ジョブを積んで即 200、ワーカーが
operation を呼ぶ」と書いていたが、ワーカーが担っていたのは非同期性ではなく **at-least-once の再実行**で
あり、その役目は上の 1 トランザクションが引き受ける（落ちたら何も残らない = 相手の再送で再試行される）。
遅い仕事（通知の送信）は**遷移の effects が outbox に積む**ので、非同期の境界は今までどおり保たれる。
受信口に業務の判断を書かないという元の趣旨（下の MUST）も守られている —— 生成された口には `if` が
1 つも無い。

---

## 制約・不変条件

- **MUST**: operation が外部 SDK の型・例外・エンドポイントを知らないこと。IF は業務語彙で定義する（PRIN-0005）。
- **MUST**: 外部の状態を変える呼び出しは outbox ジョブ経由とし、冪等キーを付ける。
- **MUST**: Webhook 受信口は署名検証と**受信の RPC を 1 回呼び出すこと**以外を行わない。受信口は生成物であり、判断（`if`）を 1 つも持たない。
- **MUST**: 受信の**記録と遷移は 1 トランザクション**で行う（生成された `api.inbound_{連携}`）。記録だけを別に永続化する経路を作らない —— 記録が残って遷移が落ちると、相手の再送が「反映済み」の no-op になり、その通知が永久に失われる（ADR-0011 §4 と同じ形）。
- **MUST**: 受信の書き込みは **data_table の `functions` に宣言された RPC**（記録先の作成 RPC と `emits` の遷移 RPC）だけを通る。アダプタは 1 行も書き込まない（`permit` の外の write を作らない）。
- **MUST**: Webhook が起こすドメインイベントは `state_spec` に `by: [system]` のイベントとして定義済みであること。仕様に無いイベントを Webhook から発火させてはならない（PRIN-0001）。**X5 が `emits` の接地として機械検証する**（`by` にシステムのロールを含むこと・`from` がちょうど 1 つでガードが無いこと）。受信口は判断材料を読まないので、「どの状態なら実行してよいか」は宣言された `from` そのものが遷移 RPC の `p_expected_state` になる。
- **MUST**: 受信の連携は**受け取る側の軸**（`signature` + `signature_key` / `event_id_table` / `emits` / `migration` / `on_conflict`）を `external_spec` に宣言する。揃って初めて口を生成できるので、部分的に書ける形にしない（external-spec-writing.md §受け取る側の軸）。
- **MUST**: 署名を検証する連携（`signature != none`）は `degrade: refuse` であり、鍵は **`config` の id を名前で指す**（`signature_key`）。位置（先頭）で決める形にしない —— 鍵以外の設定を 1 つ足した瞬間に検証が常に落ちる。
- **MUST**: `signature: none`（誰でも叩ける口）は理由（`signature_reason`）を宣言する。この体系は免除に必ず理由を要求する（PRIN-0009）。
- **MUST**: 遷移が拒否されたときの返し方（`on_conflict`）を宣言する。**既定を持たない** —— 相手に再送させるか 2xx で閉じるかは相手の再送の契約でしか決まらず、体系が推測すると「通知を黙って捨てる」か「再送が永久に止まらない」のどちらかを引き当てる。
- **MUST**: 手で書くのはアダプタ（`port` の実装）だけであり、その責務は「署名が載るヘッダ名」と「本文の読み取り」の 2 つに限る。鍵・呼び出す RPC・HTTP の状態はアダプタに書かない（宣言から生成される）。
- **MUST**: 連携先の仕様(相手・向き・効果・ポート・縮退・タイムアウト・リトライ・送る情報)の宣言の置き場は `external_spec`(`docs/specs/backend/external.md`。1 プロジェクト 1 カタログ)である。連携先ごとにファイルを分けない。
- **MUST**: シークレットはサーバー側の環境変数から読む。クライアントに露出する変数名で外部認証情報を扱わない（PRIN-0009）。
- **MUST NOT**: `src/components` / クライアントコンポーネントから外部 API を直接呼ばない。
- **MUST NOT**: Webhook 受信口の中で**判断**（どのイベントを起こすか・起こしてよいか）を行わない。状態を変えるのは生成された RPC であり、実行してよい状態の条件（`p_expected_state`）は宣言された `from` そのものである（受信口は宣言を運ぶだけである）。
- **SHOULD**: アダプタ実体を叩くテストは**オプトインのスイート**とし、CI のブロッキング対象から外す。外部サンドボックスの不安定さで開発が止まらないようにする。

---

## 実装配置

- path: `app/src/infrastructure/{service}/` — アダプタ 1 サービス 1 ディレクトリ
- path: `app/src/app/api/inbound/{連携}/route.ts` — 受信口（生成物。動詞の規則の例外。route-handlers.md §受信 Webhook の口）
- path: `app/src/composition/inbound/{連携}.ts` — 受信口の配線（生成物）
- path: `supabase/migrations/{14 桁}_inbound_{連携}.sql` — 受信の RPC（生成物。名前は `migration` が宣言する）
- path: `docs/specs/backend/external.md` — 連携仕様(1 プロジェクト 1 ファイル。`external_spec`)
- pattern: 冪等キーは `{job_type}:{job_id}` のようにジョブから決定的に導く（乱数を使わない）

---

## 境界・レイヤーに関する追加情報

### 外部イベント ⇔ ドメインイベントの接続

外部から来た事実も、UI 操作と同じ**ドメインイベント ID**に落として状態機械に入れる。

| 発火元 | 宣言 | 検証 |
|--------|------|------|
| 画面 | `specs/frontend` の `emits: {machine}.{event}` | 人間ロールの全イベントに UI 到達経路があるか |
| Server Action | `specs/backend/actions` の `handles: {machine}.{event}` | 未定義イベントを処理していないか |
| Webhook / Cron | `specs/backend/external` の `emits: {machine}.{event}` | `by: [system]` のイベントに発火元があるか |

この 3 種が同じ ID 空間を共有することが、連携が増えても仕様体系を増築しない理由である（ARCH-SP-0002）。

### テストの位置づけ

- IF に対するモック注入で operation を unit テストする（`vi.mock` 等のモジュール差し替えは禁止。ARCH-BE-0001 の E6）。
- アダプタ実体はサンドボックスに対するオプトインスイートで確認する。CI 非ブロッキングとする判断の理由は連携先を追加する時点で ADR に残す。
- Webhook 受信口は生成物なので、固定するのは**段取りの実体**（`run-inbound.ts`）である —— 署名不正 401 / 再送 200 の no-op / 拒否は宣言どおりの応答 / **記録だけを残す経路が存在しないこと** を fake の実行器で見る（`app/src/infrastructure/__tests__/inbound/run-inbound.test.ts`）。生成される配線の形と、記録と遷移が 1 トランザクションに入る SQL は docs 側の生成器の単体テスト（`code-inbound-route.test.ts` / `code-inbound-rpc.test.ts`）と `fixture`（stores）が見る。

---

## 実装のきまり・コード例

- テストの書き方: [process/backend/system/standards/conventions/testing/](../../../process/backend/system/standards/conventions/testing/README.md)
- ジョブの実行モデル: [ARCH-BE-0015](./ARCH-BE-0015-async-job-execution.md)
