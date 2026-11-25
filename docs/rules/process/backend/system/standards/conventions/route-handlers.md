---
doc_type: process
scope: backend
norms: [PRIN-0005, PRIN-0009, PRIN-0010, ARCH-BE-0001, ARCH-BE-0015]
decisions: [ADR-0007, ADR-0010]
---

# Route Handler の実装規約

`src/app/api/**/route.ts`（HTTP をそのまま受ける口）の書き方を固定する規約。人間のセッションを持たない呼び出し元 — Cron・Webhook・外部システム — のための最小限の形を定める。

## 1. 目的・スコープ

- **目的:** Server Action の定型（ARCH-BE-0013 の 4 手順）に乗らない受け口を、**例外の温床にしない**。Route Handler は「認可 → 委譲 → 応答」の 3 行しか書けない場所である、という状態を保つ。
- **スコープ:** `app/src/app/api/**/route.ts`。ユーザーの操作を受ける経路は対象外であり、そちらは [server-actions.md](./server-actions.md) が正である。
- **正の所在:** 層の責務と依存方向は [ARCH-BE-0001](../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)。ジョブワーカーの起動については [ARCH-BE-0015](../../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)。

## 2. ルール

### いつ Route Handler にするか

- **すべきこと:** 呼び出し元が**ブラウザの人間ではない**ときに使う（Cron・外部サービスからの Webhook・機械間の連携）。
- **してはいけないこと:** 画面からの操作の受け口にする。フォーム送信・一覧の取得を Route Handler で受ける（それぞれ Server Action と RSC の担当であり、経路を増やすと仕様との対応単位が崩れる）。
- **例外は 1 つだけ — 逐次配信（ストリーミング）である。** Server Action の戻り値は `Result` の 1 値であり、**生成中の文字を順に流す**ことを表せない。LLM の応答のように「待っている間に出続ける」ことが体験の本体であるものは、この形でしか書けない（ARCH-BE-0014 も同期の外部呼び出しを「ユーザー操作と不可分な応答（LLM ストリーミング）」に限って認めている）。この例外に乗るときも中身は 3 行のまま:
  - **認可はセッション**（`resolveActorId()`）で行い、実行者が居なければ **401** を返す（共有秘密ではない。呼び出し元がブラウザの人間だから）。転送(`safeRedirectResponse`)はしない —— API の応答であって画面遷移ではない。
  - **有料の外部呼び出しを伴う口は、共通の入口 `runPaidEntry`（`@kaninabe/runtime/http/paid-entry`）で包む**（下の §有料の口）。実行者が宣言した役（有効メンバー）を持つことの確認（メンバーの状態は**セッションの写しではなく DB のメンバー行をいま読む**。行の無い人・アカウントあり・休会・無効化・退会・消去済みのメンバーは使えない）・本文の上限・枠の消費は、入口が決まった順で行う。DB の計数（`consume_ai_quota`）も有効メンバーでなければ落とす（関門が 2 重になる）。
  - **委譲先は `src/composition` の Composition Root**。プロンプトの組み立ても外部 SDK の呼び出しもここには書かない。
  - **ドメインの状態を書き換えない。** 書き換えたくなったら、それは Server Action で受けるべき操作である。
  - **`export const dynamic = 'force-dynamic'`** と、応答に `Cache-Control: no-store` を付ける（Cron の口と同じ理由）。
  - **入力はモデルや外部サービスに渡る前に、大きさ・件数・文字数の上限で断る。** ①本文は上限つきで読む（`Content-Length` が上限を超えれば読まずに **413**、読みながら数えて超えても **413**。入口が持つ）②壊れた JSON・形の不正・件数や文字数の超過は **400**（枠は消費しない）。③応答の本文は固定の語（`payload_too_large` / `invalid_input`）だけで、入力の中身を返さない。形と件数・文字数の宣言は純関数（`src/domain/ai/request-limits.ts`）に置く。**本文の最大バイト数は外部連携の宣言（`abuse.max_body_bytes`）が正で、生成物（`PAID_ENTRIES`）から入口へ渡す**（1 日の回数の上限は回数しか数えないので、1 回の入力が巨大だと費用が 1 回で膨らむ）。
- **してはいけないこと:** 「ストリーミングだから」を理由に、状態を変える操作をこの口へ移す。例外が覆うのは**応答の形**だけであり、責務の線は動かない。

### 有料の口（共通の入口 `runPaidEntry`）

- **対象**: 外部連携カタログで `spend: paid` と宣言された連携のアダプタに届く Route Handler（`endpoints` に宣言された口）。ASVS V2.4.1（大量呼び出しの抑制）・V15.2.2（重い機能の守り）。
- **すべきこと:** 全メソッドの最後の文を `return runPaidEntry(request, { operation, maxBodyBytes: PAID_ENTRIES['{URL}'].maxBodyBytes, authorize: authorizeRole(PAID_ENTRIES['{URL}'].role), bindings: runtimeBindings, role: PAID_ENTRIES['{URL}'].role, resolveMfa（多要素認証を要求する製品だけ: 認証の組み立ての根の resolveSessionMfa）, logger: securityLogger()（認証の組み立ての根から import する。必須）, parse, consume, handler })` にする（出どころの確認 `refuseCrossOrigin` はその前、口の最初の文）。**メソッドの本体はこの 2 つだけ**（許可表: `return runPaidEntry(…)` / `return refuseCrossOrigin(request, …) ?? runPaidEntry(…)` / `const r = refuseCrossOrigin(request, …); return r ?? runPaidEntry(…)` / `const r = refuseCrossOrigin(request, …); if (r !== null) return r; return runPaidEntry(…)`）。入口の前にほかの文（ヘッダ・クエリでの分岐・ログ・本文の読み取り）を置くと X8 の error（見張りの生成テストが送らない要求で分岐して、認可・上限・枠の外へ出られる。点検 6 回目 B6-1）。**動的 `import()` と `require()` の指定子は字句だけ**（ESLint の `layer/no-opaque-module-specifier`。字句でない指定子は検査器の import の閉包から消えるので、口・ページ・Server Action の閉包にあれば X8 が「閉包が欠けた」として error）。入口は **認可（未ログイン 401・役を持たない人 403。本文は 1 バイトも読まない）→ 多要素認証（要求する製品で、済ませていないセッションは 403 `mfa_required`。本文は読まず、枠も消費せず、有料の処理も呼ばない。判定は実行器・手書きの Server Action と同じ `mfaRefusal`。`bindings` は生成した `runtimeBindings` で、手書きの値で外せない）→ 本文の上限（413）→ 形の検査（400。枠は消費しない）→ 枠の消費（429・DB が役を持たない実行者を拒めば 403）→ 有料の処理（`handler`）** の順を 1 か所で持つ。拒否はセキュリティログに 1 行ずつ残り（入力・経路は載せない）、`logger` に渡した `securityLogger()` を通るので、鍵があればホストの外へも送られる（logging.md §ホストの外への転送）。オプションの名前は実行時の鍵で数え、同じ名前の重複（`bindings` と `'bindings'` など。後勝ちで上書きされる）は X8 が読まずに赤にする。
- **すべきこと:** 上限と役は**宣言から生成される定数表 `PAID_ENTRIES`** から読む（同じ数を口の側へ書き写さない）。`consume` は宣言した `meter` の RPC を呼ぶ composition（有料の連携に届かないモジュール。例: `composition/tutorial/ai-quota.ts`）の関数、`handler` は有料の処理を配線した composition（例: `composition/tutorial/ai.ts`）の関数を**その場の関数の中で**呼ぶ。
- **すべきこと:** `authorize` と `consume` は**許可表の形だけ**で書く（X8。点検 5 回目 B5-2）。`authorize` は認証の組み立ての根の `authorizeRole` を引数 1 つ `PAID_ENTRIES['{URL}'].role` で呼ぶ 1 式（別名の import は可。呼び先が手書きの関数・役を捨てる即時呼び出し・引数を足した形は、役を渡していても赤）。`consume` は meter のモジュールの束縛 `M` を**呼ぶ** 1 式 —— `M` / `M()` / `(actorId) => M(actorId)` / `(actorId) => M()(actorId)`（`async` / `await` は可）。条件・`void`・カンマ・ブロックの本体・参照するだけの形は赤（枠を数えずに有料の処理へ進みうる）。
- **すべきこと:** 形の検査に加えて、**実物の口を叩く見張りテストが生成される**（`api/__tests__/generated/paid-entries.test.ts`。生成器 `code-paid-entry-tests`）。定数表の口ごと・export するメソッドごとに、未ログインの要求は `401 unauthorized`・役を持たない人（ログインしているが役の条件の行が 0 本）は `403 forbidden` で閉じ、本文を読まず、枠の RPC・書き込み・有料の宛先に触れないことを、偽の後段（`fetch` の差し替え）と Next.js の要求の文脈で見る（`@kaninabe/runtime/testing/http/paid-gate`。モジュールの差し替えはしない）。手書きの口を差し替えても、閉じ方が変われば赤になる。
- **してはいけないこと:** 有料の連携に届く import を `handler` の外で使う（枠の消費の前に有料の処理に届きうる）。動的 import・再輸出・副作用 import も同じ。取り込みなど有料の連携を呼ばない処理は、有料の連携を配線するモジュールと別のモジュールに置く（検査は import のモジュール単位で見る）。
- **機械執行**: X8（構文木で口の形を、migration の本文で `meter` の RPC を見る）。入口の挙動は実行時パッケージのユニットテスト（`TC-FW-PAIDENTRY-*`）と口の統合テスト（`ai-routes-paid-entry.test.ts`）が固定する。

### 配置

- **すべきこと:** `src/app/api/{領域}/{操作}/route.ts` に置き、1 ファイルで 1 つの口とする。
- **例外は 1 つ — 受信 Webhook の口である**（`api/inbound/{連携 ID}`。下の §受信 Webhook の口）。
- **すべきこと:** HTTP メソッドの export（`GET` / `POST`）は 1 ファイルに 1 つだけにする。状態を変える起動は `POST`、ただし**Cron から起動される口は `GET`**（次節）。
- **してはいけないこと:** ドメインイベント ID から名前を導く（Route Handler はドメインイベントの受け口ではないため、[naming-and-placement.md](./enforcement/naming-and-placement.md) の P1〜P4 の対象外である）。

### 口は宣言に載るものが全部(HTTP の入口の閉世界)

- **すべきこと:** 実装の木の `route.ts` は、**必ず次の 6 つのどれかとして仕様に宣言する**。宣言の無い口を足しても、認可の検査も衝突の検査も届かない(カタログに載らない口に認可なしの `GET` を足しても緑、が過去の実測)。

| 口の種類 | 宣言する場所 | 口を書く者 |
|---|---|---|
| Cron が叩く口 | ジョブの `endpoint`(`docs/specs/backend/jobs.md`) | 製品(手書き) |
| 受信 Webhook の口 | 外部連携の `direction: inbound` の行(URL は `/api/inbound/{連携 ID}` に決まる) | 生成物 |
| OAuth の帰り道 | 認証フロー仕様の `callback.endpoint`(`docs/specs/backend/auth.md`) | 製品(手書き) |
| サインインの開始(POST) | 認証フロー仕様の `start.endpoint` | 製品(手書き。中身はセッションの adapter の `startSignIn`。要求の出どころを確かめる) |
| ログアウト(POST) | 認証フロー仕様の `logout.endpoint` | 製品(手書き。中身はセッションの adapter の `signOut`。要求の出どころを確かめる) |
| 外部サービスを使うブラウザ向けの口(逐次配信など) | その連携(`direction: outbound`)の `endpoints`(`docs/specs/backend/external.md`) | 製品(手書き) |

- **機械が見ること(J2 の続き)。** ①実装の木の全ての `route.ts` が、宣言のどれかの URL に当たる ②**1 本の URL に結べない入口**(動的なセグメント `[id]` の下・ルーティングに使わない名前 `_x` / `@x` の下)は、どの宣言でも名指せないので置かない ③宣言した手書きの口(`callback`・`start`・`logout` と `endpoints`)の `route.ts` が実在する ④どの宣言も同じ URL を取り合わない(衝突)。ジョブの `endpoint` の実在は J2 の接地、受信口の実在は生成物の鮮度が見る。宣言を読めない種類(阻害)があるときは、③以外の「どの宣言にも当たらない」の判定を保留して実行ログで言う。
- **してはいけないこと:** 口を足して宣言を後回しにする。宣言は URL だけでよい(中身の認可・応答の形はこの規約の他の節が決める)。
- **注意:** 宣言が見るのは**口の分類**までで、口が宣言した連携やジョブを本当に呼んでいるか(`endpoints` の口が連携の IF を使っているか・`callback` の口が認証の実装を呼んでいるか)は見ていない(接続の検査は BACKLOG の宿題)。
- **走査の範囲。** 実装の木のルーティングの根の下を、**URL のセグメントになりうる名前を一つも飛ばさずに**歩く(`build` / `coverage` / `.well-known` のような名前の下の `route.ts` も入口として数える)。歩かないのはパッケージの置き場(`node_modules`)と、配置が宣言するビルドの出力だけ。入口のファイルは `route.ts` / `route.tsx` / `route.js` / `route.jsx`。
- **読めなかった場所は「指摘 0」と同じにしない。** 走査の根や子のディレクトリを読めなかった(権限・入出力の失敗)ときは、空の木と同じに緑にせず、J2 が「阻害 — <パス> を読めなかったため、入口の閉世界は見ていません」と名指す(読めた部分の入口の分類は出す。宣言した `callback` / `start` / `logout` / `endpoints` の口の実在は、読めなかった部分にあるかもしれないので判定しない)。実装の木そのものが無い(ENOENT)のは読めなかったとは数えない(「実装の木が無い」の扱いのまま)。
- **対象外の入口(この閉世界は見ない)。** 次は Route Handler の `route.ts` ではないので、宣言の置き場も検査も無い: メタデータのルート(`sitemap.ts` / `robots.ts` / `manifest.ts` / `opengraph-image.tsx` ほか)・リクエストの関門(`middleware.ts` / `proxy.ts`)・Pages Router の `pages/api`(この構成は App Router だけを使う)。これらを足すときは、別の手当て(認可の置き場・規約)を先に決める。

### ブラウザ側の守り(要求の出どころ・キャッシュ・CORS)

全応答のヘッダ(HSTS・nosniff・Referrer-Policy・枠に載せない)と文書のスクリプトの CSP は、**仕組みの既定**である(値はアプリの枠の後段の宣言 `lib/targets/nextjs/browser-defense.ts`、
配るのは生成したリクエスト前段 `src/proxy.ts` と生成物 `BROWSER_DEFENSE` を読む `next.config.ts` の `headers()`。配線は生成した見張りテスト `browser-defense.test.ts`(Cron の口の見張りと同じ置き場)が見る)。
Route Handler の側の決まりは次の 4 つである(出どころの確認は中身の 3 段の「認可」の最初の 1 行にあたる)。

- **すべきこと: cookie で認証する口は、本体の最初の 1 行で要求の出どころを確かめる。** 送信の連携の `endpoints`(ブラウザから叩かれる手書きの口)と、認証フロー仕様のサインインの開始 `start`・ログアウト `logout` の口が該当する。
  `refuseCrossOrigin(request, BROWSER_DEFENSE)`(`@kaninabe/runtime/http/request-origin`)を**本体の最初の文で**(認証 `resolveActorId()`・DB・外部の呼び出し・本文の読み取りより先に)呼び、
  その結果を返す。書けるのは次の 2 つの形だけである(J2 が構文木で見る。コメントに書いただけ・結果を捨てる・後置は error):
  `return refuseCrossOrigin(request, BROWSER_DEFENSE) ?? (await 本体(request));` か、
  `const refused = refuseCrossOrigin(request, BROWSER_DEFENSE); if (refused !== null) return refused;`。
  状態を変える要求(`GET` / `HEAD` / `OPTIONS` 以外)は、`Sec-Fetch-Site: same-origin` と、**スキームとホストの両方**が自分のオリジン
  (ホストは `X-Forwarded-Host` の先頭か `Host`、スキームは `X-Forwarded-Proto` の先頭か要求の URL)に一致する `Origin` の**両方**が
  揃わなければ 403 になる。他のサイトから送らせた要求にも cookie は付くので、SameSite に頼り切らない。**CORS の事前確認にも頼らない**(Route Handler は
  `Content-Type: text/plain` の本文も読めるので、事前確認を起こさない形の要求でも中身が届く。ASVS V3.5.1・V3.5.2)。書き忘れは J2(構文木の形)と見張りテストが止める ——
  見張りテストは口が import した依存を全部「触れたら記録する代役」に差し替え、閉じる要求で依存にも `fetch` にも 1 度も触れず本文も読まずに 403 を返すことと、
  同じオリジンの要求(フォームの送信・fetch・Server Action)が本体へ進むこと(対照)を見る。
  - **`X-Forwarded-Host` / `X-Forwarded-Proto` は配備の前段が付け直すことが前提**である(ブラウザは別のサイトのページから任意のヘッダを付けられないので、
    被害者のブラウザ経由の偽装は起きないが、前段なしの `next start` は来た値を残す)。前提と確かめ方は runbook の「出どころの確認の前提」。
  - **してはいけないこと:** cookie で認証する宣言の口(送信の連携の `endpoints`・サインインの開始・ログアウト)に `GET` / `HEAD` を export する
    (**`effect` によらない**。SameSite=Lax の cookie は別のサイトのリンクによる最上位の `GET` にも付き、`GET` は出どころの確認を求めない。
    `effect` は外の系への効果の語で、`effect: read` の口の本体も composition の書き込み〔セッションの操作・枠の消費など〕に届きうる。
    読み取りだけの口も `POST` にして最初の文で出どころを確かめる。J2 が error。読み取り専用の `GET` を宣言で許す口は未対応 — BACKLOG)。
  - **対象外**: Cron の口(共有秘密)・受信口(署名)・OAuth の帰り道(`GET`。別のサイトから来るのが正しい口で、PKCE の検証子が守る)。どれも cookie の認証に頼らない。区別は口の宣言の種類が決める
    (`lib/job/entry-declarations.ts` の `isCookieAuthenticatedOrigin`)。
  - **Server Action** は Next.js 本体が `Origin` を `Host`(か `X-Forwarded-Host`)と比べて食い違いを止める(公式文書 `serverActions.allowedOrigins`)。ただし
    **`Origin` が無い要求は警告だけで通す**ので、足りない分は生成したリクエスト前段が足す(状態を変える要求の出どころを、上と同じ部品で確かめる)。
- **すべきこと: 応答に `Cache-Control: no-store` を付ける**(下の各節の決まりのとおり。共有のキャッシュにもブラウザにも残させない。ASVS V14.2.2・V14.3.2)。
  画面の文書の応答には、生成したリクエスト前段が付ける(nonce の CSP を使うので、画面は全部要求ごとに描画する —— 根のレイアウトが `await connection()` を待つ)。
- **してはいけないこと: CORS の応答ヘッダ(`Access-Control-*`)を書く。** アプリは他のオリジンへ読ませる API を持たない。製品の木の全域で ESLint
  `layer/no-cors-header` が止める(免除の一覧は無い。ASVS V3.4.2)。
- **すべきこと: 本文のある応答は `jsonResponse` / `textResponse`(`@kaninabe/runtime/http/response`)で作る。** `Content-Type` に charset を必ず付ける
  (`application/json; charset=utf-8` / `text/plain; charset=utf-8`)。`Response.json(…)` と、charset を字面に書いていない本文つきの `new Response(…)` は
  ESLint `layer/require-charset-response` が止める(製品の `src` のテスト以外と、仕組み側の `src`。字面で通るのは `application/json` と `text/plain` の charset つきだけ。本文を持たない応答 — `new Response(null, …)`・204 — は素の `Response` でよい。転送は次の項。ASVS V4.1.1)。
- **してはいけないこと: Route Handler から HTML を返す(点検 11 回目 B11-3)。** Route Handler の応答には文書の口の nonce の CSP が付かず、リクエスト前段の matcher も `api/` を外すので、
  値を埋めた HTML は反射 XSS になり、本文の `<meta refresh>` は `Refresh` の閉世界の外の転送になる。出口の関所 `guardRoute` が `Content-Type` の閉じた表で止める —— 通すのは
  `application/json`・`text/plain`(付加情報は `charset` だけ)と、見出しも本文も無い応答だけで、`text/html`・`application/xhtml+xml`・`image/svg+xml`・本文があるのに型の無い応答・2 本の畳み込みは、
  型の値に関係なく転送と同じ行き先の無い 500 にし、セキュリティログに `response_type_refused` を 1 行書く。人に見せる画面は画面の口(CSP が付く)で作る。HTML を宣言する形は無い。
- **してはいけないこと: 口の応答を共有のキャッシュに載せる(点検 12 回目 B12-4)。** `api/` はリクエスト前段の no-store の外にある。`guardRoute` は `Cache-Control` の値を閉じた表(`no-store`)に限り、
  `public`・`s-maxage` などは行き先の無い 500 にして、セキュリティログに `response_cache_refused` を 1 行書く。見出しの名前も閉じた表 `ROUTE_RESPONSE_HEADERS`(`Cache-Control`・`Clear-Site-Data`・`Content-Disposition`・`Content-Type`・`Location`・`Set-Cookie`)に限り、
  表の外(`Edge-Control`・`X-Accel-Expires`・`CDN-Cache-Control`・`Surrogate-Control` など)は値に関係なく同じ 500 にする。例外は認証基盤のクライアントが添えるキャッシュを止める 2 本で、`Expires: 0`・`Pragma: no-cache` の値だけを通す(`ROUTE_NO_CACHE_HEADERS`。点検 13 回目 B13-6。キャッシュの指示の名前は CDN ごとに増えるので、禁止の表をやめた)。
  見出しの無い応答は通す。公開データを CDN に載せたい日は、設計の決定として別に扱う。
- **してはいけないこと: `public/` に文書を置く(点検 13 回目 B13-7)。** `public/` は `src/app` の外から同じオリジンで配られ、`public/api/x.html` は前段の CSP の外の文書になる。J2 が拡張子を閉じた表(画像と書体。`STATIC_ROOT`)に限る。
- **ダウンロードは宣言する。** 表の外の型を出せるのは、口が `guardRoute(h, { attachmentTypes: [{ type: 'text/csv', reason: '…' }] })` と**字面の型と理由**を書いた口だけで(J2 が形を見る)、
  宣言できる型は `ATTACHMENT_RESPONSE_TYPES`(`text/csv`・`application/pdf`・`application/zip`・`application/octet-stream`。ブラウザが実行しない型)に閉じる。応答は `attachmentResponse(本文, 型, init)` で作る
  (`Content-Disposition: attachment` が必須。無ければ関所が止める)。
- **すべきこと: 全部の口の HTTP メソッドを出口の関所 `guardRoute`(`@kaninabe/runtime/http/route-guard`)で包む(ASVS V3.7.2。点検 10 回目 B10-1)。**
  形は `export const GET = guardRoute(async (request: Request) => { … });` の 1 つだけ(J2 が構文木で見る。`export async function GET`・`export { h as GET }`・
  再輸出・`let` は包まれていないと数えて error)。関所は口が返した応答の `Location` / `Refresh`(大文字小文字を問わない)と、口が投げた転送の合図
  (`NEXT_REDIRECT`)を外へ出す直前に見て、`Location` は `safeReturnPath` を通る同じオリジンの相対パスだけを通す。`Refresh` は値に関係なく止める。通らなければ
  口の応答を捨てて**行き先の無い 500**(本文・応答に載った `Set-Cookie` なし・`no-store`)を返し、セキュリティログに `redirect_refused` を 1 行書く(値は載せない。`next/headers` の `cookies()` の書き込みだけは
  Next.js が返した応答に後から足すので 500 にも残る。点検 11 回目 B11-4)。**転送の主の守りはこの実行時の
  1 か所**で、下の lint の規則は早めの知らせである(綴りを追う規則は、小文字の鍵を変数に組む・`headers` を別名に取る・表への代入のような兄弟の書き方を取りこぼす)。
  外の行き先の例外は**認証の `start` の口だけ**が `{ externalOrigins: signInRedirectOrigins }`(認証基盤の接続先のオリジン 1 つを返す関数。adapter の
  `authRedirectOrigins`)で持てる(IdP の認可の URL への 303)。ほかの口が持つと J2 の error。生成の見張りテスト(`browser-defense.test.ts` の 6 本目)は、宣言した全部の口の
  全メソッドが包まれていること(`isGuardedRoute`)と、関所が `Location: https://evil.example` と `text/html` の応答を止めることを実物で叩く。
  リクエスト前段(`proxy.ts`)は Route Handler の応答を見られない(前段は口より先に走って口の応答を受け取らず、matcher も `api/` を外す)ので、関所にはしない。
  Server Component / Server Action の `redirect()` は Route Handler の応答ではない(Next.js が描画の中で転送に直す)ので関所を通らない —— そちらは唯一の部品
  `safeRedirect` が実行時に同じ核を通し、生の `redirect` は lint が止める。
- **すべきこと: 転送は安全な転送の部品だけで作る(ASVS V3.7.2。点検 9 回目 B9-1〜B9-6)。** Route Handler の転送の応答は `safeRedirectResponse(行き先, { fallback, status, headers })`
  (`@kaninabe/runtime/http/redirect`。既定 303・本文なし・`Location` は相対パスのまま)、Server Component / Server Action の転送は `safeRedirect(行き先, { fallback, permanent })`
  (`@kaninabe/runtime/navigation`)、クライアントの遷移は `useSafeNavigate()` の `push` / `replace` / `assign`(ページ全体の読み直し)/ `refresh`
  (`@kaninabe/runtime/navigation/client`)。どれも行き先を `safeReturnPath`(同じオリジンの相対パスだけ。`//`・`/\`・スキーム・制御文字・正規化で `//` に畳まれる綴りを拒む)に通し、
  通らなければ書いた人の既定の行き先(`fallback`。既定は `/`)に倒す —— 利用者の値(`?next=`)をそのまま渡してよい。cookie を書く転送は、部品が返した応答に
  `Set-Cookie` を足す(`response.headers.append('Set-Cookie', …)`。値は配線の部品が約束の属性で組む)。
- **してはいけないこと: 生の転送の口を使う。** `next/navigation` の `redirect` / `permanentRedirect` / `useRouter`、`next/router`、`NextResponse.redirect`、`Response.redirect`、
  見出しの `Location` / `Refresh`(オブジェクトの鍵は**位置を問わず**大文字小文字を問わない・`x['Location'] = …` の代入・`.set` / `.append` は**相手を問わず**第 1 引数の名前で見る。
  値が関数の `refresh` の鍵は見出しではない)、`location` への代入と `assign` / `replace`(`document.defaultView` 経由も)、
  `window.open`、`<meta http-equiv="refresh">` は、渡す値に関係なく ESLint `layer/require-safe-redirect` が止める(別名・名前空間・再 export・動的 import も。
  例外は仕組みの部品自身の実装ファイルの許可表 `SAFE_REDIRECT_PARTS` だけで、行はパッケージとファイルの組で当たる。製品の木には無い)。セッションの adapter の
  生の転送の部品は公開の入口から出さず、ログアウトの着地(`landingPath`)とサインインの失敗の着地(`failurePath`)は同じオリジンの相対パスでなければ口が例外になる(B10-2)。生成した経路の組み立て `screenPath` は値を 1 セグメントに閉じ込める
  (`encodeURIComponent`。空・`.`・`..` は例外)ので、ID や slug を利用者の値から渡しても経路の外へは出ない。
- **すべきこと: 外の URL を呼ぶ `fetch` は `safeFetch`(`@kaninabe/runtime/http/safe-fetch`)だけを使う。** `redirect: "error"` に固定してあり、呼び先の 3xx について行かない(`TypeError` で失敗する)。
  グローバルの `fetch` の直接の使用は ESLint `layer/require-safe-fetch` が止める(外部連携のアダプタの住所 `src/infrastructure/**` と仕組み側の `src`。SDK へ `fetch` を差し込む口 —
  Supabase の `global.fetch`・AI の SDK の `fetch` — にも `safeFetch` を渡す。ASVS V15.3.2)。
- **`safeFetch` は枠のデータのキャッシュに載せない(点検 12 回目 B12-2)。** `cache` は `"no-store"` に決め直し、`next` は渡さない(型にも無い)。枠の共有の保存の鍵は実行者を知らないので、
  `unstable_cache`・`'use cache'`・`revalidate` の export と合わせて全部閉じてある(`layer/closed-framework-surface`。行き先は enforcement-matrix の S9)。
- **してはいけないこと: 外へ送る口を置き場の外で使う(点検 10 回目 B10-3)。** 外へ送る口の閉じた表(`safeFetch`・`node:http` / `node:https` / `node:http2` / `node:net` /
  `node:tls` / `node:dgram` / `node:dns`・`undici`。正は spec-tools の `outbound-primitives.ts` の 1 か所)は、外部連携の `adapter_root` と土台の下でだけ値として引ける
  (X1 の (d) と ESLint の `layer/outbound-primitive-home` が同じ表を見る。表は生成物 `sdk-homes.json` の `outbound`)。グローバルの `fetch` / `WebSocket` / `XMLHttpRequest` /
  `EventSource` も、置き場の外では `layer/no-external-network` が止める(免除の住所は基盤の層の全部ではなく置き場だけ)。REST で叩く相手も external.md の
  `vocabulary.service` に `adapter_root` を宣言し、アダプタをそこに置く。
- **サインインの開始とログアウトの口は、セッションの adapter を呼ぶだけにする。** ログインのトークンはサーバーだけが持つ(セッションの cookie は `HttpOnly`)ので、
  ブラウザの認証基盤のクライアントでは始められず閉じられない。口は出どころを確かめたあと配線(Composition Root)を呼び、配線がセッションの adapter
  (`@kaninabe/adapter-supabase-session` の `startSignIn` / `signOut`)へ製品の値を渡す。ログアウトは**この端末のセッションだけ**を閉じ、認証の cookie を全部消して
  `Clear-Site-Data: "cache", "cookies", "storage"` と `no-store` を付けた 303 でログイン画面へ送る(ASVS V14.3.1)。画面はフォームの `POST` で叩く(スクリプトは要らない)。

### 中身

- **すべきこと:** 本体は次の 3 つだけで構成する。
  1. **認可**: 呼び出し元を確かめる。失敗したら即座に返す。
  2. **委譲**: `src/composition` の Composition Root から関数を得て呼ぶ。
  3. **応答**: 結果をそのまま返す。
- **してはいけないこと:** 業務ロジック・状態や権限の判定・SQL・外部 SDK 呼び出しを書く（ARCH-BE-0001 の「`src/app` にロジックを置かない」）。`src/operation` / `src/infrastructure` を直接 import しない（[enforcement-matrix.md §B12](./enforcement/enforcement-matrix.md) で機械執行。保証台帳の `route_handler_no_writes` の見張りテストが (旧製品の保証台帳の行)）。
- **してはいけないこと:** リクエストのボディを信用して処理内容を切り替える。可変にしてよいのは、口ごとに意味の決まった値（時間予算・件数）だけとし、既定値は実装側に持つ。

### 認可

- **すべきこと:** 人間のセッションが無い口は、**環境変数の共有秘密**をヘッダで照合する。Vercel Cron の形（`Authorization: Bearer {CRON_SECRET}`）に合わせる。
- **すべきこと:** 秘密が**未設定なら閉じる**（403 を返す）。「設定していないので素通し」は事故の形として最悪であり、既定は常に閉じる側に倒す（PRIN-0009）。**短すぎる秘密（32 文字未満）も未設定と同じに閉じる。**
- **すべきこと:** 秘密の照合は**定数時間**で行う（`===` で比べない。両辺の SHA-256 を `timingSafeEqual` で比べると、長さの違いも応答の時間に出ない）。製品では `operation/shared/cron-auth.ts` の `isCronAuthorized` が唯一の実装で、各口はそれを呼ぶ。
- **すべきこと:** 認可の失敗は 403 とし、理由を本文に書かない。どの条件で落ちたか（未設定なのか不一致なのか）を外に出さない。
- **してはいけないこと:** 秘密をコードに埋め込む。クエリ文字列で受け取る（URL はログに残る）。
- **例:**

```ts
// app/src/app/api/jobs/run/route.ts
function authorized(request: Request): boolean {
  // 未設定・短すぎる秘密は「閉じている」。照合は定数時間（SHA-256 を timingSafeEqual で比べる）。
  return isCronAuthorized(process.env['CRON_SECRET'], request.headers.get('authorization'));
}
```

### Cron から起動される口

- **すべきこと:** メソッドは **`GET`** にする。**Vercel Cron は GET しか送らない**（`vercel.json` の `crons[]` に書けるのはパスとスケジュールだけで、メソッドは選べない）。「状態を変える起動は POST」の原則より、**外部の実行系の制約が優先される** — POST で待ち構えても Cron は 405 を受け取るだけで、口が動かない。
- **すべきこと:** GET に置く条件として、口が**冪等である**こと（何度叩かれても結果が変わらない）を満たす。ジョブワーカーも締切走査も「実行できるものが無ければ何もしない」形なのでこれを満たす。冪等でない処理を Cron 起動にしたくなったら、その処理の設計のほうを直す。
- **してはいけないこと:** 「GET だから安全」と考えて認可を省く。閉じているのは共有秘密であり、メソッドではない。
- **すべきこと:** 起動の登録は `app/vercel.json` の `crons[]` に書く。**登録がコードと同じリポジトリにある**ことが要点で、口を足したのに登録が無い（＝永遠に呼ばれない）状態をレビューで見つけられるようにする。
- **すべきこと:** ローカルでは Cron が無いので `curl` で叩く。`CRON_SECRET` は `.env.local` に置く。

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/run
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/deadlines/run
```

- **すべきこと:** 200 の応答に `Cache-Control: no-store` を付ける。`dynamic = 'force-dynamic'` が縛るのはこのルートの**実行**であって、間に立つ CDN・プロキシの保存ではない。GET は既定でキャッシュ可能なメソッドなので、明示的に断る。
- **すべきこと:** 1 回の起動で扱う量に上限（時間予算・件数）を置き、**残りは次回に回す**。関数の実行上限（`maxDuration`）はプランと実行環境で変わり、既定は 10〜15 秒台である。上限に達して切られても壊れない（ジョブはリース切れとして、締切は次の走査で拾い直される）が、毎回途中で切られる状態は正常ではない。
- **[裁定済み。2026-09-06]** 実測で Hobby プランの Vercel Cron が「1 日 1 回まで」の制約を持つことを確認した（`*/10` の宣言でデプロイ自体が拒否された）。`api/jobs/run` と `api/deadlines/run` は `app/vercel.json` の登録から外し、Supabase の pg_cron + pg_net から同じ口を `*/10 * * * *` で叩く形に変えた（job_spec の `scheduler: database`。[ADR-0010](../../../../../decisions/common/ADR-0010-pg-cron-vercel-trigger.md)）。**この節が定める Route Handler 側の形（GET・冪等・共有秘密照合）はどちらの叩き方でも変わらない** — 呼び出し元が Vercel Cron か pg_net かの違いは `Authorization: Bearer {CRON_SECRET}` ヘッダの送信元が変わるだけで、口の実装には影響しない。`export const maxDuration` を明示するかは未決のまま残る。

#### 口の名前（`api/{領域}/{動詞}`）

現物(2026-09 時点、Cron 起動口として存在する 3 本。うち `app/vercel.json` に登録済みなのは `api/tutorial/sync` の 1 本で、残り 2 本は pg_cron + pg_net から叩く)から起こした規則。**受信 Webhook の口はこの規則の対象外である**(下の §受信 Webhook の口。生成物であり、名前は相手が叩く URL として決まる)。

| 口 | 動詞 | その口がすること |
|---|---|---|
| `api/jobs/run` | `run` | outbox（`jobs` テーブル）から**期限が来たものを取り出して処理する**汎用ワーカー |
| `api/deadlines/run` | `run` | 期限（`loan.due_at` 等）を**走査して超過分を遷移させる**汎用ワーカー |
| `api/tutorial/sync` | `sync` | チュートリアルの元文書を**外部から取り込んで全入れ替えする**、単一の具体操作 |

- **すべきこと:** 動詞は**その口が実際にする操作**を表すものを選ぶ。`run` に固定しない。
- **`run` を使うのは「対象を走査して、期限が来たものだけ処理する」形の口だけ**である。`jobs/run` と
  `deadlines/run` はどちらも「何が実行できるかは呼ばれてみないと分からない（0 件のこともある）」
  **汎用ワーカー**であり、`run`（実行する）以上に具体的な動詞を与えられない（実行する内容は口の中で
  さらに分岐する）。2 本とも同じ形になったのは偶然の一致ではなく、Cron 起動口の主要な用途が
  「取りこぼし掃除役」（ARCH-BE-0015）であることの反映である。
- **`tutorial/sync` は `run` に合わせない（裁定済み。2026-09）。** 対象が 1 つに決まっていて
  （チュートリアル文書）、行うことも 1 つに決まっている（外部から取り込んで置き換える）具体操作
  であり、`sync`（同期する）のほうが `run` より実際の処理を正確に言い当てている。**`api/{領域}/run`
  は「命名規則の唯一の形」ではなく、「汎用ワーカーがたまたま 2 本とも run になった」結果である。**
  規則は**「動詞で終わる 2 階層」の形（配置節）・汎用ワーカー（走査して期限が来たものだけ処理する
  形の口）は `run`・それ以外の具体操作は意味の通る動詞を選ぶ**、の 3 点で確定する。語彙そのものを
  閉じた集合にはしない（新しい具体操作が増えるたびに動詞を機械的に選べるようにするため）。
- **してはいけないこと:** 動詞を省略する、または名詞のままにする（`api/tutorial` 単体など）。
  Route Handler の配置節（`api/{領域}/{操作}/route.ts`）がそもそも 1 ファイル 1 操作を前提にしており、
  操作を示さない口は「何をする口か」が URL から読めない。

### 受信 Webhook の口（`api/inbound/{連携 ID}`）

**この口は手で書かない。** `external_spec`（`docs/specs/backend/external.md`）に
`direction: inbound` の行を 1 本足すと、Route Handler（`app/src/app/api/inbound/{連携}/route.ts`）と
その配線（`app/src/composition/inbound/{連携}.ts`）と、記録と遷移を 1 トランザクションで起こす RPC
（`supabase/migrations/{migration}`）が**生成される**。手で書くのは相手の本文を読むアダプタだけで
ある（正は [ARCH-BE-0014](../../../../../architecture/system/backend/ARCH-BE-0014-external-integration.md)
§インバウンド、書き方は
[external-spec-writing.md](../../../specification/standards/external-spec-writing.md)）。

- **名前は `api/inbound/{連携 ID}` であり、動詞を持たない（裁定済み。2026-09-12）。** 上の
  「動詞を省略しない」の**唯一の例外**である。理由は 2 つ。
  1. **URL を決めているのはこちらではない。** これは相手の管理画面に登録する宛先であり、
    **1 連携につき 1 本**という別の理由で形が決まる。相手が叩く 1 本の URL に、こちらの操作名を
    載せる余地が無い。
  2. **動詞を足しても情報が増えない。** 受信の口がすることは連携によらず同じ（署名を検証して
    受信の RPC を 1 回呼び出す）なので、`receive` のような定数の動詞が全部の口に並ぶだけになる。
    この節は「動詞は `run` に固定しない」と書いており、固定の動詞を足すのはその趣旨に反する。
  - 代わりに、`{連携 ID}` が `external_spec` の行の id と**同じ語**であることが規約である ——
    URL から仕様の 1 行に辿れる（生成器がその対応を保つ）。
- **認可は共有秘密ではなく署名検証**である（相手が誰かを本文ごと確かめる必要があるため）。方式と
  鍵は宣言（`signature` / `signature_key`）が決め、鍵が未設定なら **401 = 口が開いていない**。
  「未設定なら素通し」にしないのは Cron の口と同じ判断である（PRIN-0009）。
- **メソッドは `POST`** で、`export const dynamic = 'force-dynamic'` と応答の `Cache-Control: no-store`
  を付ける（どちらも生成物が持つ）。
- **中身の 3 行（認可・委譲・応答）は変わらない。** 生成された口は配線を 1 回呼ぶだけで、`if` を
  1 つも持たない。

### テスト

- **すべきこと:** 中身の検証は 1 段内側（Composition Root）に対する統合テストで行う（[testing/integration.md](./testing/README.md) の配置に従い `src/composition/__tests__/` に置く）。
- **してはいけないこと:** Route Handler を厚くしてから、その厚みをテストしようとする。テストしたい処理が出てきたら、それは operation に置く処理である。

## 3. 注意点・例外

- **Webhook 受信口はこの規約に加えて署名検証が要る**（ARCH-BE-0014）。共有秘密の照合だけで受けてはならない。
- **`src/app` は行カバレッジの対象外である**（`vitest.config.mts` の除外設定）。薄いことが前提であり、厚くなった時点で規約違反であって、カバレッジで守る対象ではない。
- **Cron の登録の書式そのもの（`vercel.json` のスキーマ）は Vercel の仕様であり、この規約が定めるのは「登録をリポジトリに置く」ことと「メソッドが GET になる」ことだけである。**
- **`GET` を使うのは Cron 起動の口に限る。** 外部サービスからの Webhook は相手がメソッドを決めるので、この節は当てはまらない（多くは POST + 署名検証）。ブラウザからの逐次配信も同様で、入力を body で受けるため **POST** になる。
- **逐次配信の口はカバレッジの対象外である**（`src/app/**` の除外に含まれる）。薄いことが前提であり、確かめる中身が出てきたらそれは composition / operation に置く処理である。

## 4. 関連ドキュメント

- [server-actions.md](./server-actions.md)（人間の操作を受ける経路の規約。定型 4 手順と `Result` 型）
- [ARCH-BE-0015 — 非同期ジョブ実行基盤](../../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)（ジョブワーカーの起動経路。この規約の最初の適用先）
- [ARCH-BE-0001 — app パッケージの層構成と依存方向](../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)
- [logging.md](./logging.md)（構造化ログの規約。人間のいない経路は成否とも記録する）
- [enforcement/](./enforcement/README.md)（機械執行ルールの一覧。Route Handler の配置・命名は現時点で機械執行の対象外。**operation / infrastructure の import 禁止は B12 で執行**）
- [testing/](./testing/README.md)（テスト規約）
