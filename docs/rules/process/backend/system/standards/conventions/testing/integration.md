---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0003, PRIN-0008, PRIN-0009, PRIN-0010, ARCH-BE-0001, ARCH-BE-0013]
---

# 統合テスト

実 DB（ローカル Supabase）に対して、境界の実装が仕様どおりに振る舞うことを確認するテストの規約。

## 1. Overview

- **ローカル Supabase（実 Postgres）**に対して実行する。モックした DB では、RLS・制約・クエリという「境界の保証」が何も確かめられないため。
- 対象は 3 種: **infrastructure**（クエリ・リポジトリ実装）、**RLS**（vitest + anon/JWTクライアント）、**Server Action**（境界の通し）。
- **1 コマンドで完結すること**が成立条件である。起動手順が複数あるテストは運用に乗らず、テスト先行の進め方が崩れる。

## 2. Scope

**含む**

- `src/infrastructure` のリポジトリ実装
- 読み取りクエリ（`src/composition/{aggregate}/queries.ts` の配線を入口に、実 RLS を通して確認する。絞り込みが `query_spec` の `filters` どおりか、**見えてはいけない行が返らないか**。可視性を執行するのはアプリの絞り込みではなく RLS である — [ARCH-BE-0016](../../../../../../architecture/system/backend/ARCH-BE-0016-read-path.md)）
- RLS ポリシー（`access_spec` との突合。vitest + anon/JWTクライアントで実アクセス経路を検証。ポリシー名と本文の過不足は `src/infrastructure/__tests__/rls/policy-parity.test.ts` が期待表と `pg_policies` を突き合わせ、**行ごとの可視性は生成された挙動テスト**が宣言から独立に計算した集合と突き合わせる）
- DB 制約による不変条件の執行（`invariant_spec` の `enforced_by: db_constraint`）
- Server Action の通し（パース → 照会 → 永続化 → outbox への積み込み）
- Webhook 受信口（署名不正・再送・未知イベント）
- ジョブワーカー（取り出し・リトライ・dead letter）

**含まない**

- 純粋な判定ロジック（→ [unit.md](./unit.md)）
- 外部サービスの実体との通信（オプトインのサンドボックススイート。CI 非ブロッキング。ARCH-BE-0014）
- ブラウザ経由の E2E（→ [screen-test.md §E2E スモーク](../../../../../frontend/system/standards/conventions/screen-test.md)。貫通シナリオ 1 本だけで、**同じローカル DB を使うので下記の多重起動ガードを共有する**）

## 3. 実行方法

**基本方針:** テストの実行は **プロジェクト定義のタスクランナーのコマンドをそのまま使う**。

- 使用するコマンド: `npm run test:integration`（`app/` パッケージ。ローカル Supabase の起動・マイグレーション適用・テスト実行までを 1 コマンドに含める）
- 実行場所: `app/`
- 注意事項: 起動していない場合は自動起動する。テストの前提としてマイグレーション（`supabase/migrations/`）が適用済みであること。
- **相手にする stack を名指す。** 足場（統合の globalSetup・E2E・題材の通し実行・開発の道具）は、`ST_EXPECT_PROJECT_ID` の名指し（設定の `project_id` と同じ値）か、GitHub がホストする使い捨ての runner の印（`GITHUB_ACTIONS=true` かつ `RUNNER_ENVIRONMENT=github-hosted`）が無ければ、CLI を 1 つも回さずに赤になる（照らしの持ち主は `@kaninabe/runtime/testing/local/stack-mark.mts`）。使い捨ての stack の道具は名指しを自分で付ける。同じ機械の別の作業も使う共用の stack で回すのは、人が自分で `ST_EXPECT_PROJECT_ID=<設定の project_id>` を付けたときだけである（共用への入口はこの 1 本。名指しの無い起動が共用の stack を作り直した 2026-11-16 の事故の再発止め）。「1 コマンドで完結する」は、名指しを含めた 1 行で成り立つ。
- **多重起動はできない。** 実 DB を共有し `db reset` / `migration up` から始まる以上、2 つ同時に走ると片方のデータが消える。`@kaninabe/runtime/testing/local/global-setup.mts` が Postgres の advisory lock を取り、取れなければ**待たずに**「別の実 DB テストが実行中です」で即失敗する（待つと、同時に実行したこと自体が「なぜか終わらない」に化けるため）。ロックはセッションに紐づくので、プロセスが落ちても取り残されない。
- **ロックは E2E スモーク（`npm run test:e2e`）と共有する。** キーの正は `@kaninabe/runtime/testing/local/db-lock.mts` の 1 か所にあり、両方の globalSetup がそこから取る。共有する基準は「その実行が共有 DB に**破壊的な操作**をするか」であり、統合テストは `db reset` / 全テーブル削除、E2E は舞台になる蔵書の作り直しという形でどちらも持つ。別々のキーにすると互いを排除できず、統合テストが E2E の固定データを消す（あるいは E2E の行が統合テストの数え上げに混ざる）。**E2E 側は `db reset` をしない**ので、下記の「reset の最中にロックが外れる」問題は統合テストにしか無い。
- **スキーマを触る操作はロックの証拠を要求する。** 未適用の migration を当てる口は `@kaninabe/runtime/testing/local/local-supabase.mts` の `applyMigrations(lock)` 1 つで、引数の `DbLock` は `acquireDbLock` だけが作る。つまり**ロックの外からは型が通らない** —— 「ロックを取ったか」を命名やコメントの規律に頼らず、証拠を値として渡す形で縛る（後発の入口が多重起動ガードの外でスキーマを作り替える経路を静かに作れないようにするため）。
- **接続情報の解決（`supabase status`）は globalSetup の 1 回だけである。** 解決した値は vitest の `provide` でワーカーへ配り、`@kaninabe/runtime/testing/local/setup-env.mts` は `inject` で受け取って環境変数に写すだけにする（`globalSetup` はテスト本体と別プロセス／スレッドなので `process.env` では届かない）。以前はワーカー側が自分で解決していたため、テストファイルごとに CLI を起動していて、それが `setup` 時間の大半だった。
- **ロックがセッション紐付きであることの裏返し**: `supabase db reset` は接続を切るため、**その間だけロックが外れる**（自動で解放される利点と同じ性質から来る穴）。そこで reset の直後にロックを**取り直し**、取れなければ「reset の最中に別の統合テストが入り込んだ」として中断する（DB の状態が信用できないため、そのまま実行しない）。恒久策（ロックを DB の外に置く）は未着手。

## 4. 配置・命名

- infrastructure: `app/src/infrastructure/__tests__/{aggregate}/{対象}.test.ts`
- 通しテスト: `app/src/composition/__tests__/{aggregate}/{event}.test.ts`(**Composition Root を入口にする**。Server Action 自体は cookie から actor を解決するためリクエスト文脈なしには呼べない。Server Action を直接叩く通しはセッションテストハーネス導入後の課題)
- 読み取りクエリ: `app/src/composition/__tests__/{aggregate}/{name}.test.ts`（`name` は `query_spec` の `name`。通しテストと同じく Composition Root を入口にする）
- RLS の**挙動**（行ごとの可視性）: `app/src/infrastructure/__tests__/generated/rls/{テーブル名}.rls.test.ts` —— **生成物である**（下記 §RLS の挙動テストは生成物である）
- RLS の手書きのテスト（生成できない表・経路そのものの確認）: `app/src/infrastructure/__tests__/{aggregate}/rls.test.ts`（vitest。`@spec`/`@tc` アノテーションでトレース突合に乗せる。pgTAP は不採用 — ツールチェーン一本化とトレース統合のため）
- RLS ポリシーの過不足・本文の突合（集約横断）: `app/src/infrastructure/__tests__/rls/policy-parity.test.ts`
- engine ⇔ RPC の**一致の証明**: `app/src/infrastructure/__tests__/generated/equivalence/{集約名}.eq.test.ts` —— **生成物である**（下記 §一致の証明は生成物である）
- 保存点の**一致の証明**: `app/src/composition/__tests__/generated/equivalence/{ユースケース名}.uc.eq.test.ts` —— **生成物である**（下記 §保存点の一致の証明も生成物である）
- テスト名は日本語で仕様の文をそのまま使い、`action_spec` / `query_spec` の `test_cases[].implementation` と一字一句一致させる。各テストに `// @tc {id}` を書く。

### 期待表の全数ループで実行する突合の注釈(`@tc-each`)

**表ごとの `it` を手で並べない。** 並べるとそのテストファイルが**アプリの表名の一覧**になり、
別題材を空の DB に構築して回す通し実行(`npm run samples:db` の構造の突合)が 1 本も実行できなくなる
—— 仕組みの側の突合が題材では 1 度も回らないということである(束 ③-4 の実測: 13 本中 5 本が
この形で実行できなかった)。回すのは**期待表のキー**そのものにする。

```ts
// @tc-each {table} の列と制約が宣言どおりである
for (const table of SPEC_TABLES) {
  it(`${table} の列と制約が宣言どおりである`, () => expectDdlParity(table));
}
```

- **1 ループに 1 つのひな形**を、ループの直前の行に置く(`@tc` と同じ位置の規約)。
- **ひな形は直後のループが付ける `it` の名前そのもの**にする(穴は `{…}`)。食い違えば A12 が
  error —— ひな形だけを書き換えると台帳のテスト名が当たらなくなり、**突合が静かに空になる**。
- 台帳(`test_cases[].implementation`)の書き方は**変えない**。ファイルパスもテスト名もそのままで、
  ひな形に当てはまる ID が注釈 1 件ずつに展開される(`lib/trace/expand-each.ts`)。
- ひな形は**穴の中身が実在するか**までは見ない(台帳の値をそのまま写す)。表名から機械的に決まる
  突合は **T3 が台帳の側を縛る**(`data-table-parity` / `ddl-parity` / `rpc-parity` の 3 本)。
- 書式の正は [action-spec-writing.md §test_cases](../../../../specification/standards/action-spec-writing.md)、
  執行の対応は [enforcement-matrix.md](../enforcement/enforcement-matrix.md) の C21 / C12。

### RLS の挙動テストは生成物である（束 ⑳-4b）

**ロールごとの可視性を手で書かない。** `npm run generate` が
`app/src/infrastructure/__tests__/generated/rls/{テーブル名}.rls.test.ts` を表ごとに書き、実行者ごとに
1 本 +（境界を宣言した表は）その欄ごとに 1 本 + `world` の検算 1 本を置く。注釈（`TC-RLS-{テーブル名}-{番号}`）も
data_table の `test_cases` の生成ブロックである（[unit.md §操作のユニットテストは生成物である](./unit.md)と
同じ扱い）。

- **何と比べているのか**: 期待は**オラクル**（`@kaninabe/runtime/testing/rls/oracle`。access_spec の `reads` と
  ロールの根拠から可視集合を計算する、SQL の翻訳器を 1 行も呼ばない別の写像）が出し、実測は実 DB が返す行で
  ある。`world`（実行者と行）の作り方も仕組み側の手書き（`@kaninabe/runtime/testing/rls/{world,expect}`）であり、
  生成テストは**設計図（`@/domain/generated/rls-worlds.ts`）を渡して実行するだけ**である。
- **ハーネスは実行時パッケージに住み、製品側に残るアダプタ 6 本は生成物である**（ADR-0013・束 ①-d）。
  生成テストが呼ぶ 6 つのパス（`__tests__/rls-{world,expect}.ts` / `eq-{world,expect}.ts` /
  `composition/__tests__/eq-save-{world,expect}.ts`）は**製品の生成物と口（`HarnessPorts`）を束ねて渡すだけの
  配線**で、`npm run generate` が書き出す（生成器 `code-harness-adapters`）。**手で書くのは口の実装
  `harness-ports.ts` の 1 本だけ**であり、そこが実 DB とセッションに触る手（製品の接続層）を知る唯一の場所である。
  `world` の設計図の**型**もハーネスが 1 か所で持ち、生成物はそれを再輸出する —— 製品コードが
  `@kaninabe/runtime/testing/**` を引けるのは**テストの軸の 3 分類だけ**である（境界の要素 `runtime-testing`）。
- **実行方法**: `npm run test:integration`（ほかの統合テストと同じ。表ごとに `world` を作って捨てる）。
  オラクル自身のユニットテストは `__tests__/rls-oracle.unit.test.ts` で、実 DB を使わないので
  `npm run test` の担当である（`*.unit.test.ts` だけが `__tests__` の中でユニット側に属する）。
- **手で書くのは T8 が報告した表だけである。** `world` を宣言から作れない表（`formal` の無い不変条件・数の
  上限・状態依存・トリガが行の置き場を決める）は生成されず、理由を `npm run verify` の **T8** が warning で
  1 件ずつ報告する。そこに挙がった表の RLS は手書きの `{aggregate}/rls.test.ts` が受け持つ（方式と判定表の正は
  [ARCH-SP-BE-0001 §挙動の突合](../../../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)）。
- **生成テストの置き場に手で足さない。** 置き場の閉世界（設計図に載る表と実在するファイルの一致）は
  `__tests__/rls/behaviour-coverage.test.ts`（保証 `policy_body_from_spec` の見張りテスト）が見る。

### 一致の証明（engine ⇔ RPC）は生成物である（束 ⑳-5a）

**「この操作をこの人が実行できるか」を手で並べない。** `npm run generate` が
`app/src/infrastructure/__tests__/generated/equivalence/{集約名}.eq.test.ts` を集約ごとに書き、その集約を
動かす操作ごとに 1 本 + `world` の検算 1 本を置く。テストケースの宣言（`TC-EQ-{集約名}-{番号}`）も data_table の `test_cases` の
生成ブロックである（RLS の挙動テストと同じ扱い）。

- **何と比べているのか**: 期待は **engine そのもの**（`canFire` / `canCreate` / `canWrite` / `canDelete`）で
  あり、実測は実 DB が返した errcode である。RLS のオラクルと違って「第 3 の判定器」を置かないのは、
  確かめたいのが**TS の先読みと DB の執行が同じ判定を下すか**だからである —— 片方を書き写した判定器を
  足しても、その写し間違いが新しい穴になるだけである。写像は `refusal-codes.ts` の 1 表だけである。
- **実行するのは標本ではなく全列挙である**。軸は 5 本（対象の状態 × 実行者 × ロール配列 × ガード変数の
  境界値 × 編集の欄）で、どれも仕様から出る。掛け算は実行する側が行い、設計図
  （`@/domain/generated/eq-worlds.ts`）は軸と直積の**大きさ**だけを運ぶ。
- **畳むときに残すのは「成立させる値 + 不成立にする値」である**。直積が上限を超えたらガード変数の値を
  減らすが、宣言順の両端を残してはならない —— 成立側がまるごと落ちて、**許可される組み合わせを 1 つも
  実行しないテスト**になる（その操作はどちら向きの変異でも赤にならない）。残す値は **V9 と同じ充足性判定
  （`satisfiability` の witness）**から選ぶ：規則ごとに 1 つ（規則が複数あるなら規則の数だけ）と、
  どの規則も成立しない値を 1 つ。畳んだ変数と残した値は**テスト名に出る**
  （`(畳んだ軸 guard: item.state 成立 available 不成立 draft)`）。
- **拒否に何を求めるかは data_table の宣言で決まる**。本文が生成物の RPC は errcode の**理由まで**一致し、
  `handwritten:` を宣言した本文は理由を返さず 0 行で返り（可否だけが一致する）、`shape: composite` の
  RPC は判定そのものを持たない（守っているのは engine だけ）。免除リストではなく、宣言を外せば理由まで
  見られるようになる。
- **許可の側で不変条件の執行点（SQLSTATE クラス 23）に当たるのは一致である**。engine は不変条件を
  予測しない（`ActionError` が `invariant_violated` を別の分類として持つ理由）。engine が拒否したのに
  制約で落ちた、という組み合わせは食い違いのままである。
- **実行方法**: `npm run test:integration`（集約ごとに `world` を作り、実行する直前に対象の行を置き直す）。
  `world` の作り方も引数の組み立ても期待も仕組み側の手書き（`__tests__/eq-{world,args,oracle,expect}.ts`）で
  あり、生成テストは**設計図と操作 ID を渡して実行するだけ**である。
- **手で書くのは T11 が報告した集約だけである。** `world` を宣言から作れない集約（判定は T8 とまったく同じ）は
  生成されず、理由を `npm run verify` の **T11** が warning で 1 件ずつ報告する。そこに挙がった操作は手書きの
  差分テスト（`__tests__/schema/rpc-engine-equivalence.test.ts` がその形）が受け持つ。
- **生成テストの置き場に手で足さない。** 置き場の閉世界は
  `__tests__/schema/equivalence-coverage.test.ts`（保証 `rpc_enforces_spec` の見張りテスト）が見る。
  同じ見張りテストが「**どの操作も** engine が許可する組み合わせを 1 つ以上実行する」ことも数える（畳みが
  成立側を落としていないことの検出器）。

### 保存点の一致の証明も生成物である（束 ⑳-5a2）

**「この保存点をこの人が実行できるか」も手で並べない。** `npm run generate` が
`app/src/composition/__tests__/generated/equivalence/{ユースケース名}.uc.eq.test.ts` をユースケースごとに
書き、保存点ごとに 1 節（`describe`）× 3 本（判定の全列挙・書き込み経路の全列挙・`world` の検算）を置く。
テストケースの宣言（`TC-EQ-UC_{ユースケース名}-{番号}`）も usecase_spec の `test_cases` の生成ブロックである。

- **置き場が配線の層なのは層境界の帰結である**。期待は実行器（`operation/_template` の `decideStep`）が
  出し、実測は実 DB（`infrastructure`）を実行する。その 2 つを同じテストの中で使えるのは配線の層だけである
  （`infrastructure` から `operation` の関数本体は呼べない）。
- **期待は実行器そのものである**。手順の順に `decideStep` を回し、**最初に落ちた手順とその理由**を取る。
  `p_actor_roles` も実行器の `planActorRoles` が作る —— テストが自分で配列を組むと、期待（文脈から
  ロールを解決する）と DB（配列を見る）が**実行時にありえない組み合わせ**で比べられる。
- **突合は単発の操作より 1 段強い**。複合 RPC が上げる例外の本文には**落ちた手順の操作 ID** が載るので
  （`usecase_forbidden:{op}`）、分類だけでなく「どの手順で落ちたか」まで一致を要求する。手順ごとの
  enforcement は data_table の宣言から決まり、`handwritten:` の手順は理由を返さず 0 行で返るので
  複合 RPC が**その手順の競合**として返す。
- **許可される組み合わせは行まで見る**。手順ごとの結果が全部あること（繰り返す手順は渡した件数ぶん）と、
  結末の状態が仕様の予測どおりであることを確かめる（複合 RPC は jsonb を 1 つ返すので、0 行を競合と
  読む規約はここには無い ——`emptyIsConflict: false` の形）。
- **軸は 2 つの grid に分かれる**。判定の grid は「外部集約の状態 × 実行者 × 呼び出し元の文脈 ×
  ガード変数の境界」、書き込み経路の grid は「繰り返しの件数 0 / 1 / 2 × 任意欄の有無 × 同じ `p_id` の
  再送」である。掛け合わせないのは**書き込み経路の軸が判定を 1 つも変えないから**であり（実行器は件数に
  関わらず全手順の `permit` を立てる）、入力を見る事実（`source.kind: 'input'`）を持つ保存点だけは件数と
  任意欄が判定の grid に入る（機械で見分ける）。
- **呼び出し元の文脈の 3 通りはその保存点を実行できる入口の全数である**。人の入口（実行者 id とセッションの
  プロフィールを持つ）／ システム起点（Cron・Webhook。実行者 id を持たない）／ 未ログインであり、
  実行時にありえない組み合わせ（**システム起点なのに実行者 id を渡す**等）は軸に無い。
  - **「id はあるがプロフィールが無い」は軸にある**（束 ⑳-5a2-b で記述を実装に合わせた）。人の入口 ×
    「実行者の集約に行が無い人」がまさにそれであり、**実在する形**である（認証はできるが、招待を
    受け取っただけでまだ行が無い人）。既定のログインロールの根拠は「行がある」ことなので、その人の
    セッションはプロフィールを運ばない —— 行の無い人の拒否がどこから来るかは、この組み合わせが答える。
- **再送の 2 回目に何が起きるかも計画の形から決まる**。最初の手順が作成なら冪等の錨があるので既存の行を
  読み直して同じ形を返し（行は増えない）、最初の手順が外の集約の状態を条件にする遷移なら競合になる。
- **保存点が作る集約の行は `world` に置かない**。`world` に要るのは「読む集約」と「作る行が指す集約」と「動かす
  だけの集約」であり、それを**同じ 1 本の系統**に置く（集約をまたぐ行内比較を満たすため）。その結果、
  T8 / T11 が「行を宣言から置けない」と報告した集約を**作る**保存点でも、証明は生成される。
- **実行方法**: `npm run test:integration`（保存点ごとに `world` を作り、組み合わせを 1 つ実行するたびに作られた
  行を消して設計図の姿に戻す）。ハーネスは仕組み側の手書き（`@kaninabe/runtime/testing/save/**`。製品側の
  `composition/__tests__/eq-save-{world,expect}.ts` は口を渡す生成物である）であり、生成テストは**設計図と鍵を
  渡して実行するだけ**である。
- **生成テストの置き場に手で足さない。** 置き場の閉世界は
  `composition/__tests__/equivalence-coverage.test.ts`（保証 `rpc_enforces_spec` の見張りテスト）が見る。
  同じ見張りテストが「**どの保存点も** 実行器が許可する組み合わせを 1 つ以上実行する」ことも**DB を使わないシミュレーションで**
  数える（(旧製品の保証台帳の行)。実 DB を使わずに設計図とオラクルだけで回るので、畳みが成立側を
  落とした日はここが反例を出す）。
- **実行する間に片付ける相手も宣言から決まる**。作る集約の表だけでは足りない —— 手順の RPC は
  `also_writes` に宣言した表（副作用の台帳・監査ログ）にも書くので、そこに一意の宣言があると
  **2 回目の許可**が SQLSTATE 23505 で落ち、それが「許可 + 制約違反 = 一致」として飲まれる。したがって
  片付ける相手は「作る集約の表 ∪ 全手順の `also_writes`」であり、**追記専用を宣言した表**（削除で実行する
  トリガを持つ表）だけは消せないので設計図が報告して飛ばす（`cleanup.appendOnly`）。
- **拒否の側を比べない手順があるなら、テスト名がそう示す**。`shape: composite` を宣言した手順は
  判定を持たないので、そこで落ちるはずの組み合わせについてテストは何も実測していない ——
  「全 N 通りで一致する」とだけ書くと主張が実際より広くなるので、**畳んだ軸と同じ流儀で**
  「どの手順も判定を持たない（composite）」を名前に出す。`handwritten:` の手順は含めない（可否は
  複合 RPC の競合として比べられており、返さないのは理由だけである）。

## 5. 記述ルール

- **テスト間でデータを共有しない**。各テストはトランザクションで囲んでロールバックするか、対象テーブルを明示的に初期化してから始める。
- **実行者（actor）を明示する**。権限が絡むテストでは、どのロールとして実行しているかをセットアップで明示し、ロール ID は `roles.md` の ID を使う。
- **読み取りクエリのテストは、返却形を `toEqual` の全体比較で検証する**（プロパティを 1 つずつ拾わない）。`query_spec` の `projection` と実装の一致を見る機械的な検査は現時点で存在せず（[enforcement-matrix.md](../enforcement/enforcement-matrix.md) の Q3 は未実装）、**全体比較だけが「宣言していない列が混ざっていないこと」を検出できる唯一の防壁**である。`expect.any()` で逃がしてよいのは、実行のたびに変わる値（採番された ID）に限る。
- **RLS のテストは「見えること」と「見えないこと」の両方を書く**。`access_spec` の `reads` に `scope: none` と宣言されたロールについて、実際に 0 件であることを確認する（PRIN-0010）。**ただし手で書くのは下記の例外の表だけである** —— 生成される挙動テストは、実行者ごとの可視集合を宣言から独立に計算して両側とも見る。
- **不変条件のテストは違反側を必ず書く**。制約が実在し、違反が拒否されることを確認する（`enforced_by` の `ref` が実在するだけでは守られていない）。
- Server Action のテストでは、**戻り値の分類**（`guard_unsatisfied` / `forbidden` / `invariant_violated`）まで確認する。成否だけを見ない。
- outbox に積まれたジョブは、**行の存在と `type`** を確認する。副作用の実体（通知の送信）は統合テストの対象にしない。

## 6. Constraints

- **してはいけないこと:** DB をモックする。モック DB に対する統合テストは、名前だけの統合テストである。
- **してはいけないこと:** 本番・ステージングの DB に対して実行する。
- **してはいけないこと:** 外部サービスの実体を呼ぶ。アダプタはテスト用実装に差し替える（IF 注入。モジュール差し替えは禁止）。
- **してはいけないこと:** テストの成否が実行順序に依存する書き方。
- **してはいけないこと:** RLS を無効化して（サービスロールで）権限テストを書く。第二防衛線を検証する目的が消える（PRIN-0009）。

## 7. Testing Rules

- **責務**: 「アプリの判定」と「DB の執行」が同じ仕様を指していることの確認。片方だけを直して乖離させないための装置である。
- **粒度**: 1 テスト 1 仕様。Server Action の通しでも、確認するのは 1 つのドメインイベントの 1 つの結末とする。
- **モック方針**: 差し替えてよいのは外部サービスのアダプタ（IF）と時刻のみ。DB は差し替えない。
- **仕様との対応**: 統合テストが守る仕様 ID は `action_spec` の `test_cases`（`type: integration`）に宣言する。宣言のないテストは orphan として突合器が検出する（PRIN-0008）。

## 8. Minimal Example

- **実例:** 題材の通し実行は `legacy/spec-tools/__tests__/fixtures/samples/`（`samples:db`）にある。統合テストは **RLS**（anon キー + ユーザ JWT による実ユーザー検証）、**infrastructure**（原子性・DB 制約による不変条件）、**通し**（Composition Root → 実 DB）の 3 パターンを書く。
