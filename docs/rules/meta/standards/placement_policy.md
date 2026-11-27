---
doc_type: meta
scope: repository
decisions: [ADR-0005]
---

# 配置ポリシー — doc_type と scope から置き場所を一意に決める

この対応表は、**「何の文書か」が決まった時点で「どこに置くか」が機械的に決まる**ようにするためにある。置き場所に判断の余地を残すと、同じ種類の文書が 2 か所に散り、探す側が全文検索に落ちる。

- `scope` の値域は **common / backend / frontend** の 3 つである(フロントマターの `scope` にはこのほか `repository` / `feature` を取りうる。値域の正は [frontmatter_policy](./frontmatter_policy.md))
- 以下の表ではリポジトリのルートを `repo/` と表記する
- 新しい doc_type を増やすときは、**この一覧と [id_policy](./id_policy.md) を同時に更新する**

## 根は製品が宣言する（doc_type: product_roots）

**置き場所の対応表は「根からの相対」で書いてある。** その根がリポジトリのどこにあるかは、リポジトリ直下の 1 枚 `repo/product.md`（`doc_type: product_roots`）が宣言する。検査器・生成器・通し実行（`legacy/spec-tools/**`）はこの宣言だけを読み、`app/` や `docs/specs/` のようなパスの綴りを 1 つも持たない（W3 が執行する）。

| 宣言する根 | 何の木か | 省略 |
|---|---|---|
| `specs` | 仕様の木（この製品の正） | 不可（無ければ P1 がエラー） |
| `book` | 生成される読み物（ハンドブック）の置き場 | 不可 |
| `generated` | 生成物の総置き場（zod・遷移表・実行計画・トークン） | 不可 |
| `migrations` | 追記専用の migration の置き場 | 不可 |
| `app` | 実装の木 | **可**（持たない製品では仕様と実装の突合を飛ばす） |
| `knowledge` | ドメイン知識（W 層） | 可 |
| `previews` | 画面の SSR プレビュー断片の置き場 | 可 |

- **製品が何かを 1 行で言う文は、根とは別のキー `summary` で宣言する**(省略可。パスではない)。「誰が何をできる製品か」を、空でない 1 行の文字列で 80 字以内に、敬体の 1 文で書く。**仕様に書かれた事実だけ**で書き(集約の `summary`・役の定義から言えることだけ。仕様に無い主張は入れない)、書かないならキーごと消す。**書いていなければ何も出ない**: 製品の名前などから文を作らず、既定の文も入れない(ハンドブックの表紙の題字の直後に、書いてあるときだけ 1 行が出る)。値は文字列として扱い、HTML・Markdown としては読まれない(生成物ではエスケープし、書き込みの出口で無害化する)。空・改行・長すぎ・文字列でない・制御文字や零幅の文字を含む値は P0 が名指しの error にする(読み方の正は `legacy/spec-tools/lib/model/product/parse-summary.ts`。上限 80 字は設計メモ(book-as-spec §1-8-2)の例に従い、ハンドブックの 1 行 40 字ほどの 2 行に収まる長さ)。題材(`legacy/spec-tools/__tests__/fixtures/samples/`)は書かなくてよい(任意の欄で、書かない製品の表紙には何も出ない)。
- **用語の台帳(M8 / M9)が追加で読む散文とスクリプトは、根とは別のキー `term_scan` で宣言する**(省略可。省略した製品はその分を読まない)。`prose_trees`(本文の全行を読む Markdown の木)/ `prose_files`(読む Markdown のファイル)/ `script_trees`(`#` コメントを読むシェルと YAML の木)/ `history`(読まない歴史の記録。名指しのファイル。末尾が `/` の項目は木ごと外す印)の 4 つで、値は相対パスの並び(`/` 始まり・`..`・空を P0 が拒む。末尾の `/` は `history` だけ許す)。開発用リポジトリだけにある置き場(設計メモ・引き継ぎ文書・案内・フック・CI)の綴りを、仕組みのコードに持たせないための口である(読み方の正は `legacy/spec-tools/lib/model/product/parse-term-scan.ts`・走査範囲は [term-ledger-writing.md](../../process/common/specification/standards/term-ledger-writing.md))。
- **手書き層の置き場は宣言しない。** hooks / computes / 器 / `_screens` が実装の木のどこに並ぶかは仕組みが形として決めていること（`legacy/spec-tools/lib/model/framework-dirs.ts` の土台の宣言 + 仕様が決める集約名）であり、製品が選ぶことではない。ここに書くと同じ事実の正が 2 つになる。
- **採る仕様の種類は `uses` で宣言する**(根とは別の軸。値域は仕組みが固定する閉じた一覧: `actions` / `queries` / `data_tables` / `notifications` / `jobs` / `config` / `auth` / `guarantees` / `external` / `api` / `screens` / `usecases` / `ux_principles` / `design_tokens`。値域の正は `legacy/spec-tools/lib/model/product/uses.ts`)。`roots` が「木がどこにあるか」なら、`uses` は「その木のどの種類を採るか」である。**既定値は無く、ファイルの有無から推定しない**(`uses` が無い宣言は P0 が落とす。何も採らない製品は `uses: []`)。**宣言と置き場の食い違いは両方向とも P2 が error にする** —— 採ったのに置き場に仕様が無い(その種類を要る検査が空振りする)/ 置き場に仕様があるのに採っていない(書いた仕様が検査から黙って外れる)。**採る種類同士の依存も P2 が error にする**(閉じた一覧 `SPEC_KIND_REQUIREMENTS`。いまは 2 本 —— 「連携が 1 件でもあれば設定カタログも採る」(各連携が `config:` で設定を必ず挙げるので、設定カタログを採っていないと X2 が「接地先は無い」と読んで何も言わなくなる)と「受信の連携があればテーブル仕様も採る」(受信の連携が `event_id_table` で表を必ず挙げるので、テーブル仕様を採っていないと X5 の裏づけが「見られない」に落ちる)。名指しが連携 1 件ごとに生まれる依存は、外部連携カタログの中身を読んで、名指す連携があるときだけ要求する(連携 0 件のカタログは何も名指さない。数えられないときは要求を外さない)。採っていない = 事実、という基準との衝突を、検査の中ではなく宣言の段で止める。同じ種類が上の両方向の食い違いで指摘済みなら、依存の指摘は重ねない)。dir の置き場は README とテンプレート(`template.*`)だけなら「仕様がある」に数えない。採っていない種類を要る検査は実行ログに**未実施**、採ったのに読めない種類を要る検査は**阻害**と理由つきで出る(`lib/kernel/input-state.ts`。**状態つきで起動を決めている検査は、いまのところ A13(`jobs`)・A15 / A19 の `jobs` に依る部分・T2(`queries` / `data_tables`)・画面の到達を読む S13 / S16 / Y3 / Y5(`screens`)・A10(`external`)・A15 / A18 / A19(`data_tables`)・V16 / V17 / V18(`actions`)・V17 / V19(`data_tables`)・A 群の action_spec が前提の検査全体(`actions`)・Y8 / Y10 / Y12(`data_tables`)・X1(b) / X5(a)(`data_tables`)・T 群の `data_tables` 自体と T6 / T11 / T12 が裏づけに読む `actions` / `jobs` / `usecases` / `external` / `api`・X 群の `external`・画面の到達の `auth` の関門だけ**で、14 種の検査が全部 `uses` で制御されているわけではない。他の検査は 1 本ずつ移す。下の「`uses` の移行と、状態つきの検査の範囲」)。
- **実装の範囲は `implemented` で宣言する**(省略可。根とも `uses` とも別の軸で、「どの仕様まで実装したか」を言う)。値は仕様の id の文字列の一覧で、種類も wildcard も無い(wildcard は新しい仕様を自動で範囲に入れる)。**キーが無ければ範囲は「全部」で、既存の製品は何も変わらない。`implemented: []` は「何も入れない」で、キーが無いのとは別である。** 値が壊れていれば P0 が落とし、範囲は「全部」として扱う(壊れた宣言を「何も入れない」や「一部」と読まない)。書ける id は、実装の木との突合の不在を範囲で外せる持ち主の id だけで、知らない id・`uses` に無い種類の id・何も持たない id は P13 が落とす。範囲は広がる向きにしか動かず、P14 が base の宣言と id で比べる。範囲で外せる検査は閉じた一覧で、enforcement-matrix の C26 が正である。
- **宣言ファイルはリポジトリ直下に置く。** 仕組みはこのファイルを上へ探してリポジトリルートを決める（`legacy/spec-tools/lib/io/paths.ts` の `detectRepoRoot`）。宣言を仕様の木の中に置くと、その木の住所を知るための綴りが別に要って循環する。
- **仕様だけを持つリポジトリは正当な形である。** `app` を省略すれば「仕様と実装の突合」を行う検査（X1 / J2 / G8 / S7 / A11 …）は**エラーにせず飛ばす**。判定は `appGrounded()` 1 本が持ち、宣言が無い（別スタック）と宣言したがまだ無い（生成前）のどちらも「突合できない」で、どちらもエラーではない。
- **不在を警告しない。** 生成物・migration・読み物は `generate` が書くもので、実装の木・ドメイン知識は「まだ書いていない」が正当な状態である。範囲が縮んだ検査は各群のスコープ行（「実装の木が無いため … はスキップ」）が宣言するので、P1 はそこに重ねない。

### `uses` の移行と、状態つきの検査の範囲

**`uses` が無い既存の `product.md` は、そのままでは P0 で止まる**(既定値を置かない = 破壊的変更。根も読めない扱いになり、以降の群はすべてスキップされる)。移行は 1 回、宣言に**実際に採っている種類**を書く。

```yaml
# 移行前(P0 で止まる)
roots: { specs: docs/specs, ... }

# 移行後 — 置き場にある種類を全部列挙する(書き漏らしも書き過ぎも P2 が落とす)
roots: { specs: docs/specs, ... }
uses: [actions, queries, data_tables, jobs, screens]

# 何も採らない製品(仕様はドメインだけ)
uses: []
```

- **何を列挙するか。** その製品の仕様の木(`roots.specs`)に実際に置き場がある種類だけ。迷ったら `npm run verify` を回す —— 置き場にあるのに書いていなければ P2 が「その種類の仕様が置き場にありますが、uses に宣言がありません」と、書いたのに置き場が無ければ「uses に … を宣言していますが、その置き場に仕様がありません」と名指す。
- **根と `uses` は別の軸。** `roots` は「木がどこにあるか」(パスの綴り)、`uses` は「その木のどの種類を採るか」。`app` を省略(実装の木が無い)しても `uses` は変わらない。逆に `uses` に種類を足しても根は増えない。
- **actions を採らない製品は正当な形。** `uses: [jobs]` のようにジョブだけを採る製品でも、A13 はジョブカタログを前提に走る(action_spec を要る検査だけが「スキップしました」と言い、行の末尾が「action_spec を要らない検査で実行したもの: A13」と実行したものを分けて言う)。

失敗メッセージの例(`npm run verify`):

```text
error [P0] uses がありません
      場所: product.md > uses
      対処: この製品が採る仕様の種類を列挙する(値は actions / queries / … / design_tokens だけ。何も採らないなら `uses: []`)。…

error [P2] jobs の仕様が置き場(docs/specs/backend/jobs.md)にありますが、uses に宣言がありません
      場所: product.md > uses
      反例: kind=jobs, places=docs/specs/backend/jobs.md
```

**範囲(いまの到達点)。** `uses` を見て起動を決めているのは**入力の状態を報告する検査**(`lib/trace/verifier.ts` の `InputStateTraceVerifier` = A13)・複数の種類を読む検査が使えなかった入力を `gaps` で返す形(`PartialInputTraceVerifier` = A10 / A15 / A18 / A19)・V 群の文脈(`VerifyContext`)の入力の状態(V16〜V19)・A 群の action_spec の入力の状態(`TraceRunOptions.actions`)・ユースケース群の文脈(`UsecaseContext`)と外部連携群の入力(`ExternalRunInput`)のテーブル仕様の入力の状態(Y8 / Y10 / Y12・X1(b) / X5(a))・T 群の入力(`DataRunInput`。テーブル仕様と裏づけの種類)・X 群の外部連携の入力・関係の層が `gaps` で使えなかった入力を返す値を読む検査(T2 = 索引の要求・S13 / S16 / Y3 / Y5 = 画面の到達)だけである。それ以外の検査は従来どおり、**各群が自分の種類を読めたか**で飛ぶ(行は「…スキップしました」)。**検査の起動はその検査の本当の前提で決める** —— A13 の前提はジョブカタログと根で、action_spec ではない。空の action_spec を作って渡す形にはしない。

| 検査 | `uses` に依る部分 | 阻害のとき |
|---|---|---|
| A13 | 検査全体(`jobs`) | 検査全体を阻害と報告し、違反は出さない(部分のモデルで検査しない) |
| A15 / A19 | **副作用(effects)を持つ操作の判定だけ**(`jobs`) | その操作の判定(計画が組めない / manual は要らない / 計算の材料が届くか)を**出さず**、操作名つきで「阻害」と報告する。副作用を持たない操作・前の段の問題・綴りの誤りは従来どおり出す |
| T2 | **索引の要求の導出**(`queries` / `data_tables`。使えなかった入力の分だけ) | 使えなかった入力の分は導かず、`T2: 未実施 / 阻害` の行で言う。使える入力の分は導く |
| A10 | **第 3 の発火元に依る判定だけ**(`external`) | **阻害**のとき、走査の宣言も免除も無いイベントの「起こす口が無い」の判定を**出さず**、イベントを名指して阻害と報告する(実装の実在・用済みの宣言・`test_cases` の突合は従来どおり)。**未選択は行を出さない**(受信を採っていなければ第 3 の発火元は事実として無い。母集合 2 本で判定する) |
| A15 / A18 / A19 | **テーブル仕様を読む部分**(`data_tables`。A15・A18 は検査全体、A19 は計画の組み立て = 材料が届くかの判定) | **未選択も阻害も**判定を出さず、見ていないことを `A15: 未実施 / 阻害` の行で言う(A19 は計算を持つ操作を名指す。綴りの誤りは計画に依らないので出す)。0 件の読込済みは実行する |
| V16 / V17 / V18 | **action_spec に依る判定**(`actions`。V16 = 入力に現れる enum の `labels` 必須・V17 の (a) = `supplied_by: db` が入力に現れないこと・V18 = `computes` と作成の `owner` の接地) | **阻害**のとき判定を出さず、阻害の行で言う(`labels` の中身の判定など action_spec に依らないものは従来どおり)。**未選択は行を出さない**(action_spec が無ければ入力に現れる欄も計算値も事実として無い。空の母集合で判定する) |
| V17 / V19 | **data_table に依る判定**(`data_tables`。V17 の (b)(c) = 機構の宣言・作成 RPC に渡す口が無いこと / V19 = `records_actor` の値の口) | **未選択も阻害も**判定を出さず、行で言う(宣言の整合など表に依らないものは従来どおり)。0 件の読込済みは実行する |
| A 群(A1〜A12 ほか) | **action_spec が前提の検査全体**(`actions`。前提が action_spec でない A13 は actions に依らず実行する) | **未選択も阻害も**実行せず、群の要約行が理由を言い分ける(「採っていない」/「採っているが渡せない」)。**読めなかった仕様があって欠けたモデルも阻害**で、読めなかった仕様のイベントを「どの action_spec にも無い」と誤報する形(A4)を出さない(**阻害にするのは仕様を落としたときだけ**。id の不一致のように、仕様は読めていて違反だけがある形は読込済みとして実行し、ほかの仕様の本物の違反を出す — 下の「阻害にする条件」)。**テスト走査(`@tc` の突合の材料)は action_spec に依らず行う**ので、action_spec が使えなくても Q / T / H / Z / X / S / Y の `@tc` 突合は止まらない。**採っていない種類は読み込まない**(置き場が無くても A0 は出ない。置き場にあるのに採っていない形は P2 が見る)。0 件の読込済みは実行する |
| Y8 / Y10 / Y12 | **テーブル仕様に依る判定**(`data_tables`。保存点の手順が呼ぶ RPC の実在と引数 / 実行計画 / 複合 RPC への写し方) | **未選択も阻害も**判定を出さず、保存点の鍵を名指した行で言う(**保存点が 1 件も無ければ行は出ない**。ユースケース仕様が読み込めているときだけ — 読めていなければ Y 群自体がスキップ)。0 件の読込済みは実行する |
| X1(b) | **内部テーブル名の分類**(`data_tables`。接続層の直下のディレクトリが `internal: true` のテーブル名に当たるか) | **未選択は事実**(内部テーブルは宣言されていない。3 分類で判定する)。**阻害は分からない**ので、どの分類にも当たらないディレクトリの判定だけを出さず、そのディレクトリを名指した阻害の行で言う(無ければ行は出ない) |
| X5(a) | **受信の RPC の接地**(`data_tables`) | **未選択も阻害も**(a) の判定を出さず、受信の連携を名指した行で言う(受信が 0 件なら行は出ない)。(b)〜(e) は従来どおり |
| T1〜T18(T 群まるごと) | **テーブル仕様そのもの**(`data_tables`) | **未選択**は従来のスキップの行(採っていなければ母集合が空という事実)。**阻害**(採ったのに置き場に仕様が無い・読めない・仕様を落とした)は T 群を**1 本も実行せず**(部分のモデルで「無いこと」を主張しない)、`T1〜T18: 阻害 — …` の 1 行で見ていないことを名指す。原因の error は T0 と P2 が出している。0 件の読込済みは実行する |
| T6 / T11 / T12 | **裏づけに読むほかの種類**(T6 = `actions`・T11 = `actions` / `jobs` / `usecases`・T12 = `usecases` / `external` / `surface`。段の `reads` が宣言する) | **阻害**のとき依る判定を出さず、段ごとに `T6: 阻害 — …は見ていません` の行で言う(T11 は action_spec が読込済みのときだけ回り、ジョブが阻害なら副作用を持つ操作を目録に載せない。T12 は surface_spec が阻害なら「grants_migration の宣言が無い」を出さない)。**未選択は行を出さない**(裏づけが無いのは事実。従来どおりその事実で判定する) |
| X1〜X6 | **外部連携カタログそのもの**(`external`) | **未選択**は従来のスキップの行。**置き場に仕様が無い・読み込みが行われていない**は `X1〜X6: 阻害 — …`。**置き場にはあるが読めない・壊れている・仕様を落とした**ときは、宣言を読む検査(X1・X2・X3・X5・X6)を実行せず(欠けた宣言で「無いこと」を主張しない)、台帳だけを見る X4 は実行して、見ていないことを `X1〜X6: 阻害 — …` の 1 行で名指す |
| S13 / S14 / S15 / S16 / Y3 / Y5 | **画面の到達の判定**(`screens` と、認証フローの関門 `auth`。Y5 は通る画面と前提の数だけ。S14 / S15 は関門 `auth` の阻害だけに依る) | 検査ごとに「未実施 / 阻害」の行を 1 本ずつ出し、**判定は出さない**(Y5 は画面と前提の予算だけ数えず、ほかの 4 指標は従来どおり。S14 は見える画面を決めず、S15 は入れるロールの判定だけ出さない ―― 遷移後の状態を弾くかは関門に依らないので従来どおり)。画面の読み込みの error(S0 / P2)は前段が 1 回だけ出す。0 枚の読込済みは阻害でなく、実行する。**認証フローの関門は、未選択なら「関門は無い」という事実で行を出さない**(`gates` を空として探索する)。**阻害なら** `auth を採っているが検査へ渡せない` と名指し、判定は出さない(関門が分からないまま探索すると、入れない画面にも入れると広く見積もってしまう)。**S16 / Y3 / Y5 の行は、ユースケース仕様が読み込めているときだけ**出す(母集合がユースケース仕様なので、読めていなければ画面が使えなくても見ていないものは無い。Y 群自体が「スキップしました」と言う)。**S13 / S14 / S15 / S16 の行は、S 群が実行されているとき(画面の置き場があるとき)だけ**出す(S 群が飛んでいれば群の「スキップしました」が同じ原因を言う。二重に数えない)。**S14 / S15 の行は関門の阻害のときだけ**出す(画面の欠けでは言わない) |
| S17 / S18 / S19 / U1 / Y2 / Y5 / Y8 / Y10 / Y12 / J2 | **他の種類から引く材料**(action_spec ・確認の要否の導出が読むカタログ〔テーブル仕様・通知・ジョブ〕・ジョブが読む画面) | **阻害だけ**を、読む検査ごとに `ID: 阻害 — <種類> を採っているが検査へ渡せない(…)ため、…は見ていません` と名指す(未選択は事実として無い。黙る。読込済みも黙る)。検査を持つ群が動いているときだけ言う。**action_spec が阻害のときは、入力欄・上書き(`ux`)を読む検査が判定を出さない**(Y2・Y8・Y10・Y12・U1。Y5 は入力と確認の数だけ数えない。S17 / S18 / S19 は元から「action_spec を読めていなければ何も言わない」ので、行で見ていないと言うだけ)。**カタログが阻害のときは、読めた分で回し**(読めない分は「無い」前提になる)、見ていない分を行で言う(テーブル仕様の落とした表は表の名前を添える)。`UsecaseContext.actions` / `UxContext.actions` は入力の状態(任意の「あれば読む」の欄で済ませない) |

A15 / A19 を全体の阻害にしなかったのは、判定の大半(接地・引数・事実の段)がジョブに依らないためである。欠けたジョブカタログを「ジョブが無い」と読んで判定すると、見ていない事実から「導出できる」「`runner: manual` は要らない」を出してしまうので、**依る部分だけを出さない**。未選択(製品がジョブを採っていない)は阻害ではなく、「ジョブが無い」という事実どおりに判定する。

**阻害にする条件は「読み込みの error が残る」ではなく「モデルから仕様を落とした」。** 阻害の意味は「モデルが欠けているので、無いことを主張する検査(A4 の「どの action_spec にも無い」・孤児の判定)が誤報しうる」であって、「どこかに error がある」ではない。ローダーは読めずに捨てた仕様・宣言の数(`dropped`。読めなかったファイル・読めなかった README の宣言)を返し、`catalogInput` は **0 より大きいときだけ**阻害(`invalid`)にする。0 なら、A0 / S0 / T0 の error が残っていても(id の不一致・表示名の重複など、読めた上での違反)読込済みとして検査を回す(その error は読み込んだ側が従来どおり 1 回だけ出す)。**どの種類のローダーも落とした行を数える**(カタログ 1 枚の中の行も含む。リストの要素・読めなかった必須のリスト・値が読めなかった閾値や宣言。`SpecReporter` の `dropRows` / `settleRows`)ので、未知のキー・id の重複のように行を落とさない error では阻害にならず、読めずに落とした行があるときだけ阻害になる(jobs・notifications・config・guarantees・api・ux_principles・design_tokens・usecases・external・auth とも。ハンドブックだけを出す入口の入力の状態も同じ数で決まり、全部入りの口と揃う)。`dropped` は必ず数のある型(`number`)で、「数えられない読み込み」という口は持たない(数えない読み込みが型で書けると、error が残るだけで阻害にする別の基準が裏口として残る)。**型違いで読み飛ばした値・既定値に戻した値(`in_transaction: "true"` のような真偽値の型違い・文字列リストの文字列でない要素・文字列でない値を持つ写像のキー)は、読み取り器(`YamlReader`)が数える**ので、パーサーが個別に数え直さなくてもよい(欠落と null は値が無いだけで数えない。`derives` / `budget` の指標の `null` は error で名指すが数えない。**注記だけの欄**〔値が検査・生成の判定に使われない任意の文字列欄。いまは design_tokens の `note`〕は `optionalNote` で読み、型違いは error だけで数えない)。**空の語彙の軸・空の `test_cases` は行を落としていない**ので数えない(error は残る)。**仕様を落とした阻害(`invalid`)は、読めた分のモデルを `partial` に持つ**: 表ごとに自己完結の検査(T 群の `needsWhole` でない段 = T4・T9・T10・T15・T17・T18)だけは読めた分で回し、欠けた表が偽の指摘を生む段(閉世界・別の表を引く・別の表が持つ宣言に接地する段)は止めて段ごとに名指す。1 つの仕様の中の一部の欄が読めなかったときは、その仕様ごと落とす(パーサーが `null` を返す)ので落とした数に入る。**テーブル仕様は表の中の行も数える**(トリガの name / function の欠け・外部キー・索引・関数ほかの行・`supplies` の要素落ち・読めなかった `handwritten` / `lookup` / `derives`)。行を落とした表は**その表ごと部分のモデルに入れず**(欠けた行を前提にする自己完結の検査 —— 例えば T17 が、トリガの行を落とした表の関数を「発火しない関数である」と言う偽の error —— を出さない)、`droppedTables` にファイル名を載せ、T 群の要約行が「読めずに落ちた表 N 件: …」と名指す。**落とした表の宣言は部分的にも信用しない**ので、その表の `test_cases` は台帳(`TcRegistry`)に載らない —— A6 の orphan 判定は、落とした表の名前空間(表の ID の系統の接頭辞 `TC-TABLE-` / `TC-DDL-` / `TC-RLS-` / `TC-EQ-` のあとに、表名〔`TC-EQ-` は entity 名の単数形も〕を 1 区切りとして含む ID。entity 名はフロントマターから名前だけ読む〔`droppedEntities`〕。保証台帳・画面など別の系統の ID は吸わない)の `@tc` を orphan と判定せず、「見ていない」と対象の `@tc` を名指す(表の 1 行を落としただけで、その表の `@tc` の数だけ偽の error が連鎖しない)。操作の属性の導出(確認の要否)が読む表のうち落とした分も、S19 / U1 / Y5 の行が表の名前つきで見ていないと言う。

**未選択の扱いは、入力ごとに「事実として無い」か「見られない」かで分ける**(取り違えると、採っていない製品に空の「未実施」が出るか、読めていない入力が「無い」と読まれて誤報が出る)。判定の母集合が入力そのもの(action_spec の `input` / `computes`・外部連携の受信の `emits`)なら、未選択は**母集合が空という事実**で、検査は空の母集合で判定を済ませており、行は出さない。判定が**入力の裏づけを見るもの**(テーブル仕様の機構・定型 RPC の引数・執行点)なら、未選択は**見られない**ので、阻害と同じく行で言う。**阻害はどちらも「分からない」**で、依る判定を出さない。

**自分の種類を検査する群(T 群 = `data_tables`・Q 群 = `queries` ほか)は、判定の母集合が入力そのもの**なので、未選択は母集合が空という事実で、行は出さない(従来どおり、各群が自分の種類を読めたかで飛び、行は「…スキップしました」)。他の群が**裏づけの先として読む**側(A15 の `data_tables`・Y8 の `data_tables`・X5 の `data_tables` など)が、入力の状態を受けて未選択も阻害も言う。ただし自分の種類を検査する群でも、**採ったのに渡せない(阻害)ことは名指す**(T 群・X 群が部分のモデルで回らず、`T1〜T18` / `X1〜X6` の行で見ていないと言う)。T 群が**裏づけに読むほかの種類**(T6 / T11 / T12)は、裏づけの先として読む側なので阻害を段ごとに言い、未選択は裏づけが無い事実として黙る(上の表)。**まだ移していないのは**、操作の属性の導出(`OperationCatalogs` の `dataTables` / `notifications` / `jobs`。S19・Y5・U 群が読む。テーブル仕様のうち落とした表の分だけは、読めた表のまま回して見ていないことを行で言う)・ユースケース群の `UsecaseInput.actions`・画面群の他の任意の欄である。

## rules 配下（doc_type: directory_guide, principle, architecture, process, decision）

| doc_type | 置き場所 |
|---|---|
| `directory_guide` | 各ディレクトリの `README.md` |
| `principle` | `docs/rules/principles/{common\|backend\|frontend}/` |
| `architecture` | `docs/rules/architecture/system/{scope}/` または `docs/rules/architecture/specification/{scope}/` |
| `process` | `docs/rules/process/{scope}/` |
| `decision` | `docs/rules/decisions/{scope}/` |

**directory_guide の補足。** 入口は 1 つとし、AI 用と人間用に分けない([ADR-0005](../../decisions/common/ADR-0005-single-entry-point.md))。README.md は常に directory_guide であり、**仕様・規約・プロセスの内容を README に書かない**。書式は [repo/docs/template.directory_guide.md](../../../template.directory_guide.md)(rules と specs に共通の 1 枚)。

**`docs/specs/` 側の README は「規範の木が無くても置ける」。** `docs/rules/` を持たないリポジトリ(仕様だけのサンプル・規約をまだ書いていない新規プロジェクト)でも、仕様の木の README は次の形で成立する —— `norms: []`(**参照が無いことを明示した空配列**。実在しない id を並べると M3 がエラーにする)と、`DG-BE-NNNN` / `DG-FE-NNNN` の id である(id の形式は体系の軸であって語ではないので、どのリポジトリでも同じ形を使う)。置く理由は 2 つに限る: **仕様側の免除・受け入れの宣言**(`unhandled` / `scans` / `unscanned` / `unseen_states` / `unexposed`)と、**標識**(否定・線引きの手書き 1〜3 行)である。**案内文としての README を仕様の木に増やさない** —— 仕様は機械の領土であり、人間の入口は生成されるハンドブック(`product.md` の `book` の根。`npm run generate` が書く)である。どちらも無いディレクトリには README を置かない(無いことは欠落ではない)。

**`docs/book/` は生成物の木であり、この節の対象ではない。** ハンドブックの全ページは `npm run generate` が書き、**表紙(`docs/book/index.html`)も含めて frontmatter を持たない** —— 生成器が id を持つと、その番号は生成器を使うどのリポジトリでも同じ番号になり、相手側の採番と衝突する(実測: 表紙に `DG-0039` / `norms: [PRIN-0006]` が固定で埋まっていた)。ハンドブックは M 群の走査ルート(rules / specs / knowledge)にも入っていない。

**architecture の 2 分。** コードと実行系の構造は `system/`、仕様書を作るレベルの構造は `specification/` に置く。層ごとの詳細は `system/backend/layers/` に置く。

**process の箱。** backend / frontend ともに **4 箱**である —— `specification/standards` / `specification/playbooks` / `system/standards` / `system/playbooks`。`system/standards/` の配下には `conventions/` を置き、backend にはさらに `layers/` を置く(**frontend に `layers/` は無い**。層構造を持つのは backend 側だからである)。なお frontend の playbooks は現状テンプレートだけが置かれており README を持たない —— 実物が要るときに README ごと足す。

**ドメイン知識(W)は rules 配下に置かない。** `domain_glossary` / `domain_invariant` / `domain_example` / `domain_design_context` は業務知識であり、規範ではなくプロジェクトの所有物である。住所は `docs/specs/` の隣の **`docs/knowledge/`**(下記)であり、`docs/rules` には置かない。

## 個別のコーディングルールと例の置き場所

### 個別のコーディングルール

原則の適用としての「ここでは〇〇する」(コメントを必須にする、エラーログの位置、テストの規約)は **conventions** に置く。

- backend: `docs/rules/process/backend/system/standards/conventions/`
- frontend: `docs/rules/process/frontend/system/standards/conventions/`

README は directory_guide とし、`norms` に上位の規範を明示する。配下は `logging.md` / `server-actions.md` / `testing/` のように主題ごとに分割する。位置づけは principles の適用であり、process の一種なので process 配下に置く。playbooks からは「参照する規約」として引く。

### 層ごとの説明とコード

backend は `docs/rules/process/backend/system/standards/layers/` に**層 = ディレクトリ**で置く(`domain/` `operation/` `composition/` `infrastructure/` `presentation/`)。各層に README.md(directory_guide。`norms` で architecture を参照する)と、責務ごとの `xx.md` を置く。

**architecture と process の役割分担は次のとおりである。** 層の構造・責務・配置先を決めるのは architecture、実装方法と実装例を書くのは `process/.../layers/{layer}/` である。architecture 側の層文書からは「実装のきまりとコード例は process 側を参照」と誘導する。この線引きは層分離の原則の実務版であり、守らないと同じ層の話が 2 か所に増える。

### 例の置き場所

- **コード例・実装例**(規約に付随しない単体の例)は、①conventions 内の「例」節、②`docs/rules/process/{scope}/examples/`(1 例 1 ファイル)、③該当する architecture 文書の「例」節、のいずれかに置く
- **業務上の例**(前提・結果・根拠を持つドメインの判定や状態の例)は `doc_type: domain_example` としてドメイン知識層(W。`docs/specs/` の隣)に置く。コード例とは別物である

### README.md

README.md は directory_guide である。配下の一覧とリンク、ディレクトリの責務説明を含む。配下に共通でかかる規範はフロントマターの `norms` で明示する(無くても空配列 `[]` を書く)。節の語彙は open だが、節がひとつも無い README は M5 が警告する。

## specs 配下（doc_type: spec）

`docs/specs/{domain|backend|frontend}/` に置く。テンプレートは各ディレクトリに `template.md` または `template.{doc_type}.md` として置く(rules と同じパターン)。

### domain（正は ARCH-SP-0002）

| ファイル | doc_type | テンプレート |
|---|---|---|
| `docs/specs/domain/roles.md` | `role_spec`(ドメイン全体で 1 つ) | [template.role_spec.md](../../../specs/domain/template.role_spec.md) |
| `docs/specs/domain/{aggregate}/entity.md` | `entity_spec` | [template.entity_spec.md](../../../specs/domain/template.entity_spec.md) |
| `docs/specs/domain/{aggregate}/states.md` | `state_spec` | [template.state_spec.md](../../../specs/domain/template.state_spec.md) |
| `docs/specs/domain/{aggregate}/access.md` | `access_spec` | [template.access_spec.md](../../../specs/domain/template.access_spec.md) |
| `docs/specs/domain/{aggregate}/invariants.md` | `invariant_spec` | [template.invariant_spec.md](../../../specs/domain/template.invariant_spec.md) |

構成の正は [ARCH-SP-0002](../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md) である。

### backend（正は ARCH-SP-BE-0001）

| パス | doc_type | 備考 |
|---|---|---|
| `docs/specs/backend/actions/{aggregate}/{event}.md` | `action_spec` | テンプレートは [actions/template.action_spec.md](../../../specs/backend/actions/template.action_spec.md) |
| `docs/specs/backend/queries/{aggregate}/{name}.md` | `query_spec` | access_spec の `reads` を使う経路。テンプレートは [queries/template.query_spec.md](../../../specs/backend/queries/template.query_spec.md) |
| `docs/specs/backend/data/tables/{table}.md` | `data_table` | DB 固有の実装判断(インデックス・FK の ON DELETE・トリガ・関数の帰属・非導出 CHECK)。テンプレートは [data/template.data_table.md](../../../specs/backend/data/template.data_table.md) |
| `docs/specs/backend/notifications.md` | `notification_spec` | このシステムが送る通知の全数(宛先・メンション・経路・発火)。**1 プロジェクト 1 ファイル**。テンプレートは [template.notification_spec.md](../../../specs/backend/template.notification_spec.md) |
| `docs/specs/backend/jobs.md` | `job_spec` | このシステムが人手なしで動かすものの全数(発火の出どころ・種別・失敗時の挙動・いつ動くか)。**1 プロジェクト 1 ファイル**。テンプレートは [template.job_spec.md](../../../specs/backend/template.job_spec.md) |
| `docs/specs/backend/auth.md` | `auth_spec` | サインインすると何が起きて誰がどこへ着くかの全数(決定表)と、画面に入るときの関門。**1 プロジェクト 1 ファイル**。テンプレートは [template.auth_spec.md](../../../specs/backend/template.auth_spec.md) |
| `docs/specs/backend/config.md` | `config_spec` | このシステムを動かすのに要る設定の全数(値の性質・要求度・無いとどうなるか・何のために繋がっているか)。**1 プロジェクト 1 ファイル**。テンプレートは [template.config_spec.md](../../../specs/backend/template.config_spec.md) |
| `docs/specs/backend/guarantees.md` | `guarantee_spec` | 設計で不可能にした事実の全数(執行者・状態・見張りテスト)。**1 プロジェクト 1 ファイル**。テンプレートは [template.guarantee_spec.md](../../../specs/backend/template.guarantee_spec.md) |
| `docs/specs/backend/external.md` | `external_spec` | 外の誰と何のためにやり取りし、鍵が無いとどうなるかの全数(向き・効果・縮退・リトライ・送る情報)。**1 プロジェクト 1 ファイル**。テンプレートは [template.external_spec.md](../../../specs/backend/template.external_spec.md) |
| `docs/specs/backend/rls/{table}.md` | — | **作らない**(下記) |

**RLS の仕様書は作らない。** 行レベル権限の正は access_spec の `reads` であり、そこから期待ポリシー表を生成して統合テストが実 DB と突き合わせる([ARCH-SP-BE-0001](../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md))。RLS を別の文書に書き写すと、権限の定義が 2 か所になって必ず食い違う。

**未整備のサブディレクトリを追加する条件。** 実装に着手するタイミングで、ARCH-SP-BE-0001 と本表の**両方を先に更新してから**ディレクトリを作る。実物のない規約を先回りで書かない。

### frontend

配置の正となる architecture 文書(ARCH-SP-FE-0001)はまだ無く、**当面はこの表が正**である。書き方の正は [screen-spec-writing.md](../../process/frontend/specification/standards/screen-spec-writing.md)。

| パス | doc_type | テンプレート |
|---|---|---|
| `docs/specs/frontend/screens/{group}/{name}.md` | `screen_spec` | [screens/template.screen_spec.md](../../../specs/frontend/screens/template.screen_spec.md) |
| `docs/specs/frontend/chrome/{name}.md` | `chrome_spec` | [chrome/template.chrome_spec.md](../../../specs/frontend/chrome/template.chrome_spec.md) |
| `docs/specs/frontend/design/tokens.md` | `design_token_spec` | [design/template.design_token_spec.md](../../../specs/frontend/design/template.design_token_spec.md) |
| `docs/specs/frontend/ux-principles.md` | `ux_principles_spec` | [template.ux_principles_spec.md](../../../specs/frontend/template.ux_principles_spec.md)。UX 原則の台帳(原則・見張る検査・閾値)。**1 プロジェクト 1 ファイル**。書き方の正は [ux-lint.md](../../process/frontend/specification/standards/ux-lint.md) |
| `docs/specs/frontend/usecases/{name}.md` | `usecase_spec` | [usecases/template.usecase_spec.md](../../../specs/frontend/usecases/template.usecase_spec.md)。1 タスク 1 ファイル(ADR-0011)。書き方の正は [usecase-spec-writing.md](../../process/frontend/specification/standards/usecase-spec-writing.md) |

- **`design/` は 1 プロジェクト 1 ファイルに保つ。** ロール別・集約別・画面別に分けない。理由は、意匠が横断するものだからである —— 分けた瞬間に「どちらのトークンを使うか」の判断が実装に任される
- トークンの生成物(`app/src/domain/generated/tokens.css` / `tokens.ts`)は他の生成物と同じディレクトリに置く。鮮度チェック(C1)の対象を 1 か所に保つためである
- **`{group}` は画面の束ね方**(業務のまとまり)であり、集約名と一致しなくてよい。1 つの画面が複数の集約を読むため、`queries/{aggregate}/` のような 1 対 1 は成り立たない。ディレクトリは 1 段だけとし、ファイル名は `name` と一致させる
- 参考にした体系の `validation/` `platform/` `component/` `form/` `flow/` は**作らない**。フィールド制約の正は `docs/specs/domain/{aggregate}/entity.md` であり、画面はそこから生成された zod を使う。残りは実例が出たときに検討する

### common

現構成では `docs/specs/common/` を使わない。FE と BE に共通の型・バリデーションは `docs/specs/domain/` からの生成物が担う(ARCH-SP-0002)。別のコードベースの利用者が現れた場合にかぎり `docs/specs/common/api_contract/{resource}/{endpoint}.md` を復活させる。

### 直下(用語の台帳)

| パス | doc_type | 備考 |
|---|---|---|
| `docs/specs/terms.md` | `term_ledger` | 仕組みの説明語の台帳(語・1 行の定義・初出・使わない綴り)。**1 プロジェクト 1 ファイル**。業務の語は `docs/knowledge/TERM-*.md` が持ち、ここには載せない。書き方は [term-ledger-writing.md](../../process/common/specification/standards/term-ledger-writing.md) |

## knowledge 配下（doc_type: domain_glossary, domain_invariant, domain_example, domain_design_context, domain_precedent）

ドメイン知識層(W)は `docs/knowledge/` に **1 件 1 ファイル**で置く(2026-08-26 開設)。ファイル名は ID に合わせる(`TERM-seat-fee.md` / `DC-money-outlives-account.md`)。サブディレクトリは件数が増えて分類が要るまで切らない。入口は `docs/knowledge/README.md`(directory_guide)。この層も M 群(フロントマター・ID・参照・リンク)の走査対象である。

| doc_type | 置き場所 | ID |
|---|---|---|
| `domain_glossary` | `docs/knowledge/TERM-{対象}.md` | `TERM-{対象}` |
| `domain_invariant` | `docs/knowledge/INVARIANT-{対象}.md` | `INVARIANT-{対象}` |
| `domain_example` | `docs/knowledge/EXAMPLE-{対象}.md` | `EXAMPLE-{対象}` |
| `domain_design_context` | `docs/knowledge/DC-{対象・概念}.md` | `DC-{対象・概念}` |
| `domain_precedent` | `docs/knowledge/PRECEDENT-{対象}.md` | `PRECEDENT-{対象}` |

**`domain_precedent` は私有層である。** 生の設計判例(具体的な経緯)を蓄積する場所は製品のリポジトリであり、このリポジトリ(公開される仕組み)には含めない。2 実例ルールで型に定まったものだけを抽象化し、[dsl-extension-triage.md の迂回パターン集](../../process/common/specification/playbooks/dsl-extension-triage.md#patterns)のような公開層の一般化パターンへ昇格させる。昇格は制度としてはまだ置き場だけを用意した状態であり、実際の抽象化は実例が積み上がってから行う。

## 仕組み自身の台帳(doc_type なし)

| パス | 何の台帳か | 備考 |
|---|---|---|
| `legacy/spec-tools/extension-candidates.md` | **拡張候補の台帳**。`npm run verify` の警告のうち「仕組みを拡張すれば吸収すべき問題」(仕組みの宿題)の全数。1 行 = 1 候補(`id` / `statement` / `rules` / `scope`(任意)/ `status` / `since` / `ref`)。**1 つの仕組みに 1 ファイル** | **製品の `docs/specs/` には置かない** —— 製品の仕様ではなく仕組みの宿題で、検証する製品が変わっても動かない。検査器は自分のパッケージの位置からこのファイルを引く(製品の根の宣言からは導かない)。doc_type も frontmatter の id も持たず、M 群の走査の外(コードの木 `legacy/spec-tools/` は M 群の対象外)。書き方と検査(W5)の正は[enforcement-matrix.md](../../process/backend/system/standards/conventions/enforcement/enforcement-matrix.md)と台帳そのものの冒頭 |
| `framework/guarantees.md` | **仕組みの保証台帳**。仕組み自身が言い切る事実(エンジン・実行器・実行時パッケージの依存など)の全数と、その見張りテストの宣言(`doc_type: guarantee_spec`・`id: framework-guarantee-catalog`)。保証 ID は `fw_`、テストケース ID は `TC-FW-` の予約で、製品の台帳(`docs/specs/backend/guarantees.md`)は使えない。**仕組みに 1 ファイル** | **製品の `docs/specs/` には置かない** —— 製品が外せない義務で、製品の `uses` にも製品の台帳の有無にも依らない。検査器(Z3)は自分のパッケージの位置から仕組みの根を引いてこのファイルを読み(製品の根の宣言からは導かない)、配布の木にも入る(配布物に入れるものの宣言に載っている)。frontmatter は製品の台帳と同じ書式で、本文ブロックは `npm run generate` が書く。書き方と検査(Z0 の名前空間・Z3)の正は[guarantee-spec-writing.md](../../process/backend/specification/standards/guarantee-spec-writing.md) |

**置き場を決めた理由。** 台帳を `docs/design/` に置く案は、そこが「正式化前の設計ドラフト置き場」で正典になった時点で `docs/rules/` か `docs/specs/` へ移る場所だという定義と合わない(台帳は生きた全数であり、移る先が無い)。`docs/specs/` は製品の仕様の木で、台帳を置くと製品ごとに写しができる。検査器と同じパッケージに置けば、検査器と台帳が同じコミットで動く。

## 運用メモ

### `{aggregate}` は場所によって意味が違う

**これは実務上の落とし穴である。** `domain` 配下と `backend` 配下で `{aggregate}` の決め方は別物であり、多くの集約でたまたま名前が揃うために見落とされる。実際に食い違っている例が存在する。

| パス | `{aggregate}` の意味 |
|---|---|
| `docs/specs/domain/{aggregate}/` | **集約名**。関連するエンティティ・状態機械・不変条件を束ねる業務上のくくり。配下の entity_spec の `entity` と一致する保証は無い |
| `docs/specs/backend/actions/{aggregate}/` | **エンティティ名**(`handles` の前半)。ドメインイベント ID `{machine}.{event}` と予約 ID `{entity}.create` の名前空間そのもの |
| `docs/specs/backend/queries/{aggregate}/` | **エンティティ名**(`source` と同名。Q0 が一致を検査する) |
| `app/src/{layer}/{aggregate}/` | **エンティティ名**(backend 仕様のパスから機械的に導く。命名規則の執行はリンター側) |

仮の例を挙げる(この木のデモ製品にはズレが無い)。`docs/specs/domain/hold/entity.md` の中身が `entity: hold_request` だったとすると、対応する Server Action の仕様は `docs/specs/backend/actions/hold_request/update.md` に置かれる。**エンティティ名の側が実装まで一貫しており、ズレるのは `docs/specs/domain/` のディレクトリ名 1 か所だけ**である。

- **ドメイン仕様を探すときはディレクトリ名から推測しない。** `grep -rl "entity: {エンティティ名}" docs/specs/domain` で引く(entity_spec の `entity` が正である)
- **新しい集約を切るときは、特段の理由が無ければ集約名をエンティティ名に揃える。** 揃えられないのは「1 つの集約に複数のエンティティが属していてディレクトリ名を 1 つに決められない」ときだけで、その場合はズレを承知で切る

### ファイル名

ファイル名は id_policy の ID に合わせる(例: `PRIN-BE-0001-xxx.md`)。ID を持たない doc_type は内容を表す名前を付ける。
