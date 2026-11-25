---
doc_type: decision
scope: common
id: ADR-0013
status: accepted
targets: [infrastructure, testing_strategy, documentation_structure]
date: 2026-09-27
norms: [PRIN-0001, ARCH-0001]
---

# ADR-0013: 仕組みの実行時コードを workspace パッケージへ出す — 束ねるのは framework と product であって app と docs ではない

## Status

accepted (2026-09-27)

---

## Context

### 背景

このリポジトリは 1 つである。仕組み(検証器・生成器・規約・`fixture`・実行時の評価器)と製品(その仕様・生成物・手書き層)が同居しており、**依存の向きは既に一方通行**である —— 製品 → 仕組みの import は 0 本で、B14 がそれを執行している。

それでも 2 つ目の製品が立てられない。障害は向きではなく **綴りと物理配置**だった(設計記録 framework-product-separation §1 の実測。非公開)。前の束(①-a)で綴りは製品の根の宣言 1 枚(`product.md`)に寄り、W3 が綴りの不在を執行するようになった。残っていたのが**物理配置**である。

実測すると、仕組みの実行時コードが製品の実装の木(`app/src/`)に住んでいるために 3 つのことが起きていた(設計記録 runtime-package §1。非公開)。

1. **`fixture` の通し実行が app の実物を symlink で借りている。** エンジン・純関数 8 本・実行器・受信の段取り・汎用 RPC の口・`app/node_modules`。借り物なので、製品を持たないリポジトリでは通し実行そのものが組めない。
2. **検証器の側も app を借りている。** `legacy/spec-tools/lib/results/**` の 5 ファイルが `app/src/domain/engine` と `app/src/operation/_template` を静的 import で 13 本借りており、**規約(scripts-code-quality.md「app の本番コードを借りない」)に違反していた**。台帳の表は「実例は 3 つ」で止まっていた。
3. **仕組みが製品の生成物を読んでいる。** `plan-types` / `roles` / `session-profile` / `constraint-invariants` ほか、逆向きの依存が 11 本。とくに `plan-types.ts` は**生成器が仕様を 1 行も読まずに固定の文面を吐いていた** —— 実行計画の形はアプリの仕様から導かれるものではなく、フレームワークが決めている**軸**である。

### 前提条件

- **製品は動かさない。** 製品の配置(`app/` / `supabase/` / `docs/specs/`)・Vercel の root・CI のパス・生成物・migration は不変である(review-queue §19 の (F))。動かすのは仕組みの側だけである。
- ARCH-BE-0001 が「`app/` と `docs/` を npm workspaces で束ねない」と定めている。理由は「生成物をコミットする前提(ADR-0006)が崩れる」「製品のビルドが検査器のツールチェーン(tsx・z3・vitepress)に依存する」の 2 つである。
- 移す範囲は設計メモ §2-2 の FW 判定より**狭い**。`operation/shared`(770 行)・`composition/jobs`(55 行)・`infrastructure/supabase` の `database.*.ts`(1,412 行)は製品の語と製品の配線を持っており移せない(runtime-package.md §2-3)。

---

## Decision

### 決定内容

**仕組みの実行時コードとその lint 規則を、リポジトリの中の workspace パッケージへ出す。** ARCH-BE-0001 の「`app/` と `docs/` を workspaces で束ねない」を**改め**、束ねる相手を次のとおりにする。

- **束ねる**: `framework/lint-config`(`@kaninabe/lint-config`)・`framework/runtime`(`@kaninabe/runtime`)・`app`。
- **束ねない**: `docs`。検査器・生成器のツールチェーンを製品のビルドに持ち込まないためで、ARCH-BE-0001 が守ろうとしていたものはこれである。検査器・生成器の側(`legacy/spec-tools`)が `@kaninabe/runtime` を `file:` 参照の devDependency として引く(束 分離 ②-b まで `docs` がこの側だった。いまの `docs` は VitePress だけの別の manifest で、`@kaninabe/runtime` を引かない)。
- **`@kaninabe/spec-tools`(`legacy/spec-tools`)も `docs` と同じ理由で workspaces の外**(2026-10。検証器・生成器・CLI とそのテストの移設 = 分離 ②-b。自分の `package.json` と `package-lock.json` で `npm ci` する。`@kaninabe/runtime` / `@kaninabe/lint-config` は `file:` 参照の devDependency)。`docs` は VitePress だけの別の manifest になった。

決定の細目は 6 つ。

1. **`.ts` は型の共有まで。値の配布は `dist` である**(`tsc` → `dist`。束 ①-c で決着)。`exports` は 1 つの写像の中で条件だけを切り替える —— `types` は `dist/**/*.d.ts`、`default` は `dist/**/*.js`(CommonJS)、`test` は `src/**/*.ts`。**`dist` はコミットしない**(仕様から導かれる生成物ではなく、人がレビューする対象でもない —— ADR-0006 の趣旨の外である)。作るのは**ルートの** `prepare`(`npm ci` / `npm install` が呼ぶ)と、**検査の先頭に置いた `build:framework`** である。作った直後に `check:exports`(`exports` の全エントリを `require()` と `import()` で読むスモーク)を実行する —— 型が通っても配布物は壊れうる。

   > **`prepare` はビルドの入力を入れる install と同じ package.json に居なければならない。** パッケージ側に `prepare` を置くと、`file:` で結んだ利用側(`docs`)の install がそのビルドを起動する —— ところが `file:` のリンクは依存先の devDependencies を入れないので、**そのビルドは構造的に成功しえない**(実測: `@types/node` が無く `TS2688` で CI の 3 ジョブが赤。緑だったのは「たまたまルートの install が先だった」ためで、成立条件が宣言のどこにも無かった)。ルートに置けば、入力を入れる install が終わってから走る。これは「依存を置き場で参照するな」の、相手が**install の順序**になったものである。

   > **なぜ `.ts` を素のまま配る形では足りなかったか(実測)。** 手 4 で `eq-subject.ts` を移したとき、**docs が `tsx` からパッケージの値を名前つきで import できない**ことが分かった —— `type` の無いパッケージの `.ts` は Node から見て CJS で、名前つきの輸出が ESM の利用側に見えない(`SyntaxError: does not provide an export named 'eqSubjectValues'`)。手 3 まで出なかったのは、docs 側が引いていたのが型と**名前空間** import(`import * as`)だけで、後者は「`default` があればそれを、無ければ名前空間そのものを」というハックで通っていたからである。
   >
   > `"type": "module"` にして相対 import 90 本へ `.js` を足す道も試したが、3 つの型検査は通ったのに **製品のビルド(Turbopack)が `./actor.js` を `.ts` に解決できず 22 件で落ちた**。`dist` を配ればこの問題はどちらも消える(配るのは実在する `.js` である)。副産物として `engine-bridge.ts` のハックを**削除できた** —— 1 か所だけの作法が 1 つ減った。
   >
   > **`test` 条件が要る理由(実測)。** テストが配布物を走らせると 2 つが壊れる。①CommonJS の `require("server-only")` は vite の alias を通らないので、サーバー専用マーカーが本物のまま届いて落ちる(統合 114 ファイル・ユニット 14 ファイル)。②v8 のカバレッジは配布物の実行を `src/**` に戻せないので、**所有者側 100% の閾値が掛からなくなる**(実測 2.81%)。どちらも「テストはソースを走らせる」で消える。写像の正は `exports` 1 か所のままで、**型は `dist` の `.d.ts` 1 つ**なので「型は通るのに実行が違う」は作らない。配布物そのものは E2E(`next build` + 実サーバー)が通しで実行する。
   >
   > 条件は vite/vitest の **`ssr.resolve.conditions`** に置く(`resolve.conditions` だけでは効かない —— node 環境は SSR 側の解決を通る。実測)。

2. **パッケージに `"type": "module"` を書かない。** 配るのは CommonJS の `dist` であり、ソースの相対 import に拡張子を足さずに済む(`moduleResolution: NodeNext` の docs からも読める)。型検査の正は `tsconfig.json`(`noEmit`)で、配布物を作るのは `tsconfig.build.json`(それを `extends` して `module: node16` と `declaration` だけを足す)である。

3. **製品が渡す宣言は 1 束にする。** パッケージが製品の生成物を読む向きは作らない。渡すものは製品の `eslint.config.mjs` や配線が引数で渡す(この束では `framework-structure.json` が 1 本目)。
4. **土台の宣言は 2 つの根にまたがる 1 枚の表になる。** `framework-dirs.ts` の各行に `root: 'product' | 'framework'` を足す。**免除リストではなく軸**であり、`generated` / `vocabularyScan` / `perSpec` と同じ扱いをする。製品側の閉世界(X1 / A11 / 構造テスト / ESLint の生成物グロブ)が見るのは `product` の行だけである。
5. **`plan-types` は生成物から外し、パッケージ側の手書きにする。** 生成器(`code-plan-types.ts`)は削る。仕様を読まない生成器は生成物の体裁をした軸の宣言であり、それを製品側に置くと仕組みが製品を読む逆向きの依存になる。
6. **公開する入口は名指しにする。内部ファイルは出さない**(束 外部レビュー C-⑥)。`exports` のキーに**ワイルドカード(`*`)を書かない** —— 書くと、ディレクトリに足したファイルが審査なしに公開の口になり、内部の改名・統合が利用側(製品・生成物・テスト・仕様側の検査器)の変更になる。入口は 3 種類で、**製品が引く口**(`result` `form` `template/*` ほか)・**生成器が書く口**(生成物が import する綴りは `runtime-modules.ts` の 1 か所)・**テストが引く口**(`testing/*/*`)を 1 本ずつ列挙する。**外から 0 本の入口が 1 つだけある** —— `action-error` は、パッケージの中で operation 層が domain 層の値を引く層またぎを、相対 import ではなく入口(自己参照)に通して境界の検査の範囲に載せるために残す(外すと層またぎが検査の範囲外に出る)。内部補助を外から引く必要が出たら、その利用側を正しい入口に直すか、補助を**入口の公開シンボルへ昇格**する(DB なしで計画を評価する純関数は `template/evaluate` がその例)。**入口を足すときは `exports-manifest.json` の差分に出る = レビューに出る**。`check:exports` は名指しを機械で見る(ワイルドカードがあれば赤・配布物を指さないエントリの実体が無ければ赤・名前つき輸出は宣言と両方向で一致)。実測と外した 17 本の一覧は 設計記録 runtime-package §9-14(非公開)。

### 適用範囲

リポジトリ全体の物理配置と依存の宣言。**製品の仕様・生成物・migration の中身は 1 バイトも変わらない**(生成物に出る差分は import 先の綴りだけで、`spec:diff` の意味の差分は 0 である)。

---

## Consequences

### Positive（メリット）

- **借用が消える。** 通し実行の symlink と `legacy/spec-tools/lib/results/**` の借用は、依存として解けるようになる(順を追って 0 本にする)。「依存の解決」だけが残り、これは規約が認めている借り方である。**`docs → app` は 0 本である**(束 ①-c 実測)。**範囲の注記は要らなくなった**(束 ①-d 手 2)—— ハーネス本体は依存として解け(手 1)、住所を保つアダプタ 6 本は**生成物**になった(手 2)ので、通し実行が一時ツリーへ写すのは**口の実装 1 本だけ**である(`harness-ports.ts` = 実 DB とセッションに触る手を束ねる製品の接続層。シードや接続層の stub と同じ性格であり、仕組みの写しではない)。
- **仕組みが製品を読む向きが構造的に塞がる。** パッケージからは製品の生成物が見えない。読みたければ製品に渡させるしかなく、渡し口は型で閉じる。
- **閉世界が強まる。** 土台が 2 つの根に割れると、製品の `src/` に残るのは仕様から導ける置き場だけになる。
- **仕組み側のコードが初めて lint される。** ESLint のフラット config は config ファイルのあるディレクトリの外を lint しないので、パッケージには自分の入口が要る。入れた初日に、検査の範囲外にあった書式の破れ(JSDoc の中の空行)と 530 行のファイルが 1 件ずつ出た。
- **パッケージが自分のカバレッジの閾値を持つ。** これも「外を測れない」問題である —— v8 プロバイダはプロジェクトルートの外のファイルをカバレッジ表に出さず、`coverage.include` に `../framework/...` を足しても掛からない(実測)。閾値を所有者の側に置いたところ、**評価器の 1 分岐(`canWrite` の `effects` を持つ規則)が、評価器自身のテストでは 1 度も通っていなかった**ことが分かった —— 製品側の別のテストが偶然踏んでいたのである。テストを 1 本足して 100% に戻した。**移動が検査を強くした実例**である。
- **第 2 段(別リポジトリ + 公開パッケージ)の工事が「依存の指し先を変える」だけになる。** 製品の配置は動かない。

### Negative（デメリット・トレードオフ）

- **ルートに `package.json` と lock が生まれる。** `app/package-lock.json` は形骸化するので消す。依存の解決が 2 段(ルートと `app/`)になり、**パッケージが依存を 1 つ宣言するたびに hoist で居場所が変わりうる** —— 実測: `@kaninabe/runtime` が `server-only` を宣言した瞬間に、その依存は `app/node_modules` からルートへ上がり、`./node_modules/server-only/empty.js` と綴っていた 5 か所(app の vitest 設定 3 本と通し実行 2 本)が実在しないファイルを指した。**規律**: 仕組み側のコードは依存を**名前で**参照してよいが、**置き場で**参照してはならない(W3 が製品の根に課しているのと同じ形で、相手が依存の木になったもの)。
- **移す範囲が設計メモ §2-2 より狭い。** 製品の語を持つ 3 か所は残るので、「`app/` の仕組み側は全部パッケージに居る」とは言えない期間がある。どれが残っているかは `framework-dirs.ts` の `root` が機械可読に言う。
- **`@kaninabe/lint-config` の前倒しが要った。** 当初は「`eslint-rules/**` は動かさない」と決めていたが、パッケージを lint する道が他に無かった(選択肢は「検査を変える」「無検査で通す」「規則を 2 か所に書く」で、いずれも正を 1 つに保てない)。
- **生成物が 1 本減る。** `plan-types.ts` を生成物として見張っていた `generate:check` の目が 1 つ外れる。代わりにパッケージの lint と型が見る。

### Neutral（その他の影響）

- CI の `changes` フィルタと pre-commit のスコープ表に `framework/` が加わる(`scope-parity.test.ts` が両者を突き合わせる)。
- `lib/io/paths.ts` に `FRAMEWORK_RUNTIME_DIR` が 1 つ増える。**製品の根ではない**ので W3 の相手ではなく、既存の `FRAMEWORK_*` 5 定数と同じ扱いである。
- ESLint の層境界に**パッケージの層ごとの要素型が 3 つ**増える(`runtime-domain` / `runtime-operation` / `runtime-infrastructure`)。**1 つにまとめてはならない** —— まとめると「旧 `domain` と同じ許可」を足したつもりで**旧 `operation` と旧 `infrastructure` の許可まで一緒に開き**、`components` / `domain` / `app` から `@kaninabe/runtime/rpc` や実行器が引ける(束 ①-b で実際にこうなっており、レビューがわざと壊す確認で実測した)。層ごとに割ったうえで各層に許すのは**移動前と同じ届く先だけ**である。
  - 綴りを作るのは `@kaninabe/lint-config` の `runtime-elements.mjs` 1 か所で、層の一覧は製品の生成物 `framework-structure.json` の `root: "framework"` の行から導く(仕組みが製品を読む向きは作らない —— 渡すのは製品の `eslint.config.mjs` である)。
  - 要素の宣言には **`partialMatch: false`** が要る。要素の照合はパスを末尾から 1 区画ずつ伸ばして走り**先に当たった短いパターンが勝つ**ので、素朴に書くと製品の `src/<層>` がパッケージのパスにも当たって**パッケージのファイルが製品の層に化ける**(実測: わざと壊す確認が `"infrastructure"` という嘘の型名で赤くなった)。`basePattern` では分けられない(この版の実装は `micromatch.capture()` の `undefined` を `null` と比べており弾けない)。
  - この形にしたので `src/` の直下にファイルを置けない(パターンがフォルダにしか当たらず、`src` を指す 1 本が配下の全層を吸う)。`bindings.ts` は `src/domain/` に住む。
  - 移動で許可が増えたように見えるぶんは、層の中の依存(要素内部なので無検査)が層の外へ出て**検査の対象になった**ためである。

---

## Alternatives Considered

### Option 1: 製品を `products/{製品名}/` へ移し、仕組みをリポジトリ直下に残す（設計メモの (D)）

- **Pros**: 立ち上げが最短。仕組みの側を 1 度も動かさない。
- **Cons**: 製品の配置・Vercel の root・CI のパス・git の履歴が一度動き、後で別リポジトリへ出すときにもう一度動く。
- **Why rejected**: **引越しが 2 回になる**。製品は実運用に入るので、動かす回数は 1 回に抑える(review-queue §19 追記 3)。

### Option 2: いきなり npm パッケージとして別リポジトリへ出す（設計メモの (A)）

- **Pros**: 公開範囲を分けられる。「製品の都合で仕組みを触る」誘惑が構造的に消える。
- **Cons**: 検査器を 1 つ直した日に製品が赤くなるかどうかが同じコミットで分からなくなる(版を上げるまで遅れる)。割り方の正しさを検算する前にパッケージの粒度を決めることになる。
- **Why rejected**: 粒度は「2 つ目の製品が欲しがったものを移す」形で**発見されるほうが当たる**。同一リポジトリで 1 周回してから切る。

### Option 3: `app` と `framework/*` の両方を workspaces に入れ、`docs` も入れる

- **Pros**: 依存の宣言が 1 か所になる。
- **Cons**: 製品のビルドが `tsx` / `z3-solver` / `vitepress` を巻き込みうる。ARCH-BE-0001 が禁じた本体はこれである。
- **Why rejected**: 禁止の**理由**は「app と docs が同じ木に居ること」ではなく「製品のビルドに検査器のツールチェーンが混ざること」だった。`docs` を外に置けば理由は満たされる。

### Option 4: `framework/runtime/**` を ①-b のあいだ lint しない

- **Pros**: 工事ゼロ。
- **Cons**: 移した 5,350 行が `eslint-disable` 禁止・JSDoc 必須・300 行上限・層境界の全部から落ちる。しかも**赤くならない**。
- **Why rejected**: 免除リストより悪い(免除の宣言すら無い)。実際に入れてみると初日に 3 件の破れが出た —— 検査の範囲外にあった証拠である。

### Option 5: `plan-types` を生成物のまま、パッケージから製品の生成物を import する

- **Pros**: 生成器を 1 本も消さない。
- **Cons**: パッケージが利用側の木を読むことになり、依存として成立しない(`@/domain/generated` はパッケージから見えない)。
- **Why rejected**: 「仕様を読まない生成器」は生成物の体裁をした軸の宣言である。軸は仕組みが持つ。

---

## Implementation

### Tasks

- [x] ルートに workspaces(`framework/lint-config` / `framework/runtime` / `app`)。`file:` 参照で引くのは検査器・生成器の側(当初は `docs`、束 分離 ②-b から `legacy/spec-tools`)
- [x] `@kaninabe/lint-config`(規則のデータ + 自作規則 10 本)。`operation-naming` は構造の宣言を製品から受け取る
- [x] `@kaninabe/runtime` に評価器(`engine`)と実行計画の型(`plan`)。`code-plan-types.ts` を削る
- [x] 土台の宣言に `root` の軸。製品側の閉世界・生成物グロブ・W1 の走査を追随
- [x] パッケージ自身の lint(`frameworkSourceConfig()`。検査の 3 つ目のスコープ)
- [x] ユニットテストの実行の根をリポジトリルートへ(vitest の projects)。カバレッジの閾値は 1 か所で製品とパッケージの両方に掛ける
- [x] `domain` の純関数 9 本 / `operation/ports.ts` / `infrastructure/inbound`(裏返し不要のもの)
- [x] 製品が渡す宣言の束(`RuntimeBindings` = `roleTables` + `invariantOfMessage`。生成物 `runtime-bindings.ts`)
- [x] 裏返しが要る実行時コード(`_template` / `rpc` / `facts` / `usecase`)。ポートの適合(`rpcSourceOf` / `rowSourceOf`)は**製品の接続層**が持つ
- [ ] `infrastructure/supabase/query-window.ts`(3 つの形の型をパッケージへ移せば動く。接続層の 3 本はポートなので製品に残る)
- [x] 配り方(`tsc` → `dist` + `test` 条件)。`build:framework` を検査の先頭に置き(その直後に `check:exports` のスモーク)、`dist` は `.gitignore`(パスを 1 つだけ) / 検査の範囲 / 閉世界の外に宣言する。`prepare` は**ルート**に置く
- [x] テスト基盤(`app/tests/**` 6 本 → `testing/local` / E2E 3 本 → `testing/e2e` / `eq-subject` → `src/sql`)。`docs → app` の借用が **13 本 → 0 本**になった
- [x] **一致の証明と RLS のハーネス本体 13 本(2,564 行。2,879 は製品に残した単体テスト 315 行を足した値)を `@kaninabe/runtime/testing/{harness,rls,equivalence,save}/**` へ**(束 ①-d 手 1)。裏返しは**見積りどおり 11 か所**(生成物 7 本 = `eq-worlds` / `rls-worlds` / `session-profile` / `usecase-plans` / `operation-plans` / `runtime-bindings` / `constraint-invariants` + 接続層 3 本 = `supabase/client` / `session` / `database.types` + 固定データ `./seed`)で、口は `HarnessPorts` 1 つに束ねた(製品の型はパッケージに 1 つも入らない。`as unknown as` はアダプタ 1 か所だけ)。**生成テスト 83 本の配線替えは 0 本**である
- [x] **束ねる層 6 本**(`rls-{world,expect}` / `eq-{world,expect}` / `eq-save-{world,expect}`)を**生成物**に(生成器 `code-harness-adapters` 1 本。束 ①-d 手 2)。生成テスト 83 本の import 先は変わらず、通し実行のコピーは **7 本 → 1 本**(口の実装だけ)になった
- [x] **`world` の設計図の型を 1 か所に**(生成物が `@kaninabe/runtime/testing/**/types` から再輸出する)。境界に要素 `runtime-testing` を宣言し、**テストの軸のファイル 3 分類からだけ**許した(本番コードから引くと `boundaries/dependencies` が赤。わざと壊す確認で実測)
- [x] 借用を 0 本にし、台帳(scripts-code-quality.md の表)を書き直す(束 ①-d 手 2。範囲の注記も外した)
- [x] 依存の置き場を綴らない(app の vitest 設定 3 本は `createRequire` で解決・通し実行は一時ツリーに空の実体を置く)

### Timeline

- 開始: 2026-09-27
- 完了予定: 手順 ①-b の 4 手が全検査緑になった時点

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: ADR-0006(生成物をコミットする)/ ADR-0011(ユースケース層の 2 つの出自)/ ADR-0012(DB を権威にする)
- **Blocks**: None
- **Blocked by**: None

---

## References

> **`norms` に ARCH-BE-0001 を置いていない。** この ADR は ARCH-BE-0001 の**根拠に立っている**のではなく、その 1 条を**改めている**。両方向に書くと参照が循環する(M6)ので、向きは「ARCH-BE-0001 の `decisions` が ADR-0013 を指す」の 1 本にする。

- 設計記録 framework-product-separation(非公開) — 分離の全体像と 4 案の比較
- 設計記録 runtime-package(非公開) — 移すものの全数表・公開 IF・実測
- [ARCH-BE-0001](../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) — 改める規約(層構造と実装配置)
- [scripts-code-quality.md](../../process/common/tooling/standards/scripts-code-quality.md) — 借りる向きの表

---

## Notes

**「移動だけで振る舞いが変わらない」を受け入れ条件にしている。** そのために選んだのが決定内容の 2(`"type": "module"` を書かない)である —— 付けると移したファイルの相対 import を全部書き換えることになり、差分の中から「移動」と「書き換え」を人が分けられなくなる。公開パッケージにする段では逆に、書き換えとビルドだけを 1 束にして入れる。

**ビルドの入口の関所(`build:gate`)だけが検査器のソースを読む。** 範囲は S7・J2(HTTP の入口の閉世界。verify と同じ本体)・`layer/no-module-state`・`layer/root-layout-closed`。製品の実行時の依存には入らず、道具(`eslint` ほか)は devDependencies に置く。道具が読めなければビルドを止める(緑と言わない)。
