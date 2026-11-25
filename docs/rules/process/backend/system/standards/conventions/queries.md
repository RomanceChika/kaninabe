---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0003, PRIN-0005, PRIN-0007, PRIN-0008, PRIN-0009, PRIN-0010, ARCH-BE-0001, ARCH-BE-0016, ARCH-SP-BE-0001]
decisions: [ADR-0003, ADR-0006]
---

# クエリ関数の実装規約

読み取りクエリ（`query_spec` の実装）の書き方を固定する規約。経路と執行点の契約は ARCH-BE-0016 が正であり、ここでは**そのとおりに書くための形**（配置・命名・定型 3 手順・戻り値・禁止事項）を定める。

## 1. 目的・スコープ

- **目的:** `query_spec` 1 本から出てくる実装を 1 通りに固定する。実装を「宣言の写像」に痩せさせ、可視性の判断がコードに現れない状態を保つ（ADR-0003 の精神を読み取り側に適用したもの）。
- **スコープ:** `app/src/composition/{aggregate}/queries.ts`（配線）と `app/src/infrastructure/{aggregate}/queries.ts`（写像）、およびそれを呼ぶ RSC の境界。**画面に返す読み取り**が対象であり、operation / ワーカーが書き込み前に `service_role` で読む処理は対象外（そちらは [server-actions.md](./server-actions.md)）。
- **正の所在:** 経路・執行点・この経路が守らないものは [ARCH-BE-0016](../../../../../architecture/system/backend/ARCH-BE-0016-read-path.md)。仕様の書き方は [query-spec-writing.md](../../../specification/standards/query-spec-writing.md)。可視性の正は `docs/specs/domain/{aggregate}/access.md` の `reads` / `fields_hidden`。

## 2. ルール

### 配置と命名

- **すべきこと:** `query_spec` の `name` から機械的に導く。**1 クエリ = 配線 1 つ + 写像 1 つ**である。

| 仕様 | 配線（`composition`） | 写像（`infrastructure`） | テスト |
|------|---------------------|------------------------|--------|
| `docs/specs/backend/queries/item/item_list.md` | `app/src/composition/item/queries.ts` の `itemListQuery` | `app/src/infrastructure/item/queries.ts` の `selectItemList` | `app/src/composition/__tests__/item/item_list.test.ts` |
| `docs/specs/backend/queries/hold/desk_hold_list.md` | `app/src/composition/hold/queries.ts` の `deskHoldListQuery` | `app/src/infrastructure/hold/queries.ts` の `selectDeskHoldList` | `app/src/composition/__tests__/hold/desk_hold_list.test.ts` |

- **すべきこと:** 1 集約 1 ファイル（`queries.ts`）に、その集約の `query_spec` の数だけ export を並べる。ファイルが 300 行に届いたら、それは 1 集約の読み取り経路が多すぎるサインとして扱い、集約の切り方を見直す。
- **すべきこと:** どちらのファイルも先頭に `import 'server-only'` を書く（`composition` / `infrastructure` の既定。ARCH-BE-0001 の E7）。
- **してはいけないこと:** `get` / `fetch` を関数名に付ける。名前は `{camelCase(name)}Query` と `select{PascalCase(name)}` の 2 つに固定であり、動詞の選択肢は無い（`query_spec` の `name` 側に動詞を含めないのは query-spec-writing.md §name）。
- **してはいけないこと:** 集約ディレクトリを `query_spec` の `source` と食い違わせる。仕様のパスが正である。
- **してはいけないこと:** `src/operation/{aggregate}/queries.ts` を作る。読み取りは operation を経由しない（この配置はリンター `layer/operation-naming` が落とす）。

### 定型 3 手順（配線側）

- **すべきこと:** `composition` 側の本体は次の順序でのみ書く。3 つとも 1 回ずつ、これ以外のことをしない。

1. **パース**: `params` を zod で検査する。スキーマは `ref` が指す生成 zod スキーマのフィールドから借りる（`loanRowSchema.shape.item_id` のように取り出して組む）。制約の正は `entity_spec` であり、クエリ側で書き直さない（PRIN-0007）。`params` が無いクエリではこの手順は消える。
2. **配線**: 実行者のセッションから **JWT 付きクライアント**を組み立て、`infrastructure` の写像関数に渡す。未ログインでもクライアントは作り、「読めない」の判定は DB に任せる（早期リターンしない）。
3. **返却**: `QueryResult` で返す。DB からのエラーは想定外の失敗として throw する（握りつぶして `ok: false` にしない）。

- **JWT 付きクライアントの作り方（確定）:** `app/src/infrastructure/supabase/session.ts` の `createRequestClient()` を使う。`@supabase/ssr` の `createServerClient` にリクエストの cookie を渡すだけのもので、actor 解決（`resolveAuthenticatedUserId`）も同じ関数の上に載っている（セッションの読み方を 2 通り持たない）。`client.ts` の `createAnonClient(accessToken)` は**トークンを引数で受ける形**なので、統合テストのように cookie が無い文脈でだけ使う。

```ts
// app/src/composition/{aggregate}/queries.ts（配線の形）
export async function itemDetailQuery(
  params: unknown,
  client?: RlsClient,          // 省略時はセッションから作る。テストだけがここに RLS 有効クライアントを渡す
): Promise<QueryResult<ItemDetail | null>> {
  const parsed = itemIdSchema.safeParse(params);           // ① パース（ref の指す生成スキーマから借りる）
  if (!parsed.success) return err({ kind: 'invalid_input', issues: toFieldIssues(parsed.error) });
  return ok(await selectItemDetail(await readerClient(client), parsed.data.item_id)); // ② 配線 ③ 返却
}
```

- **クライアントを引数で受けられるようにしている理由（W3 の実測で判明した穴）:** `createRequestClient()` は `next/headers` の `cookies()` を呼ぶため、**リクエスト文脈の無い vitest からは配線を 1 行も実行できない**。書き込み側が「Server Action は cookie から actor を解決するので、テストは Composition Root を入口にする」としているのと同じ事情であり、読み取りではその境界が配線の内側に食い込む。そこで**省略可能な引数**を 1 つだけ空け、テストは anon キー + ユーザ JWT のクライアントを渡す（実 RLS 経路は保たれる）。**ここに `createServiceRoleClient()` を渡してはならない**（リンターはファイル内の import しか見ないので、渡す側の責任になる）。セッションのテストハーネスが入ったらこの引数は消す。
- **してはいけないこと:** 実行者（actor）を `params` として呼び出し側から受け取る。actor はサーバー側のセッション（読み取りに使うクライアント自身）からのみ導く（PRIN-0009）。呼び出し側から `patron_id` を受け取って自分の分だけ引く、という設計は**可視性を呼び出し側に委ねている**ので採らない（query-spec-writing.md §三分法）。
- **してはいけないこと:** `composition` に問い合わせ（`from(...).select(...)`）を書く。配線と入力検査だけを置く。

### 写像（`infrastructure` 側）

- **すべきこと:** クライアントを引数で受け取り、`query_spec` の宣言を**そのまま**問い合わせに写す。`projection` → 列、`filters` → `.eq()` / `.in()` / `.neq()` 等、`sort` → `.order()`、`paging` → `.limit()` / `.range()`。
- **すべきこと:** 返す形は行の配列（`returns: many`）か 1 件 / `null`（`returns: one`）とし、列名からドメインの語彙への詰め替えまでをここで行う（既存のリポジトリ実装と同じ扱い）。
- **してはいけないこと:** 写像の中でクライアントを作る。クライアントの選択（誰として読むか）は配線の責務であり、写像に埋めると経路が読めなくなる。

### 列は宣言どおりに

- **すべきこと:** 問い合わせる列を `projection` と 1 対 1 で一致させる。併読（`includes`）の埋め込み取得も、その `projection` と一致させる。
- **してはいけないこと:** `select('*')` と書く（リンターが落とす）。
- **してはいけないこと:** 「ついでに使うから」と宣言に無い列を足す。要るなら仕様の `projection` に足してから実装に足す（PRIN-0001）。
- **注意:** この一致が防ぐのは**アプリが取り過ぎること**だけである。**列の隠蔽そのもの**（`fields_hidden`）は別の執行点が守る — PostgREST が実際に見るのは仕様から生成した `api` スキーマのビューだけで（`public` は `surface` から外れている）、隠し列は見せてよい人以外には元から NULL を返す。理由と手段の一覧は [ARCH-BE-0016 の「守るもの・守らないもの」](../../../../../architecture/system/backend/ARCH-BE-0016-read-path.md) が正。

### select / order / limit は生成物から

`projection` / `includes` / `sort` / `paging` の宣言 ⇔ 実装の一致は、**突合ではなく生成で閉じる**（BACKLOG「Q 系の突合強化」の決定）。`npm run generate` が `query_spec` 1 本ごとに `app/src/domain/generated/query-fragments.ts` の `queryFragments.{name}`（`{ select, order, limit }`）を出し、写像は**それを適用するだけ**にする。

- **すべきこと:** `.select(fragment.select)`、並びは `applyOrder(builder, fragment.order)`、上限は `applyLimit(builder, fragment.limit)`（3 つとも `infrastructure/supabase/query-window.ts`）を使う。列名・並び順・件数を手で書かない。
- **してはいけないこと:** `.select()` / `.order()` / `.limit()` / `.range()` に文字列・数値・テンプレートリテラルを直書きする（`select('*')` を含む。ESLint が落とす — enforcement-matrix.md の Q9）。
- **例外は理由つきの `eslint-disable-next-line` で明示する。** generate で導けない判断（併読の埋め込みを「必ず 1 件」として型づけるための `!inner` のような**型カーディナリティの決定**、`sort` の DSL にまだ無い並び方）だけが対象で、可視性や絞り込みの判断をここに書いてはならない。実例: `app/src/infrastructure/loan_companion/queries.ts`（select の例外）。
- **`sort` に `nulls_first` / `nulls_last` を書けば null の位置も生成物に含まれる**（query-spec-writing.md §sort）。DSL に無い並び方に当たったときだけ、上記の例外の形で手書きに逃がす。

### 行の選別は「宣言からの写し」だけを書く

可視性の執行は二層である（ARCH-BE-0016）。**上界**（見えてはいけない行が返らない）は RLS が持ち、**スコープ条件**（宣言したとおりの集合が返る）は写像が持つ。スコープ条件は `via` のロールの `binding` からの決定的な写しであり、**写す作業は機械の仕事である**。

- **すべきこと:** スコープ条件は生成物 `@/domain/generated/query-windows`（`queryActorConditions`）から引き、`applyActorConditions`（`infrastructure/supabase/query-window.ts`）で適用する。**列を手で書かない**。

```ts
const { data, error } = await applyActorConditions(
  client.from('loans').select(OWN_COLUMNS).eq('item_id', itemId),
  queryActorConditions.loan_own_list,
  actorId,
);
```

| 宣言 | `binding` | 生成される列 |
|------|-----------|------------|
| `scope_used: own` / `via: loan_owner` | `loan.patron_id == actor.id` | `patron_id` |
| `scope_used: context(item)` / `via: item_librarian` | `item.librarian_id == actor.id` | `items.librarian_id`（親への内部結合を `select` に用意する） |
| `via: account_owner`（相手の主キー） | `patron.id == actor.id` | 手前の外部キー列（例: `issued_by`）に畳む |
| `includes` の `via` | 同上 | 併読先のテーブル名を接頭辞に持つパス（例: `notes.loans.patron_id`） |

- **すべきこと:** 生成されたスコープ条件が効く相手（親への内部結合 `items!inner(librarian_id)` など）は `select` の文字列に用意する。**返すためではなく絞るため**の結合であり、結合先の列は呼び出し側に返さない。
- **してはいけないこと:** `actorId` を `.eq()` に直接渡す（**リンターが落とす**）。足したい条件があるなら `query_spec` か `roles.md` を直して `generate` する。

- **すべきこと:** 実行者は**クエリに使うクライアントと同じセッション**から導く。別経路の ID を受け取れる形にすると、上界とスコープ条件が別の主体を指す状態を作れてしまう。
- **してはいけないこと:** 実装が考えた行の選別を書く。次はすべて禁止であり、書きたくなったら置き場所が違う。

| 書きたくなったもの | 正しい置き場所 |
|-------------------|--------------|
| `if (role === 'patron') { 他人の行を除く }` | `access_spec` の `reads`（ロールで分岐せず、宣言を直す） |
| `.eq('patron_id', actorId)` を **`via` の宣言なしに**書く | `query_spec` の `via`（先に宣言してから写す） |
| 「下書きは一覧に出さない」 | `query_spec` の `filters`（宣言してから写す） |
| 取得後に `filter()` / `find()` / `slice()` で件数を絞る | `query_spec` の `filters` / `paging`（DB 側で絞る。`.filter()` / `.find()` はリンターが落とす） |

- **判断の目安:** 書いた `.eq()` / `.in()` が `query_spec` の `filters` / `params` / **`via` のロールの `binding`** のどれかに 1 対 1 で対応しないなら、それは仕様に無い絞り込みである。仕様を直すか、その行を消す。
- **執行は 3 枚である。** ①スコープ条件の列は生成物（宣言からの機械的な写し）②手書きの口はリンターが塞ぐ（`actorId` を `.eq()` に直接渡せない）③生成が間違う可能性は**スコープ条件の見張りテスト**（統合テスト）が守る。②が見るのは `actorId` を使う条件だけなので、`param` で決まる併読の絞り込み（「どの蔵書か」）は今も手書きであり、そこはレビューとスコープ条件の見張りテストが担う。

### 戻り値の型

- **すべきこと:** すべてのクエリ関数は `QueryResult` を返す。型は `@kaninabe/runtime/result` に 1 組だけ定義し、全クエリで共用する（PRIN-0007）。

```ts
// framework/runtime/src/domain/result.ts（抜粋・形の定義）
/** 読み取りで起こりうる失敗。可視性による拒否は「0 件」として返るのでエラーにならない。 */
export type QueryError = Extract<ActionError, { kind: 'invalid_input' }>;

/** すべてのクエリ関数の戻り値。 */
export type QueryResult<T> = Result<T, QueryError>;
```

- **すべきこと:** `returns: many` は配列（0 件は空配列）、`returns: one` は `T | null`（見つからなければ `null`）を成功値にする。
- **してはいけないこと:** 「見えないので 0 件」をエラーとして返す。**RLS による不可視は正常な結果**であり、呼び出し側が権限エラーとして扱えてしまう形にしない。
- **してはいけないこと:** 逆に、未ログイン・セッション切れのエラーを握って 0 件に化けさせる。`anon` にはテーブルの `SELECT` 権限を与えていないため、これらは**エラーとして表面化する**（黙って空にならないのは望ましい性質である。ARCH-BE-0016「守らないもの」）。ログインへの誘導は画面側の責務であり、クエリ層はエラーをそのまま throw する。
- **してはいけないこと:** 書き込み側の `ActionError`（3 分類）を読み取りで使う。読み取りにドメイン上の拒否は現れない。

### 使ってよいクライアント

- **すべきこと:** 画面に返す読み取りは JWT 付きクライアント（RLS 有効経路）で行う。**型として `RlsClient` だけを受け取る**（`app/src/infrastructure/supabase/client.ts`）。写像も配線も引数の型はこれであり、`AppSupabaseClient`（素の型）に緩めない。
- **すべきこと:** クライアントの素性は**非公開の unique symbol による封印**で区別する（`RlsClient` / `ServiceClient`）。`kind: 'rls'` のような公開プロパティで区別すると、同じ形の値を作って偽造できてしまう（状態機械の `FireAllowed` と同じ理由・同じ方式）。封印を押せるのは `infrastructure/supabase/` の生成関数だけである。
- **してはいけないこと:** `queries.ts` で `createServiceRoleClient()` を使う・import する（リンターが落とす）。RLS をバイパスした時点で、可視性を守っているものが 1 つも無くなる（PRIN-0009 / PRIN-0010）。
- **してはいけないこと:** クライアントの受け口を `AppSupabaseClient` で宣言する。リンターが見るのは `queries.ts` の**中**だけなので、**外から service role を渡される**経路は型でしか塞げない（enforcement-matrix Q7。性質は `app/src/composition/__tests__/queries/client-brand.test.ts` が `@ts-expect-error` で固定している）。
- `service_role`（`ServiceClient`）を使ってよいのは、operation / ワーカーの内部で書き込みの前に読む場合だけである（`composition/{aggregate}/{event}.ts` の配線。ARCH-BE-0016「書き込みの内部で読む場合」）。

### テスト

- **すべきこと:** クエリのテストは**統合テスト**（実 DB・実 RLS）で書く。配置は `app/src/composition/__tests__/{aggregate}/{name}.test.ts`（配線を入口にして通す）、書き方は [testing/integration.md](./testing/integration.md)。
- **すべきこと:** 各テストに `// @spec {spec_id} @tc {テストケースID}` を書き、`query_spec` の `test_cases[].implementation` と**テスト名まで一字一句一致**させる。突合は双方向（仕様側 Q6 / テスト側 A6）で走る。
- **すべきこと:** 「見えること」と「見えないこと」の両方を書く。少なくとも 1 本は、**読めないロール（`reads` が `scope: none`、または他人の行）で 0 件になる**ことを確かめる。これが RLS 側の担保であり、`filters` の担保ではない。
- **してはいけないこと:** `service_role` クライアントで権限テストを書く（第二防衛線を無効化した状態の確認は何も保証しない）。ユニットテストだけでクエリを済ませる（RLS を通らないテストは「見えてはいけない行が見えない」ことを 1 つも保証しない）。

## 3. 注意点・例外

- **`params` のパースは当面手書きである。** `query_spec` の `params` から zod スキーマを生成する生成器はまだ無い。生成器を入れる場合は `app/src/domain/generated/` に出力し、手書きのパースを置き換える（生成物が入った時点でそちらが正になる。ADR-0006）。それまでは「`ref` の指す生成スキーマからフィールドを借りる」形を守り、制約を書き写さないこと。
- **`filters` の写し方に自由度が残る。** `state != draft` を `.neq('state','draft')` と書くか `.not(...)` と書くかは実装者が選ぶ。**選んでよいのは書き方だけで、条件そのものは選べない**。仕様に無い条件が 1 つでも増えたらレビューで落とす。将来この写像を機械検査（`filters` ⇔ 実装の突合）に上げる余地はあるが、v1 では持たない。
- **RLS ポリシーの過不足**は、`app/src/domain/generated/rls-expectations.ts` と `pg_policies` の突合テスト（`app/src/infrastructure/__tests__/rls/policy-parity.test.ts`）が見る。見るのは 2 つで、**読み取りポリシーの名前の過不足**と、**`USING` 句の意味**（`policies_migration` の生成ファイルをトランザクションで適用して `pg_policies` を読み直し、実 DB と `qual` / `roles` / `cmd` を比べる。束 ⑳-4a）である（ARCH-SP-BE-0001）。ロールごとに実際の可視行を確かめる RLS 挙動テストはその上にもう 1 段ある（突合は「生成物どおりか」までしか言えない）。新しい集約を足したら、`access_spec` → 期待表 → `policies_migration` → 適用 の 4 点が揃うまでこのテストが落ち続ける。
- **機械執行の範囲は限られている。** `service_role` の使用禁止と `select('*')` の禁止は `**/queries.ts` に対して ESLint が落とす（[enforcement-matrix.md](./enforcement/enforcement-matrix.md) の Q1〜Q2）。配置と命名（配線は `{camelCase(name)}Query`、写像は `select{PascalCase(name)}`、置き場は `{aggregate}/queries.ts`）は `layer/query-naming` が落とす（同表の Q5）。一方、`projection` と実装の一致・行の選別を書かないことは**まだレビュー執行**である（同表に未実装として載せてある）。機械執行に上げたら、規約と対応表を同時に改訂する。
- **`layer/query-naming` が見るのは名前の形だけである。** 1 ファイルに複数のクエリが並ぶため、パスから export 名を 1 つに決められない（書き込み側の `action-naming` との違い）。「`item_list` という `query_spec` に対応する実装があるか」は Q6 の `@tc` 突合が見る。
- 実例は `docs/specs/backend/queries/` と `legacy/spec-tools/__tests__/fixtures/samples/` にある。仕様・写像・配線・統合テストの 4 点を 1 本のクエリで通して読める。

## 4. 関連ドキュメント

- [ARCH-BE-0016 — 読み取り経路の構造](../../../../../architecture/system/backend/ARCH-BE-0016-read-path.md)（経路・執行点・限界の正）
- [server-actions.md](./server-actions.md)（書き込み側の対になる規約）
- [query-spec-writing.md](../../../specification/standards/query-spec-writing.md)（対応する仕様の書き方・三分法・Q0〜Q7）
- [testing/integration.md](./testing/integration.md)（統合テストの書き方）
- [enforcement/enforcement-matrix.md](./enforcement/enforcement-matrix.md)（機械執行ルールの全件一覧）
- [ARCH-SP-BE-0001](../../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)（`query_spec` の配置と RLS の突合方式）
