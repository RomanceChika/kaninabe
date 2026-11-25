---
doc_type: architecture
scope: backend
id: ARCH-BE-0016
norms: [PRIN-0001, PRIN-0003, PRIN-0005, PRIN-0007, PRIN-0008, PRIN-0009, PRIN-0010, PRIN-0011, ARCH-BE-0001, ARCH-SP-BE-0001]
---

# ARCH-BE-0016 — 読み取り経路の構造（RSC + クエリ関数）

## 目的

読み取りを 1 本の経路に固定し、**「誰にどの行が見えるか」の執行点を DB（RLS）に置く**。アプリ側のコードを「宣言された絞り込みの写像」に痩せさせ、可視性がコードの `if` に散らばる状態を構造的に起こせなくする。書き込み側の ARCH-BE-0013 と対になる。

## 概要

- 読み取りは **RSC → `src/composition/{aggregate}/queries.ts` のクエリ関数 → `src/infrastructure/{aggregate}/queries.ts` の写像 → JWT 付きクライアント（RLS 有効経路）**の 1 本に固定する。Server Action を作らない。
- **operation 層を経由しない。** 読み取りには業務判断（状態遷移・権限の判定）が無く、通す層が判断を持たないなら層を足す理由も無い。
- 層の役割は書き込みと同じままにする。**`composition` は配線（Composition Root）、DB へのアクセスは `infrastructure`**。読み取りのために層の定義を曲げない。
- 原則は **「絞り込み = 宣言（`query_spec`）、可視性 = 二層、実装は写像」**。クエリ関数にも写像実装にも、**実装が考えた**行の選別を書かない。
- `service_role`（RLS バイパス）での読み取りは、**operation / ワーカーの内部で行う「書き込み前の読み取り」に限る**（既存どおり）。画面に返す読み取りには使わない。
- **可視性は二層である。**
  - **上界（安全）**: RLS。「見えてはいけない行は何をしても返らない」を保証する。読み取りに対しては第一にして唯一の**防衛線**である（書き込みに対しては第二防衛線）。
  - **スコープ条件（正確さ）**: `query_spec` の `scope_used` / `via` が宣言した集合。**`via` のロールの `binding` から決定的に導かれる絞り込み**を写像に書いて実現する。
  - スコープ条件が要るのは、上界が**複数のポリシーの和**だからである。1 人の利用者が「自分が借りた貸出の行」と「自分が司書の蔵書の行」の両方を読める以上、`via: loan_owner` と宣言したクエリを司書が呼ぶと上界は宣言より広い。スコープ条件が無ければ宣言と返る集合が食い違う（query-spec-writing.md の健全性 M2）。
  - **スコープ条件は実装の判断ではない。** 書いてよいのは `binding` を実行者で具体化した写しだけで、それ以外の条件は `filters`（UX）か `reads` の書き間違いである。実行者はクエリに使うクライアントと同じセッションから導く（別々の主体を指せないようにするため）。

## スコープ

- **対象**: 画面に返す読み取りの経路・層の割り当て・使うクライアント、可視性と絞り込みの執行点の分担、この経路が守らないもの、読み取りに求めるテストの種類。
- **対象外**:
  - 書き込み（Server Action・operation・outbox）の構造（→ ARCH-BE-0013 / ARCH-BE-0015）
  - 層構成と依存方向そのもの（→ ARCH-BE-0001）
  - `query_spec` の書き方・検査 Q0〜Q7（→ process/backend/specification/standards/query-spec-writing.md）と置き場所（→ ARCH-SP-BE-0001）
  - クエリ関数のコードの書き方・命名・禁止事項・クライアントの作り方（→ process/backend/system/standards/conventions/queries.md）
  - RLS ポリシーの内容そのもの（正は `access_spec` の `reads`。期待ポリシー名の突合方式は ARCH-SP-BE-0001）

---

## 構成

| 要素 | 責務 | 置き場所 |
|------|------|---------|
| リクエスト前段（Next.js の `proxy` 規約） | **セッション更新の唯一の場所**。期限切れのアクセストークンを 1 リクエストにつき 1 回更新し、新しい cookie をレスポンスに載せる。認可の判定はしない。**その前にブラウザ側の守り**（要求ごとの nonce の CSP・状態を変える要求の出どころの確認。仕組みの既定で、値はアプリの枠の後段の宣言が持つ）を通す。保護範囲は静的な資材と Route Handler を除く全部の文書の口。**ブラウザは更新に加わらない**（セッションの cookie は `HttpOnly` でスクリプトから読めず、ブラウザの認証基盤のクライアントも無い。cookie の名前と属性はセッションの adapter `@kaninabe/adapter-supabase-session` が持つ） | `app/src/proxy.ts`（**生成物**。セッション更新の実体は `app/src/infrastructure/supabase/proxy-session.ts` → adapter の `refreshSession`） |
| RSC（サーバーコンポーネント） | 表示に必要なクエリ関数を呼び、結果を描画に渡す | `app/src/app/**/page.tsx` 等 |
| クエリ関数（配線） | 実行時入力を検査し、実行者のセッションから **JWT 付きクライアント**を組み立て、写像に渡して `Result` で返す | `app/src/composition/{aggregate}/queries.ts` の `{camelCase(name)}Query` |
| 写像（DB アクセス） | `query_spec` の `projection` / `filters` / `sort` / `paging` を、そのまま問い合わせに写す | `app/src/infrastructure/{aggregate}/queries.ts` の `select{PascalCase(name)}` |
| RLS ポリシー | 上界（「これ以上は返らない」）の執行 | `supabase/migrations/*.sql` |
| `binding` 由来の絞り込み | スコープ条件（「宣言どおりの集合が返る」）の実現。写像に書く仕様からの写し | `app/src/infrastructure/{aggregate}/queries.ts` |
| `query_spec` | 経路の宣言（`for` / `via` / `scope_used` / `filters` / `sort` / `paging` / `projection`） | `docs/specs/backend/queries/{aggregate}/{name}.md` |
| 統合テスト | 実 RLS を通した読み取りの確認。読み取りの保証はここにしか無い | `app/src/composition/__tests__/{aggregate}/{name}.test.ts` |

- **層の割り当ては書き込みと同じ**である。`composition` は具象（クライアント）を作って配線するだけ、DB への問い合わせは `infrastructure` にだけ置く。読み取りだから特別、という例外を作らない（ARCH-BE-0001）。
- **写像の名前は仕様から導く。** `query_spec` の `name` が `item_list` なら、配線は `itemListQuery`、写像は `selectItemList` になる。仕様のパスから実装 2 つの位置と名前が一意に決まる（PRIN-0008）。

---

## フロー

### 画面の読み取り（RLS 有効経路）

1. **RSC がクエリ関数を呼ぶ。** 引数は `query_spec` の `params` に宣言された実行時入力だけ。実行者（actor）は渡さない。
2. **クエリ関数が実行時入力を検査し、セッションから JWT 付きクライアントを組み立てる。** 未ログインでもクライアントは作り、「読めない」は DB に判定させる（アプリ側で早期リターンしない）。未ログインの結末は「0 件」ではなく DB からの権限エラーであり、それがそのまま表面化する（下表「守らないもの」）。
3. **写像が `query_spec` の宣言を問い合わせに写す。** `projection` → 列、`filters` → WHERE、`sort` → ORDER BY、`paging` → LIMIT / カーソル。宣言に無い列を足さない。
4. **DB が RLS を適用して行を絞る（上界）。** 見えてはいけない行はここで落ちる。写像が足すのは `binding` 由来のスコープ条件だけで、それ以外の選別には関与しない。
5. **クエリ関数が `Result` で返す。** 想定外の失敗（接続断・DB エラー）は throw のまま Next.js のエラー境界に委ねる。

### 書き込みの内部で読む場合（RLS バイパス経路）

- operation / ワーカーが遷移判断や整合のために読む場合は、従来どおり `service_role` クライアントを使う（`app/src/composition/{aggregate}/{event}.ts` の配線）。
- これは**画面に返さない読み取り**であり、`access_spec` の対象外・`query_spec` の対象外である（query-spec-writing.md「どの読み取りを query_spec にするか」）。
- 判定は状態機械エンジンへの照会で行うため、`service_role` で読んでも権限の穴にはならない（ARCH-BE-0013）。

---

## 制約・不変条件

- **MUST**: 画面に返す読み取りは、`query_spec` を持ち、`composition/{aggregate}/queries.ts` の `{camelCase(name)}Query`（配線）と `infrastructure/{aggregate}/queries.ts` の `select{PascalCase(name)}`（写像）として実装する。仕様の無い読み取り経路を作らない（PRIN-0001 / PRIN-0008）。
- **MUST**: 画面に返す読み取りは JWT 付きクライアント（RLS 有効）で行う。
- **MUST**: 問い合わせる列は `query_spec` の `projection`（`includes[].projection` を含む）と一致させる。
- **MUST**: 読み取りの保証は統合テスト（実 RLS）で置く。`query_spec` は `type: integration` のテストケースを 1 つ以上持つ（Q6）。
- **MUST**: 読み取りポリシーは `for select` で書く。`for all` は読み取りを許しながら期待ポリシー表との突合を素通りするため使わない（突合テストが検出する。ARCH-SP-BE-0001）。
- **MUST NOT**: 画面に返す読み取りで `service_role` クライアントを使う。RLS をバイパスした瞬間、可視性を守っているものが 1 つも無くなる（PRIN-0009 / PRIN-0010）。
- **MUST**: `scope_used` が関係スコープ（`own` / `context(...)`）のクエリの写像には、`via` のロールの `binding` から導いた絞り込み（スコープ条件）を書く。これは仕様からの決定的な写しであり、実装の判断ではない。
- **MUST**: スコープ条件を持つクエリには、**上界が広い実行者で呼ぶ統合テスト**（例: その蔵書の司書が `via: loan_owner` のクエリを呼ぶ）を置く。他人として呼ぶテストは上界しか確かめられない。
- **MUST NOT**: クエリ関数・写像に**仕様から導けない**行の選別ロジックを書く。「このロールなら他人の行を除く」という `if` を実装が考えて書けば、可視性をアプリ側に持ち帰る行為であり、書いた時点で二重管理になる。
- **MUST NOT**: 宣言に無い列を取る（`select('*')` を含む）。
- **MUST NOT**: 読み取りを Server Action にする。読み取りのために operation 関数を新設する。`composition` に問い合わせを書く。
- **MUST NOT**: クエリ関数・写像から書き込む。読み取り経路は副作用を持たない。
- **SHOULD**: 1 クエリ 1 往復。RSC が同じデータを何度も引くくらいなら、`includes` を宣言して 1 本にまとめる。

### この経路が守るもの・守らないもの

誤解すると危険なので明示する。

| 守るもの | 執行者 |
|---------|-------|
| 見えてはいけない**行**が返らないこと（上界） | RLS（DB） |
| 宣言したとおりの集合が返ること（スコープ条件） | `binding` 由来の絞り込み（写像）＋ 上界が広い実行者で呼ぶ統合テスト |
| 宣言と RLS ポリシーの**過不足**が無いこと | 期待ポリシー表 ⇔ `pg_policies` の突合（統合テスト。ARCH-SP-BE-0001） |
| ポリシーの中身（`USING` 句）が仕様どおりであること | RLS 挙動の統合テスト（ロールごとに可視行を確かめるもの） |
| **隠すべき列が返らないこと**（`fields_hidden`。API スキーマ方式） | PostgREST が実際に見るのは仕様から生成した `api` スキーマのビューだけで（`public` は `surface` から外れている。`supabase/config.toml` の Exposed schemas）、`fields_hidden` の列は `CASE WHEN can_see_{table}_{column}(row) THEN 値 ELSE NULL END` で出す。**anon キーと自分の JWT で直接叩いても列は増えない** — `select=*` は `api` の当該ビューの列(= entity_spec の全列)を返すだけで、隠し列は見せてよい人以外には元から NULL である。述語の実在は `api-parity.test.ts`、実効性（見せてよい人には値・それ以外は NULL）は列の見張りテスト `guarantees/hidden-columns-masked.test.ts`（保証 `hidden_columns_masked`）が見る |
| **`public` そのものが `surface` に無いこと** | `api-surface-only.test.ts`（保証 `api_surface_only`）— anon / 一般利用者 JWT / service_role のどれで `public` を明示的に指しても PGRST106（schema not exposed）になる |

| 守らないもの | 実際に起きること | どうするか |
|-------------|----------------|-----------|
| **`query_spec` の `for`（実行ロール）** | 宣言と違うロールが呼んでも 403 にはならず、**RLS が効いた結果として 0 件**が返るだけである。`for` は「誰のための経路か」の宣言であって、実行時の関門ではない | ロールによって結末を変えたいなら、それは可視性（`reads`）の設計として `access_spec` に書く |
| **セッションの有効性の判定とログイン導線** | 未ログイン・JWT の期限切れは、**エラーとして表面化する**（黙って空にはならない）。`anon` にはテーブルの `SELECT` 権限自体を与えていないため、PostgREST が権限エラーを返し、写像がそのまま throw する | **これは望ましい性質である**（サイレントな空画面より、エラーが見えるほうが事故に気づける）。クエリ層はエラーをそのまま返し、握って 0 件に化けさせない。セッションの有無の判定とログインへの誘導は**画面側の責務**とし、RSC は `composition/auth.ts` の `requireSession()` を呼ぶ（判定の写しを画面ごとに書かない）。なお**トークンの期限切れそのもの**は前段（`proxy.ts`）の更新で減る — 更新は cookie を書ける場所でしかできず、RSC は cookie を書けないため |
| **ポリシーの中身と `insert` / `update` / `delete` のポリシー** | 突合が見るのは読み取りポリシーの**名前**だけである | 意味は RLS 挙動テスト、書き込み側は第一防衛線（operation の判定）と書き込みの統合テストが持つ |

- 上の「隠すべき列が返らないこと」は API スキーマ方式（`docs/design/security-surface-proposal.md` §2）が実装するまで「守らないもの」側にあった。当時は `fields_hidden` が `loan.note` の 1 件だけで、`reads: none` と重なって実害が無いだけの状態だったが、`fields_hidden` はその後 18 列まで育っており、`reads` が緩めば実害が出る宣言のずれだった。列単位の `SELECT GRANT` ではなく**仕様から生成したビュー**（マスク述語は access_spec の `fields_hidden` から機械的に導出）を選んだのは、突合の正を `app/src/domain/generated/api-expectations.ts` の 1 か所に置き、GRANT 文の手書きを列ごとに増やさないためである（ADR 相当の決定は `docs/design/security-surface-proposal.md`）。

---

## 実装配置

- path: `app/src/composition/{aggregate}/queries.ts` — 1 集約 1 ファイル。`query_spec` の `name` ごとに 1 つの export（`{camelCase(name)}Query`）。配線と入力検査だけを置く。
- path: `app/src/infrastructure/{aggregate}/queries.ts` — 同じく 1 集約 1 ファイル。`select{PascalCase(name)}` が問い合わせの写像を持つ。
- path: `app/src/composition/__tests__/{aggregate}/{name}.test.ts` — 実 RLS を通す統合テスト。
- path: `app/src/infrastructure/__tests__/rls/policy-parity.test.ts` — 期待ポリシー表（`app/src/domain/generated/rls-expectations.ts`）と `pg_policies` の突合。
- pattern: 仕様は `docs/specs/backend/queries/{aggregate}/{name}.md`。**仕様のパスと `name` から実装 2 つの位置と export 名が一意に決まる**（ARCH-SP-BE-0001）。

---

## 境界・レイヤーに関する追加情報

### 置いてよいもの / 置いてはいけないもの

- OK: `composition/{aggregate}/queries.ts` に「実行時入力の検査」「JWT 付きクライアントの生成」「写像の呼び出し」「`Result` への詰め替え」
- OK: `infrastructure/{aggregate}/queries.ts` に「`query_spec` の宣言どおりの問い合わせ」「行の詰め替え（列名 → ドメインの語彙）」
- NG: どちらにも「行の選別の `if`」「ロールによる分岐」「集計・整形以上の計算」「書き込み」
- NG: `composition` に問い合わせそのもの（`from(...).select(...)`）を書く。**`composition` は配線だけ・DB は `infrastructure` だけ**という ARCH-BE-0001 の割り当ては読み取りでも変えない
- NG: `operation` / `domain` に読み取り経路のコードを置く（読み取りは業務判断を持たないため、通す層が無い）

### 依存方向

- 依存してよい: クエリ関数（`composition`） → `infrastructure` / `domain`
- 依存してはいけない: クエリ関数 → `operation`（読み取りは operation を経由しない）/ `app` / `components`

依存方向の表そのものは ARCH-BE-0001 が正であり、読み取り経路はその中の `composition` と `infrastructure` の行にそのまま収まる（新しい依存方向は増えない）。

### 入出力（境界面）

- **入力**: `query_spec` の `params` に宣言された実行時入力のみ。**実行者（actor）は入力に含めない** — サーバー側のセッションから導く（PRIN-0009）。呼び出し側が「自分の ID」を渡して絞る設計は採らない。それは `reads` の `scope: own` と RLS が守る領分である。
- **出力**: `Result`。成功値は `returns` に従い、`many` なら配列、`one` なら 1 件または「無し」。失敗は `params` の検査失敗だけであり、ドメイン上の拒否（3 分類）は読み取りには現れない。

### RLS の位置づけ（書き込みとの違い）

- **RLS は読み取りの防衛線である。** 読み取りではアプリ側に判定が無い（置かないと決めた）ため、**RLS が第一にして唯一の防衛線**になる。
- **書き込みには RLS の出番が無い。** ユーザー（`anon` / `authenticated`）は INSERT / UPDATE / DELETE の権限を 1 つも持たず、**書き込みのユーザー直接経路は存在しない**（元の製品の migration で撤去した）。全書き込みは `security definer` の RPC を通り、可否はその手前でエンジン（`canFire` / `canCreate` / `canWrite` / `canDelete`）が判断する。
- この形にしたことで、**「全書き込みが監査ログに残る」が例外なしに真になる**（`domain_events` への追記は書き込み RPC の中にしかない）。かつては `writes` を列 GRANT + 状態条件つきポリシーとして DB にも写していたが、それは第二防衛線ではなく**アプリを迂回する第二の書き込み口**であり、①追記の無い書き込みを許し、②列 GRANT がポリシー単位に分けられないため `writes` の状態差（「提出後は連絡事項だけ」）を表現できず許可列の和集合が開く、という 2 つの穴を持っていた（Phase C-6 第 3 波で撤去）。
- **DB 側の防衛線が無くなったわけではない。** 不変条件（CHECK・ユニーク・トリガー）と値域、`security definer` 関数の実行権限（`service_role` のみ）は変わらず DB が執行する（enforcement-matrix §9）。

---

## 取得方針

- **単純 SELECT を既定とする。** `filters` / `sort` / `paging` は `query_spec` の宣言をそのまま写す。
- **併読（`includes`）は 1 往復で取る。** 関連の埋め込み取得を使い、併読先も `projection` に宣言された列だけを取る。併読先にも RLS が効く。
- **集計は v1 では対象外。** `count` / `sum` を返す読み取りは `query_spec` に宣言する形が決まっていない。必要になった時点で仕様側（`query_spec`）を先に拡張し、この節を改訂する。実例が出る前に形だけ用意しない（PRIN-0011）。
- **キャッシュは持たない。** RSC の既定の挙動に委ね、独自のキャッシュ層を挟まない。挟むと「誰に見せてよいか」がキャッシュキーの設計問題に化けるため、必要になったら ADR を書いてから入れる。

---

## 実装のきまり・コード例

- クエリ関数の実装規約（配置・命名・3 手順・禁止事項・クライアントの作り方）: [process/backend/system/standards/conventions/queries.md](../../../process/backend/system/standards/conventions/queries.md)
- 実例: `docs/specs/` のデモ製品と `legacy/spec-tools/__tests__/fixtures/samples/`（`loan_own_list` 相当の仕様・写像・配線・統合テストの 4 点セット）
- `query_spec` の書き方: [process/backend/specification/standards/query-spec-writing.md](../../../process/backend/specification/standards/query-spec-writing.md)
- 統合テストの書き方: [process/backend/system/standards/conventions/testing/integration.md](../../../process/backend/system/standards/conventions/testing/integration.md)
- 書き込み側の対になる構造: [ARCH-BE-0013 — Server Action の構造](./ARCH-BE-0013-server-action-structure.md)
