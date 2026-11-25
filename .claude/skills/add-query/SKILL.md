---
name: add-query
description: 読み取りクエリを1本追加する完全手順。query_spec（三分法・for/via・二層モデル=スコープ条件の要否判定）→ Q検査 → 写像+配線（命名・RlsClient）→ 統合テスト（スコープ条件の見張りテストの作り方）→ 全検査。「一覧を出したい」「この画面用のデータを読みたい」「クエリを1本足す」ときに使う。
---

# 読み取りクエリを1本追加する

このリポジトリは**仕様が正（Spec as Truth）**である。実装を先に変えて仕様を後追いさせない。
このスキルは**手順の索引**であり、内容の正ではない。各手順の「正」に挙げた文書を必ず開く
（表とリンク先が食い違ったらリンク先が正）。

## このリポジトリの進め方（ビルダー×レビュアー）

まとまった変更は **設計凍結 → ビルダーが実装 → 独立したレビュアーがレビュー → 裁定を反映** の4段で回す。
ビルダーは凍結した設計から外れる判断をしたら、その場で直さず**理由つきで報告**する。
レビュアーは実装を読まずに仕様と正典から期待を組み立て、差分を指摘する。
裁定は製品の作業記録に残し、正式化できるものだけ `docs/rules/` に昇格させる。
クエリ1本のように閉じた作業では、ビルダー1人が **①⑤の全検査緑 ②自己レビュー（下の「スコープ条件の見張りテストの自己診断」）** で代替してよい。

## 先に読む正典

| 何を | どこ |
|------|------|
| `query_spec` の書き方（三分法 / for・via / M2 / Q0〜Q7） | [query-spec-writing.md](../../../docs/rules/process/backend/specification/standards/query-spec-writing.md) |
| 可視性の正（`reads` / `fields_hidden`）とガード式の文法 | [domain-spec-writing.md](../../../docs/rules/process/common/specification/standards/domain-spec-writing.md) §access_spec / §ガード式の文法 |
| 実装規約（配線・写像・クライアント・戻り値） | [queries.md](../../../docs/rules/process/backend/system/standards/conventions/queries.md) |
| 経路・執行点・守らないものの契約 | [ARCH-BE-0016](../../../docs/rules/architecture/system/backend/ARCH-BE-0016-read-path.md) |
| 統合テストの書き方 | [testing/integration.md](../../../docs/rules/process/backend/system/standards/conventions/testing/integration.md) |
| 仕様→写像→配線の実例 | [samples/](../../../legacy/spec-tools/__tests__/fixtures/samples)（図書館の題材ほか） |

---

## ① そもそも `query_spec` にするか

**RLS に依存して「自分以外のデータに触れうる」読み取り経路は、すべて仕様化する。** 判断基準は「アプリの絞り込みを外したら他人のデータが返り得るか」であり、画面の重要度でも件数でもない。

| 読み取り | 仕様化するか |
|---------|:---:|
| 画面に返す読み取り（一覧・詳細・自分の分だけ含む） | **する** |
| 書き込み操作の内側で、直前に書いた行を読み直す | しない（`action_spec` の内側） |
| `system` / service_role でのジョブ処理 | しない（RLS をバイパスする経路） |

**迷ったら仕様化する。** 宣言のコストは1ファイルだが、宣言しなかった読み取り経路は検証器の視界に入らない。

## ② query_spec を書く

置き場は `docs/specs/backend/queries/{source}/{name}.md`（**ディレクトリは `source` と同名・1段固定**。Q0 が検査する）。
テンプレート: [`docs/specs/backend/queries/template.query_spec.md`](../../../docs/specs/backend/queries/template.query_spec.md)。
スキーマの正: [query-spec-writing.md §スキーマ](../../../docs/rules/process/backend/specification/standards/query-spec-writing.md)。

### 判定1 — 三分法（絞り込みらしきものの置き場）

**置き場所を間違えると安全性が壊れる。**

| 絞り込みたいもの | どこに書くか | 誰が執行するか |
|----------------|------------|--------------|
| 「**どの**蔵書の」「**どこから**の続き」— 呼び出しのたびに変わる値 | `params`（`filters` から `param.{name}`） | アプリ（クエリの引数） |
| 「返却済みの貸出は一覧に出さない」— **いつ実行しても同じ**、UX上の取捨選択 | `filters` | アプリ（WHERE句） |
| 「他人の貸出は見えない」— **誰に見せてよいか** | `access_spec` の `reads` / `fields_hidden`（どの宣言を使うかは `scope_used` / `via`） | DB（RLS＝上界）＋ `binding` から導いた絞り込み（スコープ条件） |

**自己診断:** `filters` を全部消したときに、見えてはいけないものが見えるなら、それは `access_spec` の宣言が間違っている。
`params` に「見せてよい範囲を絞るためのID」を渡す設計（呼び出し側が `patron_id` を渡す等）は**可視性を呼び出し側に委ねている**ので採らない。

### 判定2 — `for` と `via`

読み取りには「誰が実行するか」と「その行がなぜ見えるか」の2つの問いがあり、別の欄に分けて書く。

| 欄 | 何を書くか | 書けるロール |
|----|-----------|------------|
| `for` | **観客** — このクエリを実行する資格 | グローバルロール（`binding` を持たない）だけ。`patron` / `anonymous` / `system` |
| `via` | **可視性の供給元** — その実行者のどの**関係**が行を見せているか | 文脈依存ロール（`binding` を持つ）だけ。`loan_owner` / `hold_owner` |

**`via` を書くかの判定:**

| 状況 | `via` |
|------|-------|
| `for` のロール自身の `reads` で、そのクエリが返す行が全部読める | **書かない**（借用の条件③に反する。Q2 がエラーにする） |
| `for` のロール自身では読めない行を読む | **書く** |

`via` を書くと、`scope_used` の突合先も隠しフィールドの判定基準（Q3）もそのロールに切り替わる。
借用が成立する3条件（含意 / 関係スコープ限定 / 借用の要否）は
[query-spec-writing.md §via の借用が成立する3条件](../../../docs/rules/process/backend/specification/standards/query-spec-writing.md) が正。
`source` の `via` と `includes` ごとの `via` は**独立**で、`includes` は `source` の `via` を継がない。

複数ロールを `for` に並べてよいのは**全員の `reads` スコープが同じとき**だけ（違うなら別のクエリに分ける）。

### 判定3 — 二層モデル。スコープ条件が要るか

可視性の執行は二層である — **上界**（「これ以上は絶対に返らない」。RLS が執行）と**スコープ条件**（「宣言したとおりの集合が返る」。`via` のロールの `binding` から導かれる絞り込みが執行）。
言明（M2）と、なぜ上界だけでは足りないかの論証は
[query-spec-writing.md §健全性の言明（M2）](../../../docs/rules/process/backend/specification/standards/query-spec-writing.md) が正。
ここでは**書くか書かないかの判定**だけを置く。

| `scope_used` | スコープ条件（写像に書く絞り込み） |
|-------------|----------------------|
| `all` | **不要**。絞りが無いことが宣言そのもの（ただし下の例外形を読む） |
| `own` | **必ず要る**。`via` のロールの `binding`（例 `loan.patron_id == actor.id`）を実行者で具体化した写し |
| `context({entity})` | **必ず要る**。親への内部結合 + `binding` の写し |

**例外形 — 上界が `all` の集約で「自分の行」を読む**（実物は自分の製品の query_spec に置く。このデモ製品には無い）:

「自分のプロフィール」のように、`reads` は `all`（誰の行も見えてよい）なのに返すのは実行者自身の 1 件、という経路がある。

| 問い | 答え |
|------|------|
| `scope_used` | **`all`**（`reads` と一致させる。`own` とは書けない） |
| `via` | **書けない**（`own` の `reads` 宣言が無く、あっても借用の条件③に反する） |
| 絞り | **`filters` に `id == actor.id`**（`actor` は `filters` から参照できる予約語） |

- **`filters` の中の例外形である**（本来 `filters` は「いつ実行しても同じ取捨選択」）。許されるのは**消しても見えてはいけないものが 1 つも見えない**とき、つまり上界が `all` のときだけ。
- **見張りテストが必須**。この 1 行が守っているのは安全ではなく**宣言との一致**なので、消したら落ちるテストが無ければ誰も守っていない（書き方は⑤のスコープ条件の見張りテストと同じ 2 段）。
- 実行者が解決できないときは**問い合わせを投げない**（絞りの無い形を一瞬でも作らない）。
- 正: [query-spec-writing.md §例外形 — 上界が `all` の集約で「自分の行」を読む](../../../docs/rules/process/backend/specification/standards/query-spec-writing.md)

**併読（`includes`）にもスコープ条件が要る。省いてよいのは1つの条件のときだけ**:

> 併読先の**上界**（その実行者に対する RLS の許す集合）が、**親のスコープ条件と同等以上に狭い**とき。

判定で踏みやすい罠を2つだけ挙げる（詳細は同文書 §併読のスコープ条件を省いてよい条件）:

- **「不変条件があるから子は必ず親に属する」は根拠にならない。** 不変条件は DB の性質であって、この経路が宣言どおりの集合を返すことの根拠ではない。
- **上界は複数ポリシーの和である。** 併読先に**別の関係で繋がっている実行者**がいれば、その行は上界を通る。

**スコープ条件は実装の発明ではない。** 書いてよいのは `binding` の写しだけであり、それ以外の条件は `filters`（UX）か、そもそも `reads` の書き間違いである。
**写す作業は機械がやる** — 列は `npm run generate` が `app/src/domain/generated/query-windows.ts` に吐き、写像はそれを適用するだけである（④）。ここで判定するのは「スコープ条件が要るか」だけで、**列を手で決める場面はもう無い**。

### 判定3-b — `scope_used` に書きたい値が `reads` に無い

Q2 が「`scope_used` が `reads` 宣言と一致しません」で失敗したとき、**`query_spec` 側を書き換えて黙らせない**。
どちらが間違っているかを先に決める。

| 状況 | やること |
|------|---------|
| そのロールは業務上その行を読めるべきなのに `reads` が狭い | **`docs/specs/domain/{aggregate}/access.md` の `reads` を直すのが先**。可視性を広げる変更なので、①〜③（RLS ポリシーの migration・`rls-expectations.ts` の再生成・`policy-parity.test.ts` と `rls.test.ts` の追随）が付いてくる。事実上「ドメイン仕様の変更」であり、`/add-operation` の①②と同じ重さで扱う |
| 読めるべきでないものを読もうとしている | クエリの設計が間違っている。`via` で別のロールから借りるか、そもそも別のクエリに分ける |
| `for` のロール自身では読めないだけ | `via` を書く（判定2） |

### そのほかの必須判断

| 欄 | 判断 |
|----|------|
| `name` | snake_case。`get` / `fetch` / `select` を含めない（この仕様に載るものはすべて読み取りで、動詞は情報を持たない） |
| `id` | `query-{name をハイフン区切りにしたもの}` |
| `returns` | `one`（1件。無ければ無し）か `many`（0件以上） |
| `paging` | `many` のとき**必須**。`none`（全件）を選ぶ場合も「件数が業務上有界だと判断した」という宣言として明示。`one` に書けばエラー |
| `projection` | **必須**。露出範囲の宣言。「とりあえず全部」で並べない。`fields_hidden` で隠されるフィールドを含めない（Q3） |
| `includes[].projection` | **必須**（併読は露出の口である）。並びが意味を持つなら `sort` も書く（無ければ順序は未定義で、画面が「最初の1件」を選ぶ設計にできない） |
| `filters` の件数制御 | `paging` の上限より先に `filters` を考える。**上限は「切ってよい行」と「切ってはいけない行」を区別できない** |

### test_cases

`action_spec` と同形式（[action-spec-writing.md §test_cases](../../../docs/rules/process/backend/specification/standards/action-spec-writing.md) が正）。

- `id` は `TC-{AGGREGATE}-{NAME}-{NNN}`。**全仕様を通じて一意**（A9 が1つの台帳で見る）で**追記専用**（欠番は空席のまま残す）。既存IDは `grep -rhoE 'TC-[A-Z0-9_-]+' docs/specs | sort -u` で確認する。
- `covers` は**必須**（未記入はエラー。Q0）。値域は `action_spec` と同じ8分類。ただし読み取り側には A7 相当の網羅導出がまだ無いので、**書き漏らしは機械が検出しない** — 人間が数える。数える基準を持たないと「1本書いて終わり」になるので、**下の最低ラインを自分に課す**。

**読み取りの `covers` の最低ライン**（機械要求ではない。このスキルの規律として置く）:

| クラス | 置く条件 | 何を確かめるケースになるか |
|--------|---------|------------------------|
| `success` | **常に** | 宣言どおりの集合が、宣言どおりの並び・射影で返る（`toEqual` の全体比較） |
| `other`（上界） | **常に** | 読めないロール（`reads` が `scope: none`）または無関係な他人で 0 件 |
| `other`（スコープ条件） | `scope_used` が `own` / `context(...)` のとき、およびスコープ条件を持つ `includes` があるとき | **上界が広い実行者**で呼んで宣言どおりの集合しか返らない（⑤のスコープ条件の見張りテスト） |
| `not_found` | `returns: one` のとき | 存在しない ID で `null` |
| `invalid_input` は 8分類に無いので `other` | `params` があるとき | 型・形式の不正が `QueryError` になる（配線のパース） |

`covers` が `[success]` だけの `query_spec` は、**上界もスコープ条件も1つも確かめていない**と読む。
- `spec_ids` に書けるのは `query_spec` の id / `access_spec` の id / 不変条件 ID の値域（Q6）。**ドメインイベントIDは書けない**（読み取りは状態を動かさない）。
- **`type: integration` のケースを1つ以上持つ**（Q6 が要求）。RLS を通らないテストでは「見えてはいけない行が見えない」ことを1つも保証できない。

## ③ Q検査を通す

```bash
npm run verify
```

| 出たエラー | 何を直すか |
|-----------|----------|
| **Q0** スキーマ適合 | 必須欄・`id`⇔`name` の対応・ファイル名⇔`name`・**置き場のディレクトリ⇔`source`**・`returns`⇔`paging`・`covers` 未記入 |
| **Q1** フィールドの実在 | `projection` / `sort` / `params[].ref` / `includes[].projection` の綴り |
| **Q2** スコープ整合 | `for` がグローバルロールか / `scope_used` が `reads` と一致するか / `via` の借用3条件 |
| **Q3** 隠しフィールドの衝突 | `fields_hidden` で隠されるフィールドを `projection` / `sort` / `filters` で使っている |
| **Q4** 絞り込み式 | `filters` の文法・参照パスの解決・**`in` の値が state として実在するか**（綴り違いは式としては妥当なので、検査が無ければ「1件も返らない絞り込み」として黙って通る） |
| **Q5** 併読の解決 | `includes` のエンティティが `source` から `context` / `ref` で辿れるか、`scope_used` が併読先の `reads` と一致するか |
| **Q6** テストケース | `implementation` の実在・`@tc` の一致・`spec_ids` の実在・`type: integration` が1つ以上 |
| **Q7** 一意性 | `id` / `name` の重複 |

続けて生成:

```bash
npm run generate
```

## ④ 写像と配線を実装する

**1クエリ = 配線1つ + 写像1つ。** 名前は `query_spec` の `name` から機械的に導く（`layer/query-naming` が形を検査する）。

| 役割 | パス | 名前 |
|------|------|------|
| 配線 | `app/src/composition/{source}/queries.ts` | `{camelCase(name)}Query`（例 `itemListQuery`） |
| 写像 | `app/src/infrastructure/{source}/queries.ts` | `select{PascalCase(name)}`（例 `selectItemList`） |
| テスト | `app/src/composition/__tests__/{source}/{name}.test.ts` | — |

どちらのファイルも先頭に `import 'server-only'`。1集約1ファイルに、その集約の `query_spec` の数だけ export を並べる（300行に届いたら集約の切り方を見直すサイン）。

### 配線（`composition`）— 定型3手順

1. **パース**: `params` を zod で検査する。スキーマは `ref` が指す生成 zod スキーマのフィールドから**借りる**（`loanRowSchema.shape.item_id` のように取り出して組む）。制約を書き直さない。`params` が無いクエリではこの手順が消える。
2. **配線**: 実行者のセッションから **JWT 付きクライアント**を組み立て、写像関数に渡す。未ログインでもクライアントは作り、「読めない」の判定は DB に任せる（**早期リターンしない**）。
3. **返却**: `QueryResult` で返す。DB からのエラーは想定外の失敗として throw する。

- クライアントは `app/src/infrastructure/supabase/session.ts` の `createRequestClient()`。
- **省略可能な引数を1つだけ空ける**（`client?: RlsClient`）。`createRequestClient()` は `next/headers` の `cookies()` を呼ぶため、リクエスト文脈の無い vitest からは配線を1行も実行できない。テストだけがここに anon キー + ユーザJWT のクライアントを渡す。**`createServiceRoleClient()` を渡してはならない**（リンターはファイル内の import しか見ないので、渡す側の責任）。
- 型は **`RlsClient` だけ**を受け取る。`AppSupabaseClient`（素の型）に緩めない（外から service role を渡される経路は型でしか塞げない）。

### 写像（`infrastructure`）

`query_spec` の宣言を**そのまま**問い合わせに写す。`filters` → `.eq()` / `.in()` / `.neq()` は手書きだが、**`select` / `order` / `limit` は生成物からそのまま渡す**（突合ではなく生成で閉じる設計）。スコープ条件（実行者で絞る条件）も同じく生成物を適用する。

```ts
import { queryActorConditions } from '@/domain/generated/query-windows';
import { queryFragments } from '@/domain/generated/query-fragments';
import { applyActorConditions, applyOrder, applyLimit } from '../supabase/query-window';

const fragment = queryFragments.loan_own_list;   // ← query_spec の name で引く
const { data, error } = await applyActorConditions(
  applyLimit(
    applyOrder(
      client.from('loans').select(fragment.select).eq('item_id', itemId),
      fragment.order,
    ),
    fragment.limit,
  ),
  queryActorConditions.loan_own_list,
  actorId,
);
```

- `fragment.select` は `projection` + `includes` を機械的に写した列文字列で、`via` の binding が起点から 1 段先を指すとき（例: `loans.patron_id`）は**返すためではなく絞るため**の内部結合（`loans!inner(patron_id)`）を自動で含む。手で結合を用意しなくてよい。
- `.select()` / `.order()` / `.limit()` / `.range()` に文字列・数値・テンプレートリテラルを直書きすると**リンターが落とす**（enforcement-matrix Q9。`select('*')` も同じセレクタで拾う）。
- **例外は理由つきの `eslint-disable-next-line`。** generate で導けない判断（併読を「必ず 1 件」として型づけるための `!inner` のような型カーディナリティの決定、`sort` の DSL にまだ無い並び方）だけが対象。実例は自分の製品の `app/src/infrastructure/{source}/queries.ts` に残る。
- `sort` に `nulls_first` / `nulls_last`（例: `order_index asc nulls_last`）を書けば、null を末尾/先頭に回す指定も `fragment.order` に含まれる。
- `actorId` を `.eq()` に直接渡すと**リンターが落とす**（enforcement-matrix Q8）。足りない条件があるなら `query_spec` か `roles.md` を直して再生成する。
- `param` で決まる併読の絞り込み（「どの蔵書か」）は生成物に出ない。そこは手書きのままで、スコープ条件の見張りテストが守る。

**禁止:**

| 書きたくなったもの | 正しい置き場所 |
|-------------------|--------------|
| `if (role === 'patron') { 他人の行を除く }` | `access_spec` の `reads`（ロールで分岐せず宣言を直す） |
| `.eq('patron_id', actorId)` を手で書く | `query_spec` の `via` を宣言 → `generate` → `applyActorConditions`（リンターが落とす） |
| 「返却済みは一覧に出さない」 | `query_spec` の `filters` |
| 取得後に配列を絞る | `filters` / `paging`（DB側で絞る）。`.filter()` / `.find()` はリンターが落とすが、`.slice()` は落ちない — **レビューで見る** |
| `select('*')` / `.order()` / `.limit()` の列・上限を手で書く | `queryFragments.{name}` の `select` / `order` / `limit` を渡す（リンターが落とす。Q9） |
| 写像の中でクライアントを作る | クライアントの選択は配線の責務 |

**判断の目安:** 手で書いた `.eq()` / `.in()` が `filters` / `params` のどちらかに1対1で対応しないなら、それは仕様に無い絞り込みである（`binding` の写しは生成物が持つので手で書く側には現れない）。仕様を直すか、その行を消す。

### 戻り値

`returns: many` は配列（0件は空配列）、`returns: one` は `T | null`。
**「見えないので0件」をエラーにしない**（RLS による不可視は正常な結果）。逆に、未ログイン・セッション切れのエラーを握って0件に化けさせない（`anon` にテーブルの SELECT 権限が無いのでエラーとして表面化するのが望ましい性質）。
書き込み側の `ActionError`（3分類）を読み取りで使わない。

## ⑤ 統合テスト — スコープ条件の見張りテストの作り方

配置は `app/src/composition/__tests__/{source}/{name}.test.ts`（**配線を入口に**、実DB・実RLSを通す）。
各テストに `// @spec {spec_id} @tc {id}` を書き、テスト名を `implementation` の `::` 以降と一字一句一致させる。

**返却形は `toEqual` の全体比較で検証する**（プロパティを1つずつ拾わない）。`expect.any()` で逃がしてよいのは採番されたIDなど実行のたびに変わる値だけ。理由は [testing/integration.md §5](../../../docs/rules/process/backend/system/standards/conventions/testing/integration.md)（要点: `projection` ⇔ 実装の一致を見る機械検査がまだ無いので、全体比較だけが「宣言していない列が混ざっていないこと」を検出できる）。

### 上界のテストとスコープ条件のテストは別物である

| 何を守るか | どう置くか | 落とし穴 |
|-----------|----------|---------|
| **上界** — 見えてはいけない行が返らない | 読めないロール（`reads` が `scope: none`）または**無関係な他人**で呼んで 0 件 | これだけではスコープ条件を1ミリも守っていない |
| **スコープ条件** — 宣言したとおりの集合が返る | **上界が広い実行者**で呼んで、宣言した集合しか返らないこと | 無関係な他人で書くと、**スコープ条件を消しても緑のまま**で見張りテストにならない |

### スコープ条件の見張りテストの選び方（上界に頼らない形）

**「スコープ条件を消したら落ちる」ことが見張りテストの定義である。** 実行者の選び方を間違えると、RLS が代わりに落としてしまい、テストは緑のままスコープ条件が消える。

| そのクエリの形 | 上界が広くなる実行者の作り方 | 参考にする実物 |
|--------------|--------------------------|--------------|
| `via: loan_owner` / `scope_used: own` | 上界が広い実行者（貸出の全件を読める**司書**）を実行者にする | [`loan_own_list`](../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/backend/queries/loan/loan_own_list.md) の上界が広がるケース |
| `via: department_admin` / `scope_used: context(department)` | 他部門の部屋の ID を `params` に渡す（可視性は `params` ではなく `reads` が決めることの実測） | [`booking_room_list`](../../../legacy/spec-tools/__tests__/fixtures/samples/rooms/docs/specs/backend/queries/booking/booking_room_list.md) |
| 親の `reads` が `all` で、スコープ条件だけが「自分の分」を作っている | **他人が作った行を用意するだけでよい**（上界が `all` なので RLS は1件も落とさない） | 製品の該当クエリ（実物は自分の製品の query_spec に置く。このデモ製品には無い） |
| 併読（`includes`）にスコープ条件がある | 実行者が**併読先の行に別の関係で繋がっている**状況を作る（例: 他人の申請に承認者として指名されている） | [`claim_detail`](../../../legacy/spec-tools/__tests__/fixtures/samples/expenses/docs/specs/backend/queries/claim/claim_detail.md) |

**2段で書くと確実になる。**

1. **上界が通していることを先に確かめる** — その行が、この実行者にとって別経路（別のクエリ／`reads` の別ポリシー）では見えることを1件示す。
2. **この経路では0件（または宣言どおりの集合）であることを見る。**

1を省くと「上界も落とす状況」で書いてしまい、見張りテストにならない。

### 自己診断（コミット前に必ず1回）

写像から**スコープ条件の `.eq()` / 結合条件を1行コメントアウトして**テストを実行する。

- **赤くなる** → 見張りテストが効いている。
- **緑のまま** → そのクエリのスコープ条件は誰も守っていない。実行者の選び方を上の表で選び直す。

同じ要領で `filters` の1行を消してテストが赤くなるかも見る。ここで**他人の行が増えるなら `filters` ではなく `access_spec` が間違っている**（`filters` は UX であって可視性ではない）。

### そのほか

- **「見えること」と「見えないこと」の両方を書く。** 少なくとも1本は、読めないロールまたは他人の行で0件になることを確かめる。
- `service_role` クライアントで権限テストを書かない（第二防衛線を無効化した状態の確認は何も保証しない）。
- ユニットテストだけでクエリを済ませない。
- 新しい集約を足したなら、`access_spec` → 期待表（`app/src/domain/generated/rls-expectations.ts`）→ ポリシーの3点が揃うまで `app/src/infrastructure/__tests__/rls/policy-parity.test.ts` が落ち続ける。

## ⑥ 全検査

リポジトリルートから回す（検証器・生成器の検査はルートの取り次ぎ。`app` の検査は**サブシェルで**回す —— `cd app` のあとは cwd が `app/` に残るため）。

```bash
npm run verify && npm run generate && npm run generate:check \
   && npm run typecheck:spec-tools && npm run test:spec-tools && npm run lint:spec-tools
(cd app  && npm run typecheck && npm run lint && npm run test \
   && npm run test:integration && npm run build)
```

- `verify` は **エラー0** が条件（警告は既存分が残っている）。
- `npm run test:integration` は**多重起動できない**。別の統合テストが走っていたら待たずに失敗する。クエリのテストの本体はこちらにある。
- `src/composition/**` と `src/infrastructure/**` はカバレッジ計測の対象外である（実体との結合が本質なので統合テストで扱う）。**数値を目標にしない。**
- 仕様YAMLと生成物は同一コミットに含める。

## 機械執行されていないもの（人間が見る）

このクエリのレビューで人間が担っている部分。自己レビューでも意識的に見る。

- **スコープ条件が `binding` の写しになっていること**（機械執行はバックログ。`binding` からフィルタ断片を生成して突き合わせる案）。
- **`projection` / `sort` / `paging` ⇔ 実装の一致は生成で閉じている**（enforcement-matrix の Q3・Q9。`queryFragments` を経由しない書き方はリンターが落とす）。人間が見るのは、generate で導けない例外（`eslint-disable-next-line`）が正当かどうかだけになった。
- **`filters` の値（列挙・比較値）⇔ 実装の一致**（検出器なし。`toEqual` の全体比較が代替）。
- **読み取り版の意味クラス導出**（`covers` の網羅要求。A7 相当）は v1 では持たない。`covers` は宣言だけを受け取る。
