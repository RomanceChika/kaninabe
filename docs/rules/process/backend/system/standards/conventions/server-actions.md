---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0003, PRIN-0005, PRIN-0007, PRIN-0009, PRIN-0010, ARCH-BE-0001, ARCH-BE-0013]
decisions: [ADR-0004]
---

# Server Action の実装規約

Server Action（ドメインイベントハンドラ）の書き方を固定する規約。構造とエラー分類の契約は ARCH-BE-0013 が正であり、ここでは**そのとおりに書くための形**（配置・命名・型・禁止事項）を定める。

> **実例:** 仕様は `docs/specs/backend/actions/`、題材の通し実行は `legacy/spec-tools/__tests__/fixtures/samples/` にある（`loan.check_out` など）。

## 1. 目的・スコープ

- **目的:** 同じ仕様からは同じ実装しか出てこない状態を作る。書き方の自由度を奪うことで、レビュー対象を「意味が合っているか」だけに絞る（ADR-0004）。
- **スコープ:** `app/src/app/_actions/` 配下の Server Action と、それが呼ぶ `app/src/operation/` の関数の境界。読み取り（RSC + クエリ関数）の規約も含む。
- **正の所在:** 構造・4 手順・エラー 3 分類の契約は [ARCH-BE-0013](../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)。仕様の書き方は [action-spec-writing.md](../../../specification/standards/action-spec-writing.md)。

## 2. ルール

### 配置と命名

- **すべきこと:** ドメインイベント ID から機械的に導く。

| 仕様 | 実装ファイル | export 名 | operation |
|------|------------|----------|---------|
| `docs/specs/backend/actions/loan/create.md` | `app/src/app/_actions/loan/create.ts`（生成） | `createLoanAction` | 実行計画（手書きの operation は無い） |
| `docs/specs/backend/actions/loan/return_item.md` | `app/src/app/_actions/loan/return_item.ts`（生成） | `returnItemLoanAction` | 実行計画（同上） |
| `docs/specs/backend/actions/loan/check_out.md` | `app/src/app/_actions/loan/check_out.ts`（手書き） | `checkOutLoanAction` | `app/src/operation/loan/check_out.ts` の `checkOutLoan`（`runner: manual`） |
| (例。デモには無い)`docs/specs/backend/actions/hold/update.md` | `app/src/app/_actions/hold/update.ts`（手書き） | `updateHoldAction` | `app/src/operation/hold/update.ts` の `updateHold`（`runner: manual`） |

予約 ID（`{entity}.create` / `{entity}.delete` / `{entity}.update`）も同じ導出規則に従う。特別扱いはしない。
ディレクトリ名は `handles` の前半（= `access_spec` の `entity`）であり、集約ディレクトリ名と食い違う場合は `handles` 側に合わせる（`hold.*` → `_actions/hold/`）。

- **すべきこと:** 1 ファイル 1 アクション。ファイル先頭に `'use server'` を書く。
- **してはいけないこと:** `src/app/_actions/**` の外(部品のファイル・ページ)に `'use server'` を書く・関数本体の中に `'use server'` を書く(インラインの Server Action)。どちらも仕様の宣言(認可・出どころ・拒否の記録)の外の POST の口になる。ESLint `layer/use-server-placement` が error にする(点検 7 回目 C7-1)。
- **してはいけないこと:** 1 ファイルに複数のアクションをまとめる。`handles` に無いイベントの処理を同じ関数に混ぜる。

**この表の導出規則は機械執行している**（ARCH-BE-0001 の E9）。パスと export 名の一致は ESLint のローカルルール `layer/action-naming` / `layer/operation-naming` が検査する。何が検出され何が検出されないかは
[enforcement/naming-and-placement.md](./enforcement/naming-and-placement.md) を参照。変換規則を変える場合は、この表・同文書・`framework/lint-config/src/rules/naming.mjs` を同時に改訂する。

### 定型 4 手順

- **すべきこと:** 本体は次の順序でのみ書く。順序を入れ替えない。

1. **パース**: `app/src/domain/generated/{entity}.schema.ts` の zod スキーマで入力を検証する。
2. **照会**: 実行者（actor）と対象の現在状態をそろえ、`app/src/domain/engine` に遷移可否を問う。
3. **永続化**: operation が Repository IF 経由で保存する。
4. **outbox**: `effects` に対応するジョブを③と同一トランザクションで積む。

- **すべきこと:** ②〜④は operation 関数の中で行う。Server Action の責務は「入力の受け取り → composition から operation を取得 → 呼び出し → `Result` を返す → 必要なら再検証（`revalidatePath` 等）」に限る。
- **してはいけないこと:** Server Action や operation に、状態・ロールを判定する `if` を書く。判定はすべてエンジンへの照会に置き換える。
- **してはいけないこと:** ①の前に DB を読む、②の前に書き込む、④を別トランザクションに出す。

### 5 形の定型はテンプレート関数として 1 つずつ存在する

**この規約が言う「順序」は、`app/src/operation/_template/` の関数の中に 1 回ずつしか存在しない。**

計画で走る操作（= 宣言された例外でない全部）では、その 1 回は**実行計画の実行器**
`_template/run-plan.ts` の中にある。形ごとに違うのは②の照会先だけであり、それも実行器の中の
1 か所の分岐である（`run-plan-decide.ts`）。作成・削除の定型は束 ⑰-3 でそこに吸収されて消えた。

宣言された例外（`runner: manual` / `scans:`）が使う定型は 3 つ残っている。

| 形 | テンプレート | 照会 | 実物 |
|----|------------|------|------|
| 遷移 | `_template/transition.ts` の `transitionOperation` | `canFire` | `loan.check_out` / 取り置きの 3 本 / `membership.erase` ほか |
| 編集（バルク形） | `_template/update.ts` の `updateOperation` | `canWrite` | `hold.update`（一括並べ替え） |
| 編集（単行 form） | `_template/update-fields.ts` の `updateFieldsOperation` | `canWrite` | `item_check.update` |

**編集だけテンプレートが 2 つあるのは、数えるものが違うからである**（バルク形は対象、単行形は
フィールド）。1 つに畳もうとすると「対象 × フィールド」の直積を扱う形になり、実物の無い一般性を
先に書くことになる。形が 1 つ増えるならテンプレートを 1 つ増やす、というこの節の原則どおりにした。

**以下の「各操作は設定オブジェクトを渡す」は、宣言された例外にだけ当てはまる。** 計画で走る操作は
設定オブジェクトも書かない —— 何を読むか・ロールをどう解決するか・ガードに何を載せるか・どう
永続化するかは、すべて実行計画（仕様からの生成物）が運ぶ。

- **すべきこと:** 各操作は対応するテンプレートに**設定オブジェクト**を渡すだけにする。設定に書けるのは集約ごとの個性 4 つ——`loadFacts`（判断に要る事実を読む）/ `actorRoles`（binding の対応表を `resolveActorRoles` に渡す）/ `guardEnv`（ガード式が参照するパスへの値の割り当て）/ `persist`（永続化の呼び出し）と、成功値の写像（`toResult`）だけである。
- **すべきこと: `guardEnv` は `(facts) => ({ '{ガード式のパス}': 値 })` の形で書く**（オブジェクトリテラルをそのまま返す）。鍵はガード式のパスそのもの（エンジンは `env[パス]` で引く）であり、**集合は仕様から一意に決まる** —— [A14](../../../specification/standards/action-spec-writing.md#a14--ガード環境の突合手書き-guardenv--仕様のガード式) が仕様のガード式と突き合わせる（足りない鍵はガードを常に拒否にし、余分な鍵は仕様に無い読み取りである）。ブロック本体・計算された鍵・スプレッドは鍵が静的に決まらないので書かない。
- **すべきこと:** 公開する形は `export const {operation}: (deps, command) => Promise<ActionResult<{Result}>> = xxxOperation({ … })` と型注釈で固定する。設定を触っても呼び出し側から見た契約が動かない。
- **すべきこと:** ドメインイベントIDは設定に書かない。テンプレートが生成物から導く（遷移は `${machine.machine}.${event}`、作成・削除・編集は `${rules.entity}.{create|delete|update}`）。**綴りの正を生成物 1 つに残す**ためであり、操作を文字列で指定できる形にすると、仕様の外にもう 1 つ正ができる（PRIN-0007 / PRIN-0008）。
- **してはいけないこと:** **設定のコールバックに行の選別や可否の判断を書く。** `loadFacts` が答えるのは「読めたか」だけであり（戻り値は `found(facts)` / `NOT_VISIBLE` の判別型で、`null` は使わない）、読めなかったことは一律に `forbidden` へ写る。`BulkTargets` の `rejected` に載せてよいのも**境界の検証の続き**（対象が見えない・指定がまとまりとして意味を持たない）だけである。誰が・いつ・どの状態でよいかはすべてエンジンの照会に置く — ここに `if` を書けば、判断が仕様の外に戻る。
- **してはいけないこと:** テンプレートを経由せずに 4 手順を手書きする。順序・拒否の写像・競合の扱いが操作ごとに揺れる余地を残さない（それを消すためにテンプレートがある）。
- **してはいけないこと:** テンプレートに操作ごとの分岐（`if (eventId === …)`）を足す。形が 1 つ増えるなら**テンプレートを 1 つ増やす**（実物のない定型は書かない）。
- **注:** `_template/` は `layer/operation-naming` の検査対象外である（ドメインイベントに 1 対 1 で対応しないため。[enforcement/naming-and-placement.md](./enforcement/naming-and-placement.md)）。

この形にしたことで、**規約の文章でしか守れていなかったもの**が構造に移った。②の前に書き込めないのは、永続化の口（`persist`）がエンジンの許可（`FireAllowed`）を要求するからであり、拒否の分類が揺れないのは写像がテンプレートの中の 1 行だからである。

同時に、結末の分岐はテンプレートに集まった。行カバレッジの側から見ると、`src/operation/**` の 100% は「16 操作それぞれで全結末を書く」ことを要求しなくなっている。**これはテストを減らしてよいという意味ではない。テスト十分性の正は仕様網羅（A6 の `test_cases` 突合・A7 の宿題出し）であって行カバレッジではなく、カバレッジが緩んだことはテストを削る根拠にならない**（[testing/unit.md](./testing/unit.md) 6節）。カバレッジが残す下限は関数カバレッジのほうで、各操作の設定コールバック（`loadFacts` / `actorRoles` / `guardEnv` / `persist` / `toResult`）は**1 つでも呼ばれないまま残れば未カバーとして落ちる**。テンプレート自身の約束（順序・全項目照会・拒否の写像）は `src/operation/__tests__/_template/` が合成の表で直接確かめる。

**5 形の Outcome 型は判別共用体であり、非成功枝（`conflict` / `invariant_violated`）は形ごとにブランドされている**（ブランドの語彙は 5 形のまま。作成・削除の定型が消えても「作成の結果」「削除の結果」という形の区別は残る）（`_template/outcome.ts`。`domain/engine/machine.ts` の `FireAllowed` と同じ、非公開 symbol による封印）。`{ kind: 'conflict' }` を手で書いても `CreateOutcome` / `TransitionOutcome` 等には代入できず、構造的に一致するだけの値は `npm run typecheck` が落とす（`src/operation/__tests__/_template/outcome.test.ts`）。集約のリポジトリ（`ports.ts`）が返す生の結果（成功枝の kind とペイロードは集約ごとに違う）は、テンプレートの `persist` 実装がその場で `seal(form, raw)` を通してブランド付きへ変換する——**素通しの `return outcome` は書けない**。ブランドは「5 形のどれか」までを区別する（操作 ID 単位ではない。個々の予約 ID まで閉じるには `persist` のシグネチャに `decision: FireAllowed` と同じ証明の口を通す設計が要り、別バッチの規模になる）。

### 保存点の Server Action は生成物である（手書きしない）

**保存点（`usecase_spec` の `saves[]`。ADR-0011 §4「1 保存 = 1 トランザクション」）の Server Action と
composition は、`npm run generate` が書く**（`app/src/app/_actions/usecase/{name}/{save}.ts` /
`app/src/composition/usecase/{name}/{save}.ts`）。手で書ける場所を残さないのは、そこに**集約ごとの個性が
1 つも無い**からである —— 保存点の Server Action は「生成 zod で parse → 実行者を解決 → composition を
呼ぶ」の 3 行しかなく、その 3 行は上の定型 4 手順の①そのものである。手書きの余地があれば、その分だけ
定型から外れうる（決定性の格上げ ④ の初実例）。

保存点で**手で書くのは 1 つだけ**である: `app/src/operation/usecase/{name}/{save}.ts` の
`{camel(name)}{Pascal(save)}Hooks`（DSL の外にある `application` 執行の不変条件を、入力から判定する
純関数の表）。手順の順序・`permit`・拒否の写像は実行計画の実行器（`_template/run-plan.ts`。**単発の操作も同じ関数で走る** —— 1 操作は手順が 1 つの保存点にすぎない。ADR-0012 ④）が持ち、
1 トランザクションの書き込みは生成された複合 RPC が持つ。書き方の正は
[usecase-spec-writing.md](../../../../frontend/specification/standards/usecase-spec-writing.md)
§app 側に生成されるもの。

生成物は `app/src/domain/generated/` の**外**に出る（置き場をこの文書の §配置と命名が決めているため）。
どれも先頭に AUTO-GENERATED ヘッダを持ち、`npm run generate:check` の対象であり、実在と主 export の
閉世界は `structure-expectations.ts` の `expectedUsecaseFiles` が見る。

### 単発の操作の Server Action と Composition Root も生成物である（束 ⑰-2）

**保存点について上に書いたことは、いまは単発の操作（action_spec 1 本）の全数にも当てはまる。**
`npm run generate` が `app/src/app/_actions/{集約}/{イベント}.ts` と
`app/src/composition/{集約}/{イベント}.ts` を書き、どちらも先頭に AUTO-GENERATED ヘッダを持つ。
実行するのは保存点と同じ実行器（`_template/run-plan.ts`）であり、読むのは仕様から導いた実行計画
（`app/src/domain/generated/operation-plans.ts`）である —— **1 操作は手順が 1 つの保存点にすぎない**。

**ユニットテストも生成物である**（束 ⑰-3）。`app/src/operation/__tests__/generated/{集約}/{イベント}.test.ts`
に、A7 が仕様から導く意味クラス（成功・ロールごと / ガード不成立 / 遷移元でない / 権限なし /
不変条件違反 / 競合 / 対象なし）の場面が 1 本ずつ出る。場面の値（どの状態でどの列が誰を指すか）も
仕様から解いたものであり、action_spec の `test_cases` も**その名前を指す生成ブロック**である。

したがって操作について**手で書く場所は 3 つだけ**である。

| 手書きしてよいもの | 置き場 | 何を書くか |
|---|---|---|
| 不変条件の hooks・計算値 | `app/src/operation/{集約}/hooks/{イベント}.ts`(保存点は `app/src/operation/usecase/{ユースケース}/{保存点}.ts`。**`application` 執行の不変条件を持つ操作にだけ要る**。生成された Composition Root が import する先。現物は、単発の操作の hooks が 0 件・保存点の hooks が 1 件で、`app/src/operation/usecase/loan_self/register.ts`) / `app/src/domain/computes/{名前}.ts` | DSL の外にある `application` 執行の不変条件を入力から判定する純関数と、`computes` が名指しした純関数（鍵の全数は計画が型で要求する） |
| `runner: manual` の操作 | `app/src/operation/{集約}/{イベント}.ts` と、その Server Action・Composition Root | 定型 RPC に乗らない操作（一括の並べ替え・同一トランザクションで別表を書く副作用）。**理由つきの宣言が action_spec に要る** |
| `scans:` の経路 | `app/src/operation/{集約}/{イベント}.ts` と、その Composition Root | 人の入口を持たない経路（時刻で起きる走査・サインインからのシステム起点の呼び出し口）。**`specs/backend/actions/README.md` の `scans:` が宣言**し、A10 が実在を見る。判断は持たず、計画を実行するだけでよい（実物: `patronship/activate.ts`） |

**A15 は両方向を見る。** 計画が導出できないのに `runner` が無ければエラー、**計画が導出できるのに
`runner` を書いてもエラー**である（宣言された例外が、理由文つきの免除リストに退化しないように）。
後者から外れるのは「計画だけでは足りない」と機械が言える印を持つ操作だけで、その印も仕様側の宣言
である —— 自集約の外を参照する `application` 執行の不変条件か、`errors.additional`（共通の 3 分類に
無い失敗 = 定型の外で何かを実行している）。一覧と理由はハンドブックの
ハンドブックの「誰が何を実行できるか（操作）」§生成に乗らない操作に出る。

実在と主 export の閉世界は `structure-expectations.ts` の `expectedActionFiles` /
`expectedCompositionFiles` が見て、**計画のある操作の 2 ファイルが生成物のヘッダを持つこと**は
`app/src/operation/__tests__/structure/main-export.test.ts` が見る（手で置き換えたら落ちる）。

### 5 形 × migration の要否

**操作を 1 つ足すたびに SQL を書くわけではない。** 遷移だけは RPC が集約ごとに 1 本の**汎用**関数であり、イベントを足しても DDL は 1 行も要らない。ここを取り違えると、遷移ごとに同じ形の関数が量産される。

| 形 | migration | 書くもの / その RPC が持つべき性質 |
|----|:---------:|--------------------------------|
| **遷移**（既存の状態機械） | **要らない** | `apply_{machine}_transition(対象id, p_expected_state, p_next_state, p_effects)` が既にある。**状態名もイベントも引数で受ける**ので、`state_spec` に `events` を足しても関数は変わらない |
| 遷移（**新しい状態機械 / 新テーブル**） | 要る | テーブル + `revoke`/RLS（[database-guards.md](./enforcement/database-guards.md)）+ 汎用の `apply_{machine}_transition` を **1 本だけ**。性質: 判断時の状態を条件に持ち（`where ... and state = p_expected_state`）、状態更新と outbox 投入を同一トランザクションで行い、0 行を競合として返す |
| 作成 `{entity}.create` | 要る | `insert_{entity}`。性質: **初期状態のまま 1 行 INSERT**（`state` を引数で受けない — 初期状態の正は `state_spec` の `initial` であり DB の既定値が持つ）。不変条件は部分ユニーク・トリガーが執行する。outbox には積まない |
| 削除 `{entity}.delete` | 要る | `delete_{entity}`。性質: **判断時の状態を条件に含める** DELETE。**0 行 = 競合**（対象が消えた／状態が動いた）として成功と区別する |
| 編集・**単行 form** | 要る | `update_{entity}`。性質: 変更集合を `jsonb` で受け（**鍵が無い＝変更しない / 値が `null`＝空にする**を区別する）、`p_expected_state` を条件に持ち、**`writes` に現れる列以外と空の変更集合は例外**にする（第二防衛線。0 行に化けさせない）。ロックは不要（UPDATE 文自身が条件を持つ） |
| 編集・単行 form（**状態列を持たない集約**） | 要る | 同上から `p_expected_state` を**落とす**。性質: `where id = p_{entity}_id` だけの UPDATE で、**0 行の意味は「対象が消えていた」に縮む**（下記の節が正）。列の固定・空の変更集合の例外・監査ログ 1 行は同じ |
| 編集・**バルク形** | 要る | `{動詞}_{aggregate}`（例 `reorder_holds`）。性質: **検査の前に対象行を `for update` でロック**（ID 順に固定）、対象ごとの判断時の値を条件に含め、**1 件でも食い違えば全体を 0 行**、一意制約に瞬間的にぶつかる更新は RPC 内で吸収、**入力の自己矛盾は例外** |
| 走査（`by: [system]`） | 要らない | 起こすイベントの operation に同居させる（ARCH-BE-0015）。永続化は上のどれかの RPC を再利用する |

#### RPC が `by` とガードを守る(束 ⑳-3)

**定型 5 形の RPC の本文は、`access_spec` の `creates` / `writes` / `deletes` と `state_spec` の
`by` / `guard` を述語として持つ。** 判断を engine に任せていた頃は、同じ RPC を engine を通らない
経路(複合 RPC の外・管理スクリプト・将来の別クライアント)から呼び出せば素通しで書けた。ADR-0012 ⑤ の
「DB を権威にする」はこの継ぎ目を無くすことであり、**規則の執行点は RPC の本文**である。

- **実行者のロールは引数で渡す。** 定型 RPC は `p_actor_roles text[]` を受け取る —— DB は
  「誰がログインしているか」を知らないからである。渡すのは**セッションから立つロール**
  (`kind` のグローバルロールと `claim` のロール)を `implies` の推移閉包で閉じた集合であり、
  作るのは製品の `operation/shared/actor-roles.ts` の `resolveActorRoles` 1 か所だけである
  (表は生成物の束から来て、解決の本体は `@kaninabe/runtime/template/actor-roles` にある。下の
  「手書きアダプタ」)。
  **文脈ロール(`binding`)は渡さなくてよい** —— 対象の行との関係は DB が行を見て立てる。
- **書けなかった理由は errcode で 3 つに分かれる**(`legacy/spec-tools/lib/sql/refusal-codes.ts` が語の
  1 か所)。`UC403` = ロール違い / `UC409` = 状態違い(判断時の前提が崩れた) / `UC412` = ガード違い。
  **判定の順は engine と同じ 状態 → ロール → ガード**である —— 順が違うと、同じ 1 つの拒否に対して
  先読みと DB が別の理由を返す。
  - **順の正は engine(`canFire` / `canCreate` / `canWrite`)であり、SQL はその写しである。**
    拒否の優先順位はどの宣言からも導けない実装上の選択なので、正を 1 つに決めてある(束 ⑳-3)。
  - **作成・削除・編集には「状態」の段が無い**(engine の `canCreate` / `canWrite` にその段が無い)。
    その位置に入るのは**判断時の前提が崩れたか(競合)**であり、作成ではさらに「同じ id の再送」が
    そこに並ぶ —— 分類は **ロール → 再送 → 競合 → ガード**になる(冪等な再送も `by` が立つ人にだけ
    返す。束 ⑳-3b)。
  - **成立しうるガードを持たない関数は `UC412` を返さない。** ガードが無ければ状態とロールで
    尽きており、残る 0 行は競合だけである(そこで「ガード違反」を返すと、構造上ありえない理由を
    返すことになる)。
- **TS の engine は残る。** 役目は「人に読める理由を DB に行く前に速く返す」先読みであり、
  権威ではない。両者が同じ判定を下すことは差分テスト(`rpc-engine-equivalence`)が実測する。
- **保証**: `rpc_enforces_spec`(guarantees.md)。

**定型 4 形の RPC 本文は生成物である —— 手で書かない。** `data/tables/{table}.md` の `functions` に
`shape`（`transition` / `create` / `update` / `delete`、定型に乗らないなら `composite`）・`also_writes`・
**`migration: {14 桁}_rpc_{関数名}.sql`** を宣言すれば、`npm run generate` が plpgsql をまるごとその
ファイルに書き出す（上の表の「性質」の列が、そのまま生成器の規則である）。統合テスト `rpc-parity` は
「生成した本文が実 DB に当たっているか」を見る。

- **書くのは宣言だけ。** 許可列は access_spec の `writes`、楽観的並行制御は引数の `p_expected_…`、
  監査ログの語彙は操作 ID、副作用は `effects`、空を渡された列の扱いは state_spec の `clears` から決まる。
- **定型なのに本文が生成できないもの**（DSL 外と宣言された不変条件の連鎖を持つ、など）は
  `migration` の代わりに `handwritten: {理由}` を書く。`composite` に降格させない —— 降格すると
  許可列・楽観的並行制御の突合まで一緒に失われる。
- **SQL が変わる仕様変更をしたら `migration` の連番を新しくする**（migration は追記専用の歴史。
  [migrations.md §生成 migration](./migrations.md)）。形式と一意性は T6 が見る。
- 契約の正は [ARCH-SP-BE-0001 §書き込み RPC の形](../../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)。

共通して要るもの（形によらない）:

- 書き込みが**成立した経路でのみ** `domain_events` に追記し、**同一トランザクション**で行う。0 行では追記しない。行数は下の §監査ログへの追記 が正（バルク形だけが 1 対象 1 行）。
- `security definer` + `set search_path = public` + `comment on function` + `revoke all ... from public` → `grant execute ... to service_role`（D16 / D17）。定型 4 形ではこの 4 つも生成物が書く。
- **その集約が `domain_events` に初めて現れるときは `check (entity in (…))` に 1 語足す migration** も要る（足さないと監査ログの INSERT が統合テストで落ちる）。**テーブルが新しいかどうかではない** — 既存のテーブルでも、書き込み経路をこれから作るなら監査ログには初登場になる（実例: `patron` は最初からテーブルがあったが、`update_member` を足すまで `domain_events` に現れなかった）。

**採番**は `supabase/migrations/` の既存の最大値の次を取る（定型 4 形は `functions[].migration` に書いた名前が
そのまま生成先になる）。着手時に確認すること（並行して別の作業が走っていると衝突し、`db reset` が要る）。欠番はそのまま残す。

### 定型 4 手順（作成）

> **実例:** 仕様は `docs/specs/backend/actions/loan/create.md`（`loan.create`。②の照会先が `canCreate` に変わる点、③の永続化が RPC 1 回の INSERT になる点を注釈している）。

新規作成は状態遷移ではないため②の照会先が変わる。**遷移の 4 手順と対になる定型**として、次の順序でのみ書く。

1. **パース**: `app/src/domain/generated/{entity}.schema.ts` の**生成入力スキーマ**（`{entity}InputSchema`）で入力を検証する。`id`（`auto: true`）と `state` は含まれない。
2. **照会**: 実行者（actor）のロールを解決し、`app/src/domain/engine` に**作成可否**を問う（`canCreate`）。判定に使う表は `access_spec` の `creates` から生成された `{entity}.creates.ts` である。`when` のガード評価に必要な文脈（例: `item.state`）は operation が env に載せる。
3. **永続化**: 「初期状態での INSERT」を RPC で原子的に実行する。初期状態は `state_spec` の `initial` であり、アプリ側で指定しない（DB の既定値が持つ）。**不変条件は DB 制約が執行する**（部分ユニーク・容量トリガーは INSERT でも発火する）。
4. **返却**: `Result` を返す。

- **すべきこと:** 拒否は遷移と同じ 3 分類に落とす。権限なし = `forbidden`、`when` 不成立 = `guard_unsatisfied`、重複・貸出可能冊数の超過 = `invariant_violated`。
- **してはいけないこと:** 作成時に `state` を指定する。初期状態の正は `state_spec` の `initial` である。
- **してはいけないこと:** 作成時に outbox へジョブを積む。`effects` は**遷移**に紐づく宣言であり、作成には対応する宣言が仕様側に存在しない（仕様に無い副作用を実装が足さない）。作成通知が要るなら先に `creates[].effects` を仕様に足す判断をする。
- **してはいけないこと:** 「作って即貸出確定」のように作成と遷移を 1 アクションに混ぜる。1 アクション 1 操作は作成でも変わらない。

### 定型 4 手順（削除）

> **実例:** 仕様は `docs/specs/backend/actions/loan/return_item.md`（`loan.return_item`）。

物理削除（`access_spec` の `deletes` / 予約 ID `{entity}.delete`）も状態遷移ではない。**作成の 4 手順と対になる定型**として、次の順序でのみ書く。

1. **パース**: 対象を特定する識別子（`{entity}.id`）だけを検証する。削除に本体のフィールドは要らないので、生成 zod スキーマから `id` の形だけを取り出して使う。
2. **照会**: 対象を 1 件読み、実行者（actor）のロールを解決し、`app/src/domain/engine` に**削除可否**を問う（`canDelete`）。判定に使う表は `access_spec` の `deletes` から生成された `{entity}.deletes.ts` である。`when` のガード評価に必要な文脈（対象自身の状態・親の状態）は operation が env に載せる。
3. **永続化**: DELETE を RPC で原子的に実行する。**0 行 = `conflict`**（判断してから対象が消えた・状態が動いた）として扱い、成功と区別する。
4. **返却**: `Result` を返す。

- **すべきこと:** 対象を読むのは①の後・③の前に 1 回だけ。読んだ状態は②の判断とレポジトリへの条件の両方に使う（楽観的並行制御）。
- **すべきこと:** 拒否は遷移・作成と同じ 3 分類に落とす。権限なし = `forbidden`、`when` 不成立 = `guard_unsatisfied`、参照制約違反 = `invariant_violated`。
- **してはいけないこと:** 論理削除（状態を `deleted` にする・`deleted_at` を立てる）を削除アクションで行う。それは状態遷移であり `canFire` の側の操作である。
- **してはいけないこと:** 削除時に outbox へジョブを積む。`effects` は**遷移**に紐づく宣言であり、削除には対応する宣言が仕様側に存在しない（作成と同じ理由）。
- **してはいけないこと:** 対象が見つからないことをエラー分類の外（throw・独自 kind）で表す。対象の不在は `conflict` と同じ結末として扱う。

### 定型 4 手順（編集・バルク形）

状態を変えないフィールド更新（`access_spec` の `writes` / 予約 ID `{entity}.update`）も状態遷移ではない。**作成・削除の 4 手順と対になる定型**として、次の順序でのみ書く。②の照会先が「そのロールがそのフィールドを、その条件下で更新してよいか」（`canWrite`）に変わるだけで、構造は削除と同じである。

**規約にするのはバルク形（複数行を 1 つのまとまりとして更新する形）だけ**である。編集の実物は現状 `hold.update`（予約順の一括並べ替え）の 1 本だけで、それがバルク形だからである。単行の編集（1 行だけを更新する形）の実物が現れたときに、この節の隣に単行形の節を立てる。**実物のない定型は書かない**（書けば必ず実物とずれる）。

1. **パース**: 対象を特定する識別子（`{entity}.id`）と、更新するフィールドの組の**リスト**を検証する。**制約の正は生成 zod スキーマ**であり、Server Action はそこからフィールドの形を取り出して使う（再定義しない）。
2. **照会**: 対象を**1 回の読み取りでまとめて**取得し、実行者（actor）のロールを解決し、`app/src/domain/engine` に**編集可否**を問う（`canWrite`）。判定に使う表は `access_spec` の `writes` から生成された `{entity}.writes.ts` である。`when` のガード評価に必要な文脈（対象自身の状態・親の状態）は operation が env に載せる。
3. **永続化**: UPDATE を**1 回の RPC** で原子的に実行する。**判断したときに読んだ値を項目ごとの条件に含める**（楽観的並行制御）。**0 行 = `conflict`** として扱い、成功と区別する。
4. **返却**: `Result` を返す。

- **すべきこと:** ②の読み取りは**1 回**にする。1 件ずつ読むと、読んでいる最中の書き込みで判断の前提が項目ごとにずれる（同じ瞬間のスナップショットで判断する）。
- **すべきこと:** ②の照会は**全項目に**適用する。1 件でも許されなければ**全体を拒否**し、**最初に落ちた理由**を返す。部分成功は返さない。
- **すべきこと:** ③は**1 件でも判断時の値と食い違えば全体を 0 行（`conflict`）**にする。途中で失敗したら行も監査ログもまとめて巻き戻る。
- **すべきこと:** RPC は**検査の前に対象行をロックする**（`for update`。ID 順に固定してデッドロックを避ける）。読むだけの検査では、検査を通ってから他人のコミットが割り込み、**判断も検査も通ったのに他人の更新を上書きする**（lost update）。
- **すべきこと:** 監査ログは**1 対象につき 1 行**追記する（「1 回の操作で 1 行」にしない）。単行の記録と形が揃い、集約の履歴が操作の粒度に依存しなくなる。値が変わらない対象も、指定に含まれていれば 1 行残る。
- **すべきこと:** 「その指定がまとまりとして意味を持つか」（空のリスト・同じ対象の重複指定・同じ値の重複指定・対象が複数の親にまたがる）は**入力そのものの不正**（`invalid_input`）として弾く。ドメインの判断（誰が・いつ）に持ち込まない。**RPC 側でも同じ自己矛盾は例外**にする（0 行 = 競合に化けさせると「更新したのに何も起きない」を静かに返すことになる）。
- **すべきこと:** 一意制約に瞬間的にぶつかる更新（番号の交換など）は、**RPC の中で吸収する**（退避値へ逃がしてから最終値を書く 2 段の更新）。**対象外の行とぶつかる指定は本物の不変条件違反**であり、握りつぶさず `invariant_violated` として返す。
- **すべきこと:** 拒否は遷移・作成・削除と同じ 3 分類に落とす。権限なし = `forbidden`、`when` 不成立 = `guard_unsatisfied`、一意制約違反等 = `invariant_violated`。
- **してはいけないこと:** 単行の更新口をバルク形と併存させる。「1 行ずつ動かす」経路が残ると、一意制約を避けるための空き番号運用が実装から復活する。
- **してはいけないこと:** バルクの適用をアプリ側のループ（複数回の RPC 呼び出し）で行う。原子性が失われ、途中失敗が「半分だけ更新された」状態として残る。
- **してはいけないこと:** 状態を動かすフィールド（`state`）を編集アクションで書く。それは遷移であり `canFire` の側の操作である。
- **してはいけないこと:** `writes` に `effects` の宣言が無いのに outbox へジョブを積む。`writes[].effects`（domain-spec-writing.md §access_spec）を宣言していない集約は、作成・削除と同じ理由（仕様側に対応する宣言が無い）で outbox に積んではならない。`hold.update` は現状 `effects` を宣言していないので、この形は対象外のままである。

> **実物(製品側の例。デモには無い):** `hold.update`（予約順の一括並べ替え）。仕様は
> `docs/specs/backend/actions/hold/update.md`、実装は `app/src/operation/hold/update.ts`
> と、元の製品の migration。

### 定型 4 手順（編集・単行 form）

**1 つの対象の、複数のフィールドを同時に更新する形**。編集フォームの送信がこれにあたる。
バルク形と同じく `access_spec` の `writes` / 予約 ID `{entity}.update` を境界に公開するもので、
②の照会先も同じ `canWrite` である。**違うのは「何が複数か」だけ**で、それが手順の各段に効く。

1. **パース**: 対象を特定する識別子（`{entity}.id`）と、更新するフィールドを検証する。
   **更新するフィールドはすべて任意**（送られたものだけを更新する）であり、**1 つも無い呼び出しは
   `invalid_input`** として弾く。制約の正は生成 zod スキーマであり、Server Action はそこから
   フィールドの形を取り出して使う（再定義しない）。
2. **照会**: 対象を**1 回**読み、実行者のロールを解決し、**変更される各フィールドについて**
   `canWrite` を問う。1 つでも許されなければ**全体を拒否**し、**最初に落ちた理由**を返す。
   **送られなかったフィールドは照会しない**（変更しないものに可否は無い）。
3. **永続化**: UPDATE を**1 回の RPC** で行う。**判断したときに読んだ状態を条件に含める**
   （楽観的並行制御）。**0 行 = `conflict`**。状態列を持たない集約での読み替えは
   §状態列を持たない集約の単行 form が正。
4. **返却**: `Result` を返す。

- **すべきこと:** 変更集合の**鍵は `entity_spec` のフィールド名**にする。その名前がそのまま
  `canWrite` の照会対象（`writes[].fields`）と DB の列名になる。実装が別名（camelCase 等）を
  発明すると、照会と書き込みの間に対応表がもう 1 つできる（PRIN-0008）。
- **すべきこと:** 「送っていない」を `undefined`（鍵が無い）、「空にする」を `null` で表す。
  同じ形に潰すと、任意フィールドを空にする操作が表現できなくなる。
- **すべきこと:** 状態ごとにアクションを分けない。`writes` の行が状態で切り替わっても
  操作は 1 つであり、どの状態でどれを書けるかを知っているのは**エンジンだけ**である。
  分ければその知識が仕様から実装（境界）へ移る。
- **すべきこと:** RPC が書き換えられる列を `writes` に現れるものに限る（**第二防衛線**）。
  第一防衛線はエンジンの照会であり、宣言に無いフィールドはそこで `forbidden` になる。
  RPC 側で黙って無視すると「更新したのに何も起きない」を静かに返すことになるので、
  **宣言外の列と空の変更集合は例外**にする（バルク形の「自己矛盾は例外」と同じ理由）。
- **すべきこと:** 監査ログは 1 行、`payload` に**変更したフィールドの新しい値**を載せる。
  旧値は直前の `domain_events` 行から辿れるので二重に持たない。
- **してはいけないこと:** 「許されたフィールドだけ書く」部分適用。送った側から見て、
  一部だけ反映された結果は成功とも失敗とも読めない。
- **してはいけないこと:** 状態（`state`）を編集アクションで書く。バルク形と同じ。
- **すべきこと（`writes[].effects` を宣言している集約のみ）:** ②の照会（`canWrite`）が
  返した規則のうち `effects` を宣言していたものを、変更されたフィールドの並び順で重複無く
  集め、③の RPC に `p_effects` として渡す（**候補**であり、積む・積まないの判定は RPC が
  同一トランザクションで行う——宣言列の値が実際に変わった行に対してだけ積む）。実物は
  `patron.update`（`account_owner` 規則の `effects: [refresh_session_profile]`）。
- **してはいけないこと:** `writes` に `effects` の宣言が無いのに outbox へジョブを積む。
  バルク形と同じ理由（仕様側に対応する宣言が無い）。

#### バルク形との差分

| | 編集（バルク形） | 編集（単行 form） |
|---|---|---|
| 何が複数か | **対象**（N 行 × 1 フィールド） | **フィールド**（1 行 × N フィールド） |
| ②の読み取り | 全対象を**1 回の問い合わせ**で読む | 対象 1 件を読む |
| ②の照会 | **全対象**に適用（フィールドは固定） | **変更される全フィールド**に適用（対象は固定） |
| 部分適用 | しない（1 件でも拒否なら全体を拒否） | しない（1 つでも拒否なら全体を拒否） |
| 楽観的並行制御 | 対象ごとの**判断時の値**（例: 予約順） | 対象の**判断時の状態** |
| 入力の自己矛盾 | 空のリスト・重複指定・複数の親にまたがる指定 | 空の変更集合・宣言外の列 |
| 監査ログ | **1 対象につき 1 行** | 1 行 |
| ロック | 検査を `for update` 越しに行う（検査と書き込みが別の文） | 不要（**UPDATE 文自身が条件を持つ**） |
| 不変条件 | 一意制約に瞬間的にぶつかる更新を RPC 内で吸収 | 1 行の中の関係（`check`）が破れうる。握りつぶさず返す |

**ロックの行が両者の一番深い違いである。** バルク形は「検査してから書く」ので、検査と書き込みの
間に他人のコミットが割り込む余地があり、`for update` が要る。単行形は UPDATE 文自身が
`where state = {判断時の状態}` を持つため、割り込みは 0 行更新（`conflict`）として現れる
（遷移・削除と同じ性質）。

> **実物:** `loan.update`（貸出の編集）と `item.update`（蔵書の編集）。仕様は
> `docs/specs/backend/actions/{loan,item}/update.md`、実装は
> `app/src/operation/{loan,item}/update.ts` と
> 元の製品の migration。

#### 状態列を持たない集約の単行 form

**単行 form の定型は「状態機械を持つ集約」を暗黙の前提にしていた。** 状態を持たない集約
（実物: `patron`。プロフィールだけを持ち `state_spec` が無い）に当てると、条件にできる
「判断時の状態」がそもそも無い。**そこだけを次のように読み替える。他の段は 1 つも変わらない。**

| 段 | 状態を持つ集約 | 状態列を持たない集約 |
|---|---|---|
| ③の UPDATE の条件 | `where id = … and state = p_expected_state` | `where id = …` **だけ**（`p_expected_state` を引数に持たない） |
| 0 行の意味 | 判断時から状態が動いた／対象が消えた | **対象が消えた**だけ |
| 何を守っているか | 「判断してから書くまでに前提（状態）が動いていないこと」 | 「判断してから書くまでに**対象がまだ在ること**」 |
| 拒否の `reason` | `conflict: state changed after the decision` | `conflict: the target disappeared after the decision` |

- **すべきこと:** 拒否の `reason`（定型の `conflictReason`）で**何が崩れたのかを示す**。
  `ActionError` の `blockedBy` は `state` / `guard` の 2 値しか無く、この拒否はそのどちらでもない。
  いまは `state` に寄せてあるので、**`reason` が「状態が動いた」と書くと嘘になる**
  （語彙を増やすかは `blockedBy` の 2 値問題としてバックログにある）。
- **してはいけないこと:** 守る前提が無いからといって条件を「本人であること」に差し替える
  （例: `and id = p_actor_id`）。**誰が編集してよいかは `access_spec` の `writes` が正**であり、
  判断は呼び出し側の照会が済ませている。DB に写すと同じ条件が 2 か所に住み、権限の拒否が
  0 行（競合）と区別できなくなる（`update_loan` が `patron_id` を、`update_item` が
  `librarian_id` を条件にしていないのと同じ判断である）。
- **してはいけないこと:** 「OCC が効かないから」と楽観的並行制御そのものを諦めた形（0 行を成功に
  丸める）にする。編集窓の競合（後勝ち）は 3 例に共通の既知の制限だが、**対象の消滅を
  成功と区別すること**は状態の有無に関係なく守る。

> **実物(製品側の例。デモには無い):** `patron.update`。仕様は `docs/specs/backend/actions/patron/update.md`、実装は
> `app/src/operation/patron/update.ts` と、元の製品の migration。

### 実行者（actor）の解決

- **すべきこと:** 認証済みユーザーの取得は composition 経由で行い、`actor` として operation に渡す。未ログインは `anonymous` ロールとして明示的に扱う（暗黙のエラーにしない）。
- **してはいけないこと:** クライアントから渡された ID を実行者として信用する。actor はサーバー側のセッションからのみ導く（PRIN-0009）。

#### 拒否に載せるロールは「判断に使った解決結果」から作る

- **すべきこと:** `ActionError` の `forbidden` に載せる `role` は、**その判断で `canFire` / `canCreate` / `canDelete` / `canWrite` に渡したロールの解決結果**（定型の `actorRoles`）から作る。載せるのはその**先頭**＝グローバルロールである（`resolveActorRoles` が先頭に必ず置く）。
- **してはいけないこと:** 実行者ID（`actorId`）から作り直す（`globalRole(actorId)`）。**`roles.md` のグローバルロールは 3 つ（`anonymous` / `patron` / `system`）あるのに、実行者IDから見分けられるのは前 2 つだけ**である。system 経路（Cron・ワーカー）の実行者IDも `null` なので、**その拒否がすべて `anonymous` として記録される** —— 監査から見て「誰として拒否されたか」が嘘になる。
- **すべきこと:** 定型の `actorRoles` は、**事実が読めなかった場合（`facts` が `null`）にも答える**。拒否の入口は 2 つ（対象が読めない / エンジンが `role_forbidden` を返す）あり、片方が答えられないとそこだけ推測に戻る。事実が無ければ binding は 1 つも成立しないので、答えはグローバルロールだけになる（`resolveActorRoles(actorId, { patron: facts?.loan.patronId })` と書けばそうなる）。
- **執行:** 解決結果の型 `ActorRoles`（`readonly [string, ...string[]]`）が空でないことを tsc が保証するので、「解決できなかったら何を載せるか」という分岐は実装に現れない。振る舞いは `src/operation/__tests__/_template/transition.test.ts`（system 起点の 2 つの拒否入口）と `__tests__/item/close_window.test.ts` が固定する。
- **注（バルク形）:** 対象が 1 件も読めない拒否は `loadTargets` の `rejected` として**操作自身**が組み立てる（定型を通らない）。そこは binding を解決する材料が無いのでグローバルロールと一致する。**system 起点のバルク形の実物が現れたら**、単行 4 形と同じ「解決結果から作る」口を定型に用意すること。

### 手書きアダプタ(生成物でない、形の決まった 1 本)

**定義**: 仕組み側の口(`@kaninabe/runtime` の関数)と製品側の宣言(生成物)を結ぶだけで、**仕様によって
1 文字も変わらない**ファイルを手書きアダプタと呼ぶ。実例は `operation/shared/actor-roles.ts`
(ロール解決の表を束ねる)と `infrastructure/supabase/client.ts` の `rpcSourceOf` / `rowSourceOf`
(接続層をポートの型に合わせる)である。

**なぜ生成物にしないのか。** 生成物は**置き場ごとに生成される**ので、層を跨いで「あちらの層の
関数をこちらの層で束ねる」形が書けない。ロール解決がその例である —— 表は生成物として
`domain/generated/` に出るが、束ねる相手(`resolveActorRolesWith`)はパッケージの **operation 層**
の住人であり、束を生成物の側で結ぶと「domain がパッケージの operation を import する」向きが
生まれて依存ゼロの純粋層という domain の約束が破れる(境界の B8 が落とす)。**結ぶ場所は呼ぶ側の
層**であり、そこに置くファイルが手書きアダプタである。

**見分け方と約束**: ①中身が仕様に依らない(集約を 1 つも名指さない) ②結ぶ以外のことをしない
(判断・分岐・既定値を持たない) ③JSDoc に「なぜ生成物でないか」を書く。3 つを満たさないものは
生成物にするか、手で書く操作(`runner: manual`)として宣言する。

### フォームと Server Action は同じ導出スキーマを使う

画面フォームと、そのフォームが発火する Server Action は、**同じ 1 つの入力スキーマを見る**。ここを共有しないと、画面には「制約を書き写す（二重管理）」か「検証しないで送る（送信するまで分からない）」の二択しか残らない。

- **すべきこと:** 生成 zod スキーマからの導出（`omit` / `pick` / `shape` からの借用）を `app/src/domain/inputs/{entity}.ts` に置き、フォームと Server Action の両方がそこを import する。

| 置き場所 | 中身 | 使う側 |
|---------|------|--------|
| `app/src/domain/generated/{entity}.schema.ts` | 制約の正（`entity_spec` からの生成物。手で触らない） | 下の導出だけ |
| `app/src/domain/inputs/{entity}.ts` | 導出（`loanCreateInputSchema = loanInputSchema.omit({ patron_id: true })`）と、フォーム用の口（`formOf(...)`） | Server Action / 画面フォーム |
| `@kaninabe/runtime/form` | HTML の形 ⇔ スキーマの形の変換規則と、属性の導出（隣の `form-plan.ts` / `form-datetime.ts` / `form-changes.ts` は行数の都合で分けた同じ口の一部） | 上の口の実装 |

- **`src/domain` に置く理由:** Server Action（`src/app/_actions/`）とクライアントコンポーネントの**両方が import してよい層はここだけ**である（ARCH-BE-0001 の依存方向）。生成物は手で編集できないので、導出はその隣に置く。
- **すべきこと:** HTML の属性（`required` / `maxLength` / `min` / `max` / `step` / `numeric` / `datetime`）は口から導く（`fields.title.maxLength`）。画面に数値を直接書かない。`step` は整数のスキーマなら `1`、小数を許す数値なら `'any'` になる — **明示しないと、整数しか受け付けないスキーマにブラウザが小数を通し、クライアントは通すのにサーバーが落とす**という非対称が残る。
- **すべきこと:** 送信前の検証は口の `parse` で行い、結果を `invalid_input` としてそのまま表示する（`FieldIssue` の形は Server Action の戻り値と同じ）。
- **すべきこと:** **並ぶ入力欄が実行時に変わるフォーム**（編集フォーム。並ぶ集合が `writes` × 対象の状態で決まる）は、口の `parseField` で**フィールドごとに**検証する。オブジェクト全体を 1 度に検証すると、**並んでいないフィールドが「未入力」として落ちる**。変換規則（空文字の写し方・数値化）は `parse` と同じものが使われるので、規則の置き場は口 1 つのままである。
- **すべきこと:** 編集フォームは**行のスキーマ**（`{entity}RowSchema`）から導く。作成入力の任意フィールドは `optional`（キーが無い＝未入力）だが、編集では `nullable`（`null`＝空にする）でなければ、一度入れた値を消せない。
- **すべきこと:** どの入力欄を並べるかは**生成された `writes` の表**から導く（`@kaninabe/runtime/preflight` の `writableFields`）。画面がフィールド名を並べ直すと、仕様に 1 行足しても画面だけが古い集合を持つ。フィールドの**表示名**だけは画面が持つ（仕様に置き場が無い。screen-spec-writing.md の既知の穴）。
- **変換規則は口の中に 1 つだけ持つ**（画面ごとに書かない）。HTML の入力欄は常に文字列を返すため、次の 3 つを口が行う。
  1. **空文字は「未入力」**として、スキーマの宣言どおりの形に写す。`nullable` のフィールドは `null`、それ以外は**キーごと落とす**（任意フィールドは「無し」として通り、必須フィールドは zod が未入力として落とす）。`optional`（キーが無い）と `nullable`（値が `null`）は別物であり、同じ形に潰すと片方で必ず検証が食い違う。`''` のまま送ると「入力していない」と「空で入力した」が区別できなくなる。
  2. **数値のフィールドは `Number` に変換する**。規則 1 が先に効くので、空欄が `Number('') === 0` になって「下限違反（`too_small`）」に化けることはない。数値にならない文字列は `NaN` になり、zod が型の不一致として落とす。
  3. **日時のフィールドはローカル時刻として読み、ISO 8601（UTC）に正規化する**。`datetime-local` の入力欄が返すのはタイムゾーンを持たない文字列（`2026-04-01T10:00`）で、生成スキーマ（`z.iso.datetime({ offset: true })`）はこれを必ず落とす。この規則が無いと**利用者が ISO 文字列を手で打つ**ことになる。すでにオフセットを持つ値（`…+09:00` / `…Z`）は瞬間が確定しているのでそのまま通し、日時として読めない値も変換せずに zod へ渡す（口が独自のエラーを組み立てない）。

##### 日時のタイムゾーンと精度（フレームワークの決め）

- **すべきこと:** 入力欄の値は**実行環境（＝フォームのあるブラウザ）のローカルタイムゾーンの壁時計**として解釈し、UTC の ISO 8601 に正規化して渡す。表示（`toInputValue`）はその逆にローカルへ戻す。利用者が画面で見ている時刻と入力した時刻が一致する、という以上の意味は持たせない。
- **してはいけないこと:** 特定の地域のタイムゾーンを実装に書く（「このアプリは日本時間だから JST」）。それは利用プロジェクトの都合であり、フレームワークが持てる根拠ではない。地域を固定する必要が出たら、それは `entity_spec` 側に現れるべき宣言である。
- **精度は分**である（`datetime-local` の既定の粒度）。**触っていないフィールドは送られない**ので（下の「変更した欄だけを送る」）、**保存値の秒はそのまま保たれる**。分精度になるのは**編集した**日時フィールドだけで、それは入力欄の粒度そのものである（丸めたことにしているのではない）。秒まで編集させたいフィールドが現れたら、精度を `entity_spec` 側で宣言する話になる。
- **存在しない日時は変換せず zod に落とす。** `new Date('2026-02-30T10:00')` は失敗せず 3 月 2 日に**繰り上がる**ので、変換結果を入力欄の表記に戻して照合し、書かれたものと違う日時なら変換しない。夏時間で**飛んだ 1 時間**（春の切り替え）も同じ扱いになる —— 1 時間ずらして黙って通すより、落として書き直させるほうが正しい（**二度ある壁時計**＝秋の切り替えは、どちらの瞬間を指すかを処理系が選ぶだけで、表記は往復する）。
- **すべきこと:** 表示（スキーマの形 → 入力欄の文字列）も口の `toInputValue` を通す。`null` の空欄化・数値の文字列化・日時の表記のいずれも、画面が書けば送信側の規則とずれる。**往復（表示 → 編集 → 送信 → 再表示）で値が変わらない**ことは口の側のテストが固定している（`app/src/domain/__tests__/form.test.ts`）。
- **すべきこと:** 往復のテストは**零オフセットでないタイムゾーンで実行する**（`app/vitest.config.mts` の `env.TZ`）。UTC では「ローカル壁時計として読む」と「UTC として読む」が同じ結果になるため、**変換の向きの誤りが 1 件も落ちない**（CI ランナーの既定が UTC であることに気づかないと、この規約は緑のまま守られていない状態になる）。
- 入力欄の `type` は属性から導く（`numeric` → `number` / `datetime` → `datetime-local` / それ以外 → `text`）。画面がフィールド名で分岐しない。
- **すべきこと（変更した欄だけを送る）:** 編集フォームが送るのは**初期値から実際に値が変わった欄だけ**である（`changedFields`。比較するのは入力欄の**文字列そのもの**で、スキーマの形に直す前）。**「初期値」は編集を始めたときの値（`baseline`）であり、`router.refresh()` で届いた最新の props ではない** — 最新の props を初期値にすると、他の人の更新が届いたとき触っていない欄が「変更あり」になり、旧い値を再送して他の人の変更を上書きし、監査ログの `payload` にも混ざる。生成物は入力を `baseline` / `values` の 2 層で持ち、最新を毎レンダー `reconcileFormDraft`（`@kaninabe/runtime/form-refresh`）で取り込む（触っていない欄は最新に追従・触った欄は手元を守る・両方が変えた欄は競合として「最新を取る / 自分の値で上書き」を出し、競合が残る間は保存できない。成功のあとは送った値を `baseline` に進める — 実行器は `onSuccess` → `refresh()` の順）。これは画面が最新を受け取った範囲の保証で、**サーバーは列ごとの期待値の比較を持たない**（DB の同時更新の制御ではない）。変更が 1 つも無いときは送信ボタンを押せなくする。並んでいる欄を毎回すべて送ると 3 つ壊れる。
  1. **単行 form の部分更新が UI から一度も起こらない**（規約が要求している形が実物では実現していない状態になる）。
  2. **監査ログに起きていない変更が残る**。`payload` は「変更したフィールドの新しい値」のはずが「そのとき画面に出ていた全部」になり、履歴から「何を直したのか」が読めなくなる。
  3. **触っていない値が書き換わる**。日時は入力欄の粒度（分）で往復するので、**送るたびに保存値の秒が 0 になる**。秒はガードの時刻比較（`now >= loan.due_at`）に効くので、これは表示だけの話ではない。
- **してはいけないこと:** 画面側で制約を書き写す（`maxLength={100}`）。口を通さずにフォームの値を Server Action に渡す。**クライアントで検証したことを理由にサーバー側の検証を省く**（クライアントの検証は UX であって関門ではない。PRIN-0009）。
- **してはいけないこと:** 導出の中に制約を足す（`z.string().max(50)` と書き直す）。制約を変えたいなら `entity_spec` を直す（PRIN-0001）。

> **実物:** `loan.create`。導出は `app/src/domain/inputs/loan.ts`、口の実装は `@kaninabe/runtime/form`、使う側は `app/src/app/_actions/loan/create.ts` と `app/src/app/items/[id]/_components/loan-create-form.tsx`。

### 戻り値の型

- **すべきこと:** すべてのアクションは `Result` を返す。型は `@kaninabe/runtime/result` に 1 組だけ定義し、全アクションで共用する（PRIN-0007）。

```ts
// framework/runtime/src/domain/result.ts（抜粋・形の定義）
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** 入力そのものの不正。生成 zod スキーマ由来のフィールド単位の指摘 */
export type FieldIssue = { readonly field: string; readonly code: FieldIssueCode };

/** code の語彙は閉じている。出典は zod と、下の「実装が出す 2 語」だけ */
export type FieldIssueCode = z.core.$ZodIssueCode | 'empty' | 'inconsistent';

/** ドメイン上の拒否 3 分類 + 入力検証。分類の意味は ARCH-BE-0013 を正とする */
export type ActionError =
  | { readonly kind: 'invalid_input'; readonly issues: readonly FieldIssue[] }
  | { readonly kind: 'guard_unsatisfied'; readonly event: string; readonly blockedBy: 'state' | 'guard'; readonly reason: string }
  | { readonly kind: 'forbidden'; readonly event: string; readonly role: string }
  | { readonly kind: 'invariant_violated'; readonly invariant: string };

export type ActionResult<T> = Result<T, ActionError>;
```

- `event` はドメインイベント ID（`loan.check_out`）、`invariant` は不変条件 ID（`INV-LOAN-001`）、`role` は実行者に解決されたロール ID を入れる。**いずれも仕様に実在する ID**であり、実装が発明した文字列を入れない（PRIN-0008）。
- `reason` はエンジンが仕様から返す理由文（`otherwise_forbidden` の文言、またはガード式の日本語化）である。**Server Action が独自の文言を組み立てない**。
- 例外は **DB が判定する回数・間隔の制限の拒否**だけで（点検 17 回目。ARCH-BE-0013）、`reason` は DB が返した製品の閉じた表の語、時刻で解ける制限は任意の欄 `retryAt`（次に通る見込みの時刻。ISO 8601）が付く。画面の専用の文言は表の語に当たったときだけ出し、表の外の語は汎用の表示に任せる。
- **してはいけないこと:** ドメイン上の拒否を throw する。`ActionError` に該当しない失敗種別を勝手に追加する（追加が必要なら ARCH-BE-0013 を先に更新する）。
- **してはいけないこと:** 例外を握りつぶして `ok: false` に変換する。想定外の失敗（DB 接続断等）は throw のままにする。受けるのは生成した Server Action の記録（`temporarily_unavailable` で 1 行記録して投げ直す）と画面の実行器（`runAction` が `temporarily_unavailable` に読み替えて `pending` から戻す）で、エラー境界ではない（ARCH-BE-0013。点検 19 回目 B19-1）。`temporarily_unavailable` は業務の拒否ではなく、仕様の ID を持たない固定の種類である。

#### `FieldIssue.code` の語彙（値域）

`event` / `invariant` / `role` の出どころは仕様（実在するID）だが、**`code` にだけは出どころが無かった** —— zod 由来のコードと、実装がその場で発明した文字列（`multiple_items`）が混ざっていた。語彙は次のように閉じる。

- **すべきこと:** `code` の出どころは 2 つだけにする。①**zod が出すコード**（`z.core.$ZodIssueCode` を**型として借りる**。11 語を書き写さない。PRIN-0007）②**実装が出すコード**（`empty` / `inconsistent` の 2 語）。ユニオンなので、思いつきの文字列は tsc が落とす（enforcement-matrix の R1）。
- **すべきこと:** 実装が出す語は**集約に依存しない形**にする。`empty` = 送られた集合が空、`inconsistent` = 集合としてまとまりを持たない（別々の親にまたがる指定・両立しない値の組）。**どこの話かは `field` が示す**（`items` / `changes`）。
- **してはいけないこと:** 集約固有の語（`multiple_items`）をコードにする。`FieldIssue` は全アクション共用の型なので、集約の語を混ぜると**ユニオンが集約の数だけ伸び**、語彙の正がまた無くなる。
- **語彙を仕様側（`entity_spec` / `action_spec`）に持たせて生成する案は採らない。** 実装発のコードは現状 2 語で、どちらも「入力の**形**」の話であり、仕様に書くべき業務の語ではない（業務の語は `event` / `invariant` / `role` として既に仕様のIDで現れている）。**語が増えて「どの矛盾か」を画面で区別する必要が出たら**、そのとき仕様側へ移すことを検討する（＝いまは実例が足りないので決めない）。
- **してはいけないこと:** `code` を UI の文言として使う。表示文言は UI の責務であり、`code` は分類である（`ActionErrorView` はコードをそのまま出す暫定表示にすぎない）。

### 読み取り

- **すべきこと:** 読み取りは RSC から composition のクエリ関数（`app/src/composition/{aggregate}/queries.ts`）を呼ぶ。**書き方の正は [queries.md](./queries.md)**（構造は ARCH-BE-0016）。
- **すべきこと:** 読み取りは JWT 付きクライアント（RLS 有効経路）で行う。可視性を執行するのは RLS であり、アプリ側の絞り込みではない。
- **してはいけないこと:** 読み取り専用の操作を Server Action にする。クライアントコンポーネントから DB にアクセスする。`useEffect` でデータ取得する。

### 副作用の宣言

- **すべきこと:** 積むジョブの `type` は `state_spec` の `effects[].do`、または `access_spec` の `writes[].effects`（状態遷移を持たない編集の発火元。domain-spec-writing.md §access_spec）の ID と一致させる。
- **してはいけないこと:** 仕様に無い副作用（通知・外部呼び出し）をアクションから直接実行する。

### 監査ログへの追記

- **すべきこと:** 全書き込み RPC（遷移・作成・編集・削除）は、書き込みが成立した経路でのみ `domain_events` に 1 行追記する。追記は**書き込みと同一トランザクション**で行う。0 行更新（競合）の経路では追記しない。
- **すべきこと:** 追記のもとになる値は、呼び出し側が指定できない場所から取る。イベントIDは遷移ならエンジンの許可（`transitionOf(decision).event`）から、作成・編集・削除なら RPC 内の固定文字列から入れる。実行者（`actor_id`）だけは呼び出し側が渡し、`null` は system（Cron・ワーカー）を意味する。
- **してはいけないこと:** 追記をアプリ側のフック（Server Action や operation での後追いの書き込み）で行う。別トランザクションに出た瞬間、「状態は動いたがログが無い」が起こりうる。
- **してはいけないこと:** 読み取りの正としてこのログを使う。**状態が正であり、ログは監査用の副産物である**。現在の状態は常に集約のテーブルから読む。
- 追記漏れは**統合テストで検出する**（`app/src/infrastructure/__tests__/audit/`）。書き込み RPC を足したら、監査ログに 1 行残ることと競合時に残らないことを同じ粒度で足す。

## 3. 注意点・例外

- **4 手順のうち不要なものがある場合**（例: `effects` が無いイベント）は、単に省略してよい。ただし `action_spec` を読めば省略が妥当だと分かること（`effects` が仕様側に無い、等）。仕様に理由が現れない省略はしない。
- **編集の定型は 2 つある（バルク形・単行 form）。**Phase C-6 第 3 波で単行の実物（`loan.update` / `item.update`）が現れたので、約束どおりバルク形の隣に節を立てた。同時に未定だった**②複数フィールドを同時に更新する編集**も決着した——**変更される各フィールドについて照会し、1 つでも拒否されたら全体を拒否する**（バルク形が対象について言っていることと同じ形にした）。残っている未定は**編集窓の競合**（画面が読んだ時点の値を `expected` にするか）だけで、これは `input` の記法の判断とセットでバックログにある。
- **エンジンが未実装の時点**でも、この形を先に守る。判定を `if` で書いて後から差し替える進め方は取らない（差し替え漏れが構造的な乖離になるため）。

## 4. 関連ドキュメント

- [ARCH-BE-0013 — Server Action の構造](../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)（構造・4 手順・エラー分類の正）
- [ARCH-BE-0001 — app パッケージの層構成と依存方向](../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)
- [ARCH-BE-0015 — 非同期ジョブ実行基盤](../../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)（outbox に積む側の規約）
- [action-spec-writing.md](../../../specification/standards/action-spec-writing.md)（対応する仕様の書き方）
- [testing/](./testing/README.md)（テスト規約）
