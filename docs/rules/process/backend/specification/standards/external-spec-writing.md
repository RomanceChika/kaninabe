---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0008, PRIN-0009, ARCH-BE-0014, ARCH-BE-0015]
decisions: [ADR-0004, ADR-0007]
---

# 外部連携カタログ（external_spec）の書き方

`docs/specs/backend/external.md` に置く `external_spec`（外部連携カタログ）の YAML スキーマと、検証器が実行するチェック（X0〜X8）を定義する。

## 目的

- **「外の誰と何のためにやり取りしているか」を一級市民の宣言にする。** ARCH-BE-0014 / ARCH-BE-0015 は構造（IF とアダプタの分離・冪等キー・outbox 経由のリトライ）を詳細に定義していたが、検査器はゼロで、実在するアダプタ（Discord / Anthropic / Notion）が仕様のどこにも無宣言だった。
- **「鍵が無ければ縮退する」を主張でなく検査対象にする。** 縮退の宣言（`degrade`）と、それが接地する設定カタログの `requirement` が食い違っていないかを機械で見る(X2)。
- **抽象の型を先に仕組みとして作り、アダプタはそれに当てはめるだけにする。** 語彙(`service`)以外の軸(`direction` / `effect` / `degrade` / `retry` / `signature`)は体系側の値域であり、新しい連携を足すたびに新しい語を発明させない。

## 参照するもの

- **配置**: [ARCH-SP-BE-0001](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) §外部連携仕様
- **構造の正**: [ARCH-BE-0014](../../../../architecture/system/backend/ARCH-BE-0014-external-integration.md)（IF / アダプタ / Webhook の構造）・[ARCH-BE-0015](../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)（リトライ・dead letter）
- **テンプレート**: `docs/specs/backend/template.external_spec.md`

## ルール・基準

### 器の選び方（なぜ新しい機構を作らないのか）

連携は「相手(`service`)」「向き(`direction`)」「効果(`effect`)」「縮退(`degrade`)」「再試行(`retry`)」を持つ行の集合であり、これは `notification_spec` / `job_spec` / `config_spec` / `auth_spec` / `guarantee_spec` と同じ「**1 プロジェクト 1 カタログ・行の集合・実装と双方向に閉じる**」の 6 例目である。新しい DSL は作らない。

### 語彙をどちらが持つか（フレームワークとアプリの線）

| 軸 | 語彙の持ち主 | 理由 |
|---|---|---|
| `direction`（`outbound` / `inbound`） | **体系** | 向きは 2 つしかなく、受け取る側は条件付き必須の軸(下記)を丸ごと切り替える |
| `effect`（`read` / `write`） | **体系** | `effect: write` ⇒ `idempotency` / `idempotency_source` 必須、という X0 の分岐に使う |
| `degrade`（`refuse` / `not_configured` / `fallback`） | **体系** | X0 の条件付き必須の分岐と、X2 の `requirement` との対応表に使う |
| `retry`（`none` / `job` / `inline`） | **体系** | `retry: inline` ⇒ `retry_max` 必須、という X0 の分岐に使う |
| `signature`（`hmac_sha256` / `provider_sdk` / `none`） | **体系** | **受信口の生成が方式で分岐する**（体系側の関数を呼ぶか、アダプタの検証を呼ぶか）。アプリごとに新しい検証方式を発明させない |
| `on_conflict`（`retry` / `ack`） | **体系** | HTTP の返し方は 2 つしかない（再送させるか、閉じるか）。どちらを選ぶかはアプリの事情だが、**選択肢そのものは体系が閉じる** |
| `service`（相手の名前） | **カタログ自身の `vocabulary`** | 「example_idp か anthropic か」はこのアプリの事情であり、`config_spec` の `used_by` と同じ理由で体系に持たせない |

**`service` は他のカタログの語彙と形が違う。** `id` / `label` に加えて **`adapter_root`（アダプタが住むディレクトリ）を必ず持つ**。X1 がこのディレクトリを閉世界の分類の単位に使うためである。

**SDK を使う `service` は、そのパッケージを `sdk_packages` に宣言する**(点検 9 回目 B9-4)。綴りは包みの名前(`ai`)か、スコープの全部(`@ai-sdk/*`)だけで、下位パス(`ai/rsc`)も同じ包みとして当たる。**宣言した SDK を値として import できるのは、その `adapter_root` の下と `client_ui` に名指したファイルだけ**である —— 集約のディレクトリ(`infrastructure/{集約}/`)・Composition・ページから SDK を直に呼ぶと、有料の連携の宣言した口(`runPaidEntry`)・認可・枠・`safeFetch`・無害化を全部通らずに外へ出る。基盤の層(`infrastructure`)は、宣言した SDK・土台の SDK(置き場の配置の `sdkPackages`。接続層の `@supabase/*`)・枠の基盤のパッケージ(配置の `foundationPackages`。next / react / react-dom / zod / server-only)以外の外部パッケージを値で引けない(**宣言の無い SDK は赤**)。型だけの import(`import type`)は実行時に何も呼ばないので対象外。同じ表を X1 の (d)(仕様から直に)と ESLint の層の境界(生成物 `sdk-homes.json`)が見る。

| 欄 | 必須 | 何を書くか |
|---|---|---|
| `sdk_packages` | — | この service の SDK のパッケージの綴りの並び(省略は「SDK を使わない」)。`*` 1 つ・`**`・途中の `*` は書けない |
| `client_ui` | — | SDK の **UI 部品**を値で引いてよい、自サイトの口とだけ話すクライアントの部品(`- file / packages`)。`file` はリポジトリルート相対、`packages` は `sdk_packages` に当たる包みの名前(グロブは書けない)。鍵を持たないブラウザで動く部品だけを名指す(鍵を使う提供元の SDK は名指さない) |

### 受け取る側（`direction: inbound`）の軸

**軸を開けた条件は「どれもが実装と突き合わされること」だった**（束 ⑲-2b）。宣言だけを増やさないという線（ARCH-SP-BE-0001 §保証台帳と同じ理由で「主張だけの宣言」を作らない）は変えていない。開いたのは、どれも接地先を持てるようになったからである。

| 軸 | 何を宣言するか | 何に接地するか（X5） |
|---|---|---|
| `signature` | 受信口が検証する方式（`hmac_sha256` / `provider_sdk` / `none`） | `none` 以外の行は **`degrade: refuse` でなければならない**（鍵が無い環境では口を閉じる — PRIN-0009） |
| `signature_key` | 署名の鍵として使う設定の id。**`signature != none` の行だけが持ち、必須** | `config` に並んでいる id のいずれかであること（**位置ではなく名前で指す** — 下記） |
| `signature_reason` | なぜ署名を検証しなくてよいか（散文 1 行）。**`signature: none` の行だけが持ち、必須** | 接地先は無い。理由の無い免除をこの体系は持たない（`degrade_summary` と同型） |
| `event_id_table` | 外部イベント ID の一意制約を持つ表（`data_table` の id） | その data_table が実在し、**単一列の一意索引をちょうど 1 本**持つこと（冪等の実体はこの制約であり、生成される RPC がその列に外部イベント ID を載せる）。その表の作成 RPC（`insert_{entity}`）が実在し、引数が `p_id` / `p_values` / `p_actor_id` だけであること |
| `emits` | 外部イベント → ドメインイベント（`{machine}.{event}`） | 実在する遷移で、`by` に system のロールを含み、**`from` がちょうど 1 つ**でガード式を持たないこと（下記）。その遷移 RPC の引数が宣言だけで決まること |
| `migration` | 受信の RPC を書き出す migration のファイル名（`{14 桁}_inbound_{連携 id}.sql`） | 全連携で一意であること（2 本の受信が同じファイルを取り合わない。保存点の `saves[].migration` と同じ理由） |
| `on_conflict` | 遷移が拒否されたときに相手へ返す形（`retry` = 5xx で再送させる / `ack` = 2xx で閉じる） | 接地先は無い。**既定を持たない**（下記） |
| `max_body_bytes` | 受け取る本文の大きさの上限（バイト。**任意**） | 接地先は無い。省略すると小さめの既定（65536）で、1 以上 16777216 以下の整数（X0）。**緩めるのは宣言だけ**（下記） |

- **`emits` は第 3 の発火元である。** screen_spec の `emits`（人が押す）/ `actions/README.md` の `scans`（時刻で起きる）と並び、「外から届いて起きる」をここが宣言する。**A10（走査の網羅）はこの宣言をもって充足とみなす** — 受信で起きるイベントに `unscanned` の免除を書かせない（束 ⑱ の実測では、意味の合わない器を借りるしかなかった）。
- **`action_spec` は要らない。** `by` が system だけのイベントは Server Action の入口を持たない（[action-spec-writing.md](./action-spec-writing.md) §system が起こすイベント / `docs/specs/backend/actions/README.md`）。受信口は実行計画ではなく**生成された受信の RPC**を 1 回呼び出すので、計画の出どころも要らない。
- **記録と遷移は 1 トランザクションである。** 行を 1 本足すと、Route Handler と配線に加えて **`api.inbound_{連携}`**（記録の作成 RPC と `emits` の遷移 RPC を同じ `begin … end` の中で呼ぶ plpgsql）が `migration` に書き出される。ADR-0011 §4「保存点の内側は全部か無しか」を受信に当てたものであり、複合 RPC とまったく同じ形である。
  - **なぜ分けられないか。** 記録だけが成功して遷移が落ちると、相手が再送しても記録済みの外部イベント ID が「反映済み」と判定されて no-op になり、**その通知は永久に失われる**。同じトランザクションなら遷移の失敗で記録も戻るので、再送がそのまま再試行になる。
- **鍵は位置ではなく名前で指す（`signature_key`）。** `config` の先頭を暗黙の鍵にすると、鍵以外の設定（API キー等）を 1 つ足した瞬間に検証が**常に落ちて 401** になり、しかも verify は緑のままである。
- **`from` がちょうど 1 つでガードが無い遷移しか起こせない。** 受信口は**判断材料を読まない**（人のセッションが無く、読んでから起こすまでの間に相手の次の通知が入りうる）。したがって「その行がどの状態なら起こしてよいか」は宣言された `from` そのものであり、それが遷移 RPC の `p_expected_state` になる。複数の状態から起こせる必要があるなら状態ごとにイベントを分ける。ガード式（読んだ事実・時刻・実行者を要求する式）を持つイベントは受信から起こせない — 宣言された条件を誰も評価しないまま書き込みが通る形にしない。
- **署名は受信したバイト列のまま検証する。** 段取りの実体（`@kaninabe/runtime/inbound`）は本文を文字列に復号せずに読み、`hmac_sha256` はそのバイト列に対して計算する。復号してから計算すると、相手が生のバイト列に署名していて本文に不正な UTF-8 や BOM があるとき、正しい署名が永久に合わない。本文の解釈（UTF-8 として読む。先頭の BOM は落ち、不正なバイトは置き換わる）は**検証が通ったあと**で、アダプタの `read` が受けるのはその文字列である。`provider_sdk` のアダプタの `verifySignature` にもバイト列が渡る。
- **本文は上限までしか読まない（`max_body_bytes`）。** 受信口は人のセッションを持たず誰でも叩けるので、上限の無い口は大きな本文を全部メモリに載せる口になる。宣言された長さ（`Content-Length`）が上限を超えれば読まずに、宣言が無い・偽る相手には読みながら数えて上限を超えた時点で、**署名を検証する前に 413** で閉じる。既定は小さめ（65536）で、相手の最大の本文がそれを超えるときだけ宣言で緩める。
- **`signature: none` は宣言の上でだけ開く。** 検証しない口は、理由（`signature_reason`）を書いた行の配線だけが `verify: () => true` と理由のコメントを字面に持つ。実行時の署名検証の関数（`verifyInboundSignature`）は `hmac_sha256` しか受け付けない —— 方式を取り違えた呼び出しが黙って開く入口を、実行時の側に置かない。受信の行の `signature` は型で必須であり（`InboundIntegrationDecl`）、生成器は方式を網羅の `switch` で書き分ける（既定の枝を持たない）。
- **`on_conflict` に既定は無い。** 相手に再送させるか 2xx で閉じるかは**相手の再送の契約**でしか決まらず、体系が推測すると「入金通知を黙って捨てる」か「相手の再送が永久に止まらない」のどちらかを引き当てる。どちらの場合もトランザクションは丸ごと戻っている（外部イベント ID も記録されていない）。
- **受信口は生成物である。** 行を 1 本足すと `app/src/app/api/inbound/{連携}/route.ts`（Route Handler）と `app/src/composition/inbound/{連携}.ts`（配線）と `supabase/migrations/{migration}`（受信の RPC）が生成される。段取り（署名を検証 → 受信の RPC を 1 回 → 結果を応答に写す）の実体は `@kaninabe/runtime/inbound`（`framework/runtime/src/inbound/run-inbound.ts`） に 1 回だけ書かれており、生成されるのは宣言から決まる値の配線だけである。口の名前が動詞を持たない理由は [route-handlers.md](../../system/standards/conventions/route-handlers.md) §受信 Webhook の口にある。
- **手で書くのはアダプタだけである。** `port` が宣言する IF（`InboundReceiver`）が持つのは「署名が載るヘッダ名」と「本文の読み取り」の 2 つで、どちらも**相手の本文の形**に依存する事実である。**アダプタは 1 行も書き込まない** — 書き込みは宣言された RPC だけを通る。読み取りが返すのは外部イベント ID と `{ record: {…}, target_id: "…" }` の本文であり、`record` は記録先の表に入れる欄（外部イベント ID の列は RPC が埋める）、`target_id` は遷移の対象の id である。
- **1 行 = 1 種類のドメインイベント = 1 URL である。** 相手が 1 つの URL に複数種のイベントを送る場合は、`external_spec` の行を種類ごとに分け、相手の管理画面には種類ごとの URL（`api/inbound/{連携 id}`）を登録する。アダプタが本文を見て起こすイベントを選ぶ形にはしない —— 判断が受信口の側に戻ってきてしまう（ARCH-BE-0014 の MUST NOT）。
- **`timeout_ms` は書けない。** こちらから呼びに行かない口に待ち時間の上限は無い（X0 が逆向きにも見る — 送信の行に受け取る側の軸を書くのもエラーである）。

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識(否定・線引き)のみ。
- 1 プロジェクト 1 ファイル(`docs/specs/backend/external.md`)で、`id` は `external-catalog` 固定である。

### 1 行が宣言すること

**`integrations`（連携 1 件）**

| キー | 必須 | 意味 |
|---|:---:|---|
| `id` | ○ | 連携 ID(スネークケース・一意) |
| `service` | ○ | 相手の名前。`vocabulary.service` に宣言された語のいずれか |
| `direction` | ○ | 向き。`outbound`(こちらから呼ぶ)/ `inbound`(向こうから届く。受け取る側の 3 軸が必須になる) |
| `effect` | ○ | `read`(外部の状態を変えない)/ `write`(変える。`idempotency` が必須になる) |
| `port` | ○ | 業務側の IF 名(型・インターフェース名)。X1 がアダプタのファイル内に実在を見る |
| `adapter` | ○ | アダプタの実装ファイル(リポジトリルート相対)。X1 が実在を見る |
| `config` | ○ | 接地する config カタログの id(1 つ以上)。X2 が実在と `requirement` の食い違いを見る |
| `degrade` | ○ | 鍵が無いときの挙動。`refuse`(口を閉じる)/ `not_configured`(縮退。失敗にしない)/ `fallback`(既定の挙動で応える) |
| `degrade_summary` | △ | 縮退の中身(散文 1 行)。**`degrade: not_configured \| fallback` の行だけが持ち、必須** |
| `timeout_ms` | △ | タイムアウト(ミリ秒)。**`direction: outbound` の行だけが持ち、必須(正の整数)** |
| `signature` | △ | 受信口が検証する方式。**`direction: inbound` の行だけが持ち、必須**（`hmac_sha256` / `provider_sdk` / `none`） |
| `signature_key` | △ | 署名の鍵として使う config の id。**`signature != none` の行だけが持ち、必須**（位置ではなく名前で指す） |
| `signature_reason` | △ | なぜ署名を検証しなくてよいか(散文 1 行)。**`signature: none` の行だけが持ち、必須** |
| `event_id_table` | △ | 外部イベント ID の一意制約を持つ表(`data_table` の id)。**`direction: inbound` の行だけが持ち、必須** |
| `emits` | △ | 外部イベント → ドメインイベント(`{machine}.{event}`)。**`direction: inbound` の行だけが持ち、必須** |
| `migration` | △ | 受信の RPC を書き出す migration のファイル名(`{14 桁}_inbound_{連携 id}.sql`)。**`direction: inbound` の行だけが持ち、必須** |
| `on_conflict` | △ | 遷移が拒否されたときの返し方(`retry` / `ack`)。**`direction: inbound` の行だけが持ち、必須**(既定は無い) |
| `max_body_bytes` | △ | 受け取る本文の上限(バイト。1 以上 16777216 以下の整数)。**`direction: inbound` の行だけが持ち、任意**(省略すると 65536。緩めるのは宣言だけ) |
| `endpoints` | △ | この連携を使う**手書きの HTTP の入口**（Route Handler）の URL のパス（`/api/...`）の並び。**`direction: outbound` の行だけが持ち、任意**（書くなら 1 本以上）。下の「手書きの口（`endpoints`）」 |
| `spend` | △ | 呼び出しごとにお金や枠を使う連携の宣言(いまの値は `paid` だけ)。**`endpoints` を持つ送信の連携だけが書ける**。`spend: paid` の行は `abuse`・`meter`・`authz` が必須。下の「有料の口（`spend` と `abuse`）」 |
| `meter` | △ | 枠を消費する RPC の名前（data_table の `kind: rpc` の関数。スネークケース）。**`spend: paid` の行が持ち、必須**（R5-7 が実在を・X8 が本文を見る） |
| `authz` | △ | 有料の口を使える役: `{ kind: role, role: {役の ID} }`。役は**実行者の行の条件（`claim`）を持つグローバルロール**に限る（未ログインにも立つ役・内部実行の役・文脈依存の役・`claim` を持たない役は書けない）。**`kind: public` は有料の口に書けない**。**`spend: paid` の行が持ち、必須**（R5-7） |
| `abuse` | △ | 有料の口の濫用の歯止めの**宣言**: `max_body_bytes`（`endpoints` の URL ごとの本文の上限、バイト）と `quota`（回数の枠: `source`（config の id）か `max`（1 以上の整数）のどちらか 1 つ + `per` + `key`: `actor` / `global`）。**`spend: paid` の行が持ち、`endpoints` の全部に上限と枠が必須**（R5-7） |
| `retry` | ○ | 失敗時の再試行。`none` / `job`(outbox のリトライに委ねる。job_spec の `on_failure` と接続)/ `inline`(その場で有限回) |
| `retry_max` | △ | 再試行の上限回数。**`retry: inline` の行だけが持ち、必須(正の整数)** |
| `idempotency` | △ | 二重反映の防ぎ方の説明(散文 1 行)。**`effect: write` の行だけが持ち、必須** |
| `idempotency_source` | △ | 二重反映を**何が**防ぐか(`external_key` / `local_ledger` / `none`)。**`effect: write` の行だけが持ち、必須**。X6 が値ごとに接地先を見る(下の「台帳は何を防ぐか」) |
| `idempotency_reason` | △ | なぜ防がなくてよいか(散文 1 行)。**`idempotency_source: none` の行だけが持ち、必須**。再送のある経路で `none` を選ぶなら、**同じ知らせが二度届きうる**ことをここに書く(ハンドブックの外部連携の章が一覧に出す) |
| `sends` | ○ | 外へ出す情報。`fields`(`entity.field` の参照。X3 が entity_spec への実在を見る)と `text`(散文)の少なくとも一方。**`direction: outbound` の行は無害化の宣言も必須**(`sends.neutralize` か `sends.neutralize_none`。下の「送る自由文の無害化」) |
| `summary` | ○ | 何をする連携かを 1 行で |

#### 手書きの口（`endpoints`）

送信の連携のなかには、**ブラウザから叩かれ、サーバーの側でその連携を呼ぶ手書きの口**を持つものがある（AI の応答の逐次配信など。[route-handlers.md](../../system/standards/conventions/route-handlers.md) の例外）。実装の木の HTTP の入口は、ジョブの `endpoint`・受信口・認証の `callback`・**この `endpoints`** のどれかに宣言されていなければならない（J2 の続き = 閉世界）ので、口を持つ連携はその URL をここに並べる。

```yaml
- id: anthropic_chat
  direction: outbound
  # …
  endpoints: [/api/ai/tutorial, /api/ai/hold-draft]
```

- **URL は中立に書く**（ジョブの `endpoint` と同じ。置き場は配置が決める）。`//`・`?`・`#`・`.` / `..` のセグメントは書けず、J2 が `app/` の有無に依らず指す。
- **1 本の口は 1 つの連携にだけ書く。** 同じ URL を 2 つの連携の `endpoints` に書くと、J2 が衝突として指す（1 本の Route Handler は 1 つの連携のもの。複数の連携を呼ぶ口は、持ち主を 1 つに決めて、そこにだけ書く）。
- **受信の連携は持てない。** 受信口は生成物で、URL が `/api/inbound/{連携 ID}` に決まっている（二重の宣言にしない。X0 が落とす）。
- **実装の木に Route Handler が実在すること**と、**ほかの宣言と同じ URL を取らないこと**は J2 が見る。宣言した口が連携の IF を本当に使っているか（`endpoints` と呼び出しの接続）は見ていない。

#### 有料の口（`spend` と `abuse` と `meter` と `authz`）

`endpoints` の口が**呼び出しごとに費用のかかる連携**（AI のモデル呼び出しなど）を呼ぶなら、`spend: paid` を書き、**口ごとの入力の上限・回数の枠・枠を消費する RPC・口を使える役を宣言**する。1 回の入力が巨大でも、回数に枠が無くても、誰でも叩けても、費用が際限なく膨らむからである（ASVS V15.2.2・V2.4.1。重い機能の一覧と上限の文書は V2.1.3・V15.1.3）。

```yaml
- id: anthropic_chat
  direction: outbound
  endpoints: [/api/ai/tutorial, /api/ai/hold-draft]
  spend: paid
  meter: consume_ai_quota                 # 枠を消費する RPC（data_table の kind: rpc の関数）
  authz: { kind: role, role: patron }     # 口を使える役（claim を持つグローバルロール。public は書けない）
  abuse:
    max_body_bytes:                       # endpoints の全部に必須（口ごとの本文の上限。バイト）
      /api/ai/tutorial: 262144
      /api/ai/hold-draft: 131072
    quota: { source: AI_CHAT_LIMIT_PER_DAY, per: 1 day, key: actor }   # source = config カタログの id、または max: n
```

- **宣言の検査（R5-7）**。`spend: paid` で `endpoints` のある連携に、(a) `abuse.max_body_bytes` が `endpoints` の全部にあり `endpoints` に無い口が無いこと、(b) `abuse.quota` があり `per` が 366 日以内・`max` が 1 以上の整数であること、(c) `quota.source` が config カタログに実在すること（config カタログを採っていない製品は `max: n`）、(d) `meter` が data_table の `kind: rpc` の関数に実在すること、(e) `authz` があり `kind: role` で、役が役の台帳に実在する**実行者の行の条件（`claim`）を持つグローバルロール**であること（`public`・未ログインにも立つ役・内部実行の役・文脈依存の役・`claim` を持たない役は error）。値の大きさは製品が決める。
- **執行は共通の入口が持ち、X8 が口との結びつきを見る。** 定数を import しているだけでは執行にならない（本文を先に読み切ってから上限を見る口も、課金してから枠を数える口も、定数は import している）。順序 —— 認可 → 本文の上限（読む前に `Content-Length`・読みながら数える）→ 形の検査 → **枠の消費** → 有料の処理 —— は `@kaninabe/runtime/http/paid-entry` の `runPaidEntry` が 1 か所で持ち、口は `return runPaidEntry(request, { maxBodyBytes: PAID_ENTRIES['{URL}'].maxBodyBytes, authorize: …(PAID_ENTRIES['{URL}'].role), parse, consume, handler })` の形で呼ぶ。上限と役は宣言から**生成される定数表 `PAID_ENTRIES`**（`app/src/domain/generated/paid-entries.ts`）から読む（同じ数を口の側へ書き写さない）。
- **X8 が見るもの**（構文木と migration の本文。実行して確かめるのは統合テスト）: (a) 有料の連携のアダプタに import の閉包で届く Route Handler がその連携の `endpoints` に宣言されていること、(b) 宣言された口の全メソッドが `runPaidEntry`（`@kaninabe/runtime/http/paid-entry` から値として import したもの。別名可・隠した名前や別モジュールの同名は不可）を最後の文で返し、`maxBodyBytes` と `authorize` が `PAID_ENTRIES` のこの口の値を使い、`consume` が `meter` の RPC を呼ぶモジュールの束縛を使い、**多要素認証の段に生成した束 `runtimeBindings` と口の役 `PAID_ENTRIES[…].role` を渡し（多要素認証を要求する製品は `resolveMfa` に認証の組み立ての根の `resolveSessionMfa` も）**、**拒否の行の出力口 `logger` に認証の組み立ての根の `securityLogger()` を渡し**（拒否をホストの外への転送に載せる）、オプションに同じ名前の重複（`bindings` と `'bindings'` など）が無く、**有料の連携に届く束縛を `handler` の中でしか使わない**こと、(d) **Route Handler でない入口**（画面のツリーの下の Server Action・ページ・レイアウト・部品と、実装の木の根の直下のリクエスト前段 `proxy` / `middleware`。テストを除く）が有料の連携のアダプタに import の閉包で届けば error（有料の連携へ行く道は、`endpoints` に宣言して `runPaidEntry` で包んだ Route Handler の 1 本だけ。画面が要るのが鍵の有無などの状態だけなら、アダプタに届かないモジュールに分けてそこから読む）、(c) `meter` の RPC の本文（最後に定義した migration）が `authz.role` の述語（役の `claim` と、含意の先で行の条件を持つ役の `claim`）を**実行者の行を読んで**持ち、最初の書き込みより前に `raise exception` し、消費が 1 文の原子的な更新（`insert … on conflict … do update … where` か `update … set … where … returning`）であること。口の関門（`authorize`）を忘れても RPC が役を持たない実行者を落とす二重の守りの、片方の欠落は赤になる。
- **取り込みなど有料の連携を呼ばない処理は、有料の連携を配線するモジュールと別のモジュールに置く。** X8 の閉包は import のモジュール単位なので、同じモジュールに置くと取り込みの起動口まで「有料の連携に届く口」に見える。
- **R5-8**: `spend` / `abuse` / `meter` / `authz` を受信の連携・`endpoints` の無い行に書く、または `abuse` / `meter` / `authz` を `spend: paid` なしで書くのは、効く先の無い宣言として error。`spend: paid` を `endpoints` の無い連携に要求することはしない（すべての口に要求する形にはしない）。
- **ハンドブック**: 外部連携の章の「有料の資源を使う口」の節に、口・本文の上限・回数の枠・枠の数の出どころ・口を使える役・枠を消費する RPC が並ぶ（V15.1.3 の重い機能の洗い出しは、可視性の章の「未ログインに開いた書き込み」と合わせて 2 種で閉じる）。

#### 台帳は何を防ぐか(`local_ledger` と `none` の線引き)

**`local_ledger` は「こちら側の台帳が二重反映を防いでいる」という宣言である。** 接地条件は台帳の実在であり、inbound は `event_id_table`(外部イベント ID の一意制約)、outbound は**アダプタが送信済みの鍵を引く台帳**である。

**outbox の job 行はこの台帳ではない。** ジョブの取り出しが原子的であることが防ぐのは「同じ行を 2 つのワーカーが同時に掴むこと」までで、**送ったあとに応答が返らず「失敗」と記録された配信は、リトライでもう一度送られる**。相手に冪等キーを渡す口が無ければ、その再送はそのまま二重反映になる。`retry: job` を接地条件にすると、**二重反映を生む当の仕組みがあること**が「防いでいる」証拠になってしまう(束 ㉑ の独立レビュー 4-B。それまでの X6 はこの向きで恒真に近かった)。

**防げないなら `none` + 理由を書く。** 値域の語が実態より強い保証を示すのは、この体系が潰してきた「書いてあることが嘘でも緑」そのものである。`retry` があって `idempotency_source: none` の行は、ハンドブックの外部連携の章に**「同じ知らせが二度届きうる経路」**として理由つきで並ぶ —— 受け入れた残余を黙らせない。

### ここに書かないもの(正が割れる)

- **アダプタの実装**(SDK 呼び出し・認証・レスポンス変換・エラー変換)— `app/src/infrastructure/{service}/` の実装(TypeScript)が正。ここが宣言するのは「何を・どこへ・どう振る舞うか」という契約の側だけである。
- **値そのもの**(URL・トークン・API キー)— config_spec の領分。ここは `config` に id を挙げるだけで値は書かない(config_spec が「値はここに書かない」のと同じ線)。
- **相手の本文の形**(JSON のキー・外部イベント ID がどこに入っているか)— アダプタ(`port` の実装)が知っている唯一の事実である。カタログが宣言するのは「どの鍵で検証し・どの表で冪等にし・どのドメインイベントが起きるか」の 3 つだけで、本文の読み方は書かない(値そのものを書かないのと同じ線)。

### 検証(X 群)

| ID | 何を見るか | 実行場所 |
|---|---|---|
| **X0** | スキーマ適合。`id` の固定値・連携 ID の形式と重複・`service` が宣言語彙に閉じること・`direction` / `effect` / `degrade` / `retry` / `signature` の値域・**`effect: write` ⇒ `idempotency` / `idempotency_source` 必須・`idempotency_source: none` ⇒ `idempotency_reason` 必須**・**`direction: outbound` ⇒ `timeout_ms` 必須(正の整数)**・**`endpoints` は `direction: outbound` の行だけが持てる(書くなら 1 本以上のリスト)**・**`spend` は値域 `paid`・`abuse` は `max_body_bytes`（口 → 1 以上 16777216 以下の整数）と `quota`（`source` か `max` のちょうど 1 つ・`per` は `{n} {minute\|hour\|day}`・`key` は `actor` / `global`）の形だけを読む（揃っているかは R5-7、書いてよい行かは R5-8）**・**`direction: inbound` ⇒ `signature` / `event_id_table` / `emits` / `migration` / `on_conflict` が必須(`max_body_bytes` は任意で、書くなら 1 以上 16777216 以下の整数)、`signature != none` なら `signature_key`・`signature: none` なら `signature_reason`(逆向きも禁止)、`timeout_ms` は禁止**(逆に `outbound` の行に受け取る側の軸を書くのも禁止)・**`degrade: not_configured \| fallback` ⇒ `degrade_summary` 必須**・**`retry: inline` ⇒ `retry_max` 必須(正の整数)** | ローダー(`lib/model/external/loader.ts` + `lib/model/external/parse-external.ts`) |
| **X1** | アダプタの閉世界。(a) `adapter` の実在とファイル内の `port` 名の実在 (b) `app/src/infrastructure/` 直下のディレクトリの全数が「集約名 / **仕組みの土台**(`supabase` / `facts` / `usecase`) / data_table で `internal: true` のテーブル名 / 語彙の `adapter_root`」のいずれかに分類されること(どれでもない = 無宣言)。**仕組みの土台**とは、集約にも外部サービスにも属さない汎用の口である —— Supabase クライアントそのもの(`supabase`)、表と列を引数で受けて 1 行読む口(`facts`)、保存点の複合 RPC を呼び出す口(`usecase`)。何を読むか・何を実行するかは仕様から生成された実行計画が渡すので、集約ごとのディレクトリと同じ線では分類できない (c) 各 `adapter_root` 配下の実装ファイルがいずれかの連携の `adapter` に宣言されていること(宣言の無いアダプタ = エラー) (d) **SDK の置き場の閉世界**: 製品の木(テスト・`__tests__`・fake を除く)の全ファイルの値の import(静的 import・`export … from`・副作用 import・動的 `import()`・`require()`)を AST で読み、宣言した SDK(`sdk_packages` / 土台の `sdkPackages`)をその置き場か `client_ui`(名指した包みだけ)の外で引けば赤、基盤の層のファイルが宣言の無い外部パッケージを引けば赤、指定子が字句でない動的 import / `require` は赤(fail-closed)。`client_ui` のファイルの実在も見る(点検 9 回目 B9-4)。**4 段はどれも `app/` が実在する環境でだけ走る**(仕様と実装の突合であり、S7・A11 と同じ扱い。`app/` を持たないリポジトリ —— 仕様だけのサンプル・`create-app` 直後の新規プロジェクト —— でも「まず外の誰と繋がるか」を宣言できる) | `lib/external/verifiers/x1-adapter-closed-world.ts`・`lib/external/sdk-placement.ts` |
| **X2** | 設定への接地。`config[]` の実在と、`degrade` と config カタログの `requirement` の食い違い(`refuse` は `required`、`not_configured` / `fallback` は `optional_degrades` か `production_only`) | `lib/external/verifiers/x2-config-grounding.ts` |
| **X3** | 送る情報の接地。`sends.fields[]` の `entity.field` が entity_spec に実在すること | `lib/external/verifiers/x3-sends-grounding.ts` |
| **X4** | テスト突合(`test_cases` ⇔ `@tc`。書けば)と `spec_ids` の実在(ドメイン ID + `external-catalog`) | `lib/external/verifiers/x4-test-trace.ts` |
| **X5** | 受け取る側の軸の接地(`direction: inbound` の行だけ)。(a) 記録と遷移が**1 本の RPC に接地する**こと(`event_id_table` が実在し単一列の一意索引をちょうど 1 本持つ・記録の作成 RPC と `emits` の遷移 RPC が実在し引数が宣言だけで決まる・`from` がちょうど 1 つでガードが無い) (b) `emits` が `by` にシステムのロールを含むこと (c) 署名を検証する行(`signature != none`)が `degrade: refuse` であること (d) `signature_key` が `config` に並んでいること (e) `migration` が全連携で一意であること | `lib/external/verifiers/x5-inbound-grounding.ts` + `lib/inbound/inbound-plan.ts`(生成器と共有の接地) |
| **X6** | **実行時の約束の接地**(`app/` が実在する環境でだけ走る)。(a) `timeout_ms` を持つ行のアダプタが生成物 `app/src/domain/generated/external-expectations.ts` から自分の行の待ち時間を読んでいること、かつ**生の数値で待ち時間を書いていない**こと(`AbortSignal.timeout(5000)` は error) (b) `retry: inline` の行のアダプタが同じ生成物から `retryMax` を読んでいること (c) `idempotency_source` の値ごとに接地先が実在すること —— `external_key` はアダプタが冪等キーを受け渡していること、`local_ledger` は**台帳が実在する**こと —— inbound なら `event_id_table`(一意制約)の宣言、outbound ならアダプタが送信済みの台帳(`ledger`)を引いていること、`none` は何も要求しない(理由の必須は X0) | `lib/external/verifiers/x6-runtime-grounding.ts` + `lib/generate/render/code-external-expectations.ts`(生成物) |
| **X7** | **外へ送る自由文の無害化の突合**(ASVS V1.3.3。アダプタの突合は実装の木が実在する環境でだけ走る)。(a) `sends.neutralize` に宣言した部品を、アダプタが `@kaninabe/runtime/neutralize` の**値の import に束縛された呼び出し**で呼んでいること(`discord_mentions` = `neutralizeDiscordMentions` と `allowedDiscordMentionsOf` の両方 / `control_chars` = `stripControlChars` / `length:N` = `clampLength(…, N)` の第 2 引数が宣言と同じ数のリテラル)。同名のローカル関数・隠した名前・別モジュール・型だけの import・呼ばずに参照だけは数えない (b) `neutralize_none` なのに `sends.fields` が利用者が書ける文字列の欄(access_spec の `writes[].fields` か action_spec の `input` に載る `string` / `text`)を送っていない (c) `sends.fields` が `bearer` の欄(持っていれば効く値)を送っていない | `lib/external/verifiers/x7-neutralize.ts` + `lib/external/neutralize-scan.ts`(呼び出しの走査) |
| **X8** | **有料の口の執行**(ASVS V2.4.1・V15.2.2。`app/` が実在する環境でだけ走る)。(a) `spend: paid` の連携のアダプタに import の閉包で届く Route Handler が、その連携の `endpoints` に宣言されていること (b) 宣言された口の全メソッドが共通の入口 `runPaidEntry` で包まれ、上限と役を生成した定数表 `PAID_ENTRIES` から読み、`consume` が `meter` の RPC を呼ぶモジュールの束縛を使い、多要素認証の段に生成した束と口の役を渡し（要求する製品は `resolveMfa` も）、`logger` に `securityLogger()` を渡し、オプションの名前に重複が無く、有料の連携に届く束縛を `handler` の中でしか使わないこと (c) `meter` の RPC の本文が `authz.role` の述語を実行者の行から確かめて最初の書き込みより前に落とし、消費が 1 文の原子的な更新であること (e) **口の本体は出どころの確認と `return runPaidEntry(…)` だけ**(許可表。入口の前の文は error)・**口と Route Handler でない入口の import の閉包に、指定子が字句でない動的 import / `require` が無い**こと(閉包が欠けたら error。点検 6 回目 B6-1) | `lib/external/verifiers/x8-paid-entry.ts`(走査: `paid-entry-scan.ts`・`meter-body.ts`) |

### 送る自由文の無害化(`sends.neutralize`。X7)

外へ送る自由文(Discord のメッセージ本文・AI のプロンプトなど)には、利用者の入力が混ざる。受け手の文脈(メンション・指示・制御列)へ値を渡す前に無害化することを、連携の行が**宣言し**、アダプタが**呼ぶ**。`direction: outbound` の行は次のどちらか 1 通りを必ず書く(受信の行には書けない)。

```yaml
sends:
  fields: [patron.example_idp_user_id, loan_companion.display_name]
  text: ...
  neutralize: [discord_mentions, control_chars]      # 通す部品の宣言(語は下の表。重複しない)
  # neutralize_none: 送るのは数字の ID だけで、利用者が書いた自由文は送らない   ← 無害化する自由文を送らない連携だけ(理由は空にできない)
```

| 語 | 実行時パッケージ `@kaninabe/runtime/neutralize` の部品 | 効き |
|---|---|---|
| `discord_mentions` | `neutralizeDiscordMentions(text)` と `allowedDiscordMentionsOf(prefix)`(**両方**) | 本文の `@everyone` / `@here` / `<@…>` の綴りを壊し、`allowed_mentions` で呼べる相手をアダプタ自身が先頭に置いたメンションだけに絞る |
| `control_chars` | `stripControlChars(text)` | 改行・タブ・復帰以外の制御文字(C0 / DEL / C1)を除く |
| `length:N` | `clampLength(text, N)` | 長さを N 以下に収める(サロゲートペアを割らない)。N は 1〜1,000,000 |

**部品の名前を `@kaninabe/runtime/neutralize` から import して呼ぶ**。呼ぶ順は制御文字を除いてからメンションを壊す(制御文字を挟んだ細工で壊した綴りが復活しない)。`length:N` の N は宣言と同じ数のリテラルを書く(X7 が突き合わせる)。`neutralize_none` は、利用者が書ける文字列の欄を `sends.fields` に挙げる連携には書けず、`bearer` の欄を送る連携は無害化の宣言によらず通らない。

**なぜ `timeout_ms` / `retry_max` / `idempotency` を生成物に落とすのか。** この 3 軸は X6 が入るまで**パーサが形を見るだけで、以後どこも読んでいなかった**（検査の漏れ探し 2026-09-12 §1 の実測: `timeout_ms: 5000 → 1` に書き換えても `verify` はエラー 0 のまま。`idempotency` の自由文は「outbox の job id を Webhook の冪等キーにする」と宣言していたが、実装は冪等キーを 1 度も相手へ渡していなかった）。宣言できるのに誰も見ない軸は、**書いてあることが嘘でも緑**になる。値は生成物 1 つに住所を持たせ（写し間違いという状態を消す）、散文だった冪等は**源の値域**にして値ごとに接地先を 1 つに決める —— これが「主張だけの宣言を置かない」（X5 の inbound を開けたときと同じ）条件である。

**なぜ検査群の記号が `X` なのか。** `A`(仕様⇔テストのトレース)/ `S`(画面)/ `H`(認証)/ `G`(視覚層)/ `K`(設定)/ `T`(テーブル)/ `N`(通知)/ `J`(ジョブ)/ `M`(文書整合)/ `U`(UX)/ `V`(ドメイン)/ `Z`(保証)が使用済みで、`X` は「eXternal」の頭文字である(`E` は enforcement-matrix.md が既に使っている)。

**`test_cases` はこのカタログだけ任意である。** `guarantee_spec` 等は `test_cases` が 1 件以上必須だが、外部連携は実物のアダプタに先行して宣言することもあるため(このアプリでは実際、既存の 5 アダプタに専用のユニットテストが 1 本も無い状態から開設した)、`test_cases: []` や省略も正しい宣言として受理する。書いた場合だけ X4 が突合する。

**X1(b) が見るのは「無宣言の外部連携」であって「未知のディレクトリ」全般ではない。** `app/src/infrastructure/` 直下には、外部連携でも集約でもない置き場が 2 種類ある —— `supabase`(Supabase クライアント実装そのもの。体系側の固定の除外)と、**data_table で `internal: true` のテーブル名**(`jobs` / `tutorial_docs` / `ai_usage` / `domain_events` … ドメイン仕様に現れない内部テーブルを読み書きするだけのリポジトリ)である。後者を特定のテーブル名で体系側にハードコードしないのは、内部テーブルが増えるたびに X1 の実装を書き換えずに済むようにするためである（裁定 2026-09-04）。それでも `supabase` 以外の非集約な置き場が新たに増える場合は、この表と X1 の実装を同時に見直す。

### 検証方法

- `npm run verify`(X0〜X4 が走る)
- `npm run generate`(連携のマトリクスとハンドブックの章、可視性の章の節を再生成)
- `cd app && npm run test`(タイムアウトを足したアダプタのユニットテスト)

## 関連ドキュメント

- [guarantee-spec-writing.md](./guarantee-spec-writing.md) — 同型の先行実物(1 プロジェクト 1 カタログ・語彙は仕様が宣言する側の軸を 1 つだけ持つ)
- [config-spec-writing.md](./config-spec-writing.md) — X2 が接地する `requirement` の語彙の正
- [ARCH-BE-0014](../../../../architecture/system/backend/ARCH-BE-0014-external-integration.md) — アダプタ・IF・Webhook の構造そのものの正
