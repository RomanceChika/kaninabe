---
name: add-operation
description: ドメイン操作（状態遷移・作成・削除・編集）を1つ追加する完全手順。宣言の軸の判定 → verify → action_spec → generate → verify の A15（実装は生成物）→ RPC migration（宣言すれば本文は生成物。OCC/ロック/監査ログの判定は生成物を読むため）→ テスト → 全検査。「◯◯できるようにしたい」「この操作を足したい」「Server Actionを1本増やす」ときに使う。
---

# ドメイン操作を1つ追加する

このリポジトリは**仕様が正（Spec as Truth）**である。実装を先に変えて仕様を後追いさせない。
このスキルは**手順の索引**であり、内容の正ではない。各手順の「正」に挙げた文書を必ず開く
（正典が変わってもスキルが古びない形にしてある。表とリンク先が食い違ったらリンク先が正）。

## このリポジトリの進め方（ビルダー×レビュアー）

まとまった変更は **設計凍結 → ビルダーが実装 → 独立したレビュアーがレビュー → 裁定を反映** の4段で回す。
ビルダーは凍結した設計から外れる判断をしたら、その場で直さず**理由つきで報告**する（裁定はユーザーが下す）。
レビュアーは実装を読まずに仕様と正典から期待を組み立て、差分を指摘する。
裁定の結果は製品の作業記録に残し、正式化できるものだけ `docs/rules/` に昇格させる。
1操作の追加のように閉じた作業では、ビルダー1人が **①手順⑧の全検査緑 ②自己レビュー（下の「わざと壊す観点」）** で代替してよい。

## 先に読む正典

| 何を | どこ |
|------|------|
| ドメイン仕様の書き方（state_spec / access_spec / ガード式 / V1〜V11） | [domain-spec-writing.md](../../../docs/rules/process/common/specification/standards/domain-spec-writing.md) |
| ドメイン仕様の変更手順 | [domain-spec-change.md](../../../docs/rules/process/common/specification/playbooks/domain-spec-change.md) |
| action_spec の書き方（A1〜A10 / covers / 薄さの基準） | [action-spec-writing.md](../../../docs/rules/process/backend/specification/standards/action-spec-writing.md) |
| Server Action / operation の実装規約（生成物と、手書きしてよい例外） | [server-actions.md](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md) |
| 構造・4手順・エラー3分類の契約 | [ARCH-BE-0013](../../../docs/rules/architecture/system/backend/ARCH-BE-0013-server-action-structure.md) |
| DB側の防衛線（GRANT / RLS / 制約 / トリガー） | [database-guards.md](../../../docs/rules/process/backend/system/standards/conventions/enforcement/database-guards.md) |
| テスト規約 | [testing/unit.md](../../../docs/rules/process/backend/system/standards/conventions/testing/unit.md) / [testing/integration.md](../../../docs/rules/process/backend/system/standards/conventions/testing/integration.md) |

---

## ① 宣言の軸を決める（state_spec か access_spec か）

**どちらの軸かを間違えると、以降の全手順が別の定型になる。** まずここを決める。

| やりたいこと | 宣言する場所 | `handles` に書く ID | 実装の形 |
|-------------|------------|-------------------|---------|
| 状態が変わる。あとから「そうなった」を参照する必要がある | `docs/specs/domain/{aggregate}/states.md` の `events` | `{machine}.{event}` | 遷移 |
| 行を新しく作る | `docs/specs/domain/{aggregate}/access.md` の `creates` | `{entity}.create` | 作成 |
| 行を消して、以後どこからも参照しない | 同上の `deletes` | `{entity}.delete` | 削除 |
| 状態を変えずにフィールドを書き換える | 同上の `writes` | `{entity}.update` | 編集（バルク or 単行。⑤で分岐） |
| 時刻が来たら自動で起きる | `states.md` の `events` に `by: [system]`（人間経路と混在なら `by: [librarian, system]`） | **action_spec を作らない**。⑥の代わりに走査を書き、製品の `docs/specs/backend/actions/README.md`(フロントマターの宣言の置き場。デモ製品の木には無い)の `scans` に宣言 | 走査（実装は起こすイベントの operation に同居） |

**迷ったときの2問。**

1. **「消す」に見えるが、あとから参照する必要があるか。** 必要なら状態遷移（`hold.cancel` / `item.report_lost`）、不要なら `deletes`。論理削除（`deleted` 状態・`deleted_at` 列）を `deletes` で表してはならない。
2. **`state` フィールドが動くか。** 動くなら遷移。動かないなら `writes`。`writes` に `state(...)` 型と `auto: true` のフィールドは書けない。

書くときの規律（正は domain-spec-writing.md）:

- 状態・イベント・ロールには `label`（日本語名）を必ず付ける。生成されるマトリクス・図の可読性がこれで決まる。
- `by` は許可リストであり**空はエラー**。載っていないロールは拒否（deny by default）。
- `from` に無い状態は `otherwise_forbidden` の理由で禁止と見なされる。**理由の省略はエラー**。理由は業務の言葉で書く。
- `guard` / `when` / `binding` が参照できるのは `entity_spec` の `context` で解決できるパスと `actor` / `now` だけ。
- 作成後の状態は書かない（`state_spec` の `initial` が正）。`creates` / `deletes` / `writes` に `effects` は書けない（v1）。

## ② verify — 出るべきエラーを読む

```bash
npm run verify
```

**エラーの一覧は「決めるべきことのTODOリスト」である。** 黙らせるための場当たりな定義（意味のない禁止理由・恒真ガード）を書かない。

> **⚠ 仕様を先に書くと verify は必然的に赤くなる。** 検証器は仕様と実装を**双方向**に突き合わせるので、
> `action_spec` を置いた時点で「Server Action が無い（A2）」「テストファイルが無い（A6 / S8）」
> 「実ルートが無い（S7）」が並ぶ。これは**手順が正しく進んでいる印**であって、書き直しの合図ではない。
> **エラー0は⑧（実装とテストが揃った時点）の条件**であり、②の出口条件ではない。
> ②で消すのは下の表の**仕様だけで決まるもの**（V群 / A4 / A7 / A10 / S10）である。

| 出たエラー | 何を決めろと言われているか |
|-----------|------------------------|
| **V3** 全域性（遷移） | 新しいイベントを、`from` に無い状態から実行できない**理由**（`otherwise_forbidden`）。状態ごとに理由が違うなら `forbidden:` ブロック |
| **V5 / V6 / V7** 到達可能性・デッドエンド・final不変 | 足した状態への入り口／出口がない。final から出る遷移を書いた |
| **V8** 決定性 | 同じ（状態, イベント, ロール）で2つの遷移が同時に成立する。ガードを排他にするかイベントを分ける |
| **V9** ガード充足性 | 書いたガードが恒偽（絶対に成立しない）か恒真（書く意味がない） |
| **V11** ロール接地 | `by` / `creates` / `writes` / `deletes` のロールが `roles.md` に無い、または `binding` がそのエンティティから解決できない（`entity_spec` の `context` 不足） |
| **A4** ハンドラの網羅 | 人間ロールが実行できるのに `action_spec` が無い → ③へ。作らないなら製品の `actions/README.md` の `unhandled` に**理由つき**で宣言 |
| **A10** 走査の網羅 | `by` に `system` を含むのに実行する実装が無い → `scans`（実装パスの実在も検査される）か `unscanned`（理由）を同 README に |
| **A7** 意味的カバレッジ | ドメイン仕様が要求する意味クラスが `covers` の和集合に無い → ③の `test_cases` に足す |
| **S10** UI到達の網羅 | どの画面の `actions` にも現れない → 画面を作る（`/add-screen`）か製品の `docs/specs/frontend/screens/README.md` の `unexposed` に理由つきで宣言 |

**⑤〜⑦を書くまで消えないエラー**（出て当然。①②の往復では消せない）:

| 出たエラー | 何が無いと言われているか | 消える段 |
|-----------|--------------------|---------|
| **A2** | `app/src/app/_actions/{aggregate}/{event}.ts`（実装の木に置かれる Server Action の実在。パスは `handles` から機械的に決まる） | ⑤ |
| **A6** | `test_cases[].implementation` が指すテストファイル（+ その中の `@tc` とテスト名の一致） | ⑦ |
| **S7** | `screen_spec` の `route` に対応する `page.tsx` / `proxy.ts` の `matcher`（画面を足したときだけ） | `/add-screen` の④ |
| **S8** | 画面の `test_cases[].implementation`（同上） | `/add-screen` の⑤ |

**①②で消せるものを消し切ったら③へ進む**（残りは実装が埋める）。最終的にエラー0にするのは⑧である（警告は既存分が残っている）。

> **⚠ 編集（`writes` / `{entity}.update`）だけは、エラー0が完了を意味しない。** A4 の母集合に `writes` は入らないため、`action_spec` も operation も Server Action も無いまま verify は緑になる。理由と、代わりに何が残りを見ているか（S10 / A7）は [action-spec-writing.md §A4 の死角](../../../docs/rules/process/backend/specification/standards/action-spec-writing.md) が正。**編集のときは検証器の沈黙を合図にせず、自分で③へ進む。**

## ③ action_spec を書く

置き場は `docs/specs/backend/actions/{aggregate}/{event}.md`、`id` は `{aggregate}-{event}-action`（例 `hold-cancel-action`）。
テンプレート: [`docs/specs/backend/actions/template.action_spec.md`](../../../docs/specs/backend/actions/template.action_spec.md)。
書き方の正: [action-spec-writing.md](../../../docs/rules/process/backend/specification/standards/action-spec-writing.md)。

> **⚠ `{aggregate}` は domain 配下と backend 配下で意味が違う**（action_spec の置き場は `handles` のエンティティ名、ドメイン仕様の置き場は集約名で決まる。1集約に複数のエンティティを置く製品では食い違う。このデモ製品では `loan` / `item` / `hold` が揃っている）。対応表と探し方は [placement_policy.md §`{aggregate}` は場所によって意味が違う](../../../docs/rules/meta/standards/placement_policy.md) が正。

**action_spec は薄いことが正しい。** 状態・権限・ガード・制約・通知を書きたくなったら、書く場所が違う（同文書 §薄さの基準の表が正）。書くのは `handles` / `input` / `errors` / `test_cases` の4つだけ。

### input に何を並べるか（形ごとに違う）

`{entity}.{field}` の完全修飾名のリストで書く。**型・必須・最大長・書式は書かない**（制約の正は `entity_spec`）。**実行者（actor）は書かない**（サーバー側のセッションから導く）。

| 形 | `input` に並べるもの |
|----|-------------------|
| 遷移 | 対象を特定する識別子と、その遷移で受け取るフィールド |
| 作成 | 作成時に受け取るフィールド。**`{entity}.id`（`auto: true`）と `{entity}.state` は書かない**（初期状態は `state_spec` の `initial`） |
| 削除 | **`{entity}.id` だけ**。削除に本体のフィールドは要らない |
| 編集 | 対象の識別子と、更新するフィールドだけ（どのロールが更新してよいかは `writes` が正なので書かない） |

`errors` は `inherits: common` を必ず書く（3分類は全アクション共通の契約であり、アクションごとに再定義しない）。固有のエラーがあるときだけ `additional` に足す。表示文言は書かない（UI の責務）。

### covers（意味クラス）— どの行を読むか

`covers` に何が必要かは**ドメイン仕様から導かれる**（`action_spec` の中身からは導かない）。
必要クラスの導出表は [action-spec-writing.md §A7 — 必要な意味クラスの導出規則](../../../docs/rules/process/backend/specification/standards/action-spec-writing.md) にあり、**その表が正**である。
ここでは「①で決めた形が、A7の表のどの行か」だけを示す。

| ①で決めた形 | A7の表で読む行 | 特に落としやすいもの |
|------------|--------------|-------------------|
| 遷移 | 「遷移 `{machine}.{event}`」 | `conflict`（**常に要る**）/ `invalid_from` / `guard` を書いたら `guard_unsatisfied` |
| 作成 | 「作成 `{entity}.create`」 | `forbidden`（**常に要る** — deny by default なので拒否されるロールが必ずいる）。`conflict` は要らない |
| 削除 | 「削除 `{entity}.delete`」 | `not_found`（削除だけが要求される）と `conflict` |
| 編集 | 「編集 `{entity}.update`」 | `invariant` の**フィールド交わり判定**。集約をまたぐ（`item.update` が貸出に効く欄を書くと `INV-LOAN-001` に触れる、など） |

判定に迷ったら「**そのテストが置かれている状況**（何を崩して実行したか）」で選ぶ。返るエラー種別ではない。
`other` に逃がさない（A7の網羅判定に一切寄与しない）。

### test_cases の ID は追記専用

- 形式は `TC-{AGGREGATE}-{EVENT}-{NNN}`。
- **全仕様（`query_spec` / `screen_spec` を含む）を通じて一意**。母集合は1つの台帳であり、A9 が見る。
- **追記専用**。残るケースは番号を変えず、廃止したケースの番号は**欠番のまま残す**。新しいケースには常に最大値の次を振る。
  台帳の既存IDは `grep -rhoE 'TC-[A-Z0-9_-]+' docs/specs | sort -u` で確認する（同じ接頭辞の最大値の次を振る。欠番は飛ばす）。
- `implementation` は `{リポジトリルートからのパス}::{テスト名}`。テスト名は日本語で、テストコード側と**一字一句一致**させる。
- `spec_ids` に書けるのは値域（ドメインイベントID / `access_spec` の id / 不変条件ID）。A8 が実在を検査する。

## ④ generate

```bash
npm run generate
```

生成物（`<!-- AUTO-GENERATED -->` ブロックと `app/src/domain/generated/`）を**手で編集しない**。
新しい判定表（`{entity}.creates.ts` / `.deletes.ts` / `.writes.ts` / `{machine}.transitions.ts` / `{entity}.schema.ts`）はここで出る。

意味レビュー: `generate` が書き出す生成ブロック（要約・表・図。製品がハンドブックを生成するならその章）で変更した集約を読む — 機械が保証できない箇所（⚠・ガードの「意味」列）と **state × event マトリクス**（暗黙に禁止したマスの理由が意図と合っているか）が章にインラインで埋まる。

## ⑤ 実装もテストも生成される（手で書くのは例外だけ）

**`npm run generate` が Server Action（`app/src/app/_actions/{集約}/{イベント}.ts`）・
Composition Root（`app/src/composition/{集約}/{イベント}.ts`）・**ユニットテスト**
（`app/src/operation/__tests__/generated/{集約}/{イベント}.test.ts`）を書く**（束 ⑰）。実行するのは
仕様から導いた実行計画（`app/src/domain/generated/operation-plans.ts`）と唯一の実行器
`app/src/operation/_template/run-plan.ts` であり、**操作ごとに書く手順は 1 行も無い**。
④ の `generate` を回した時点でこの 3 ファイルは立っている。`action_spec` の `test_cases` の
`type: unit` も生成ブロックの中身として書かれる（手で書かない）。

したがってこの段でやることは 2 つだけである。

1. **`npm run verify` の A15 が通っているか**を見る。通っていれば実装は終わっている。
2. 通っていなければ、反例が名指しした欠けを**仕様側で**埋める。
   - 定型 RPC の引数名が規約から外れている → `data_table` の `params` を規約（`p_{集約}_id` 等）に揃える migration を書く
   - 入力に無い値を RPC が要求している → `input` に足す / `entity_spec` に `supplied_by: db`（V17）/
     遷移が実行者を書き留める列なら `state_spec` の `records_actor`（V19）/ 純関数が決めるなら
     action_spec の `computes`（V18）
   - 遷移が自分の列を空にするなら `state_spec` の `clears`（V19。宣言が無ければ「触れない」）
   - どれでもない（一括の RPC・同一トランザクションで別表を書く副作用）→ action_spec に
     **`runner: { kind: manual, reason: … }`** を理由つきで宣言し、そのときだけ operation・
     Composition Root・Server Action・そのユニットテストを手で書く

**A15 は逆向きも見る。** 計画が導出できてしまう操作に `runner` を書くとエラーになる（宣言された例外が
理由文つきの免除リストに退化しないように）。逃げ道として `runner` を書くことはできない。

`runner: manual` を書いた操作の一覧と理由は生成されるハンドブックの「誰が何を実行できるか（操作）」§生成に乗らない操作に出る（生成物。ハンドブックを生成しない製品では action_spec の `runner` を直接探す）。
形の正は [server-actions.md §単発の操作の Server Action と Composition Root も生成物である](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md)。

### 手書きしてよい 2 か所

| 置き場 | 何を書くか |
|---|---|
| `app/src/operation/{集約}/hooks/{イベント}.ts` | DSL の外にある `application` 執行の不変条件を入力から判定する純関数（鍵の全数は計画が型で要求するので実行し忘れが起こらない） |
| `app/src/operation/{集約}/{イベント}.ts` と、その Composition Root・Server Action | **`runner: manual` を宣言した操作だけ**。ポート・リポジトリ・5 形のテンプレートを使う従来の書き方は、この場合にだけ残る |

### RPC を新しく書くなら型も足す

`app/src/infrastructure/supabase/database.functions*.ts` に署名（`Functions`）を足す。無いと
`client.rpc(...)` が型で落ちる。新しいテーブルを足したなら行の型（`database.rows.ts`）も。

パスと export 名の一致は ESLint の `layer/action-naming` / `layer/operation-naming` が機械執行する。
ディレクトリ名は `handles` の前半（＝ `access_spec` の `entity`）に合わせる（`hold.*` → `_actions/hold/`）。
Server Action の責務は「入力の受け取り → Composition Root から operation を取得 → 呼び出し → `Result` を返す → 必要なら再検証」だけ。

入力フォームを伴うなら、制約を画面に書き写さず `app/src/domain/inputs/{entity}.ts` の導出を両方が import する
（正: [server-actions.md §フォームと Server Action は同じ導出スキーマを使う](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md)、口の実装は `app/src/domain/form.ts`）。

## ⑥ RPC migration — まず「要るか」を判定する

### 判定 — migration が要るか

**要否と、その RPC が持つべき性質は [server-actions.md §5 形 × migration の要否](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md) の表が正。** 開いて①で決めた形の行を読む。要点だけ:

- **遷移（既存の状態機械）は新しい RPC が要らない。** `apply_{machine}_transition` が汎用（状態名もイベントも引数で受ける）。**要らないと判定したらこの手順を飛ばして⑦へ行く**（既存の遷移 RPC の本文を変える必要が出たときだけ、`migration` の連番を新しくして再生成する）。
- 作成 / 削除 / 編集（2形）と、新しい状態機械・新テーブルは要る。
- **その集約が `domain_events` に初めて現れるなら、`check (entity in (…))` に1語足す migration** も要る（テーブル自体は前からあっても、監査ログに載るのが初めてなら必要。実例: `docs/specs/backend/data/tables/domain_events.md` の宣言）。

以下は「要る」と判定したときだけ読む。

**定型 4 形（作成 / 編集 / 削除 / 遷移）の本文は書かない —— 宣言すれば生成される。**
`docs/specs/backend/data/tables/{table}.md` の `functions` に
`name` / `args` / `params` / `kind: rpc` / **`shape`** / `also_writes` / **`migration: {14 桁}_rpc_{関数名}.sql`** を足し、
`npm run generate` を実行すると、その名前の migration に plpgsql がまるごと書き出される
（許可列・楽観的並行制御・監査ログ・副作用・空を渡された列の扱いは、下の節に書いてある性質のまま
生成器が組み立てる。下の節は**生成物を読むための解説**であって、書き写す手順ではない）。

- 本文が仕様から導けない定型 RPC（DSL 外と宣言された不変条件の連鎖を持つ等）は、`migration` の代わりに
  **`handwritten: {理由}`** を書いて本文を手で書く。どちらも無ければ `npm run verify` の **T6** が落ちる
  （理由は**空にできない**。理由の無い免除は免除リストと同じものになる）。
- **作成 RPC の `p_values` は entity_spec が母集合**である（action_spec ではない）。必須で列の既定値を
  持たない欄と、action_spec の `input` に現れる欄を受ける —— つまり**必須の欄に既定値があるなら
  `data_table` の `defaults` に書く**（書かないと本文がその列を素で入れ、鍵の無い日に NULL が入る。
  data-table-parity がこの向きも見る）。
- `shape: composite`（定型に乗らない手順）は従来どおり全部手書きで、`migration` も `handwritten` も書かない。
- **SQL が変わる仕様変更をしたら `migration` の連番を新しくする**（migration は追記専用の歴史。
  旧ファイルはそのまま残る）。統合テスト `rpc-parity` が「生成したのに当てていない」を落とす。
  **前の名前で書き出したファイルは消す** —— `generate:check` が「宣言から出ない生成ファイル」を
  余分エラーにする（未コミットのものだけが対象）。署名を変えたときの `drop function` は
  生成 migration 先頭の do ブロックが出すので手で書かない。
- **採番は着手時に `ls supabase/migrations/` で最大値を確認し、その次を取る。** 並行して別の作業が走っていると衝突して `db reset` が要る（既に起きた摩擦）。欠番があってもそのままにする。
- 手書きになる migration（composite / `handwritten` / テーブル定義の変更）は、冒頭コメントに**正の所在**（対応する `action_spec` / `access_spec` / ARCH-BE-0013）を書く。既存の migration が全部そうなっている。

### 権威は DB、TS は先読み(束 ⑳-3 で変わった)

**RPC は `by`(ロール)とガードと期待状態を自分で守る。** 誰が・いつ・どのフィールドをは
`access_spec` / `state_spec` が正であり、生成された本文がそれを述語として持つ(ADR-0012 ⑤)。
engine の照会は**先読み**(人に読める理由を DB に行く前に速く返す)であり、権威ではない。
RPC 側の役割は「規則の執行」「原子性」「監査ログ」の 3 つ。

- 定型 5 形は `p_actor_roles text[]` を受け取る(`params` / `args` に宣言する)。渡すのは
  セッションから立つロールの `implies` 閉包だけ —— 文脈ロール(`binding`)は DB が行から立てる。
- 書けなかった理由は errcode で分かれる: `UC403`(ロール)/ `UC409`(状態)/ `UC412`(ガード)。
  判定の順は engine と同じ **状態 → ロール → ガード**(**順の正は engine の `canFire` / `canCreate`。
  SQL はその写し**)。作成・削除・編集に状態の段は無く、その位置に入るのは競合である
  (作成はさらに「同じ id の再送」が並ぶ = ロール → 再送 → 競合 → ガード)。
- 正は [server-actions.md §RPC が `by` とガードを守る](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md)。

### OCC（楽観的並行制御）とロックの要否

**書けなかったときの合図は errcode である**(束 ⑳-3)。下の「0行の意味」は、その errcode が
`UC409`(状態違い = 判断時の前提が崩れた)になる条件を指す —— ロール違いは `UC403`、ガード違いは
`UC412` で、どちらも同じ「0 行」から分かれる。

| 形 | UPDATE / DELETE の条件に含めるもの | 明示ロック（`for update`） | 0行(UC409)の意味 |
|----|--------------------------------|------------------------|----------|
| 遷移 | `where id = … and state = {判断時の状態}` + 宣言された (イベント × from × to) | **不要**（文自身が条件を持つ） | `conflict` |
| 作成 | 条件にする集約の状態（`p_expected_{集約}_{列}`） | 不要 | `conflict`（親が動いた。不変条件は DB 制約・トリガーが執行） |
| 削除 | `where id = … and state = {判断時の状態}` | 不要 | `conflict`（対象が消えた／状態が動いた。`not_found` と区別しない） |
| 編集・単行 form | `where id = … and state = {p_expected_state}` | 不要 | `conflict` |
| 編集・単行 form（**状態列を持たない集約**） | `where id = …` **だけ**（`p_expected_state` を持たない） | 不要 | `conflict`（対象が消えた。**状態が動いた**は起こりえない） |
| 編集・**バルク形** | 対象ごとの**判断時の値**を項目ごとの条件に含める。1件でも食い違えば**全体を0行** | **要る。検査を `for update` 越しに行う（ID順に固定してデッドロックを避ける）** | `conflict` |

**状態列を持たない集約**（`state_spec` を持たない。このデモ製品では `patron`）では、条件にできる「判断時の状態」が無い。
守れるのは「対象がまだ在ること」までに縮み、拒否の理由文（定型の `conflictReason`）が**何が崩れたのかを示す**
（`blockedBy` は 2 値しか無く `state` に寄せるので、理由文で「状態が動いた」と書くと嘘になる）。
**「守るものが無いから」と本人条件（`and id = p_actor_id`）に差し替えない** — 誰が編集してよいかは
`access_spec` の `writes` が正であり、呼び出し側の照会が済ませている。詳細は
[server-actions.md §状態列を持たない集約の単行 form](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md)。

**バルク形にだけロックが要る理由**: 検査と書き込みが別の文なので、その間に他人のコミットが割り込み、
**判断も検査も通ったのに他人の更新を上書きする**（lost update）。単行・遷移・削除は UPDATE 文自身が条件を持つので割り込みは0行として現れる。

### 監査ログ（`domain_events`）— 何行残るかだけが判断点

規則の正は [server-actions.md §監査ログへの追記](../../../docs/rules/process/backend/system/standards/conventions/server-actions.md)。
形ごとに変わるのは**行数**と `payload` の中身だけなので、そこだけ判定表にする。

| 形 | 行数 | `payload` |
|----|------|----------|
| 遷移 | 1行 | （`effects` 側で持つ。イベントIDはエンジンの許可 `transitionOf(decision).event` から） |
| 作成 | 1行 | 挿入した業務フィールド |
| 削除 | 1行 | — |
| 編集・単行 form | 1行 | 変更したフィールドの**新しい値**（旧値は直前の `domain_events` 行から辿れるので二重に持たない） |
| 編集・**バルク形** | **1対象につき1行**（「1回の操作で1行」にしない） | 同上。値が変わらない対象も、指定に含まれていれば1行残る |

共通（形によらない）: 書き込みが**成立した経路でのみ**追記し、**同一トランザクション**で行う。0行（競合）では追記しない。
`actor_id` だけは呼び出し側が渡し、`null` は system（Cron・ワーカー）を意味する。

### 自己矛盾は例外にする（0行＝競合に化けさせない）

空の変更集合・宣言外の列・同じ対象の重複指定・複数の親にまたがる指定は**呼び出し側のバグ**であり、
`raise exception` で落とす。0行（競合）に化けさせると「更新したのに何も起きない」を静かに返すことになる。

### 権限の締め（チェックリスト）

- 関数は `security definer` + `set search_path = public`。
- 末尾で `comment on function` に業務上の意味と「0行 = 競合」を書き、`revoke all … from public` → `grant execute … to service_role`。**Server Action（service_role）からのみ呼べる**状態にする。
- テーブルを新設したなら `revoke all … from anon, authenticated` → `enable row level security` → `access_spec` に対応する読み取りポリシーだけを付ける。

**書き方の正は [database-guards.md](../../../docs/rules/process/backend/system/standards/conventions/enforcement/database-guards.md)**（D1〜D18。✅/❌ のコード例つき）。
そのままの形は、自分の製品の `supabase/migrations/` にある既存の生成 RPC（例 `20260912100005_rpc_insert_loan.sql` に相当するもの）が短くて写しやすい。

## ⑦ テストを書く

**すべてのテストに注釈を付ける。** `// @spec {spec_id} @tc {テストケースID}` を書き、テスト名を `action_spec` の
`implementation` の `::` 以降と一字一句一致させる。突合は双方向（仕様側 A6、テスト側 orphan 判定）。

| 種別 | 置き場 | 何を確かめるか | 正 |
|------|--------|--------------|-----|
| ユニット | **生成物**（`app/src/operation/__tests__/generated/{entity}/{event}.test.ts`）。手で書くのは `runner: manual` / `scans:` の経路だけ（`__tests__/{entity}/{event}.test.ts`） | 成功（ロールごと）・3分類の拒否・競合・不変条件違反。加えて「計画の判定 = エンジンの判定」の性質（fast-check） | [testing/unit.md](../../../docs/rules/process/backend/system/standards/conventions/testing/unit.md) |
| 統合（通し） | `app/src/composition/__tests__/{entity}/{event}.test.ts` | **Composition Root を入口に**実DBまで通す。戻り値の**分類**まで見る（成否だけ見ない） | [testing/integration.md](../../../docs/rules/process/backend/system/standards/conventions/testing/integration.md) |
| RLS | `app/src/infrastructure/__tests__/{entity}/rls.test.ts` | 「見えること」と「見えないこと」の両方。`scope: none` のロールで0件 | 同上 |
| 不変条件 | `app/src/infrastructure/__tests__/{entity}/*.test.ts` | **違反側を必ず書く**。制約が実在し違反が拒否されること | 同上 |
| 監査ログ | `app/src/infrastructure/__tests__/audit/domain-events.test.ts` | 1行残ることと、**競合時に残らないこと**を同じ粒度で足す | server-actions.md §監査ログへの追記 |
| バルクの並行 | `app/src/infrastructure/__tests__/{entity}/concurrency.test.ts` | ロックが無いと lost update が起きること | — |

- **宣言に並ぶ人間ロールごとの成功ケースは生成テストが出す**（`by_role` つき）。`librarian` が `loan_owner` を代理する形（`by: [librarian, loan_owner]`）なら librarian の成功ケースも自動で並ぶ — 宣言に足しただけで実行計画がそのロールを解決していない状態は、生成テストが赤くなって表面化する。
- **仕様から導出する。** 実装を読んで書いたテストは、実装のバグをそのまま追認する。
- **`vi.mock` は禁止**（注入点は IF と DI だけ。リンターが落とす）。DB はモックしない。RLS を無効化（service_role）して権限テストを書かない。
- 読み取りを伴うなら返却形は `toEqual` の**全体比較**（宣言していない列が混ざっていないことを検出できる唯一の防壁）。

**統合テストの足元（実測で踏んだもの）:**

- **`domain_events` は `resetDatabase` の対象外である**（追記専用のログなのでテスト間で残る）。監査ログを数えるときは **`entity_id` で必ず絞る** — `event_id` だけで数えると、同じファイルの前のテストが書いた行を拾う（「競合では追記されない」の検査が誤って赤くなる）。
- シードの口は `app/src/infrastructure/__tests__/seed.ts` にある。**足りない状態は口を足して作る**（テスト内で直接 `auth.admin` を叩かない）。例: `seedAuthUser`（認証ユーザだけ作り `patrons` 行を作らない = 登録前の状態）。

### わざと壊す観点（自己レビュー）— これらを壊して赤になるか

| 壊すもの | 落ちるべきテスト |
|---------|----------------|
| RPC から OCC の条件（`and state = …`）を外す | 競合のケース（`covers: [conflict]`）と `__tests__/schema/rpc-parity.test.ts` |
| `writes` に列を足して `update_{entity}` の許可列を作り直さない | `__tests__/schema/rpc-parity.test.ts` |
| `by` にロールを足して operation が解決しない | そのロールの成功ケース（`by_role`）。義務そのものが無ければ `npm run verify`（A7） |
| `domain_events` の insert を消す／0行の経路でも追記する | `__tests__/audit/domain-events.test.ts` |
| バルク形の `for update` を外す | `__tests__/{entity}/concurrency.test.ts` |
| RLS ポリシーを緩める／付け忘れる | `__tests__/{entity}/rls.test.ts` と `__tests__/rls/policy-parity.test.ts` |
| `access_spec` の `when` を書き換える | ガード不成立のケース（`guard_unsatisfied`） |
| `by` からロールを1つ外す | 権限のケース（`forbidden`） |
| 生成物（判定表）を消す／`generate` を忘れる | `npm run generate:check` |

**落ちなかった項目は、そのテストが何も守っていないというサインである。**

## ⑧ 全検査

リポジトリルートから回す（検証器・生成器の検査はルートの取り次ぎ。`app` の検査は**サブシェルで**回す —— `cd app` のあとは cwd が `app/` に残るため）。

```bash
npm run verify && npm run generate && npm run generate:check \
   && npm run typecheck:spec-tools && npm run test:spec-tools && npm run lint:spec-tools
(cd app  && npm run typecheck && npm run lint && npm run test \
   && npm run test:integration && npm run build)
npm run test:unit   # ルートで（ユニット + カバレッジ。閾値の正はルートの vitest.config.mts）
```

- `verify` は **エラー0** が条件（警告は既存分が残っている）。verify が通らない状態でコミットしない。
- `npm run test:integration` は**多重起動できない**（実DBを共有し `db reset` から始まる）。別の統合テストが走っていたら待たずに失敗する。
- **カバレッジは `cd app && npm run test` では測られない**（`test` は `vitest run` のみ）。測るのは**リポジトリルートの `npm run test:unit`** で、閾値100%が掛かっているのは **`app/src/domain/**` / `app/src/operation/**` / `framework/runtime/src/**` の3スコープ**である（正はルートの `vitest.config.mts`。実行の根がルートなのは v8 が根の外を測らないため。ADR-0013）。落ちたら「テストの不足」ではなく**死にコード**か**依存方向の違反**を疑う。**数値そのものを目標にしない** — テスト十分性の正は仕様網羅（A6 / A7）である。
- 仕様YAMLと生成物は**同一コミット**に含める（`generate:check` が CI で乖離を検出する）。

## 積み残しの宣言（消し忘れは警告になる）

- 画面をまだ作らないなら製品の `docs/specs/frontend/screens/README.md` の `unexposed` に**理由つき**で宣言する（S10）。
- `action_spec` をまだ作らないなら製品の `actions/README.md` の `unhandled` に（A4）。
- `by: [system]` の走査をまだ作らないなら同 README の `unscanned` に（A10）。
- 作ったら**宣言を消す**。消し忘れは警告として出る。

判断の記録は製品の作業ログに残す（正典ではない）。正式化できるものだけ `docs/rules/` に昇格させる。
