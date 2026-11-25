---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0008, ARCH-SP-0002, ARCH-SP-BE-0001, ARCH-BE-0013]
decisions: [ADR-0004]
---

# Server Action 仕様（action_spec）の書き方

`docs/specs/backend/actions/{aggregate}/{event}.md` に置く `action_spec` の YAML スキーマと、テストとの対応（`@spec` / `@tc` アノテーション）を定義する。

## 目的

- Server Action の仕様を、**ドメイン仕様を再定義しない薄い宣言**に固定する。境界で受けるもの・返すもの・守るテストだけを書き、状態・権限・制約は `specs/domain` を参照する（PRIN-0007）。
- 仕様 ⇔ 実装 ⇔ テストの対応を ID で機械突合できる形にする（PRIN-0008）。

## 参照するもの

- **配置・命名**: [architecture/specification/backend](../../../../architecture/specification/backend/)（ARCH-SP-BE-0001）
- **ドメイン仕様の正**: [architecture/specification/common](../../../../architecture/specification/common/)（ARCH-SP-0002）、[domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md)
- **実装側の構造・エラー分類**: [ARCH-BE-0013](../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)、[server-actions.md](../../system/standards/conventions/server-actions.md)
- **テンプレート**: `docs/specs/backend/actions/template.action_spec.md`

## ルール・基準

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識 2 種のみ（§散文の規則）。
- `doc_type: action_spec` / `scope: backend` / `id` を必ず書く。`id` は `{aggregate}-{event}-action`（例: `loan-check_out-action`）。
- **1 ファイル 1 アクション**。ファイルパスはドメインイベント ID と対応させる（`loan.check_out` → `actions/loan/check_out.md`）。

### 散文の規則

手書き散文で書いてよいのは**標識 2 種・各 1〜3 行**のみ（2026-08-24 のユーザー裁定）: **否定の標識**（検討して捨てた自然な代替案。例:「item_id は input に含めない — クライアントに選ばせると別蔵書を混ぜる余地」）と**線引きの標識**（「ここではやらない」のスコープ宣言）。

- 事実の再記述（YAML の言い換え）は書かない — 再記述はドリフト源である。可読形が要るものは生成物が担う。
- 事実の可読形はファイル末尾の生成ブロック `action-body`（宣言・前提と帰結・input・テストケースの表）が担い、`npm run generate` が差し込む。手で編集しない。
- 系全体の意味論（定型の性質・OCC・監査ログなど、この操作固有でない話）は本文に書かず、[server-actions.md](../../system/standards/conventions/server-actions.md) 等の該当規約へのリンク 1 行に置き換える。
- 経緯・歴史は `NOTES.md` へ。消費者への契約は標識 1 行に圧縮して残す。
- YAML フロントマター内のコメントは**行ローカルの短注（1 行）**のみ。

根拠: 同じ情報が二箇所に住むと片方が黙って嘘になる（2026-08-24 の例解ドリフト実測）。

### スキーマ

```yaml
doc_type: action_spec
scope: backend
id: loan-check_out-action

handles: loan.check_out              # 必須。処理するドメインイベント ID（1 つだけ）

input:                             # 必須。受けるフィールドを {entity}.{field} で列挙（無い場合も [] を明示）
  - loan.id
  - loan.item_id
  - loan.due_at
  - loan.note

owner: loan.patron_id              # 任意。作成({entity}.create)だけ。作成者そのもので埋める持ち主の欄を明示する(§owner)

computes:                          # 任意。入力に無く、実行時に純関数が決める欄(§computes)
  - field: loan.late_fee_amount
    ref: lateFee            # app/src/domain/computes/{ref}.ts の主 export
    # reads / shape / examples は任意(例の表 = 入力 → 値の行。人が読む早見表になり、テストが生成される)

runner:                            # 任意。書けば「生成に乗らない操作」の宣言になる(§runner)
  kind: manual
  reason: 規約に乗らない引数（p_items）を持つ一括の RPC を呼ぶ

errors:                            # 必須。共通規約への参照 + 固有のものだけ追記
  inherits: common                 # ガード不成立 / 権限なし / 不変条件違反の 3 分類（ARCH-BE-0013）
  additional: []                   # 固有のエラーがある場合のみ（例: 外部連携の失敗）

test_cases:                        # 必須。1 つ以上
  - id: TC-LOAN-CHECK_OUT-001
    type: unit                     # unit | integration
    covers: [success]              # 必須。このケースが覆う意味クラス（値域、複数可）
    spec_ids: [loan.check_out]
    implementation: app/src/operation/__tests__/loan/check_out.test.ts::申し込んだ本人が貸出を受け取れる
  - id: TC-LOAN-CHECK_OUT-002
    type: integration
    covers: [invariant]
    spec_ids: [INV-LOAN-001]
    implementation: app/src/infrastructure/__tests__/loan/check_out.test.ts::二重貸出は拒否される
```

#### handles

- **すべきこと:** `{state_machine}.{event}` 形式で 1 つだけ宣言する。ID は `specs/domain` の `state_spec` に実在すること。
- **してはいけないこと:** 複数イベントの列挙。仕様に無い ID の宣言。

##### 予約 ID: `{entity}.create`（新規作成）

新規作成は状態機械のイベントではない（遷移元の状態が無い）。そのため `handles` には
**予約 ID `{entity}.create`** を書く。これは状態機械のイベント ID の名前空間を借りているだけであり、
`state_spec` の `events` に `create` を足してはならない。

```yaml
handles: loan.create              # 予約 ID。実在条件は loan の access_spec の creates
```

- **接地先は `access_spec` の `creates`**。「誰が作れるか」の正はドメイン仕様側にあり（[domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) §access_spec）、`action_spec` が書くのは「その作成操作を境界に公開する」という判断だけである。
- **すべきこと:** ファイルは `actions/{aggregate}/create.md`、実装は `app/src/app/_actions/{aggregate}/create.ts` に置く（A2 の規則は遷移と同じ）。
- **すべきこと:** `input` には作成時に受け取るフィールドを `{entity}.{field}` で列挙する。`{entity}.id`（`auto: true`）と `{entity}.state`（初期状態は `state_spec` の `initial`）と実行者（actor）は**書かない**。
- **してはいけないこと:** `create` 以外の名前で作成操作を表す（`add` / `new` / `register` 等）。予約 ID を 1 つに固定することで、A1 / A4 が「作成」を機械的に判別できる。
- **してはいけないこと:** 作成と最初の状態遷移（例: 作って即提出）を 1 つのアクションに混ぜる。1 アクション 1 操作は作成でも変わらない。

##### 予約 ID: `{entity}.delete`（物理削除）

削除も状態機械のイベントではない（遷移先の状態が無い）。`handles` には
**予約 ID `{entity}.delete`** を書く。`{entity}.create` と完全に対称の扱いをする。

```yaml
handles: loan.delete              # 予約 ID。実在条件は loan の access_spec の deletes
```

- **接地先は `access_spec` の `deletes`**。「誰が消せるか」の正はドメイン仕様側にあり（[domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) §access_spec）、`action_spec` が書くのは「その削除操作を境界に公開する」という判断だけである。
- **すべきこと:** ファイルは `actions/{entity}/delete.md`、実装は `app/src/app/_actions/{entity}/delete.ts` に置く（A2 の規則は遷移と同じ）。
- **すべきこと:** `input` には対象を特定する識別子（`{entity}.id`）だけを書く。削除に本体のフィールドは要らない。
- **してはいけないこと:** 論理削除（状態を `deleted` にする・`deleted_at` を立てる）を `{entity}.delete` で表す。それは状態遷移であり、`state_spec` の `events` に書く。
- **してはいけないこと:** `remove` / `destroy` / `cancel` 等の別名で削除操作を表す。

##### 予約 ID: `{entity}.update`（状態を変えない編集）

`access_spec` の `writes`（状態遷移によらないフィールド更新）を境界に公開するときは
**予約 ID `{entity}.update`** を書く。接地先は `writes` である。

```yaml
handles: hold.update       # 予約 ID。実在条件は hold の access_spec の writes
```

- **すべきこと:** `input` には対象の識別子と、更新するフィールドだけを書く。どのロールがそのフィールドを更新してよいかは `writes` が正であり、ここには書かない。
- **注: A4 の網羅対象ではない。** 編集は「どのフィールドを」まで含めて 1 操作の粒度が決まるため、`writes` の宣言 1 本が Server Action 1 本に対応するとは機械的に言えない。作成・削除と違い、「宣言したのに入口が無い」を検証器が要求することはしない。

#### input

- **すべきこと:** 受けるフィールドを `{entity}.{field}` の**完全修飾名のリスト**で書く。対象を特定する識別子（`loan.id` 等）も含める。
- **してはいけないこと:** 必須・最大長・型・書式などの制約を書く。制約の正は `entity_spec` であり、フォームと Server Action は生成 zod スキーマを共有する（PRIN-0007）。
- **してはいけないこと:** 実行者（actor）を `input` に書く。actor はサーバー側のセッションから導く。
- **すべきこと:** `{entity}.create` / `{entity}.update` の `input` に書いた欄は、生成する RPC の本文に届くようにしておく（data_table の `functions[]` の `params` に `p_{欄}` を置くか、作成なら `p_values`、編集なら `access_spec` の `writes` に載せる。対象の行の `{entity}.id` は `p_{集約}_id` が受ける）。**どの口にも当たらない欄は T6 が error にする**(他の集約の欄 `{他の集約}.{欄}` も同じ: 作成 / 編集の RPC が書くのは自集約の行だけなので届く口が無い。他の集約の行を動かすなら、その集約を書く別の操作にする) —— 本文は正しく組み立てられるので、検査が無いと呼び手が値を渡しても本文のどこにも現れず、静かに捨てられる。**遷移（`{machine}.{event}`）の `input` も同じ**で、遷移の RPC は袋（`p_values` / `p_changes`）を持たないので、値を運べるのは対象の行の `{entity}.id`（`p_{集約}_id`）と 1 欄ずつの引数（`p_{欄}`）だけである（欄を足すなら data_table の `functions[]` に `p_{欄}` を置く。機械の全イベントが 1 本の RPC を共用するので、見るのはそのイベントを呼ぶ操作の `input` だけ）。本文を手書き（`handwritten`）と宣言した関数と `composite` は、本文の側が正なので見ない。**手書きの遷移（`runner: manual`）の `input` は見ない**（専用の RPC を自分で呼ぶので、共用の遷移の RPC に照らすと偽の error になる。A15 の「`runner: manual` は計画を求めない」と同じ趣旨）。作成 / 編集は予約 ID で RPC が 1 本に決まるので、手書きの操作の `input` も見る。

#### errors

- **すべきこと:** `inherits: common` を必ず書く。3 分類（`guard_unsatisfied` / `forbidden` / `invariant_violated`）は全アクション共通の契約であり、アクションごとに再定義しない。
- **すべきこと:** 固有のエラーがある場合のみ `additional` に `kind` と `when`（発生条件を日本語で）を書く。
- **してはいけないこと:** 表示文言（ユーザー向けメッセージ）を書く。文言は UI の責務である。
- **してはいけないこと:** 3 分類のどれに当たるかをアクションごとに列挙し直す。どの拒否が起きうるかは `state_spec` の `from` / `guard` / `by` と `invariant_spec` から導ける。

#### test_cases

**`type: unit` のケースは、計画で走る操作では生成物である**（束 ⑰-3）。フロントマターの `test_cases:` の
直下に印を置き、その中だけを `npm run generate` が書く。

```yaml
test_cases:
  # AUTO-GENERATED:action-unit-tests
  # （ここに生成テストを指す `type: unit` のケースが並ぶ。手で書かない）
  # /AUTO-GENERATED:action-unit-tests

  # --- integration（実 DB に対して通す。ここから下は手書き） ---
  - id: TC-LOAN-CREATE-008
    type: integration
    covers: [success]
    spec_ids: [loan.create]
    implementation: app/src/composition/__tests__/loan/create.test.ts::…
```

印はフロントマターの中にあるので、本文の `<!-- AUTO-GENERATED:… -->` ではなく **YAML のコメント**で書く
（意味は同じ。`lib/generate/markers.ts` が両方の書き方を受ける）。生成されるのは A7 が仕様から導く
意味クラスの場面 1 つにつき 1 ケースで、名前は生成テストのテスト名そのものである。**印の中を手で
書き換えても次の `generate` で消える。**

手で書くのは、印の外にある次の 2 種だけである。
- `type: integration`（実 DB に対する確認。場面を仕様から作れない）
- `type: unit` のうち、**生成テストが覆わないもの** —— DSL の外に置いた純関数（`enforced_by: application` の
  判定・`computes`）、`runner: manual` の操作、`scans:` の経路

- **すべきこと:** 各ケースに `id`（`TC-{AGGREGATE}-{EVENT}-{NNN}`）、`type`、`covers`、`spec_ids`、`implementation` を書く。`covers` に `success` を持つケースには `by_role` も書く（下記）。生成ブロックの中の番号は **900 番台**を使う（手書きの連番と帯を分ける。A9 の一意性を保つため）。
- **すべきこと:** `spec_ids` には、そのケースが守っている仕様の ID を書く。書けるのは次の値域であり、実在が検査される（A8）。存在しない ID を書いたテストは、何も守っていないのに**守っているように読める**。
  - ドメインイベント ID（例: `loan.check_out`。予約 ID `{entity}.create` / `{entity}.delete` / `{entity}.update` を含む）
  - `access_spec` の `id`（例: `loan-access`）— 権限・可視性そのものを守るテスト
  - 不変条件 ID（例: `INV-LOAN-001`）
- **すべきこと:** `implementation` は `{リポジトリルートからのテストファイルパス}::{テスト名}` とする。置き場は [testing/unit.md](../../system/standards/conventions/testing/unit.md) §配置・命名（`type: unit` → `app/src/operation/__tests__/{entity}/{event}.test.ts`）と [testing/integration.md](../../system/standards/conventions/testing/integration.md) §配置・命名（`type: integration` の通しは **Composition Root を入口にする** `app/src/composition/__tests__/{entity}/{event}.test.ts`、RLS は `app/src/infrastructure/__tests__/{entity}/rls.test.ts`）が正である。**`app/src/app/__tests__/` は存在しない** — Server Action は cookie から actor を解決するためリクエスト文脈なしには呼べず、通しの入口は composition になる。
- **すべきこと:** テストコード側には対応する `// @tc {id}` を書く。突合器は**双方向**に検査する（仕様側に対応テストが無い = uncovered、テスト側に仕様の記載が無い = orphan）。`@spec` には仕様 ID を空白区切りで複数書ける（`@spec A B @tc X`）。同じ行に `@spec` を繰り返した形（`@spec A @spec B @tc X`）も、出現順に全部読む（生成されるテストの書式がこの形を書くので、最初の 1 つだけを読むと 2 つ目以降が突合の母集合から落ちる）。
- **すべきこと（全数ループのとき）:** 同じ形の突合を**期待表のキー全部**に掛けるテストは、`it` を 1 本ずつ手で並べず**ループ 1 つ**にし、その直前に `// @tc-each {ひな形}` を書く。ひな形は直後のループが付ける `it` の名前そのもの（穴は `{…}`）であり、台帳（`test_cases[].implementation` のテスト名）がそのひな形に当てはまる ID は「このループが実行している」と読まれる（`legacy/spec-tools/lib/trace/expand-each.ts` が注釈 1 件ずつに展開し、以降の突合は `@tc` と同じ 3 段で行われる）。**`implementation` の書き方は変わらない**（ファイルパスもテスト名もそのまま）。ひな形とループの `it` の名前が食い違えば A12 が error にする。

  ```ts
  // @tc-each {table} の列と制約が宣言どおりである
  for (const table of SPEC_TABLES) {
    it(`${table} の列と制約が宣言どおりである`, () => expectDdlParity(table));
  }
  ```

  **なぜ要るのか。** 表ごとの `it` を手で並べると、そのテストファイルは**アプリの表名の一覧**になる。仕組みの側の突合（`*-parity.test.ts`）がそうなると、別題材を空の DB に構築して回す通し実行（`npm run samples:db`）はそのファイルを 1 本も実行できず、**仕組みの突合が題材では 1 度も回らない**（2026-09-23 の実測: 13 本中 5 本がこの形で実行できなかった）。ループにすれば表名が消え、覆い漏れも原理的に起きない（母集合が期待表そのものだから）。
- **すべきこと:** `id` の番号は**追記専用**にする。残るケースは番号を変えず、廃止したケースの番号は**欠番のまま残す**（新しいケースには常に最大値の次を振る）。番号は仕様・テスト・レビュー記録・issue をつなぐ識別子であり、詰め直すと過去の記録が別のケースを指す。
- **すべきこと:** `id` は**全仕様（`query_spec` など他の仕様種を含む）を通じて一意**にする。テストケース ID は仕様種ごとの持ち物ではなく、**1 つの台帳**（検証器が全仕様の `test_cases` を集めたもの）に載る識別子である。一意性は A9 が台帳を見て検査するため、`action_spec` どうし・`query_spec` どうしだけでなく**仕様種をまたいだ重複**も検出される。追記専用の規約はこの台帳の上で効く — **欠番は台帳に残る空席**であり、後から別のケースが座ってはいけない。
- **してはいけないこと:** テストの手順・アサーションの内容を仕様に書く。仕様が持つのは「何を守るか」であり「どう確かめるか」ではない。

#### owner（作成者で埋める持ち主の欄）

`owner: {集約}.{欄}` は「**この作成は、この欄を作成者（実行者）そのもので埋める**」の明示の宣言である。作成で実行者が入る欄は、これ・ユースケースの手順の `defaults.self`・遷移の `records_actor` だけで、**宣言の無い実行者への参照の欄を作成者で埋める推測は無い**（宣言の無い欄は `input`・`computes` のどれでもなければ実行計画が「値が仕様のどこにも無い」で止める —— A15 / Y8）。

```yaml
handles: loan.create
owner: loan.patron_id              # 持ち主は貸出を作った人(作成者)そのもの
input:
  - loan.item_id
  - loan.note
```

- **すべきこと:** 作成者自身がその行の持ち主（所有者・発行者・起案者）になる欄を 1 本だけ書く。宣言した欄は作成の RPC が規則の `by` の段で実行者に縛り（違えば UC403）、再送の作成者の欄（data_table の `resend.creator`）の候補になる。
- **すべきこと:** その欄が役の `binding` の根拠なら、作成の規則（`access_spec` の `creates[]`）に欄 × 役を名指した `self_assign` を書く（R2 は `owner` の欄を作成の書き手として数える。作成者がその役を自分の行に持つことを、規則の場所で毎回名指しで受け入れる）。
- **してはいけないこと:** 人が選ぶ欄（代理で作る相手・査閲者・担当者・承認者）を `owner` にする。それは `input` に置く（代理で他人を入れるなら `creates[]` の規則の `delegate` にその欄を名指す）。
- **なぜ明示か:** 以前は「必須で入力に無い実行者への参照は作成者」を推測で当てていた。2 本目（査閲者）を `input` に書き忘れると黙って作成者で埋まり（点検 8 回目 A8-1）、候補を 1 本に絞る柵を足すと、起案者を `input` に出した代理作成で残った査閲者が「ただ 1 本の候補」になった（9 回目 A9-1）。推測は数える母集合を変えるたびに漏れるので、仕組みごと無くした。
- **接地（V18 の下位検査）:** 作成の action_spec にだけ書ける・作る集約の欄を指す・entity_spec に実在し `ref(実行者の集約)` 型で**必須**（任意の欄は作成 RPC の縛りの外に落ちる）・同じ操作の `input` にも `computes` にも無い。

#### computes（実行時に純関数が決める値）

`computes` は「**入力に無いが、この操作の実行時に純関数が決める値**」を宣言するキーである。宣言の場所が無かったあいだ、その計算（延滞料の確定額・確定後に追加された巻の負担額）は **TS の operation が計算して RPC に渡す**形で実装の中にだけ住んでおり、仕様からは「その列に何が入るか」が読めなかった。仕様から操作を実行するには根拠が要るので、そこを宣言の側に出したのがこのキーである（ADR-0012 ④ / 束 ⑰）。

```yaml
computes:
  - field: loan.late_fee_amount   # {entity}.{field}
    ref: lateFee          # 純関数名（app/src/domain/computes/{ref}.ts の主 export）
    reads:                         # その純関数が読む事実（任意。{entity}.{field} の並び）
      - loan.kind
      - item.daily_fee
```

- **すべきこと:** 欄を `{entity}.{field}` で書き、値を決める純関数の名前を `ref` に書く。関数の入力は「読んだ事実」と「入力」だけで、DB も時刻も外界も見ない（見るなら純関数ではない）。
- **すべきこと: その純関数が読む行の欄を `reads` に並べる。** 純関数に渡るのは**その操作の実行計画が読んだ事実**（`reads`）と入力だけである。計画が読む欄は、この宣言が無ければ**ガード式・ロールの `binding`・予測状態・結果の id** が要求したものだけであり、計算の材料は 1 欄も積まれない。自分の集約の欄も別の集約の欄も書ける。宣言した欄は **`plan-facts.ts` が計画の `reads` に積む**ので、生成された `operation-plans.ts` にそのまま現れる。
  - **配線は生成物である。** `computes` を宣言した操作の Composition Root は `@/domain/computes/{ref}` を import して実行器に渡す（生成テストも同じ関数を実行する）。純関数の置き場が domain なのは、それが「読んだ事実と入力だけから値を出す」= domain の仕事そのものだからである（ARCH-BE-0001）。
  - **RPC が受け取る口が要る。** 計算値は変更集合（`p_changes`）には載らない —— 値を決めるのは人の入力ではないからである。定型 RPC に `p_{欄}` の引数を宣言すると、計画が純関数の値をその引数で渡し、RPC がその列に書く（遷移 RPC が `p_{列}` を書くのと同じ構え。列ごとのロールの門は付かず、門は書き込み 1 文の全体に掛かる）。純関数が `null` を返した呼び出しではその列に**触れない**。**計算値の列は `writes` に並ばないので、変更集合の書ける列の母集合にも、ロールの門にも入らない**（V18。下の「してはいけないこと」）。
- **してはいけないこと:** その純関数が**読まない**欄を `reads` に並べる。`reads` は「この計算が何を見て決まるか」の宣言であり、読む欄の一覧でないなら読む人を誤らせる（A19 は到達しか見ないので、この嘘は機械では捕まらない）。**材料が増えたら `reads` に足し、使わなくなったら外す。**
- **してはいけないこと:** 読めない集約の欄を `reads` に書く。「読める」は「入力がその集約の id を指している」か「対象の集約（または入力が id を指す集約）の entity_spec の `context` から 2 段までで辿れる」ことであり、**A19 がエラーにする**。**行の集合を材料にする計算（子の明細の総和など）はこの形では宣言できない** —— 計画の読み取りは 1 集約 1 行だからである。宣言すると、**構造で子の集合と言える**ときに限り、error ではなく理由つきの warning（拡張候補 X-child-set-reads）になる —— 子が対象を `context` / `ref` で参照し、対象の側に子への `ref` の欄も `context` のキーも無く、子の親への参照が一意でない（1:1 でない。一意の不変条件・一意索引のほか、子の主キー `id` そのものが親を指す形も 1:1）とき。対象の側に子への道があれば `context` を足して 1 行に絞れ、1:1 は 1 行なので、どちらも error のままである。材料は計画に積まれないので、純関数には渡らない（入力から計算するか `runner: manual` にする）（`fixture` `expenses` の `claim.total_amount` がその実例。設計の経緯は非公開の開発記録）。
- **してはいけないこと:** `supplied_by: db` にできるものを `computes` に書く。**値の決定を DB へ移せるならそちらが先**である（V17 が機構の宣言を要求し、渡す口を閉じる）。`computes` に残るのは、集計とポリシーの組み合わせで SQL 化の判断が済んでいない計算だけである。
- **してはいけないこと:** 同じ欄を `input` にも `computes` にも書く（「人が入れる」と「実行時に決まる」を同時に宣言できない）。
- **してはいけないこと: 計算で決まる欄を `access_spec` の `writes` にも並べる**（ロールを問わない）。**計算で決まる値は入力として受け付けない**（2026-10-20 の裁定）—— 書くのは `computes` を宣言した操作の RPC（または計画）だけで、書いてよい根拠は `computes` の宣言そのものである。人の行に並べれば人が計算値を直に書け、`by: system` の行に並べれば内部実行が編集の RPC の変更集合で計算値を直に書ける（以前はこの行を「遷移・別の集約の計算値の許し」として求めていたが、その行が確定額を誰の指示でも書き換えられる経路を作っていた）。人が直す値なら `computes` から外して `input` に置く。
- **書いてよいこと: `field` に別の集約の欄を書く。** 1 つの業務イベントで複数の集約が同時に動く形（延滞料の確定が蔵書・貸出・同伴の利用者の 3 集約に確定額を書く、など）はこれで宣言する。相手の集約の `access_spec` には何も書かない —— その集約の `writes` に並べれば V18 が落とす（照合は `{entity}` で名指しした集約で行い、裸の欄名では照合しないので、別の集約の同名の欄には引きずられない）。
  - 相手の集約から見れば「人の操作としては現れない列」であり、どの遷移が書くかは `computes` の宣言から導かれる（実行計画の「遷移が自分で決めない列は空を渡す」・ウォーカーのオラクル・R2 の書き手の列挙がこれを読む）。

検証は **V18**（`npm run verify`）が見る: 欄が entity_spec に実在し・その操作の `input` に無く・`supplied_by: db` でなく・**名指しした集約のどの `writes` の規則にも並ばない**こと。**材料の側は A19 が見る**: `reads` の欄が実在し（error）、その操作の実行計画の `reads` に載ること（error）。加えて **`reads` を 1 本も宣言していない計算は warning** で報告する —— 入力だけから決まる計算ならそのままでよいが、「宣言が無い」ことが出力に残る（材料の届かない `computes` が黙って通っていた穴を塞ぐための警告である）。「材料が足りている」ことまでは機械には言えない。

**遷移が実行者そのものを書き留める欄に `computes` は要らない。** 「対応開始が対応者を書く」のような値は state_spec の `records_actor` が宣言し、実行計画が実行者を渡す（[domain-spec-writing.md §state_spec](../../../common/specification/standards/domain-spec-writing.md)。V19）。`computes` が受けるのは**実行者では決まらない値**（集計とポリシーの組み合わせ）だけである。

##### 例の表（`examples`。「この入力ならこの値」のデータ）

計算の式は純関数の中にあり、仕様からは読めない。**式を YAML に書く語彙は買わない**（式の語彙は 2 実例ルールに届いておらず、[domain-spec-writing.md「DSL の外に置くもの」](../../../common/specification/standards/domain-spec-writing.md)の線を動かさない）。代わりに、`computes` に**入力 → 値の例の表**（データであって式ではない）を宣言できる。例は人が読む早見表になり、生成されるユニットテストが純関数の実際の値と突き合わせる —— **一致しなければ、式か例のどちらかが間違っている**（どちらが正しいかは仕様の規則に照らして人が決める）。

```yaml
computes:
  - field: loan_companion.fee_amount
    ref: adjustedParticipantFee
    reads: [loan_companion.fee_amount, item.daily_fee]
    examples:                          # 任意。行の並びがそのまま早見表の行になる
      - note: 延滞料あり・直しで増える   # 行の名前（短い言葉。1 つの computes の中で一意）
        given:
          facts:                       # 純関数が読む事実（reads に並べたものだけ）
            loan_companion.fee_amount: 1500
            item.daily_fee: 500
          input:                       # 操作の入力（input に並ぶ欄だけ）
            fee_charged: true
        expect: 2000                   # その欄の型の値。null は「列に触れない（決まらない）」
  - field: item.surplus_amount
    ref: calculateTotals
    shape: input                       # 引数が (input) だけの関数。given は input だけで、expect は戻り値の写し
    examples:
      - note: 黒字
        given:
          input: { income: 5000, cost: 3000 }
        expect: { surplus: 2000 }      # 入れ子の戻り値は、書いた鍵だけ照合する
```

- **すべきこと: 代表的な入力だけを並べる。** 全部の組み合わせを並べる表ではない（1 つの操作に置けるのは 99 行まで）。「どの入力でも下がらない」のような性質は手書きの性質テストが受け持ち、例の表は**人が読んで業務の規則と照らせる代表の行**を受け持つ（観点が別なので、既存の手書きテストは消さない）。
- **すべきこと: 値は純関数を実行して写さない。** 仕様の規則（不変条件の言明・`docs/knowledge` の判断原理）から**人が導いた値**を置く。実行結果を写すと、式が間違っていても例が一緒に間違って、突き合わせが何も縛らない。
- **すべきこと: `shape` で呼び口の形を宣言する。** 既定は `facts_input`（`(facts, input) => 値`。`facts` は計画が読んだ事実、`input` は操作の入力）。引数が `(input)` だけの関数は `shape: input` と宣言する。**関数の署名から生成器は推測しない**（署名を変えた瞬間に生成物の意味が黙って変わるため）。値域は閉じている。
- **すべきこと: 同じ `ref` の欄が複数あるときは、例を 1 つの欄にだけ書く。** 1 本の関数が表を返して欄ごとにその一部を書く形（延滞料の確定など）では、どの欄に書いても同じ関数の例であり、重ねると同じ行を何度も数える（V18 が止める）。
- **すべきこと: 例を足す操作の仕様の `test_cases` に、生成ブロックの印を 1 組置く。**
  ```yaml
  test_cases:
    # AUTO-GENERATED:action-compute-examples
    # /AUTO-GENERATED:action-compute-examples
  ```
  中身は `npm run generate` が書く（テストケース ID は `TC-{集約}-{イベント}-8NN`。実行計画の場面の 9NN・手書きの 0NN と帯が違う）。印が無ければ書かれず、生成テストの注釈だけが仕様に載らない行として A6 が名指す。
- **してはいけないこと: `expect` や `facts` に式を書く。** 書けるのは値（数値・真偽・文字列・null・配列・マッピング）だけである。式が書きたくなったら、それは例を増やす合図ではなく、[dsl-extension-triage.md](../../../common/specification/playbooks/dsl-extension-triage.md) の入口である。
- **してはいけないこと: `note` に `:` と `#` を含める・先頭に記号を置く。** `note` はテストの名前として `test_cases` の YAML の平文に載る。
- **純関数の置き場は `app/src/domain/computes/{ref}.ts` である**（生成テストはそこから import する）。`runner: manual` の操作の関数が別の場所（`domain/fees/` など）に住んでいるときは、`computes/{ref}.ts` に主 export を 1 行で再輸出する（関数の本体は動かさない）。

**生成物は 2 つある。** ① ユニットテスト `app/src/operation/__tests__/generated/computes/{ref}.examples.test.ts`（純関数 1 本につき 1 ファイル・行ごとに `it` 1 本。置き場ぜんたいが生成物で、どの仕様からも出ないファイルは `generate:check` が余分として落とす）。② ハンドブックの章の上段の**計算の早見表**（`facts_input` は 事実・入力・値の列、`input` は 行の名前 / 入力 / 値）。早見表の行は**必読に数える公理**である（式は人が読む側 = 例の表が人の判定の対象になる。宣言そのもの = 欄 → 純関数の表は従来どおり導出）。

検証は V18 の下位検査である（新しい規則 ID は増やさない）: `facts` の鍵が `reads` の中・`input` の鍵が操作の `input` の欄・値が欄の型・`expect` が `field` の型・同じ `given` と同じ `note` の重複なし・`shape: input` は `facts` を持たない・`shape: input` の `expect` は葉まで 1 値以上（`{}` や空の入れ子は部分一致で何でも通るので落とす）・同じ `ref` の例は 1 か所・`note` の字・99 行の上限。

#### runner（生成に乗らない操作の宣言）

`runner` は「**この操作は仕様から導出した実行計画では走らない**」という宣言された例外である。書かなければ操作は生成された計画（`app/src/domain/generated/operation-plans.ts`）で走り、手書きの余地が無い。

```yaml
runner:
  kind: manual
  reason: 並べ替えは対象の集合を 1 度に受ける一括の RPC（reorder_holds）なので定型に乗らない
```

- **すべきこと:** `kind: manual` と `reason`（なぜ生成に乗らないか。日本語 1 文）を**両方**書く。片方だけは書けない（パーサーが落とす）。
- **すべきこと:** 理由は「どの規約から外れているか」を名指しする。実物は 3 種類である ——(1)規約に載らない引数名を持つ RPC を呼ぶ（一括の並べ替え・写しの作成）(2)同一トランザクションで別の表を書く副作用（ジョブカタログで `kind` が「同一トランザクションで実現済み」の行）を持つ (3)外部連携を挟む。
- **してはいけないこと:** 理由を書かずに免除する。**免除リストは作らない** —— 理由の無い例外は「まだ仕様化していない穴」と区別が付かない。
- **してはいけないこと:** 計画が導出できる操作に `runner` を書く（手書きを残す口になる）。

計画が導出できないのに `runner` が無い操作は **A15** が**エラーにする**（`npm run verify`）。**逆も同じくエラーである** —— 計画が導出できてしまう操作に `runner` を書くことはできない（束 ⑰-3。宣言を機械が裏づけないと、`runner` は理由文つきの免除リストになる）。A15 が逆向きの指摘から外すのは、「計画だけでは足りない」ことを仕様側の宣言から機械が読み取れる 2 つの場合だけである。

| 印 | 意味 |
|---|---|
| 自集約の外を参照する `application` 執行の不変条件 | hooks の型は `(input) => boolean` であり、別の集約の行を数える判定は入力から書けない（保存点では入力にその行があるので問題にならない） |
| `errors.additional` が**実行器の返す結末の値域の外**の失敗を契約にしている | 実行器が返すのは `invalid_input` / `forbidden` / `guard_unsatisfied` / `invariant_violated` / `conflict` / `not_found` の 6 つだけである。それ以外の失敗を契約にしている操作は定型の外で何かを実行している（外部連携がその代表） |

**2 つ目の印は「値域の外」であることまで見る**（束 ⑰-3b）。それまでは「`additional` が空でない」だけを見ていたので、**実行器が既に返す名前を 1 行書き足すだけで A15 の逆向きを黙らせられた** —— 塞いだはずの穴が別の宣言で開いたままだった。残る限界は「新しい名前を発明すれば依然として黙らせられる」ことで、根まで閉じるには外部連携カタログから操作への線（DSL の拡張）が要る。実例は 1 件しかなく 2 実例ルール未達のため買っていない。

宣言した操作の一覧と理由はハンドブックの「誰が何を実行できるか（操作）」§生成に乗らない操作に出る（生成物。表を手で持たない）。

- **すべきこと:** `runner: manual` を宣言した操作は、Server Action・Composition Root・operation を手で書く（生成物が立たないので置き換わらない）。置き場と主 export の規約は生成物と同じであり、構造の閉世界（`app/src/operation/__tests__/structure/`）が実在と名前を見る。

#### retired（欠番の宣言）

廃止したテストケースの番号を「◯◯は欠番」という**散文コメント**でしか残さないと、その番号が後から別のケースに再利用されても機械には見えない（A9 が見るのは「今 2 箇所で使われていないか」だけで、過去に廃止した番号を後から別のケースが使うことは台帳に載らない事実を照合できなかった）。`retired:` はその欠番を仕様の一級市民にする。

```yaml
retired:
  - TC-HOLD-UPDATE-016  # 1 蔵書に閉じたため「1 件だけ編集できない」状況が作れない
```

- **すべきこと:** 廃止したケースの `id` を `retired:` に列挙する（無ければ書かない、または `retired: []` と明示する）。行ローカルの短注（1 行）でなぜ廃止したかを添えてよい。
- **すべきこと:** `id` は他の場所と同じ `TC-{AGGREGATE}-{EVENT}-{NNN}` 形式にする。
- **してはいけないこと:** `retired:` に載せた ID を、この仕様(または他の仕様)の `test_cases` に再び使う。**再利用は A9 がエラーにする** — 台帳は `retired:` の宣言と `test_cases[].id` を同じ索引で引き当て、両方に現れた ID を「欠番の再利用」として報告する（母集合は台帳なので仕様種をまたいだ再利用も検出する）。
- **してはいけないこと:** まだ使っている ID を `retired:` に書く。廃止するときだけ足す。

#### 方針の導出（`confirm_required` / `variant`）と `ux`（上書き）

操作の**事実 9 属性**（`irreversible` / `terminal` / `destructive` / `affects_others` / `outbound` /
`bulk` / `scheduled` / `privileged` / `touches_personal`）は `action_spec` を書かない —
すべて `state_spec` / `access_spec` / データ仕様から機械的に導出される（生成物
`app/src/domain/generated/action-attributes.ts` に属性と根拠が載る）。属性から方針を導く式も
閉じている:

```
confirm_required = (tone: negative への遷移) ∨ destructive ∨ (irreversible ∧ affects_others) ∨ settles
variant           = confirm_required なら danger、それ以外は default
```

`tone` / `settles` は `state_spec` の状態が持つ宣言（[domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) §state_spec）。
`ActionButton` はこの生成物から `confirm_required` / `variant` を引き、呼び側は**渡せない**
（`src/app/**` に `variant=` / `confirm=` の手書きが無いことを lint が見る）。

導出が現実と食い違う場合だけ `ux:` で上書きする——**理由が必須**（V14。無ければエラー）。

```yaml
ux:
  confirm: none        # none | required
  reason: screen_spec に対応する overlay が無く、今回は画面変更をスコープ外にした
```

- **すべきこと:** `ux:` は「導出を信じない」宣言なので、`reason` に**なぜ**を日本語 1 文で書く。
- **してはいけないこと:** `reason` を書かずに `confirm:` だけ書く。`npm run verify` の V14 が落ちる。
- **してはいけないこと:** 導出結果と一致する `ux:` を書く（無駄な上書き。書かなければ導出がそのまま効く）。
- 上書きの件数は `npm run verify` の A 群の実行状況の 1 行に「理由つき受け入れ N 件」として出る——増減を見れば「導出を信じていない箇所」がどれだけあるかが分かる。

#### covers（意味クラス）

`covers` は「そのテストが**何を確かめているか**」を有限個の分類で宣言するフィールドである。`spec_ids`（どの仕様を守るか）とは別の軸で、**書き漏らしを機械が数えられるようにする**ためにある。A7 はこの宣言の和集合を見て、ドメイン仕様が要求しているのに存在しないケースを検出する。

- **すべきこと:** 次の値域から 1 つ以上を選ぶ。1 つのケースが複数のクラスを覆ってよい。

| 意味クラス | そのケースが確かめること |
|-----------|------------------------|
| `success` | 許可された条件がすべて揃った実行が成功すること |
| `guard_unsatisfied` | ガード条件（`guard` / `when`）が成立しない状況で拒否されること |
| `invalid_from` | 遷移元（`from`）に含まれない状態から実行して拒否されること |
| `forbidden` | 許可されていないロールが実行して拒否されること |
| `invariant` | 不変条件に反する実行が拒否されること |
| `conflict` | 可否を判断したあとに対象が変化していた実行が競合として拒否されること |
| `not_found` | 対象が存在しない場合の振る舞い |
| `other` | 上のどれにも当たらない補助的な確認（RLS の確認、副作用が積まれないことの確認など） |

- **すべきこと:** どのクラスか迷ったら、**そのテストが置かれている状況**（何を崩して実行したか）で選ぶ。返るエラー種別ではない。例: 「対象が見つからないときは存在を漏らさず `forbidden` を返す」は、状況が「対象が無い」なので `not_found` である。
- **してはいけないこと:** 値域の外の語を書く（検証エラーになる）。分類を増やしたくなったらこの表を先に直す。
- **してはいけないこと:** 迷ったものを機械的に `other` にする。`other` は「必要クラスのどれでもない」と判断できたケースのためにあり、A7 の網羅判定には一切寄与しない。
- **してはいけないこと:** `covers` を省く。**未記入はエラーである**（A0）。宣言の無いケースは A7 の判定に一切寄与しないため、書き漏らしを許すと「必要な意味クラスを満たしている」という A7 の結論が、書き漏らしのぶんだけ静かに甘くなる（導入当初は移行期の警告だったが、全仕様の記入が済んだ時点でエラーに昇格した）。

#### by_role（成功したロール）

`by_role` は「そのケースが**どのロールとして**実行して成功したか」を宣言するフィールドである。**宣言に並ぶロールが実装で解決されているか**を見る唯一の口であり、A7 が「`by` / `creates` / `writes` / `deletes` に並ぶ人間ロールごとに `success` のケースがあること」を要求する。

これが無かった間、**宣言にロールを足しただけで実装が追随していない**状態が緑のまま通っていた（実穴: `staff` を 14 操作の宣言に並べたのに operation が 1 つも解決しておらず、「仕様上できることが実装では必ず forbidden」になっていた）。A 群も S 群も「宣言 → 実装の実在」は見るが、**実装が宣言のロールを解決しているか**は誰も見ていなかった。

- **すべきこと:** `covers` に `success` を持つケースに、そのケースの実行者のロール ID を書く。
- **すべきこと:** 宣言に並ぶ人間ロールの**すべて**について、`by_role` 付きの `success` のケースを 1 つ以上用意する。代理の口（`staff` が `librarian` の操作を代理する形）も 1 ケースずつ要る。
- **してはいけないこと:** 拒否のケース（`forbidden` など）に `by_role` を書いて義務を満たしたつもりになる。数えるのは `success` を覆うケースだけである。
- **してはいけないこと:** 宣言に無いロールを指定する（綴り違い・宣言から消したのにテストだけ残っている場合はエラーになる）。
- **`system` は義務にしない。** 内部実行（Webhook / Cron）の経路には Server Action の入口が無く、「誰が起こすのか」は A10（走査実装の宣言）が別に見ている。ここで要求すると、宣言上 `system` が書ける列について**実在しない経路**のテストを求めることになる。

### 薄さの基準

`action_spec` は**薄いことが正しい**。次のいずれかを書きたくなったら、書く場所が違う。

| 書きたくなったもの | 正しい置き場所 |
|-------------------|--------------|
| どの状態から実行できるか / 誰が実行できるか | `specs/domain/{aggregate}/states.md`（`from` / `by`） |
| 実行の前提条件（締切前であること等） | `specs/domain/{aggregate}/states.md`（`guard`） |
| 保存後に守られるべき条件 | `specs/domain/{aggregate}/invariants.md` |
| フィールドの必須・長さ・範囲 | `specs/domain/{aggregate}/entity.md` |
| 成功後に送る通知 | `specs/domain/{aggregate}/states.md`（`effects`）と `specs/backend/external/` |
| 誰が新規作成できるか / 作成の前提条件 | `specs/domain/{aggregate}/access.md`（`creates`） |
| 誰が削除できるか / 削除の前提条件 | `specs/domain/{aggregate}/access.md`（`deletes`） |
| 誰がどのフィールドを編集できるか | `specs/domain/{aggregate}/access.md`（`writes`） |
| 実装の書き方・戻り値の型 | [server-actions.md](../../system/standards/conventions/server-actions.md) |

### 検証（突合の対象）

`action_spec` に対して機械検証するもの。

| # | チェック | 内容 |
|---|---------|------|
| A1 | `handles` の実在 | 宣言されたドメインイベント ID が `state_spec` に存在する。予約 ID `{entity}.create` / `{entity}.delete` / `{entity}.update` は、対象エンティティの `access_spec` に `creates` / `deletes` / `writes` が宣言されていることを実在条件とする |
| A2 | パスとの一致 | ファイルパス `actions/{aggregate}/{event}.md` が `handles` と一致する。続きとして、操作・保存点・フォームの実装の置き場が別の仕様の置き場と同じパスを取らない(例: 集約名が `inbound` のイベントと受信の連携 ID が同じ配線を取る) |
| A3 | `input` の実在 | `{entity}.{field}` が `entity_spec` に存在する |
| A4 | ハンドラの網羅 | 人間ロールが実行できる全イベントに `action_spec` が 1 つ以上ある（無い場合は理由の明示を必須とする）。人間ロールの `creates` / `deletes` を宣言したエンティティには `{entity}.create` / `{entity}.delete` の `action_spec` を同じ条件で要求する（`writes` は対象外） |
| A5 | 重複の禁止 | 同じイベントを `handles` する `action_spec` が 2 つ以上ない |
| A6 | テスト突合 | `test_cases[].implementation` が実在し、テスト側の `@tc` と双方向に一致する（仕様側に対応テストが無い = uncovered、テスト側にどの仕様の記載も無い = orphan、同じ `@tc` が複数のテストに付いている = 突合キーの破れ）。orphan の母集合は A9 と同じ台帳であり、`query_spec` が宣言したテストは orphan にならない |
| A7 | 意味的カバレッジ | ドメイン仕様から導かれる**必要な意味クラス**が `test_cases[].covers` の和集合に含まれ、宣言に並ぶ**人間ロールごとに** `by_role` 付きの `success` のケースがある |
| A8 | `spec_ids` の実在 | `test_cases[].spec_ids` が実在する仕様 ID を指す。書けるのは値域（ドメインイベント ID（予約 ID `{entity}.create` 等を含む）/ `access_spec` の `id` / 不変条件 ID）であり、読み取り側の Q6 と同じ規則である |
| A9 | テストケース ID の台帳 | `test_cases[].id` が**全仕様を通じて一意**である。母集合は仕様種ごとではなく、全仕様の `test_cases` を集めた 1 つの台帳であり、`action_spec` × `query_spec` のような**仕様種をまたいだ重複**もここで検出する。反例には重複した全宣言箇所が並ぶ。**加えて、`retired:` に列挙した欠番 ID が `test_cases[].id` として再利用されていないか**も同じ台帳で見る（§retired） |
| A10 | 走査の網羅 | `by` に `system` を含む全イベントに、走査実装の宣言（`scans`）か理由つきの免除（`unscanned`）がある。宣言した実装ファイルが実在することも見る（A4 の裏返し。下の節）。`scans[].test_cases` を書いた場合は、A6 と同じ 3 段（実装ファイルの実在 → `@tc` の存在 → テスト名の一致）でテストとの突合も行う |
| A11 | 操作の閉世界 | **逆向き**（実装 → 仕様）。`app/src/operation/{aggregate}/{event}.ts` の実装ファイルは、すべて `state_spec` のイベントか `access_spec` の予約 ID（`creates` / `deletes` / `writes`）に対応する。対応の無い実装（例: `operation/loan/teleport.ts`）はエラー（下の節）。**加えて、`unhandled:` で「まだ作らない」と宣言した操作の operation 実装がすでに置かれていたら**エラーにする（宣言と実態の食い違い） |
| A12 | 注釈の台帳 | **逆向き**（実装 → 仕様）。`@tc` の注釈を 1 つも持たないテストファイルは、既知の未処理台帳（`specs/backend/actions/README.md` の `test_tag_baseline`）に載っているものに限る（ラチェット。下の節）。**`@spec` はあるが `@tc` が無い行（片方だけの注釈）は台帳の有無に関係なく常にエラー** — 注釈の名前空間は `@tc` 一本であり、`@spec` だけの行は突合キーを持たないため、どの検査の母集合にも現れず静かに見落とされる。**注釈の位置（`it` / `test` の宣言の直前の行）も常にエラーで執行する** — ずれた注釈は A16 の視界から外れる（下の節）。**`@tc-each` のひな形が直後のループの `it` の名前と食い違う場合もエラー** — ひな形だけを書き換えると台帳のテスト名が当たらなくなり、突合が静かに空になる |
| A14 | ガード環境の突合 | **逆向き**（実装 → 仕様）。`app/src/operation/{aggregate}/{event}.ts` の手書き `guardEnv` が返す**鍵の集合**が、その操作のガード式（`state_spec` の `guard` / `access_spec` の `when` の全規則）に現れる変数の集合と一致する。足りない鍵はガードを常に評価不能（= 拒否）にし、余分な鍵は仕様のどのガードも見ない事実を読んでいる印である（下の節。ADR-0012 の当座の手当て） |
| A15 | 操作の実行計画 | 単発の操作 1 本ごとに「仕様だけから実行できるか」を見る（呼ぶ定型 RPC の引数が §引数名 → 供給元 の規約で決まり、`permit` が要る事実の供給元が決まり、副作用が定型 RPC で実現できること）。決まらない操作はそこに**仕様に無い知識が実装にある**印であり、`operation-plans.ts` に載らない。**error であり、両方向を見る**（束 ⑰-3）—— 「`runner` の無い操作は必ず計画が導出できる」と「**計画が導出できる操作は `runner` を書けない**」。後者から外れるのは、機械が「計画だけでは足りない」と言える印を持つ操作だけである（自集約の外を参照する `application` 執行の不変条件 / `errors.additional`） |
| A16 | 注釈の中身 | **逆向き**（実装 → 仕様）。`@tc` の注釈を持つテストブロック（`it` / `test` の本体）が **assert を 1 つ以上持つ**こと（`expect(` の直接呼び出し、または `expect` を含むヘルパ関数への呼び出し）。**error**。加えて、**assert（ヘルパ呼び出しを含む）がすべてループの中にある**ブロックは **warning** —— 母集合が空になった日に 1 度も走らずに緑になるためである（ループの外に `expect(items).not.toHaveLength(0)` を 1 行置けば消える）。構文を切り出せなかったブロックは中身を判定しないが、件数を warning で出す（下の節） |
| A17 | `writes` の欄が動かせる | `access_spec` の `writes[].fields` に並ぶ欄のうち、どの action_spec の `input` にも `computes` にも現れず、`state_spec` の `records_actor` / `clears` にも由来しない欄を **warning** で報告する。宣言はあるのに書き換える口が 1 つも無い欄は**執行を伴わない宣言**である（「遷移が書き換える欄」を書く軸が DSL に無いことを `writes` で近似した箇所がこれにあたる。近似は残してよいが、近似であることが verify の出力に残る） |
| A18 | `writes` の規則の執行点 | `access_spec` の `writes[]` の規則（`by` / `when`）を SQL の執行点に落とすのは **`kind: rpc` / `shape: update` の生成 RPC の本文だけ**なので、その形の関数を持たない表の `writes` を **warning** で報告する。`handwritten:` で本文を手写しと宣言した関数は、**見張る `test_cases` があれば**執行点と認める（テストの宣言が無い手写しは宣言ではない）。対処は 3 択 —— (1) 生成 update RPC を宣言する / (2) `handwritten:` に理由を書きテストを宣言する / (3) 規則を消す。**この検査は生成器の変異テストが実測した検査の漏れから出てきた**（`writes[].when` を機械で落としても、生成 update RPC の無い表ではどの生成物も 1 バイトも変わらなかった。束 ⑳-5c-b） |

### ⚠ A4 の死角 — 編集（`writes`）は数えない

**A4 の母集合に `writes` は入らない。** 編集は「どのフィールドを」まで含めて 1 操作の粒度が決まるため、`writes` の宣言 1 本が Server Action 1 本に対応するとは機械的に言えないからである（上の予約 ID `{entity}.update` の節が理由の正）。

その結果、**編集操作では「`verify` がエラー 0」が作業の完了を意味しない**。`access_spec` に `writes` を宣言しただけの状態でも、`action_spec` が無く operation が無く Server Action が無いまま検証は緑になる。作成・削除なら A4 が「入口が無い」と言ってくれるが、編集では**誰も言わない**。

代わりに残りを見ているのは次の 2 つであり、どちらも A4 とは見ている側面が違う。

| 検査 | 何を言うか | 何を言わないか |
|------|----------|--------------|
| **S10**（UI 到達の網羅。[screen-spec-writing.md](../../../frontend/specification/standards/screen-spec-writing.md)） | `{entity}.update` を発火する画面が 1 枚も無ければ失敗する（母集合は A4 に編集を足したもの — UI 到達は粒度の問題ではなく有無の問題なので数えられる） | 画面があっても、その先の Server Action が実在するかは見ない |
| **A7**（意味的カバレッジ） | `action_spec` を**書いたなら**、編集に必要な意味クラス（`forbidden` / `conflict` / フィールド交わりによる `invariant` ほか）が揃っているかを見る | `action_spec` そのものが無いことは言わない |

したがって編集を足すときは、**検証器の沈黙を完了の合図にせず**、`access_spec` の `writes` → `action_spec` → operation（5 形のうち編集 2 形のどちらか）→ Server Action → 画面、までを自分で追い切る。免除するなら `specs/frontend/screens/README.md` の `unexposed` に理由を書く（S10 の側の宣言）。

### A10 — 走査の網羅（system が起こすイベント）

A4 の母集合は**人間ロールが実行できる操作**なので、`by` が `system` だけのイベント（`loan.report_overdue`）はどの検査にも入らない。状態機械の上では「期限が来れば延滞になる」と書いてあるのに、**実際に実行する主体がどこにも無い**という状態が、仕様としては何の警告も出さずに成立してしまう。人間の操作なら「画面が無い」ことで気付くが、system の操作は気付く人がいない。

そこで A4 と同じ形の宣言を要求する。書く場所も同じ `specs/backend/actions/README.md` のフロントマターである。

```yaml
scans:
  - event: loan.report_overdue
    implementation: app/src/operation/loan/report_overdue.ts
    test_cases:
      - id: TC-LOAN-REPORT_OVERDUE-001
        type: integration
        covers: [success]
        spec_ids: [loan.report_overdue]
        implementation: app/src/composition/__tests__/loan/report_overdue.test.ts::期限を過ぎた貸出中の貸出が延滞として記録され、effects が outbox に積まれる
unscanned:
  - event: hold.expire
    reason: 取り置き期限後の自動取消は未実装。現状は司書の手動 cancel のみ
```

- **母集合**は `by` に `system` を**含む**全遷移イベント。人間ロールとの混在（`by: [librarian, system]`）も含める — 「人間が実行する経路もあるが、時刻が来たら自動でも実行されるはず」であり、走査が無いならその自動の側は存在しないからである。
- **`scans[].implementation`** はリポジトリルートからの相対パスで、`app/src/operation/` 配下のモジュールを指す。走査の実体は起こすイベントの operation に同居させる（ARCH-BE-0015「時間駆動のドメインイベント」）。**実在も検査する** — 宣言だけが残って実装が消えた状態を作らない。
- **`scans[].test_cases`（テスト義務の全域化。任意）** — 走査で起こすイベントは `action_spec` を持たないのが既定なので、`test_cases` の通常の置き場（A6）が無い。ここに書けば、書式は `test_cases`（§test_cases）とまったく同じで、A10 が A6 と同じ 3 段（実装ファイルの実在 → `@tc` の存在 → テスト名の一致）で突合する。**書かなくてもエラーにはならない** — このキーは「書けるようにする」追加であり、既存の走査宣言に新しい義務を課さない。
- **`scans` の行ごとに、発火元がちょうど 1 つ要る(J2)。** `scans` は「画面以外から起きる遷移」の実装の宣言で、起こす主体は (1) 時刻起点のジョブ(jobs.md の `fires: {イベント}`)か (2) サインイン時の同期の実行(auth.md の `sign_in[].runs` に名指されたイベント)のどちらかである。**0 本も 2 本以上も落ちる**(ジョブから `fires` を消す・`runs` を書き忘れる・同じイベントを 2 本のジョブが起こす・ジョブが起こす走査を `runs` も名指す)。受信 Webhook と画面の `emits` は `scans` の外の発火元なので、そちらで起きるイベントは `scans` に書かない。新しい欄は無く、jobs.md と auth.md の既存の宣言を読むだけである(job-spec-writing.md「起動口・`fires`・`due_from` の実装への接地」)。
- **`unscanned[].reason`** は「なぜ今は実行しないか」。`unhandled` と同じく、この一覧がそのまま「これから作る走査」の一覧になる。
- **掃除漏れは警告**（A4 と同型）。走査ができたのに `unscanned` が残っている／`by` に `system` が無いイベントの宣言がある／実在しないイベントの宣言がある、の 3 つ。
- **Server Action は生成されない。** `by` が system **だけ**のイベントには `'use server'` の入口が無い（実行者が system に解決される経路が Server Action には無いので、作っても常に forbidden で終わる死んだ口になる）。生成器（`code-operation-app.ts`）と期待ファイル木（`code-structure-expectations.ts`）が同じ判定でその 1 ファイルを落とす。**Composition Root は作る** —— 実行する経路（走査・受信口）から呼ぶ配線はどの操作にも 1 つある。
- **`action_spec` は、その操作を実行計画に載せたいときだけ作る。** 走査（`scans`）で起こすイベントは宣言 1 行が「入口の代わり」であり、`action_spec` を持たないのが既定である（`handles` する仕様も、境界で受ける `input` も無い）。テストは走査の実装に対して直接書き、`scans[].test_cases` を書かない場合は `@spec` / `@tc` の注釈も付かない（突合する `test_cases` の宣言が無いため）。
  - **受信 Webhook（`external_spec` の `emits`）で起こすイベントも `action_spec` を持たない。** 受信口は実行計画ではなく**生成された受信の RPC**（記録と遷移を 1 トランザクションで起こす）を 1 回実行するので、計画の出どころが要らない（external-spec-writing.md §受け取る側の軸 / ARCH-BE-0014 §インバウンド）。

### A7 — 必要な意味クラスの導出規則

A1〜A6 が見るのは「**宣言したもの**が実在するか」だけで、**宣言しなかったもの**は誰も咎めない。ガードを持つのに不成立のケースを書かない、拒否されるロールがいるのに権限のケースを書かない、といった書き漏らしは仕様としては静かに通ってしまう。A7 はその穴を塞ぐ検査であり、「ドメイン仕様がそう書いてある以上、確かめるべきことがある」を機械の要求に変える。

**必要クラスはすべてドメイン仕様から導く。**`action_spec` に書かれた内容は導出に使わない（薄さの基準を崩さないため）。

| 操作の種類 | `success` | `guard_unsatisfied` | `invalid_from` | `forbidden` | `invariant` | `conflict` | `not_found` |
|-----------|:---------:|:-------------------:|:--------------:|:-----------:|:-----------:|:----------:|:-----------:|
| 遷移 `{machine}.{event}` | 常に | `guard` がある場合 | `from` が全状態を覆っていない場合 | **拒否される人間ロールがある場合**（`by`。下記の判定） | そのイベントを `enforced_by: guard` の `ref` に持つ不変条件がある場合、または**別集約の不変条件がこのイベントの属する集約を `involves` で挙げている場合**（下記） | 常に | — |
| 作成 `{entity}.create` | 常に | `creates[].when` がある場合 | — | **拒否される人間ロールがある場合**（`creates[].by`。下記の判定） | 同じ集約の不変条件に `db_constraint` / `trigger` で執行されるものがある場合、または**別集約の不変条件がこの集約を `involves` で挙げている場合**（下記） | `creates[].when` がある場合 | — |
| 削除 `{entity}.delete` | 常に | `deletes[].when` がある場合 | — | **拒否される人間ロールがある場合**（`deletes[].by`。下記の判定） | **別集約の不変条件がこの集約を `involves` で挙げている場合**（下記。それ以外は要求しない） | 常に | 常に |
| 編集 `{entity}.update` | 常に | `writes[].when` がある場合 | — | **拒否される人間ロールがある場合**（`writes[].by`。下記の判定） | **`writes[].fields` に触れる不変条件がある場合**（下記の交わり判定） | 常に | — |

「—」は**要求しない**という意味であって、書いてはいけないという意味ではない。判定は「必要クラス ⊆ 宣言済み `covers` の和集合」であり、**過剰な宣言は問題にしない**。足りないものだけが違反になる。

**ロールの義務は上の表と直交する。** 意味クラスとは別に、A7 は「宣言に並ぶ人間ロール（遷移の `by` / `creates[].by` / `writes[].by` / `deletes[].by`）ごとに、`by_role` を持つ `success` のケースがあること」を要求する。こちらは**過剰も違反**である（宣言に無いロールを指定する `by_role` は綴り違いか宣言の取り残しなので落とす）。

導出の根拠:

- **`conflict` を遷移・削除・編集で常に要求する**のは、これらの書き込みが例外なく「可否を判断したときの対象」を条件にした楽観的並行制御で行われるため（ARCH-BE-0013）。**作成は条件つきで要求する** —— 作成それ自体に「判断時の対象」は無いが、`creates[].when` を持つ作成は**可否が親（または対象の親集約）の状態に依存する**ので、判断してから書き込むまでに親が動けば 0 行になり、削除・編集とまったく同じ競合が起きる（条件が 1 本も無い作成には古びうる判断が無いので要求しない）。**状態機械を持たない集約でもこの要求は消えない** — その場合の「判断時の前提」は状態ではなく**対象がそのとき存在したこと**であり、0 行（対象の消滅）を成功と区別することがそのまま `conflict` のケースになる（実物: `patron.update`。読み替えの正は [server-actions.md §状態列を持たない集約の単行 form](../../system/standards/conventions/server-actions.md)）。
- **`forbidden` は「拒否される人間ロールが 1 つ以上存在するとき」だけ要求する。** 遷移・作成・削除・編集のどれも同じ判定であり、`by` / `creates[].by` / `writes[].by` / `deletes[].by` に並ぶ許可ロールを**ロール階層（`implies`）で閉包**し、その結果が全人間ロールを覆っていれば拒否の反例が作れないので要求しない。閉包は許可ロール側から見て「そのロールを（推移的に）implies するロールも許可される」方向にだけ広げる（例: `implies: [patron]` を持つ `staff` は、`by: [patron]` の操作を暗黙に許される）。人間ロール全員が許可されている操作（例: `purchase_request.create` — `creates` は `anonymous` / `patron` だけだが、他の全人間ロールが `implies` で `patron` を覆う）には拒否されるロールが存在しないため、`forbidden` は義務ではない。
- **`not_found` を削除でだけ要求する**のは、削除が「対象が実在すること」そのものを前提にした操作であり、対象が消えている場合の振る舞い（存在を漏らさないこと）が契約の一部だから。
- **`invariant` の探索範囲**は操作の種類で違う。
  - **遷移**: モデル全体の `enforced_by: guard`（そのイベントを執行点として名指ししている不変条件）。
  - **作成**: その集約自身の `invariant_spec` のうち `db_constraint` / `trigger` で執行されるもの。作成は**その行の全フィールドを一度に置く**ので、下の交わり判定を待つまでもなく必ず交わる（**編集の判定の特殊形**である）。
  - **編集**: **フィールドの交わりで判定する。** `db_constraint` / `trigger` で執行される不変条件のうち、**その形式定義（`formal`）が参照するフィールドが `writes[].fields` の和と交わる**ものがあれば `invariant` を要求する。参照フィールドは `check` の式・`uniqueness` の `keys` と `where`・`cardinality` の `keys` / `max` / `where`・`state_dependency` の `if` / `then` から機械的に取る（`statement` は読まない）。裸のフィールド名はその不変条件を宣言した集約のエンティティのものとして解決する。
- **`involves`（別集約を数える不変条件の義務の全域化）。** 上の 3 つの探索範囲はどれも「その不変条件が住む集約」からしか義務を配れない。件数を数える不変条件（`cardinality` や、集計のため `formal` を省略した DSL 外の不変条件）は**子集約の作成・削除**で破れうるが、`enforced_by: guard` は同じ集約のイベントしか指せないため、これまでは子集約の `create` / `delete` に一切義務が配られなかった（実穴: INV-LOAN-008「提出済みの貸出は同伴の利用者 ≥ 1・付箋が要る貸出なら付箋 ≥ 1」は `note` / `loan_companion` を数えるが、`note.delete` / `loan_companion.delete` は貸出の状態を見ておらず、提出後にこの不変条件を破りえた）。`invariant_spec` に `involves: [{他集約}, ...]`（domain-spec-writing.md §invariant_spec）を書くと、A7 はそこに挙げた**各集約の create / delete（`access_spec` の `creates` / `deletes`）と、その集約の全遷移**に `invariant` を追加で要求する（上の表の該当セル）。この不変条件が住む集約自身の「守られる状態へ入る遷移」を守りたい場合は、従来どおり `enforced_by` に `kind: guard, ref: {その遷移}` を足す — `involves` とは独立した仕組みである。
- **編集の交わり判定は集約をまたぐ。** 「他集約の不変条件は執行点が相手側のテーブルにあるから、この操作では破れない」は**偽である**。反例: `item.update` は `hold_limit` を書き換えられ、`INV-HOLD-101`（有効な予約の数 ≤ `item.hold_limit`。執行点は `holds` のトリガー。いずれも説明のための仮の名前）はその値を参照している。執行点がどのテーブルにあるかと、**どの操作がその条件に触れるか**は別の問題である。
- **交わっても「必ず破れる」とは限らない。** 上の `INV-HOLD-101` は**受入時の判定条件**であり、上限の引き下げで既存の超過が生じることは許容される（その不変条件の `statement`）。A7 が要求するのは「その不変条件のまわりを 1 件は確かめること」であって「その操作で必ず違反が起きること」ではない。**過剰に要求する側に倒してある** — 触れているのに 1 件も確かめないより、確かめてから「ここでは破れない」と書けるほうが安全だからである。
- **人間ロール**は `role_spec` のうち `system` 以外すべて（A4 と同じ定義）。

**検証器はこの表の実装である。**表と `legacy/spec-tools/lib/trace/required-coverage.ts` がずれた場合は表が正であり、実装を直す（PRIN-0001）。

### A11 — 操作の閉世界（実装 → 仕様の逆向き）

A1〜A10 は「宣言されたものが実装されているか」を見るが、その逆 — **仕様のどこにも無い操作の実装が置かれていないか** — は誰も見ていなかった。`operation/loan/teleport.ts` のようなファイルは ESLint（1 ファイル完結）も A 群も素通しで、由来の無い書き込み経路が静かに増える（S7 の「実ルートにあるのに仕様が無い」と同じ種類の穴）。

A11 は `app/src/operation/{aggregate}/{event}.ts` の走査結果を配置規約どおり `{aggregate}.{event}` に写し、宣言済み集合（`state_spec` の全イベント + `access_spec` の予約 ID。集約名とエンティティ名のどちらの綴りも許す）との差分を**エラー**にする。除外は配置規約（server-actions.md / `operation-naming.mjs`）と同じ — `_template/` `shared/` `jobs/` `__tests__/` の配下、直下の横断モジュール、集約直下の `ports.ts`。**免除の口は作らない**（宣言に無い操作の実装に正当な理由は無い — 仕様に宣言するか、削除するかの二択である）。

**加えて、`unhandled:`（A4 の免除。「まだ action_spec を作らない」）で名指しされた操作の operation 実装が、すでに置かれていないかも見る。** `unhandled` は「仕様には実在するが、まだ Server Action の入口を作らない」という宣言であり、その裏付けとなる書き込み経路(operation)が先に実装されているなら、宣言と実態が食い違っている——入口が無いはずの書き込みが、免除の陰で静かに動ける状態になる。この検査もエラーであり、免除の口は無い（宣言を消して action_spec を作るか、実装を削除するかの二択）。

### A12 — 注釈の台帳（注釈なしテストのラチェット・片方だけの注釈の禁止）

機械が仕様⇔テストの突合キーに使うのは `@tc` だけであり、注釈の無いテストは A6 の orphan 判定にも A7 の網羅にも**母集合として現れない**（違反ではなく不在として扱われる）。A12 はテストファイルの走査結果を母集合とし、`@tc` を 1 つも持たないファイルが `specs/backend/actions/README.md` のフロントマター `test_tag_baseline` の外に**増えていない**ことを見る（粒度はファイル単位。`it` 単位への強化はテスト義務の全域化の本体で行った）。

`test_tag_baseline` は**免除台帳ではなく未処理一覧**である（`unhandled` / `unscanned` と同じ書式だが、意味が違う）。導入時点（2026-08-26）の無印 30 本を基準線として持ち、**行は消すだけで、足さない** — 新しいテストファイルには注釈を付ける。注釈を付けたのに行が残っている / 実在しないパスを指している、の消し込み漏れは警告になる（A10 の掃除漏れと同型）。2026-09-04 に導入時点の 26 本すべてへ注釈を付け終え、台帳は空になった（キー自体は残る）。

**加えて、`@spec` はあるが `@tc` が無い行（片方だけの注釈）は台帳の有無に関係なく常にエラーにする。** 注釈の名前空間は `@tc` 一本であり、`@spec` だけの行は突合キーを持たないため、書いた本人には「注釈を付けたつもり」に見えるのに A6 の uncovered/orphan にも A12 のファイル単位判定にも引っかからず**静かに見落とされる**。片方だけの注釈は書きかけの注釈であり、`@tc {id}` を同じ行に足して完成させる。


### A16 — 注釈の中身（assert の実在と、空の母集合）

「注釈 + テスト名 + ファイル」の 3 点は A6 / A12 / Z1 が完全に閉じているが、**`it` の中身は誰も見ていなかった**。検査の漏れ探し（2026-09-12 §5）の実測では、注釈付きのテストから `expect(` を**全部消しても全検査が緑**のままで、仕様側は「見張りテストあり」と数え続けた。テストの存在を数える仕組みは、**テストが何も確かめていない状態と区別が付かない** —— 保証台帳（Z 群）と見張りテストの体系は、この下限が無いと主張だけの目録になる。

見るのは構文の下限 2 つだけで、意味（そのテストが本当にその仕様を確かめているか）は見ない。

| 段 | 何を見るか | 重さ |
|---|---|---|
| assert の実在 | ブロックに `expect(` があるか。無くても、**`expect` を含むヘルパ関数**（`expectRejected(result)` の類）を呼んでいれば通る | error |
| 空の母集合 | assert（**ヘルパ呼び出しを含む**）が**すべてループの中**にあるか。母集合が空なら 1 度も走らずに緑になる | warning |

**ヘルパを許容する理由。** 許容しないと A16 は「ヘルパを使うな」という別の規則に化ける。ヘルパの母集合は走査が集める —— テスト本体と `__tests__` 配下の支援コードのうち、**本体に `expect(` を持つ関数宣言**（`function 名(…) {` / `const 名 = (…) => {`）の名前である（実測 8 種・54 ブロックがこの形に依存している）。**値の定数は候補にならない** —— 以前は「宣言より後の最初の波括弧」を本体とみなしていたため `const LIMIT = 3;` が直後の `describe(… => {` を自分の本体と読み、免除の母集合が 180 語（大半はただのローカル定数名）に膨らんでいた（束 ㉑ の独立レビュー 2-A）。

**ヘルパ呼び出しも「空の母集合」の対象である。** ループの中で `expectCalls(…)` を呼ぶだけのブロックは、error 段はヘルパ免除で抜け、warning 段は「直接 assert がある」が偽で成立せず、**2 段のどちらにも掛からない空白**だった（同 2-C）。

**注釈は `it` / `test` の宣言の直前の行に置く。**（間に挟めるのはコード例の抜き出し印 `// #region …` の行だけ。）注釈を `it(...)` の**中**に書いても A6 / Z1 は受理するが、A16 はそのブロックを切り出せない —— つまり**注釈を 1 行下げるだけで中身の検査を外せた**（同 2-B）。位置は書式の一部であり、外れた位置は **A12 が error** にする。

**読めなかったブロックは中身を判定しないが、黙らない。** ブロックの切り出しは構文（コメントと文字列を潰したうえでの波括弧の対応）で行う下限の仕掛けであり、読めないことを個別の違反にはしない。代わりに**件数を 1 件の warning** にまとめ、検査の下限がどこで切れているかを人に見せる。

### A14 — ガード環境の突合（手書き `guardEnv` ⇔ 仕様のガード式）

同じ規則を評価する場所が 2 つある。operation の手書き `guardEnv`（5 形の定型に渡す設定）と、保存点の実行計画の `guardFacts`（生成物）である。どちらもエンジンに「ガード式の変数 → 値」の割り当てを渡す役であり、**鍵はガード式のパスそのもの**である（エンジンは `env[パス]` で引く。`domain/engine/guard.ts` の `lookup`）。つまり鍵の集合は仕様から一意に決まる —— 決まっているのに手で書いているので、次の 2 種類の食い違いが静かに起こりうる。

- **足りない鍵**: そのガードは常に `unknown` になり、`canFire` / `canCreate` は**拒否として扱う**。通るはずの操作が通らず、しかも拒否の理由を仕様から説明できない。
- **余分な鍵**: 仕様のどのガードも見ない事実を operation が読んでいる。読み取りの無駄であると同時に、「仕様に無い挙動が手書きで入り込む」経路である（ADR-0012 §Context）。

A14 は `guardEnv` が返すオブジェクトリテラルの**最上位の鍵**を読み、その操作のガード式（遷移はそのイベントの `guard` 1 本、作成・削除・編集は規則の**全数**の `when`。どの規則で通るかは実行時にしか決まらないため）に現れるパスの集合と突き合わせる。**免除の口は作らない** —— 一致しないことに正当な理由は無く、直すのは仕様かコードのどちらかである。

`guardEnv` は `(facts) => ({ '{パス}': 値 })` の形で書く（オブジェクトリテラルをそのまま返す）。ブロック本体・計算された鍵・スプレッドは鍵を静的に決められないので、A14 は「読めない」としてエラーにする（黙って空の集合として扱わない）。

この検査は **④（operation の生成。ADR-0012 §Decision 2）が済めば役目を終える** —— 手書きが消え、両方が同じ導出の生成物になるからである。それまでの間、二重実装が同じ事実を見ていることを機械が保証する。

---

## 関連ドキュメント

- [ARCH-SP-BE-0001 — バックエンド仕様（docs/specs/backend）の構成](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)
- [ARCH-BE-0013 — Server Action の構造](../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)
- [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) — ドメイン仕様の書き方（参照先の正）
- [server-actions.md](../../system/standards/conventions/server-actions.md) — 実装規約
