---
doc_type: architecture
scope: backend
id: ARCH-SP-BE-0001
norms: [PRIN-0001, PRIN-0007, PRIN-0008, PRIN-0011, ARCH-SP-0002]
decisions: [ADR-0004, ADR-0014]
---

# ARCH-SP-BE-0001 — バックエンド仕様（docs/specs/backend）の構成

## 目的

バックエンド仕様の置き場所を、**実装の構造（ARCH-BE-0001 / ARCH-BE-0013）と機械的に対応する形**で定める。仕様ファイルのパスからドメインイベントと実装ファイルが一意に導けるようにし、突合を人間の記憶に依存させない。

## 概要

- `docs/specs/backend/` は用途ごとのサブディレクトリで分ける。整備済みは **`actions/`（Server Action 仕様 = 書き込み）**・**`queries/`（読み取りクエリ仕様）**・**`data/`（テーブル仕様 = DB 固有の実装判断）** であり、他は必要になった時点で追加する。
- Server Action 仕様は **1 ドメインイベント 1 ファイル**とし、`actions/{aggregate}/{event}.md` に `doc_type: action_spec` で置く。
- backend の仕様は**ドメイン仕様を再定義しない**。状態・ロール・ガード・不変条件・フィールド制約は `specs/domain` を参照するだけとする（ARCH-SP-0002）。
- `specs/backend` の仕様は「境界で何を受け、何を返し、どのテストで守るか」に限定する。**薄いことが正しい状態**である。

## スコープ

- **対象**: `docs/specs/backend/` のディレクトリ構成、ファイル分割と命名、`action_spec` の配置、テンプレートの置き場所、他レイヤーの仕様・実装との対応。
- **対象外**:
  - `action_spec` の YAML スキーマ・書き方（→ process/backend/specification/standards/action-spec-writing.md）
  - ドメイン仕様の構成（→ ARCH-SP-0002）
  - 実装の構造（→ ARCH-BE-0001 / ARCH-BE-0013 / ARCH-BE-0014 / ARCH-BE-0015）
  - フロントエンド仕様の構成（→ architecture/specification/frontend。意図的に後続フェーズ）

---

## 構成

```text
docs/specs/backend/
├── README.md                       # doc_type: directory_guide
├── actions/                        # Server Action 仕様（整備済み）
│   ├── README.md
│   ├── template.action_spec.md
│   └── {aggregate}/
│       └── {event}.md              # doc_type: action_spec
├── queries/                        # 読み取りクエリ仕様（整備済み）
│   ├── README.md
│   ├── template.query_spec.md
│   └── {aggregate}/
│       └── {name}.md               # doc_type: query_spec
├── data/                           # テーブル仕様（整備済み）
│   ├── README.md
│   ├── template.data_table.md
│   └── tables/
│       └── {table}.md              # doc_type: data_table
├── template.notification_spec.md   # 通知カタログのテンプレート
├── notifications.md                # doc_type: notification_spec（1 プロジェクト 1 ファイル）
├── template.job_spec.md            # ジョブカタログのテンプレート
├── jobs.md                         # doc_type: job_spec（1 プロジェクト 1 ファイル）
├── template.external_spec.md       # 外部連携カタログのテンプレート
├── external.md                     # doc_type: external_spec（1 プロジェクト 1 ファイル）
└── rls/{table}.md                  # RLS ポリシー仕様(不要。下記「RLS の仕様をどこに置くか」)
```

| サブディレクトリ | 内容 | doc_type | 状態 |
|----------------|------|----------|------|
| `actions/` | Server Action = ドメインイベントハンドラの仕様。入力・エラー・テストケース | `action_spec` | 整備済み |
| `queries/` | 読み取りクエリ仕様。`access_spec` の `reads` を使う経路と絞り込み・返すフィールド | `query_spec` | 整備済み |
| `data/tables/` | テーブル仕様。entity_spec から導出できない **DB 固有の実装判断**（下記「テーブル仕様」） | `data_table` | 整備済み（2026-08-26） |
| `notifications.md` | 通知カタログ。このシステムが送る通知の全数（下記「通知仕様」）。ディレクトリを作らないのは 1 プロジェクト 1 ファイルだからである | `notification_spec` | 整備済み（2026-08-26） |
| `jobs.md` | ジョブカタログ。人手なしで動くものの全数（下記「ジョブ仕様」）。同じく 1 プロジェクト 1 ファイル | `job_spec` | 整備済み（2026-08-26） |
| `config.md` | 設定カタログ。動かすのに要る設定の全数と連携（下記「設定仕様」）。同じく 1 プロジェクト 1 ファイル | `config_spec` | 整備済み（2026-08-26） |
| `auth.md` | 認証フロー仕様。サインインすると何が起きるか（下記「認証フロー仕様」）。同じく 1 プロジェクト 1 ファイル | `auth_spec` | 整備済み（2026-08-26） |
| `guarantees.md` | 保証台帳。設計で不可能にした事実の目録（下記「保証台帳」）。同じく 1 プロジェクト 1 ファイル | `guarantee_spec` | 整備済み（2026-09-03） |
| `external.md` | 外部連携カタログ。外の誰と何のためにやり取りし、鍵が無いとどうなるか（下記「外部連携仕様」）。同じく 1 プロジェクト 1 ファイル | `external_spec` | 整備済み（2026-09-04） |
| `rls/` | RLS ポリシー仕様 | — | **作らない**（下記） |

未整備のサブディレクトリは、**該当する実装に着手する時点で**この表と placement_policy を同時に更新して追加する。先回りして空のディレクトリを作らない。

`actions/README.md` の「操作の索引」(操作 ID・実行ロール・仕様ファイルへのリンク)とハンドブックの「誰が何を実行できるか(操作)」章は生成物であり、action_spec とドメイン仕様から機械的に引く(手で足さない)。

### RLS の仕様をどこに置くか

**RLS 専用の仕様ファイルは作らない**（2026-08-18 決定）。「誰にどこまで見えるか」の正は `access_spec` の `reads` であり、
ポリシーの一覧をもう 1 か所に書くと正が割れる（PRIN-0007）。代わりに `reads` から
**期待ポリシー名の完全集合**（`app/src/domain/generated/rls-expectations.ts`）を生成し、統合テストが
`pg_policies` と突き合わせる。仕様に無いポリシーが DB にあること・あるべきポリシーが無いことの
両方が、この突合で落ちる。

**MUST**: ポリシーの**本文（`USING` 句）も生成物である**（束 ⑳-4a。ADR-0012 ⑤）。生成物が名前までだった
あいだは、`..._within_company_id` という名前のポリシーを置いて `USING (true)` と書けば、宣言も名前の突合も
緑になった（テナント境界の見張りテストの宣言だけが防波堤だった）。`reads` の `scope` / `filters` とロールの根拠
（`kind` / `claim` / `binding`）が揃えば述語は一意に決まるので、表ごとに 1 枚の migration を生成する。

| 生成物 | 宣言する場所 | ファイル名 | 中身 |
|---|---|---|---|
| 表ごとの select ポリシー全数 | data_table の `policies_migration` | `{14 桁}_policies_{テーブル名}.sql` | `revoke all`（**`surface` のロール = anon / authenticated から**）→ `grant select`（`reads` が非 `none` の宛先だけ）→ `enable row level security` → ポリシーごとに `drop policy if exists` + `create policy … for select to … using (…)` |
| ロールごとの RLS 補助関数 | 実行者の集約の data_table の `functions[]`（`kind: helper` + `role` + `migration`） | `{14 桁}_helper_{関数名}.sql` | `public.is_{ロール}()`（security definer・stable・`revoke all from public` + `grant execute to anon, authenticated, service_role`） |
| 境界の欄ごとの補助関数 | 実行者の集約の data_table の `functions[]`（`kind: helper` + `actor_field` + `migration`。`role` とは排他） | `{14 桁}_helper_{関数名}.sql` | `public.actor_{欄}()`（実行者自身の行の欄を返す。引数なし・作法は上と同じ） |

**MUST**: `access_spec` を持つ表は `policies_migration` を宣言する（内部テーブルは宣言できない）。形式・一意性・
補助関数の実在・連番の順（**補助関数 < 全ポリシー**。ポリシーが関数を参照するため）は **T7** が見る。
補助関数の宣言と要求は**両方向**で一致しなければならない —— 要求されるのに宣言が無いのも、`role` を
宣言するのにどのポリシーも要求していないのも（= 宣言だけが残り生成物が 1 本も出ない）、`migration` だけを
宣言して `role` が無いのも T7 が落とす。生成しない補助関数は `role` を宣言しなければよい。
境界の補助関数（`actor_field`）も同じく両方向である —— `reads[].filters` の右辺 `actor.{欄}`（`id` を除く）が
要求する欄ごとに 1 本、関数名は `actor_{欄}` に固定（T7）。要求の母集合は**刈り込む前の計画**から取る
（隠し列のマスクも同じ述語を呼ぶため）。**境界の値の正は実行者の行であり、トークンの属性の写しではない**
（写しは最長でトークンの寿命だけ古い）。

#### 述語の写像

| `reads` の形 | `using (…)` |
|---|---|
| `to`（宛先の Postgres ロール） | `kind: anonymous` のロール → `to anon`、それ以外 → `to authenticated` |
| ロールの根拠（`kind: authenticated_default` / `claim`） | `public.is_{ロール}()`（`claim` は関数の中で `and {欄}` を課す） |
| ロールの根拠（`kind: anonymous`） | `true`（根拠は `to anon` そのもの） |
| ロールの根拠（`binding`）+ `scope: own` | 対象の行の列と `(select auth.uid())` の比較（1 段）／参照を辿る EXISTS |
| `scope: context(X)` | X まで `ref` を辿る EXISTS（2 段以上も結合条件の側に鎖を入れて 1 段に畳む） |
| `scope: all` | ロールの根拠だけ |
| `filters: { 列: actor.欄 }` | `{表}.{列} = (select public.actor_{欄}())`（`(select …)` で初期計画として 1 回だけ評価。`actor.id` は `(select auth.uid())` と直に比べる。両辺の値の種別は V2 が揃える） |
| `filters: { 親.列: actor.欄 }` | `(select w_{親}.{列} from public.{親の表} w_{親} where w_{親}.id = {参照の鎖}) = (select public.actor_{欄}())`（親は `context` で 2 段まで。鎖は `context(X)` の EXISTS・`when` の親の欄と同じ届き方） |
| `when: {ガード式}` | **行の状態の条件**。ガード式の翻訳器（`lib/sql/guard-to-sql.ts`）をそのまま使い、自集約の欄は対象の行の列・親の欄は参照の鎖を辿るスカラー副問い合わせに落とす（`lib/sql/rls-when.ts`）。`actor.*` は写さない（V2 と二重に閉じる） |
| 合成 | `<根拠> and <境界…> and <状態の条件>`。NULL は**式全体を 1 回**だけ `coalesce(…, false)` で閉じる（原子ごとに畳むと `not` の下で意味が変わる） |
| `system` | ポリシーを作らない（service_role がバイパスする） |
| `fields_hidden` | 変えない（列の絞りは api スキーマの生成ビューが持つ） |

**MUST**: `scope` とロールの根拠は**同じことを言っていなければならない**（T7 が見る）。対象に依らず立つロール
（`kind` / `claim`）のスコープは `all` である —— `own` / `context(…)` と書いても述語は補助関数だけになり、
**宣言より広い**ポリシーが黙って出る。逆に `binding` を持つロールに `all` は書けない（述語が束縛で狭まる）。
`context(X)` の X は束縛が指す集約でなければならない。

**手書きの RLS は歴史として残す。** 生成 migration は `drop policy if exists` → `create policy` で同名を
置き換える（定型 RPC の `create or replace` と同じ流儀。migrations.md §生成 migration）。

#### ポリシーの命名規約

**MUST**: 読み取りポリシーの名前は `{table}_select_{role}_{scope}` とする（`scope` は `own` / `context` / `all`。
`context(item)` のような対象付きスコープも名前の上では `context` に畳む）。`reads[].filters`（テナント境界）が
あれば `_within_{列}`（親の列なら `_within_{集約}_{列}`）を宣言順に足す。

**MUST**: **`reads[].when`（行の状態の条件）は名前に出さない**（束 §14）。名前に畳めるのは列の名前のような
短い語であって式ではなく、字面を名前にすると「同じ意味の別の書き方」で名前が割れる。条件が変わったことは
2 つの経路で出る —— ポリシーを生成した migration の名前が新しくなること（C23）と、期待表の
`rlsPolicyConditions`（ポリシー名 → 条件の字面）が `spec:diff` の「見える行」の軸に 🔒 / 🔓 を出すことである。
生成器（`legacy/spec-tools/lib/generate/render/code-rls-expectations.ts`）はこの規約の実装であって、規約の正はここである。

**MUST**: エンティティ名とテーブル名の対応は**規則で導く**。仕様側は単数形、DB 側は複数形であり、
既定は単純な英語の複数形化とする（語尾が `s` / `x` / `z` / `ch` / `sh` なら `-es`、子音 + `y` なら
`-ies`、それ以外は `-s`）。規則で導けない名前のときだけ `entity_spec` の `table:` で上書きする
（[domain-spec-writing.md](../../../process/common/specification/standards/domain-spec-writing.md) §entity_spec）。

| エンティティ（`access_spec` の `entity`） | テーブル | 由来 |
|---|---|---|
| `patron` | `patrons` | 規則 |
| `item` | `items` | 規則 |
| `library` | `libraries` | 規則（子音 + `y` → `-ies`） |
| `hold` | `holds` | 規則 |

**以前はこの対応表をハードコードした写像を生成器が持っていたが、やめた。** 対応表方式は
「生成器が特定のドメインの語彙を知っている」ということであり、別ドメインの仕様を載せた瞬間に
generate が未登録エラーで落ちる（別の製品で行ったストレステスト第 3 弾 C-17 の実測）。規則 + 例外宣言なら、
例外の判断が**仕様の側**に残り、生成器はドメインを知らないままでいられる。上表は規則の適用結果を
人間が確認するための一覧であって、生成器が読む定義ではない。

#### 期待集合の作り方（刈り込み規則）

`reads` の各行から名前を 1 つ作る。ただし次は**作らない**。

- `scope: none` の行 — 「そのロールのポリシーが存在しないこと」が期待になる。
- `system` の行 — `service_role` は RLS をバイパスするため、ポリシーを持たない。
- **`scope: all` の行に包含される行** — 同じテーブルに `scope: all` の行があり、その行のロールを
  `roles.md` の `implies`（ロール階層）で推移的に含意するロールの `own` / `context` 行は作らない。
  RLS のポリシーは OR で合成されるため、「司書は必ず利用者であり、利用者はこのテーブルを全件読める」なら
  司書用のポリシーを足しても**見える行は 1 行も増えない**。冗長なポリシーを仕様が要求すると、
  DB 側に意味のない定義が増え、突合が「書いてあるかどうか」しか見ない分だけ嘘が増える。
  `own` と `context` の間では刈り込まない（どちらも他方を包含しない）。
- **刈り込みの根拠になる `scope: all` は、`filters` も `when` も持たない行だけである** —— 境界や
  行の状態の条件を持つ「全件」は条件を外れた行を通さないので、`own` / `context` を包含しない。
  刈り込んでしまうと、**本人にも見えない行**が生まれる（束 ⑲-2a / §14）。

**MUST**: 刈り込まれる規則に `reads[].when` を書いてはならない（**T7** が error。束 §14）。刈り込まれた
規則の条件はポリシーにも期待表にも `spec:diff` にも現れず、それでも `world`(テストが 1 回の検査のために DB に作る、行と実行者の一式)は反例の行を置くので全検査が<!-- term: world -->
緑になる —— `when` を買った目的（「書いたのに効いていない宣言」を無くすこと）に正面から反する。
**条件は上界の規則に書く。** 上界に条件を足すと刈り込みの根拠が消えるので、狭い規則のポリシーが
新しく生える（= 可視性が広がる）ことに注意する。

#### 突合の閉世界

突合の実装は `app/src/infrastructure/__tests__/rls/policy-parity.test.ts`（ローカル Postgres の
`pg_policies` を直接読む。**内省のための関数などを DB に恒久的に置かない**）。

見る範囲は **public スキーマの全テーブル**である。テーブルは 3 つに分かれ、どれにも当てはまらない
ものが現れたら落ちる（新しいテーブルが検査の外側に静かに増えるのを防ぐ）。

| 種類 | 期待 |
|------|------|
| `access_spec` を持つテーブル（期待表のキー） | 読み取りポリシー名の集合が期待表と**一致**すること |
| 内部テーブル（`jobs` / `domain_events`） | 読み取りポリシーが**1 つも無い**こと（= 全不可視） |
| 上のどちらでもないテーブル | 読み取りポリシーがあれば**エラー**（仕様に載せるか、内部テーブルとして宣言する） |

**MUST**: 読み取りポリシーは `for select` で書く。`for all`（`cmd = 'ALL'`）のポリシーは読み取りを
許すのに名前の規約から外れるため、対象テーブルにあれば無条件で「余分」として落とす。
書き込みのポリシーは `for insert` / `for update` / `for delete` に分けて書く。

#### ポリシーの本文の突合（意味）

**MUST**: 名前の過不足とは別に、**本文の意味**を突き合わせる（`policy-parity.test.ts`。束 ⑳-4a）。方式は
「`policies_migration` が宣言する生成ファイルを**トランザクションの中で適用して** `pg_policies` を読み直し、
適用前の姿と `qual` / `roles` / `cmd` / `permissive` / `with_check` を比べて rollback する」である。

- **正規化器を自作しない。** 両側とも Postgres の `pg_get_expr` を通った字面なので、文字列一致がそのまま
  「意味が同じか」になる。SQL を自分で正規化する道は、正規化器のバグが突合の穴になる。
- **本番 DB に恒久物を残さない。** 内省用の関数を置かないのと同じ理由で、適用も 1 トランザクションに閉じる。
- **RLS 補助関数も同じ方式で突き合わせる。** ポリシーの `qual` は関数名しか持たないので、関数の中身が
  変わってもポリシーの突合では気づけない。比べるのは **`pg_get_functiondef` の全文**（署名・戻り型・
  `language` / `stable` / **`security definer`** / **`set search_path`** の属性・本体）であり、`$$` の中身だけ
  ではない —— 再帰の回避を `security definer` に寄りかからせている以上、`search_path` が落ちれば
  そのまま乗っ取り面になるので、属性は本体と同じ検査の範囲に入れる。ここも**正規化器を自作しない** ——
  生成ファイルをトランザクションの中で適用して `pg_get_functiondef` を読み直し、適用前の姿と比べて
  rollback する（生成ファイルの `set search_path = public` と Postgres が書き戻す
  `SET search_path TO 'public'` は別の字面なので、テキストを直接比べると「同じ意味の別の書き方」の表を
  人が持つことになる）。

#### 挙動の突合（宣言どおりの行集合が返るか）

**MUST**: 本文の突合とは別に、**行を置いて実行する**（束 ⑳-4b）。名前の突合が言えるのは「宣言どおりの名前が
あるか」まで、本文の突合が言えるのは「**生成物どおり**のポリシーが当たっているか」までである ——
述語の翻訳そのものが間違っていれば、生成物と実 DB は仲良く同じ間違いをするので、どちらの突合も緑のまま
になる。閉じるには「宣言どおりの行集合が返るか」を実 DB で確かめるしかない。

| 生成物 | 置き場 | 中身 |
|---|---|---|
| `world` の設計図 | `app/src/domain/generated/rls-worlds.ts` | 表ごとに「何人の実行者を作り、どの行を誰に束縛して置くか」+ ロールの根拠（`kind` / `claim` / `binding` を「どの集約のどの列を実行者と比べるか」まで開いたもの） |
| 表ごとの挙動テスト | `app/src/infrastructure/__tests__/generated/rls/{テーブル名}.rls.test.ts` | 設計図を渡して実行するだけ（実行者ごとに 1 本 + 境界の欄ごとに 1 本 + `world` の検算 1 本） |
| テストケースの宣言 | data_table の `test_cases`（`# AUTO-GENERATED:data-table-rls-tests`） | `TC-RLS-{テーブル名}-{番号}`。`covers` は分類どおり —— **拒否される実行者・宣言の上で 1 行も通らない実行者・境界の見張りテストは `forbidden`**、行が返る実行者と `world` の検算が `success`。手書きのテストケースは印の外に残る |

**MUST**: **`world` の作り方とオラクルは生成しない**（仕組み側に 1 回だけ手で書く）。置き場は
**実行時パッケージ**（`@kaninabe/runtime/testing/rls/{world,oracle,expect}`。ADR-0013・束 ①-d）であり、
製品側の `__tests__/rls-{world,expect}.ts` は**生成物**である —— 生成物と口（`HarnessPorts`）を束ねて渡す
だけの配線で、生成テストが呼ぶパスを動かさないために置いてある（生成器 `code-harness-adapters`）。
手で書くのは口の実装（`harness-ports.ts`）1 本だけである。オラクルは**仕様からのもう 1 つの写像**であり、SQL の述語を組み立てる
翻訳器（`lib/sql/rls-predicate.ts`）を 1 行も参照しない —— 参照した瞬間に、独立した読みではなくなる。

**MUST**: 設計図は**ポリシーの計画（`policyPlans`）を 1 つも運ばない**。「未ログインに `grant select` が
出るか」＝「拒否されるか」をここから渡していたあいだ、期待と生成 SQL は刈り込みの規則を共有していた ——
翻訳器がポリシーを誤って刈り込めば、migration も期待も同じように消えて検査は緑のままになる（この束が
塞ぐと宣言した穴そのものである）。権限の有無もオラクルが `reads` とロールの `kind` から導く（未ログインは
`kind: anonymous` のロールに `none` でない読み取りが 1 つでもあれば、認証済みはそれ以外のロール
（`kind: system` を除く）に `none` でない読み取りが 1 つでもあれば許可）。**オラクル自身にはユニット
テストがある**（`__tests__/rls-oracle.unit.test.ts`。ロールの根拠も `world` もリテラルで渡して実行する純関数であり、
実 DB を使わない ―― 唯一の第 2 写像が間違っていれば挙動テストは仲良く緑になる）。

`world` の形（設計図が決めること）:

- **実行者**はポリシーに現れるロールごとに 1 人 + 束縛を持たない既定のログイン実行者（他人）+ 未ログイン。
  `claim` の欄を真にする実行者とそうでない実行者は同じ人にできないので、ロールごとに分ける。
- **行は実行者ごとに 1 系統**で、系統の中では**集約ごとに 1 行**を共有する（参照を別々に作ると、
  「この行の親はその行の親と同じ」という行内比較の不変条件が必ず落ちる）。系統のすべての参照は同じ系統を
  指し、実行者の集約への参照はその系統の実行者自身の行になる。
- **例外は束縛が名指しする列である。** その系統の実行者の束縛でなければ、束縛の列は**別の行（別人）**を
  指す。同じ相手を指す参照が 2 本あり（`fixture` `expenses` の `claim` は `employee_id` と `approver_id` が
  どちらも `ref(employee)`）、それぞれに別のロールが束縛されている形では、1 行に畳むと**どちらの束縛も
  必ず同時に立つ** —— 述語の列を隣の列に取り違えても検査が緑のままになる。実行者の集約の行は認証ユーザと
  1 対 1 なので、分けた行にも認証ユーザを作る。
- **どの表にも「ログインしているが実行者の集約に行が無い人」を 1 人置く。** `kind:
  authenticated_default` の根拠は「実行者の集約にその人の行があること」であり、生成される補助関数
  `public.is_{ロール}()` が見ているのもそれである。行を持つ人しか `world` に居ないと、granted な全ロールが
  `scope: all` の表では**ポリシーを `using (true)` に潰しても検査が通る**（2026-09-12 実測。題材の製品の
  `items` で `using (true)` に潰すと、この実行者の 1 本だけが赤になる）。招待を受け取っただけの認証
  ユーザは本番に実在する状態である。
- **値は型と宣言から決める**（`auto` / `state(...)` / `supplied_by: db` / `defaults` 持ちの欄には値を置かない
  = DB が決める値をテストが書き写さない）。一意は `world` 全体で共有する連番で、行内比較の順序は
  `formal.type: check` の欄どうしの比較から、範囲は `min` / `max` から満たす。
- **境界（`filters`）の列**には、その系統の実行者のセッション属性を写す。系統が違えば値も違うので、
  「他のテナントの行」が `world` に必ず存在する。`it` の名前は **T4 が要求する見張りテストの名前そのもの**であり、
  生成物が宣言を満たす。

**MUST**: `world` を宣言から作れない表は**生成しない**。判定は「執行点（トリガ・CHECK）の条件が宣言から読めるか」
であり、**T8** が同じ判定で warning を出す（生成器が黙って飛ばすと「実行されていない表」が理由も無く増える）。

| 執行点 | 判定 |
|---|---|
| 挿入で実行されないトリガ（`fires` に `insert` が無い） | 行の作成に効かないので無視する |
| 値を供給するトリガ（`supplies`） | その列に値を置かない。ただし**必須の参照列**を供給するものは作れない（行の置き場をトリガが決める）—— 例外は**祖先の列の写し**で、そのトリガが宣言する不変条件の `formal` が `{自表}.{列} == {別の集約}.{列}` なら、値の出どころが `world` の中にあるので列を置かずに挿入する（トリガが埋める。`supplies` の列は T9 が `supplied_by: db` を宣言させる） |
| 由来の不変条件が `check` / `uniqueness` / `exclusion` | 値の写像が満たす |
| 由来の不変条件が `cardinality` | 群の鍵が**すべて参照の列**で、上限が 1 以上なら満たす（系統ごとに 1 群 1 行になる）。上限 0 は作れない |
| 由来の不変条件が `state_dependency` / `formal` 無し | 作れない（初期状態でない状態を要求する / 条件が DSL の外にある） |
| `pattern` を宣言した欄 | 機械的に置いた値を実際に照合する（合わなければ作れない） |

**MUST**: 生成した挙動テストは**`fixture` の通し実行でも型検査する**（`legacy/spec-tools/__tests__/samples/harness.ts`。
呼び先のハーネス 3 本を一時ツリーに写し、そのアプリごとに違う実物 —— 行の型・セッション属性の書き込み口・
シード —— だけを最小形で置く）。載せないと「宣言を 1 行足したら生成テストが型エラーになる」経路が
4 題材で誰にも踏まれないまま残る。

作れない表の RLS は**手書きの RLS テスト**が受け持つ。表が `world` を作れなくなるのは、
**`formal` の無い不変条件・数の上限・状態依存・トリガが決める参照先**を持つ表である（理由は T8 が 1 件ずつ
宣言する。どの表が当たるかは製品の宣言で決まり、この文書は数を決めない。例: 数の上限を持つ貸出の表）。
手書きの RLS テストが残る表は別の勘定で、生成テストがある表にも手書きが残ることがある —— 注釈を動かさない方針
（重複は許す）だからである。実行されていない表が黙って増えないことは、挙動テストの閉世界
（`behaviour-coverage.test.ts`。保証 `policy_body_from_spec` の見張りテスト）が見る。

#### 中継表の RLS は重なる（実測した事実）

**`scope: context(X)` のポリシーは、中継する X のポリシーの下でも評価される。** ポリシーの `USING` 句に
書いた `EXISTS (select 1 from X …)` は**実行者の権限で**走るので、X 自身の RLS がその実行者に X の行を
見せないなら、EXISTS は偽になり対象の行も返らない（2026-09-12 に実測。`item_checks` の
`context(item)` のポリシーだけを残し、`items` の select ポリシーを `using (false)` に潰したところ、
司書に見えていた 1 行が 0 行になった）。

したがって **`context(X)` を宣言する表は、その実行者が X も読めることを前提にしている**。題材の製品では
文脈依存ロールが `implies` で既定のログインロールを含み、そのロールが中継表を全件読めるので、この前提は
宣言の側で満たされている。満たされない宣言（中継表が `scope: none` の実行者に `context(X)` を与える）は
**ポリシーの本文としては生成できるが、行は 1 つも返らない** —— 名前の突合も本文の突合も緑のまま通る。

**この事実は恒久のテストが見張る**（`__tests__/rls/context-relay.test.ts`。保証 `policy_body_from_spec` の
見張りテスト (旧製品の保証台帳の行)）。1 つのトランザクションの中で中継表のポリシーを `using (false)` に
潰し、**同じ接続で**実行者として読み直して 0 行になることを見て `rollback` で戻す（散文だけを根拠にすると、
Postgres の版が変わったときに誰も気づかない）。宣言の段では **T10** が「`context(X)` を与えるロールが X を
読めるか」を見る（読めないという宣言は warning。挙動テストは「返る行が宣言と違う」までしか言えず、原因を
宣言しない）。

#### この突合が守らないもの（誤解すると危険なので明示する）

- **書き込みのポリシーは生成しない**。`USING` を生成するのは `for select` だけである（書き込みの直接経路は
  最初から作らない = 全書き込みが security definer の RPC を通るため）。
- **読み取りだけを見る**。`insert` / `update` / `delete` のポリシーの過不足は v1 の対象外である
  （書き込みは第一防衛線がアプリ側にあり、RLS は第二防衛線であるため。読み取りではこの関係が
  変わる — ARCH-BE-0016）。
- **列の可視性は見ない**。`fields_hidden` は RLS では執行できない（行しか絞れない）。執行点と手段は
  ARCH-BE-0016 の「守るもの・守らないもの」を参照。
- **挙動テストは「`world` を作れた表」しか実行しない**。作れない表は T8 が報告するが、報告したからといって
  可視性が確かめられたことにはならない —— その表は手書きの RLS テストが受け持つ（テストケースの宣言は
  data_table の `test_cases` か保証台帳に残る）。

### テーブル仕様（data_table）

**data_table が持つのは entity_spec から導出できない DB 固有の実装判断だけ**である（2026-08-26 開設。
採用の条件は「対応がちゃんと取れる突合検査で保証されること」— 下記の 3 層検査がその条件の実装である）。
列・型・NOT NULL・フィールド制約の正は entity_spec（strict な rowSchema + row-parity が閉世界で守る）、
読み取りポリシーの正は access_spec の `reads`（rls-expectations + policy-parity）、不変条件の条件式の正は
invariant_spec であり、**data_table はどれも再定義しない**（PRIN-0007。名前と ID で参照するだけ）。

**MUST**: data_table が宣言するのは次の 8 種と、**生成物の書き出し先を宣言する 2 つの宣言**
（`policies_migration` / `ddl_migration`）である。

| 宣言 | 内容 | 突合 |
|------|------|------|
| `indexes` | 主キーの裏以外の全インデックス（名前・列・一意・部分述語） | 双方向（一致した名前は 列・一意・部分有無 も比較） + T2（下記） |
| `sequences` | **採番の器**（`create sequence`）の名前と、宣言する場合の `start`。`defaults` の式が `nextval('{name}')` で呼ぶもの | 双方向（`public` のシーケンスの全数 ⇔ 全ファイルの宣言の和集合。宣言した `start` は値も比較）+ T13（`defaults` が名指す名前がどこかで宣言されていること / 宣言したのに誰も使わないこと） |
| `exclusions` | 全**排他制約**（`exclude using gist`）の名前・一致で見る鍵（`keys`）・期間の 2 列（`range`）・部分述語（`where`）・由来の不変条件 | 双方向（名前の集合 ⇔ `pg_constraint` の `contype = 'x'`）+ T5（宣言の中身が invariant_spec と一致すること） |
| `foreign_keys` | 全外部キーの 列・参照先・**ON DELETE**（削除の連鎖は業務上の意味を持つ実装判断） | 双方向（同一性は 列 + 参照先 + on_delete。制約名は自動命名なので見ない） |
| `triggers` | 全トリガの名前と関数、**コミット時評価か**（`deferred: true` = `deferrable initially deferred`）、および**発火の細部**（`fires`。いつ・何で・何ごとに）。値を供給するトリガは**どの列を埋めるか**（`supplies`）と**使う定数**（`params`。**同じ行の日時列 ± 定数の幅なら `derives`**）も宣言する。**供給する列が全部「祖先の列の写し」か「導出（`derives`）」なら本文は生成物である**（下記 §「入力に無いがサーバーが決める値」） | 双方向（名前 + 関数 + `deferred` ⇔ `pg_trigger.tgdeferrable` かつ `tginitdeferred`、`fires` ⇔ `pg_trigger.tgtype` を割った「before / after」「insert / update / delete / truncate」「行 / 文」）。**列の名指し（`of …`）までは比べない**（`tgattr` を読む別の判断）。`supplies` / `params` は宣言のみ（トリガの実在は上の双方向が見る）。`derives` から生成した本文は `prosrc` の md5 まで見る |
| `defaults` | **列の既定値**（列名 → SQL の式）。entity_spec が `supplied_by: db` を宣言した欄の機構のうち、列の既定値で決まるもの | 片方向（宣言した列に既定値が実在し、式が一致すること ⇔ `pg_attrdef`。`id` / `state` のように entity_spec からの導出で入る既定値は宣言に現れないので全数突合はできない — CHECK と同じ線引き。状態の欄は書けない = T1） |
| `functions` | この表を持ち場とする public スキーマの関数（RPC・トリガ関数・RLS 補助）。**全ファイルの和集合が public の関数の完全集合**になる。`kind: rpc` は**形**（`shape`）・**引数名**（`params`）・**併せて書く表**（`also_writes`）も宣言する。本文が自表を絞り込み・並べるなら **`lookup`**（列の並び。下記 §「`indexes` は導出する」）も宣言できる | 閉世界（名前 + 引数型 + 引数名。rpc/helper は security definer、trigger は返り値 trigger も見る）+ **本文の突合**（下記） |
| `resend` | **作成の冪等な再送で既存の行を返すか**(`returns_existing`)と、返すときの**作成者の欄**(`creator`。書かなければ監査ログの実行者で確かめる)。`shape: create` の関数を持つ表と、保存点の最初の作成の錨になる表に必須(下記 §作成の再送と実行者の縛り) | T6(単発の作成)・Y12(保存点の錨)が本文の組み立てと同じ写像で見る。実 DB は見張りテスト(保証 `create_resend_own_rows_only`) |
| `checks` | entity_spec / state_spec の**導出でない** CHECK 制約 | 双方向（表ごとの CHECK の名前の集合を `ddl-parity` が閉世界で突き合わせる —— **導出分は entity_spec から名前も式も生成される**ので、宣言とあわせて全数が言える。`rule` を書いた行は式も、`invariant` を書いた行は `comment on constraint` も比べる。**`invariant` だけを宣言する行は、その不変条件の `formal` から式が生成される**ので式も比べる（下記）。生成できない行・`handwritten` を宣言する行だけが実在までである） |

- **MUST**: `entity` を持つ表は **`ddl_migration`**（`{14 桁}_ddl_{テーブル名}.sql`）を宣言する。
  表の DDL —— 列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・排他制約・RLS の有効化・
  `comment on` —— は entity_spec と上の 7 種から**決まりきっている**ので生成物であり、これはその
  書き出し先の宣言である（`policies_migration` と同じ形。T12 が形式・一意性・必須と、DDL が実際に
  組み立てられることを見る）。**内部テーブルが宣言できるのは `framework:` を宣言したときだけ**で
  あり（下記）、それ以外は列・型の正がどこにも無いので形を導けず、DDL は手書きのままである。
  **DDL が変わる仕様変更では名前を新しくする**（[migrations.md §生成 migration](../../../process/backend/system/standards/conventions/migrations.md)）。
- **MUST**: **表の ACL（誰がその表で何をできるか）の執行者は 2 つに分かれる**。`surface` のロール
  （`anon` / `authenticated`）は上のポリシーの migration が（正は `reads`）、**特権ロール
  （`service_role`）は系に 1 本の権限の migration が**（正は仕組み。どの表でも `select` /
  `insert` / `update` / `delete` の 1 組）出す。出すのは `revoke all … from service_role` →
  その 4 権限であり、**剥奪してから与え直す**ことに意味がある —— Supabase は `postgres` が
  `public` に作る表に `TRUNCATE` / `REFERENCES` / `TRIGGER` / `MAINTAIN` を既定で与えるので、
  「与えていない」は剥奪してはじめて成り立つ（`truncate` は行トリガを発火しないので、追記専用を
  執行するトリガに見えない）。逆に `select` は既定に**無い**ので、明示しないと空の DB では
  特権ロールが自分の表を 1 行も読めない（4 題材の実行で 42501。2026-09-23 の実測）。
  **役者を分けてあるので当てる順序に依らない** —— 権限の migration は `surface` のロールに触らず、
  ポリシーの migration は特権ロールに触らない。1 つにまとめないのは、可視性（`reads`）を
  変えただけで権限の採番をやり直すことになるからである。**ポリシーを 1 本も持たない表**
  （`framework:` を宣言する表と `internal: true` の表）だけは、`surface` のロールの剥奪も権限の
  migration が出す。突合は `ddl-parity` の **ACL の閉世界**（表 × ロール × 権限を `relacl` と
  両方向 + 列単位の権限が 1 つも無いこと）であり、その母集合は **data_table の全数**である。
- **MUST**: **関数の実行権限は閉世界である** —— 面のロール（`anon` / `authenticated`）と `PUBLIC` が
  実行できるのは、仕様から導ける関数（土台の 2 本・隠し列の述語 `can_see_*`・RLS 補助関数）
  **だけ**で、書き込みの RPC・トリガ関数・手書きの関数は呼べない。RPC は実行者を引数で信じる
  （`p_actor_id`）ので、面のロールから呼べることは偽の実行者で何でもできることと同じである。
  関数は作った瞬間に `PUBLIC` へ実行権限が開き、プラットフォームの既定では面のロールにも名指しで付くので、
  各関数の `revoke all on function … from public` では閉じない（名指しの付与は残る）。
  剥奪は**系に 1 本の `grants_migration`** の末尾の節が出す（宣言の外の全関数から面のロールと `PUBLIC` を
  外し、以降に作る関数の既定の付与も外す。関数の一覧は流す時点の DB から引く）。各関数の migration を
  直さないのは、**RPC を足すたびに全 RPC の migration を採番し直す**ことになるからである。
  RPC を足してもこの 1 枚の中身は変わらず、補助関数・隠し列を足したときだけ採番し直す。
  **新しい関数の既定の実行権限も同じ節が閉じる** —— 既定は全体の付与と、スキーマごとの付与の 2 層で、どちらも
  **作成主体（`for role`）ごとの別の行**であり、**加算で効く**（片方から外しても、もう片方の付与は残る）。
  `alter default privileges in schema …` は全体の行を消さず、`for role` を省くと実行した役の行しか書き換わらない。
  だから関数を作る役（プラットフォームの設定 `functionCreators` と migration を流す役）ごとに、**全体からも各スキーマからも
  `PUBLIC` と面のロールの両方**を外す。既存の関数の剥奪も、既定の権限の文の `functions` が手続きと集約も含むのに揃えて、
  **種別を問わない**（通常の関数・手続き・集約・ウィンドウ関数。文は `routine`）。
  作成主体の**扱いは設定が 2 つに分ける**。migration が閉じる責務を持つ役（`migration`）は、**実在するのにその役の
  利用者でなければ migration を止める**（`raise exception`。通知で飛ばすと、開いたままの役が緑で通る）。実在しない役は
  飛ばす（作れない役は関数を作らない）。プラットフォームが持ち migration からは触れない役（`external`。例: 拡張や内部の
  関数を作る管理者の役）は `reason` が必須で、閉じられないことを生成物のコメントに名指しする。**この役が後から作る
  関数の既定は閉じない** —— 保証の範囲は「流す時点の一覧の剥奪 + 閉世界の突合（function-acl-parity。外部の役が
  作った開いた関数も、次の突合で赤になる）」であり、作成主体の既定が全員閉じていることまでは言わない。
  許可は署名まで含める（`{スキーマ}.{名前}({引数の型})`。同じ名前の別の overload を許可に紛れさせない）。
  突合は `function-acl-parity`（`proacl` の全数を両方向）・`function-default-privileges`（役ごとの既定と、
  実際にその役で作った未宣言の関数）と保証 `rpc_not_callable_by_end_users`。
- **MUST**: **特権ロールの権限は表ごとの DDL ではなく、系に 1 本の `grants_migration`**
  （`{14 桁}_grants.sql`）が出す。書き出し先を宣言する場所は**`surface` の仕様書
  `docs/specs/backend/surface.md`（`surface_spec`）**であり、`surface_base_migration` と同じ流儀である ——
  どちらも「アプリの表に属さない、系に 1 枚の生成 migration の書き出し先」だからである。
  表ごとの DDL に置いていたあいだ、**仕組みの 1 行を変える日のコストが表数に比例していた**
  （実測: 権限の 1 組を変えた束で 16 本の migration が動き、表ごとの差分は 4 行だった。
  2,893 行を書き直して意味は 2 行である）。系に 1 本なら**どのプロダクトでも常に 1 本**になる。
  **載る表は data_table の全数**であり、`ddl_migration` を宣言できない表（形の正がどこにも無い
  内部テーブル）も入る —— **形の正が無い表にも権限の正はある**（仕組みの 1 組である）ので、
  外す理由が無い。表ごとの DDL に権限があったあいだ、その表だけが「特権ロールから `truncate`
  できるまま」ACL の閉世界の外にいた。引き換えは**表を 1 枚足す日に migration が 1 本増える**
  ことである。T12 が必須・名前の形・一意を見る。**連番と表の DDL の前後関係は無い**（2026-09-26）
  —— `grant … on public.{表}` は表が在ってはじめて通るが、それは**存在ガード**
  （`to_regclass('public.{表}') is not null`。外部キーを両側のファイルに出すときと同じ道具）が
  持つ。番号で保証していたあいだ、**表の DDL を 1 枚再発行するたびにバイト同一の `_grants.sql` が
  1 本増えていた**（実測: 同じ束で 2 回）。表の実在は歴史が保証しており、番号は保証していない
  （`surface_migration` の T12 と同じ答え）。権限より後ろの番号で**新しく**作られた表は、
  次の再採番で拾われる —— **表を 1 枚足すと権限のファイルの中身が変わる**ので、採番し直して
  いなければ `generate:check` が適用済みの書き換えとして落とす。それでも欠けた表は
  `ddl-parity` の ACL の閉世界と、空の DB に全部当てる `samples:db` が名指す。
  **「宣言しない構成」は無い** ——
  後ろの番号は歴史のある DB でも必ず取れるので、そこに逃げ道を作れば免除リストである
  （設計の経緯は非公開の開発記録）。
- **MUST**: 列の既定値が `nextval('{名前}')` で採番するなら、その器を **`sequences`** に宣言する。
  生成 DDL は `create sequence if not exists` を**表より前**（同じファイルの冒頭）に出す ——
  既定値の式がその器を呼ぶので、後ろに置くと表そのものが作れない。**宣言が無い器は誰も作らない**：
  題材の製品は連番の既定値を 1 つも持たないのでこの穴は見えず、4 題材を空の DB に当てた最初の実行が
  2 題材で `relation "…_seq" does not exist` に落ちて初めて分かった（束 ③-2 の実測。名指しと宣言の
  突合は T13、実 DB との閉世界は `ddl-parity`）。
- **MUST**: **仕組みが自分で持つ表**（副作用の outbox `jobs` と監査ログ `domain_events`）は
  `framework: {表の名前}`（値域。表の名前と一致すること）を宣言し、`ddl_migration` を持つ。
  列・型・NOT NULL・既定値・固定 CHECK の正は**仕組みの設計図**
  （`legacy/spec-tools/lib/sql/framework-tables.ts`）にある —— 列を決めているのは定型 RPC の本文
  （`lib/sql/rpc-parts.ts` が積む列）であってアプリではないからで、アプリの側に書き写すと
  新しいアプリを起こすたびに同じ 2 表を写す作業が残る。**`domain_events.entity` の値域だけは
  ドメイン仕様の集約の全数から生成する**（集約を足したら `generate` で追随する。人が migration に
  1 語足す作業は無くなった）。索引はこれまでどおり data_table の `indexes` が正である
  （閉世界を双方向に見ているのは data-table-parity であり、設計図にも持たせると正が割れる）。
- **MUST**: **公開スキーマの土台**（`create schema if not exists {公開スキーマ}` と呼び出し主体を解決する
  関数 2 本・その権限。公開スキーマは後段の設定 `exposedSchema`、いまの後段なら `api`）は生成物であり、書き出し先を **`surface_base_migration`**
  （`{14 桁}_{公開スキーマ}_base.sql`）が宣言する。中身はどのアプリでも同じで、**アプリの表に属するもの
  ではない**ので、宣言の置き場は**`surface` の仕様書 `docs/specs/backend/surface.md`（`surface_spec`）**である
  （T12 が「名前の形」「連番の前後」を見る。書き方は
  [surface-spec-writing.md](../../../process/backend/specification/standards/surface-spec-writing.md)）。
  `surface_spec` の責務は **SQL の境界だけ**（外に出すスキーマ・ビュー・土台の関数・DB ロールへの grants）で、API 層がその公開面を
  どう外に出すかは後段の能力 `PlatformProfile.surfaceExposure` が受け持つ。能力を持たない後段では、この節の生成と T12 の判定は**未対応**と報告する。
- **MUST**: **SQL の公開面 `surface` のビュー**（公開スキーマ。列の全列挙・隠し列のマスク・権限）は
  生成物であり、書き出し先を表ごとの **`surface_migration`**（`{14 桁}_{公開スキーマ}_view_{テーブル名}.sql`）
  が宣言する。**名前の規則は適用済みでない migration にだけ効く** —— 適用済みの migration は歴史的な識別子で（C23）、
  名前を問わず内容の突合だけを受ける（`exposedSchema` を改名した製品は未対応と赤になる）。entity_spec と access_spec の両方を持つ表には**必須**である（T12）。列と並びの正は
  entity_spec の `fields`、隠し列の正は access_spec の `fields_hidden`、マスクを解く条件の正は
  `reads`（**刈り込む前の** select ポリシーの述語の論理和）であり、どこにも決める余地は残って
  いない。**SQL が変わる仕様変更では名前を新しくする**（列を 1 つ足せばビューの字面が変わる）。
  **内部テーブル**（`internal: true`）でも、**仕組みの設計図を持つ表**（`framework:` を宣言する表）は
  列が設計図から導けるので `surface_migration` を宣言してよい —— ただし**必須ではない**
  （その表を `surface` に出すかどうかは仕様に現れない実装事情であり、「出すなら生成物にする」が線である）。
  権限だけが 1 ビット違い、**`surface` のロール（anon / authenticated）には何も与えない**
  （外の口からは完全に消える。正は `lib/sql/api-acl.ts` が両側へ配る）。
  いま生成物になっていないのは**列の正がどこにも無い**内部テーブルだけで、それは surface_spec の
  `hand_written_views` が表と**理由**を宣言する。免除リストではない —— 同じ表が
  `hand_written_views` と `surface_migration` の**両方を宣言することはできない**（T12）。
- **MUST**: `surface_base_migration` を**宣言する場合は**、その連番を **公開スキーマに関数・ビューを
  作る生成 migration**（定型 RPC・RLS 補助関数・ポリシー・保存点の複合 RPC・受信の RPC）の
  **どれよりも前**にする。空の DB に順に当てるとき、スキーマがまだ無ければ
  `create or replace function {公開スキーマ}.…` はその場で落ちる —— T7 の「補助関数はポリシーより前」と
  まったく同じ、番号でしか表せない前後関係である（T12）。
- **宣言しない構成もある（土台だけ）。** 公開スキーマの土台を**手書きの migration が持つ**リポジトリ（歴史のある
  リポジトリ。題材の製品は `supabase/migrations/20260904000037_api_schema.sql` がそれである）は
  `surface_base_migration` を宣言しない —— 生成物に置き換えるには上の連番の規則を満たす番号が要り、
  既に適用済みの版より小さい番号は後から宣言できない（既存の DB の作り直しが要る。人の判断）。
  宣言が無ければ T12 は 1 つも鳴らない。**空の DB から作るシステム（4 題材）は宣言する**ので、
  生成器と規則はそちらで実証されている。この非対称は**暗黙にしない** —— どちらの構成なのかは
  「宣言があるか」で読めるようにしてある。
- **MUST**: **外部キーは両側の表のファイルに、存在ガードつきで出す**（生成器が決める。仕様は
  置き場を書かない）。表を作るのは表ごとの DDL なので、新しい DB に順に当てるとき参照先の表が
  先に無いと `add constraint … references` が落ちる。だから両側に出し、**両方の表が在って、
  その列にまだ外部キーが無いときだけ張る** —— 先に当たった側は通り過ぎ、後から当たった側で
  張られる。**相互参照する 2 表**（どちらを先にしても片方が後ろを向く組）でも当たり、連番には
  「当たる順番」以外の意味が無くなる。
  **置き場を連番で決めてはならない。** 再発行は番号を必ず上げるので置き場が動き、**中身が 1
  バイトも変わらない隣の表のファイルを付け替える連鎖**が起きる（実測: 中心の表に列を 2 本
  足した束で 9 本が動き、8 本は旧ファイルとバイト同一だった。列を 1 本足す日は 10 本 → 2 本に
  なった）。存在の確認は **`to_regclass('{スキーマ}.{表}') is not null` を条件式の外側の `if` に
  置く** —— SQL は `and` の評価順を約束しないので、`pg_constraint` を引く条件と 1 つにまとめると
  `'…'::regclass` が先に評価されて落ちうる。
  引き換えは「**参照先が現れなければ外部キーが静かに欠ける**」経路であり、それを見るのは
  `data-table-parity` の**外部キーの双方向突合**（宣言 ⇔ 実 DB の閉世界）である。この突合は
  `fixture` の実行（`npm run samples:db` の 3 段目）でも実行される。
  T12 が見るのは **参照先の表が data_table にあること**だけである（別スキーマの表
  （`auth.users`）はこの体系の外）。**採番の器も同じ理由で連番を読まない** ——
  `create sequence if not exists` は冪等なので、**名指す全表と宣言した表**のファイルに出す
  （設計の経緯は非公開の開発記録）。
- **MUST**: 1 テーブル 1 ファイル。パスは `data/tables/{table}.md`、`id` は `table-{table}`（T0 が一致を検査）。
- **MUST**: ドメイン仕様に現れない内部テーブル（`jobs` / `domain_events`）は `entity` の代わりに
  `internal: true` を宣言する（そのうち仕組みが持つ 2 表はさらに `framework:` を宣言する）。これは「読み取りポリシー 0 本 = 全不可視」の宣言であり、
  policy-parity の内部テーブル一覧の**正**になる（生成物 `data-table-expectations.ts` の
  `internalTables` を統合テストが読む。手書きの重複を持たない）。
- **MUST**: `test_cases` に**表ごとの突合テストの宣言**を持つ。宛先は
  `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::{table} の宣言どおりの実体だけが DB にある`
  であり、テスト名は表名から機械的に決まる（T3 が宣言の実在とテスト名の一致を見る）。
  **この宣言が data_table の宣言（索引・外部キーの ON DELETE・トリガ・CHECK）が実 DB と
  突き合わされる唯一の経路である** —— 宣言が無い表は、宣言だけがあって何も守られていない
  （2026-09-09 に 3 表で実測した穴。T3 が無かったため「実在しないテスト名を指す宣言」が緑で通っていた）。
  突合テスト側も期待表（`data-table-expectations.ts`）のキー全部に掛かっていることを
  自分で確かめる（表を足して `it` を書き忘れると、そのテスト自身が落ちる）。

#### 表の DDL は生成物であり、導出 CHECK の名前は 4 語に固定する

**MUST**: entity_spec から導出される CHECK の制約名は `{表}_{列}_{接尾辞}` であり、接尾辞は
**次の 4 語しか無い**。

| 宣言 | 接尾辞 | 条件式（`pg_get_constraintdef` の字面） |
|------|--------|--------------------------------------|
| `max_length: N`（`string` / `text`） | `_max_length` | `(char_length(列) <= N)` |
| `min` / `max`（`integer` / `decimal`） | `_range` | `((列 >= a) AND (列 <= b))` / `(列 >= a)` / `(列 <= b)` |
| `enum([...])` / `state(機械)` | `_enum` | `(列 = ANY (ARRAY['a'::text, …]))`（`state` の値域は state_spec の `states`） |
| `pattern` | `_pattern` | `(列 ~ '…'::text)` |

`enum([...])` と `state(機械)` が同じ `_enum` を使うのは、**どちらも「値の値域」**であり
DB に出る制約がまったく同じ形だからである（値の出どころが entity_spec か state_spec かの
違いしかない）。分けると `{表}_state_state` のように同じ語が 2 度出る名前になる。

制約が効く型の組み合わせは **zod の生成とまったく同じ 1 本**（`lib/sql/sql-types.ts` の
`isStringLike` / `isNumeric`）から出る —— 入口（zod）と DB で効く型が食い違うと、入口で通った値が
DB で弾かれることになる。

- **なぜ名前を固定するのか。** 名前が「どの列のどの制約か」から機械的に決まることが、突合を
  **双方向**にできる条件である。自由に名付けられると「DB にあって宣言に無い制約」と「名前だけ
  違う同じ制約」が区別できない（`_length` / `_format` のような揺れが実際に 5 本あった）。
- **MUST**: 列の既定値の導出は 3 通りだけである —— `auto` + `uuid` は `gen_random_uuid()`、
  `auto` + `datetime` は `now()`、`state(機械)` は `'初期状態'`。それ以外の既定値は
  `defaults` が宣言する（宣言が導出に優先する）。**状態の欄は `defaults` に書けない**（初期状態の正は state_spec の `initial` の 1 か所。
  作成の RPC は状態の列を書かないので、書けば `initial` を読む検査と DB が黙って食い違う。T1 が error にする）。
- **MUST**: NOT NULL は「**行で必ず値があるか**」であり、判定は行のスキーマ（`code-zod.ts` の
  `absenceInRow`）と同じ `migration` / `auto` / `state` 型に、`defaults` で既定値を宣言した列を
  足したものである。**`supplied_by: db` はそれ自体では NOT NULL にしない** —— 供給するトリガが
  **空を書くことがある**からで、`holds.comment`（貸出の `public_comment` の写し。元が空なら
  空のまま入る）がその実例である。「トリガが埋めるなら必ず値がある」は成り立たないので、
  `triggers[].supplies` は NOT NULL の判断に使わない（値の供給元の宣言であって、
  「必ず値が入る」の宣言ではない）。
- 生成 DDL は**冪等**である（`create table if not exists` / `add column if not exists` /
  索引は `create index if not exists` / **部分索引は定義を比べて作り直す** / CHECK は「定義が食い違うときだけ」の、外部キー・排他制約は「まだ無いときだけ」の
  do ブロック）。部分索引は `if not exists` だと同じ名前のまま `where` を変えた DDL が黙って無視されるので、空の一時表に同じ定義の索引を作り、Postgres の印字どうしを比べて、違えば落として作り直す（既存の行が新しい条件に反すれば migration が止まる。行は読まないので同じなら何も起きない。点検 14 回目 A14-3）。部分でない索引の `on` / `unique` の変更と、排他制約の変更は収束しないが data-table-parity が赤にする（手書きの migration で直す）。CHECK も無条件の `drop` → `add` にしないのは、`add constraint … check` が
  **ACCESS EXCLUSIVE ロック + 全行検証**だからで、結果が同じでも当てるたびに全表スキャンが走るのは
  冪等とは呼べない。**列は足すだけで、落とさない・型は変えない・既存の列に NOT NULL を付けない**
  —— データに触る判断は人が手で書く migration の仕事であり、食い違いは統合テスト `ddl-parity` が
  error で名指す。
- **MUST**: 生成 DDL の 1 ファイルは**1 トランザクションで当てる**（`supabase migration up` が
  そうする）。CHECK を作り直す `drop` → `add` の間は同一トランザクションの中にあり、1 文ずつ
  autocommit で当てるとその間を違反行が通れる —— CHECK は落とすと**緩む**方向なので、
  ポリシーの `drop` → `create`（落とすと見えなくなる = fail-close）とはリスクの向きが逆である。
- **MUST**: `checks[]` の行の**式の出どころは 1 つ**である。`rule` を書けばその字面が、
  **`invariant` だけを書けばその不変条件の `formal` から写した式**が DDL に反映される（写像は
  `lib/sql/check-expression.ts`。式全体を 1 回だけ `coalesce(…, false)` で全域化し、字面は
  `pg_get_constraintdef` が印字する正準表記に合わせる）。**両方を書いて式が食い違えば T16 が
  error** である —— 同じ制約の式が 2 か所にあって、どちらが正かを読む手がかりが無い状態になる。
  **行の CHECK に写せない式**（別の集約の欄を見る／`now` を含む／集合を見る／日時のリテラルと
  比べる／`formal.type` が `check` でない）は反映されず、その表の制約はいままでどおり名前だけの
  宣言である。**反映されない理由は T16 が warning で毎回報告する** —— 宣言した執行点が実在しない
  （`fixture` の一致の証明が執行点の無い DB の上で緑になる）ことを、黙って通さないためである。
- **MUST**: `enforced_by: kind: db_constraint` の `ref` は、その表が DB に持つ制約の名前で
  あること —— data_table の `checks[]` ／ `indexes[]` ／ `exclusions[]` に加え、宣言に現れない
  **自動命名の外部キー**（`{表}_{列}_fkey`）・**主キー**（`{表}_pkey`）・**entity_spec から導出する
  CHECK**（`{表}_{列}_{max_length|range|enum|pattern}`）も指してよい（どれも `pg_constraint` の
  行である）。**無ければ T16 が warning で「実在しない執行点である」と報告する** —— error では
  ないのは「まだ執行点を持てない」（語彙が足りない／トリガ本文が生成物でない）が実際にある
  状態だからであり、error にすると逃げ道が「嘘の宣言を書く」しか無くなる。**消すために宣言を
  書き足さない**：持てない理由を仕様の側に書き残したうえで警告を残す。
  **実 DB との突合はこの目の代わりにならない** —— `ddl-parity` の閉世界が見るのは
  「data_table が**宣言した**名前が DB に在るか」であり、`handwritten` を宣言する行（名前は宣言に
  ある）の嘘はそこで error になるが、宣言そのものが無い穴は母集合に入らない。
- **MUST**: 既に手書きの migration が作っている執行点を生成に切り替えないなら、その行に
  **`handwritten: {理由}`** を書く（`functions[].handwritten` と同じ語・同じ形。理由が空なら
  T16 が止め、`rule` とは併記できない）。生成に切り替えると**動いている執行点を `drop` → `add`
  で作り直す**ことになり、`ddl_migration` の再発行も連鎖する。切り替えるかどうかは人の判断で
  あり、その判断材料（作り直しが連鎖する範囲と、切り替えで失う動作）は非公開の設計記録にある。
- **MUST**: `invariant` を宣言する CHECK には `comment on constraint` で不変条件 ID を残す
  （[database-guards.md](../../../process/backend/system/standards/conventions/enforcement/database-guards.md)）。
  生成 DDL はこれを自動で出す —— この DDL が作る制約（導出 / `rule` つき）には直に、
  **`invariant` だけを宣言する制約**（条件式の正が invariant_spec にあり、この DDL は作らない）には
  存在を確かめてから付ける。実在は `ddl-parity` が突き合わせる。
- **突合の粒度**（`ddl-parity`）: 列（名前の集合が閉世界 + 型・NOT NULL・既定値・`comment on`）・
  主キー・CHECK（名前の集合が閉世界 + **式の正が仕様にあるものは式も**）・RLS の有効化。
  **`invariant` だけを宣言する CHECK も、`formal` から式が反映されていれば式まで**見る（反映されない行だけが
  実在までであり、反映されない理由は T16 が報告する）。索引・外部キー・排他制約・トリガ・関数は
  `data-table-parity` の持ち場で、二重に見ない。

#### コミット時に評価する不変条件は `checks` ではなく `triggers` に書く

**複数の手順で満たす不変条件（ある欄は作成で決まり、別の欄は遷移で決まる、のように 1 文では満たせないもの）は、
行単位の CHECK ではなくコミット時評価（`deferrable initially deferred` な制約トリガ）で執行する。**
不変条件はコミットされた状態について成り立つものであり、保存点（[ADR-0011](../../../decisions/common/ADR-0011-usecase-layer-two-origins.md) §4 = 1 保存が
1 トランザクション）の内側の途中状態には課さない。判定の目安は「条件が参照する欄が、同じ集約の
**作成入力で決まる欄**と**遷移で変わる状態**にまたがっているか」である（正の置き場は
[domain-spec-writing.md](../../../process/common/specification/standards/domain-spec-writing.md) §invariant_spec）。

- **MUST**: data_table では `checks` ではなく `triggers` + `functions`（`kind: trigger`）に宣言する。
  Postgres の CHECK 制約は `DEFERRABLE` にできないので、実体はトリガ関数になるからである。
- **MUST**: そのトリガに **`deferred: true`** を宣言する。`fires` の散文（`after insert or update
  (constraint trigger, deferrable initially deferred)` のように読んで分かる書き方にする）は宣言のみだが、
  `deferred` は**突合される** —— 誰かが後から普通のトリガに書き換えると、保存点の内側の途中状態が
  弾かれるようになる（`is_fee_bearer: true` の保存点だけが落ちる）。そこを機械が守る。
- **MUST**: トリガ関数は **NEW ではなくいまの行を読み直す**。遅延トリガはコミット時に発火するので、
  NEW は「その文の時点の姿」でしかなく、同じトランザクションの後の手順で条件が満たされたかどうかを
  表さない。読み直して行が無ければ何も課さない（コミットまでに消えた行は不変条件の対象ではない）。
- **MUST**: `raise exception` の本文に**トリガ名（= 制約名）**を載せる。呼び出し側の
  `CONSTRAINT_TO_INVARIANT`（制約名 → 不変条件 ID の写像）は PostgREST が落とす `constraint` フィールドの
  代わりにメッセージ本文から名前を拾うため、名前が本文に出ないと `invariant_violated` に写せない。
- 突合: 関数の実在と種別は data-table-parity の閉世界（`kind: trigger` は返り値が `trigger`）が見る。
  **「遅延であること」も同じ突合が見る**（`deferred` ⇔ `pg_trigger.tgdeferrable` かつ `tginitdeferred`）。
  「コミット時に評価されると本当に通る／通らない」の側は挙動テストが担う（突合は形、挙動は意味）。
- **本文は、条件が自表の列だけを見る、または 2 つの集約の一致なら生成物である**（下記 §条件を課すトリガの本文）。上の 3 つの
  MUST（読み直す・トリガ名を載せる・`deferred` を宣言する）はそのとき生成器が守る。

#### 条件を課すトリガの本文は `formal` から生成する

`checks[]` の行が `invariant` だけを宣言すると式が行の CHECK に反映されるのと同じ線を、**条件の確かめ方**の
側にも引く（束 ㉖。設計の経緯は非公開の開発記録）。トリガの本文は
`check-expression.ts` が返す正準表記の式を `if not (…) then raise exception using …` で包むだけで
あり、文面も `invariant.statement` から出る。

- **MUST**: `kind: trigger` の関数は、**本文が生成物である**か、**`handwritten`（理由つきの手書き）**を
  宣言するかのどちらかである。どちらでもなければ **T17 が error** で、**生成できない理由を報告する** ——
  「実在すると宣言した関数の本文がどこにあるか誰も言えない」状態を残さないためである
  （空の DB に生成物だけを当てて起こした系では、誰も条件を確かめない）。
- **MUST**: `kind: trigger` の `handwritten` は **`{ migration, reason }` のマッピング**で書く
  （`kind: rpc` の理由 1 行と違う唯一の点）。`migration` は**いまの本文を作っている migration の
  ファイル名**であり、**T17 がその実在と、その本文に関数名の字面があることを見る**。
  ファイル名を欄に分けてあるのは、自由文 1 行では名指しの誤りを誰も捕まえられなかったからである
  （束 ㉖ で新しく書いた 23 行のうち 1 行が、関数名を 1 文字も含まない migration を宣言していた）。
  **自由文から名前を拾う形は採らない** —— 拾い方そのものが仕様になってしまう。
- **MUST**: `kind: trigger` は `migration` を宣言しない。トリガ関数の本文の書き出し先は**その表の
  `ddl_migration`** であり、関数ごとのファイルは持たない。
- **生成できるのは `formal.type: check` と、参照の欄の行を読む `state_dependency` である。** 自表の列だけを見る式と、**もう 1 つの集約の列との一致**
  （次項）と、**参照の欄が指す行の列を定数・順序で比べる条件**（次々項）が生成物になる。`cardinality`・集合や単調性を見るもの・`formal` を持たないもの・
  一致の形で 3 つ以上の集約を読む式は反映されない（理由は `check-expression.ts` / `cross-check-plan.ts` / `model/data/ref-check-shape.ts` の文言そのままである）。
- **参照の欄が指す行の列を定数・順序で比べる条件は、行の側の BEFORE の行トリガになる**（fix25s。例: 「部屋が閉じていれば、予約の客は確認済み」=
  `if room.state == closed then guest.status == verified`・「予約の開始は部屋の開館以降」= `booking.starts_at is null or booking.starts_at >= room.opens_at`）。
  式は自表の欄と、`context` の 1 段の**必須の**参照の欄で届く別の集約の欄を、定数か**順序の比較**（`<` `<=` `>` `>=`）で比べる（欄どうしの**等号**は一致の形 =
  両端の制約トリガ）。空にできる自表の欄は、式が `{欄} is null or …` と空のときを言い切る（言わなければ `COALESCE(…, false)` で拒否になる）。本文は参照の欄の行を表名の順に `for share` で読み、`state_dependency` を
  `not (前提) or (帰結)` と読んで `COALESCE(…, false)` で閉じ、成り立たなければ制約名つきで断る。宣言は `deferred` でない `before insert`（と `update`）。
  本文は定義者の権限で読む（RLS・表の権限の効いた接続でも参照の欄の行を読む）。式の最上段の `or` に自表の必須の真偽の欄を定数と比べる項があれば、
  それが成り立つ行は読まずに通す門を先頭に置く（`if new.{欄} <> {値} then return new;`。掴む順の見張りも門として読む）。本文が共有で掴む親の行は、
  定型 RPC の先掴みに宣言の `locks` と同じ口で入る（`lib/model/data/check-trigger-locks.ts`。編集が書き換えうる参照の欄は、本文の代入と同じ字面の
  書いた後の値で id の順に掴む）。2 つの集約の一致の行の側の `for share` も同じ。
  参照の欄を別のトリガが埋めるなら、そのトリガが名前の順で先に発火すること。参照される行の列が後から変わる端（部屋が閉じる・客が確認済みから出る）は
  この本文が見ないので、**相手の端の制約トリガを宣言から導いて生成する**（data_table に宣言は足さない。名前は `{行の側の執行点}_on_{相手の集約}`・
  `after update of {式がその表で読む列}` の `deferrable initially deferred`・定義者の権限。コミット時に、その行を指す自表の行と読む行の全部を結合して
  読み直し、条件を破る自表の行を数え、あれば「{相手の集約}の{読む欄}を変えられません。この決まりに合わない{自表}が N 件あります({言明})」で断る（表示名は entity_spec の `label`・`fields[].label`。件数だけを出し、行の中身や id は出さない。detail は `{トリガ名}: {不変条件 ID}: {件数}` で、実行時の分類がこの形だけを `invariant_violated` の `edge` に運び、画面は生成物 `counterpartRefusalText` で同じ文言を出す。文言の本体は `lib/model/data/ref-check-refusal.ts`）。相手の端どうしの書き込みの歪みは、**錨の行**（読む行のうち表名のバイト順で最初の表の行）で直列化する。
  錨の表の端は自分の更新がその行を掴んだままコミットするので新しく掴まず、ほかの表の端は読む前に「その行を指す自表の行が指す錨の行」を id の順に
  共有で掴む。錨の表の端は相手の端の掴みで待たないので、相手の端どうしの待ち合いは輪にならない。**読む行が 3 つ以上の条件は生成を断る**（錨でない端が 2 本以上になり、錨を発火ごとに書いた順で排他に掴む形が害のない更新どうしでも 40P01 を作った。点検 D25s3-1。T17 が宣言を名指す。条件を 2 行ずつの不変条件に分ける）。
  定型 RPC はこの錨の行を先掴みに入れ（`lib/sql/rpc-anchor-locks.ts`）、手書きの RPC も同じ形の文で先に掴む（掴む順の見張り lock-order-parity の
  軸 3 が、トリガの中の掴みを先掴みの行の集合で覆えないと赤にする）。以前の advisory lock の鍵（親の行ごと → 自表の行ごと）は、発火の順の違いで
  害のない更新どうしでも輪を作った（点検 D25s-1 → D25s2-1）。repeatable read は拒否。行の側の関数が `handwritten` なら相手の端も生成しない。計画は `lib/model/data/ref-check-shape.ts`・本文は `lib/sql/ddl-ref-check-ends.ts`。
  計画が前段にあるのは、data_table の md の「トリガ(全数)」の表・一覧の数・ハンドブックの章の数えが相手の端を宣言されたものと同じ形で数えるため（文書の生成器は SQL の層を読まない）。fix25s）。
  片側しか見ない形は、全部の不変条件（`check` / `state_dependency`）の書き込みの端（自表の挿入・読む列と参照の欄の更新・相手の表の読む列の更新）の
  覆いとして機械で見る（判定は `lib/sql/ddl-ref-check-edges.ts`、生成物 `invariantEdgeGaps`。data-table-parity が受け入れの宣言と両方向に照らす。
  **作成の後に変えない列**は、トリガの宣言 `freezes: [列]`（`fires: after update`。列を絞らない AFTER の行トリガ）で DB が凍らせる —— 本文は生成物で
  （`lib/sql/ddl-freeze-triggers.ts`）、OLD と NEW を `is distinct from` で比べて違えば不変条件の違反の口（`check_violation`・制約名はトリガ名）で断る。
  `update of` は SET に書いた列でしか発火しないので列は絞らない（BEFORE のトリガが NEW を書き換える経路・外部キーの連鎖・列だけの権限・動的 SQL の
  どれも行の最後の姿で断る。生成器の統合試験 `freeze-triggers.integration.test.ts`）。凍らせた列の `update of` の端は覆いに数える。その列を書き換える宣言
  （access_spec の `writes`・`transition_writes`・遷移の `records_*`・`clears`・外部キーの `on_delete: set_null / set_default`・個人列（消去の匿名化が書く）・
  更新で発火する供給と導出（`follow` の先。見ている元の列が全部凍っていれば数えない）・末尾の番号の `insert_at`・作成でない操作の `computes`）があれば T17 が止める
  （数えるものの持ち主は `lib/model/written-after-create.ts` の `rewritesOfFrozen`。点検 fix26 3 回目 D26c-3。読むのは宣言の値だけで、SQL の本文の字面は数えない。本文が書いても凍結が断る）。「変える口が無い」を本文・権限・連鎖の読みで証明する照らしの代わりである（点検 fix26 2 回目）。
  受け入れは端の表の data_table の `parity_accepts`（`check: invariant_edge`。トリガの advisory lock・隔離の門の受け入れも同じ宣言の `check:` で束ねる）に置き、
  **理由と、理由を示す試験の ID** を持つ。どちらかが無い行は赤。突合は生成物 `dataTableParityAccepts` を読むだけで、受け入れを文字列で持たない
  （持つと突合の本文が製品の名前を名指し、題材の通し実行で突合ごと外れた。点検 26 回目 A26-1））。条件のトリガの `fires` の `update of` は、**本文が読む自表の列の全部**
  （それを書き換える別トリガの発火列を含む）を並べる。落とすと T17 が生成しない理由として名指す（参照の欄の付け替えの端は覆いの検査と受け入れの表が見る）。
  判定は `lib/model/data/ref-check-shape.ts`・本文は `lib/sql/ddl-ref-check-body.ts`（`ddl-check-triggers.ts` は呼ぶだけ）。手書きの本文が宣言の前提を落としていた形（題材の製品の予約の表）を、宣言から
  本文を作ることで書けなくする（照らす目は data-table-parity の `diffConditions`）。
- **別の集約の列との一致は、両端の表に 1 本ずつのコミット時評価の制約トリガになる**（例: 店舗の責任者は店舗と同じ会社の
  従業員 = `store.company_id == staff_member.company_id`）。この条件は **2 つの表のどちらからも破れる**（責任者の付け替え・
  責任者の会社の変更）ので、片側だけでは執行点にならない。
  - **宣言**: 不変条件が住む集約の表（行の側）と、式が読むもう 1 つの集約の表（相手の側）の**両方**に、同じ `invariant` を
    宣言する `deferred: true` の `after` のトリガと `kind: trigger` の関数を置く。行の側の `fires` は
    `after insert or update of {式が読む列}, {参照の欄}`、相手の側は `after update of {式が読む列}`。どちらかが欠ければ
    **T17 が error**（欠けた端を名指す）。`enforced_by` には両方の関数名を並べる。
  - **読み方（最も厳しい側に倒す）**: 読む集約は 2 つだけ・`context` の **1 段の参照の欄**で届く・その参照の欄は
    **required**（空にできる参照は「空なら適用外」か「空なら拒否」かが読めないので生成しない）。比較する列が空（NULL）で
    相手の行が在れば**拒否する**（式全体を `COALESCE(…, false)` で閉じる）。生成しない形は T17 が理由つきの error で止める。
  - **`fires` の列は漏らさない**: 式が読む列に加えて、その列を別のトリガ（`supplies`）が書き換えるなら**そのトリガの発火列**も並べる
    （`update of` は SET の列でしか発火せず、BEFORE トリガの書き換えは数えないため）。足りなければ生成しない。
  - **本文**: コミット時に、いまの行を**結合して読み直す**（`security definer` + `search_path` の固定）。行の側は先に
    相手の行を **`for share`** で押さえる。相手の行を書き換える取引と、その行を指す行を作る取引は互いの未コミットを
    見られないので、押さえなければ両方の検査が通って食い違う（書き込みの歪み）。押さえれば後からコミットする側が
    待ち合わせて最新の姿を見て拒否する。**両側の本文とも、隔離の水準が read committed でなければ(repeatable read・serializable)検査の前に拒否する**
    （`invalid_transaction_state`。トリガ名も不変条件 ID も載せない = 写像が不変条件の違反と誤読しない。未ログインの作成の
    天井と同じ実装）。古い snapshot では、参照される側の検査が先に確定した行を見落とし、`for share` は行バージョンを
    変えないので直列化失敗（40001）にもならないため。支えるのは read committed（文ごとに新しい snapshot + 行の側の
    `for share`）だけである。serializable も断る —— SSI が衝突を検出するのは関わる取引の全部が serializable のときだけで、
    serializable の蔵書の公開と read committed の貸出の解放の交錯は両方コミットして不変条件を破った（点検 D25s-3）。隔離の水準を
    揃える運用に任せず、拒否の本体 `lib/sql/ddl-isolation-guard.ts` が天井・末尾の番号・一致・相手の端の 4 つの家族に同じ拒否を置く。
  - 相手の列で絞る索引（行の側の参照の欄）は宣言しない限り無い。相手の側のトリガは参照の欄で行を引くので、
    相手の列が頻繁に動く表では参照の欄の索引を `indexes[]` に宣言する。
- **`fires` が `delete` を含む宣言では本文を出さない。** BEFORE DELETE の行トリガでは `NEW` が空で
  あり、行を返す形（`return new`）は**その削除の取り消し**になる。`tg_op` で分岐する形も書けるが、
  「削除を条件で弾く」実例が 1 つも無いので出さない（要る日が来たら、その実例と一緒に買う）。
- **`deferred: true` の `fires` は `after` でなければならない。** Postgres は BEFORE の制約トリガを
  拒否する。どちらも「生成できない理由」として宣言するので、T17 が `handwritten` を要求する。
- **`raise exception` の文面は `using message` で渡す。** 第 1 引数に置くと plpgsql の**書式文字列**
  になり、`invariant.statement`（自由な日本語）に `%` が 1 つ入るだけで発火時に落ちる。
- **`deferred: true` なら読み直す形が出る** ——
  `if exists (select 1 from {表} t where t.id = new.id and not (…)) then raise …; end if; return null;` で
  あり、`security definer` が付く（RLS が効いた接続から実行されると読み直しが 0 行になり、条件を
  確かめずに素通りするため）。`deferred: false` なら `new` の欄を見て `return new` で終わる。
- 突合: **本文が生成物のトリガ関数は本文まで**突き合わせる（生成した `prosrc` の md5 ⇔ 実 DB の
  `md5(prosrc)`。data-table-parity）。`handwritten` を宣言する関数は期待が md5 を持たないので実在までである
  （`checks[]` の `handwritten` と同じ線引き）。

#### 「入力に無いがサーバーが決める値」の機構は data_table が宣言する

entity_spec の欄が `supplied_by: db` を宣言したら（[domain-spec-writing.md](../../../process/common/specification/standards/domain-spec-writing.md) §entity_spec）、
**その値をどう決めるかの機構は data_table が宣言する**。V17 が両側を突き合わせるので、片方だけの宣言は通らない。

- **MUST**: 列の既定値で決まるなら `defaults: { {列名}: "{SQL の式}" }` を書く。**式の表記は `pg_get_expr` の
  出力に合わせる**（突合は空白を詰めた文字列一致であり、`args` に pg_catalog の型名を書くのと同じ流儀で
  「DB 側の正準表記を仕様に写す」）。実例: `invitations.defaults.code`。
- **MUST**: 祖先の列を写すトリガは、写し元の約束を保つ（T15）。写し元の `fields_hidden` で隠した相手が写し先の列を読める形・写し元が `personal: true` で
  写し先がそうでない形は error で、受け入れはトリガの `copy_accept: [{ column, on: hidden | personal, role, reader, reason }]`（`snapshot` の写像の行の `copy_accept` と同じ判定。
  domain-spec-writing.md §effects[].snapshot）。
- **MUST**: トリガが埋めるなら、そのトリガの宣言に `supplies: [{列名}, …]` を書く。**MUST**: 逆算・採番に使う
  定数（何日前か、のような業務の慣習）は**仕様に載せる** —— 値が実装の中にしか無いと、その規則は仕様のどこからも
  読めない。載せる口は 2 つある。**同じ行の日時列 ± 定数の幅**で決まるなら下の `derives`（本文も生成物になり、
  定数の正が 1 か所になる）。それ以外の定数は同じトリガの `params: { {名前}: "{値}" }` に書く —— 値は文字列で、
  突合はしない（SQL の式と比べる汎用の手が無い）。**宣言であることに意味がある**。
- **MUST**: **同じ行の日時列 ± 定数の幅**で決まる列（返却期限の 3 日前・取り置き開始の前日のような、業務の慣習から決まる
  既定の時刻）は、そのトリガの宣言に `derives` を書く。**書くと本文が生成物になる**（`handwritten` は併記できない）:

  ```yaml
  triggers:
    - name: fill_slot_times
      function: fill_slot_times
      fires: before insert or update of due_at      # 表名は書かない（生成が on {表} を付ける）
      supplies: [remind_at, settle_at]              # derives の列と同じ集合
      derives:
        remind_at: { from: starts_at, offset: "-1 day", mode: initial }
        settle_at: { from: due_at, offset: "3 days", mode: follow }
  ```

  - `from` は**自表の datetime の欄**（別の集約の列は書けない）。`offset` は `{±n} {minute|hour|day}` の閉じた語
    （数は整数・符号の省略は加算・単位は複数形でもよい。生成は `interval '{n} {unit(s)}'` に正規化する）。
  - **`mode` は 2 つの別の約束で、書く人に選ばせる**（既定を置かない）。`initial` は**初期値** —— 挿入時に空の
    ときだけ入れる（呼び手が渡した値は尊重する。`if new.{列} is null then …`）。`follow` は**導出値** ——
    `fires` のたびに無条件に引き直す（元の列と食い違わない）。後から人が上書きする将来があるのは `initial` の
    列だけである（`follow` は次の発火で戻る）。
  - 生成するのは `supplies` の全部が `derives` に載るトリガだけで、**1 つでも通らなければ本文を出さない**。
    本文は `security invoker`（`new` だけを見る）で、**生成した本文の md5 は実 DB と突合される**（data-table-parity）。
  - **T15 が `derives` の宣言を見る**（新しい検査 ID は無い）: `from` が自表の datetime の欄で自分自身でない /
    `offset` が閉じた語 / `mode` が値域 / 導出する列が `supplied_by: db` で datetime 型 / 同じ列を 2 つのトリガが導出しない /
    `supplies` と `derives` の列が一致 / **`follow` の `fires` が `update of {from}`（または列を名指さない
    `update`）を含む**（含まなければ宣言の嘘）/ `fires` が before で insert を含み表名を書かない / 関数が
    `handwritten` でない。すべて error である。判断の記録は非公開の開発記録にある。
    実例: `items.triggers.fill_item_reminders`（`initial`）/ `fill_item_confirm_at`（`follow`）。
- **MUST**: **親の下の末尾に足す並び順**（蔵書の下の予約の予約順・貸出の下の付箋の並び順のように、作るときは最後に並び、
  後から並べ替える番号）は、画面が読み取りから「次の番号」を導いて送らない。entity_spec でその欄を `supplied_by: db` にし、
  番号を振るトリガの宣言に `derives` の**末尾の番号の形**を書く（本文は生成物になる。点検 24 回目 B24-1）:

  ```yaml
  triggers:
    - name: number_slot_position                   # 範囲の列を別のトリガが埋めるなら、その名前より後に並ぶ名前にする
      function: number_slot_position
      fires: before insert
      supplies: [position]
      derives:
        position: { append_within: room_id, mode: initial }   # 利用者が位置を選ぶ作成なら mode: insert_at
      locks: {rooms: update}                       # 範囲の列が指す親を排他で掴む(必須)
  ```

  - **方式は 2 つ**（fix25s）。`initial` は空のときだけ末尾に振り、値を入れてきた行はそのまま入れる（データ移行の明示の値）。
    `insert_at` は入れてきた値を**位置**と読む —— 空か末尾 + 1 を越えるなら末尾、それ以外は同じ親のその位置以降の行を 1 つずつ
    後ろにずらしてからその位置に入れる（利用者が予約順を選ぶ作成。選んだ番号が既にあっても一意の索引の拒否に化けない）。
    ずらす順は**後ろの番号から 1 行ずつ**（1 文の `+ 1` は（範囲, 番号）の一意の索引に途中で当たり、一時の負の値は範囲の CHECK の
    下端に当たる）で、その前に同じ親の行を id の昇順で排他に掴む（同じ表の複数の行を掴む順の約束）。ずらした後の最後は
    「いまの最大 + 1」なので、上端の断り（下の `append_full`）は何も動かす前に置く。範囲の下端より小さい位置は丸めない（作成の入力の
    検査が分かる語で断る線で、直に入れる経路は範囲の CHECK が止める）。`insert_at` の列だけは `supplied_by: db` でも作成
    （`{集約}.create`）の `input` に**任意で**現れてよく、作成 RPC がその列を受けてよい（V17 (a)(c) の例外。持ち主は
    `model/data/types.ts` の `insertAtColumnsOf`。作成の入力スキーマは行のスキーマの範囲を `.partial()` で借りる。`create-input-pick.ts`）。
    **直に行を入れる経路（シード・データ移行）でも位置と読む**ので、空の親に大きい番号を入れると末尾に丸まる（上端の番号の親を
    作るなら、入れてから書き換える）。

  - 本文は、空のときだけ親の行を `for update` で掴んでから `max({列}) + 1`（同じ親の行）を入れる。同じ親への同時の作成は
    親の行で 1 本ずつになり、後の 1 本はコミット済みの番号を数えるので、番号は重ならず飛ばない。読みが古い画面の
    送った番号が一意の索引の拒否に化ける形（書けたか分からない失敗の後・読み直しが届く前・時間切れの間）は、
    番号を宣言の側に移すことで経路を問わず閉じる。本文は自表の行を数えるので `security definer` である。
  - **振った番号が列の範囲の上端（entity_spec の `max`）を越えたら、本文は閉じた語 `append_full` で断る**（`UC412`・`usecase_guard:`・
    detail = `append_full`。点検 25 回目 B25-1）。並べ替えの口で最後の番号を上端にした親（または件数が上端に届いた親）への作成は、
    範囲の CHECK（23514）の想定外の失敗ではなく業務の拒否になり、画面は仕組みの文言の表（`@kaninabe/runtime/result` の
    `FRAMEWORK_REFUSAL_TEXT`）から「これ以上追加できません。並び順を見直して…」を出す。語は仕組みが決め、製品の宣言には書かない。
  - **本文は数える前に repeatable read を断る**（同じ「数える」家族の共有の拒否 `ddl-isolation-guard.ts` の `isolationGuardLines`。
    SQLSTATE `invalid_transaction_state`、文面に不変条件 ID もトリガ名も載せない。点検 25 回目 A25-2）。repeatable read の txn は親を
    掴んでも古い snapshot で max を数え、先にコミットされた番号と同じ番号を振る。値を入れてきた行は数えないので拒まない。
  - 書き込む定型 RPC は `locks` の親を表名の順の先掴みに入れる（範囲の列が作成の入れない**写しの列**なら、写し元の行を
    作成の値で選ぶ副問い合わせで親を引く。`rpc-closure-locks.ts`）。同じ鍵の押し直しは 1 回目の行と番号をそのまま返す
    （番号は入力ではないので、送り直しの入力の比べにも入らない）。
  - 並べ替えは作った後の書き換えで、access_spec の `writes` が宣言する。`writes` に載る `supplied_by: db` の欄は、
    編集（`{集約}.update`）の `input` に現れてよい（V17 (a) の例外）。
  - **T15 が見る**（新しい検査 ID は無い）: `mode` が `initial` か `insert_at` / 導出する列が `supplied_by: db` の integer /
    `append_within` が親を直の外部キーで指す自表の欄 / `locks` にその親を `update` で宣言 / 範囲の列を埋める別のトリガが
    名前の順で先に発火する / 列の範囲の上端 `max` がある（無ければ上端で断る語を出せない。access_spec の `writes` に載る列は
    件数より早く上端に届くことも理由に名指す）・下端 `min` が 1 以下（点検 25 回目 B25-1）・`indexes` に（範囲, 番号）の部分でない
    一意の索引がある（並べ替えの口と隔離の水準の外の経路でも番号が重ならない最後の線。点検 25 回目 A25-2）。判定は `lib/sql/derive-append-problems.ts`、本文は `lib/sql/ddl-derive-triggers.ts`。
    実例: 題材の製品の予約の表（範囲の親を指す列を別の写しのトリガが埋める形）と付箋の表の 2 本。
- **MUST**: その値が**祖先の列の写し**なら、そのトリガが宣言する不変条件の `formal` に
  `{自集約}.{列} == {別の集約}.{列}` を書く。書くと**トリガ関数の本文が生成物になる** ——
  写し元までの道は参照列の連鎖（1 段とは限らない）で解け、値の決め方が宣言から完全に読める
  唯一の形だからである。判定は**`world` の組み立てと同じ 1 本**（`lib/world/copied-columns.ts`）で
  あり、「`world` は値を置かないのにトリガは埋めない」列が作れないことがこの共有の目的である。
  生成するのは `supplies` の列が**全部**写しであるトリガだけで、1 つでも導出できない列が
  混じったら出さない（部分的な本文は手書きの本文と衝突する）。実例:
  `sections.sync_section_company`（`INV-SECTION-002`）。
- **MUST**: 本文が生成されるトリガの `fires` に**表名を書かない**（生成が `on {表}` を付ける）。
- **向きを決めるのは字面の左右ではない。** 等値はどちらの向きに書いても同じに読まれ、
  **その列を `supplies` に載せた data_table の `entity` 側が写し先**になる（写し元は反対側）。
  だから「どちらが `supplied_by: db` か」は判定に使っていない —— 結果は一致する（T9 が
  `supplies` の列に `supplied_by: db` を宣言させる）が、それは別の検査の効き目である。
- **写しは親の更新に追随しない。** 生成されるのは
  `before insert or update of {自表の参照列}` であり、**写し元の行の列が変わっても子は動かない**
  （`store.company_id` を書き換えると `sections.company_id` は古いまま静かにずれる）。
  等値を「執行点」と呼んでいるが、執行されているのは**片側**である。いま追随が要る形は
  無い（テナントの鍵は作ってから変えない）ので、必要になったらそのとき
  `after update` 側の宣言を足すかどうかを決める。
- **SHOULD**: それ以外（子集約の畳み込み・同じ行の日時列 ± 定数の幅に収まらない逆算）は本文が手書きの
  ままでよい —— 列の既定値は同じ行の他の列を読めず、畳み込みは DSL の外である。ただしその列は
  **生成物だけでは誰も埋まらない**ので、`npm run generate` した SQL だけで空の DB から
  立ち上げることはできない。**T15** がその 3 つを見る（機構が導けない列は warning・
  生成されるのに `kind: trigger` の宣言が無い / `fires` が表名を書いているのは error）。
  判断の記録は非公開の開発記録にある。
- **MUST**: 作成 RPC（`insert_{entity}`）の `params` から `p_{欄}` を外す（渡す口を閉じる。V17 の (c)）。
  引数が残っているかぎり「DB が決める」は呼び出し側の善意でしか守られない。`p_values` のような
  **jsonb の袋**で受けている場合は `params` からは判定できないので、RPC の本文からも列を落とす。

#### 排他制約は `indexes` に書けない（`exclusions` が別の宣言である理由）

**MUST**: 期間の重なりを禁じる制約は `exclusions` に書く。`indexes` に `unique: true` として
書いてはならない —— 排他制約は一意索引ではなく（`pg_index.indisunique` は false、
`pg_constraint.contype` は `'x'`）、宣言をそこに置くと「開始も終了も完全に一致する 2 行だけを
止める制約」という**別の意味**になる。実測（束 ⑱ rooms）ではこの形が verify 緑のまま通っていた。

- **MUST**: 端の扱いは**半開区間 `[開始, 終了)`** に固定する（`tstzrange(開始, 終了, '[)')`）。
  「前の予約の終了時刻 = 次の予約の開始時刻」は重なりにならない。宣言では選べない（選択肢を
  持たせると `statement` の日本語と執行が静かにずれる）。
- **MUST**: 由来の不変条件（`invariant`）を必ず書く。排他制約は業務の禁止そのものであり、
  何を守っているかが仕様の側に無いと意味が読めない（T5 が両方向に見る）。
- **MUST**: migration は `btree_gist` 拡張を要求する（`keys` の等値比較を gist 索引に載せるため。
  `create extension if not exists btree_gist with schema extensions;` を先に置く。**スキーマを省かない** ——
  省くと migration の役の search_path で `public` に入り、拡張の関数が anon / authenticated から実行できる形で
  閉世界の外に置かれる。既定の演算子クラスは型で引かれるので `extensions` に置いても排他制約は解ける）。
- **突合の粒度**（どこまでを機械が見るか。束 ⑲-2b-b で決めた線）:
  - **仕様 ⇔ 仕様**（T5）: `keys` / `range` は**値まで一致**を要求し、`where` は**同じ条件であること**を要求する。不変条件の側はガード DSL（`state not in [cancelled]`）、
    `exclusions` の側は SQL 断片（`state <> 'cancelled'`）で語彙が違うので、どちらも閉じた原子の連言に読み替えて比べる（T23 と同じ `@kaninabe/runtime/sql/sql-condition`。読めない形は error）。
  - **仕様 ⇔ 実 DB**（data-table-parity）: 名前の集合を双方向で閉じたうえ、一致した名前は
    `pg_get_constraintdef` の定義文と**鍵（`… with =`）・期間（`( 開始, 終了, '[)' ) with &&`）・
    `where` の条件**まで突き合わせる（索引の `where` も `pg_get_expr` の印字を同じ原子に読んで比べる。読めない形は赤）。制約名を維持したまま
    `with =` の列を入れ替える／端の扱いを半開でなくする／条件を変える、を止めるためである。
- 生成形（規約としての骨格）:

```sql
alter table bookings
  add constraint bookings_room_slot_exclude
  exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (state <> 'cancelled');
```

#### 一意の約束と索引は一致させる（T23）

**MUST**: `formal.type: uniqueness` の不変条件は、`enforced_by` の `kind: db_constraint` で `indexes` の索引を名指し、索引の行は `invariant` で不変条件を指し返す。
索引は `unique: true`、`on` の列の集合は `keys` と同じ、`where` は `formal.where` と同じ条件である。DB で効くのは索引だけで、DDL は索引の宣言からそのまま作られるので、
`keys` だけが正しい形（索引が鍵を落とす・`unique` を書き忘れる・条件が違う）は不変条件を守らず、テナントの範囲も切れる（他社の値の有無が拒否で分かる）。

`where` はガード式と SQL 断片で語彙が違うので、どちらも「自分の列の原子」の `and` に読み替えて比べる。読める原子は `= 値`・`<> 値`・`in`・`not in`（`= any (array[…])`・`<> all (array[…])` の印字も同じ）・`is null`・`is not null` で、
読めない形は同じ条件と言えないので error である。`formal.where` が無く、索引が鍵の列の `is not null` だけを持つ形は同じ意味（NULL は一意の索引で衝突しない）なので通す。

**MUST**: `invariant` を持たない `unique: true` の索引も、`on` にテナントの範囲が要る（V26。規則は不変条件の `keys` と同じ）。全体で一意が正しい鍵は、索引の行の `global_key: { keys: [鍵の列], reason: 理由 }` で受け入れる。

#### `indexes` は導出する — 手で考えない

**`indexes` の必要十分な集合は query_spec から機械的に導ける。** query_spec の `filters`（等値・`in`）・
`via` のスコープ条件（binding が自表内の列に解決するものだけ）・`sort` から「等値列 → 並び順列」の索引候補を
1 本作り、同一テーブルで前方一致する候補は長い方に畳む（導出規則の正: `legacy/spec-tools/lib/relations/
index-requirements/index-derivation.ts`。query_spec と関数の `lookup` の両方から決まるので、関係の層に置く）。**MUST**: `paging: none` の query_spec は `bounded_by` を持つ（query-spec-writing.md
Q8）。この宣言は索引の要否には関わらないが、「絞り込みが足りず無界に育つ」ことと「索引が足りず遅い」
ことを別の軸として両方見えるようにする。

- **MUST**: 導出した期待索引は `indexes:` に**全部**宣言する(宣言漏れは T2 がエラーにする)。
- 主キー・一意制約・（部分述語を持たない）一意な先頭一致がある候補は、その分だけ既に一意なので
  除外する（`branches_name_unique` があれば `branch_list` の並び順 `name, id` は `id` を足さなくてよい）。
- **すべきこと:** `indexes:` に、導出規則からは出てこない索引（不変条件の執行点・ジョブの処理順
  など）を残す場合は、コメントで用途を 1 行書く。T2 は「なぜ要るか説明できない」索引を warning
  で指す（削除ではなく人の判断を促す）。
- **関数の本文が引く索引は `functions[].lookup` に書く。** 索引を要求するのは query_spec（app の読み取り）だけ
  ではない —— 書き込みの執行点のトリガ関数（「同じ送信元の直近の件数」を数える）や、ジョブを取り出す関数
  （「実行時刻の来た待ちの行」）は、本文が自表を絞り込み・並べる。その列を `lookup: [sender_email, created_at]`
  のように並べて宣言する（等値で絞る列 → 範囲・並びの列の順。トリガも関数の 1 種なので、トリガが指す関数の
  宣言に書く）。T2 は `lookup` を query_spec の候補と**同じ導出**（前方一致の畳み込み・主キー / 一意 / FK 索引に
  よる除外）に通し、`indexes:` に無ければ error にする。**宣言が実在することは data-table-parity が見る** ——
  実 DB の関数の本文（`pg_proc.prosrc`）に、宣言した列が全部現れること（宣言だけ書いて本文が引かない、を
  止める。免除ではなく referent のある宣言）。**app のコードが引く索引は `lookup` ではなく query_spec に書く**
  （読み取りの正は query_spec）。引く者が query_spec にも `lookup` にもいない索引は、T2 が warning で指す —— 引く者
  を宣言するか、消す（適用済みなら新しい連番で `drop index`）。
- 生成物 `app/src/domain/generated/index-expectations.ts`（テーブル → 期待索引。要求元の query 名と関数名つき）とハンドブックの
  「誰に何が見えるか」の章の「索引」節が同じ導出関数から作られる。
- 実 DB との整合は `npm run explain`（`app/`。製品の運用手順書の
  「索引の穴を見る」節）で確かめる — seqscan 警告 0 件が
  開発用リポジトリの公開準備（Phase F）の関門の 1 つ。

#### 引数名（params）— 名前は突合された単一の正

**MUST**: `kind: rpc` の関数は `params`（引数名の並び）を `args` と同じ順・同じ長さで宣言する。
`kind: trigger` / `helper` には書けない（呼び出し側が名前で渡す場面が無い）。

```yaml
functions:
  - name: insert_loan
    args: [uuid, uuid, text, uuid, uuid, text, text, uuid]
    params: [p_id, p_item_id, p_expected_item_state, p_owner_id, p_volume_id, p_kind, p_note, p_actor_id]
    kind: rpc
    shape: create
```

**なぜ名前まで仕様に載せるのか（束 ⑯b の訂正）。** ⑯b は「引数名は migration の SQL にしかなく、
持たせると二重管理」として型だけを正にした。しかし保存点の**複合 RPC を生成する**（ADR-0011 §4）には
各引数の**意味**が要り、その唯一の手がかりが名前である。名前を仕様に載せたうえで実 DB の
`pg_proc.proargnames` と**双方向に突き合わせる**（`rpc-signatures-parity`）ことで、二重管理ではなく
**突合された単一の正**になる。

**MUST**: `p_{欄}`（1 欄ずつ受ける引数）の `args` の型は、**入れる先の列の型と一致する**
（`columnType`。`datetime` は `timestamptz`、`integer` は `integer`、`enum` / `state` は `text`）。
**T14** が両側を突き合わせる。ずれてよい集合は**空**である —— 境界が ISO 8601 の字面であることは
アプリの入口（zod・フォーム）の規約であって、DB の関数の引数型の規約ではない。

ずれると症状が 2 つに分かれ、しかもどちらも「宣言が正しい」と言えないまま出る:

| どこ | 症状 |
|---|---|
| 本文 | `insert into … select …, p_starts_at, …` が `42804 column "starts_at" is of type timestamp with time zone but expression is of type text` で落ちる |
| 呼ぶ側 | 名前つき引数で呼ぶ経路は**列の型**で値を作るので、`42883 function …(p_starts_at => timestamp with time zone) does not exist`（署名が見つからない）になる |

実測は `fixture` `rooms` の `insert_booking` である（束 ③-2 の 1 往復）。**題材の製品の個別引数 RPC は
日時・数値の列を 1 つも受けないので、題材の製品だけを見ていると一生見えない形の穴だった。**
生成器はキャストを出せるが（`lib/sql/sql-types.ts` の `columnExpression` が値の出どころ 3 通りに
共通の 1 本である）、**個別引数のずれをキャストで黙らせない** —— 黙らせると本文だけが直り、
呼ぶ側の 42883 は残る。

- T1 が見るのは形だけである（`args` と同じ長さ・`^p_[a-z_]+$`・重複なし）。
- 名前の**意味**の値域は
  [usecase-spec-writing.md §引数名 → 供給元](../../../process/frontend/specification/standards/usecase-spec-writing.md)
  にあり、その規約で解決できない名前は Y8 がエラーにする（保存点が実際に呼ぶ RPC に限る）。
- 生成物 `app/src/domain/generated/rpc-signatures.ts` が `args` と `params` の写しを持つ。

#### 生成される複合 RPC は data_table に手で宣言しない

usecase_spec の保存点から生成される複合 RPC（`api.usecase_{name}_{save}`）は、DB には実在するが
data_table には**書かない**。書くと生成物と手書きの二重の正になるためである。関数の閉世界
（data-table-parity / api-parity）には、生成器が同じ導出から足す（帰属表 = 保存点の最初の手順の表、
`shape: composite`）。突合は専用の統合テスト `usecase-rpc-parity.test.ts` が担う。

#### 書き込み RPC の形（shape）と本文の突合

**MUST**: `kind: rpc` の関数は `shape` を宣言する。値域は `transition` / `create` / `update` / `delete` / `composite`。
前 4 つは [server-actions.md の「5 形の定型」](../../../process/backend/system/standards/conventions/server-actions.md) の SQL 版であり、
**本文が宣言から決まる**。`composite` は定型に乗らない関数（複数集約をまたぐ・独自の手順を持つ）で、
本文の意味は突き合わせないが、**印を付けること自体が宣言**である（「定型のつもりで書いたのに定型でない」ものが黙って増えるのを防ぐ。免除台帳を別に作らないのは、帰属の宣言と同じ場所に書けるため）。

**MUST**: `also_writes` は書き込み先の表ごとに**書き込みの種類**（`insert` / `update` / `delete` / `scrub`）を宣言する（`also_writes: { loans: [update, delete], domain_events: [insert] }`）。
表の名前だけの並びや種類の無い表は T0 が名指しで error にする（黙った既定を作らない）。`scrub` は個人列を置き換えて消す書き込み（本文では `update`）で、personal 列を持つ表にだけ宣言できる（T20）。
種類は本文（migration）が実際に行う書き込みを書き、実 DB の `rpc-parity` が表ごとに突き合わせる。操作の属性（destructive / touches_personal）は、効果が `realized_by` で名指しした RPC のこの宣言から導く:
行を消す（`delete`。ただし entity_spec が `mirror: true` で写しと宣言する表は除く。写しの宣言は `effects[].snapshot.to` と双方向で一致すること = V12、写しの表は system の写像以外で書かれないこと = V25）か `scrub`（写しの表でも数える）があれば destructive、personal 列を持つ表への書き込みがあれば touches_personal。

**MUST**: `shape: composite` の関数は `also_writes` のキーそのものを書く（他の表に書かないなら `also_writes: {}`）。省略を「他の表に書かない」と読むと、手書きの本文の書き込みが宣言から消えるため（T0）。

**MUST**: **帰属表（自表）への書き込みの種類**は `self_writes: [insert | update | delete | scrub]` に書く。`shape: composite` では必須（書かないなら `[]`）。
定型 4 形は形が決める（create = insert / update = update / delete = delete / transition = update）ので、本文が生成物なら書けず、`handwritten` の本文だけが書ける（T0）。
`also_writes` に帰属表を書くのは誤り（T20）。本文との一致は `rpc-parity` が自表も含めて見る（以前は自表を除外していたので、全消しのような自表への削除が見えなかった）。

**MUST**: **外部キーの連鎖で暗黙に起きる書き込み**も `also_writes`（自表なら `self_writes`）に載せる。`delete` を宣言した表から `foreign_keys[].on_delete` を辿り、
`cascade` は参照する側の表に `delete`（推移的）、`set_null` / `set_default` は `update` を要求する（T21。道筋つきで名指す）。`rpc-parity` は本文の削除から**実 DB の**外部キー（`pg_constraint.confdeltype`）で同じ閉包を求めて宣言と突き合わせる
（宣言の外部キーと実 DB の一致は `data-table-parity`）。

**MUST**: 1 本の RPC を**複数のイベントが通る**（集約の遷移の RPC・複数のイベントが `realized_by` で名指す複合 RPC）とき、破壊的な書き込み（写しでない表の `delete`・`scrub`）を持つなら
`event_writes: { {イベント ID}: { {表}: [種類…] } }` で**全部のイベントについて**そのイベントの書き込み（`also_writes` の部分集合。書かないなら `{}`）を宣言する（T22）。
操作の属性は「効果が名指しした RPC」と「遷移そのものが通る RPC」の両方からイベントのこの宣言を読む —— 不変条件の後始末のように効果ではない削除が、効果の名指しを外した瞬間に黙って落ちないため。自表の破壊的な書き込みはイベントごとに言えないので、複数のイベントが通る RPC では持てない（RPC を分ける）。

**MUST**: 本文が**他の関数を呼ぶ**なら `calls: [関数名…]`（呼ばれた側の書き込みは呼んだ側の操作の属性に合流する。呼び先の実在は T20）、**動的 SQL**（`execute`）を使うなら `dynamic_sql: {理由}` を書く。
本文から読めないものは宣言が正になり、宣言の無い呼び出し・`execute` は `rpc-parity` が「読めない」で赤にする。`rpc-parity` の本文の読み方は大文字小文字を区別せず・コメントを落とし・`update only` / `merge` / `truncate` / CTE の中の書き込みも拾う。
**`update` の set 句が個人列を書き換える表は `scrub` の宣言を要求する**（`scrub` と宣言したのに個人列を書く句が無ければそれも赤。帰属表は `self_writes` を宣言した関数だけ）。
`realized_by` で名指された RPC の本文には、その効果 ID のリテラル（`'revoke_patron_sessions'` のような目印）が要る（名指しが本当にその効果を実現しているかの接地）。

**MUST（導出の側）**: 操作の属性の連鎖を**読めない材料**（ジョブカタログ・テーブル仕様が無い／効果がカタログに無い／名指しの RPC が無い／composite の `self_writes` が無い／呼び先が無い）は「未検査」として根拠に名指しし、**破壊的とみなす**（確認が要る側に倒す）。
遷移の `clears` が personal 列を空にするなら、その遷移は destructive / touches_personal である（空で上書きされた個人列の値は消える）。

**MUST**: `shape: composite` の関数は `returns`（戻り値の形。`rows` = 帰属表の行の列 / `scalar` = 消した件数のような単一の値）を宣言する。
省略を `rows` とみなして署名の表（`rpc-signatures`）に黙って書くと、行を返さない関数が行を返すことになるので、
書き忘れはパーサーが error にする。定型 4 形は常に行の列を返すので書けない。実 DB の戻り値の型との一致は
`db-adapter-contract` が見る。生成する複合 RPC（保存点・受信）は文書（jsonb）を返し、これは仕様に書かず生成器が決める。

**MUST**: 定型 5 形（`composite` 以外）は、本文の出どころを `migration`（生成物）か
`handwritten`（理由つきの手書き）の**どちらか一方**で宣言する（T6）。

- `migration: {14 桁}_rpc_{関数名}.sql` — 本文は `npm run generate` がそのファイルに丸ごと書き出す。
  許可列・楽観的並行制御・監査ログ・副作用の積み方・空を渡された列の扱いは、すべて宣言から決まる。
- `handwritten: {理由}` — 形は定型だが、**本文に仕様から導けない手順が混じっている**もの
  （DSL 外と宣言された不変条件の連鎖など）。`composite` に降格させないのは、降格すると
  許可列・楽観的並行制御の突合まで一緒に失われるからで、免除の範囲を本文だけに閉じる。

**MUST**: `shape: composite` の関数が `access_spec` の `writes` の規則を守る執行点であるときは、
`enforces` に**その規則と見張りテストの id を宣言する**（[ADR-0014](../../../decisions/common/ADR-0014-composite-enforces.md)）。
定型 `update` は本文が `writes` から生成されるので執行点が仕様から出るが、複数行を一括で動かすなど定型に乗らない
`composite` の本文は手書きで、どの規則を守る関数かが宣言のどこにも無かった。A18（`writes` の執行点）はこの宣言で
名指しされた規則を執行点として数える。

```yaml
    shape: composite
    enforces:
      - { writes: hold, by: librarian, test_case: TC-TABLE-HOLDS-010 }
```

- `writes` は access_spec のエンティティ、`by` はその `writes` の規則の `by`（同じ `by` の規則が複数あればそのすべてを名指す）。
  **`when` / `fields` は書かない**（規則の中身の正は access_spec。写すと 2 重の正になるので T0 が error にする）。
- `test_case` は**必須**で、**同じ表の** `test_cases` の id である（見張りテストを宣言していない手写しは宣言ではない）。
- **書けるのは `kind: rpc` + `shape: composite` の関数だけ**。それ以外に書くと T18 が error にする（未知キーの黙殺にしない）。
- **同じ規則を 2 つの宣言が名指ししない**（執行点は 1 つ。T18 が error）。
- **`composite` の本文が規則を実際に守っているかは突き合わせない**（上記のとおり本文の意味は突合しない）。それを担うのが見張りテストである。

#### 作成の再送と実行者の縛り(`resend` / `delegate`)

作成の RPC は呼ぶ側が渡す id(`p_id`)を冪等キーにし、同じ id の行が既にあれば「同じ呼び出しの再送」として扱う。
ところが id は**行の中身を問わずに選べる鍵**である —— 「id の行があるか」だけを見て既存の行を返すと、
他人の行の id を渡した呼び出しにその中身が返る(複合 RPC なら、そこから鎖で辿れる同伴の利用者・付箋まで)。

**MUST**: `shape: create` の関数を持つ表と、保存点の最初の作成の錨になる表は `resend` を宣言する。

```yaml
# 作成者の欄がある表: 再送で返すのは作成者 = 実行者の行だけ(違えば中身を返さず UC409)
resend:
  returns_existing: true
  creator: owner_id          # 作成の RPC が実行者そのもので埋める列(action_spec の owner で明示した欄)

# 作成者の欄が無い表: 再送で返すのは、その作成の監査ログ(domain_events)の実行者が今回の実行者の行だけ
resend:
  returns_existing: true

# 再送で既存の行を返さない(同じ id があれば常に UC409)
resend:
  returns_existing: false
```

- **冪等キーは送信の意図の鍵である**(点検 20 回目 B20-1)。画面の実行器が 1 回の送信の意図に 1 つ作って Server Action の第 2 引数で送り、
  成功するまで同じ値を送り直す(書けた後に応答を失った後の押し直しも同じ鍵)。Server Action は形を確かめて実行器へ渡す。
  キーがサーバーの呼び出しごとに作り直されると、押し直しのたびに行が増える(購入希望・蔵書・招待・貸出で実測)か、
  偶然の一意の索引が 2 回目を入力の誤りとして断る(分館)。
- `creator` を書かない `returns_existing: true` は、作成 RPC が同じ txn で必ず書く監査ログの行(同じ id・同じ操作)の実行者で
  持ち主を確かめる(`r.actor_id is not distinct from p_actor_id`)。未ログインの作成は実行者が null どうしで一致し、推測できない
  鍵(UUID。送った画面だけが持つ)が範囲になる。作成者の欄の無い表も、押し直しに 1 回目の行を返せる。
- 返す方針の枝は**同じ鍵で入力が違う再送**を返さない —— 入力から入る列(引数・`p_values`。id・実行者・時刻の式・トリガが供給する
  列は除く)のどれかが既存の行と違えば、拒否の語 `resend_input_mismatch`(UC412)で断る。1 回目は書けているので行を増やさず、
  2 回目の入力を「書けた」と偽らない(画面は読み込み直して確かめるよう案内する)。後の操作で書き換わった行も「違う」に数える。
- **本文が手書きの作成 RPC**(`shape: composite`・`handwritten`。例: テンプレートの複製を同じ txn で行う蔵書の作成)も同じ振る舞いを持つ。
  生成の 1 か所(`legacy/spec-tools/lib/sql/rpc-resend.ts`)を通らないので、rpc-parity が期待(`rpc-expectations` の `resendInput`。
  作成の操作の入力の欄からトリガの供給列を除いた列と拒否の語)から、本文に拒否の語と各列の比べ(`.{列} is distinct from`)があることを見る
  (`legacy/spec-tools/lib/sql/rpc-resend-handwritten.ts` の `handwrittenResendExpectation` を生成器 `code-rpc-expectations.ts` が呼ぶ。点検 20 回目 B20-1 の残り)。
- 複合 RPC の先頭の再送の枝は、錨が最初の手順なら確かめ(持ち主・入力)を**錨の作成 RPC に任せる**(同じ引数で呼び直し、通れば読み直す)。
  確かめを 2 か所に書かない。
- 複合 RPC(保存点)は錨の列だけでなく**入力の全体**を比べる(点検 21 回目 A21-1)。1 回目に正規化した `p_input` の要約(sha256)を
  **仕組みの短命の表 `resend_digests`**(`framework: resend_digests`。設計図は `legacy/spec-tools/lib/sql/framework-tables.ts`、
  読み書きの字面は `lib/sql/rpc-resend-digest.ts`)に 1 行残し、再送で比べる。要約は個人列を含む入力から作るので、**追記専用の
  監査ログには置かない**(消去が届かず、推測した値の照合に使える)。行は 2 つの道で消える: 実行者の消去(消去の RPC の宣言
  `scrub_via: {resend_digests: [actor_id]}`。T24 は設計図の実行者の列を本人へ届く道に数える)と、保持の時間(data_table の
  `retention_hours`。過ぎた行は比べに使わず、次に保存点が 1 回目を書くときに消す —— **掃除は保存点の 1 回目のたびだけ**で、定期の
  掃除は無い。行が物理的に残る最長は「保持の時間 + 次にどれかの保存点が 1 回目を書くまで」で、静かな製品では上限が無い)。時間を過ぎた押し直しは拒否の語 `resend_expired`
  (UC412)で断る —— 鍵は錨の行の id なので新しい作成としては受けられず、別の行を黙って作ることもしない(画面は読み込み直しを案内し、
  読み込み直すと新しい鍵になる)。錨が既存の行を返す保存点を持つ製品は `resend_digests` の data_table が要る(無ければ Y12)。
- **同じ鍵の 1 回目がコミットする前に届いた押し直し**(点検 22 回目 A22-1)は、複合 RPC の先頭の確かめ(錨の行の実在。別の文)を抜け、
  錨の作成 RPC の再送の枝で 1 回目のコミットを待ってから既存の行を受け取る。**再送かどうかを決めるのは錨の作成 RPC の 1 か所**で、
  既存の行を返すときに txn の内だけの印 `st.resent_id`(値 = 返した行の id。`lib/sql/rpc-resend.ts` の `signalResend`)を立てる。複合 RPC は
  錨の作成の直前に印を消し、直後に印を見て、再送なら**以降の手順を実行せず**先頭の枝と同じ比べ(保持の時間 → 入力の全体)と読み直しへ
  合流する(`generate/render/usecase-rpc-resend.ts` の `resendAfterAnchor`)。手書きの作成 RPC も同じ 1 文を持つ(rpc-parity が `resendInput.signal` で見る)。
  要約の刻みは**保持の時間の内の同じ鍵の行を置き換えない**(1 回目にコミットした入力が勝つ。足せなければ —— 1 回目の要約が残っているのに錨の行が無い =
  1 回目が作った行がその後に消された —— `resend_target_deleted`(UC412)で断る。「既に保存されています」の `resend_already_saved` は一覧に行が無いので使わない。
  画面は消えたことと作り直しを案内する。
- **1 回目の行が消された後の同じ鍵の押し直しは作り直さない**(点検 23 回目 O23-2・A23-1)。作成 RPC は行を入れた**後に**、同じ鍵・同じ操作の
  作成が監査ログ(追記専用で消えない)に既にあるかを見て、あれば全体を戻す —— 1 回目の実行者が今回の実行者なら `resend_target_deleted`(UC412)、
  他人の鍵なら競合(UC409)。単発の作成も保存点も同じ判断で、要約の表は要らない(`lib/sql/rpc-resend.ts` の `refuseRecreated`。並べるのは
  `lib/sql/rpc-body-refusal.ts` の `createRefusalBlock`。手書きの作成 RPC は同じ語を持ち、rpc-parity が `resendInput.deleted` で見る)。入れる前に
  見ないのは、錨を消す txn との交錯で「行がある」を読んでから作り直すため。引き当ては監査ログの索引 (entity_id, event_id) で引く。
  複合 RPC の委任する枝(錨が最初の手順のとき、先頭で錨の行を見たら作成 RPC を同じ引数で呼び直す)は、呼び直しの前に印を消し、呼び直しが
  印を立てなければ(= 新しい行を作った)`resend_target_deleted` で全体を戻す(`usecase-rpc-resend.ts` の `resendBlock`。手書きの錨にも効く二の線)。
  交錯の性質 `expectSaveResendRace` は、錨の行を消す txn を開いたまま同じ鍵の押し直しを送る交錯も確かめる。
- **印 `st.resent_id` の持ち主**(txn の内だけの設定。仕組みの印はこの 1 つ): 立てるのは錨の作成 RPC の再送の枝(`lib/sql/rpc-resend.ts` の `signalResend`。
  並べるのは `lib/sql/rpc-body-refusal.ts` の再送の枝。手書きの錨の作成 RPC も同じ 1 文を持ち、rpc-parity の `resend-input-check.ts` が見る)。消して・読むのは
  複合 RPC(`clearResendSignal` / `resendSignalled` を `generate/render/usecase-rpc-resend.ts` の `resendAfterAnchor` が錨の手順の前後に置く)。ほかの呼び手は読まない。
- 作成ごとの送り直しの性質(同じ入力 2 回 → 1 回目の行・行は 1 つ)は、一致の証明の生成テストが作成ごとに実 DB で確かめる。保存点の作成は
  加えて、入力を 1 欄変えた押し直し(`expectSaveResendEdited`)と、1 本目の txn を開いたまま同じ鍵の 2 本目を送る交錯(`expectSaveResendRace`。
  書き込み経路の各点で、同じ入力なら 1 本目の行・変えた入力なら `resend_input_mismatch`)を確かめる。

- `creator` は**作成のその呼び出しが実行者そのもので埋める列**でなければならない(入力から読む列・後の遷移が書く列は
  「作った人」ではない)。実行者で埋まる列は**明示の宣言の列だけ** —— 作成の action_spec の `owner: {集約}.{欄}`
  (保存点では手順の `defaults.self` も)である。入力に無い実行者への参照の欄を推測で作成者とは見なさない(点検 9 回目 A9-1:
  推測が残っていた頃、代理作成で残った査閲者の列を T6 の直し方の文が作成者の候補として勧めた)。違えば T6 / Y12 が止める。
  作成者の欄があっても `returns_existing: false` は書ける。
- 作成者の条件は `p_actor_id is not null and t.{creator} = p_actor_id` である。実行者が null の呼び出し(システムの処理)は
  誰の行も受け取れない(null を「誰でも」と読まない)。
- 単発の作成 RPC と複合 RPC の先頭は**同じ表の同じ宣言**を読む(`legacy/spec-tools/lib/usecase/resend-policy.ts`)。
  片方だけが返すと、もう片方の経路から同じ行が漏れる。
- 書いていなければ T6 / Y12 が名指しで止め、生成器は本文を出さない(既定を置かない)。

**MUST**: 作成は、**実行者の参照の欄**を実行者そのものに縛る。縛りは**規則ごとの `by` の段の一部**であり、
engine(意味の正)と作成 RPC(写し)が同じ導出(`legacy/spec-tools/lib/usecase/actor-bound.ts`)を読む ——
engine の作成規則表は縛る規則に `self: ['{集約}.{欄}']` を持ち、`canCreate` は縛りの成り立たない規則を「当てはまらない」
(`role_forbidden`)に数える。作成 RPC はその規則のロールの述語に `coalesce(({欄の式}) = p_actor_id, false)` を積む
(0 行の分類ではロールの段 = `UC403`)。拒否の順は既存の規則(ロール → 再送 → 前提 → ガード)のロールの位置であり、
ガードより先に判定する ——「この値で作ってよい人か」は「誰が作れるか」の問いで、文脈依存ロールの `binding` と同じ形だからである。
規則の `when` はガードの段のままで、縛りと混ぜない(規則をまたいで条件が混ざらない)。一致の証明は入力に出した縛られる欄に
「実行者本人」と「他人」の両方を振る。

**実行者の参照の欄** = 型が実行者の集約への `ref` の欄のうち、作成で行に入るもの(input の欄・必須の欄)の**全部**である(持ち主・発行者だけでなく、
承認者のような「別の人を指す欄」も入る)。`binding` / `records_actor` / `defaults.self` に現れる欄だけに絞らないのは、
それらが書き忘れうる宣言だからである(書き忘れた欄が縛りの外に落ちると、黙って他人を指せる口が残る)。

欄は 2 種類に分かれ、縛りを解く規則(`access_spec` の `creates` の規則ごと)が違う。

| 欄 | 何か | 縛りを解く規則 |
|---|---|---|
| A(action_spec の `input` に無い) | 実行器が実行者で埋める欄(action_spec の `owner` で明示した持ち主・発行者。宣言の無い欄は実行計画が止める) | `by` が `kind: system` のロール |
| B(`input` にある) | 人が値を選ぶ欄(代理で作る相手・承認者) | `by` が `kind: system` のロール / `delegate` でその欄を名指した規則(`- field: {集約}.{欄} / reason: {理由}`。名指していない欄は縛ったまま) |

- **ロールの種類では解かない**(点検 11 回目 A11-3)。以前は「既定のログインロールでない `claim` のロール = 管理のロール」と推測して全部の欄を解いたので、
  一般の利用者の役の規則でも理由なしで任意の人の名前で作れた。管理のロールが代理で作るときも `delegate` で欄と理由を名指す。
- どちらも、縛る規則の実行者からの「値 ≠ 実行者」は `UC403`。`delegate` は A を解かない(入力に出していない持ち主の欄まで開ける理由は無い)。
- B の欄があるのに、それを解く規則が 1 つも無ければ T6 が止める(誰が自分以外を選んでも必ず `UC403` になる入力を verify 緑で作らない)。
  直し方は「input から外す(実行者で埋まる)」か「別の人を選んで作る規則の `delegate` にその欄を名指す」。
- `delegate` は**欄を名指す**(点検 10 回目 A10-2。以前は規則単位の 1 文字列で、承認者の欄のために書いた理由が、後から入力に足した
  別の実行者への参照の欄の縛りも黙って外した)。名指した欄が作成の `input` に無い・実行者への参照でない・規則がもともと縛らない
  (内部実行)なら、何も解かない腐った宣言として V18 が止める。
- `delegate` で開けた欄が別のロールの `binding` の根拠になる(承認者を選ぶ → 承認者のロールが立つ)なら、
  **自分を入れる形を不変条件で止める**(例: `claim.employee_id != claim.approver_id` を DB の check に落とす)。
  これを仕組みの側で要求する検査はまだ無い(R2 の広げと合わせて検討する)。

```yaml
creates:
  - by: patron
    delegate:
      - field: application.applicant_id
        reason: 窓口担当が利用者の代わりに貸出を作る(誰が代理したかは監査ログの実行者が残す)
```

**追記専用の歴史との両立は、名前を仕様に宣言させることで取る。** migration は追記専用であり、
生成物で上書きできるのは「まだ適用していないファイル」だけである。SQL が変わる仕様変更をしたら
`migration` の連番を新しく採番し直す（旧ファイルは歴史としてそのまま残り、新ファイルが
`create or replace` で同じ名前の関数を置き換える）。複合 RPC の `saves[].migration` と同じ規則であり、
正は [migrations.md §生成 migration](../../../process/backend/system/standards/conventions/migrations.md)。
**署名が変わったときの `drop` も生成物が持つ** —— 生成 migration は先頭に do ブロックを置き、
同名で引数型の並びが宣言と違う関数だけを落とす（`create or replace` は署名が変わるともう 1 本を
作るため。残った多重定義は `rpc-signatures-parity` が「同名は 1 本だけ」で赤にする）。

**MUST**: 定型 5 形は `p_actor_roles text[]` を引数に持つ（束 ⑳-3。`params` / `args` に宣言する）。
本文は `access_spec` の `creates` / `writes` / `deletes` と `state_spec` の `by` / `guard` を述語として
持ち、**engine を通らない経路から実行しても DB が規則を守る**（ADR-0012 ⑤）。DB は「誰がログインして
いるか」を知らないので、セッションから立つロール（`kind` と `claim`。`implies` の推移閉包で閉じた
もの）だけをこの引数で受け取る —— 文脈ロール（`binding`）は対象の行から DB が立てる。
`by` に束縛でないロールが 1 つでも並ぶのに引数が無い宣言は T6 が反例つきでエラーにする。

**MUST**: 書き込む RPC は、**0 行の理由を聞き直す文が読む行を、書き込みの前に掴む**。聞き直しは書き込みとは
別の snapshot を見るので、掴まなければ「書いた後・コミットの前に前提が動く」時間帯が残り、**コミットした状態では
成り立たない条件**で書いたことになる（TLA+ の `formal/Occ.tla` が S9 / S8 の反例を出した時間帯）。掴む相手は 3 つ
——①期待状態の条件として join する親、②ガード式がスカラー副問い合わせで読む親（**鎖の途中の行も**。終点の id を
途中の行から読むため）、③**実行者の行**（`by` のロールの根拠がそこにある）——で、どれも `for share` である。

**MUST**: **この txn が触る行（読む行 + 書く行）を全部、表名のバイト順で掴んでから、最初の書き込みをする。**
順序は**リポジトリに 1 つだけ**であり、**手書き RPC（`handwritten:` / `shape: composite`）も同じ順序で掴む**。
逆順に掴む本文が 1 本あれば、そこと交錯した生成 RPC がデッドロック（40P01）になる。
**書く行を順序の外に置いてはならない** —— 書く表の名前が読む表より小さいときにそれだけで逆順ができる
（実測: `apply_patron_transition` が `patrons` を先に書き、`loans` を読んで `patrons` を読む生成 RPC と
詰まった。20260921000245 で直した）。順序は `localeCompare` ではなく**バイト比較**で決める（手で書く側と
機械の規則を 1 つにする）。**実行者の集約が書き込む表と同じとき**だけは、2 行を 1 文で `order by id` の昇順に
`for update` で掴む（別々に掴むと「自分の行を共有で掴んでから相手の行を書く」2 本が互いを待つ）。
生成 RPC の先掴みは、**同じ表に掴む文が 2 つ以上あれば強さを問わず 1 文に畳む**（各文の選び方の和を `id in (…) order by id` で、強い方 ——
どれかが排他なら `for update`、全部が共有なら `for share` —— で掴む。同じ表の 2 行を別の文で掴むと、順が id でなく文の順で決まり、2 本が互いの行を
逆の文の順で持つ。点検 fix26 5 回目 D26e-1。共有だけの 2 文も、間に別の txn の排他の 1 文（2 行を id の順）が挟まると輪になる。6 回目 D26f-1。
畳むのは `rpc-body-lock.ts` の `lockPlan`、部品は `rpc-lock-merge.ts`。表名のバイト順と同じ表の 1 文は、生成器の性質の試験が全題材の計画で守る
（legacy/spec-tools の rpc-fk-check-order.test.ts。点検 27 回目の決め）。D26f-2）。
**同じ表の複数の行を掴む文**（1 行を id で名指さない `for update` / `for share` / `update` / `delete`）は、一般に `order by {別名}.id` の
昇順で掴むか、それより前の順序つきの先掴みに覆われる（1 文の中の行の順は走査の順で、同じ表の行を 2 本が逆の順で掴み合う。
点検 20 回目 A20-3: 消去の一言の写し直しが予約を順序なしで書き、並べ替えは `order by p.id` で掴んでいた）。外部キーの連鎖が消す子の行も
同じで、親を消す本文が子を id の昇順で先に掴む。1 行の掴み（id か一意の索引の全部の列を 1 つの値で名指す）と、待たない掴み
（`skip locked` / `nowait`。待ちの輪に入らない）は対象の外。
**新しい行の `insert` は順序に入らない** —— 既存の行のロックを 1 つも取らないからである（親への外部キーの
行は、その親を読む側の `for share` が既に掴んでいる）。**ただし書き込みの外部キーの確かめは親の行を `for key share` で掴む**
（子の行を入れる・参照の列を書き換えるとき。`for update` とだけ衝突する）。先掴みが排他で掴む表より名前の順で前の親を、
確かめが書き込みの中で後から掴むと逆順になる（実測 40P01: 実行者の表の別の行の店を付け替える編集が、実行者の行と対象の行を
排他で持ったまま新しい店の行を待ち、店を排他で掴んでから実行者の行を共有で掴む txn と詰まった）。生成器は、書く参照の列の
**書いた後の値が指す親の行**が排他で掴む表より名前の順で前か同じ表のとき、その行を既存の先掴み（作成のガードの錨・閉包の掴み）が
**同じ値で、排他の行より前に**掴んでいなければ**生成を断る**（親が排他の行と同じ表なら、覆いはその排他の文そのものだけ —— 同じ表の 2 行を別の文で掴むと順が id で決まらない。点検 fix26 4 回目 D26d-2。値が言えない掴み（書く前の値・実行者の行・副問い合わせ）は覆いに数えない）（T6 が宣言の時点で名指す。照合は掴みの計画のデータの上で行い、SQL の字面は
比べない —— `rpc-fk-check-order.ts`。遷移の `records_actor` の引数の枝・自分の表を指す参照の列も同じ規則に乗る。点検 fix26 3 回目
D26c-1・D26c-2）。作成の冪等キーの行だけを排他で掴む作成は数えない —— その行が既にあれば挿入の前の再送の枝で返り（確かめに進まない）、
無ければ掴みは 0 行で何も持たない（組の閉じた表は `rpc-fk-key-share.test.ts`）。
**書き込みが発火させるトリガが掴む行と、削除が外部キーの連鎖（`on delete cascade` / `set null` / `set default`）で
消す・書き換える行も、この txn が触る行である**（`insert` が発火させるトリガの掴みも入る）。先掴みに入れないと、
トリガ・連鎖の中で書き込みの**後から**掴むことになる（実測: 親の遷移が監査ログのトリガの中で、親を指す子の表
（名前が親より小さい）の行を親の後から掴み、子 → 親の順に掴む子の更新と 40P01 になった。点検 18 回目 O18-1）。生成器は宣言から引き当てられる行を先掴みに入れる（`rpc-closure-locks.ts`: 書き込みが発火させる
トリガの関数の `also_writes` のうち自表を直に指す行と、削除の `also_writes` へ自表から外部キーの鎖を辿る行。`for update`）。
手書きの本文は自分で掴む。トリガの本文の中では、発火させた関数の先掴みより前に掴む手段が無いので、**トリガの本文は
発火させる関数の先掴みより小さい名前の表を掴まない**形にする（予約の写しのトリガは同伴の利用者の行を掴まず、消去との順は
予約の追加が写し元の同伴の利用者の行を先に共有で掴むことで守る。20261105100042 / 20261105100047）。

**掴みには強さと行がある**（点検 19 回目 A19-1）。トリガが親の行を排他で掴むなら（例: 貸出上限のトリガが蔵書を `for update`）、
その書き込みをする RPC は**同じ行を同じかより強い強さで**先に掴む —— 共有で先に掴むと、2 本の txn が共有を持ったまま互いの
排他を待つ（格上げのデッドロック。実測 40P01）。宣言は data_table の `triggers[].locks: { {親の表}: share | update }`
（発火させた行が直の外部キーで指す親）で、生成器は先掴みをその強さに上げ（同じ行の期待状態の親の掴みも強める。作成も
入れる値で掴む = O19-3）、同じ表では排他を先に並べる。**写しのトリガは写し元を宣言する**（`triggers[].copies_from`。
個人列を供給するなら必須 = T27）。写しを作る RPC は写し元の行を共有で先に掴み、写しの作成と写し元の個人列の消去を 1 本ずつに
並べる（点検 19 回目 A19-3）。写しは写した時点の値を持ち、その値の持ち主は写した時点の写し元の行の持ち主なので、**持ち主の列が
作った後に書ける写し元の表と、行が操作で消せる(access の `deletes`)写し元の表は、元の持ち主と古い値を記録するトリガを
`triggers[].remembers_owner` で宣言する**(写しが写し元の `id` を `on_delete: cascade` の外部キーで持てば、削除では一緒に消えるので求めない。点検 20 回目 C20-8) —— 行の削除・
持ち主の列の更新・**写される個人列の更新**の全部で発火すること（持ち主のまま名前を直してから紐づけを外すと、外す時の記録は
直した後の名前で、写しの古い名前に消去が届かなかった。T28。点検 19 回目の後の性質テストの反例）。**消去の対象を指す外部キー**は `foreign_keys[].refuse_erased` で「消去済みへの新しい紐づけを断る」
を宣言でき、その列を引数で書く定型 RPC は紐づけ先の行を共有で先に掴んで、消去済みなら拒否の語で断る（A19-4。関所の無い
書き込みは `erased-link-parity` が赤）。同じ宣言の `freezes_personal: { word, message }` は「消去済みを**指したままの行**の個人列を
凍らせる」を言う（点検 20 回目 A20-1。自表が個人列を持つなら必須・持たなければ書けない = T27）—— 消去は紐づけを外さずに個人列を
置き換えるので、消去と重なった直しや消去の後の打ち直しが実名を書き戻すと、行は消去済みを指したまま実名を持ち、以後消す道が無い。
自表の個人列を書く定型の編集・遷移は、対象の行を排他で掴んだ後、対象の行の外部キーが指す行を共有で掴み（実行者の集約と同じ表なら
実行者の行と 1 文で id の昇順）、書き込みの直前の個人列を控え、書き込みの後で値が変わり指す行が消去済みなら UC412・detail = 凍結の語で
断る。紐づけを外した行（外部キーが null）は凍らない（外した後の打ち直しは新しい入力）。DB のトリガにしないのは、消去の本文自身が
同じ行の個人列を置き換えるのと、判定の順（状態 → ロール → ガード → 消去済み）を本文が決めているためである。手で書く本文が
個人列を入力の値で書くときも関所が要り、`erased-link-parity` は掴んだ行と断る値の結びつき（同じ外部キーの列）まで見る。advisory lock の鍵は宣言（送信の上限の `keys`・未ログインの作成の天井・
`triggers[].advisory`）に載せ、行の掴みを済ませた後に鍵の字面のバイト順で取る（O19-2）。

**MUST**: **生成物の**逆順の本文が 1 本も無いことは、ライブ DB の本文が生成物の RPC（`migration` あり）の全部について機械が見る
（`app/src/infrastructure/__tests__/schema/lock-order-parity.test.ts`。題材の通し実行でも回る。読める掴みの形は閉じた表（`lock-order-forms.ts`）で、
表の外の形（`merge`・`lock table`・`of` の無い結合の掴み・`api` のビュー経由の書き込み・字面で読めない advisory lock）は赤。
トリガ・連鎖の中の掴みは、先掴みが**その行をその強さ以上で**掴んだと字面で言えるときだけ掴み済みとし、格上げは順が正しくても赤
（`lock-order-judge.ts`。「その行を掴んだ」は**行の集合の包含**で言う。包含の本体は `lock-order-rowsets.ts`）。複数の行を順序なしで掴む文は赤。
**書き込みが発火させるトリガの本文と外部キーの連鎖も、カタログ（`pg_trigger` / `pg_constraint`）から閉包まで辿って発火の位置に数える**
（読み方は `lock-order.ts`）。本文の言語が読めないトリガと、相手の表を引き当てられない掴みは赤にする。順序の対象は public の表である。
受け入れの口（関数と表と文の指紋の閉じた表）は持たない。

**本文が生成物でない RPC（`handwritten:`・`shape: composite`・`runner: manual` の操作の本文）と、手順を重ねる保存点（`usecase_*`）は、掴む順の約束を
やり直しに頼ってよい**（点検 27 回目の決め。保証台帳 `rpc_enforces_spec` の「交錯したときの守り」②）。RPC を呼ぶ道は `@kaninabe/adapter-postgrest` の `retryRollbacks` が返す口だけで
（製品の接続層の型は `rpc` を出さない）、デッドロック（40P01）・直列化の失敗（40001）で DB が中止した取引を上限つきでやり直し、尽きたら書けていない
（`not_committed`）一時的な失敗として返す。手書きの本文の字面を読んで逆順の無いことを証明する走査と、その受け入れの閉じた表は持たない ——
読みの盲点を受け入れで埋める形が点検のたびに次の穴を出した（fix26 の差分点検でロック計画の系統が 7 回連続）。手書きの本文が順を揃える義務は
無くなったが、揃えるほど 40P01 とやり直しの遅れは減る（新しく書く本文は上の順で掴むのが既定）。

**コミット時に集計で守る不変条件**（件数の天井・人数の下限）も同じ競合の時間帯を持ち、そちらは制約トリガが数える前に
`pg_advisory_xact_lock` を取って同じ鍵の txn を直列化する（S4 / S5。鍵は「数える鍵ごと」か「表ごと」）。

### 送信の上限

**外へ出る送信(outbox に積むジョブ)の回数の上限は、data_table の `functions[]` に `kind: send_limit` として宣言する。** 本文は生成物で
(`legacy/spec-tools/lib/sql/send-limit.ts`)、手で書かない(点検 17・18 回目の告知の上限は手書きの本文にあり、数える種別と積む種別の
値域・数える鍵と payload の鍵・掴む順・拒否の語の写しが、それぞれ別々に書かれていた)。置き場は数えて積む表(outbox = `jobs`)の data_table で、
名前は `send_limit_{名前}`、書き出し先は `migration: {14 桁}_send_limit_{名前}.sql` である。

```yaml
  - name: send_limit_{名前}
    args: [text, uuid, …, text, …]       # 種別・keys の順・payload の順(T26 が宣言から導いた形と突き合わせる)
    params: [p_type, p_{鍵}, …, p_{欄}, …]
    kind: send_limit
    migration: "{14 桁}_send_limit_{名前}.sql"
    send_limit:
      event: "{集約}.{操作}"             # 拒否の本文 usecase_guard:{event}。呼ぶ RPC の集約の操作(T26)
      types: ["{ジョブ ID}", …]          # 数える種別と積んでよい種別(同じ 1 つの閉じた並び。ジョブカタログにある = T26)
      keys:                              # 数える単位(payload の鍵。uuid)。宣言の順が引数の順
        - name: "{鍵}"
          blocked: { table: "{表}", column: "{状態の欄}", values: ["{状態}"], word: "{語}" }   # 任意。鍵が指す行がこの状態なら送れない
          unit: actor                    # 任意。何を 1 つと数えるか。既定(省略・actor)は鍵の値ごと(実行者ごと)。下の via は辿った先ごと
          # unit: { via: [{ table: patrons, column: invited_via, to: invitations }, { table: invitations, column: issued_by, to: patrons }] }
      payload: ["{欄}"]                  # 鍵のほかに payload に載せる欄(text)
      limits:                            # 宣言の順が拒否の理由を選ぶ順
        - { word: "{語}", key: "{鍵}", max: 10, per: 24 hours }   # per は {n} {minute|hour|day}s(366 日まで)
```

生成する本文は次の順に行う(崩すと嘘になる)。①種別が `types` の外なら例外で全部を巻き戻す(何も積まない)。②鍵の `blocked` に当たる行なら
UC412 で拒む(`detail` = 語。時刻を持たない)。③**鍵ごとの `pg_advisory_xact_lock(hashtext('{関数名}:{鍵}=' || 値))` を、鍵の字面のバイト順に取る。**
④上限を宣言の順に数え(`created_at > now() - per`)、`max` 本以上なら UC412 で拒む(`detail` = 最初に当たった上限の語、`hint` = 当たった上限の全部の
「新しい方から `max` 本目 + `per`」の最も遅い時刻。秒は切り上げ)。⑤ジョブを 1 本積み(payload は鍵の全部と `payload` の欄)、その ID を返す。
実行は定義者の権限で、面のロールには実行権限を与えない。

**数える単位(`unit`)**: **`unit: { via: [...] }` は試験段階で、使うかどうかは未決である**(2026-11-05 コーディネーターの決定)。宣言すると T26 が警告を 1 件出し
(理由の語 `send_limit_unit_experimental`)、製品の仕様では未分類の門(`--fail-on-unclassified`)で止まる。決めるまでは既定(鍵の値ごと)で数える。
既定は鍵の値そのもの(実行者の鍵なら実行者ごと)である。`unit: { via: [...] }` を宣言すると、鍵の値から entity_spec の
参照の欄を順に辿った先の値(例: 利用者 → 招いた招待 → その発行者 = **招いた利用者**)を単位にし、同じ単位に辿り着く鍵の値の送信をまとめて数える
(自分の別アカウントを招いても、招いた人の単位にまとまるので上限が増えない)。辿れない値(招いた人がいない最初の利用者)は鍵の値そのものを単位にする。
本文は単位を先に引き、**advisory lock は単位の値で取る**(同じ単位の同時の送信を直列化する)。ジョブの payload には鍵の値(実行者)をそのまま積み、
数えるときに同じ辿り方で単位に直して比べる。各歩は参照の欄で、行き先がその参照の集約の表・歩は途切れず・最後の行き先は最初の表であることを T26 が見る。

**MUST**: 送信の上限を呼ぶ本文は、**行の掴みを全部済ませてから呼ぶ**(上の「表名のバイト順で掴んでから最初の書き込み」の先掴み)。生成物は行を
掴まず、advisory lock の後で行を待たないので、行の掴みとの間に待ちの輪はできない。advisory lock どうしの順は、**鍵が宣言の写しとして順序つきで
生成物に載る**(`send-limit-expectations.ts` の `locks`。取る順そのもの)ので、後から検査が本文を読まずに順を知れる。`lock-order-parity` は
呼び出しの位置にこの関数の本文を差し込んで行の掴みを数える(advisory lock そのものは行の掴みではないので数えない)。

呼ぶ側は `calls: [send_limit_{名前}]` で名指し、どの RPC も呼ばない上限は T26 が赤にする。拒否の語の製品の表は手で書かず、生成物
`send-limit-expectations.ts` の `words`(DB が上げる順)と `SendLimitWords`(関数ごとの語の型)から引く。実 DB の挙動は
`send-limit-parity`(宣言の全部を回す)、本文の字面は data-table-parity(md5)が見る。

**MUST**: 作成 RPC の `p_values` が受け取る欄の母集合は **entity_spec** である（action_spec ではない）。
`id`・入力に現れない欄（`auto` / 状態列 / `supplied_by: db`）・ほかの引数が 1 欄ずつ受け取る欄・
実行者そのものが埋める欄を落とし、残りのうち**必須で列の既定値（`defaults`）を持たない欄**と
**action_spec の `input` に現れる欄**を受ける。action_spec の `input` はこの部分集合（人が渡す分）
であり、母集合そのものではない —— 母集合を action_spec に取ると、**予約 ID の action_spec を
持たない集約**（受信 Webhook や保存点の中からしか作られないもの）で本文が退化する（実測: 入金通知の
作成 RPC が `insert into ... (id) values (p_id)` になり、受信経路が NOT NULL で必ず落ちる形が
verify も generate も緑のまま生成されていた）。逆に「必須でも `defaults` がある欄」に口を開けないのは、
渡さなくても列の既定値で行が成立するからであり、開けると「DB が決める」と宣言した値を呼び手が
上書きできてしまう。**この向きは `defaults` の宣言漏れを load-bearing にする**ので、
data-table-parity が「DB に既定値があるのに宣言が無い列を `p_values` から入れていないか」を
逆向きにも見る。

**突合は本文の出どころで 2 つに分かれる。**

| 本文の出どころ | 見るもの | 対象 |
|--------------|---------|------|
| 生成物（`migration` あり） | 生成した SQL と `pg_get_functiondef` の本文が**丸ごと一致**すること（空白を潰した比較） | 定型 5 形のうち生成するもの |
| 手書き（`handwritten` / `composite`） | 下の「意味のある断片」だけ（完全一致は空白・コメントの差で落ちるので脆い） | それ以外 |

生成物の側で断片を見ないのは、**ずれようが無い**からである —— 許可列も楽観的並行制御も空の扱いも
生成器が宣言から作っており、ここで見たいのは「生成し直したが migration を当てていない」だけである。

手書きの側で見る断片は次のとおり。

| 見るもの | 期待の出どころ | 対象 |
|---------|--------------|------|
| 書き込み先の表 | `also_writes`（本文が書き込む表と、本文の削除から実 DB の外部キーで辿る連鎖の表から、帰属表を除いた集合と一致すること。表ごとの種類も） | **全 `kind: rpc`**（生成物も composite も） |
| 帰属表への書き込み | `self_writes`（定型は形が決める。連鎖の分も含む） | **全 `kind: rpc`** |
| 個人列の消去 | `update` の set 句が個人列を書き換える表は宣言に `scrub` があること（逆も） | `also_writes` の表と、`self_writes` を宣言した関数の帰属表 |
| 読めない本文 | 他の関数の呼び出しは `calls`、`execute` は `dynamic_sql` と一致すること（宣言の無いものは「読めない」で赤） | **全 `kind: rpc`** |
| 効果の目印 | `realized_by` でこの RPC を名指す効果 ID のリテラルが本文にあること | 名指された RPC |
| 許可列 | access_spec の `writes` に現れる列の和（`key not in (...)` と `set` 句の両方と一致すること） | 手書きの `shape: update` |
| 楽観的並行制御の有無 | `writes` に条件つきの規則があるか（`shape: transition` は無条件に要る） | 手書きの `shape: update` / `transition` |
| 空を渡された列の扱い | state_spec の `clears`（並ぶ列は代入、並ばない列は `coalesce`） | 手書きの `shape: transition` |

断片の突合が無かったために、`items` に料金の列を足して `writes` にも並べたのに `update_item` の許可列を
作り直しておらず、**料金モデルに値を入れる経路が 1 つも無い**状態が緑のまま通っていた（E3 第3段の実穴）。
本文が生成物になったいまは、その食い違い自体が起こらない。

**見ていない線**: `create` / `delete` の楽観的並行制御は期待に入れていない。実物の一部が親の状態を取らない
古い形のままで、そこは「`_template/create` に `conflict` の結末が無い」という別の未処理と同じ穴に当たる。

検査は 3 層に分かれる。

| 層 | 実体 | 見るもの |
|----|------|---------|
| T0 | ローダー（`legacy/spec-tools/lib/data/`） | スキーマ適合・id とファイル名の機械的対応・entity/internal の排他・**`kind: rpc` の shape 必須**（それ以外では宣言不可）・**`params` は `kind: rpc` でだけ宣言できる** |
| T1 | 検証器（verify） | `entity` の entity_spec 実在・テーブル名の一貫性・状態の欄を `defaults` に書かないこと（複数形化規則 + `table:` 上書き）・帰属の 1 意性・**entity_spec があるのに data_table が無い欠落**・**`params` の長さ / 形式 / 重複** |
| T3 | 検証器（verify） | `test_cases` ⇔ テストの 3 段突合（ファイルの実在 → `@tc` → テスト名の一致。A6 / Q6 / Z1 と共通実装）と `spec_ids` の実在、および**表ごとの突合テストの宣言の必須** |
| T6 | 検証器（verify） | **定型 5 形の本文の出どころ**（`migration` か `handwritten` のどちらか一方・`composite` はどちらも不可。`handwritten` の理由は空にできない）と、`migration` の形式（`kind: rpc` は `{14 桁}_rpc_{関数名}.sql`、`kind: helper` は `{14 桁}_helper_{関数名}.sql`）・全 data_table を通した一意性。加えて**本文が実際に組み立てられること**（表が entity を持つ・全引数の役目が規約から決まる・`p_expected_{集約}_{列}` の条件先まで参照が辿れる・**作成なら表の `resend` があり、`creator` が作成で実行者に埋まる列である**・**action_spec の `input` に出した実行者の参照の欄を、どの規則も解かない(誰が選んでも UC403)ことが無い**・**遷移の RPC の列の引数 `p_{列}` は、その機械のイベントの `records_actor` / `clears` / `records_time` か、そのイベントを扱う action_spec の `input` / `computes`(自集約の欄)が名指す列だけ**(許可表。どの宣言も名指さない列は全イベントの呼び手が書ける口になる —— 点検 7 回目 A7-1)）を、生成と同じ写像を呼んで見る（生成器が `preconditionFailure('T6')` で報告する前提そのもの）。`records_actor` の列の引数は、生成する本文が書き込みの前に記録するイベントで `p_actor_id` に縛る |
| T7 | 検証器（verify） | **RLS のポリシーの本文の出どころ**。`access_spec` を持つ表の `policies_migration` の必須・形式（`{14 桁}_policies_{テーブル名}.sql`）・全 data_table を通した一意性（`functions[].migration` とも衝突しない）、内部テーブルが宣言していないこと、ポリシーが要求する **RLS 補助関数**の実在（`kind: helper` + `role` + `migration`、関数名が `is_{ロール}`。境界の欄なら `actor_field` + `migration`、関数名が `actor_{欄}`）と**その逆**（`role` / `actor_field` を書いたのに要求されない宣言・`migration` だけを書いた宣言は落ちる）、**補助関数の連番が全ポリシーより前**であること。加えて**本文が実際に組み立てられること**（`reads[].scope` とロールの根拠が同じことを言っている・境界の列が実在する）を、生成と同じ写像を呼んで見る（生成器が `preconditionFailure('T7')` で報告する前提そのもの） |
| T8 | 検証器（verify。warning） | **RLS の挙動テストを生成しない理由**。`policies_migration` を宣言した表のうち、`world` を宣言から作れないもの（執行点の条件が DSL 外・数の上限が満たせない・状態依存・トリガが必須の参照列を決める・`pattern` に合う値を作れない・参照先の表が無い）を 1 件ずつ報告する。判定は生成器と同じ関数（`lib/world/rls-world-catalog.ts`）から出るので、「検査は通ったのに生成されない」が起きない |
| T9 | 検証器（verify） | **トリガが供給する列は entity_spec が「DB が決める値」と宣言する**（V17 の逆向き）。`triggers[].supplies` に載る列が `supplied_by: db` を宣言していないと、同じ列について「人が入れる値」と「DB が決める値」の 2 つの読みが同時に立つ（値の写像は `supplied_by: db` を見て「置かない列」を決めるので、宣言していない写しの列にはテストが値を書き込もうとする） |
| T10 | 検証器（verify。warning） | **`context(X)` を与えるロールは X も読めること**（下記 §中継表の RLS は重なる）。読めないなら、ポリシーの本文は出るが行は 1 つも返らない。`none` のときだけ「必ず 0 行」と言い切れるので severity は warning |
| T14 | 検証器（verify） | **1 欄ずつ受ける引数の宣言型 == 列の型**（上記 §引数名）。`kind: column` の引数の `args` が `columnType(欄)` と違うと、本文は代入で落ち（42804）、名前つき引数で呼ぶ経路は署名が見つからない（42883）。役目の引き当ては本文の組み立てと同じ写像（`collectRpcFacts`）を呼ぶ |
| T15 | 検証器（verify。error / warning） | **トリガが供給する列を、生成物だけの系で誰が埋めるか**（上記 §「入力に無いがサーバーが決める値」）。写しのトリガが写し元の隠し列・個人列の約束を切る形は error（受け入れは `copy_accept`）。写しとして導出できるのに `functions[]` に `kind: trigger` の宣言が無い / `fires` が表名まで書いているのは error、写しでも `defaults` でも `derives` でもない列は warning（本文は手書きの migration にしかない）。**`derives` を宣言した列は生成物が埋めると数える**が、宣言が通らなければ error（`from` が自表の datetime の欄でない / `offset` が閉じた語でない / `mode` が値域の外 / 導出する列が `supplied_by: db` でない / 導出する列が datetime 型でない / 同じ列を 2 つのトリガが導出する / `supplies` と `derives` の列が一致しない / `follow` の `fires` が元の列の更新を含まない / `fires` が before・insert を含む形でない・表名を書いている / 関数が `handwritten`。親の下の末尾の番号の形は `mode` が `initial` でない / integer でない / 範囲が親を直の外部キーで指さない / `locks` に親の `update` が無い / 範囲の列を埋める別のトリガが後に発火する）。判定は本文の生成と同じ 1 本（写しは `lib/world/copied-columns.ts`・導出は `lib/sql/ddl-derive-triggers.ts`） |
| T17 | 検証器（verify） | **トリガ関数の本文の出どころ**（上記 §条件を課すトリガの本文）。`kind: trigger` の関数は**本文が生成物である**か **`handwritten`（理由つきの手書き）**を宣言するかのどちらかで、どちらでもなければ error で**生成できない理由を報告する**。加えて**本文が生成物の関数に `security` を宣言していないこと**（誰の権限で実行するかの正が 2 つになる）。判定は本文の生成と同じ 1 本（`lib/sql/ddl-copy-triggers.ts` / `lib/sql/ddl-check-triggers.ts`）を呼ぶ。T15 が「供給する列を誰が埋めるか」を entity_spec の側から見るのに対し、こちらは **`functions[]` の宣言の側から**「実在すると宣言した関数の本文がどこにあるか」を見る |
| T18 | 検証器（verify） | **`composite` の関数が執行点になる規則の宣言**（上記 §書き込み RPC の形の `enforces`）。書けるのは `kind: rpc` + `shape: composite` の関数だけ・`writes` のエンティティと `by` の規則が access_spec に実在・`test_case` が**同じ表の** `test_cases` に実在・同じ規則を 2 つの宣言が名指ししない（error）。`enforces` の要素の形（`writes` / `by` / `test_case` の欠落・`when` などの余計なキー）は T0 が見る |
| T4 | 検証器（verify） | **テナント境界の見張りテストの宣言の必須**（束 ⑲-2a）。access_spec の `reads[].filters` で境界を宣言した表は、「他のテナントの行が返らない」ことを確かめる統合テストの宣言を 1 件持つ。テスト名は表名と実行者の欄から機械的に決まり（`{表名} は実行者の {欄} 以外の行を返さない`）、置き場はこの表の `test_cases` でも保証台帳（`guarantees.md`）の見張りテストでもよい。**`USING` 句は名前では縛れない**ため —— 束 ⑳-4a で `USING` 句そのものが生成物になり `policy-parity` が意味まで突き合わせるようになったが、見張りテストの宣言は**残す**。突合が言えるのは「生成物どおりのポリシーが当たっている」までで、**そのポリシーで実際に他のテナントの行が返らないか**は行を置いて実行するテストしか言えない（生成物が満たす形にするのは挙動テストの生成の束）|
| 統合テスト | `app/src/infrastructure/__tests__/schema/data-table-parity.test.ts` | 生成した期待表 ⇔ pg_catalog の**双方向**突合（テーブルの集合そのものも閉世界。**表ごとの突合は期待表のキー全部に掛かっていることを自分で確かめる**） |
| 統合テスト | `app/src/infrastructure/__tests__/schema/rpc-parity.test.ts` | 生成した本文 ⇔ `pg_get_functiondef`（生成物は丸ごと一致・手書きは断片） |
| 統合テスト | `app/src/infrastructure/__tests__/schema/rpc-signatures-parity.test.ts` | 署名表 ⇔ `pg_proc`（引数の順・型・**名前**） |
| 統合テスト | `app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts` | 生成した複合 RPC ⇔ 実 DB（署名・本文の一致・保存点の挙動） |

### 通知仕様（notification_spec）

**通知カタログが持つのは「誰に何が飛ぶか」という保証の側だけ**である（2026-08-26 開設）。
開設の理由は穴の発見である —— 通知は形式検証しにくいという理由で `state_spec` の `effects` に
ID 1 本を残して実装へ落ちており、**どの操作で誰に何が飛ぶかがどの仕様書にも無い**状態になっていた。
形式化できないことは、形式化しないまま仕様に書く（PRIN-0001）。

- **MUST**: 1 プロジェクト 1 ファイル。パスは `notifications.md`、`id` は `notification-catalog` 固定
  （導出元となる名前が無い。`design_token_spec` と同じ形）。
- **MUST**: 通知 ID は `notify_` で始まる。これは `effects[].do` のどれが通知かを機械が判別する
  唯一の手がかりであり、命名の好みではない。
- **MUST**: 1 行は `medium` / `audience` / `mention` / `trigger` / `summary` を持つ。
  **語彙（medium / audience / mention の値）はカタログ自身の `vocabulary` が宣言する** ——
  機械が分岐に使う軸（`trigger`）だけが体系側の値域である
  （doc_types.md の「検証器がコード分岐に使う区別だけが専用の型を持つ」打ち切り規則と同じ線）。
- **MUST NOT**: Webhook の URL・メンション文字列・文面（運用設定）、どの遷移で飛ぶか（`state_spec` の
  `effects` が正）、宛先の生存判定の規則（`invariant_spec` が正）を書かない。
- **MUST**: `test_cases` に実装側の突合テストの宣言を 1 つ以上持つ。

検査は 3 層に分かれる。

| 層 | 実体 | 見るもの |
|----|------|---------|
| N0 | ローダー（`legacy/spec-tools/lib/notification/`） | スキーマ適合・`id` の固定値・`notify_` 接頭辞・**行の 4 軸が宣言された語彙に閉じていること** |
| N1 | 検証器（verify） | `effects` の `notify_*` ⇔ カタログの `trigger: auto` の**双方向**閉世界、走査の `emits` ⇔ `trigger: schedule` の**双方向**閉世界 |
| N2 | 検証器（verify） | 本人を名指すメンションの `person_from` が、利用者（実行者の集約）への参照の欄で、通知を起こした集約の欄であること（行と語の対・形・宛先の語の宣言は N0） |
| ユニットテスト | `app/src/operation/__tests__/jobs/notification-catalog.test.ts` | 生成した期待表 ⇔ 登録済みハンドラの双方向突合（宛先の一致も見る） |

書き方の正は [notification-spec-writing.md](../../../process/backend/specification/standards/notification-spec-writing.md)。

### ジョブ仕様（job_spec）

**ジョブカタログが持つのは「誰も見ていないときに何が動くか」の全数**である（2026-08-26 開設）。
開設の理由は通知と同じ穴である —— 定期実行の登録はデプロイ設定（`app/vercel.json`）、ジョブ種別は
実装のハンドラ一覧、発火時刻の供給元は走査のクエリの中、と 3 か所に散っており、
**どの仕様書にも「毎日何時に何が起きるか」が書かれていない**状態になっていた。

- **MUST**: 1 プロジェクト 1 ファイル。パスは `jobs.md`、`id` は `job-catalog` 固定。
- **MUST**: 1 行は `source` / `kind` / `on_failure` / `summary` を持つ。
  **語彙（kind / on_failure の値）はカタログ自身の `vocabulary` が宣言する** ——
  機械が分岐に使う軸（`source`: `outbox` / `schedule`）だけが体系側の値域である。
- **MUST**: `source: schedule` の行は `implementation` を持ち、**`schedule`（cron 式）か
  `not_scheduled_reason`（まだ結線していない理由）のどちらか**を必ず持つ。両方欠けると
  「いつ起きるか誰も知らない」が黙って通る。
- **SHOULD**: 時刻で起きるものは `due_from`（`{entity}.{field}`）で**発火時刻の供給元**を宣言する。
  これがあると「その時刻がどこから来るか」を実装のクエリを読まずに追える。
- **MUST NOT**: どの遷移が積むか（`state_spec` の `effects` が正）、リトライの回数・バックオフの
  秒数（実装と DB の既定値が正）、`payload` の中身を書かない。
- **MUST**: `test_cases` に実装側の突合テストの宣言を 1 つ以上持つ。

検査は 3 層に分かれる。

| 層 | 実体 | 見るもの |
|----|------|---------|
| J0 | ローダー（`legacy/spec-tools/lib/job/`） | スキーマ適合・`id` の固定値・**行の 2 軸が宣言された語彙に閉じていること**・軸ごとに書けるキーの違い |
| J1 / J2 | 検証器（verify） | J1: `effects[].do` と走査の `emits` ⇔ `source: outbox` の**双方向**閉世界 / J2: `schedule` ⇔ `app/vercel.json` の登録の双方向一致と、`implementation` / `fires` / `due_from` の実在、`emits` の接地（積む先が outbox の行・`declares: [emits]` の対） |
| ユニットテスト | `app/src/operation/__tests__/jobs/job-catalog.test.ts` | 生成した期待表 ⇔ 登録済みハンドラの双方向突合（軸の取り違えも見る） |

書き方の正は [job-spec-writing.md](../../../process/backend/specification/standards/job-spec-writing.md)。

### 設定仕様（config_spec）

**設定カタログが持つのは「何を設定すればこのシステムは動くのか」の全数**である（2026-08-26 開設）。
開設の理由は通知・ジョブと同じ穴で、要る設定は実装の `process.env` 参照と `app/.env.example` の
コメントの中にしか無く、**未設定のときに止まるのか黙って縮退するのかが実装を読むまで分からない**
状態になっていた。`used_by`（何のために繋がっているか）の軸が**連携カタログを兼ねる**。

- **MUST**: 1 プロジェクト 1 ファイル。パスは `config.md`、`id` は `config-catalog` 固定。
- **MUST**: 1 行の `id` は環境変数名そのもの（SCREAMING_SNAKE）である。K1 がこの文字列で
  実装の参照と突き合わせる。
- **MUST**: 1 行は `kind` / `requirement` / `used_by` / `summary` / `absence` を持つ。
  **語彙は 3 軸ともカタログ自身の `vocabulary` が宣言する** —— K1・K2 は語で分岐しないため、
  体系側が固定する軸は 1 つも無い。
- **MUST**: `absence`（**無いとどうなるか**）を挙動で書く。要求度の言い換え（「必須です」）にしない。
- **MUST**: 雛形（`app/.env.example`）に行を置かないものは `not_in_template_reason` で理由を宣言する
  （`job_spec` の `not_scheduled_reason` と同じ免除方式）。
- **MUST NOT**: 値そのもの（鍵・URL・トークン）、どのファイルが読んでいるか（実装が正）、
  投入の手順（runbook の領分）を書かない。

検査は 2 層で、**app 側の生成物・テストを持たない**（値は実装が assert する対象ではないため、
K1 が仕様の側から実装のソースを見に行くことで輪が閉じる）。

| 層 | 実体 | 見るもの |
|----|------|---------|
| K0 | ローダー（`legacy/spec-tools/lib/config/`） | スキーマ適合・`id` の固定値・変数名の形・**行の 3 軸が宣言された語彙に閉じていること**・`absence` の必須 |
| K1 / K2 | 検証器（verify） | K1: 実装の `process.env` 参照 ⇔ カタログの**双方向**閉世界 / K2: 雛形 `app/.env.example` ⇔ カタログの双方向一致（免除の掃除漏れも落とす） |

書き方の正は [config-spec-writing.md](../../../process/backend/specification/standards/config-spec-writing.md)。

### 認証フロー仕様（auth_spec）

**認証フロー仕様が持つのは「サインインすると何が起きて、どこへ着くか」の全数**である（2026-08-26 開設）。
穴の性質は通知・ジョブ・設定と同じで、人が押すのは「ログイン」ボタン 1 つなのに、そのあとの
**招待の受諾・利用者の有効化・行き先の振り分け**はすべてシステムが勝手に行っており、
その分岐は Route Handler と `sign-in-sync.ts` の `if` の並びにしか無かった。

- **MUST**: 1 プロジェクト 1 ファイル。パスは `auth.md`、`id` は `auth-flow` 固定。
- **MUST**: **決定表**として書く（順序を持つ手順の列にしない）。行ごとに終端（`lands`）まで書き、
  同じ条件の組を持つ行を 2 つ作らない。宣言がそのまま実装との突合の駆動表になる。
- **MUST**: `subject`（主語の状態機械）の**全状態**と「利用者行が無い」場合を尽くす（H1）。
  状態を 1 つ足したら着地の宣言が要る = 暗黙の「その他」を作らせない。
- **MUST**: 着地は画面（`screen_spec` の id）と、その画面の排他表示（`variants`）のキーで宣言する。
  **画面側の出し分けと双方向に閉じる**（H2）。
- **MUST**: セッションの寿命（`sessions`: 無操作の時間切れ・絶対の寿命・理由）を宣言する。書かないと、セッションが時間で
  終わらない既定のまま出荷される。プラットフォームの設定が同じ値かは H5 が見る（本番の管理画面は未検証と毎回名指す）。
- **MUST**: 多要素認証（`mfa`）を宣言する。既定は全員に要求し、多要素認証を済ませていない人の送り先と、入場のたびに確かめる関数を
  書く（H6）。外部の IdP でログインする製品の既定は IdP に任せる `mfa: { delegated: { provider, evidence: none, reason } }`（本番の `providers` がその IdP 1 つだけの製品に限る。アプリ側の要求は厳しくしたい製品のオプトイン。根拠を確かめられる `workspace_domain` / `amr` は未対応で parse が止める）。外すなら `mfa: { exempt: 理由 }` だけ。どちらも verify が毎回「受け入れた危険」の警告で名指す。
- **MUST NOT**: 画面の中身・着地先の URL・操作の可否・OAuth の作法・環境変数を書かない
  （順に screen_spec / screen_spec の route / state_spec / 実装 / config_spec が正）。

検査は 3 層で、実装側の閉世界は**生成物 + app 側のテスト**で閉じる（通知・ジョブと同じ流儀）。

| 層 | 実体 | 見るもの |
|----|------|---------|
| H0 | ローダー（`legacy/spec-tools/lib/auth/`） | スキーマ適合・`id` の固定値・軸の値域・**条件の組の一意性** |
| H1〜H3 | 検証器（verify） | H1: 分岐の全域性と接地 / H2: 着地・関門と画面仕様の双方向 / H3: テスト突合 |
| ユニットテスト | `app/src/operation/__tests__/shared/sign-in-sync.test.ts` | 生成した決定表を**回して**実装を駆動（着地・実行する操作・在籍問い合わせの有無） |

書き方の正は [auth-spec-writing.md](../../../process/backend/specification/standards/auth-spec-writing.md)。

### 保証台帳（guarantee_spec）

**保証台帳が持つのは「設計で不可能にした事実」の目録**である（2026-09-03 開設）。「RLS を有効にしてある」「書き込みは RPC 経由だけ」は、これまで口頭や README の 1 文でしか確認できない**主張だけの安全性**だった。**保証は 1 行ごとに見張りテストの宣言を必須にする** — 見張りテストを宣言していない保証は主張しているだけであり、仕様として受理できない。

- **MUST**: 1 プロジェクト 1 ファイル。パスは `guarantees.md`、`id` は `guarantee-catalog` 固定。
- **MUST**: `status: enforced` の行は `canaries`（`test_cases` の id）を 1 つ以上持つ。`status: planned` の行は `planned_reason` を持ち、`canaries` は書けない。免除の口は無く、`planned` は消し込まれるまで `npm run verify` の Z2 が毎回 warning を出す。
- **MUST**: `enforced_by`(執行者)は `vocabulary.enforcer` に宣言された語のいずれか(このアプリの事情。`config_spec` の `used_by` と同じ線引き)。
- **MUST NOT**: 保証の中身の実装(RLS ポリシーの USING 句・GRANT 文・トリガの本体・型の定義)、見張りテストが指すテストの中身を書かない(実装・テストコードが正)。

検査は 2 層で、**app 側の生成物は無い**（執行者の実体が多様で 1 つの生成物に集約できないため。見張りテスト自体が実装との唯一の接地点である）。

| 層 | 実体 | 見るもの |
|----|------|---------|
| Z0 | ローダー（`legacy/spec-tools/lib/guarantee/`） | スキーマ適合・`id` の固定値・`enforced_by` の閉世界・`status` の値域・**`status` と `canaries` / `planned_reason` の対応**・**`canaries` ⇔ `test_cases` の双方向突合(実在 + 孤児の見張りテストの禁止)** |
| Z1 / Z2 | 検証器（verify） | Z1: テスト突合(`test_cases` ⇔ `@tc`)と `spec_ids` の実在 / Z2: `status: planned` の保証ごとに warning |

書き方の正は [guarantee-spec-writing.md](../../../process/backend/specification/standards/guarantee-spec-writing.md)。

### 外部連携仕様（external_spec）

**外部連携カタログが持つのは「外の誰と何のためにやり取りし、鍵が無いとどうなるか」の全数**である（2026-09-04 開設）。規約（ARCH-BE-0014 / ARCH-BE-0015）はアダプタの構造・冪等キー・outbox 経由のリトライを詳細に定義していたが、検査器はゼロで、実在するアダプタ（`example-idp` / Anthropic / Notion）が仕様のどこにも無宣言だった。

- **MUST**: 1 プロジェクト 1 ファイル。パスは `external.md`、`id` は `external-catalog` 固定。
- **MUST**: `direction` はこの版では `outbound` 固定である。inbound（Webhook で呼ばれる側）は実物が 1 件も無いため書けない。実物 1 件目が来た日に軸を開ける。
- **MUST**: `direction: outbound` の行は `timeout_ms`（正の整数）を持つ。実装にタイムアウトが無いアダプタは実装側へ足す（宣言と実装の食い違いを作らない）。
- **MUST**: `degrade`（`refuse` / `not_configured` / `fallback`）が挙げる `config` の `requirement` は、config カタログの側と食い違ってはならない（X2）。
- **MUST**: `service`(相手の名前)は `vocabulary.service` に宣言された語のいずれか(このアプリの事情。`config_spec` の `used_by` と同じ線引き)。**`adapter_root` を必ず持つ**（X1 の閉世界の単位）。
- **MUST NOT**: アダプタの実装（SDK 呼び出し・認証・レスポンス変換）、値そのもの（URL・トークン・API キー）を書かない（実装・config_spec が正）。

検査は 4 層で、**実装側の閉世界を `app/src/infrastructure/` 直下のディレクトリ全数で見る**のが他のカタログに無い特徴である（通知・ジョブが `effects` / Cron 登録だけを見るのに対し、外部連携は「無宣言のアダプタが紛れ込む」穴を塞ぐため、非集約ディレクトリの全数分類まで踏み込む）。

| 層 | 実体 | 見るもの |
|----|------|---------|
| X0 | ローダー（`legacy/spec-tools/lib/external/`） | スキーマ適合・`id` の固定値・`service` の閉世界・軸の値域・**条件付き必須の対応**（`effect: write` ⇒ `idempotency`・`outbound` ⇒ `timeout_ms`・`degrade` に応じた `degrade_summary` / `retry: inline` ⇒ `retry_max`） |
| X1〜X4 | 検証器（verify） | X1: アダプタの実在とファイル内の port 名 + `app/src/infrastructure/` 直下のディレクトリの全数が「集約名 / `supabase` / data_table で `internal: true` のテーブル名 / 語彙の `adapter_root`」のいずれかに分類されること + adapter_root 配下の無宣言アダプタ / X2: 設定への接地と `requirement` の食い違い / X3: `sends.fields` の entity_spec への接地 / X4: テスト突合（任意） / X7: 送る自由文の無害化（`sends.neutralize` の部品をアダプタが呼ぶ） |

書き方の正は [external-spec-writing.md](../../../process/backend/specification/standards/external-spec-writing.md)。

---

## 命名・分割方針

- **ディレクトリ名 = 集約名**（`specs/domain/{aggregate}/` と一致させる。単数形・スネークケース）。
- **ファイル名 = イベント名**。ドメインイベント ID が `loan.submit` なら `actions/loan/submit.md` に置く。**パスとイベント ID が機械的に対応する**ことを前提に、`handles` との突合を検証する（PRIN-0008）。
- **1 ファイル 1 アクション**。1 ファイルに複数のイベントを書かない。
- `id` は `{aggregate}-{event}-action`（例: `loan-submit-action`）とする。
- 実装との対応は次のとおり固定する。

| 仕様 | 実装 | テスト |
|------|------|--------|
| `specs/backend/actions/{aggregate}/{event}.md` | `app/src/app/_actions/{aggregate}/{event}.ts` | `test_cases[].implementation` が指すファイル |
| `specs/backend/queries/{aggregate}/{name}.md` | `app/src/composition/{aggregate}/queries.ts` の `{camelCase(name)}Query`（配線）+ `app/src/infrastructure/{aggregate}/queries.ts` の `select{PascalCase(name)}`（写像。ARCH-BE-0016） | `test_cases[].implementation` が指すファイル |

- 読み取りクエリは **1 クエリ 1 ファイル**とし、`queries/{aggregate}/{name}.md` に置く。ファイル名は `name` と一致させ、`id` は `query-{name をハイフン区切りにしたもの}` とする。
- **テンプレート**は `actions/template.action_spec.md` と `queries/template.query_spec.md` に置く。集約ディレクトリからは「同階層 → 上」で解決される（template_policy）。

---

## 制約・不変条件

- **MUST**: `action_spec` は `handles` にドメインイベント ID を 1 つだけ宣言する。ID は `specs/domain` の `state_spec` に実在すること。
- **MUST**: `query_spec` は `scope_used` に `access_spec` の `reads` と同じスコープを宣言する。可視性を `query_spec` 側で広げない（query-spec-writing.md の Q2）。
- **MUST**: 入力フィールドは `{entity}.{field}` の形で宣言し、制約（必須・最大長・範囲）は書かない。制約の正は `entity_spec` である（PRIN-0007）。
- **MUST**: エラーは共通規約（ARCH-BE-0013）への参照とし、固有のものだけを追記する。
- **MUST**: `test_cases[]` を持ち、各ケースが参照する仕様 ID（ドメインイベント ID・不変条件 ID）と、覆う意味クラス（`covers`）を宣言する。必要な意味クラスはドメイン仕様から導かれ、網羅を検証器が要求する（action-spec-writing.md の A7）。
- **MUST NOT**: 状態・遷移・ロール・ガード・不変条件・フィールド制約を `specs/backend` に再定義しない（ARCH-SP-0002）。
- **MUST NOT**: 実装のコードそのもの（クエリ本文・関数本体）を仕様に貼らない。
- **SHOULD**: 仕様が厚くなってきたら、それはドメイン仕様に書くべき内容が漏れ出しているサインとして扱う。まず `specs/domain` を見直す。

---

## 配置ルールと方針

### 根は製品が宣言する（この文書のパスは相対である）

この文書に出てくる `docs/specs/backend/…` / `supabase/migrations/…` / `app/src/…` は、**題材の製品がいま宣言している値を当てはめた表記**である。木そのものの位置はリポジトリ直下の `product.md`（`doc_type: product_roots`）が宣言し、検査器・生成器はその宣言だけを読む（散文の正は [placement_policy](../../../meta/standards/placement_policy.md)「根は製品が宣言する」）。

- **`ddl_migration` / `policies_migration` / `surface_migration` / `grants_migration` などの宣言に書くのはファイル名だけ**である。置き場（`roots.migrations`）は宣言が持つので、仕様側にディレクトリを書かない。
- **テーブル仕様が名指す生成物の置き場も同じ**。期待表（`data-table-expectations.ts` ほか）は `roots.generated` の中に出る。
- 実装の木を持たない製品（仕様だけ・別スタック）では、実装との突合を行う検査（T3 の `@tc` 突合・J2 の Cron 登録・X1 のアダプタ）が**エラーにならず飛ぶ**。

### 3 種の仕様の役割分担

| 置き場所（`roots.specs` からの相対） | 何を書くか |
|---------|-----------|
| `domain/` | 状態・権限・不変条件・フィールド制約（機械検証の対象・生成物の源） |
| `backend/` | 境界の仕様（何を受けるか・何を返すか・どのテストで守るか） |
| `frontend/` | 画面・ビュー仕様（後続フェーズ） |

### フロントエンド仕様との関係

同じドメインイベント ID を、画面側は `emits`、Server Action 側は `handles` で宣言する。両者が揃うことで「UI 到達経路のないイベント」「未定義イベントを処理するアクション」を機械検出できる（ARCH-SP-0002）。frontend の仕様が未整備の間は、`emits` 側の検証は保留となる。

---

## 補足（移行・トレードオフ）

- 参考にした体系の backend 仕様は `api/`（エンドポイント単位）を中心に構成されていた。本構成では **HTTP エンドポイントではなくドメインイベントを単位**にする。Next.js では境界が Server Action であり、URL は仕様の単位として意味を持たないためである。
- `data/` `rls/` `external/` を先に骨格だけ作らないのは、空のディレクトリと「未整備」の表が増えると、体系のどこが実体でどこが予定かの判別コストが上がるためである（PRIN-0011）。
