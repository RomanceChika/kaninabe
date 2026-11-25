---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0007, PRIN-0008, ARCH-BE-0001, ARCH-BE-0013, ARCH-BE-0015]
decisions: [ADR-0004]
---

# 構造化ログの規約

アプリが出す構造化ログの**語彙を仕様のIDに揃える**規約。出してよいフィールドは決まった集合だけとし、値には仕様に実在するID（ドメインイベントID・`INV-*`・副作用ID）だけを載せる。

## 1. 目的・スコープ

- **目的:** ログを**後から機械で問い合わせられる状態**にする。「`loan.report_overdue` が拒否された件数」「`INV-ITEM-102` に当たった回数」「`notify_overdue_patron` の所要時間」は、仕様の語彙でそのまま検索できなければならない。
  - **想定する読み手は将来の調査エージェントである。** 障害の調査を AI に任せるとき、相手が持っている地図は**仕様**である（`docs/specs/`）。ログが実装の都合で名付けられた語（`itemId` / `returnManualOk` / `"返却の記録に失敗しました"`）で書かれていると、地図と現地の地名が一致せず、調査は全文検索と推測に落ちる。仕様のIDで書かれていれば、`event = "loan.report_overdue"` の 1 行で仕様・実装・テスト・ログが繋がる（PRIN-0008 の運用面での帰結）。
  - 副次的な目的として、**語彙が閉じていることで「何を観測しているか」が一覧できる**。監視の設定・アラートの条件は、この値域の中からしか作れない。
- **スコープ:** `app/` が標準出力に出す構造化ログ全部（`Logger` を通るもの）。
  - **対象外:** 監査ログ（`domain_events` テーブル）。あちらは**業務上の記録**であり、消えては困るのでトランザクションの中で DB に書く。こちらは**運用のための観測**であり、消えても業務は壊れない。両者を混ぜない（[server-actions.md](./server-actions.md) の監査ログの節）。
  - **対象外:** ジョブ台帳（`jobs` テーブル）の `last_error` / `attempts`。再実行の判断に使う**状態**であってログではない。
  - **対象外:** 例外そのもの（`throw`）。想定外の失敗はログではなくスタックトレースとして出る（ARCH-BE-0013）。

## 2. ルール

### 出してよいフィールドは決まっている

- **すべきこと:** 出してよいフィールドを次の表に限る。型の正は `@kaninabe/runtime/ports` の `LogRecord` であり、**この表と 1 対 1 で対応する**。

| フィールド | 値 | 値の出どころ（＝正） |
|---|---|---|
| `level` | `info` / `warn` / `error` | 下の「重大度」節 |
| `event` | ドメインイベントID（`loan.report_overdue`） | 生成された遷移テーブル、または `ActionError.event` |
| `operation` | operation 関数名（`reportOverdueLoan`） | `layer/operation-naming` がイベントIDと一致させている名前（enforcement-matrix P3） |
| `actor_id` | 実行者の利用者ID。**`null` は「利用者IDを持たない実行者」**（未ログイン＝`anonymous`、または Cron・ワーカー＝`system`）| セッション（`resolveActorId`）または system 経路の `null` |
| `entity` | 集約名（`item` / `loan` / `hold`） | 生成テーブルの `machine` / `entity_spec` の名前 |
| `entity_id` | 対象の識別子 | 操作の入力 |
| `error_kind` | `invalid_input` / `guard_unsatisfied` / `forbidden` / `invariant_violated` | `ActionError` の 4 分類（ARCH-BE-0013） |
| `invariant` | 不変条件ID（`INV-ITEM-102`） | `invariant_spec` の id（`ActionError.invariant`） |
| `security_event` | セキュリティの事象の ID（`authz_refused` ほか。下の「セキュリティの事象」の目録） | `@kaninabe/runtime/security-log` の `SECURITY_EVENTS`（目録の正） |
| `refusal_code` | 拒否の細かい分類（`role_forbidden` / `mfa_required` / `invalid_input` / `state_conflict` / `guard_unsatisfied` / `invariant_violated` / `cross_origin`） | `ActionError` の分類と `forbidden` の `mfaRequired`・`guard_unsatisfied` の `blockedBy`（`security-log.ts` が写す） |
| `decision` | 認証の結末（サインインの帰り道なら認証フロー仕様の決定表の**着地**、失敗なら固定のコード。トークン・メールアドレスは載せない） | 認証フロー仕様の `landings`（生成物 `SignInLanding`）／ `/login?error=` の固定のコード |
| `commit` | 一時的な失敗（`temporarily_unavailable`）が書けたかどうか（`not_committed` = 届く前に落ちた / `unknown` = 分からない。印の無い失敗は `unknown`）。運用者が「書けたかもしれない失敗」を数える鍵（点検 21 回目 B の O21-1） | `ActionError.commit`（`security-log.ts` が写す） |
| `request_id` | 要求の識別子（配置先の `x-vercel-id`、無ければ `x-request-id`。`x-request-id` は利用者が選べる値なので、配置先が付ける ID を先に読む。`null` は取れなかった）。配置先の要求ログと突き合わせる鍵 | `requestIdOf`（形が合わない値は読まない） |
| `job_id` | ジョブ識別子 | `jobs.id` |
| `job_type` | ジョブ種別（`notify_overdue_patron`） | `state_spec` の `effects[].do` |
| `duration_ms` | 所要時間（ミリ秒） | 計測値 |
| `message` | 人間が読むための添え物 | 下の「message は構造ではない」節 |

- **してはいけないこと:** 実装が発明した名前のフィールドを足す（`itemId` / `closeResult` / `payload` / `stack`）。**足したくなったら規約（この表）と `LogRecord` を先に直す。**
- **すべきこと:** `Logger.write()` には**オブジェクトリテラルを直接書く**。これが型の執行が効く唯一の形である —— TypeScript が余分なプロパティを落とすのは**リテラルを直接渡したとき**（excess property check）だけで、中間変数に入れてから渡す・スプレッドで混ぜると、余分なフィールドは型エラーにならずに素通りする。
  - **例外は `logOperation` / `logJob`（app）と `recordRefusal` / `recordAuthEvent`（`@kaninabe/runtime/security-log`）の内部**である。共通部分をスプレッドで組み立てているが、これは関数の内部実装であり、外から新しい語彙が入る口ではない（引数の型が閉じている）。これらの出力の形は**ユニットテストが `toEqual` の全体一致で固定**しており、余分なフィールドが増えればテストが落ちる。
  - 計装を足すときは、このどれかを呼ぶ。`logger.write()` を直接呼ぶ新しい場所を作るなら、その出力も `toEqual` で固定したテストとセットにする。
- **してはいけないこと:** 同じ意味に 2 つの名前を使う（`event` と `domain_event`、`actor_id` と `user_id`）。1 つの意味に 1 つの名前しか無いことが、検索できることの条件である（PRIN-0007）。
- **してはいけないこと:** 値を実装側で組み立てる（`` `${aggregate}.${event}` `` を操作ごとに書く、状態名を和訳する）。IDは生成物か `ActionError` が運んできたものをそのまま載せる（PRIN-0008）。

### message は構造ではない

- **すべきこと:** 自由文は `message` だけに置く。ここに入るのは、構造化フィールドに載せる語彙が**仕様に存在しない**もの——外部から飛んできた例外の文言、未知のジョブ種別の診断——に限る。
- **してはいけないこと:** `message` の中身を後から集計・分類できる前提で書く（`message` を `grep` して件数を数える運用を作る）。数えたいものが出てきたら、それはフィールドを足す＝規約を改訂する話である。
- **してはいけないこと:** 拒否の理由文（`ActionError.reason`）を構造化フィールドに載せる。あれは**仕様の `otherwise_forbidden` の文言**であって分類ではない。ログに要るのは `error_kind` と `event` の組であり、文言は仕様を引けば読める。

### 重大度

- **すべきこと:** 3 段だけを使う。
  - `info` … 起きてよいことが起きた（操作が成立した、ジョブが成功した）
  - `warn` … **仕様どおりに拒否された**（`error_kind` が付く行、リトライ待ちに戻したジョブ）
  - `error` … 起きてはいけないことが起きた（dead letter に落ちたジョブ）
- **してはいけないこと:** ドメイン上の拒否を `error` で出す。拒否は設計どおりの結末であり、これを `error` に混ぜると「異常の件数」が拒否の多さで決まってしまう（アラートが鳴りっぱなしになる）。

### どの経路で何を出すか

- **すべきこと:** **人間が結果を受け取る経路（Server Action）は拒否だけ**を 1 行出す（`recordRefusal`。事象の目録は「セキュリティの事象」の節）。成功はその場で利用者に返り、状態の変化は監査ログ（`domain_events`）に残るので、ログに重ねない。
- **すべきこと:** **人間がいない経路（Cron・ジョブワーカー起点の system 操作）は成否とも**出す。誰も結果を見ないので、ログが唯一の観測点になる。
- **すべきこと:** ログを出すのは**呼び出しの端**（Server Action・走査・ワーカー）に限る。operation の内側から出すと、同じ操作が経路ごとに違う行数を出す。
- **すべきこと:** **1 ジョブの実行はワーカーの 1 行**とする。ハンドラは記録を持たない（実体が入る D-1 まで中身が空である以上、ハンドラが書けるのは「呼ばれた」だけで、それはワーカーの行と同じ事実である）。同じ実行が 2 行に見えると、件数を数えた側が黙って倍を読む。
- **すべきこと:** 入力検証の失敗（`invalid_input`）も記録する。実行者は**パースより先に**解決しておく（拒否された操作の記録に「誰が」が無いと、攻撃と操作ミスの区別が付かない）。生成された Server Action は `resolveActorId()` → 入力のパース → 実行器の順に生成され、`runner: manual` の手書きの入口は H7 が同じ順序を構文木で見る。
- **してはいけないこと:** 入力検証の失敗（`invalid_input`）に `event` を付ける。入力の話であってドメインイベントの発火ではない。
- **例:**

```ts
// 走査（system 経路）— 成否とも 1 行。イベントIDも集約名も生成テーブルから導く。
logOperation(
  deps.logger,
  { operation: 'reportOverdueLoan', event: EVENT_ID, actorId: null,
    entity: loanMachine.machine, entityId: loanId },
  result,
);

// Server Action（人間の経路）— 拒否だけ 1 行。イベントIDは ActionError が運んでくる。
// 実行者はパースより先に解く。記録は結果を変えず、返す前に通す（生成された入口の形）。
const actorId = await resolveActorId();
const entry = { operation: 'checkOutLoan', actorId, requestId: await resolveRequestId() };
// …パース・実行器…
recordActionRefusal(entry, result);
```

1 回の延滞の走査で 1 件が延滞になると、`loan.report_overdue` を持つ行は**合計 2 本**出る。同じイベントの重複ではなく、**別の事実が 2 つ**である。

```jsonc
// ①遷移が成立した（走査が出す。延滞の走査の 1 回の起動につき、延滞になった貸出の数だけ）
{"level":"info","operation":"reportOverdueLoan","event":"loan.report_overdue",
 "actor_id":null,"entity":"loan","entity_id":"…"}
// ②その effects のジョブを捌いた（ワーカーが出す。次の Cron 起動で）
{"level":"info","event":"loan.report_overdue","job_id":"…",
 "job_type":"notify_overdue_patron","duration_ms":12}
```

数えるときは `job_type` の有無で区別する（`event` だけで数えると 2 倍になる）。②の `event` はジョブの**由来**であって、そのイベントがもう一度起きたわけではない。

### 出力の体裁

- **すべきこと:** 1 行 1 レコードの JSON で出す（Vercel のログは行単位で収集されるため、整形して複数行にすると 1 件の記録がばらける）。
- **すべきこと:** 出力先の選択（`console` / 将来の収集サービス）は `src/infrastructure/console-logger.ts` の差し替えで行う。operation はポート（`Logger`）だけを知る（ARCH-BE-0001）。
- **してはいけないこと:** operation / domain から `console` を直接呼ぶ。

## 3. 注意点・例外

- **執行者は 2 つある。** ①`tsc`（`LogRecord` が閉じた interface。ただし**直書きリテラルに限る** — 中間変数・スプレッド経由の余分なフィールドは excess property check を抜ける）②各計装のユニットテスト（出力を `toEqual` の全体一致で固定しており、余分なフィールドが増えれば落ちる）。詳細は [enforcement-matrix](./enforcement/enforcement-matrix.md) の L1。文字列キーの `Record<string, unknown>` を受ける口を作った瞬間に①は消えるので、**ポートの型を緩めないこと**が実質のルールである。
- **計装の範囲。** ①ジョブの実行（ワーカー）②`loan.report_overdue` の走査 ③**生成された Server Action の全部**（拒否を `recordActionRefusal` で記録）④`runner: manual` の手書きの Server Action（H7 が記録の呼び出しと実行者の解決の順序を見る）⑤サインインの開始・帰り道・ログアウト（認証の事象）⑥出どころを確かめられなかった要求（要求の前段と Route Handler の関門）。**規約が先で計装が後**という順序は意図的で、先に語彙を決めておかないと各経路がそれぞれの語彙で計装される。
- **`payload` を出さない。** ジョブの `payload`（`{item_id: ...}`）は種別ごとに形が違うため、ログの語彙としては `entity` / `entity_id` に当たるが、ワーカーは種別に依らず書かれているのでどちらの名前で呼ぶべきかを決められない。値は `jobs` 行に残っており `job_id` から辿れる。ハンドラが種別ごとの具体になる日（外部連携の実装。ARCH-BE-0014）には、そのハンドラが `entity` / `entity_id` を持てる。
- **走査の件数は専用の欄を持たない。** `remind_returns` の走査は、蔵書ごとの 1 行(`entity_id` に蔵書の ID・`job_type` に積む通知。**ID は `message` に埋めない**)と、拾う蔵書があった回の結末の 1 行(`message` に拾った・積んだ・畳んだ件数)を出す。結末の `message` は人が読む添え物で、集計の対象にしない(数えたいときは蔵書ごとの行を数える。機械が読む件数は Cron の起動口が返す HTTP 応答が持つ)。件数を機械で集計したくなったら、この表と `LogRecord` にフィールドを足す = 規約の改訂である。
- **`actor_id` は `anonymous` と `system` を区別しない。** どちらも利用者IDを持たないので `null` になる。**区別が要るのは拒否の側**であり、そこは `ActionError` の `forbidden` が持つ `role`（`anonymous` / `patron` / `system`）が載せる（[server-actions.md §拒否に載せるロール](./server-actions.md)）。**ログのフィールドには `role` を足していない** —— 足す判断をするなら、この表と `LogRecord` を先に直すこと（現に出ている 3 種の行の形が変わるので、それを固定しているテストも一緒に動く）。経路で数えたいだけなら `operation` の有無・値でも足りる（走査は `reportOverdueLoan` を対象にする）。
- **個人情報を構造化フィールドに載せない。** 値として入るのはIDだけであり、表示名・メールアドレス・予約名を載せる口は用意していない（載せたくなったら、それは規約の改訂として議論する）。

### セキュリティの事象（ASVS V16.3.1〜V16.3.3）

拒否・認証・出どころの確認は**セキュリティの事象**として、`security_event` を持つ 1 行で出す。事象の目録の正は `@kaninabe/runtime/security-log` の `SECURITY_EVENTS`（出す側・ハンドブックの「ログの目録」・テストが同じ表を読む）。

| 事象 | 重大度 | 出す場所 | 何が起きたか |
|---|---|---|---|
| `authz_refused` / `mfa_refused` | warn | Server Action | 権限の拒否（`forbidden`）／多要素認証を済ませていないセッションの拒否（`forbidden` + `mfaRequired`） |
| `input_rejected` | warn | Server Action | 入力の検証の失敗（`invalid_input`。入力値・指摘のフィールド名は載せない） |
| `rule_refused` | warn | Server Action | 業務の規則の拒否（`guard_unsatisfied`。`refusal_code` が `state_conflict` か `guard_unsatisfied`） |
| `invariant_refused` | warn | Server Action | 不変条件の拒否（`invariant` に ID。流量の天井の拒否もここに来る） |
| `origin_refused` | warn | 要求の前段・Route Handler の関門 | 出どころを確かめられない状態変更の要求（経路は載せない。`request_id` で配置先の要求ログと突き合わせる） |
| `sign_in_started` / `sign_in_start_failed` | info / warn | サインインの開始の口 | 認可の URL へ送れた／始められなかった（`decision`: `redirected` / `invalid_form` / `start_failed`） |
| `sign_in_callback_succeeded` / `sign_in_callback_failed` | info / warn | サインインの帰り道 | 成功は決定表の**着地**、失敗は固定のコードを `decision` に載せる |
| `signed_out` / `sign_out_degraded` | info / warn | ログアウトの口 | この端末のセッションを閉じた／認証基盤では閉じられなかった（cookie は消した） |
| `sessions_ended` | info | セッションの管理の操作 | 自分の 1 本・自分以外・利用者の全部・全員のログイン状態を終えた（`actor_id` は操作した人。`decision`: `own_one` / `own_others` / `member_all` / `every`） |

- **載せるのは ID と判断の行だけ**である。入力値・メールアドレス・トークン・cookie・拒否の理由文（`ActionError.reason` にはガード式の字面が入りうる）は、載せる欄が無く、記録の部品も受け取る口を持たない（引数の型が閉じている）。
- 拒否はすべて `warn`。事象の ID があるので、`error_kind` では見分けられない「権限」と「多要素認証」、「状態」と「ガード」を分けて数えられる。
- ログのフィールド・保管先・保管期間・読める人の**目録**は設定カタログの `logging` が宣言し、ハンドブックの設定の章（「ログの目録」）に出る。転送先（ホストの外の系。V16.4.3）が本番で有効かは検査から見えないので、verify が毎回 `K5: 未実施` と名指す。

### 死んだジョブの知らせ（オプトイン）

dead letter に落ちたジョブは `error` の行が必ず出る。**宛先を設定したときだけ**、ワーカーが 1 回の起動の終わりに種別と件数だけを `DEAD_LETTER_WEBHOOK_URL` へ送る（payload と `last_error` は載せない。送信の失敗はワーカーを止めず、`error` の行を足す）。本番を宣言して宛先が無ければ K5 が警告し、理由つきで外せる（[config-spec-writing.md](../../../specification/standards/config-spec-writing.md) の `dead_letter_alert`）。

### ホストの外への転送（ASVS V16.4.3 — オプトイン）

ホストに侵入されても証拠のログが残るように、セキュリティの事象の行を**アプリから直接**ホストの外へも送れる。既定の送り先は Axiom。**導入はマストではない** —— 鍵（環境変数）が設定されたときだけ送り、無ければ今までどおり標準出力だけで正常に動く。試験環境・趣味の用途は何もしなくてよい（verify も何も言わない）。

**仕組み**（`@kaninabe/runtime/log-sink` の中立の口 + `@kaninabe/adapter-log-axiom` + 製品の配線 `composition/log-sink.ts`）:

- 標準出力の行は**先に**出る。そのうえで `security_event` を持つ行（拒否・認証の事象）だけを、応答の後（Next.js の `after()`）に、同じ瞬間の分を 1 回にまとめて送る。送る行は `LogRecord` のまま（欄を足さない。時刻は Axiom が取り込み時に付ける）。
- 送れなくてもアプリは止まらない。例外を外へ出さず、3 秒で打ち切り、失敗は理由の語 1 つだけの 1 行（`{"level":"warn","message":"log_sink_failed reason=rate_limited"}`）を標準出力へ出す。**トークン・本文・応答の中身は出さない**。理由の語: `misconfigured` / `unauthorized`（401・403）/ `rate_limited`（429）/ `rejected`（他の 4xx）/ `server_error`（5xx）/ `timeout` / `network`。この行が続くときは鍵・データセット・Axiom の側を見る。
- 送り先は `axiom.co` 配下のホストだけ（トークンを別のホストへ出さない）。転送について行かない（`safeFetch`）。
- 送る口を通るのは、Server Action の拒否・サインインの開始と帰り道・ログアウト・セッションの管理の操作・**有料の口（`runPaidEntry`）の拒否**（`authz_refused` / `mfa_refused` / `input_rejected` / 枠切れの `invariant_refused`。口は認証の組み立ての根の `securityLogger()` を `logger` に渡し、`runPaidEntry` は `logger` を必須にする。渡していることは X8 が構文木で見る。行は事象・拒否の語・操作の名前・実行者の ID・`request_id` だけで、本文・経路・入力の値は載せない）。**出どころの拒否（`origin_refused`）は、製品が口を渡せない前段と Route Handler の関門では標準出力だけ**（関門の呼び出しは引数に呼び出しを置けない形に固定されているため。ここの転送は未対応）。

**有効にする手順**（本番に出すとき。アカウントの作成と鍵の発行は運営が行う）:

1. Axiom のアカウントと組織を作り、**データセットを 1 つ**作る（例 `security-logs`）。無料のプランの保持は 30 日。**本番の前に 90 日（有料のプラン）へ決め直し**、設定カタログの `logging.retention` を実際の保持に合わせる。
2. そのデータセットだけに、**Basic の API トークン（取り込み専用）**を発行する。作成後に権限は変えられない。読む・消す権限を持つトークン（Personal や Advanced）は使わない —— 奪われても過去のログを消せない形にするためである。
3. Vercel の Production の環境変数に `AXIOM_TOKEN`（トークン）と `AXIOM_DATASET`（データセット名）を置いて出し直す。EU の組織なら `AXIOM_DOMAIN=api.eu.axiom.co` も。開発機は空のままでよい。
4. 本番で拒否を 1 件起こして（例 権限の無い操作）、Axiom のデータセットに行が届くことと、標準出力に `log_sink_failed` が出ていないことを確かめる。**届いているかは verify から見えない**（K5 が毎回「未検証」と名指す）。
5. トークンは `AXIOM_TOKEN` の `rotation` の周期で作り直す（手順は設定カタログ）。止めるときは `AXIOM_TOKEN` を消して出し直す。

**宣言**（設定カタログの `logging.sink`。config-spec-writing.md §ログの目録）: `required_in` に本番の置き場を書いた製品だけが、転送先が無いと K5 の警告を受ける。本番でも要らない製品は `exempt: 理由` で外せる（verify が毎回「受け入れた危険」として名指す）。配置先のログドレインに任せる製品は `mode: host_drain`。

**限界**: Axiom には**削除できない保管（WORM）が無い**（確認できなかった）。データの削除は組織の Owner / Admin の権限で、監査ログは全組織で直近 30 日。取り込みの状態を引く専用の API も無い（APL の問い合わせで最新の時刻を引く形）。つまり「侵入されてもアプリのホストからは消されない」までは担保するが、「組織の管理者の権限が奪われても消されない」は担保しない。

## 4. 関連ドキュメント

- [server-actions.md](./server-actions.md)（Server Action の実装規約。`Result` 型とエラー 3 分類 + `invalid_input`、監査ログ）
- [config-spec-writing.md](../../../specification/standards/config-spec-writing.md)（ログの目録 `logging` の宣言。K5）
- [route-handlers.md](./route-handlers.md)（Cron から叩かれる受け口。system 経路の入口）
- [enforcement/enforcement-matrix.md](./enforcement/enforcement-matrix.md)（機械執行ルールの全件一覧。この規約の執行者は L1 = tsc）
- [ARCH-BE-0015](../../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)（非同期ジョブ実行基盤。`job_id` / `job_type` の出どころ）
