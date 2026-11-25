---
doc_type: decision
scope: common
id: ADR-0017
status: accepted
targets: [spec_dsl, verification]
date: 2026-10-08
norms: [PRIN-0001, PRIN-0006, PRIN-0007, ADR-0003, ADR-0010]
---

# ADR-0017: HTTP の入口の宣言の置き場 — 認証の `callback` と外部連携の `endpoints`

## Status

accepted (2026-10-08)

---

## Context

### 背景

実装の木の HTTP の入口(Route Handler = `route.ts`)は、**仕様のどれかに宣言されているべき**である。口は認可を持たなければ誰でも叩けるので、宣言の無い口には認可の検査も衝突の検査も届かない。ところが宣言の置き場があったのは 2 種類だけだった。

- Cron が叩く口 … ジョブの `endpoint`([ADR-0010](./ADR-0010-pg-cron-vercel-trigger.md))
- 受信 Webhook の口 … 外部連携の `direction: inbound` の行(口そのものが生成物で、URL は `/api/inbound/{連携 ID}` に決まる)

残りの手書きの口 3 本(OAuth の帰り道 `api/auth/callback`・AI の応答を逐次配信する `api/ai/tutorial` と `api/ai/hold-draft`)は、**宣言する置き場がどの仕様にも無かった**。その結果、カタログに載らない口に認可なしの `GET` を足しても、検査は全部緑のままだった(網の穴探し 2026-10-06 m01f)。口の閉世界(実装の木の全入口が宣言のどれかに当たる)を検査にするには、先に「手書きの口を宣言する置き場」を決める必要があった。

### 前提条件

- 手書きの口は無くせない。OAuth の帰り道は認証プロバイダのリダイレクトの契約であり、AI の応答の逐次配信は Server Action では表せない([route-handlers.md](../../process/backend/system/standards/conventions/route-handlers.md) の例外)。
- 宣言の中身は **URL の文字列だけ**でよい(認可・応答の形は規約が決める)。URL は中立に書き、置き場は配置が決める(ジョブの `endpoint` と同じ)。
- 拡張の手順は [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) に従った。下の「トリアージの記録」がその結果である。

### トリアージの記録

- **手順 0(宣言の欠落として 1 行に)**: auth_spec に OAuth の帰り道の口の URL、external_spec の送信の連携に「その連携を使う手書きの口」の URL を書きたいが、文法に無い。書きたい形は `callback: {endpoint: /api/auth/callback}` と `endpoints: [/api/ai/tutorial, /api/ai/hold-draft]`。「書いたのに効いていない」(検査の穴)ではなく、**宣言の欠落**である。
- **手順 1(迂回パターン集)**: P-1〜P-10 に該当なし。形が近いのは P-10(規約で禁止 = 要求の棄却)で、BACKLOG のもう一つの案(route.ts に印を要求する)にあたるが、印を route.ts の側に置くと**仕様が正から外れる**(正は実装に移る)ので採らない。
- **手順 2(別の見方)**: キャッシュ・運用・告知の安定性は無関係。「不在による安全」(口を置かない)は、上の前提のとおり置かない選択ができない。**安い形は見つからなかった**(下の却下した 4 案がその探索の記録)。
- **手順 3(2 実例)**: 数えるものを 2 つに分けて書く。
  - **一般化した問題**(HTTP の入口に仕様上の持ち主が無い)には、**認証(OAuth の帰り道)と外部連携(AI の応答を配信する口)という別の doc_type で起きた独立した 2 実例**がある。
  - **欄ごと**に見ると、`callback` はマッピング 1 個・`endpoints` は URL のリストで、**各欄は単独では 1 実例**である(欄ごとに「同じ欄の独立 2 実例」は満たしていない。doc_type が違うことを、各欄の 2 実例の達成とは数えない)。
  - **それでも 2 欄を 1 つの最小の拡張として採った根拠**(手順 3 の「同じ拡張の独立 2 実例」を、拡張を欄でなく**「HTTP の入口の宣言の置き場」**という 1 つの形として読む):
    1. 2 欄は同じ形(持ち主の仕様に、**URL の文字列だけ**を書く。認可・応答の形は規約が決める)で、検査も同じ 1 か所(J2 の衝突と閉世界。入口の宣言の全数は `entry-declarations.ts` が 1 か所で作る)に載る。欄ごとに別の拡張を 2 回する場合より語彙も検査も増えず、既存の 2 つの宣言(ジョブの `endpoint`・受信口)と並ぶ 4 つ目・5 つ目の置き場として揃う。
    2. **片方だけ採ると閉世界が閉じない。** `callback` だけ採れば AI の口 2 本が、`endpoints` だけ採れば OAuth の帰り道が、宣言の無い口として残る。閉世界(実装の木の全入口が宣言に当たる)は全部の手書きの口に置き場があって初めて検査にできる。
    3. **片方の欄ずつ入れる運びにすると、もう片方の欄の口が宣言の無いまま実装の木にある期間ができ、その間は未宣言を許す例外(免除の語)が要る。** 手順 3 の注意点の例外(「いま入れないと後から入れられない」。実装とテストに固着してから直すと全面改修になるもの)に近い事情で、2 欄を一度に入れれば免除の口を作らずに済む(閉世界の目的に反する例外を持ち込まない)。
  - **ただし同じ製品の中の 2 種類であり、別プロジェクトでの再現ではない**(Negative に残し、2 つ目の製品で再点検する)。
- **手順 4(決定可能性)**: 変数は URL の文字列の有限集合で、実装の木のファイルと突き合わせるだけで検査できる(列挙で足りる。[ADR-0003](./ADR-0003-constrained-spec-dsl.md) の決定は動かない)。落ちる検査は J2 の続き(下)と、パーサー(H0 / X0)。

---

## Decision

### 決定内容

**HTTP の入口の宣言の置き場を 2 つ足す。口の持ち主の仕様に、URL だけを書く。**

```yaml
# docs/specs/backend/auth.md
callback:
  endpoint: /api/auth/callback
  summary: OAuth の帰り道

# docs/specs/backend/external.md(direction: outbound の行)
- id: anthropic_chat
  direction: outbound
  endpoints: [/api/ai/tutorial, /api/ai/hold-draft]
```

1. **認証の `callback`**(`auth_spec` のトップレベル。任意。書くなら `endpoint` と `summary` が両方必須)。OAuth でないサインインの仕組みは書かない。
2. **外部連携の `endpoints`**(`direction: outbound` の行だけが持てる。任意。書くなら 1 本以上の URL のリスト)。受信の行は持てない(受信口は生成物で URL が決まるので、二重の宣言にしない。X0 が落とす)。
3. **口は宣言に載るものが全部(閉世界)**。実装の木の全ての `route.ts` は、ジョブの `endpoint`・受信口・`callback`・`endpoints` のどれかの URL に当たらなければならない。**検査は J2 の続き**(新しいルール ID は足さない):
   - 衝突 … どの 2 つの宣言も同じ URL を取らない。書き誤り(`//`・`?`・`#`・`.` / `..`)も指す。
   - 閉世界 … 未宣言の入口・1 本の URL に結べない入口(動的なセグメントの下・非公開フォルダの下)・宣言した `callback` / `endpoints` の入口の不在を error にする。宣言を読めない種類(阻害)があるときは未宣言の判定だけを保留し、実行ログで名指す。
4. **宣言が見るのは口の「分類」までである。** 口が宣言した連携を本当に呼んでいるか(`endpoints` の口が連携の IF を使っているか・`callback` の口が認証の実装を呼んでいるか)は見ない。

### 適用範囲

- `docs/specs/backend/auth.md` の `callback`・`docs/specs/backend/external.md` の送信の行の `endpoints`(題材の製品は `callback` 1 本と `anthropic_chat` の `endpoints` 2 本)。
- 検査は J2(衝突と閉世界)・H0 / X0(形)。書き方は auth-spec-writing.md / external-spec-writing.md、口の規約は route-handlers.md「口は宣言に載るものが全部」。

---

## Consequences

### Positive（メリット）

- 実装の木の全ての HTTP の入口に、仕様の持ち主がいる。宣言の無い口を足すと J2 が赤にする(認可なしの `GET` を足しても緑、が閉じる)。
- 口の URL の取り合いが、4 つの出どころ(ジョブ・受信口・`callback`・`endpoints`)を通して 1 か所で見える。
- 迂回の余地がない。書き誤りは H0 / X0 / J2 が落とし、免除の語を持たない。

### Negative（デメリット・トレードオフ）

- **語彙が 2 つ増える(`callback` と `endpoints`)。** どちらも URL の文字列だけで、書き場所は持ち主の仕様に閉じる。
- **実例は同じ製品の中の 2 種類であり、各欄は単独では 1 実例である。** 手順 3 は、問題(入口に持ち主が無い)の独立 2 実例(認証と外部連携)と、2 欄を 1 つの最小の拡張として採る根拠(同じ形・同じ検査・片方だけでは閉世界が閉じない)で採った。欄ごとの 2 実例ではなく、別プロジェクトでの再現でもない。2 つ目の製品を立てる日に、この 2 つの欄が本当に一般か(別の仕組みの口 — 例えばプロバイダ固有の追加の口 — が同じ置き場に収まるか)を再点検する。
- **口が宣言どおりの仕事をしているかは見ない。** `endpoints` の口が連携を呼んでいなくても、`callback` の口が認証の実装を呼んでいなくても緑になる(BACKLOG の宿題。ジョブの `endpoint` → 実装の到達の検査と同じ形で伸ばせる)。
- **種類ごとの認可の見張りが無い。** 手書きの口の「未ログインなら 401」「上限なら 429」は、Cron の口の 403 の生成テストに相当する見張りを持たない。
- **対象は App Router の `route.ts` の系統(`route.ts` / `route.tsx` / `route.js` / `route.jsx`)だけ。** メタデータのルート・`middleware.ts` / `proxy.ts`・Pages Router の `pages/api` は見ない(route-handlers.md に明記)。

### Neutral（その他の影響）

- 検査は配置の `http-entry` の逆引きを使うので、実装の木が無い製品(仕様だけのリポジトリ)では走らず、未実施と名指す。
- 逆引きの契約に、入口かどうかの判定(`entryOf`)とビルドの出力の名前(`buildOutputDirs`)の 2 つの任意の欄を足した(DSL の変更ではない。配置の契約の拡張)。

---

## Alternatives Considered

### Option 1: `job.endpoint` に callback と AI の口を載せる

- **Pros**: 新しい語彙が要らない。
- **Cons**: ジョブでないものをジョブとして扱わせる(ジョブの検査 — Cron の登録・起動口の接地 — が偽の対象に掛かる)。
- **Why rejected**: 別の概念を 1 つの宣言に畳むと、どちらかの意味が壊れる。

### Option 2: 受信口(`direction: inbound`)として載せる

- **Pros**: 外部サービスと結ぶ口を、既存の連携の宣言で表せる。
- **Cons**: 受信口は口そのものが生成物で、URL も `/api/inbound/{連携 ID}` に決まる。手書きの口を載せると生成物との二重の宣言になる(署名・イベント ID 台帳の宣言も要求される)。
- **Why rejected**: 受信口は「生成物の口」の宣言であり、手書きの口の置き場ではない。

### Option 3: screen_spec の `navigations` / `emits` に口を持たせる

- **Pros**: 画面から叩く口(AI の 2 本)は画面の語彙で表せるように見える。
- **Cons**: `callback` は画面ですらない。画面の語彙(遷移・発火元)を広げることになり、広げる範囲が 2 つの欄より大きい。
- **Why rejected**: 語彙の拡張として最も高く、片方の口にしか効かない。

### Option 4: 配置の値(後段)に許可リストを持たせる

- **Pros**: 仕様の語彙は増えない。
- **Cons**: 宣言が仕様の外(後段のコード)に出る。仕様が正という大原則(PRIN-0001)から外れ、人間レビューの入口(仕様とハンドブック)に口が現れない。
- **Why rejected**: 正を仕様の外に移す。

---

## Implementation

### Tasks

- [x] 型・パーサー(`callback` / `endpoints`)・H0 / X0 の形の検査
- [x] 入口の宣言の全数(`job/entry-declarations.ts`)・J2 の衝突の拡張・J2 の閉世界(`j2-entry-closed.ts`)
- [x] auth-spec-writing.md / external-spec-writing.md / route-handlers.md・題材の製品の `auth.md` / `external.md`
- [x] 閉世界の走査を URL のセグメントを飛ばさないものにする(ビルドの出力の名前は配置が宣言する)・`route.tsx` / `route.jsx` を入口に数える

### Timeline

- 開始: 2026-10-08
- 完了: 2026-10-08

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: ADR-0003(表現力を制限し列挙ベース検証を採用する。URL の有限集合なので列挙で検査できる)/ ADR-0010(ジョブの `endpoint` の由来。`callback` / `endpoints` はこれと並ぶ「入口の URL の宣言」)/ ADR-0016(同じ手順 0〜4 で DSL を広げた先例。手順 3 を 1 製品の中の数で数えた点も同じ)
- **Blocks**: None
- **Blocked by**: None

---

## References

- [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) — 拡張の手順(0〜4)
- [auth-spec-writing.md](../../process/backend/specification/standards/auth-spec-writing.md) — `callback`
- [external-spec-writing.md](../../process/backend/specification/standards/external-spec-writing.md) — `endpoints`
- [route-handlers.md](../../process/backend/system/standards/conventions/route-handlers.md) — 口は宣言に載るものが全部

---

## Notes

**閉世界の走査は URL のセグメントを飛ばさない。** 口の URL は `/api/build/hook` や `/.well-known/openid` のように、`build` / `coverage` / ドット始まりの名前を含みうる。一般のファイル走査が飛ばす名前(ビルドの出力・依存・ドット始まり)をそのまま使うと、実在する口が黙って検査の外に出る(閉世界の穴)。そこで、この走査が飛ばすのはパッケージの置き場(`node_modules`)と、配置が宣言するビルドの出力の名前だけにした。宣言した口の不在の判定も、未宣言の判定と同じ走査の結果を URL で突き合わせる(route group の下・`route.js` の実体を偽の赤にしない)。

**1 本の口は 1 つの宣言にだけ書く。** 同じ URL を 2 つの連携の `endpoints`(あるいは `endpoints` と `callback`)に書くと、J2 が衝突として指す。複数の連携を呼ぶ口は、持ち主を 1 つに決めてそこにだけ書く。
