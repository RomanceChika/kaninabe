---
doc_type: architecture
scope: backend
id: ARCH-BE-0013
norms: [PRIN-0001, PRIN-0003, PRIN-0007, PRIN-0008, PRIN-0009, PRIN-0010, ARCH-BE-0001, ARCH-SP-0002]
decisions: [ADR-0004]
---

# ARCH-BE-0013 — Server Action の構造（ドメインイベントハンドラ）

## 目的

Server Action を「ドメインイベントを 1 つ処理するハンドラ」として構造的に固定し、**仕様（ドメインイベント）と実装（アクション）の対応を 1:1** に保つ。書き方の自由度を奪うことで、レビュー対象を「意味が合っているか」だけに絞る。

## 概要

- **1 Server Action = 1 ドメインイベント**。アクションは `handles: {machine}.{event}` でどのイベントを処理するかを宣言し、仕様（`action_spec`）と 1:1 で対応する。
- 本体は**定型 4 手順**に固定する: ①生成 zod スキーマでパース → ②判断に要る事実を読む → ③エンジンに可否を照会（`permit`）→ ④**定型 RPC を 1 回**呼び出す（`effects` はその引数として渡り、outbox へ積むのは RPC の中である）。
- **その定型に個性が無いので、Server Action と Composition Root と operation は書かない —— `npm run generate` が書く**（束 ⑰）。**ユニットテストも生成物である**（束 ⑰-3）。手で書くのは `runner: manual` を理由つきで宣言した操作と `scans:` の経路だけであり、A15 が両方向を見る —— 宣言が無いのに導出できなければエラー、導出できるのに宣言していてもエラーである。
- 失敗は **throw せず `Result` 型で返す**。ドメイン上の拒否は **ガード不成立 / 権限なし / 不変条件違反** の 3 分類に必ず落とす。
- **読み取りは Server Action ではない**。RSC + クエリ関数で行う。
- **DB アクセスは必ずサーバー経由**とし、RLS は第二防衛線として全テーブルに置く。

## スコープ

- **対象**: Server Action の責務・構造・入出力の形、読み取り経路との分離、エラー分類の契約、権限とガードの判定場所。
- **対象外**:
  - 層構成と依存方向（→ ARCH-BE-0001）
  - 外部連携（→ ARCH-BE-0014）、outbox とワーカー（→ ARCH-BE-0015）
  - コードの書き方・命名・例（→ process/backend/system/standards/conventions/server-actions.md）
  - `action_spec` の書き方（→ process/backend/specification/standards/action-spec-writing.md）と置き場所（→ ARCH-SP-BE-0001）

---

## 構成

| 要素 | 責務 | 置き場所 |
|------|------|---------|
| Server Action | リクエスト境界。入力を受け、composition から operation を取得し、結果を `Result` で返す（**生成物**） | `app/src/app/_actions/{aggregate}/{event}.ts` |
| 実行計画 | その操作が何を読み・どの規則表に問い・どの RPC にどの引数を渡すか（**生成物**。仕様からの導出） | `app/src/domain/generated/operation-plans.ts` |
| 実行計画の実行器 | 4 手順の**順序そのもの**。計画を 1 つ受け取って実行する唯一の関数で、保存点も単発の操作も同じ道を通る | `@kaninabe/runtime/template`（`framework/runtime/src/operation/_template/run-plan.ts`） |
| operation 関数 | 遷移可否の照会・永続化・`effects` の積み込みという業務手順。**`runner: manual` の操作と `scans:` の経路だけ**（宣言された例外） | `app/src/operation/{aggregate}/{event}.ts` |
| 3 形の定型 | 宣言された例外が使う設定の口。遷移 / 編集(バルク形・単行 form 形)に 1 つずつ（作成・削除の定型は計画に吸収されて消えた） | `@kaninabe/runtime/template/{transition,update,update-fields}` |
| 生成ユニットテスト | 仕様が要求する意味クラスごとの場面。fake の FactReader / RpcCaller に対して計画を実行する（**生成物**） | `app/src/operation/__tests__/generated/{aggregate}/{event}.test.ts` |
| 汎用エンジン | 状態 × イベント × ロール × ガードの判定（生成された遷移テーブルを読む） | `app/src/domain/engine/` |
| 生成 zod スキーマ | 入力フィールドの制約（フォームと共用） | `app/src/domain/generated/{entity}.schema.ts` |
| クエリ関数 | 読み取り。RSC から呼ばれる（構造は ARCH-BE-0016） | `app/src/composition/{aggregate}/queries.ts`（配線）+ `app/src/infrastructure/{aggregate}/queries.ts`（写像） |

**判定の場所を 1 箇所に固定する**。状態遷移の可否・遷移権限は、Server Action にも operation にも `if` として書かない。すべてエンジンへの照会に集約する（ADR-0004）。

---

## フロー

### 書き込み（Server Action）

1. **パース**: 生成 zod スキーマで入力を検証する。フォーム側も同じスキーマを import しており、ここは再検証である（PRIN-0007）。
2. **遷移可否の照会**: 現在の状態・実行者のロール・ガードの評価に必要な文脈を渡し、エンジンに `canFire` を問う。拒否理由は分類付きで返る。
3. **永続化**: Repository IF 経由で新しい状態とフィールドを保存する。不変条件のうち DB で守るものは、ここで制約違反として検出されうる。
4. **outbox へ積む**: 仕様の `effects` に対応するジョブ行を、**③と同一トランザクションで**挿入する（ARCH-BE-0015）。

この 4 手順の順序を変えてはならない。②の前に永続化しない、④を③と別トランザクションにしない。**順序は形ごとの定型関数（`@kaninabe/runtime/template` の 5 形）の中に 1 回だけ書かれ、個々の operation はそこへ設定を渡す**。②を飛ばした③は、永続化の口がエンジンの許可（`FireAllowed`）を要求するため型として書けない。

### 読み取り（RSC + クエリ関数）

- 読み取りは Server Action を作らず、RSC から composition のクエリ関数を呼ぶ。**構造の正は [ARCH-BE-0016](./ARCH-BE-0016-read-path.md)** であり、ここでは書き込みとの分離だけを述べる。
- クエリ関数は JWT 付きクライアント（RLS 有効経路）で読む。`access_spec` の `reads` を執行するのは RLS であり、アプリ側の絞り込みではない。
- クライアントコンポーネントからの直接の DB アクセス・`useEffect` でのデータ取得は行わない。

---

## 制約・不変条件

- **MUST**: 1 つの Server Action が処理するドメインイベントは 1 つとする。`handles` に宣言したイベント以外の状態遷移を起こしてはならない。
- **MUST**: 定型 4 手順の順序に従う。①〜④のいずれかが不要な場合も、省略の理由が `action_spec` から読み取れること。
- **MUST**: 結果は `Result` 型で返す。ドメイン上の拒否で例外を throw しない。
- **MUST**: ドメイン上の拒否は 3 分類（`guard_unsatisfied` / `forbidden` / `invariant_violated`）のいずれかに落とす。分類不能な拒否を追加する場合は、この文書と共通規約を先に更新する。
- **MUST**: 5 形の定型（`_template/{transition,create,delete,update,update-fields}.ts`）の内部結果型（Outcome）は判別共用体とし、非成功枝（`conflict` / `invariant_violated`）を形ごとにブランドする。集約のリポジトリが返す生の結果を素通しで返さない —— `seal(form, raw)` を通してブランド付きへ変換する（この 3 分類とは別の層の話で、「対外的にどの分類を返すか」ではなく「テンプレート内部でどの形の結果として扱うか」を型で区別する。詳細は [server-actions.md](../../../process/backend/system/standards/conventions/server-actions.md)「5 形の定型はテンプレート関数として 1 つずつ存在する」)。
- **MUST**: `effects` の積み込みはドメイン書き込みと同一トランザクションで行う（配達保証を outbox に寄せるため）。
- **MUST NOT**: Server Action で状態・権限を `if` で判定しない。エンジンへの照会に置き換える。
- **MUST NOT**: 読み取り専用の操作を Server Action にしない。
- **MUST NOT**: エラーの表示文言（ユーザー向けメッセージ）を Server Action の戻り値に含めない。返すのは分類と識別子であり、文言は UI 側の責務とする。
- **SHOULD**: RLS は全テーブルに書き、`access_spec` と突合する。アプリ側の判定が第一防衛線、RLS が第二防衛線である（PRIN-0009）。

---

## 実装配置

- path: `app/src/app/_actions/{aggregate}/{event}.ts` — 1 ファイル 1 アクション。ファイル名はドメインイベント名と一致させる。
- path: `app/src/operation/{aggregate}/{event}.ts` — 対応する operation 関数。手順は書かず、下の定型に設定を渡す。
- path: `@kaninabe/runtime/template/{transition,create,delete,update,update-fields}` — 4 手順の定型（5 形。編集だけ 2 つあるのは数えるものが違うため — [server-actions.md](../../../process/backend/system/standards/conventions/server-actions.md)「5 形の定型」）。**順序はここにしか存在しない**（形が 1 つ増えるときだけファイルが 1 つ増える）。
- pattern: 仕様は `docs/specs/backend/actions/{aggregate}/{event}.md`（`action_spec`）。**ファイルパスがイベント ID と機械的に対応する**ため、宣言（`handles`）との突合が検証できる（PRIN-0008）。

---

## 境界・レイヤーに関する追加情報

### 入出力（境界面）

- **入力**: `action_spec` の `input` に宣言されたフィールドのみ。制約は `entity_spec` が正であり、アクション側で再定義しない。
- **出力**: `Result` 型。成功時は後続の表示に必要な最小限（新しい状態・識別子）、失敗時は 3 分類のエラー。

### エラー分類（共通契約）

すべての Server Action が同じ形で返す。分類は仕様側の要素に 1:1 で対応する。

| 分類 | 意味 | 仕様側の対応 | 典型例 |
|------|------|------------|--------|
| `guard_unsatisfied` | 状態・時間窓・前提条件が満たされない | `state_spec` の `from` / `guard` / `otherwise_forbidden` | 受付が締め切られている、下書き以外からの提出 |
| `forbidden` | 実行者にそのイベントの実行権限がない | `state_spec` の `by`、`role_spec` の `binding` | 他人の貸出を取り下げようとした |
| `invariant_violated` | 保存すると不変条件が破れる | `invariant_spec` の `INV-*` | 同一蔵書への二重貸出、1 人あたりの貸出上限の超過 |

- `forbidden` が持つ `role` は、**判断に使ったロールの解決結果の先頭＝`role_spec` のグローバルロール**（`anonymous` / `patron` / `system`）である。`binding` 由来の文脈依存ロール（`loan_owner` / `item_librarian`）はここに現れない —— 拒否は「その文脈依存ロールが成立しなかった」場合に起きるものだからである。成立したロールの集合まで載せるなら `role` を複数にする判断が要り、それはこの文書の改訂になる。
- **多要素認証の要求に掛かった拒否も `forbidden` である**（分類は増やさない）。認証フロー仕様が要求するロールの実行者が、多要素認証を済ませていないセッションで書き込もうとすると、実行器が判断と書き込みの前に `forbidden` を返し、`mfaRequired: true` の印を付ける。印は画面が要素の登録・確認の画面（生成された `AUTH_MFA_PATH`）へ送るためだけにあり、ほかの拒否には付かない（[auth-spec-writing.md §mfa](../../../process/backend/specification/standards/auth-spec-writing.md)）。
- **回数・間隔の制限に掛かった拒否も `guard_unsatisfied` である**（分類は増やさない。点検 17 回目）。制限は DB が判定し（先読みの照会には現れない）、`UC412` の詳細にどの制限かの語を、時刻で解ける制限は次に通る見込みの時刻を載せる。実行器はそれを `reason`（製品の閉じた表の語）と `retryAt`（ISO 8601）に写し、画面は表の語に当たったときだけ専用の文言で「どの制限か・次はいつか」を言う。`retryAt` はほかの拒否には付かない。語の表は製品が持つ（DB の語の写しを 1 か所に置き、リポジトリ・Action の結果・画面の文言が同じ表を引く）。
- 入力そのものの不正（生成 zod スキーマでのパース失敗）は、上記 3 分類とは別に**フィールド単位の検証結果**として返す。これはドメインの拒否ではなく、フォーム側で同じスキーマにより事前に排除されるべきものである。
- 具体的な型・命名・戻り値の形は [server-actions.md](../../../process/backend/system/standards/conventions/server-actions.md) に定める。
- 想定外の失敗（DB 接続断など）は throw のまま扱う。`Result` で表現するのは**仕様に書かれた拒否だけ**とする。**受けるのは Next.js のエラー境界ではない**（点検 19 回目 B19-1 で実測。Action はクリックの処理から呼ばれ、その Promise の拒否は描画の外なので境界に届かない）。受け口は 2 つで、どちらも仕組みが持つ: ①生成した Server Action は投げ直す前に、5 番目の種類 `temporarily_unavailable`（**業務の拒否ではない**一時的な失敗。欄を持たない）で 1 行記録する ②画面の実行器（`runAction`）は例外を受けて `pending` から戻し、同じ種類を固定の文言で出す（例外の文言は画面へ運ばない）。巻き戻りが確実な DB の失敗（SQLSTATE `40001` / `40P01`）は、ここへ来る前に adapter が上限つき（3 回）でやり直す（`@kaninabe/adapter-postgrest` の `retryRollbacks`）。手書きのリポジトリは DB の失敗を `dbFailure(where, error)`（`DbInfrastructureError`）で投げ、素の `Error` に DB の文言を詰めない（`layer/no-bare-db-error`）。例外はコミットの状態を持つ: DB が組み立てた誤りの応答で、その誤りが txn ごと戻る類（SQLSTATE の閉じた表 `@kaninabe/runtime/refusal` の `commitOfDbError`。PostgREST はさらに HTTP の状態が 4xx）なら `not_committed`、それ以外（通信の切断・接続や停止の類）は `unknown` で、画面は `unknown` のときだけ「書けたか分からない」の文言と読み直しにする（点検 25 回目 O25-1）。
- **同じ 3 分類を DB も返す**（束 ⑳-3。ADR-0012 ⑤）。定型 RPC の本文が `by` とガードと期待状態を
  守るようになったので、書けなかった理由は errcode で上がる（`UC403` = `forbidden` /
  `UC412` = `guard_unsatisfied` / `UC409` = 判断時の前提が崩れた）。**TS の判定は先読みであり、
  権威は DB 側にある** —— 先読みを通っていれば errcode は上がらないので、上がったということは
  「判断に使った事実が書き込みまでに動いた」か「engine を通らない経路から実行された」である。
  どちらも DB の判定が正であり、実行器はその分類をそのまま上の表に写す。
- **先読みと執行が同じ判定を下すことは生成したテストが実測する**（束 ⑳-5a）。操作ごとに
  「対象の状態 × 実行者 × ロール配列 × ガード変数の境界値 × 編集の欄」を**全列挙**して実 DB で実行し、
  engine の判定と errcode を突き合わせる（`__tests__/generated/equivalence/**`。置き場と実行方法は
  [testing/integration.md §一致の証明は生成物である](../../../process/backend/system/standards/conventions/testing/integration.md)）。
  **拒否に何を求めるかは data_table の宣言で決まる** —— 本文が生成物の RPC は理由まで、`handwritten:` を
  宣言した本文は 0 行で可否だけ、`shape: composite` の RPC は判定を持たない（守るのは engine だけ）。
  上の 3 分類のうち `invariant_violated` だけは engine が予測しない分類なので、許可された組み合わせが
  制約で落ちるのは**一致**として数える（分類が別であることの帰結である）。

---

## 実装のきまり・コード例

- Server Action の実装規約（型・命名・禁止事項・例）: [process/backend/system/standards/conventions/server-actions.md](../../../process/backend/system/standards/conventions/server-actions.md)
- `action_spec` の書き方: [process/backend/specification/standards/action-spec-writing.md](../../../process/backend/specification/standards/action-spec-writing.md)
