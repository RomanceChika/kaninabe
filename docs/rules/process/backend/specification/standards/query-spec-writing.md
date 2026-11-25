---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0008, PRIN-0009, PRIN-0010, ARCH-SP-0002, ARCH-SP-BE-0001]
decisions: [ADR-0003, ADR-0004]
---

# 読み取りクエリ仕様（query_spec）の書き方

`docs/specs/backend/queries/{aggregate}/{name}.md` に置く `query_spec` の YAML スキーマと、検証器が実行するチェック（Q0〜Q7）を定義する。

## 目的

- 読み取り経路を、**ドメイン仕様を再定義しない薄い宣言**に固定する。誰に何がどこまで見えるかの正は `access_spec` の `reads` / `fields_hidden` にあり、`query_spec` が書くのは「その可視性を、どの経路で、どう絞って使うか」だけである（PRIN-0007）。
- **「絞り込みは UX、可視性は宣言」**という役割分担を、仕様の形として強制する。可視性の執行は二層で、**上界**（見えてはいけないものが返らない）は RLS、**スコープ条件**（宣言どおりの集合が返る）は `via` のロールの `binding` から導かれる絞り込みが担う（§via の M2）。どちらもアプリ側の `if`（実装の判断）ではない（PRIN-0009 / PRIN-0010）。
- 読み取り経路と `access_spec` のずれ（宣言より広いスコープ、隠したはずのフィールドの露出）を、レビューではなく機械が検出できる形にする（PRIN-0006）。

## 参照するもの

- **配置・命名**: [architecture/specification/backend](../../../../architecture/specification/backend/)（ARCH-SP-BE-0001）
- **可視性の正**: [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) の §access_spec（`reads` / `fields_hidden`）
- **式の文法**: 同上 §ガード式の文法（`filters` は同じ文法・同じパーサーを使う）
- **書き込み側の対になる仕様**: [action-spec-writing.md](./action-spec-writing.md)
- **テンプレート**: `docs/specs/backend/queries/template.query_spec.md`

## ルール・基準

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識 2 種のみ（§散文の規則）。
- `doc_type: query_spec` / `scope: backend` / `id` を必ず書く。`id` は `query-{name をハイフン区切りにしたもの}`（例: `item_list` → `query-item-list`）。
- **1 ファイル 1 クエリ**。ファイルパスは `queries/{aggregate}/{name}.md` とし、ファイル名（拡張子を除く）は `name` と一致させる。**`{aggregate}` は `source` と同じ名前**にする（ディレクトリは 1 段。Q0 が検査する） — 仕様のパスから実装 `app/src/{layer}/{aggregate}/queries.ts` を導く規約が、この一致の上に立っているためである。
- 識別子（クエリ名・エンティティ名・フィールド名・ロール ID）は**スネークケース**とする。

### 散文の規則

手書き散文で書いてよいのは**標識 2 種・各 1〜3 行**のみ（2026-08-24 のユーザー裁定）: **否定の標識**（検討して捨てた自然な代替案。例:「履歴を上限で切らない — filters で集合そのものを絞る」）と**線引きの標識**（「ここではやらない」のスコープ宣言。例:「履歴の閲覧は将来の別クエリで受ける」）。

- 事実の再記述（YAML の言い換え）は書かない — 再記述はドリフト源である。可読形が要るものは生成物が担う。
- 事実の可読形はファイル末尾の生成ブロック `query-body`（宣言・params・filters・includes・projection・テストケースの表）が担い、`npm run generate` が差し込む。手で編集しない。
- 系全体の意味論（三分法・二層モデル・借用条件など、そのクエリ固有でない話）は本文に書かず、本書または該当する規約へのリンク 1 行に置き換える。
- 経緯・歴史は `NOTES.md` へ。消費者への契約（画面が依存してよい性質）は標識 1 行に圧縮して残す。
- YAML フロントマター内のコメントは**行ローカルの短注（1 行）**のみ。段落級のコメントは標識に移すか削除する。

根拠: 同じ情報が二箇所に住むと片方が黙って嘘になる（2026-08-24 の例解ドリフト実測）。

### スキーマ

全項目を 1 つに詰めた**架空の例**である（実在する仕様と ID がぶつからないよう `sample_` を付けてある。実物は §書き味の実例）。

```yaml
doc_type: query_spec
scope: backend
id: query-sample-list

name: sample_list                  # 必須。実装関数名 sampleListQuery / selectSampleList の元
for: [patron]                      # 必須。このクエリを実行するロール（観客。グローバルロールのみ）
via: loan_owner                     # 任意。行の可視性を供給する関係ロール（省略時は for の宣言を使う）
source: item                    # 必須。主エンティティ（置き場も queries/item/ になる）
scope_used: own                    # 必須。for（via があればそのロール）の reads 宣言と一致すること
returns: many                      # 必須。one（1 件）| many（0 件以上）

params:                            # 任意。実行時に外から渡す入力。filters から param.{name} で参照する
  - name: librarian_id
    ref: item.librarian_id      # 型の導出元（entity_spec のフィールド）

filters:                           # 任意。絞り込み（UX）。ガード式と同じ文法
  - state in [available, on_loan]
  - item.librarian_id == param.librarian_id

includes:                          # 任意。併読（併読先の reads が for のロールと一致すること）
  - entity: patron
    scope_used: all
    projection: [id, display_name] # 併読先も返すフィールドを明示する
  - entity: loan
    scope_used: own
    via: loan_owner                 # 併読ごとに供給元を書き分けられる（source の via とは独立）
    filters:                       # 任意。文法・検査は source の filters と同じ（起点は併読先）
      - state in [requested, checked_out]
    projection: [id, title]

sort: [title asc]             # 任意
paging: limit(50)                  # returns: many のとき必須。none | limit(n) | cursor
projection: [id, title, shelf_code, state]   # 必須

test_cases:                        # 必須。1 つ以上（うち 1 つ以上は type: integration）
  - id: TC-ITEM-SAMPLE_LIST-001
    type: integration
    covers: [success]
    spec_ids: [query-sample-list]
    implementation: app/src/composition/__tests__/item/sample_list.test.ts::利用者は在架の蔵書を題名順に読める
```

#### name

- **すべきこと:** クエリ名を snake_case で書く。実装は配線が `{camelCase(name)}Query`（例: `itemListQuery`。`composition`）、写像が `select{PascalCase(name)}`（例: `selectItemList`。`infrastructure`）になり、名前から実装が一意に導ける（ARCH-BE-0016）。
- **してはいけないこと:** `get` / `fetch` / `select` のような取得動作を名前に含める。この仕様に載るものはすべて読み取りであり、動詞は情報を持たない。

#### for / via

読み取りには **「誰が実行するか」** と **「その行がなぜ見えるか」** の 2 つの問いがあり、`query_spec` はこれを別の欄に分けて書く。

| 欄 | 何を書くか | 例 |
|----|-----------|-----|
| `for` | **観客** — このクエリを実行する資格。グローバルロール（`patron` / `anonymous` / `system`）だけ | 「利用者なら誰でも呼べる」＝ `for: [patron]` |
| `via` | **可視性の供給元** — その実行者のどの**関係**が行を見せているか。文脈依存ロール（`binding` を持つロール） | 「見えるのは自分が借りた貸出の行だけ」＝ `via: loan_owner` |

- **すべきこと:** `for` にこのクエリを実行するロールを 1 つ以上並べる。ロールは `roles.md` に実在し、`binding` を持たない（＝グローバルな）ロールであること（Q2 が検出する）。
- **すべきこと:** 複数のロールを並べるのは、**全員の `reads` スコープが同じとき**だけにする。スコープが違うロールは見えるものが違うので、別のクエリに分ける（Q2 が検出する）。
- **すべきこと:** `for` のロール自身の `reads` では読めない行を読むときに `via` を書く。`via` を書くと、`scope_used` の突合先も隠しフィールドの判定基準（Q3）も、そのロールに切り替わる。
- **してはいけないこと:** 文脈依存ロール（`loan_owner` / `item_librarian`）を `for` に書く。それは「観客」ではなく「関係」であり、`via` の役目である。
- **してはいけないこと:** `reads` が `scope: none` のロールを `for` に並べて `via` も書かない。「読めないロールのための読み取り経路」は定義できない（Q2 がエラーにする）。

##### 健全性の言明（M2）— 宣言は「上界」ではなく「スコープ条件」である

`via` の規則は、次の言明を成り立たせるためにある。**可視性は二層で考える。**

| 層 | 何を保証するか | 誰が執行するか |
|----|--------------|--------------|
| **上界（安全）** | 「これ以上は絶対に返らない」— 見えてはいけない行が、何をしても出てこない | DB（RLS ポリシー。`reads` から導かれる） |
| **スコープ条件（正確さ）** | 「宣言したとおりの集合が返る」— `scope_used` / `via` が書いたものと、実際に返る行が一致する | クエリの写像（`via` のロールの `binding` から**決定的に導かれる**絞り込み） |

> **M2（健全性）**: 任意のクエリについて、`scope_used` / `via` が表す、スコープ条件で絞った集合は、実行者に対する RLS の許す集合（上界）に**含まれ**、かつ**それと一致する**。

上界だけでは足りない。RLS の許す集合は**複数のポリシーの和**だからである。例として、図書館の利用者は「自分が借りた貸出の行」と「自分が蔵書の司書である行」の両方を読めるので、`via: loan_owner` と宣言したクエリを司書が呼ぶと、上界は宣言よりも広くなる。スコープ条件が無ければそこに他人の貸出が混ざり、**仕様は正しいのに返る集合が宣言と違う**という状態になる。

- **スコープ条件は実装の発明ではない。** 書いてよいのは `via` のロールの `binding`（`loan.patron_id == actor.id` など）を実行者で具体化した写しだけであり、それ以外の条件は `filters`（UX）か、そもそも `reads` の書き間違いである。将来この断片も生成物にする（バックログ）。
- **「絞り込みは UX、可視性は RLS」は「絞り込みは UX、可視性は RLS が上界・binding がスコープ条件」に精密化された。** `filters` を全部消しても見えてはいけないものが見えないことは今も上界が保証する。スコープ条件は「見えてよいもののうち、この経路が見せると宣言したもの」を切り出す。

##### via の借用が成立する 3 条件

`via` は「別のロールの `reads` 宣言を借りる」宣言である。借りられるのは次をすべて満たすときだけで、外れたものは Q2 / Q5 がエラーにする（`via` に書けるのは `binding` を持つ文脈依存ロールだけ、という前提も Q2 / Q5 が見る）。

| # | 条件 | なぜ |
|---|------|------|
| ① | `via` のロールが `for` の各ロールを `implies` で（推移的に）含意していること | 含意が無ければ「実行者は必ずその関係を持ち得る」と言えない。`loan_owner: implies [patron]` があるから、`for: [patron] / via: loan_owner` は「利用者のうち、自分が借りた貸出の行」と読める |
| ② | 借りられるのは**関係スコープ**（`own` / `context(...)`）だけ。`all` は借りられない | `all` を借用可能にすると「誰に全件見せているか」が `for` からも `via` からも読めなくなる。全件見せてよいなら、直すのは `reads` の側である。関係スコープに限れば、スコープ条件は必ず `binding` から導ける |
| ③ | 借用が**実際に必要**であること（`for` のロール自身の宣言で足りるなら `via` は書かない） | **M2 の系である。** `for` のロール自身が同じスコープを持つなら、その関係を持たない実行者にも同じ行が返る = スコープ条件（`via` が表す集合）より実際に返る集合が広くなり、「一致」が崩れる。副作用として `fields_hidden` の判定基準まで `via` 側にずれ、「patron から隠すはずの列を、via: loan_owner と書いて返す」迂回路にもなる |

- **暗黙の `implies` 歩きはしない。** 検証器は「`patron` で読めないなら `patron` が含意されるロールを順に試す」ことを**しない**。必ず `via` の明示を求める。`scope_used` は「このクエリがどの可視性の上に立っているか」を人間が読むための宣言であり、機械が黙って別の宣言に読み替えると、その一行が意味を失うためである。
- **1 クエリに `via` は 1 つではない。** `source` の `via` と、`includes` ごとの `via` は独立に書ける。「親の行は一般の利用者として読み、自分に属する子の行は所有者として併読する」がその形である。

#### source / scope_used

- **すべきこと:** `source` に主エンティティ名を書く。`entity_spec` の `entity` と同じ名前にする。
- **すべきこと:** `scope_used` に、そのクエリが使う読み取りスコープ（`own` / `context({entity})` / `all`）を書く。`access_spec` の `reads` に書かれた宣言（`via` があればそのロールの宣言）と**同じ値**でなければならない。
- **してはいけないこと:** `scope_used` に `none` を書く。読めないスコープにクエリは存在しない。
- **なぜ書き写すのか:** 冗長に見えるが、これは「このクエリがどの可視性の上に立っているか」の宣言であり、`access_spec` を後から狭めたときに**壊れる読み取り経路を機械が指し示す**ためにある。実装がスコープを勝手に広げていないかの突合点でもある。

#### params / returns

- **すべきこと:** 実行のたびに変わる入力（対象の ID・カーソル・検索語）は `params` に宣言し、`filters` からは `param.{name}` で参照する。
- **すべきこと:** `ref` に型の導出元を `{entity}.{field}` で書く。**型・必須・最大長は書かない** — 制約の正は `entity_spec` であり、`ref` はそこへのポインタである（PRIN-0007）。
- **すべきこと:** `returns` に `one`（1 件。見つからなければ無し）か `many`（0 件以上）を書く。`paging` を書けるのは `many` のときだけで、`one` に `paging` はエラーになる。
- **してはいけないこと:** 実行者（actor）を `params` に書く。actor はサーバー側のセッションから導く（`action_spec` の `input` と同じ規則）。

##### 三分法 — params / filters / reads

読み取りに出てくる「絞り込みらしきもの」は 3 つあり、**置き場所を間違えると安全性が壊れる**。判断は次で固定する。

| 種類 | どこに書くか | 何を表すか | 誰が執行するか |
|------|-------------|-----------|---------------|
| **実行時入力** | `params`（`filters` から `param.{name}`） | 「**どの**蔵書の」「**どこから**の続き」— 呼び出しのたびに変わる値 | アプリ（クエリの引数） |
| **宣言的な絞り込み** | `filters` | 「下書きは一覧に出さない」— **いつ実行しても同じ**、UX 上の取捨選択 | アプリ（クエリの WHERE 句） |
| **可視性** | `access_spec` の `reads` / `fields_hidden`（どの宣言を使うかは `scope_used` / `via`） | 「他人の貸出は見えない」— **誰に見せてよいか** | DB（RLS = 上界）＋ `binding` から導いた絞り込み（スコープ条件） |

- **可視性を `filters` や `params` で表現してはならない。** `filters` を全部消したときに、見えてはいけないものが見えるなら、それは `access_spec` の宣言が間違っている。この線引きが本仕様の中心にある。

##### 例外形 — 上界が `all` の集約で「自分の行」を読む

「自分のプロフィール」のように、**`reads` が `all`（誰の行も見えてよい）なのに、この経路が返すのは実行者自身の 1 件**という読み取りがある。この形は三分法のどれにも素直に収まらないので、置き場を固定する。

| 問い | 答え |
|------|------|
| `scope_used` は | **`all`**（`reads` の宣言と一致させる。それ以外は書けない） |
| `via` は | **書けない**。`own` を使うには関係スコープの `reads` 宣言が要り、仮にロールを足しても借用の 3 条件の③（`for` 自身で足りるなら書かない）に反する |
| 絞りはどこに | **`filters`**（`id == actor.id`。`actor` は予約語として `filters` から参照できる） |

- **これは `filters` の中の例外形である。** `filters` は本来「いつ実行しても同じ取捨選択」だが、この 1 本だけは実行者に依存する。許されるのは**消しても見えてはいけないものが 1 つも見えないとき**に限る（上界が `all` なのだから、絞りを消して壊れるのは安全ではなく「宣言どおりの集合が返ること」のほうである）。**「消しても無害」という意味ではない** — `returns: one` の実装は複数行で例外になり、他人が 1 人だけの状況ではその 1 件が黙って返る。だからこそ下の見張りテストが要る。上界が `all` でないなら、それはスコープ条件の話であり `via` を書く。
- **見張りテストが必須である。** 安全（上界）ではなく**宣言との一致**を守っているのがこの 1 行なので、消したときに落ちるテストが無ければ誰も守っていない。書き方はスコープ条件の見張りテストと同じ 2 段（①その実行者に他人の行が現に見えていることを示し、②それでもこの経路は自分の 1 件しか返さないことを見る）。
- **実行者が解決できないときは問い合わせを投げない。** 上界が全件を許す経路で `actor.id` の無い問い合わせを作ると、絞りの無い形が一瞬でも存在する（`loan_own_list` のスコープ条件と同じ扱い）。
- この形の実物は、製品の query_spec に `id == actor.id` を `filters` に書く 1 本として置く。
- 逆に、`params` に「見せてよい範囲を絞るための ID」を渡す設計（例: 呼び出し側が `patron_id` を渡して自分の分だけ引く）は**可視性を呼び出し側に委ねている**ことになるので採らない。それは `reads` の `scope: own` が守る。
- **`via` は 4 つ目の絞り込みではない。** `via` は「この経路が **どの `reads` 宣言の上に立っているか**」の名札であり、書き換えても業務上の意味は変わらない。ただし可視性の執行は二層である（§via の M2）— **上界**（見えてはいけないものが返らないこと）は RLS が、**スコープ条件**（宣言したとおりの集合が返ること）は `via` のロールの `binding` から決定的に導かれる絞り込みが担う。スコープ条件は仕様からの写しであって、実装の判断ではない。

#### filters

- **すべきこと:** 絞り込み条件をガード式と同じ文法で書く（`domain-spec-writing.md` §ガード式の文法）。参照できるのは次の 4 つである。
  - `source` のフィールド（裸のフィールド名、または `{source}.{field}`）
  - `source` の `entity_spec` の **`context` で解決できるエンティティ**のフィールド（例: `hold` から `item.state`）
  - 予約語 `actor` / `now`
  - `params` に宣言した実行時入力（`param.{name}`）
- **すべきこと:** 複数書いた場合は **and** で結合されたものとして読む（1 行 1 条件にすると差分が読みやすい）。
- **すべきこと:** 状態・enum で絞るときは、宣言（`state_spec` の `states` / `entity_spec` の `enum([...])`）にある名前をそのまま書く（Q4 が突き合わせる。`in` / `not in` の並びも `==` / `!=` の右辺も同じ規則）。綴り違いは**式としては妥当**なので、検査が無ければ「1 件も返らない絞り込み」として黙って通る。
- **すべきこと:** 件数を有界にしたいときは、`paging` の上限より先に `filters` を考える。上限は「切ってよい行」と「切ってはいけない行」を区別できないので、**返す集合そのものを絞る**方が先である（実例: [`loan_own_list`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/backend/queries/loan/loan_own_list.md) は返却前の貸出だけを返し、履歴は別クエリ `loan_own_history` に委ねている）。
- **してはいけないこと:** `context` で辿れないエンティティを参照する。辿れない相手の条件で絞りたくなったら、それは併読（`includes`）か、そもそも別のクエリである。

| 書きたくなったもの | 正しい置き場所 |
|-------------------|--------------|
| このロールにはこのレコードを見せない | `specs/domain/{aggregate}/access.md`（`reads` の `scope`） |
| このロールにはこの列を見せない | 同上（`fields_hidden`） |
| 一覧では下書きを出したくない（本人は別画面で見る） | `query_spec` の `filters` |
| 親が公開済みのものだけ並べたい | `query_spec` の `filters`（`context` 経由で親の状態を参照する） |
| 期限切れを一覧の後ろに回したい | `query_spec` の `sort` |
| どの蔵書のものを引くか | `query_spec` の `params` |

#### includes

- **すべきこと:** 一緒に読むエンティティを `entity` / `scope_used` / `projection` で宣言する。`entity` は `source` から `entity_spec` の `context` または `ref({entity})` フィールドで辿れること（Q5）。
- **すべきこと:** `scope_used` は併読先の `access_spec` の `reads` と一致させる（`source` と同じ規則）。併読先を `for` のロール自身では読めない場合は、その `includes` に `via` を書く（借用の 3 条件は `source` と同じ）。
- **すべきこと:** 併読ごとに供給元を書き分ける。`source` に `via` があっても、`includes` の各要素はそれを継がない（1 つの往復で「利用者として読む部分」と「借りた人として読む部分」が同居できる）。
- **すべきこと:** 並びが意味を持つ併読には `sort` を書く（形式は `source` の `sort` と同じ。フィールドの実在は Q1 が見る）。書かなければ**順序は未定義**であり、画面が「最初の 1 件」を選ぶ設計にはできない。
- **すべきこと:** 併読が返す集合を絞りたいときは `filters` を書く（文法・検査は `source` の `filters` と同じで、パスの起点が併読先のエンティティになる。`param.{name}` は同じ `params` を指す）。位置づけも同じで、**絞り込みは UX・可視性は RLS** である。
- **してはいけないこと:** 件数が業務上有界でない併読に、意味を確かめずに `limit` を書く。`limit` は任意だが、**上限で切ると「本当に必要な 1 件」がこぼれ落ちうる**（例: 履歴が無界の申込みを状態順に 20 件で切ると、アクティブな 1 件が入らないことがある）。有界にしたいなら、まず `filters` で**返す集合そのものを絞る**（上限は「切ってよい行」と「切ってはいけない行」を区別できない）。`limit` を足すのはそのうえで確かめられたときだけである。
- **すべきこと:** `projection` を必ず書く。**併読は露出の口である**以上、何を返すかを書かなければ隠しフィールドの検査（Q3）も実在の検査（Q1）も効かない。`source` の `projection` と同じ扱いをする。
- **してはいけないこと:** 併読で可視性を広げる。`includes` は「まとめて読む」だけであり、読めないものが読めるようになる宣言ではない。

##### 併読のスコープ条件を省いてよい条件

`includes` にも `source` と同じく**スコープ条件**（`via` のロールの `binding` から導いた絞り込み）が要る。省いてよいのは次のときだけである。

> **併読先の上界（その実行者に対する RLS の許す集合）が、親のスコープ条件と同等以上に狭いとき。**

- **不変条件の存在は根拠にならない。** 「親が蔵書 X に絞られている以上、子は必ず蔵書 X のものだ」という推論は、その関係を保証しているのが不変条件（トリガー・制約）であるときに成り立ちそうに見えるが、**不変条件は DB の性質であって、この経路が宣言どおりの集合を返すことの根拠ではない**。スコープ条件は「宣言と実際に返る集合の一致」（M2）を担うものであり、別の仕組みが偶然同じ形を作っていることに寄りかからせない。
- **上界は複数ポリシーの和である**ことを忘れない。実例: 予約から元貸出を併読するとき、`loan` の上界は `loan_owner own` と `item_librarian context(item)` の和である。実行者が他人の蔵書に**借りた人として出ていれば**その行は上界を通るので、親のスコープ条件（自分が司書の蔵書）より狭くない。したがって併読側にもスコープ条件が要る。
- **スコープ条件が唯一の担い手であることは、テストで示せる形にする。** 「上界が通していることを先に確かめてから、この経路が 0 件であることを見る」ケースを置く。上界も落とす状況（無関係な他人の行）で書くと、**スコープ条件を消しても緑のまま**で見張りテストにならない。

#### sort / paging / projection

- **すべきこと:** `sort` は `{フィールド名} asc|desc` の形で並べる（方向を省くと `asc`）。フィールドは `source` に実在すること（Q1）。null を持ちうるフィールドで未設定行の位置を明示したいときだけ、3 語目に `nulls_first` / `nulls_last` を足す（例: `order_index asc nulls_last`。省略時は Postgres の既定に委ねる）。
- **すべきこと:** `returns: many` のときは `paging` を必ず書く。`none`（全件）を選ぶ場合も、**件数が業務上有界だと判断した**という宣言として明示する。`returns: one` のときは書かない（書けばエラー）。
- **すべきこと:** `paging: none` を選んだら `bounded_by` に「なぜ有界か」を書く（Q8）。書ける形は閉じていて 2 つ:
  - `bounded_by: window` — `via` のスコープ条件が実行者 1 人分に絞るため有界（例: 自分が持てる行の数が業務上少ない）
  - `bounded_by: { parent: {aggregate}, reason: "{理由を1行}" }` — 親集約 1 件の子行であり、親側の宣言（容量等）で有界（例: [`store_list`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/stores/docs/specs/backend/queries/store/store_list.md) は 1 会社の店舗数が契約で決まり有界）
  - **してはいけないこと:** `paging: none` 以外（`limit(n)` / `cursor` / `returns: one`）で `bounded_by` を書く（Q8 がエラーにする。有界性の言い訳が要るのは「全件返す」宣言に対してだけ）。
- **すべきこと:** `projection` に返すフィールドを 1 つ以上並べる。`entity_spec` に実在し（Q1）、`for` のロールから `fields_hidden` で隠されるフィールドを含まないこと（Q3）。
- **してはいけないこと:** フィールドの型・必須・最大長を書く。制約の正は `entity_spec` である（PRIN-0007）。
- **してはいけないこと:** 「とりあえず全部返す」意味で全フィールドを並べる。`projection` は露出範囲の宣言であり、返さないものを書かないことに意味がある。

#### test_cases

`action_spec` と同形式であり、`@tc` の突合も同じ規則で行う（[action-spec-writing.md](./action-spec-writing.md) §test_cases が正）。

- **すべきこと:** `id` は `TC-{AGGREGATE}-{NAME}-{NNN}` とし、**全仕様（`action_spec` を含む）を通じて一意**にする。テストケース ID は仕様種ごとの持ち物ではなく、全仕様の `test_cases` を集めた**1 つの台帳**に載る識別子であり、一意性は台帳を見る A9 が検査する（`query_spec` どうしの重複も、`action_spec` との重複も、同じ 1 つの検査が見る）。番号が**追記専用**であることも `action_spec` と同じ（[action-spec-writing.md](./action-spec-writing.md) §test_cases が正）。
- **すべきこと:** `covers`（そのケースが覆う意味クラス）を必ず書く。値域は `action_spec` と同じで、**未記入はエラー**である（Q0）。読み取り側には A7 に相当する網羅判定がまだ無いが、宣言の無いケースを許すと後からその判定を入れられない。
- **すべきこと:** `spec_ids` には守っている仕様の ID を書く。書けるのは次の値域であり、実在が検査される（Q6）。
  - `query_spec` の `id`（例: `query-item-list`）
  - `access_spec` の `id`（例: `loan-access`）— 可視性そのものを守るテスト
  - 不変条件 ID（例: `INV-LOAN-001`）
- **してはいけないこと:** `spec_ids` にドメインイベント ID（`loan.submit` など）を書く。読み取りは状態を動かさないので「このテストがそのイベントを守っている」は成り立たない（イベント ID は `action_spec` 側の語彙であり、A8 がそちらで実在を検査する）。
- **すべきこと:** **RLS を効かせた経路で読むテスト**（`type: integration`）を 1 つ以上持つ（Q6 が要求する）。読み取りの安全性はアプリ側の絞り込みではなく DB のポリシーが担うため、そこを通らないテストでは「見えてはいけない行が見えない」ことを 1 つも保証できない。
- **してはいけないこと:** テストの手順・アサーションの内容を仕様に書く。

### どの読み取りを query_spec にするか

**RLS に依存して「自分以外のデータに触れうる」読み取り経路は、すべて仕様化する。** 判断基準は「アプリの絞り込みを外したら他人のデータが返り得るか」であり、画面の重要度でも件数でもない。

| 読み取り | query_spec にするか | 理由 |
|---------|:---:|------|
| 蔵書一覧・予約一覧の表示・他人の貸出を含む集計 | **する** | RLS が唯一の防壁。宣言が無ければ、可視性と経路の食い違いを誰も検出できない |
| 自分の貸出の詳細（`scope: own`） | **する** | 「own であること」を守っているのは RLS であり、経路の宣言が要る |
| 直前に書き込んだ行を読み直す（同一トランザクション内の確認） | しない | 書き込み操作の一部であり、`action_spec` の内側の話 |
| 内部実行（`system` / service_role）のジョブ処理 | しない | RLS をバイパスする経路であり、`access_spec` の対象外 |

- **迷ったら仕様化する。** 宣言のコストは 1 ファイルだが、宣言しなかった読み取り経路は検証器の視界に入らない。
- 実装側の規約（どこに何という名前で書き、何をしてはいけないか）は [queries.md](../../system/standards/conventions/queries.md) が定める。現時点の執行はレビューであり、リンターによる機械執行はまだ無い。この文書は仕様側の基準だけを定める。

### 薄さの基準

`query_spec` は `action_spec` と同じく**薄いことが正しい**。次のいずれかを書きたくなったら、書く場所が違う。

| 書きたくなったもの | 正しい置き場所 |
|-------------------|--------------|
| 誰にどこまで見えるか / どの列を隠すか | `specs/domain/{aggregate}/access.md` |
| フィールドの型・必須・最大長 | `specs/domain/{aggregate}/entity.md` |
| 状態遷移・書き込みの権限 | `specs/domain/{aggregate}/states.md` |
| 何を受けて何を書き換えるか | `specs/backend/actions/{aggregate}/{event}.md` |
| SQL・クライアントの選び方・キャッシュ・戻り値の型 | 実装規約（[ARCH-BE-0016](../../../../architecture/system/backend/ARCH-BE-0016-read-path.md) と [queries.md](../../system/standards/conventions/queries.md)） |

### 検証チェック（Q0〜Q8）

検証器（`npm run verify` の Q 群）は次のチェックを実行する。仕様はこれらを**すべて通過することを前提に**書く。

| # | チェック | 内容 | 出力例 |
|---|---------|------|--------|
| Q0 | スキーマ適合 | `doc_type` / `scope` / 必須フィールドの型と形式、`id` と `name` の対応、ファイル名と `name` の一致、**置き場のディレクトリと `source` の一致**（`queries/{source}/{name}.md` の 1 段固定）、`returns` / `paging` / `sort` / `scope_used` / `params` / `via` / `includes[].filters` / `includes[].sort` / `includes[].limit` の形式。`returns: many` に `paging` 必須・`returns: one` に `paging` 禁止。**`test_cases[].covers` は必須**（未記入はエラー） | `ディレクトリ loan が source(item)と一致しません` |
| Q1 | フィールドの実在 | `source` が `entity_spec` にあり、`projection` / `sort` / `params[].ref` / `includes[].projection` のフィールドが対象のエンティティに実在する | `projection の venue_name は item の entity_spec に存在しないフィールドです` |
| Q2 | スコープ整合 | `for` がグローバルロールだけであり、その各ロールについて `reads` に宣言があり `scope_used` と一致する。`via` がある場合は借用の 3 条件（含意・関係スコープ限定・借用の要否）を満たすこと。`scope: none` のロールが `for` に居て `via` も無ければエラー | `scope_used が patron の reads 宣言と一致しません（declared=none / used=all）` / `via では all を借りられません` |
| Q3 | 隠しフィールドの衝突 | `fields_hidden` で**その可視性を供給しているロール**（`via` があればそのロール、無ければ `for` のロール）から隠されるフィールドを、`projection`（`source` / `includes`）・`sort`・`filters`（`source` / `includes`）のいずれでも使っていないか | `filters の note は patron から隠すフィールドです` |
| Q4 | 絞り込み式 | `filters`（`source` / `includes` の両方）がガード式の文法として妥当で、参照パスがその起点のフィールド・`context` で辿れるパス・`actor` / `now` / `param.*` で解決でき、**比較の値（`in` / `not in` の並びと `==` / `!=` の右辺）が、値域の閉じたフィールド（state / enum / boolean）の宣言済みの値として実在する** | `source の filters の patron.id を解決できません: item の context に patron がありません` / `includes.loan の filters の loan.state に、状態機械 loan に無い値があります: submited` |
| Q5 | 併読の解決 | `includes` のエンティティが `source` から `context` / `ref` で辿れ、`scope_used` が併読先の `reads`（その `includes` に `via` があればそのロールの `reads`）と一致する | `includes の patron は item から辿れません` |
| Q6 | テストケース | `test_cases[].implementation` が実在してテスト側の `@tc` と一致し、`spec_ids` が実在し、`type: integration` のケースを 1 つ以上持つ。テストケース ID の一意性はここでは見ない（仕様種をまたぐ性質なので A9 が台帳を見て検査する） | `item_list に type: integration のテストケースがありません` |
| Q7 | 一意性 | `id` と `name` が全 `query_spec` を通じて重複しない | `name item_list が複数の query_spec で使われています` |
| Q8 | 有界性の根拠 | `paging: none` の `query_spec` は `bounded_by` を持つこと。`paging: none` 以外での `bounded_by` はエラー | `loan_librarian_requested_list は paging: none なのに bounded_by がありません` |

- `filters` に現れるフィールドの実在は Q4 が見る（式の解析と不可分なため、Q1 とは分担する）。Q3 は Q4 が解決したパスを使って「隠しフィールドで絞っていないか」を見る。
- 逆方向の突合（テストにあるが仕様に無い `@tc` = orphan）は A6 が全仕様の台帳を母集合にして見る。同じ `@tc` が複数のテストに付いている重複も A6 が、テストケース ID が複数の仕様で宣言されている重複は A9 が、それぞれ仕様種を問わず検出する。
- **まだ検査していないもの（既知の穴）**: 読み取り版の意味クラス導出（`covers` の網羅要求。`action_spec` の A7 に相当するもの）は v1 では持たない。`covers` は宣言だけを受け取る。
- エラーは必ず「**何が・どこで・どう直すか**（+ 反例）」の 3 点セットで出す。
- **検証器はこの表の実装である。**表と `legacy/spec-tools/lib/query/` がずれた場合は表が正であり、実装を直す（PRIN-0001）。

### 書き味の実例

**実例は書き写さず、実物を読む。**（この節に例を複製すると、仕様が変わったときに文書だけが古い ID・古い判断を語り続ける。以下は「どこを見るか」と「そこから何を読み取ってほしいか」だけを書く。）

| 見たい形 | 実物 | そこから読み取ること |
|---------|------|--------------------|
| 一覧（`returns: many` + `filters` + `paging`） | [`item_list`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/backend/queries/item/item_list.md) | `filters` の状態の絞りは**消しても安全**である（消すと紛失の蔵書が目録に出るが、`item` の `reads` は `patron: all` なので仕様上見えてよいもの）。「消したら見えてはいけないものが見える」なら、直すのは `filters` ではなく `access_spec` の `reads` である |
| 1 件 + 併読（`returns: one` + `params` + `includes`） | [`claim_detail`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/expenses/docs/specs/backend/queries/claim/claim_detail.md) | `params` は「どの申請か」であって「見てよい申請か」ではない（他人の申請の ID を渡しても 0 件になる）。併読する明細は `scope_used: context(claim)` で親の行に紐づく。併読側の `filters` は**可視性ではなく UX** であること。`source` の `via` と `includes` ごとの `via` は独立に書けるので、供給元の違う併読もこの形の延長で書く |
| 所有スコープ（`for: [patron]` + `via: loan_owner` + `scope_used: own`） | [`loan_own_list`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/backend/queries/loan/loan_own_list.md) | `patron_id` の条件が**仕様には無い**こと（`filters` に現れない）。実装の写像に現れる `patron_id` の絞り込みは `via: loan_owner` の `binding` からの写しであって判断ではなく、上界の RLS と合わせて二層になる |
| 文脈スコープ（`for: [user]` + `via: department_admin` + `scope_used: context(department)`） | [`booking_room_list`](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/rooms/docs/specs/backend/queries/booking/booking_room_list.md) | 他部門の部屋の ID を渡しても 0 件になること（可視性は `params` ではなく `reads` が決める）。`state in [draft, confirmed]` は UX の絞り込みであって可視性ではない |

- **読み取りの安全性を担保しているのは `filters` ではない。** どの実例でも、「読めないロール・他人の行では 0 件（または権限エラー）になる」ことを確かめる `type: integration` のテストが上界側の担保である。
- **スコープ条件には別のテストが要る。** 「上界が広い実行者（例: その蔵書の司書）が呼んでも、宣言したとおりの集合しか返らない」ことは、他人として呼ぶテストでは検出できない。関係スコープのクエリには**上界が広がる実行者で呼ぶケース**を 1 つ置く（`loan_own_list` の TC-…-004 が実例）。
- 実装まで通して読みたい場合は、[samples](../../../../../../legacy/spec-tools/__tests__/fixtures/samples/library/docs/specs/backend/queries)の query_spec と、docs/specs/ のデモ製品が対応する。

---

## 関連ドキュメント

- [ARCH-SP-BE-0001 — バックエンド仕様（docs/specs/backend）の構成](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)
- [action-spec-writing.md](./action-spec-writing.md) — 書き込み側（Server Action 仕様）の書き方
- [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) — 可視性とガード式の正
- [template.query_spec.md](../../../../../specs/backend/queries/template.query_spec.md) — テンプレート
