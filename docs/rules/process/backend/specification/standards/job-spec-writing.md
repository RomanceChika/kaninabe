---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0008, ARCH-SP-BE-0001, ARCH-BE-0015]
decisions: [ADR-0003, ADR-0010]
---

# ジョブ仕様（job_spec）の書き方

`docs/specs/backend/jobs.md` に置く `job_spec`（ジョブカタログ）の YAML スキーマと、検証器が実行するチェック（J0〜J7）を定義する。

## 目的

- **暗黙の挙動を無くす。** 「誰も見ていないときに何が動くか」は、これまで 3 か所に散っていた — 定期実行の登録はデプロイ設定（`app/vercel.json`）、ジョブ種別は実装のハンドラ一覧、発火時刻の供給元は走査のクエリの中。**どの仕様書にも「毎日 3 時に何が起きるか」が書かれていない**状態だった。カタログはその穴を塞ぐ（PRIN-0001：**形式化できないことは、形式化しないまま仕様に書く**）。
- ジョブは**止まっても誰も気づかない**種類の壊れ方をする。全数を 1 か所に集めて「これが 1 日止まったら誰が困るか」を人間がレビューできる形にする（PRIN-0006）。
- 仕様・Cron の登録・実装のハンドラを**双方向の閉世界**で結び、片方だけ増えた状態を機械が落とす（PRIN-0008）。

## 参照するもの

- **配置**: [ARCH-SP-BE-0001](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) §ジョブ仕様
- **積む元の正**: [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) §state_spec の `effects`
- **実行の機構**: [ARCH-BE-0015](../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)（outbox・リトライ・dead letter）
- **テンプレート**: `docs/specs/backend/template.job_spec.md`

## ルール・基準

### 語彙をどちらが持つか（フレームワークとアプリの線）

**機械が分岐に使う軸だけをフレームワークが固定し、それ以外の語彙は仕様が宣言する。**

| 軸 | 語彙の持ち主 | 理由 |
|---|---|---|
| `source`（`outbox` / `schedule` / `manual`） | **フレームワーク固定** | J1〜J4 がこの値で分岐する（`outbox` だけが `effects` と閉じ、`schedule` だけが Cron と閉じる。`manual` は**人が押して積む**もので、`effects` に現れてはならない） |
| `source: outbox` の発火元 | state_spec の `effects[].do` **と** access_spec の `writes[].effects` **と** 時刻で起きる走査の `emits` | 状態遷移（`effects`）と、状態遷移を持たない編集(update-fields。`writes[].effects`)と、時刻で起きる走査(`source: schedule` の行の `emits`)の 3 つが同じ `outbox` に積む。1 つ目は対応するドメインイベントを持ち、2 つ目は持たず(発火元は `{entity}.update`)、3 つ目は走査のジョブ ID が発火元である。J1 はどれも「積む元」として双方向に見る(積む元が 1 つも無い outbox 行は死んだ宣言) |
| `kind` / `on_failure` | **カタログの `vocabulary`** | 「通知」「走査」「指数バックオフで 5 回」はこのアプリの事情であり、体系の一部ではない |
| `kind` の語の **`in_transaction: true`** | **カタログの `vocabulary.kind`**(宣言の口は体系が持つ) | 「その種類の効果は書き込みと同じトランザクションで実現される(キューに積まれない)」は機械が分岐に使う軸(連鎖を辿る入口の判定・操作の実行計画)だが、**どの語がそれに当たるかはこのアプリの事情**なので、語の側に宣言させて体系は語を比べない(W1)。行ごとに書かないのは、1 行の書き忘れが黙って別の種類として扱われるのを避けるため(語を選べば宣言が付いてくる) |
| `kind` の語の **`declares: [anonymizes]` / `declares: [emits]`** | **カタログの `vocabulary.kind`**(宣言の口と書けるキーは体系が持つ) | 「その語の行は `anonymizes`(匿名化する効果。outbox の行)/ `emits`(走査が積む通知。schedule の行)を必ず持つ」は、機械が読む軸が**キーの有無**であるものについて、語を選んだのにキーを書き忘れた行が黙って別の種類として通るのを塞ぐ宣言である。**どの語がそれに当たるかはこのアプリの事情**なので、`in_transaction` と同じく語の側に宣言させる(書けるキーの値域だけが体系固定。今は `anonymizes` と `emits`。キーごとに持てる軸が決まっていて、他の軸の行がその語を選べば J0 が落とす) |
| `on_failure` の語の **`means`** | **カタログの `vocabulary.on_failure`**(宣言の口と値域は体系が持つ) | 「その語が、失敗したらどうなるか」は、**語(綴り)は製品の事情**だが、機械が行と突き合わせる軸である。語の側に `means`(値域は体系が固定: `never_queued` / `retry_to_dead` / `next_run` / `pending_decision`)を宣言させ、J6 が行の種類と対で見る。宣言が無いと `on_failure` は誰にも読まれない欄になり、2 本の行の値を入れ替えても全部緑のままになる(監査の M06d)。`on_failure` の語は必ず宣言し、`kind` の語に書けば J0 が落とす |

これは doc_types.md の「**検証器がコード分岐に使う区別だけが専用の型を持つ**」打ち切り規則と同じ線であり、`notification_spec` の `trigger` と同じ形である。

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識 2 種（否定・線引き）のみで、各 1〜3 行。
- カタログは **1 プロジェクト 1 ファイル**（`docs/specs/backend/jobs.md`）で、`id` は `job-catalog` 固定である（導出元となる名前が無いため）。
- ジョブ ID はスネークケースとする。`source: outbox` の ID は `state_spec` の `effects[].do` と**同じ文字列**である。

### 1 行が宣言すること

| キー | `outbox` | `manual` | `schedule` | 意味 |
|---|:---:|:---:|:---:|---|
| `id` | ○ | ○ | ○ | ジョブ ID |
| `source` | ○ | ○ | ○ | 発火の出どころ（値域） |
| `kind` | ○ | ○ | ○ | 種別。`vocabulary.kind` の語 |
| `on_failure` | ○ | ○ | ○ | 失敗時の挙動。`vocabulary.on_failure` の語(語の `means` が行の種類と合うこと。J6) |
| `summary` | ○ | ○ | ○ | 何をするかを 1 行で |
| `schedule` | ✗ | ✗ | △ | cron 式。Cron に登録済みならこちら |
| `not_scheduled_reason` | ✗ | ✗ | △ | まだ Cron に結線していない理由。`schedule` と**排他で必ずどちらか** |
| `endpoint` | ✗ | ✗ | ○※ | Cron が叩く口（`/api/...`）。`schedule` を持つなら必須。**1 ジョブ 1 本**(同じ URL を 2 つのジョブで共有しない。大文字小文字だけ違う URL も同じ置き場として衝突、`//`・`?`・`#` を含む書き方は URL のパスではないので J2 が error) |
| `implementation` | ✗ | ✗ | ○ | 走査・ワーカー本体のモジュール（リポジトリルート相対） |
| `fires` | ✗ | ✗ | 任意 | この走査が実行するドメインイベント ID |
| `due_from` | ✗ | ✗ | 任意 | **発火時刻の供給元**（`{entity}.{field}`） |
| `emits` | ✗ | ✗ | 任意 | **この走査が outbox に積む通知の ID の一覧**（1 件以上）。`kind` の語が `declares: [emits]` を持つなら必須。下の「走査が積む通知（`emits`）」を参照 |
| `scheduler` | ✗ | ✗ | ○ | **鳴る場所**（`host` / `database` の値域。旧い `runner` キーと値は受けない）。`schedule` と `not_scheduled_reason` のどちらの行でも必須 |
| `anonymizes` | △ | ✗ | ✗ | **匿名化する集約**（集約 id）。この効果が personal 列を placeholder に書き換える本人の集約。下の「匿名化する効果」を参照 |
| `ends_sessions` | △ | ✗ | ✗ | **セッションを終える集約**（認証フローの主語の集約 id）。この効果が、遷移した行の持ち主のログイン状態を全部終える。`platform_call` と**対で**書く。`kind` の語が `declares: [ends_sessions]` を持つなら必須。下の「セッションを終える効果」を参照 |
| `platform_call` | △ | ✗ | ✗ | **認証基盤の呼び出しを本文に持つ RPC の名前**（`ends_sessions` と匿名化の行。引数は uuid 1 つ。T19 が実在・引数・`calls` を見る） |
| `platform_job` | △ | ✗ | ✗ | **認証基盤の個人データをコミットの後に消すキューのジョブの ID**（匿名化の行だけ。`platform_call` の代わり。J5 が実在と同じ遷移の `effects` を見る） |

**語の宣言(`vocabulary.kind[]`)**は `id`(語)・`label`(表示名)のほかに、`in_transaction: true` と `declares` を持てる。**`kind` の語だけ**(`on_failure` の語に書けば J0 が落とす)で、書くと「その語の行は書き込みと同じトランザクションで実現される(RPC が実現するのでジョブには積まれない)」という宣言になり、**`source: outbox` の行だけがその語を選べる**(`schedule` / `manual` の行が選べば J0 が落とす)。機械が読むのはこの宣言と `anonymizes` / `emits` の有無で、語の綴りは比べない。かつては体系側に語(`transaction_effect`)を 1 つ直書きしていた(W1 の未解決の既知の衝突)が、実例が 2 つの語(同一トランザクションで実現済みの種類・匿名化)に揃ったので語彙の側の宣言に開いた。

**`means`(`on_failure` の語の宣言)は、その語が失敗したときの扱いの意味である。** `on_failure` の語だけが書き、**必ず書く**(欠落・値域外は J0 が落とし、`kind` の語に書けば軸の取り違えとして落ちる)。値域は体系が固定し、語の綴りは製品が選ぶ(綴りが値域の語と同じである必要はなく、**W1 は値域の綴りが製品の語彙と衝突するのを嫌う**ので、値域の語は製品の語の綴りと重ならない形にしてある)。

| `means` | 意味 | 選べる行 |
|---|---|---|
| `never_queued` | キューに積まれないはずの効果。積まれること自体が結線の誤り | `kind` の語が `in_transaction` を宣言した行 |
| `retry_to_dead` | キューに積まれ、リトライして尽きたら dead letter に置く | `source: outbox` / `manual` で上でない行 |
| `next_run` | 失敗しても、次の起動(時刻起点)が拾い直す | `source: schedule` の行 |
| `pending_decision` | まだ決めていない | `source: outbox` / `manual` で上でない行(決めたら別の値に直す)。**選んだ行ごとに J6 が warning を出す**(台帳に載らない = 未分類なので、`verify --fail-on-unclassified` の門が止める。未定のまま出荷しない) |

**既存の製品への移行**: `means` は 2026-10-07 から必須で、既存の製品は `on_failure` の語それぞれに `means` を足すまで J0 が落ちる(破壊的な変更)。

J6 が**行の種類と語の `means` の対**を見る(上の表の「選べる行」)。**読み手は J6 だけである** —— 生成物 `jobs.ts` の `onFailure` を実行時(ワーカー)が読む形にはしていない。実行時が `never_queued` の行を即 dead にするなどを読むようにするかは別の判断である(いまは、結線の誤りを「ハンドラが無い」で間接に表している)。

**`declares`(語の宣言のもう 1 つ)は、その語の行が必ず持つキーの一覧である。** `kind` の語だけが書け(`on_failure` の語に書けば J0 が落とす)、書けるキーは体系が固定する値域(今は `anonymizes`・`emits`・`ends_sessions`。空の宣言・値域外のキー・重複は J0 が落とす)で、**`source: outbox` の行だけがその語を選べる**(`schedule` / `manual` の行が選べば J0 が落とす。そのキーを持てるのは outbox の行だけだから)。書くと「この語を選んだ行は、そのキーを書かなければならない」という宣言になり、J5 が**語と行の対**を見る — 宣言した語を選んだのにキーを書き忘れた行は、**そのキーを持つ行が他に 1 つも無くても**落ち、逆にキーを持つ行が宣言の無い語を選んでいても落ちる。語の綴りは体系が比べず、見るのは宣言の有無だけである(`in_transaction` と同じ形 — 語を選べば宣言が付いてくる)。

**`manual` は「人が押して積まれる」の宣言である。** 台帳としては outbox の行に積まれるが、発火元がドメインイベントではないので `outbox` とは別の軸になる（J1 は `effects` との一致を要求せず、逆に `effects` に現れたらエラーにする）。最初の実物は**対外告知**で、`notification_spec` の `trigger: manual` と対になる — あちらが「人が送る通知である」ことを、こちらが「その通知は人の操作で積まれる」ことを宣言しており、**両方が揃って初めて 1 つの事実が閉じる**。

**`schedule` と `not_scheduled_reason` のどちらも無い行は書けない。** 両方欠けると「いつ起きるか誰も知らない」が黙って通り、それこそがこのカタログを作った理由に反する。まだ結線していないものは理由つきで宣言する（`unhandled` / `unscanned` と同じ免除方式）。

**`due_from` は「いつ」を仕様から辿れるようにするための列である。** 返却期限の走査なら `loan.due_at`、リマインダーが入る日も同じ列に書く。ここが埋まっていれば、「その時刻がどこから来るか」を実装のクエリを読まずに追える。 **この列が実装の読み取り口の絞り込みに接地していること**は J2 が見る(下の「起動口・`fires`・`due_from` の実装への接地」)。

### 走査が積む通知(`emits`)— 時刻で起きる通知の発火元を宣言する

**`emits: [通知ID, …]` を持つ `source: schedule` の行は、「この走査が、遷移を起こさずに outbox へ通知を積む」という宣言である。** 通知の発火元の 3 つ目であり(遷移の `effects` / 受信 Webhook の `emits`〔イベントを起こす〕と並ぶ)、通知カタログの `trigger: schedule` の通知は、この宣言で名指されて初めて発火元を持つ(N1 が `schedule` ⇔ `emits` を双方向に見る)。実例は 2 つ: 返却期限の前日の知らせ(`trigger: schedule` の通知を積む)と、返却期限超過の催促(遷移が積む `auto` の通知を**積み直す**)。

- `emits` の ID は **`source: outbox` のジョブ行としても宣言される**(J2)。走査が積むのはワーカーが実行するキューの行なので、行の無い種別を積むとハンドラの閉世界の外へ出る。逆向きは J1 が見る(outbox 行の積む元に `emits` も数える)。
- **機械が読む軸は `emits` キーの有無**で、`kind` の語(催促・リマインドの呼び名)はカタログが宣言する語彙のままにしてある(体系側に語を持たない)。語の側に **`declares: [emits]`** を宣言すると、その語を選んだ行は `emits` を必ず持ち、`emits` を持つ行は `declares` を持つ語を選ぶ(J2 が見る。`anonymizes` と同じ形)。
- `emits` は `source: schedule` の行だけが持つ(outbox / manual に書けば J0 が落とす)。
- **二重に積まないのは走査の実装の責務**で、仕様の語彙ではない。既定は outbox の冪等キー(`jobs.idempotency_key`)に畳むこと(送った印の列を足さない)。積み直しを毎日してよい通知(催促)は鍵に日付を含め、1 度きりの通知(返却期限の前日の知らせ)は鍵に日付を含めない。

### 効果を実現する RPC の名指し(`realized_by`)— 連鎖を推測しない

**同一トランザクションで実現される効果(`kind` の語が `in_transaction`)の行は、`realized_by: { {イベント ID}: {RPC 名} }` で、イベントごとに実現する書き込み RPC を名指しする。** 操作の属性(destructive / bulk / touches_personal ・確認の文言)と遷移書き込みの期待表(匿名化の連鎖の免除)は、「その操作が実際に通る RPC の `also_writes`」から連鎖を導く。どの RPC かを集約の関数の本数や形から**推測しない**(複合 RPC が 1 本から 3 本に増えただけで連鎖が消え、確認の文言から「データが削除されます」が落ちた)。

```yaml
  - id: revoke_patron_sessions
    kind: transaction_effect
    realized_by:
      membership.leave: apply_patron_transition   # 遷移の定型(shape: transition)も名指せる
      membership.erase: erase_patron
```

- **キー**は、その効果を `effects` に宣言している全部のイベント(`{machine}.{event}`。`writes[].effects` なら `{entity}.update`)と過不足なく一致する。**値**は data_table の `kind: rpc` に実在する関数(定型でも複合でもよい)。
- 書けるのは `in_transaction` の語の行だけ(キューに積まれる効果に書けば J0 が落とす)。`in_transaction` の行は**必ず持つ**。キーの過不足・名指しの無い行・実在しない RPC は **T19** が名指しで error にする(黙って「連鎖なし」にしない)。
- 属性の導出は、操作のイベントに対して**効果が名指しした RPC の `also_writes` の和**だけを見る。免除の期待表(`transition-writes`)は逆向きで、**匿名化の効果が名指しした RPC だけ**から導く(匿名化でない効果の名指しを入れると免除が広がる)。
- 名指しした RPC が本当にその効果を実現しているかは突き合わせない(見張りテストが担う)。


### 匿名化する効果(`anonymizes`)— 「消去が書く列」を機械が読む形で宣言する

**`anonymizes: {集約}` を持つ `source: outbox` の行は、「この効果が、その集約の `personal: true` の列を `personal_placeholder` に書き換える」という宣言である。** 書き込みと同じトランザクションで実現される種別(`in_transaction` を宣言した語と同じくキューには積まれず、`on_failure: wiring_error`)であり、`in_transaction` だけの語との違いは**何を書くかが機械に読める**ことだけである。実例は「個人データの消去」(`membership.erase` が積む `anonymize_patron_data`)で、遷移が書いてよい列の期待表(`transition-writes.ts`。ウォーカーのオラクルが読む)は、この宣言から導かれる(自分の集約の personal 列 + その RPC の `also_writes` のうち personal 列を持つ表)。かつては `access_spec` の `by: system` 行で近似していたが、その行は「人が編集する列」の宣言と区別がつかず、A17 が誰も動かせない列と鳴らし続けていた。

- **機械が読む軸は `anonymizes` キーの有無**である。`kind` の語(「匿名化」の呼び名)は他の `kind` と同じくカタログが宣言する語彙で、体系は比べない(体系側に語を持たない。W1)。語の側に **`declares: [anonymizes]`** を宣言すると、語と宣言のずれを J5 が見る — その語を選んだ行は `anonymizes` を必ず持ち、`anonymizes` を持つ行は `declares` を持つ語を選ぶ。**どの行も `anonymizes` を持たないまま語だけ書いた**場合も、語が `declares` を持つ限り落ちる(`anonymizes` を持つ行が他に無くても、書き忘れを見逃さない)。生成物 `jobs.ts` が各行の `anonymizes` を載せるので、製品側のテスト(語を知っていてよい側)も同じ対を縛る。仕様の中で閉じる宣言と、実装の側の対との二重で持つ。
- **他の表の消去は `realized_by` の RPC の `also_writes` が宣言する。** 消える表（`anonymizes` の集約の表と、その RPC と呼び先が `scrub` / `delete` と宣言した表）から出る個人列の写しの先は、同じ宣言に載っていなければならない（T24。写し先の `personal: true` だけでは消えない）。**参照を辿って本人に届く列（`ref({集約})`）を持つ表の個人列も同じ**で、写しでなくても宣言に載せるか、表の `erasure_accept` に参照の列・個人列・理由を名指す。**道ごとに見る**: 表が消える表でも、本人へ届く道の全部が RPC の `scrub_via`（本文でこの道の行を消す。erase-parity が本文と突き合わせる）か `erasure_accept` に載る。本人の行が指す表の個人列（逆向きの道）は `erasure_addressee`（持ち主が宛先）か `erasure_accept` に分類する。本人へ届く外部キーを持つ内部テーブルは `personal_columns` が必須である。`scrub` と宣言した表は、個人列の**全部**を本文の set 句で書き換える（rpc-parity が列の単位で見る）。
- **認証フローの主語の集約を匿名化する行は `platform_call` か `platform_job` を持つ**（J5。併記は J0 が落とす）。主語の行の id は認証基盤のアカウントの id で、認証基盤にも本人の実名・メール・プロバイダの ID が入る。`platform_call` は認証基盤の綴りを本文に閉じる RPC(引数は uuid 1 つ)で、`realized_by` の RPC が同じトランザクションの中で `calls` で呼ぶ（T19）。`platform_job` はコミットの後に走るキューの行の ID で、同じ遷移の `effects` に載せる（J5）。**製品が認証基盤の表の書き込み権限を持たない・持ち続ける保証が無いなら `platform_job` を選ぶ** — 同じトランザクションの形は書き込みが拒まれると消去の全部が戻る。`platform_job` はコミットと同じトランザクションで積むのでジョブの存在は失われず、ジョブは冪等に書き、コミットからジョブの完了までは認証基盤に個人データが残ることを受け入れる。
- `anonymizes` は `source: outbox` の行だけが持つ(`manual` / `schedule` に書けば J0 が落とす)。発火元は**その集約の状態機械の `effects`**(`writes[].effects` には載せない — 載せていれば、自分の機械から積まれていても J5 が指す)。
- **消去を持たない製品は書かなくてよい**(personal 列を持つ集約に匿名化の効果が無くても鳴らさない。消去の要求に応じる義務は保証台帳 `erasure_honored` の話)。

### セッションを終える効果(`ends_sessions`)— アカウントを止める遷移がログイン状態を終える(R11 · ASVS V7.4.2)

**`ends_sessions: {集約}` と `platform_call: {RPC}` を持つ `source: outbox` の行は、「この効果は、遷移した行の持ち主(その集約の行の id = 認証基盤のアカウントの id)のセッションを全部終える」という宣言である。** 匿名化と同じく書き込みと同じトランザクションで実現される種別(`in_transaction` を宣言した語。キューには積まれず、`on_failure` は `never_queued` の語)で、キューに積むと再試行や dead letter のあいだにログイン状態が残る隙間が開く。

- **機械が読む軸は `ends_sessions` キーの有無**である。語(「ログイン状態を終える」の呼び名)はカタログが宣言し、**`declares: [ends_sessions]`** を宣言すると、語を選んで書き忘れた行も、宣言の無い語に `ends_sessions` を書いた行も J7 が落とす(`anonymizes` と同形)。
- `ends_sessions` は**認証フロー仕様の主語の集約**(サインインの決定表の主語)だけを指せる。ログイン状態を持つのは主語だけである。発火元はその集約の状態機械の `effects`(`writes[].effects` には載せない)。
- **`platform_call` は、認証基盤の呼び出しを本文に持つ RPC**(data_table の `kind: rpc`。引数は終える相手のアカウントの uuid 1 つ)の名指しである。認証基盤の綴り(Supabase なら `auth.sessions`)は**この 1 本の本文に閉じる**。`realized_by` の RPC は、それ自身であるか `calls` に宣言して呼ぶ(T19)。本文が本当に呼ぶかは rpc-parity が `calls` の両方向で見る。**生成する遷移の RPC は、効果を載せたイベントでこの RPC を同じトランザクションの中で呼ぶ本文になる**(手書きの遷移の RPC は自分で呼び、`calls` を宣言する)。
- **R11(アカウントを止める遷移は宣言しなければならない)**: 認証フローの主語が状態機械のとき、その機械の**終端の状態へ行く遷移**・**`tone: negative` の状態へ行く遷移**・**その集約を匿名化する効果を持つ遷移**は、`ends_sessions` の効果を `effects` に持たなければ J7 が error にする(効果が 1 本も宣言されていない製品でも)。休会のように本人が戻せる段(終端でも negative でもない)は求めない。tone は「無条件で確認が要る」否定の段の宣言なので、無効化・凍結のように**終端でないがログインを止める段**は、状態に `tone: negative` を付けることで R11 の対象になる。
- **保証の範囲(正直に)**: セッションの行(Supabase なら `auth.sessions`。更新トークンは外部キーの連鎖で消える)を同じトランザクションで消すので、以後 `getUser` と更新は即座に失敗する。**消せないのは発行済みのアクセストークンの期限(既定 1 時間)まで**で、それを PostgREST に直接使う経路は、DB の述語(RLS・RPC の実行者の行の述語)が利用者の行を直に読んで決める。サーバーの入口は `getUser`(認証基盤への問い合わせ)でセッションの存在を確かめる(署名の確かめだけに頼らない)。

### `scheduler`(鳴る場所)— ホストの Cron の頻度制約と DB 内のスケジューラ

**背景(実測 2026-09-06)**: いまのホストの後段 Vercel の Hobby プランは Cron を**1 日 1 回までしか登録できない**("Hobby accounts are limited to daily cron jobs" というメッセージでデプロイ自体が拒否される)。10 分間隔で叩く必要があるジョブ(取り残しの掃除役・期限走査)は、ホストの Cron の外(DB 内のスケジューラ。いまの後段 Supabase では pg_cron)に出さざるを得ない。この「時計がどこで鳴るか」を仕様の宣言に持ち込んだのが `scheduler` である。値はスタックの名前ではなく**鳴る場所**で、どの後段がその場所の登録を突合するかは検査の側が役割で宣言する(`lib/job/target-checks.ts` の `SCHEDULER_OWNER`。鳴る場所と検査の持ち主は別の軸)。

`scheduler` は値域(`host` / `database`)で、`source: schedule` の行はすべて必須で持つ(`schedule` の行だけでなく `not_scheduled_reason` の行も持つ —— **鳴る場所の選択は結線前から決まっている設計判断であり、結線した瞬間に初めて決めるものではない**)。旧い名前(キー `runner`・値 `vercel_cron` / `pg_cron`)は受けない —— J0 が書き直し先(`scheduler: host | database`。`vercel_cron` → `host`・`pg_cron` → `database`)を名指して落とす。

| 値 | 鳴る場所と叩く仕組み | 突き合わせ先 | 向いている頻度 |
|---|---|---|---|
| `host` | アプリを動かす場所の Cron が HTTP の入口(`endpoint`)を直接叩く(いまの後段: Vercel Cron) | `app/vercel.json` の `crons`(J2) | ホストの頻度制約の範囲(いまの後段 Vercel Hobby は **1 日 1 回まで**。J4 が機械で見る) |
| `database` | DB の中のスケジューラが関数を呼び、同じ入口を叩く(いまの後段: Supabase の pg_cron + pg_net) | `supabase/migrations` の `cron.schedule(...)`(J3) | 10 分間隔等の高頻度 |

**`database` は「ホスト側の口を叩くだけのトリガ」であり、業務ロジックを置かない。** 計算は変わらずホスト側の Route Handler が担う(ARCH-0001 の配置決定表の例外規定・[ADR-0010](../../../../decisions/common/ADR-0010-pg-cron-vercel-trigger.md))。DB 内のスケジューラ(pg_cron)の migration に SQL で業務ロジックを書き始めたら、それは実行場所が二重化した合図であり ADR の見直しに入る(ADR-0007 の Notes と同じ考え方)。

**秘密は migration に書かない。** `database` のジョブが叩く URL と認可トークン(`CRON_SECRET` と同じ値)は Supabase Vault に `cron_base_url` / `cron_secret` の名前で入れる(投入手順は製品の運用手順書に書く。値が無い間は `net.http_get` の呼び出しが失敗し、`cron.job_run_details` に記録される形で可視化される —— 壊れた状態を素通しにしない)。

**Pro プラン等に上げて頻度制約が緩んだら**、J4 の判定(1 日 1 回以下)を緩める側に変える。カタログ側の宣言(`scheduler: host`)は変えなくてよい —— 制約は鳴る場所の選択とは独立な検査条件だからである。

### 起動口・`fires`・`due_from` の実装への接地 — 宣言を実装から剥がさない

時刻で起きるジョブには、**宣言と実装を結ぶ線が 3 本**ある。どれも「ファイルが実在する」だけでは足りず、**線が本当に繋がっていること**を J2 が見る(実装の木が実在する環境でだけ。仕様だけのリポジトリは時刻起点のジョブを宣言できる)。

| 線 | 見ること | 食い違うと何が起きるか |
|---|---|---|
| 起動口 → 実装 | `endpoint` の Route Handler が**呼んでいる import**(値として使われている束縛)だけを起点にした **import の閉包が `implementation` に届く**(閉包の解決は C24 の鮮度の hash と同じ部品〔`lib/semantics/import-closure.ts`〕。起点を絞る目は `lib/semantics/used-imports.ts`) | 起動口が別の走査を呼んでいても、カタログは「その口はこの実装」と言い続ける(期限の Cron が、期限ではなく延滞料の確定を毎回実行する、が全部緑で通る) |
| `fires` → `scans` | `fires: E` の走査の `implementation` が、`actions/README.md` の `scans[event=E].implementation` に**届く**(同じ実装か、import の閉包で届く)。`scans` に `E` が無いのも落ちる | 「どの走査がどのイベントを起こすか」は jobs.md と scans の **2 か所**に書かれる。2 か所を突き合わせないと、2 本の `fires` を入れ替えても誰にも見えない |
| `due_from` → reader | `due_from: {entity}.{field}` の `{field}` が、**起動口と実装の import の閉包の中で、期限の比較(`lte` / `lt`)の第 1 引数の文字列リテラルとして現れる** | 仕様の「いつ」だけを別の列に書き換えても、読み取り口は元の列で絞り続ける。カタログの「いつ」が嘘になる |

- **起動口 → 実装は「呼んでいる束縛」から見る。** Route Handler の import のうち、式に 1 度でも現れる束縛(呼び出し・値として渡す・参照・`export { … }`・再輸出・動的 import / `require`)の先だけを起点にし、その先は全部の辺を辿る。**import しただけで呼んでいない実装・型だけの import・副作用 import は、届いたことに数えない**(起動口が 2 本の実装を import して片方だけ呼ぶ形は、呼んでいない側に届かない。反例には「import はしているが、呼んでいない」と載る)。
  - **見えない側(限界)**: 絞るのは起動口 1 本の辺だけで、**起動口より先は全部の辺を辿る**。呼んでいる配線の先に全実装を束ねる索引ファイルができると、閉包が全実装に届いて検査は意味を失う(いまは各配線が自分の実装にだけ届く)。束縛のスコープも追わない(内側で同じ名前を宣言し直しても、その名前の参照は使用に数える)。呼んだ先で**何を呼ぶか**の取り違えは、起動口を呼ぶ統合テスト(composition の `__tests__`)が持つ。
- **逆向き: `scans` の 1 行ごとに、発火元がちょうど 1 つある。** `fires → scans` だけでは、ジョブから `fires` を消しても緑のままで、`scans` の走査を起こすものが仕様のどこにも無くなる(ハンドブックのジョブの章が嘘になる)。そこで `scans` の各行について、そのイベントを起こす**発火元の数**を J2 が数える。発火元は 2 種類で、**新しい宣言の欄は無い**(既存の宣言を読むだけ): (1) 時刻起点のジョブの `fires`(ジョブ 1 本につき 1 つ)・(2) auth.md の `sign_in[].runs` に名指されたイベント(サインイン時の同期の実行。何行が名指しても 1 つ)。**0 本(`fires` の消し忘れ・`runs` の書き忘れ)も 2 本以上(同じイベントを 2 本のジョブが起こす・ジョブが起こす走査を `runs` も名指す)も error**。受信 Webhook の `emits` と画面の `emits` は `scans` の外にある発火元(A10 が見る)なので数えない。認証仕様が読めない構成(auth.md はあるがスキーマ違反)では `runs` 由来の行を判断できないので、ジョブの無い行を**未検査**として scope 行に出す(ジョブだけで決まる 2 本以上は見る)。auth.md が無いリポジトリは `runs` を持たないものとして数える。この向きは仕様だけで判定できるので、`app/` が無い環境でも見る。
- **`due_from` の探す範囲は「起動口と実装の閉包の和」である。** 読み取り口(reader)は DI の外(infrastructure)にあり、`implementation`(operation 層)の閉包からは届かない。届くのは起動口の閉包(Route Handler → composition → infrastructure)である。
- **列名はその場にリテラルで置く。** 列名を定数に切り出した reader は、リテラルが期限の比較の引数に現れないので接地を読めない(落ちる側に倒す)。数えるのが「期限の比較の第 1 引数」だけなのは、同じ綴りが別の目的(「まだ始まっていない」を `gt` で外す、並べ替え、選ぶ列の一覧)で現れても接地とは言えないからである。**`{field}` は DB の列名と同じ綴りであること**(フィールド名と列名が別の綴りの製品は、reader の側をその綴りに揃える)。
- **粒度は「閉包の中のどこか」である。** 同じ reader が複数の走査の絞り込みを持つ(期限の走査と確定の走査が同じ repository にいる)と、その 2 つの列のあいだの取り違えは見えない(`due_from` を期限の列から確定の列に書き換えても、同じ reader に両方の `lte` があるので通る)。**同じ reader に 2 つの期限の列がある走査は、すべてこの限界の内側にある**(例: 期限・確定・催促の 3 本の走査がこの形になりうる)。別の reader を持つ走査の取り違えは落ちる。この限界は検査が見える範囲の線であり、見えない側は `fires` と `scans` の突合(上の 2 行目)と走査のテストが持つ。根治は、期限の問い合わせを `due_from` から**生成して手書きをやめる**形である(未着手)。
- **期限の比較の呼び名(`lte` / `lt`)は、Supabase のクライアントの語彙を仕組みの前提として固定している**(`lib/job/due-columns.ts` の `DUE_COMPARATORS`。製品の語ではないが、DB クライアントの語彙ではある)。別のクライアント(`lte(col, v)` の関数形・SQL 文字列・ORM のクエリビルダー)を使う製品では、期限の比較の綴りが違うので **`due_from` を持つ行がすべて落ちる**(免除の口は無い)。そのときは語彙を製品の宣言へ寄せる(`DUE_COMPARATORS` を宣言から読む)ことになる。使うクライアントが変わらない限り、固定のままでよい(CLAUDE.md が Supabase をスタックとして宣言している)。
- 反例には、起動口・期待した実装・閉包で届いた別の実装(または届いた別の走査)を載せる。

### Cron 起動口の認可の見張り(生成テスト)

**時刻起点のジョブ 1 行(起動口を持つ行)= 起動口 1 本として、認可の見張りテストが `generate` で生成される**(`app/src/app/api/__tests__/generated/cron-routes.test.ts`)。ジョブを足せば見張りも自動で増える。見るのは 2 つ —— 秘密が未設定なら(`Authorization: Bearer undefined` でも)・秘密と違う / 無い `Authorization` なら、**どの起動口も 403** を返すこと。**起動口が export している HTTP メソッドは全部**呼ぶ(`GET` だけではない)。規約は「Cron の口は `GET` 1 つ」だが、認可を持たない `POST` が 1 本足されても `GET` だけの見張りは緑のままなので、メソッドの一覧は手書きせず**起動口の構文木から取る**(`lib/semantics/route-exports.ts`)。**赤になる条件は「403 でなかった」である**(例外で落ちた・200 を返した・DB を待ってタイムアウトした、のどれも赤)。認可の判定は composition に触る前に終わるので、起動口を呼ぶだけで確かめられる(DB は要らない)。起動口から認可を外すと、その先の配線が例外を投げるか 200 を返すので、403 を返さなかった起動口(ジョブ・メソッド・口・実際のステータス)を名指して落ちる。

保証台帳の `config_absent_closes`(設定が無ければ閉じる)の見張りテスト(`TC-GUAR-CONFIG-002` / `-003`)がこの生成テストを名指す。判定の純関数だけを見ていたころは、起動口が判定を呼ぶこと自体は誰も見ていなかった(台帳の「Cron 起動口は常に 403」と見張りの範囲がずれていた)。Route Handler がカバレッジの対象外であることは変わらない(テストは呼ぶだけで、起動口の中身を測らない)。

### ここに書かないもの（正が割れる）

- **どの遷移・編集が積むか（`outbox` の発火元）** — `state_spec` の `effects`(遷移)、または `access_spec` の `writes[].effects`(状態遷移を持たない編集。domain-spec-writing.md §access_spec)が正。カタログに書き写すと二重の正になる（生成物の表には J1 と同じ規則で両方から引いて併記される）。
- **リトライの回数・バックオフの秒数** — 実装（`app/src/domain/jobs/retry.ts`）と DB の既定値が持つ。カタログが宣言するのは「どの方針で扱うか」という**分類**（`on_failure`）だけである。
- **`payload` の中身** — 実行に必要な識別子は積む側（RPC）と読む側（ハンドラ）の間の話であり、業務の宣言ではない。
- **人の要求に同期して走るもの** — サインイン時の在籍確認のような処理はここに載らない。カタログが宣言するのは「**誰も見ていないときに動くもの**」の全数である。

### 検証（J 群）

| ID | 何を見るか | 実行場所 |
|---|---|---|
| **J0** | スキーマ適合。`id` の固定値・ジョブ ID の重複・**行の 2 軸が宣言された語彙に閉じていること**・**`in_transaction` と `declares` を `kind` の語だけが宣言し(`declares` は書けるキーの値域に閉じ、空・重複なし)、その語を宣言のキーを持てる軸の行(`anonymizes` は `outbox`・`emits` は `schedule`)だけが選ぶこと**・`emits` が 1 件以上のスネークケースで重複なし・`source` の値域・**軸ごとに書けるキーが違うこと**・`schedule` / `not_scheduled_reason` の排他・**`scheduler` の値域と必須(旧い `runner` キー・旧い値は書き直しを名指して落とす)**・**`on_failure` の語の `means` の必須と値域(`kind` の語に書けば軸の取り違え)** | ローダー（`lib/model/job/loader.ts`） |
| **J1** | `effects[].do` と走査の `emits` ⇔ カタログの `source: outbox` の**双方向**閉世界(積む元は `effects` か `emits` のどちらか)。`schedule` の行が `effects` から積まれていないこと | `lib/job/verifiers/j1-effect-parity.ts` |
| **J2** | 時刻で起きるジョブの接地。`implementation` と Route Handler の実在・`fires` と `due_from` の実在・**起動口が呼んでいる import の閉包が `implementation` に届くこと・`fires` の走査の実装が `scans` の実装に届くこと・**`scans` の 1 行ごとに発火元〔ジョブの `fires` か auth の `sign_in[].runs`〕がちょうど 1 つあること(`lib/job/verifiers/j2-scan-origin.ts`。`app/` が無くても見る)**・`due_from` の列が起動口と実装の閉包の期限の比較に現れること**(上の「起動口・`fires`・`due_from` の実装への接地」)・**cron 式と `app/vercel.json` の登録の双方向一致**（間隔違いも落とす。対象は `scheduler: host` の行だけ）。**`emits` の接地**（積む先が `source: outbox` の行であること・`kind` の語の `declares: [emits]` と行の `emits` が対であること。`lib/job/verifiers/j2-emits.ts`）。**HTTP の入口の衝突**(ジョブの `endpoint` と受信 Webhook の口 `/api/inbound/{連携}` が**同じ URL を 2 つの持ち主が取らない**。置き場の主張を集めて配置に当てる契約の検査 `layoutClaimProblems`。`lib/job/verifiers/j2-entry-collision.ts`。**大文字小文字だけ違う URL も衝突**〔大文字小文字を区別しないファイルシステムでは同じディレクトリ〕・**ルーティングの規約で同じ URL になる綴り(`/(g)/x` と `/x`)も衝突**・**同じセグメントに画面の器(`page`)と HTTP の入口(`route`)の両方を取る衝突**(画面の `route` も役割をまたぐ主張として集める。画面どうしの重複・辿れない `route` は S1 / S7 の持ち物)・**`endpoint` が実装の木の走査で同じ URL に戻らない**(ルーティングに使わない名前の下 `/_cron/x`・ルーティングで消える名前 `/(g)/x`・`/@a/x`・動的なセグメント `/[x]/y` は、置き場に置いても Cron が叩く 1 本の URL にならない)ときも「置き場を決められません」・配置が役割を宣言していない構成は衝突とは別の文面で「置き場を決められません」と言う・`endpoint` の `//`・`?`・`#`・`.` / `..` のセグメントは URL のパスの書き誤りとして `app/` の有無に依らず指す。外部連携が阻害なら受信口の主張を作れないので「J2: 阻害」の行で言い、ジョブどうしだけを見る。`app/` が無い製品は置き場の衝突を見ない。**ジョブのカタログ(jobs.md)を採らない製品でも `app/` があれば、受信口と画面の `route` の取り合いは見る**(位置は製品の宣言の `roots.app`。J 群の見出しは「スキップしました」にこの続きだけは実行したと添える))。**HTTP の入口の閉世界**(実装の木の**全ての `route.ts` が宣言のどれかに分類される**。宣言は、ジョブの `endpoint`・受信 Webhook の口〔`direction: inbound` の行。URL は連携 ID から決まる〕・認証フロー仕様の `callback.endpoint`〔OAuth の帰り道〕・送信の連携の `endpoints`〔その連携を使う手書きの口〕の 4 つ〔`lib/job/entry-declarations.ts` が衝突の検査と同じ材料を 1 か所で作る〕。`lib/job/verifiers/j2-entry-closed.ts`。入口の集め方は**置き場の配置の `http-entry` の逆引き**〔`classify`。キーに結べるものは `keyOf`、結べないものまで拾うのは配置が与える `entryOf`〕。見ること: ①どの宣言にも当たらない入口 ②**1 本の URL に結べない入口**〔動的なセグメントの下・ルーティングに使わない名前の下は、どの宣言でも名指せない〕 ③認証の `callback` と送信の連携の `endpoints` の入口が実在すること〔ジョブの `endpoint` の実在は J2 の接地・受信口は生成物の鮮度が見るので重ねない〕。**①は宣言を読めた分だけ**で、外部連携・認証・ジョブが阻害〔ファイルはあるのに構築できない〕のときは**判定を保留**して実行ログの「J2: 阻害」の行で言う〔②③は保留しない〕。**実装の木が実在する環境でだけ**見る〔無ければ見出しが「スキップ」と言う。配置が `http-entry` の逆引きを持たず走査の根を決められないときは「J2: 未実施」〕。ジョブのカタログを採らない製品でも実装の木があれば見る)。**実装・Route Handler・Cron 登録の 3 つは `app/` が実在する環境でだけ見る**（仕様と実装の突合であり、S7・A11・X1 と同じ扱い。`fires` / `due_from` の実在はドメイン仕様だけで判定できるので常に見る。起動口・`scans`・列名の接地は実装の閉包を辿るので `app/` が実在する環境でだけ） | コア: `lib/job/verifiers/j2-schedule-grounding.ts`(接地。Route Handler の位置はアプリの枠の後段の置き場の配置 `http-entry` から引く)/ `j2-endpoint-reach.ts`(閉包を辿る 3 本)/ `j2-entry-collision.ts`(入口の衝突)/ `j2-entry-closed.ts`(入口の閉世界)。**ホストの後段が登録する検査**: `lib/targets/vercel/job/j2-schedule-parity.ts`(Cron の登録の双方向一致。ホストの後段が無い構成・登録していない構成では「J2: 未実施」と名指され、接地は実行する。ホストが理由つきで対象外と宣言したときは「J2: 対象外」) |
| **J3** | **cron 式と `supabase/migrations` の `cron.schedule(...)` の双方向一致**（対象は `scheduler: database` の行だけ。J2 の DB 内のスケジューラ版）。**仕様だけの段の製品(migration の置き場も実装の木も無い)では突合せず、実行ログの J 群の見出しが「スキップ」と件数を名指す**(実装の木が在るのに置き場が無ければ突合し、全件が登録の欠けになる)。指摘は実装の木との突合なので生成を止めない | **プラットフォームの後段が登録する検査**: `lib/targets/supabase/job/j3-pgcron-parity.ts`(pg_cron は Supabase の拡張。プラットフォームの後段が無い構成・登録していない構成では「J3: 未実施」と名指される。理由つきで対象外と宣言したときは「J3: 対象外」) |
| **J4** | `scheduler: host` の cron 式が **1 日 1 回以下**であること（いまのホストの後段 Vercel Hobby の頻度制約を仕様の検査に持ち込む） | **ホストの後段が登録する検査**: `lib/targets/vercel/job/j4-vercel-daily-limit.ts`(ホストの後段が無い構成・登録していない構成では「J4: 未実施」と名指される。理由つきで対象外と宣言したときは「J4: 対象外」で、未実施の件数には数えない) |
| **J5** | **匿名化する効果の宣言**。`anonymizes` の集約が実在し personal 列を 1 つ以上持つ・その効果が**その集約の状態機械の `effects`** から積まれる(別の集約の遷移・`writes[].effects` だけは不可。`writes[].effects` との併載も不可)・**その `kind` の語が `in_transaction` を宣言している**(匿名化はキューに積まれない。語がキューに積まれる種類の扱いなら自己矛盾)・1 つの集約に匿名化の効果は 1 つ・**`kind` の語の `declares: [anonymizes]` と行の `anonymizes` が対である**(宣言した語を選んで `anonymizes` を書き忘れた行・`anonymizes` を持つのに宣言の無い語を選んだ行のどちらも落ちる)。**認証フローの主語の集約を匿名化する行は `platform_call` か `platform_job` を持ち、`platform_job` は実在のキューの行で同じ遷移の `effects` に載る**。**逆向き(personal 列を持つ集約に匿名化が無い)は鳴らさない** | `lib/job/verifiers/j5-anonymize.ts` |
| **J6** | **失敗時の挙動の意味**。行の `on_failure` の語が宣言した `means` が、行の種類と対であること — 同一トランザクションで実現される行(`kind` の語が `in_transaction`)⇒ `never_queued`・`source: schedule` の行 ⇒ `next_run`・キューに積まれる行(`outbox` / `manual` で上でない)⇒ `retry_to_dead` か `pending_decision`(**後者は選んだ行ごとに warning** — 未分類になり、出荷の門が止める)。語の綴りは比べない | `lib/job/verifiers/j6-failure-meaning.ts` |
| **J7** | **セッションを終える効果の宣言**。`ends_sessions` の集約が実在し**認証フローの主語**である・その効果が**その集約の状態機械の `effects`** から積まれる(別の集約・`writes[].effects` との併載は不可)・`kind` の語が `in_transaction` を宣言している・1 集約に 1 効果・`kind` の語の `declares: [ends_sessions]` と行の `ends_sessions` が対。**加えて R11: 主語が状態機械のとき、終端・`tone: negative` の状態へ行く遷移と、主語を匿名化する遷移は、この効果を宣言していなければ error** | `lib/job/verifiers/j7-ends-sessions.ts`(`platform_call` の接地は T19) |

**J1 は N1 と違い接頭辞で母集合を切らない。** `notification_spec` は `notify_` で始まる副作用だけを見るが、ジョブカタログは「outbox に積まれうるもの」の全数を宣言するので、`create_patron_account` のような通知でない副作用も行を持たなければならない — **それらが「積まれない」ことこそ宣言の対象**である（RPC が同一トランザクションで実現するので積まれない、を `kind` と `on_failure` が言う）。

**実装側の閉世界はテストが持つ。** 生成物 `app/src/domain/generated/jobs.ts`（カタログの機械的な写し）と、登録済みハンドラ一覧（`app/src/operation/jobs/handlers.ts` の `NOTIFICATION_HANDLERS`）を app 側のユニットテストが双方向に突き合わせる。ここまでで **仕様 → 生成物 → 実装 → 仕様** の輪が閉じ、「仕様に無いジョブ種別を実行する」「仕様にあるジョブのハンドラが無い」「通知でないものが宛先を持つ」がすべて機械の検出対象になる。

### 検証方法

- `npm run verify`（J0〜J7 が走る）
- `npm run generate`（カタログのマトリクス・ハンドブックの章・実装側の期待表を再生成）
- `cd app && npm run test`（ハンドラ ⇔ カタログの突合）

## 関連ドキュメント

- [notification-spec-writing.md](./notification-spec-writing.md) — 同型の先行実物。通知はジョブの一種（`kind: notification`）であり、こちらが「誰に届くか」、ジョブが「いつ・どう動くか」を宣言する
- [ARCH-BE-0015](../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md) — `effects` からジョブが積まれ、ハンドラが呼ばれるまでの機構
