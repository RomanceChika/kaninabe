---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0002, PRIN-0007, PRIN-0008, ARCH-BE-0001, ARCH-BE-0013]
decisions: [ADR-0004]
---

# 配置 ⇔ 命名の一致の機械執行

ドメインイベント ID から、実装ファイルの場所と export 名が**一意に決まる**状態を保つ。対応表の **P1〜P4** の詳細。

## 目的・スコープ

- **目的:** 「この仕様はどこに実装されているか」「この関数はどの仕様のものか」を、対応表や検索の工夫なしに往復できる状態を維持する（PRIN-0008）。
- **スコープ:** `app/src/app/_actions/**` と `app/src/operation/**`。テスト（`src/**/*.test.ts(x)`）とテスト支援コード（`src/**/__tests__/**`）は対象外。
- **正の所在:** 変換規則の定義は [server-actions.md「配置と命名」](../server-actions.md)。本文書はその**機械執行の内容**（何が検出され、何が検出されないか）を書く。

## 前提となる考え方

### ID からの変換規則

ドメインイベント ID `{aggregate}.{event}`（いずれも仕様どおりの snake_case）から、次の 4 つが機械的に導かれる。

| 仕様 | 実装ファイル | export 名 |
|---|---|---|
| `docs/specs/backend/actions/loan/check_out.md` | `app/src/app/_actions/loan/check_out.ts` | `checkOutLoanAction` |
| 同上（業務手順側） | `app/src/operation/loan/check_out.ts` | `checkOutLoan` |
| `docs/specs/backend/actions/hold/prepare.md` | `app/src/app/_actions/hold/prepare.ts` | `prepareHoldAction` |
| 同上（業務手順側） | `app/src/operation/hold/prepare.ts` | `prepareHold` |

- **Server Action:** `{camel(event)}{Pascal(aggregate)}Action`
- **operation:** `{camel(event)}{Pascal(aggregate)}`
- 変換は `_` 区切りの単純な case 変換（`check_out` → `checkOut`、`hold` → `Hold`）。特別扱いする語（略語の大文字化など）は無い。

## ルール

### Server Action の配置（P1）

- **すべきこと:** `src/app/_actions/{aggregate}/{event}.ts` に置く。**この深さちょうど**（集約ディレクトリ 1 階層 + ファイル 1 つ）。
- **してはいけないこと:** `_actions/` 直下に置く、3 階層以上にネストする、集約名やイベント名に snake_case 以外（キャメルケース・ハイフン）を使う。
- **執行者:** ローカルルール `layer/action-naming`（`badPath`）。

### Server Action の export 名（P2）

- **すべきこと:** `{camel(event)}{Pascal(aggregate)}Action` という名前の export を持つ。
- **執行者:** `layer/action-naming`（`missingExport`）。違反時は期待名と現在の export 一覧が両方報告される。

### operation の配置（P3）

- **すべきこと:** ドメインイベントに対応する業務手順は `src/operation/{aggregate}/{event}.ts` に置く。
- **対象外（検査されない）:** `src/operation/` **直下**のファイル（`src/operation/ports.ts` など横断的なモジュール）と、**仕組みの土台ディレクトリ**の配下、集約直下の**補助ファイル**（`ports.ts`。IF 宣言）。
  - **一覧はリンターに持たない。正は 1 つの宣言**（置き場の配置が宣言する層と土台の表 = アプリの枠の後段の値の `source-root` の `structure`。値は `legacy/spec-tools/lib/targets/nextjs/layout.ts`、引き口は `lib/model/framework-base-dirs.ts`。層の 4 名だけがコアの語で `lib/model/framework-dirs.ts`）であり、`layer/operation-naming` はその生成物（`app/src/domain/generated/framework-structure.json`）を読む。同じ事実を X1（infrastructure の閉世界）・A11（operation の閉世界）・W1（語彙漏れの走査範囲）・ESLint の生成物グロブ・構造テストも**そこから引く**（束⑯g。それまで 6 か所が別々に持っていた）。
  - 現在の土台（operation 層）: `_template/`（5 形の定型そのもの。どの操作でも同じ段取りであって特定のドメインイベントの実装ではないため、イベント ID からの命名導出が成り立たない。先頭の `_` は集約名（snake_case）と衝突しない印である）・`shared/`（集約横断の共有物）・`jobs/`（非同期ジョブの実行基盤。[ARCH-BE-0015](../../../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)。`jobs` は `access_spec` を持たない内部の台帳であって集約ではない）・`usecase/`（保存点の不変条件 hooks。ユースケース名と保存点 ID から名前を導く）・`__tests__/`（テスト支援）。
- **注:** 読み取りの `queries.ts` は **operation 配下には置かない**（読み取りは operation を経由しない。[ARCH-BE-0016](../../../../../../architecture/system/backend/ARCH-BE-0016-read-path.md)）。`src/operation/{aggregate}/queries.ts` を作ると、`queries` をイベント名とみなした検査に落ちる。これは意図した挙動であり、置き場所の誤りを早く知らせるためのもの。
- **してはいけないこと:** 集約ディレクトリの下をさらにネストする（`src/operation/loan/commands/check_out.ts` は `badPath`）。
- **執行者:** `layer/operation-naming`（`badPath`）。

### operation の export 名（P4）

- **すべきこと:** `{camel(event)}{Pascal(aggregate)}` という名前の export を持つ。
- **執行者:** `layer/operation-naming`（`missingExport`）。

### なぜ機械に守らせるのか

配置と命名の規約は、**破っても動く**。動くので、レビューで見落とされたまま入り、時間が経つと元に戻せない量になる。そして壊れたときに失われるのは、次の 2 つである。

1. **仕様 → 実装の到達性。** `action_spec` の ID からファイルパスを導けなくなり、「この仕様は実装されているのか」を確かめる手段が全文検索しか無くなる。
2. **実装 → 仕様の到達性。** `checkOutLoanAction` を読んでいる人が、対応する仕様に戻れなくなる。

生成器が扱っているのは `src/domain/generated/` までであり（ADR-0004 / ADR-0006）、Server Action と operation の骨組みは手で書く。**生成物ではないが仕様から一意に決まる**この領域を、人の注意力ではなくリンターに守らせるのがこのルールの位置づけである（PRIN-0001 / PRIN-0008）。

## コード例

### この例が示すルール: パスと export 名を仕様から導く（P1・P2）

✅ 正しい

```ts
// app/src/app/_actions/hold/prepare.ts
// 仕様: docs/specs/backend/actions/hold/prepare.md（ドメインイベント hold.prepare）
'use server';
import { getHoldInteractor } from '@/composition';
import type { ActionResult } from '@kaninabe/runtime/result';

/** 予約の本を取り置く（ドメインイベント hold.prepare）。 */
export async function prepareHoldAction(formData: FormData): Promise<ActionResult<void>> {
  const { prepareHold } = await getHoldInteractor();
  return prepareHold({ holdId: String(formData.get('holdId')) });
}
```

❌ 間違い（配置）

```text
app/src/app/_actions/prepareHold.ts                 ← 集約ディレクトリが無い、かつ camelCase
app/src/app/_actions/hold/queue/prepare.ts      ← 3 階層
app/src/app/_actions/loan/check-out.ts      ← ハイフン（snake_case ではない）
```

いずれも ESLint の `layer/action-naming` で検出される（`badPath`:「Server Action は src/app/\_actions/{aggregate}/{event}.ts に置くこと…」）。

❌ 間違い（export 名）

```ts
// app/src/app/_actions/hold/prepare.ts
'use server';

/** 予約の本を取り置く。 */
export async function prepare(formData: FormData) { /* … */ }
```

これは ESLint の `layer/action-naming` で検出される（`missingExport`:「このファイルは `prepareHoldAction` という export を持つこと（ドメインイベント hold.prepare から機械的に導く名前）。現在の export: prepare」）。

**ポイント:** 期待名は**パスから計算される**ので、ファイルを別の集約に移せば期待名も変わる。移動と改名がセットで強制されるため、「移したが名前は昔のまま」という状態が残らない。

### この例が示すルール: operation 側も同じ規則で対になる（P3・P4）

✅ 正しい

```ts
// app/src/operation/loan/check_out.ts
import { transitionOperation } from '../_template/transition';

/** 貸出を確定する（ドメインイベント loan.check_out）。 */
export const checkOutLoan: (
  deps: SubmitLoanDeps,
  command: SubmitLoanCommand,
) => Promise<ActionResult<SubmitLoanResult>> = transitionOperation({ /* … */ });
```

❌ 間違い

```ts
// app/src/operation/loan/check_out.ts
/** 貸出を確定する。 */
export const checkOut = transitionOperation({ /* … */ });
```

これは ESLint の `layer/operation-naming` で検出される（`missingExport`。期待名は `checkOutLoan`）。

**ポイント:** `checkOutLoanAction` → `checkOutLoan` → `docs/specs/backend/actions/loan/check_out.md` が名前だけでたどれる。この 3 点が揃っていることが、仕様網羅テスト（[testing/unit.md](../testing/unit.md)）の `spec_ids` 対応を人手で維持できる規模に保つ。

### この例が示すルール: 対象外の置き場を正しく使う（P3）

✅ 正しい

```text
app/src/operation/_template/transition.ts   ← 4 形の定型。_template/ 配下は検査対象外
app/src/operation/loan/ports.ts       ← IF 宣言。検査対象外
app/src/operation/deadline.ts          ← 集約横断の純粋ヘルパ。operation 直下は検査対象外
app/src/operation/shared/retry.ts      ← 共有物。shared/ 配下は検査対象外
app/src/operation/jobs/run-due-jobs.ts ← ジョブ実行基盤。jobs/ 配下は検査対象外
```

❌ 間違い

```text
app/src/operation/loan/helpers/format.ts   ← 集約直下より深い。badPath
app/src/operation/loan/queries.ts          ← 読み取りは operation に置かない。missingExport（ARCH-BE-0016）
```

これは ESLint の `layer/operation-naming` で検出される（`badPath`:「…集約に属さない共有物は src/operation/ 直下か src/operation/shared/ に、4 形の定型そのものは src/operation/_template/ に置く。」）。

**ポイント:** 「集約ディレクトリの中身はドメインイベント 1 対 1」という不変条件を保つために、それ以外のものは**外に出す**設計になっている。ヘルパを集約の中に隠せないので、共有物が共有物として見える。

### 決定性の格上げ ⑥ — 形の閉世界（逆方向の突合・主 export・大きさ・例外の宣言）

P1〜P6・Q5 は「今リンターが見ているファイルの形が正しいか」しか見ていない。**期待される全ファイルが実在するか**（逆方向）と**それ以外のファイルが紛れ込んでいないか**（閉世界）は誰も見ていなかった。この節は、その 2 つの逆方向検査と、あわせて足した 2 つの規則（大きさ・免除の一本化）の内容を定める。

#### 期待ファイル木の生成物

`app/src/domain/generated/structure-expectations.ts`（生成器: `legacy/spec-tools/lib/generate/render/code-structure-expectations.ts`）が、ドメインイベント・action_spec・query_spec から次の 3 つの期待を機械的に導く。

- `expectedOperationFiles` — **独立して起動されるドメインイベント**（action_spec を持つ = 人間が起こせる、または仕様の `scans:` に宣言されている = system が独立に起動する）だけを対象に、`src/operation/{aggregate}/{event}.ts` と期待 export 名を導く。`{aggregate}` は **specs/domain 側の集約ディレクトリ名**であり、状態機械名（`{machine}.{event}` の `machine`）ではない。両者が食い違う実例が 1 つある: `loan_companion` 集約が持つ副次状態機械 `participant_link`（`participant_link.link` / `participant_link.unlink`）の Server Action は `src/app/_actions/participant_link/`（`handles` の machine と一致）に、業務手順は `src/operation/loan_companion/`（集約ディレクトリと一致）に置かれている。2 層は独立した ESLint ルールがそれぞれ自分のパスだけを見て検査しており、ドメインイベント ID を介した突き合わせは今回の生成器が初めて行った。
- `expectedActionFiles` — 実在する action_spec の `handles` から `src/app/_actions/{machine}/{event}.ts` を導く（母集合は「今ある action_spec」。網羅=足りているかは A4 が別に見る）。
- `expectedQueryDirs` — query_spec が 1 件以上ある主エンティティ(ディレクトリ)の一覧。`src/composition/{aggregate}/queries.ts` と `src/infrastructure/{aggregate}/queries.ts` の実在だけを期待する(1 ファイル N クエリのため export 名の形は Q5 が別に見る)。
- `expectedScreenFiles` — 画面の層(`src/app/_screens/`)の期待。`containers` は手書きの器 `_screens/{名前}.tsx` が**持ってよい名前**の母集合(screen_spec の画面名を kebab-case にしたもの。持たねばならない名前ではない — 依存が無い画面は器を持たない)、`generated` は生成物の置き場 `_screens/generated/` の期待木(生成器が画面を書いた分だけ増える。束 画面 1 では 0 件で、置き場そのものが存在しないことが基準線)。層(`app`)は `closedWorld: none` のままで、**閉じるのは `_screens` の木だけ**である。

**独立して起動されないイベントは operation ファイルを持たない。** `by: system` の予約 ID の一部(例: 別の操作の RPC が一括で書く副作用、sign-in の副作用、遷移が作る写しなど)は、他の操作の業務手順の**内側**で副作用として書かれる設計であり、独立したファイルを持たない。これは仕様上の穴ではなく設計判断であり、`scans:` に無く action_spec も無いことがその宣言を兼ねる(多くは README.md の `unscanned` に理由も書かれている)。

#### 逆方向の突合(新検査。P 群の逆方向)

実体は `app/src/composition/__tests__/structure/expected-files.test.ts` と `main-export.test.ts`(ファイルシステムと TS 構文木を読む必要があり、docs 側の生成器は I/O をしない規約のため、生成物を消費する app 側のテストとして置く)。

1. **期待パスが全部存在すること**(`expectedOperationFiles` / `expectedActionFiles` / `expectedQueryDirs` の両層)。
2. **対象ディレクトリに期待に無いファイルが存在しないこと**(閉世界)。許容する補助ファイルの一覧は次項。
   加えて**仕組みの土台の閉世界**(束⑯g): `src/` 直下が宣言された層だけであること・`closedWorld: structure_test` の層(現在は `operation`)の直下が集約か宣言された土台ディレクトリだけであること・宣言した土台が実在すること。`infrastructure` の同じ閉世界は X1(`npm run verify`)が内部テーブル・外部連携カタログまで見て判定する。**`composition` は閉世界を宣言できていない** —— 機能ごとの配線(`composition/tutorial`)という集約でない置き場が実在し、それにフレームワークの名前がまだ無いためである(穴として記録)。
3. **主 export が 1 つ + 型 export のみ**であること(判定は `typescript` パッケージの構文木。型情報は使わない)。対象は `expectedOperationFiles` と `expectedActionFiles` に限る — 1 ファイル 1 イベントという設計そのものを持つのはこの 2 層だけであり、`composition/{aggregate}/queries.ts` / `infrastructure/{aggregate}/queries.ts` は 1 ファイル N クエリという別の設計(Q5)を持つため対象外、`composition/{aggregate}/{event}.ts`(配線)と `infrastructure` のリポジトリ・リーダー類は次項の理由でそもそも命名規約の対象外。

#### 許容する補助ファイル

`src/operation/{aggregate}/` の補助ファイルと**層・土台ディレクトリの一覧は生成物が正**である(正の宣言は置き場の配置の `source-root` の `structure` = `legacy/spec-tools/lib/targets/nextjs/layout.ts`。層の 4 名は `lib/model/framework-dirs.ts`。テストは生成物の `frameworkAuxFiles` / `frameworkBaseDirs` / `frameworkLayers` を読む)。下の表のうち、`infrastructure` の**接尾辞パターン**だけはテスト側に残っている —— ディレクトリ名の一覧ではなく命名の形であり、既知の穴(下記)とセットで扱うため。

| 置き場 | 許容するファイル名の形 | 理由 |
|---|---|---|
| `src/operation/{aggregate}/` | `ports.ts` | IF 宣言(既存の P3 の skip と同じ)。正は配置の `structure.auxFiles` |
| `src/app/_actions/{aggregate}/` | (無し) | 実測では期待どおりの事象ファイルしか無い |
| `src/composition/{aggregate}/` | `queries.ts`、`expectedOperationFiles` が指す `{event}.ts` | 配線層は 1 ファイル 1 イベントの読み書き両方を持つが、命名の形そのもの(export 名)を縛る ESLint ルールはまだ無い(BACKLOG) |
| `src/infrastructure/{aggregate}/` | `queries.ts`、`*.repository.ts`、`*.reader.ts`、`*.readers.ts`、`*-queries.ts`、`projection.ts` | 写像層はリポジトリ(書き込み)・リーダー(補助読み取り)・可視性の供給元ごとに分けたクエリ写像が集約単位で混在する。命名は**接尾辞の形**だけが揃っており、1 ファイル 1 イベントではない(例: `loan.repository.ts` は create/delete/update 3 イベント分をまとめて持つ。`tutorial_docs` 集約は例外的に `tutorial.repository.ts` — エンティティ名の省略形)。**個々のリポジトリファイルが単一の export を持つとは限らない**(下記「見つかった既存の穴」参照) |

全レイヤ共通で `__tests__/` ディレクトリ自体は対象外(中身は F2 と同じ扱い)。

#### 見つかった既存の穴(この検査が初めて可視化したもの)

- **infrastructure のリポジトリファイルは主 export が複数ある。** 例: `loan-return.repository.ts` は `createLoanReturnRepository` と `createLibrarianReader` の 2 つを export する(`item_check.repository.ts` / `item-part.repository.ts` / `loan-companion.repository.ts` / `patron.repository.ts` / `note.repository.ts` / `branch.repository.ts` / `tutorial.repository.ts` も同様)。これは「1 ファイル 1 主 export」という P 群の設計思想を写像層(infrastructure)には最初から適用していないためで、当面は**検査対象外**(上表)として扱う。写像層に主 export 1 つの規律を持ち込むかどうかは別途の検討課題(BACKLOG)。
- **composition の配線層(`{aggregate}/{event}.ts`)には命名規約そのものが無い。** `layer/query-naming` は `queries.ts` だけを見ており、書き込みの配線(`create.ts` 等)の export 名の形を縛るルールは存在しない。今回の閉世界検査は「ファイルが実在すること」までを見るにとどめ、export 名の形までは踏み込まない。

#### 大きさの規則(lint)

`max-lines-per-function` / `max-depth` / `max-params` を追加した(`app/eslint.config.mjs`)。数値は現物の分布を測ってから決めている(2026-09 時点の `app/src`、テスト・生成物を除く 2160 関数の分布)。

| 規則 | p50 | p90 | p95 | p99 | max | 決めた値 | 根拠 |
|---|---|---|---|---|---|---|---|
| 行数(1 関数) | 4 | 23 | 39 | 99 | 175 | **180** | 現状の最大 175 行を壊さないラチェット。150 にすると screen 部品 4 本(`hold-editor.tsx` 175 行・`item-manage.tsx` 172 行・`purchase-request-table.tsx` 169 行・`check-table.tsx` 162 行)が違反になり分割が要るため、今回は数値だけを固定し分割は別課題として残す |
| ネスト深さ | 0 | 1 | 2 | 2 | 3 | **4** | 現状の最大 3 に 1 段の余白 |
| 引数の数 | 1 | 2 | 3 | 4 | 6 | **7** | 現状の最大 6 に 1 個の余白 |

テスト(`src/**/*.test.ts(x)`)と生成物(`src/domain/generated/**`)は対象外(F2 と同じ)。3 本とも現時点で違反する現物は無い(現状を壊さず、今後の増加を検出するラチェットとして機能する)。

#### 免除の一本化(第 2 段)

`eslint-disable` はコード内に書けない(`no-restricted-syntax` で `eslint-disable` を含むコメントを禁止する。検査目的の `@ts-expect-error` は対象外)。generate で導けない ESLint 違反(P5 の `globalRole` の既知例外・Q9 の型カーディナリティの決定など)は、action_spec / query_spec の `exceptions:` に理由つきで宣言する。

```yaml
exceptions:
  - rule: no-restricted-syntax
    reason: なぜこの 1 箇所だけ受け入れるか(日本語 1 文)
```

生成器 `code-lint-exceptions.ts` がこれを `app/src/domain/generated/lint-exceptions.json`(ファイル → ルール ID → 理由)に写し、`app/eslint.config.mjs` の末尾がこれを読んでファイル単位でそのルールをオフにする。**行単位ではない** — 免除は「そのファイルの、その形の違反を許す」という粒度に固定し、同じルールの例外が同じファイルに 2 件以上増えたら拡張トリアージ(`dsl-extension-triage.md`)に回す。`npm run verify` は A 群・Q 群の実行ログに「ESLint 免除・理由つき受け入れ N 件」を出す。

## 注意点・例外

- **export の併存は禁じていない。** ルールは「期待名の export が**存在するか**」だけを見る。同じファイルに型や補助関数を追加で export してよい。ただし [server-actions.md](../server-actions.md) の「1 ファイル 1 アクション」は別途の規約であり、こちらは機械執行されていない。
- **export の書き方は問わない。** `export function f`・`export const f = …`・`export { g as f }` のいずれでも同じ集合として扱われる（`collectExportedNames`）。
- **仕様側との一致は検査していない。** ルールが見るのは**パスと export 名の整合**だけで、そのパスに対応する `action_spec` が実在するかは確認していない。「仕様に無いアクションが実装されている」ケースは検出されない（`docs/specs/backend/actions/` の突合は未実装）。
- **`src/app/_actions/` 以外の Server Action は検査対象外。** ルールの適用は `src/app/_actions/**` に限定されている。
- **テストとテスト支援コードは対象外。** `src/**/*.test.ts(x)` と `src/**/__tests__/**` を `ignores` している。
- **変換規則を変えるときは 3 か所を同時に変える。** [server-actions.md](../server-actions.md) の表、本文書、`framework/lint-config/src/rules/naming.mjs`。設定だけを変える変更は禁止（PRIN-0007）。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [server-actions.md](../server-actions.md)（配置と命名の変換規則の正。定型 4 手順・`Result` 型）
- [public-symbol-docs.md](./public-symbol-docs.md)（同じ「縛りの粒度は配置と公開シンボルまで」方針のもう一方）
- [ARCH-BE-0013 — Server Action の構造](../../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)
- [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)（E9）
