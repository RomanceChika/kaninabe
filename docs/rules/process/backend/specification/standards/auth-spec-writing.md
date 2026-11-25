---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0006, PRIN-0008, PRIN-0009, ARCH-SP-BE-0001, ARCH-BE-0016]
decisions: [ADR-0003]
---

# 認証フロー仕様（auth_spec）の書き方

`docs/specs/backend/auth.md` に置く `auth_spec`（認証フロー仕様）の YAML スキーマと、検証器が実行するチェック（H0〜H9）を定義する。

## 目的

- **暗黙の挙動を無くす。** 「サインインすると何が起きるか」は、これまで OAuth コールバックの Route Handler と `sign-in-sync.ts` の `if` の並びにしか無かった。人が押すのは「ログイン」ボタン 1 つで、そのあとの**招待の受諾・利用者の有効化・行き先の振り分け**はすべてシステムが勝手に行う — 引き継いだ人が最初に驚くのはここである（PRIN-0001）。
- **全域性を機械で守る。** 利用者の状態を 1 つ足したとき、「その状態の人がログインしたらどこへ行くのか」を宣言しないと verify が通らない（H1）。暗黙の「その他」を作らせないための検査である。
- **宣言をそのまま検査の駆動表にする。** 決定表として書いてあるので、実装との突合は生成物（`SIGN_IN_BRANCHES`）を回すだけで済む。**行が 1 つ増えれば検査する状況も 1 つ増える**（テストを書き足さなくてよい）。
- 仕様・生成物・実装・テストを**双方向の閉世界**で結び、片方だけ増えた状態を機械が落とす（PRIN-0008）。

## 参照するもの

- **配置**: [ARCH-SP-BE-0001](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) §認証フロー仕様
- **読み取り経路の関門との関係**: [ARCH-BE-0016](../../../../architecture/system/backend/ARCH-BE-0016-read-path.md)
- **テンプレート**: `docs/specs/backend/template.auth_spec.md`

## ルール・基準

### なぜ「手順の列」ではなく「決定表」なのか（形の判断）

サインインの分岐は、主語（利用者行の状態）と 3 つの補助条件で**結末が一意に決まる**。だから仕様は**順序を持たない行の集合**として書く。

| 書き方 | 何が起きるか |
|---|---|
| 手順の列（steps + 分岐） | 「上から何行目で止まったか」という**実装の都合が仕様の一部になる**。さらに 1 行だけを取り出してテストで駆動できない（前の行を全部たどる必要がある） |
| **決定表（採用）** | 行ごとに終端（`lands`）まで書いてあるので、**宣言がそのまま検査の駆動表**になる。順序を変えても意味が変わらない＝順序が意味を持たないことが宣言で表現できている |

これは `notification_spec` / `job_spec` / `config_spec` と同じ「**1 プロジェクト 1 カタログ・行の集合・実装と双方向に閉じる**」の 4 例目であり、**新しい機構ではない**（フローのための汎用 DSL は作っていない。実物が 1 本しか無いものに汎用の器を作らない — 三の法則）。

### 語彙をどちらが持つか（フレームワークとアプリの線）

| 軸 | 語彙の持ち主 | 理由 |
|---|---|---|
| `kind`（`state` / `field` / `enum`）/ `guards` / `on_fail` | **体系（`lib/model/auth/types.ts`）** | H1〜H4 と生成物が**この値で分岐する**。「主語は状態機械か enum の欄」「関門は requires_auth かロール」「通れない人は送り返すか無いものとして扱う」という 3 つの三分は、認証フローという 1 本の流れの形そのものであってアプリごとに増える語ではない |
| **軸の ID・値・表示名・「どの行が持つか」** | **カタログの `axes`** | すべてこのアプリの事情である。かつては `patron`（`kind: state`）と `invitation`（`kind: enum`）の**2 語が必須の軸名**として体系側に固定されており、招待制でないシステムは決定表を 1 行も書けなかった（束 ⑱ の実測 → 束 ⑲-2a で開いた）。`guild` / `activate` のような補助条件の語も、体系の値域ではなく `axes` の 1 本である |
| `lands` / `screen` / `variant` / `runs` | **他の仕様に接地する** | 状態は `state_spec`（または entity_spec の `enum`）、着地先は `screen_spec`、実行する操作はドメインイベント。ここで語彙を宣言し直すと二重の正になる |

### 共通形式

- **YAML フロントマターが正**とする。本文の手書き散文は標識（否定・線引き）のみ。
- 1 プロジェクト 1 ファイル（`docs/specs/backend/auth.md`）で、`id` は `auth-flow` 固定である。
- `subject` は分岐の主語の**値の出どころ**。状態機械の名前（このアプリでは `membership`）か、`{エンティティ}.{enum の欄}`（例: `staff_member.access`）である。**その値の全体が尽くされていなければならない**（H1）。
  - 状態機械を要求していた間、**在籍のライフサイクルを状態機械で持たないシステム**（人事台帳が正で、こちらは利用可否だけを持つ等）は決定表を書けなかった（束 ⑱ の実測）。どちらの形でも「値を 1 つ足したら着地の宣言が要る」という性質は失われない —— 値の全体が**別の宣言**（`state_spec` の `states` / `entity_spec` の `enum`）から来るためである。`axes` に `values` を並べただけの主語は許さない。

### `providers`（受け入れるサインインの方式）

このシステムが**受け入れるサインインの方式の全数**を宣言する。必須・空不可。サインインの分岐（`sign_in`）が「入ったあと」を宣言するのに対し、`providers` は「**どの口から入れるか**」を宣言する — 宣言に無い口が設定で開いたまま出荷される事故（使っていないメールとパスワードの登録口が開いていて、誰でも事前にアカウントを作れた等）を、仕組みで止めるための閉世界である。

```yaml
providers: [example_idp]     # このシステムは example-idp の OAuth だけでサインインさせる
local_only:              # (任意)ローカル(開発・テスト)の設定でだけ開けてよい方式。本番では開けない。理由が必須
  - method: email
    reason: ローカルの統合テスト・E2E のテスト利用者がパスワードでサインインする
```

方式の語は**プラットフォームの設定の綴り**に合わせる(コアは語の意味を持たない。どの語がどの口に当たるかはプラットフォームの後段が決める)。Supabase の後段(`lib/targets/supabase/config/`)の語は次のとおり。

| 語(Supabase の後段) | 意味 |
|---|---|
| `email` | メールとパスワードによる登録（メールのリンク・ワンタイムコードによる登録を含む） |
| `phone` | SMS による登録 |
| `anonymous_sign_in` | 匿名サインイン |
| それ以外（例: `example_idp`） | 外部のプロバイダ（OAuth）・外部の認証基盤・ウォレット（設定のセクション名がそのまま語になる。小文字のスネークケース） |

- **`local_only`（任意）は「ローカルでだけ開けてよい方式」。** 統合テスト・E2E のために、テストの利用者がパスワードで入る口（Supabase の後段なら `email`）をローカルのスタックで開けておく必要がある製品がある（その口はプラットフォームによっては「新規登録」と同じスイッチで、閉じるとパスワードでのサインインも止まる）。この口を `providers` に書くと「本番でも使う」という嘘になり、黙って開けると宣言に無い口になるので、**ローカルでだけ開ける方式として、理由（`reason`。空不可）つきで別に宣言する**。理由の無い免除は穴になるので、`method` と `reason` の両方が必須で、ほかの鍵は書けない。`providers` と重ならない。
  - H5 はローカルの設定を `providers` ∪ `local_only` に突き合わせる。**deploy 先の設定（Supabase なら `[remotes.{名}]`）は `providers` だけに突き合わせる**（`local_only` は deploy 先には使えない。基の設定を引き継いで開いたままの `local_only` の方式も、deploy 先の指摘になる）。
  - **本番の管理画面の設定はこの検査では見えない。** `local_only` が空でなければ、実行ログが検査の結果（緑でも）によらず毎回「H5: 未実施 — 本番の設定は未検証です(local_only: …)。本番の管理画面で閉じていることを確かめてください。」と名指す（範囲サマリの未実施に数える）。プラットフォームの API を読んで本番の設定を `providers` だけに突き合わせる検査は後続の仕事である。
- 1 ファイルの中で閉じる形（`providers` が空でないこと・各語がスネークケースであること・重複が無いこと・`local_only` の各要素が `method` と空でない `reason` を持つこと・`providers` と重ならないこと）は H0 が見る。
- **宣言とプラットフォームの設定の突合は H5**。設定ファイルの名前・書式・方式の綴りはプラットフォームごとに違うので、突合の本体は**プラットフォームの後段が登録する**（コアが持つのは契約と ID だけ）。後段が登録していない構成・設定ファイルが無い製品・認証フロー仕様が無い / 読めない製品・設定が認証やデータ API を動かさない（Supabase なら `enabled = false`）ために飛ばした部分は、H5 が**未実施**とその理由を実行ログに名指す（黙って飛ばさない・緑にしない）。
- 使う方式を足す日は、先にここへ足す（足さずに設定だけ開くと H5 が止める）。**使わない方式は設定で閉じる**（H5 が止めるのは、宣言に無い方式が開いているとき）。
- 見るのは**設定ファイルだけ**である（ローカルの設定と deploy 先の上書き）。**フルパスに畳めない書き方・読み違えうる書き方**（インラインテーブル・ドット付きのキー・引用符つきでドットを含むセクション名・配列表・複数行の文字列・エスケープを含む引用符つきの名前・見出しでも `キー = 値` でもない行。Supabase なら `auth` / `api` / `remotes` の下）は、開いている口を見落とすので値を読まずに**エラー**にし、普通のセクションへの書き直しを求める。**三連の引用符（`"""` / `'''`。複数行の文字列）がファイルのどこかにあれば（どのセクションの中でも、ほかの文字列やコメントの中でも、閉じていなくても）、ファイル全体を 1 件のエラーにして口の突合を出さない**（読み飛ばしの位置がずれると、後ろの本物の設定を飲み込むか、偽の設定を本物として読むので、読み違えうるファイルから読んだ口は信用しない。三連の引用符を使わない書き方にする）。エスケープした名前は復号して口として読んだうえで、書き直しを求める。本番側の設定（管理画面で手で変えられる部分）との一致は、この検査では保証しない。本番の設定を宣言と揃える手順は運用側の仕事で、プラットフォームの API を読んで本番の設定を突合する検査は後続の仕事である。

### `sessions`（セッションの寿命）

サインインしたあと、**セッションがいつ終わるか**を宣言する。必須。書かないと、セッションが時間で終わらないプラットフォームの既定（Supabase は無期限）のまま出荷される。ASVS 5.0 の V7.1.1（無操作の時間切れと絶対の寿命を、理由つきで文書にする）・V7.3.1 / V7.3.2（その時間で再認証を求める）・V10.4.8（更新トークンに絶対の期限を持たせる）を、宣言と検査で満たすための欄である。

```yaml
sessions:
  inactivity: 8h       # 無操作の時間切れ。最後にセッションを更新したときから、この時間が過ぎたら再認証を求める
  absolute: 24h        # 絶対の寿命。サインインしたときから、使い続けていてもこの時間で再認証を求める
  reason: 絶対の寿命は NIST SP 800-63B-4 §2.2.3 の AAL2 の上限(24 時間)に合わせる。…
  concurrent:          # 同時に持てるセッションの数(必須)。上限を置かないなら unbounded と理由
    unbounded: 認証基盤の既定のまま上限を置かない。…
```

| キー | 必須 | 意味 |
|---|:---:|---|
| `inactivity` | ○ | 無操作の時間切れ。日（`d`）・時間（`h`）・分（`m`）を大きい順に書く（`30m` / `8h` / `1d12h`）。0 は書けない |
| `absolute` | ○ | 絶対の寿命。書き方は `inactivity` と同じ。**更新トークンもこの時点でセッションごと使えなくなる**ので、更新トークンの絶対の期限を兼ねる（別の欄にすると、同じ 1 つの設定に正が 2 つできる） |
| `reason` | ○ | この長さにした理由（空不可）。値より「なぜその長さで足りるのか」が文書になる |
| `concurrent` | ○ | 1 人が同時に持てるセッションの数と、上限に達したときの挙動。**上限を置かないなら `unbounded: {理由}` だけ**を書く（置かない、と明示する宣言。理由は空不可）。置くなら `max`（1 以上の整数）・`on_limit`（`ends_oldest` = いちばん古いセッションを終えて新しいのを通す / `refuses_new` = 新しいサインインを断る）・`reason`（空不可）。`unbounded` と上限の欄は同時に書けない |

- **`inactivity` は `absolute` より短くする**（H0）。同じか長いと、無操作の時間切れが一度も効かない宣言になる。**無操作の時間切れを置かない、という書き方は無い**（L2 では両方が要る）。
- **値の目安は一次資料から引く。** ASVS 5.0 は具体の値を決めず、NIST SP 800-63B を基準にするよう言っている。NIST SP 800-63B-4 は、全体の時間切れを AAL1 で 30 日以下・AAL2 で 24 時間以下、無操作の時間切れを AAL2 で 1 時間以下にするよう言う（§2.1.3・§2.2.3）。多要素認証を要求するなら AAL2 の値が出発点である。
- **プラットフォームでの測り方に注意する。** Supabase の無操作の時間切れは「最後にセッションを**更新**したとき」から測る（アクセストークンを使うだけでは測り直さない）。だから**アクセストークンの寿命（`[auth] jwt_expiry`。既定 1 時間）より長くしないと、使い続けている人も次の更新で締め出される**（H5 が止める）。また、終わったセッションのアクセストークンは、自分の寿命が切れるまで使える —— 実際の上限は、どちらの寿命もアクセストークンの寿命だけ長い。
- **本番の管理画面の設定はこの検査では見えない。** 実行ログが検査の結果（緑でも）によらず毎回「H5: 未実施 — 本番のセッションの寿命は未検証です（…）。本番のプランでこの設定が使えるか（…）も確かめていません。…」と名指す（範囲サマリの未実施に数える）。**Supabase のホスティングでは、時間切れの設定は Pro プラン以上の機能**で、無料のプランの本番では効かない。題材の製品の本番は無料のプランなので、宣言した寿命は本番では効いていない ——「入れるけど確かめられていない一覧として認識で OK。製品相当を導入するときにまた確かめる」。プランを仕様に書かせる欄は持たない(未検証として名指し続ける)。
- **同時セッションの数（`concurrent`）は設定ファイルでは見えない。** ASVS 5.0 の V7.1.2（同時に持てる数と、上限に達したときの挙動を文書にする）を、宣言を必須にして文書（認証の章）に出すことで満たす。Supabase のローカルの設定（`[auth.sessions]`）が持つキーは `timebox` と `inactivity_timeout` の 2 つだけで、1 人 1 セッションに絞る設定（管理画面の Single session per user。Pro プラン以上の機能）は設定ファイルに書く場所が無い（仕組みはキーを作って突き合わせない）。なので H5 は宣言を違反にせず、実行ログが毎回「H5: 未実施 — 同時セッションの数（sessions.concurrent: …）は、設定ファイルに書く場所が無い（…）ため見ていません」と名指し、本番のセッションの寿命の未検証の行にも同時セッションの宣言を並べる。上限を置くと宣言するなら、それを実際に効かせるのは本番の管理画面と運用の仕事である。
- 1 ファイルの中で閉じる形（マッピングであること・書けるキーが `inactivity` / `absolute` / `reason` / `concurrent` だけ・揃うこと・期間が読めること・`inactivity` < `absolute`・空でない `reason`・`concurrent` の形〔`unbounded` か `max` / `on_limit` / `reason`〕）は H0 が見る。設定との突合は H5（下の表）。

### `idp_session`（IdP とアプリのセッションの関係）

OAuth でサインインするとき、**IdP（外部の認証プロバイダ。example-idp など）のセッションとアプリのセッションは別々に生き、別々に終わる**。その関係を宣言する。必須。ASVS 5.0 の V7.1.3（連携する認証の寿命と終了の調整を文書にする）・V7.6.1（IdP とアプリのセッションの寿命・終了が文書どおりに動く）を、宣言と H0 の「支えられる主張だけ」で満たす欄である。認証の章に「IdP とのセッションの関係」の行として出る。

```yaml
idp_session:
  logout: keeps_idp           # アプリのログアウトが IdP のセッションにすること
  idp_ends: app_continues     # IdP のセッションが終わったとき・アカウントが失効したときのアプリのセッション
  lifetime: independent       # アプリのセッションの寿命の決め方（寿命は sessions）
  reason: …                   # この関係でよい理由（空不可）
```

| キー | 必須 | 書ける語 | 意味 |
|---|:---:|---|---|
| `logout` | ○ | `keeps_idp` / `ends_idp` | アプリのログアウトは IdP のセッションを終えない（`keeps_idp`）か、終える（`ends_idp`） |
| `idp_ends` | ○ | `app_continues` / `app_ends` | IdP のセッションが終わっても・アカウントが失効しても、アプリのセッションは `sessions` の寿命が来るまで続く（`app_continues`）か、アプリのセッションも終える（`app_ends`） |
| `lifetime` | ○ | `independent` / `follows_idp` | アプリのセッションの寿命はアプリが決める（`independent`）か、IdP に従う（`follows_idp`） |
| `reason` | ○ | — | この関係でよい理由（空不可）。とくに `app_continues` では、IdP の側の失効が届かなくてよい理由（締め出しをアプリ自身の状態の遷移で行う、など） |

- **宣言できるのはいまの仕組みが支えられる主張だけ**である（H0）。書ける語のうち `ends_idp`・`app_ends`・`follows_idp` は、仕組みが接地できない（OAuth の認可コードの交換とセッションの cookie の削除は、IdP のセッションを終える口も、IdP の側の終了をアプリへ伝える口も持たない）ので error になる。通るのは `keeps_idp` / `app_continues` / `independent` の組だけ（書いたのに効いていない宣言を通さない）。IdP のセッションを終える口や、IdP の失効をアプリへ伝える口を仕組みに入れる日に、対応する語を通す。
- **これは現状を正直に文書にする欄で、挙動を変える欄ではない。** Supabase の `signOut` の範囲が `local`（この端末だけ）なら、他の端末のセッションも IdP のセッションも残る。IdP の側で何が起きても、アプリのセッションは `sessions` の寿命が来るまで続く。締め出しが要るなら、アプリ自身の状態（利用者の状態など）の遷移でセッションを終える（`reason` に書く）。
- IdP の側の実際の挙動（IdP の管理画面の設定・IdP がセッションを持つか）は検査では見えない。外部の IdP を使わない構成（メールのサインインなど）では、`reason` にその旨を書く。


### `mfa`（多要素認証の要求）

**多要素認証は既定で全員に要求する。** 欄は必須で、書かなければ H0 が止める（「既定は要求する」なのに、多要素認証を済ませていない人の送り先が無いため）。外すときは理由つきの明示の宣言だけで、verify が毎回「受け入れた危険」の警告で名指す。ASVS 5.0 の V6.3.3（多要素認証を要求する）を、宣言と検査で満たすための欄である。ユーザーの決定（2026-10-20）は「フレームワーク上は入れる前提にしたいけども、入れなくてもいいという警告付きオプションが付けられるようにして、趣味用では逃れられるようにしておこう」。

```yaml
mfa:                                  # 要求する(既定)
  require: { roles: [{ロール ID}] }   # 任意。書かなければ all(サインインした全員)
  to: screen-mfa                      # 多要素認証を済ませていない人を送る画面(要素の登録・確認)
  implementation: "{パス}::requireMfa"   # 入場のたびに確かめる関数
  summary: …
# 外すとき(理由が必須。毎回 H6 の警告で名指す)
mfa:
  exempt: 小規模な試験運用のため
```

| キー | 必須 | 意味 |
|---|:---:|---|
| `require` | — | 誰に求めるか。`all`（既定）か `{ roles: [...] }`（roles.md のロール。サインインするロールだけ） |
| `to` | 要求なら○ | 多要素認証を済ませていない人を送る画面。実在し、引数なしで送れて、`requires_auth: true`（要素の登録にはセッションが要る）。ロールで絞るなら、そのロールの画面（`for` にそのロール）でないこと（同じ要求に掛かって無限に送り返される） |
| `implementation` | 要求なら○ | 入場のたびに多要素認証を確かめる関数（`パス::関数名`。関門の `implementation` と同じ形。実装の木が無い構成では実在を見ない） |
| `summary` | 要求なら○ | どういう要求かを 1 行で |
| `exempt` | 外すなら○ | 外す理由（空不可）。ほかのキーとは同時に書けない |
| `delegated` | 任せるなら○ | IdP に任せる（`provider` / `evidence: none` / `reason`）。`provider` は `providers` に書いた外部の IdP で、**本番の方式（`providers`）はその IdP 1 つだけ**であること（メールのパスワード・電話・別の IdP が本番の方式に並ぶと、そこから入る人には要素が 1 つも掛からないので H6 が error にする。開発・テストだけの方式は `local_only` へ）。毎回 H6 の警告（受け入れた危険）で名指す |

- **正は認証基盤のセッションの水準である。** Supabase なら、多要素認証（TOTP・電話・WebAuthn）を済ませたセッションの JWT は `aal` が `aal2` になる。要素はサインインの方式（外部の IdP・メール）に関わらず、サインイン済みの人が認証基盤に登録できる。**IdP のアカウントの設定（Discord の `mfa_enabled` など）は使わない** —— 「アカウントで有効にしている」は、そのログインで要素を使った証拠にならない。方式ごとの語彙も要らない。
- **なぜ決定表ではなく関門の形なのか。** 多要素認証はサインインの瞬間の分岐ではなくセッションの属性で、**入場のたびに**確かめる必要がある。決定表の着地で多要素認証の画面へ送っても、URL を直に打てば素通りできる。だから画面の関門と同じく、送り先と確かめる関数を宣言させる（ロールで絞るなら、そのロールの関門の実装が呼ぶ）。
- **書き込みの入口でも執行する（生成物）。** 画面の関門は画面の入場しか守らないので、多要素認証を済ませていないセッションでも Server Action は直に呼べる。だから要求を宣言すると、生成物が書き込みの入口にも執行を通す。
  1. 生成された束（`runtime-bindings.ts` の `mfa`）が要求の範囲（`{ scope: 'all' }` / `{ scope: 'roles', roles: [...] }`）を運ぶ。手書きの表は無い
  2. 生成された Server Action（単発の操作・保存点の全部）が、実行者の解決に続けて `resolveSessionMfa()`（セッションが多要素認証を済ませたか）を呼び、組み立ての根がそれを実行器へ渡す（`actorMfa`）
  3. **実行器（`@kaninabe/runtime` の run-plan。生成された Server Action が全部通る 1 か所）が、判断と書き込みの前に止める。** サインインした実行者のセッションが済ませていなければ、範囲が全員なら対象の行を読む前に、範囲がロールなら**その操作の判断に立ったロール**（手順ごとの解決の和・`implies` で閉じたもの）に要求するロールが入っていれば、`forbidden` で返す。事実の読み取りも RPC も呼ばない。済ませたかを渡されなかった呼び出しは済ませていないとして扱う
  - **拒否の種類は `forbidden`（DB の分類なら `UC403`）**で、`mfaRequired: true` の印が付く。権限の拒否であることは変わらない（その要素を済ませていないセッションには、そのロールの権限で書かせない）。印は画面が `AUTH_MFA_PATH`（生成された `auth.ts`。`to` の画面の route）へ送るためだけにあり、画面の関門と同じ着地になる。ほかの拒否には付かない
  - **要求するロールが立たない操作には掛からない。** ロールは計画が名指した根拠からしか解かれないので、司書が利用者として借りるような操作では、司書のロールはそもそも立たない。立つなら、ほかのロールで許される操作でも止める（要求するロールの権限で書けてしまうため。狭い側に倒す）
  - **内部実行（`system` の入口。走査・受信口・ジョブ）は対象外**である。人のセッションが無く、保証の水準という概念が無い。区別は呼び出し側の宣言で決まる —— 走査の経路は実行器に `system: true` を渡し、受信口は実行器を通らずに生成された RPC を呼ぶ。生成された Server Action は `system` を渡さない。未ログインの実行者にも掛からない（公開の操作は未ログインの規則が裁く）
  - Supabase では、セッションの状態の読み取りはセッションの adapter の `sessionMfaVerified(client)`（`@kaninabe/adapter-supabase-session`）を使う。**署名を確かめたクレーム**（`auth.getClaims()`）の `aal` が `aal2` で、かつ認証基盤への問い合わせ（`auth.getUser()`）でセッションがまだ生きているときだけ済ませたと答え、確かめられなければ済ませていないと答える（非対称の署名鍵ではクレームの検証が手元で終わり、セッションが終わったあともアクセストークンの期限まで署名は有効なので、署名の確かめだけに頼らない。ASVS V7.4.1）。`getSession()` の値は cookie から読んだだけなので使わない。製品は認証の組み立ての根（`composition/auth.ts`）に `resolveSessionMfa` をこの 1 行で置く（H6 が export の実在を見る）
  - **外した製品（`exempt`）と認証フロー仕様を持たない製品では、生成物は 1 字も変わらない**（束に欄が無く、Server Action は解決を呼ばない。実行器も束に要求が無ければ見ない）
  - **DB の境界には入れない（判断の記録）。** 書き込みの RPC は面のロールから呼べず（実行の権限は `service_role` だけ）、実行者を引数で信じるサーバー専用の口である。RPC の中の `auth.jwt()` は利用者のセッションではなくサーバーの鍵のものなので、`aal` を DB で見る形はそもそも成り立たない。`aal` を引数で渡して DB で見ても、渡すのは実行器と同じサーバーなので守りは増えない。DB の判定の正を行の状態に置いてきた経緯（利用者の状態の束）とも混ざらない。読み取りの RLS（利用者のセッションで読む）に `auth.jwt()->>'aal'` を足す形は別の判断として残っている（要求するロールにだけ見せる行がある製品が出たら検討する）
- **cookie で認証する有料の口（Route Handler の `runPaidEntry`）も、同じ判定を通す。** 画面の関門・生成した Server Action・手書きの Server Action のどれも通らない口なので、共通の入口が認可の直後・本文を読む前に `mfaRefusal` を引く（済ませていなければ 403 `mfa_required`。枠は消費せず、有料の処理も呼ばない）。口は生成した束 `runtimeBindings` と口の役（`PAID_ENTRIES[…].role`）を渡し、要求する製品は `resolveMfa` に認証の組み立ての根の `resolveSessionMfa` を渡す。X8 が構文木でこの配線を見る（束・役が生成物でない・要求する製品なのに `resolveMfa` が `resolveSessionMfa` でない、は error）。範囲が `roles` のときは、口の役（`implies` で閉じる）に要求するロールが入っていれば止める。外す宣言・IdP に任せる宣言の製品では何も変わらない
- **`runner: manual` の操作の手書きの Server Action も、同じ判定を通す。** 実行器を通らない操作には実行器の執行が届かないので、手書きの Server Action が、組み立ての根を呼ぶ前のいちばん外の文で `@kaninabe/runtime/template/mfa` の `refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa }, roles, '{操作 ID}')` を呼び、拒否が返ればそのまま返す（`roles` はその操作の判断に立ちうるロールを解いた結果。判定の芯は実行器と同じ `mfaRefusal`）。要求する製品では、これを H6 が**構文木で**確かめる —— 結果を変数に入れて `if (…) return` する形か `if (判定(…)) return` の形が、その操作の組み立ての根（配置の `operation-composition`）から import した束縛の最初の呼び出しより前にあること。呼ばない・結果を捨てる・本体のあとで呼ぶ・分岐や入れ子の関数の中で呼ぶ・コメントに名前があるだけ、はどれも error。組み立ての根を呼ばない手書きの入口も、判定の位置を確かめられないので error。Server Action のファイルが無い操作（内部実行だけが起こす操作）と外す宣言の製品は見ない
  ```ts
  const actorMfa = await resolveSessionMfa();
  const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa }, roles, 'widget.settle');
  if (refusal !== null) return err(refusal);
  return createSettleWidget()(actorId, actorClaims, parsed.data.id);
  ```
- **見ていないこと**: 画面の実装が `implementation` を本当に呼ぶか（関門と同じく実装の木の側の静的走査の仕事。要求する製品が出たら足す）・`resolveSessionMfa` の中身が本当に保証の水準を読んでいるか・手書きの入口が判定に渡すロールが正しいか・読み取りの経路（上の DB の境界の段落）。
- **プラットフォームの設定**: 要求するなら、設定で要素が 1 つ以上、登録も確認も有効であること（Supabase は `[auth.mfa.totp]` などの `enroll_enabled` / `verify_enabled`。既定はどれも無効）を H5 が見る。本番の管理画面の設定は見えないので、要求するなら実行ログが毎回「H5: 未実施 — 本番の多要素認証の要素は未検証です（…）」と名指す。
- **外す宣言の警告は「受け入れた危険」として数える**（[extension-candidates.md](../../../../../../legacy/spec-tools/extension-candidates.md)）。未分類ではないので `--fail-on-unclassified` を閉じない。警告は宣言の位置と理由を持ち、W5 が「読めた仕様の宣言と一致すること・理由が空でないこと」を見る。
- 1 ファイルの中で閉じる形（欄の有無・マッピングであること・`exempt` とほかのキーを混ぜないこと・理由が空でないこと・要求の 3 欄・`require` の形）は H0 が見る。接地と警告は H6（下の表）。

### `axes`（決定表の軸）

**決定表の軸は仕様が宣言する。** 体系が要求するのは「**主語の軸が 1 本だけあること**」だけであり、軸の名前も値も表示名も「どの行がその軸を持つか」も、すべてここが正である。

```yaml
axes:
  - id: patron                 # 主語の軸。名前はこのアプリの語(体系は要求しない)
    kind: state
    of: membership             # subject と同じ(H0 が一致を見る)
    absent: none               # 利用者行が無いことを表す値
    summary: 利用者行の状態
    labels:                    # 分岐図とマトリクスに出る日本語(H1 が値の実在を見る)
      none: 利用者行が無い
      active: 利用者行が active
      # …states の全部を書ける(書かない値は値そのものが出る)
  - id: invitation
    kind: enum
    summary: 招待の扱い
    when: { patron: none }     # 利用者行が無い行だけが持つ(それ以外の行が持っていたら H1 がエラーにする)
    values: [none, unknown, refused, unreadable, accepted]
    labels:
      none: 招待を持っていない
      accepted: 招待を受諾できた
  - id: guild
    kind: enum
    summary: ギルド在籍の確認結果
    optional: true             # 在籍を確かめた行だけが持つ(条件は無い)
    values: [joined, not_joined]
```

| キー | 必須 | 意味 |
|---|:---:|---|
| `id` | ○ | 軸 ID（スネークケース）。`sign_in[]` の同名キーが指す。**体系は特定の名前を要求しない** |
| `kind` | ○ | `state`（状態機械の状態 + `absent`。主語）/ `field`（entity_spec の `enum` の欄 + `absent`。主語）/ `enum`（`values` の値域。補助） |
| `summary` | ○ | その軸が何を表すか 1 行。生成物の doc コメント・分岐図の見出しに出る（体系側に文言を持たせない） |
| `of` | 主語のみ○ | 値の出どころ。`kind: state` なら状態機械名、`kind: field` なら `{エンティティ}.{欄}`。`subject` と一致しなければならない |
| `absent` | 主語のみ○ | 行（該当する値）が無いことを表す値。体系はこの 1 語を `none` と決め打ちしない |
| `values` | `kind: enum` のみ○ | 値の候補 |
| `labels` | — | 値 → 表示名。宣言の無い値は値そのものが出る。`values` に無い鍵はエラーにする（H0 / H1） |
| `when` | — | `{相手の軸 ID}: {値}` を 1 件。**その条件の行だけが持ち、それ以外の行では持ってはいけない**（H1）。相手の軸は自分より前に宣言されていること（循環の禁止） |
| `optional` | — | `true` なら行ごとに任意。`when` とは同時に書けない |

- **主語の軸（`kind: state` / `kind: field`）はちょうど 1 本**でなければならない（H0）。決定表の主語が 2 つあると、どちらの全域性を見るのかが宣言から決まらない。
- `when` / `optional` のどちらも書かない軸は**全行で必須**である（主語の軸がその形）。
- **`when` は「暗黙の判断」を宣言に変える。** 題材の製品の「既存の利用者に招待は効かない」は `when: { patron: none }` の 1 行であり、以前は体系側のコードが `invitation` という軸名ごと持っていた（束 ⑲-2a で仕様側へ移した）。
- 行に書ける鍵は「骨格（`id` / `runs` / `lands` / `summary`）∪ 宣言した軸 ID」だけである（H0）。綴り違いの鍵は「書いたのに効いていない宣言」になるのでエラーにする。

### 1 行が宣言すること

**`landings`（着地 = サインインの結末）**

| キー | 必須 | 意味 |
|---|:---:|---|
| `id` | ○ | 着地 ID。**実装が返す着地先の語と同じ文字列**（生成物経由で実装が使う） |
| `screen` | ○ | 着地する画面の `screen_spec` の id。引数の要らない route であること（H2） |
| `variant` | △ | 着地する画面の排他表示（`variants`）のキー。**その画面への着地が 1 つでも `variant` を宣言したら、その画面へ落ちる全着地に必須になる**（下記 H2 の線引き） |
| `summary` | ○ | どういう結末かを 1 行で |

**`sign_in`（分岐 = 決定表の 1 行）**

| キー | 必須 | 意味 |
|---|:---:|---|
| `id` | ○ | 分岐 ID（スネークケース）。生成物とテストの突合キー |
| **宣言した軸の ID** | 軸の宣言に従う | その軸の値。主語の軸は全行で必須、`when` の軸はその条件の行だけ、`optional` の軸は任意。**体系は `patron` / `invitation` のような特定の鍵を知らない** |
| `runs` | △ | この行で**起こす**ドメインイベント。「起こす」であって「成立する」ではない（拒否された受諾も起こしてはいる） |
| `lands` | ○ | 着地（`landings` の id） |
| `summary` | ○ | 何が起きるかを 1 行で |

題材の製品の 4 軸はこの形の 1 例である —— `patron`（主語）/ `invitation`（`when: { patron: none }`）/ `guild`・`activate`（`optional`）。「書いた行だけが在籍を問い合わせる」という判断は `optional` の軸を書くか書かないかで表される（書かない行は外部 API を叩かない、という宣言）。

**`gates`（関門 = 画面に入るときの資格）**

| キー | 必須 | 意味 |
|---|:---:|---|
| `id` | ○ | 関門 ID |
| `guards` | ○ | 何が呼ぶか。`requires_auth`（画面仕様の `requires_auth: true`）/ `role_gate`（`for: [{role}]`） |
| `role` | △ | `guards: role_gate` のときだけ持つ、`for: [...]` が見る roles.md のロール ID（例: `staff`） |
| `on_fail` | ○ | 通れなかった人の扱い。`redirect` / `not_found` |
| `to` | △ | 送り先の画面 id。**`on_fail: redirect` のときだけ**持つ（書き忘れも余分も H0 が落とす） |
| `implementation` | ○ | `パス::関数名`。H2 が実在を関数名まで見る |
| `summary` | ○ | どういう関門かを 1 行で |

**条件の組（宣言した全軸の値）が同じ行を 2 つ書けない**（H0）。同じ状況に結末が 2 つあるのは「どちらが起きるか宣言できていない」ことであり、決定表としては壊れている。

### `callback`（OAuth の帰り道の口）

サインインの分岐（`sign_in`）は「戻ってきた人が誰で、どこへ着くか」を宣言するが、**戻ってくる口そのもの**（URL）は、実装の木の HTTP の入口の閉世界（J2 の続き。[route-handlers.md](../../system/standards/conventions/route-handlers.md) §口は宣言に載るものが全部）が「宣言のどれかに当たる」を要求するので、ここに宣言する。

```yaml
callback:
  endpoint: /api/auth/callback     # URL のパス。ジョブの endpoint と同じ形（置き場は配置が決める）
  summary: 認可コードをセッションに交換し、利用者を同期して着地先へ送る
```

| キー | 必須 | 意味 |
|---|:---:|---|
| `endpoint` | ○ | 口の URL のパス（`/api/...`）。`//`・`?`・`#`・`.` / `..` のセグメントは書けない（J2 が `app/` の有無に依らず指す）。実装の木に Route Handler が実在すること・ほかの宣言（ジョブの `endpoint`・受信口・外部連携の `endpoints`・画面の `route`）と同じ URL を取らないこと（J2） |
| `summary` | ○ | どういう口かを 1 行で |

- **`callback` ごと任意。** OAuth でないサインインの仕組みは書かない（書かなければ認証の口の宣言は無い）。OAuth を使うのに書かなければ、その口は J2 が「どの宣言にも当たらない」と指す。
- **着地先の URL とは別の宣言である。** `landings` の着地先は画面の `route`（`AUTH_LANDING_PATHS`）で、`callback` は人が戻ってくる**入口**の側。
- 1 ファイルの中で閉じる形（マッピングであること・キーが `endpoint` / `summary` だけ・両方あること）は H0 が見る。

### `start` / `logout`（サインインの開始とログアウトの口）

**ログインのトークンはサーバーだけが持つ**（ログインのトークンをサーバーだけが持つ形の案 A・保証 `session_tokens_server_only`）。セッションの cookie は `HttpOnly` でスクリプトから読めないので、サインインを始めるのも、ログアウトするのも、**サーバーの口**になる。ブラウザの認証基盤のクライアントは作らない（製品の lint `layer/session-tokens-server-only` が止める）。

```yaml
start:
  endpoint: /api/auth/sign-in      # POST。ログインのボタンのフォームが叩く
  summary: 要求の出どころを確かめ、サーバーで OAuth を始めて認可へ送る
logout:
  endpoint: /api/auth/logout       # POST。ログアウトのボタンのフォームが叩く
  control: signed_out              # ログアウトの操作の名前(共有クロームの navigations の on)。H8 が見る(ASVS V7.4.4)
  summary: 要求の出どころを確かめ、この端末のセッションだけを閉じ、認証の cookie を全部消す
```

キーは `callback` と同じ（`endpoint` / `summary`）。**`logout` だけが `control` を持つ**（ログアウトの操作の名前。共有クロームの `navigations[].on` と同じ、ドットを含まない自由語彙）。`logout` を書いたら `control` も書き、**`requires_auth` の全画面が、その遷移を持つ共有クロームを被る**（H8 の error）。ログアウトのボタンはクロームの部品（例: ヘッダ）に居て、押した後に着地する画面への遷移（`on: signed_out`）を chrome_spec に宣言する。クロームを被り忘れた画面やクロームの遷移からログアウトを落とした画面は、ログインしたまま出られない行き止まりになる。画面が自分で書いた同名の遷移は数えない（画面ごとに書き写すと片方だけ落ちる）。見えるだけで、押したら本当にログアウトするかは実装の木の見張りテストと E2E が担う。

- **`callback` を書いたら、`start` と `logout` も書く**（H0 の error）。帰り道だけがあると、開始とログアウトがブラウザのスクリプトに残る形を仕様が許してしまう。`callback` が無ければどちらも任意。
- **口の中身はセッションの adapter が持つ**（`@kaninabe/adapter-supabase-session` の `startSignIn` / `signOut`）。製品の `route.ts` は配線を呼ぶだけで、要求の出どころの確認（`Sec-Fetch-Site: same-origin` と、スキームとホストが自分に一致する `Origin`。片方でも欠ければ 403）・cookie の約束（`__Host-`・`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`・`Domain` なし）・ログアウトの範囲（**この端末だけ**。`scope=local`）・`Clear-Site-Data` は adapter の中にある（仕組みの保証 `fw_session_cookie_policy`）。
- **帰り道（`callback`）は出どころを確かめない。** 別のサイト（プロバイダ → 認証基盤 → アプリ）から来るのが正しい口だからで、守りは PKCE の検証子（開始の口が書いた `HttpOnly` の cookie にある）である。免除の一覧には載せない —— 確かめない理由は宣言の種類そのものにある。
- **サインインの往復で運ぶ値**（例: 招待の着地から来た人の招待）は、フォームの本文で開始の口へ送り、adapter が約束の属性の cookie に書く（スクリプトの `document.cookie` は使わない）。帰り道は読み終えたら消す。
- 実装の木に `route.ts` が実在すること・ほかの宣言と同じ URL を取らないことは J2 が見る（[route-handlers.md](../../system/standards/conventions/route-handlers.md)）。

### 画面の関門は宣言から導く（screen_spec ⇔ auth_spec を閉じる）

「この画面はどの関門に掛かるか」は、画面が新しい語彙で宣言するのではなく、**screen_spec が既に持っている 2 つの宣言から機械的に導く**。

| screen_spec の宣言 | 導かれる関門(`gates[].guards`) |
|---|---|
| `requires_auth: true` | `requires_auth` |
| `for` に `gates[].role` の値を含む | `role_gate` |

対応は**この 2 本だけの閉じた辞書**であり、`GATE_SUBJECTS`(`lib/model/auth/types.ts`)がその値域そのものである。`role_gate` がどのロールを見るかは `gates[].role`(このアプリの事情。例: `staff`)が宣言し、仕組み側のコードはロール名を決め打ちしない。新しいロールを関門にしたくなっても、`for` に語を足すだけでは関門は増えない — `GATE_SUBJECTS` と `gates` の両方に手を入れる判断が要る(気軽に増える語彙ではない)。

H4 がこの対応を双方向に検証する。

- **画面 → 関門(順方向)**: `requires_auth: true` の画面があるのに `gates` に `guards: requires_auth` の行が無い(または `for: [{role}]` の画面があるのに、その `role` を宣言する `guards: role_gate` が無い)なら**エラー**。関門の宣言を足す(それが実装の `requireSession` / `requireStaff` に対応する)。
- **関門 → 画面(逆方向)**: `gates` に行があるのに、それに掛かる画面が screen_spec に 1 つも無いなら**警告**(誰も通らない検問)。使っていない関門を消すか、掛かる画面を足す。
- **ロールの関門そのもの**: `guards: role_gate` の `role` が roles.md に無ければ**エラー**、`guards: role_gate` の行が 2 つ以上あれば**エラー**。画面が掛かる関門は `gates[].role` と `for` の**字面の一致**で導くので、綴り違いのロールにはどの画面も一致せず、運営向けの画面が「関門に掛からない」ものとして扱われる(順方向のエラーも、ナビの可視性も、実装が関門を呼ぶかの走査も黙り、逆方向の警告だけが残る)。導出は最初の行しか見ないので、2 行目のロールも黙って無視される。

**「宣言されているか」と「実装が本当に呼んでいるか」は別の層で見る。** H4 が見るのは仕様どうしの閉世界(screen_spec ⇔ auth_spec)までで、`_screens/{name}.tsx` の実装が本当に `requireSession()` / `requireStaff()` を呼んでいるかは、screenTest 側の静的走査(`app/src/app/__screens__/gate-implementation.test.ts`)が H2 の実装実在検査(「関数が存在するか」)の延長として担う(「呼ばれているか」まで)。検証器と screenTest でここまで役割を割るのは、他の H 群の検査(H1 は仕様の閉世界・H3 は仕様⇔テストの注釈)と同じ流儀である。

### ここに書かないもの（正が割れる）

- **画面の中身**（何が表示されるか） — `screen_spec` の `variants` が正。ここが宣言するのは「どの表示になる人が来るか」だけで、両者は H2 が双方向に突き合わせる。
  - **ただし双方向に閉じるのは「着地が `variant` を名指した画面」だけである**（束 ⑲-2b）。`variants` は
    レイアウトの語彙でもあり、ロールで出し分ける作成ボタンや読み取り専用の表示のように、
    **サインインの着地とは無関係な出し分け**にも使われる。以前は「着地が落ちる画面に `variants` が
    あれば、その全部が着地の対象」と見なしていたため、ログインと無関係な出し分けを画面に書いた
    瞬間に認証の検査がエラーにしていた（束 ⑱ の実測では、テナントの題材が `auth_spec` を 1 行も
    書けなかった理由がこれである）。
  - 新しい線引きは **「着地の宣言が `variant` を持ったら、その画面は認証の関心の中に入る」**。
    入った画面についてはこれまでと同じ保証が残る —— 着地を 1 つ足したら出し分けを足さないと
    通らないし、逆に誰も落ちてこない出し分けもエラーになる。宣言しなければ、その画面の `variants` は
    レイアウトの出し分けとして認証の外にある。
- **着地先の URL** — `screen_spec` の `route` が正。生成物（`AUTH_LANDING_PATHS`）がそこから引くので、実装にもここにも URL を書かない。
- **操作の可否** — `state_spec` の `from` / `guard` が正。認証層は「実行する」だけで、拒否するのは操作の側である。
- **OAuth の作法・cookie の属性・文言** — 認証プロバイダ（Supabase Auth の example-idp OAuth）と実装の自由。**セッションの寿命は `sessions` が正**（cookie の寿命ではなく、認証基盤がセッションを終える時間を宣言する）。
- **設定（環境変数）** — `config_spec` が正。「example-idp の API トークンが無いと在籍を確認できない扱いにする」は設定カタログの `absence` の領分である。

### プラットフォーム操作（`platform_ops`。任意。ADR-0019）

認証基盤が持つ操作（セッションの一覧・終了など。ドメインの状態機械に写らない）を**画面から叩くための閉じた一覧**。正は 1 か所（ここ）で、画面は `platform_ops:` で名前を参照する（screen-spec-writing.md の S20 / S21）。`logout.control`（H8）を一般化した形で、ログアウト自体は束 D まで専用の形のまま。

```yaml
platform_ops:
  - id: session.list_mine            # "{グループ}.{名前}"（スネークケースの 2 段）。画面の platform_op.{id}.success の id
    label: 自分のセッションの一覧
    kind: read                       # read | do
    actor: { self: true }            # 本人 | { role: staff, active_member: true }（ロール。active_member は既定 false）
    returns: session_summary         # read だけ・必須。shapes のキー
    binding:
      port: SessionManagement        # 配線先のポートの型名（platform_ports のキー）
      method: listMySessions
      result: { rows: SessionSummary }   # 配線先の戻り値（結果の union の value）。read は行の配列 { rows: 行の型名 }
  - id: session.end_mine
    label: この端末をログアウトする
    kind: do
    actor: { self: true }
    args:
      session_id: { from: row, of: session.list_mine, field: id, skip_if: is_current, format: uuid }   # 識別子は from: row の欄だけ
    confirm: false                   # do だけ・必須（確認の要否を暗黙にしない）
    binding:
      port: SessionManagement
      method: endMySession
      params: [{ name: sessionId, arg: session_id, type: string }]   # 配線先のメソッドの引数（位置の順）→ 宣言した引数
      result: boolean                # 結果の union の value の型（string / boolean / number）
  - id: session.end_every
    label: 全員をログアウトさせる
    kind: do
    actor: { role: staff, active_member: true }
    args: { keep_self: { type: bool, default: true } }   # 型つきの入力は bool | int | string（string は H9 が止める）
    confirm: true
    binding:
      port: SessionManagement
      method: endEverySession
      params: [{ name: options, optional: true, props: { keepSelf: { arg: keep_self, type: boolean, optional: true } } }]   # オブジェクトの引数はプロパティごとに引数へ対応
      result: number
platform_ports:                      # 配線先のポートの宣言（配線の実際の形と H9 が構文木で突き合わせる）
  SessionManagement:
    result: { type: SessionManagementResult, ok: ok, value: value, reason: reason }   # 結果の union の判別の欄
    refusals:                        # 失敗の理由 → 画面に出す文言（閉じた集合。配線先が返す理由と過不足なく一致）
      unauthenticated: ログインしてください
      unknown_current_session: もう一度ログインしてください
    rows:                            # 配線先が返す行の型（型・"?" で null がありうる）
      SessionSummary: { id: string, createdAt: string, lastActiveAt: string, userAgent: 'string?', current: boolean }
shapes:                              # 画面が受ける欄の閉じた集合。欄 → 配線先の行のプロパティの対応表
  session_summary:
    row: SessionSummary
    fields: { id: id, created_at: createdAt, last_used_at: lastActiveAt, user_agent: userAgent, is_current: current }
    labels: { last_used_at: 最後に使った日時 }   # 表の見出し（任意。無い欄は欄名）
    formats: { last_used_at: datetime }          # 表示の整形（任意。datetime は string の欄だけ）
secret_field_words: [token, refresh, secret, jwt]   # shapes を書くなら必須。欄名・対応先の行のプロパティ名に含めてはいけない語（体系は語彙を持たない）
```

- **形は H0**: 書けるキー（`id` / `label` / `kind` / `actor` / `args` / `returns` / `needs` / `confirm` / `binding`）・`read` だけが `returns`、`do` だけが `confirm` を持つ・`actor` は `{ self: true }` か `{ role, active_member? }`（混ぜない）・`args` の出どころは `from: row`（`of` / `field` / `skip_if` / `format: uuid`）か型つきの入力（`from` の他の種類は書けない）・`binding` は `{ port, method, params?, result? }`（`params` は位置の順のスカラーかオブジェクトの引数）・`needs` は `current_session` だけ。`shapes` を書くなら `secret_field_words`（小文字の語）も要る。節が無い製品は何も宣言しない。
- **宣言と配線先の ABI の対応表**: 宣言した `args` / `returns` は、配線先の実際の引数・戻り値と**別の語彙**で書かれる（`keep_self` ⇔ `options.keepSelf`、`is_current` ⇔ `current`）。片方だけ変わっても画面が組まれたまま食い違うので、対応表（`binding.params` / `binding.result` / `platform_ports` / `shapes` の `row` と `fields`）を宣言に持たせ、H9 が未対応・余剰・重複・型の食い違いを拒む。型・null の有無（`?`）・配列（`rows`）・結果の union（`result` と `refusals`）を省略しない。
- **意味は H9**（下の表）。配線先の実在と形は H9 が**構文木**で見る（役割 `platform-binding` の手書きの配線: ポートの interface・組み立て関数・メソッドの引数と戻り値・結果の union の失敗の理由・行の型）。
- **配線先の場面（`.scenario`）**: 配線の隣に `{配線}.scenario`（例: `session-management.scenario.ts`）を手書きして `{ポート名の先頭を小文字}Scenario`（`PlatformScenarioFactory`）を export する。配線の**本物の組み立て**に偽の部品（実行者・資格・認証基盤の写し）を渡し、本人の読みの行・自分と別の利用者の持ち物の ID・手つかずかの確認を返す。生成テストがこの場面で権限表・接続・負例を確かめる（無ければ H9 が名指す）。
- **生成物**: `domain/generated/platform-ops.ts`（型・入力のスキーマ・表）・操作ごとの Server Action（`_actions/platform/{グループ}/{名前}.ts`）と組み立ての根（`composition/platform/…`）・画面の部品（`platform_read` / `platform_actions` / `table` の `row_actions`）・生成テスト（`composition/__tests__/generated/platform-ops.test.ts`。仕様の `test_cases` が題を指すと `@tc` が付く）。入口の関門の順序は 実行者の解決 → パース → 〔多要素認証の解決〕→ 組み立ての根（多要素認証の判定 → 配線先の呼び出し → 宣言した欄だけの射影）→ 拒否の記録。要求の出どころの確認はリクエスト前段が掛ける。

### 検証（H 群）

| ID | 何を見るか | 実行場所 |
|---|---|---|
| **H0** | スキーマ適合。`providers`（必須・空不可・スネークケース・重複なし）と `local_only`（任意・`providers` と重ならない）・`sessions`（必須。3 欄・期間の形・`inactivity` < `absolute`・空でない理由・`concurrent`〔同時に持てるセッションの数。上限なしなら `unbounded` と理由、あれば `max` / `on_limit` / `reason`〕）・`idp_session`（必須。`logout` / `idp_ends` / `lifetime` / `reason`。いまの仕組みが支えられる語だけ通す）・`mfa`（必須。外す宣言は空でない理由だけ・要求なら `to` / `implementation` / `summary` と `require` の形）・`callback` / `start` / `logout`（任意。`callback` があるなら `start` と `logout` も要る）がマッピングで `endpoint` / `summary` を持つこと・`id` の固定値・行の id の形式と重複・**主語の軸（`kind: state` / `field`）がちょうど 1 本でその `of` が `subject` と一致すること**・`when` / `optional` の排他と前方参照・`enum` の軸の値が `values` に載っていること・行に宣言されていない鍵が無いこと・**条件の組の一意性**・`to` と `on_fail` の対応 | ローダー（`lib/model/auth/loader.ts` / `lib/model/auth/parse-auth-axes.ts`） |
| **H1** | 分岐の**全域性と接地**。主語の値の全体（状態機械の `states`、または `enum` の `values`）+ `absent` が尽くされていること・`lands` の接地・誰も落ちてこない着地・`runs` の実在と `by: system`・**`when` を宣言した軸がその条件の行だけに現れること**・`labels` / `when` の値が実在すること | `lib/auth/verifiers/h1-branch-totality.ts` |
| **H2** | 着地と関門の接地。着地先の画面の実在と引数なし route・**排他表示（`variants`）との双方向一致（着地が `variant` を名指した画面だけが対象。束 ⑲-2b）**・関門の送り先が実在しそれ自身がログインを要求しないこと・実装の実在（**`app/` が無い構成では実装の項だけ飛ばす** — 仕様だけのリポジトリは正当な形である。束 ⑲-1 #2 の一般則） | `lib/auth/verifiers/h2-landing-grounding.ts` |
| **H3** | テスト突合（`test_cases` ⇔ `@tc`）と `spec_ids` の実在 | `lib/auth/verifiers/h3-test-trace.ts` |
| **H4** | 関門の宣言。screen_spec ⇔ `gates` の双方向一致(下記§画面の関門は宣言から導く) | `lib/auth/verifiers/h4-gate-declaration.ts` |
| **H6** | **多要素認証の要求**。外す宣言を毎回 warning（受け入れた危険）で名指す・IdP に任せる宣言（`delegated`）は任せる先が `providers` の外部の IdP で、本番の方式がその IdP 1 つだけであること（ほかの本番の方式があれば error）・ロールで絞る要求のロールが roles.md に実在しサインインするロールであること・送り先の画面が実在し引数なしで送れてログインを要求し、ロールで絞るならそのロールの画面でないこと・確かめる関数の実在（**字面ではなく構文木で export を見る**。実装の木が無い構成では飛ばす）・**書き込みの入口の執行の接続点**（要求するなら、認証の組み立ての根が `resolveSessionMfa` を export していること。執行そのものは生成された Server Action と実行器が持つ）・**手書きの入口**（要求するなら、`runner: manual` の操作の Server Action が組み立ての根を呼ぶ前に `refuseUnverifiedMfa` を呼んで拒否なら返していること。構文木で見る）。画面が未選択・阻害なら画面との突合は出さない | `lib/auth/verifiers/h6-mfa-requirement.ts` |
| **H7** | **拒否の記録の接地**（ASVS V16.3.2・V16.3.3。[logging.md](../../system/standards/conventions/logging.md) §セキュリティの事象）。生成された Server Action は、実行者をパースより先に解き、拒否を返す前に `recordActionRefusal` で 1 行記録する（実行時パッケージの `@kaninabe/runtime/security-log`）。製品が手で書くのは接続点だけで、認証の組み立ての根が `recordActionRefusal` と `resolveRequestId` を値として export していること（**構文木で見る**。実装の木が無い構成では飛ばす）。`runner: manual` の操作の手書きの Server Action は実行器を通らないので、export した関数ごとに ①認証の組み立ての根から import した `recordActionRefusal` を呼んでいる ②実行者の解決（`resolveActorId`）が入力のパース（`.safeParse(` / `.parse(`）より先にある、の 2 つを満たすこと（error）。見ないのは、記録を呼ぶ位置が拒否の返却の直前かどうか・出力口の中身 |
| **H8** | **ログアウトの操作**（ASVS V7.4.4）。`logout` を宣言したなら `control`（ログアウトの操作の名前）も宣言する・`requires_auth` の全画面が、`control` の遷移を持つ共有クロームを被っている（画面が自分で書いた同名の遷移は数えない）。画面仕様が未選択・阻害のときは画面を見ない（`control` の宣言漏れは画面に依らず言う）。`logout` を宣言しない構成は見ない | `lib/auth/verifiers/h8-logout-control.ts` |
| **H9** | **プラットフォーム操作の宣言**（`platform_ops` の閉世界。ADR-0019）。操作 id の重複・同じ配線先（`port.method`）を 2 つの操作が使うこと・`actor.role` が roles.md に無いこと・`needs: current_session` が本人の `do` 以外にあること・型つき入力に `string` があること（識別子を自由入力にしない）・本人の操作の `from: row` が本人の読み（`actor: self` の `read`）の行でないこと・`of` が宣言した読みなら `kind: read` でなく / `field` が返す欄に無いこと・`returns` が `shapes` に無いこと・欄名が `secret_field_words` の語を含むこと（使われていない `shape` の欄も）。**宣言と配線先の ABI の対応表の整合**: 配線先のポートが `platform_ports` に無いこと・宣言した引数の未対応・余剰・重複・型の食い違い・`result` が無いこと / 読みが行の配列でないこと / 行の型が shape の `row` と違うこと・返す欄の対応表が無いこと・対応先の行のプロパティが実在しないこと / 2 つの欄が同じプロパティに対応すること・対応先の名前にも秘密の語があること・識別子の欄が null になりうること・`skip_if` が null にならない真偽値でないこと・`labels` / `formats` の鍵が欄にないこと（`h9-platform-mapping.ts`）。**配線先の実際の形との突合**（構文木。`h9-platform-binding-source.ts`）: 配線のファイルと `{配線}.scenario` が無いこと・ポートの interface / 組み立て関数 / 場面の関数を export していないこと・メソッドが無いこと・引数の数・名前・省略・型（オブジェクトの引数はプロパティの集合まで）・戻り値（`Promise<結果の union<値>>`）が違うこと・結果の union の失敗の理由と `refusals` が過不足なく一致しないこと・同じファイルの行の型のプロパティが `rows` と違うこと。宣言の無い製品は見ない | `lib/auth/verifiers/h9-platform-ops.ts` ほか |
| **H5** | **サインインの方式・公開スキーマ・セッションの寿命・戻り先の許可リストの突合**（プラットフォームのローカル設定 ⇔ 宣言）。**戻り先の許可リスト**（Supabase の `[auth] site_url` と `additional_redirect_urls`）の各値は、パスが `callback.endpoint` に一致する http(s) の絶対 URL で、ワイルドカード（グロブの文字）・クエリ・フラグメント・利用者の情報を含まない（許可リストに無い戻り先は `site_url` に置き換わり、描かれた画面に認可コードが着くと同じオリジンのスクリプトが読んで交換できる）。`site_url` が書かれていなければ既定（トップの画面）で読んで赤。`callback` の宣言が無ければ見ない（未実施）。**本番の管理画面の値は見えない**ので、見たときも毎回「本番の戻り先の許可リストは見ていません」と未実施を名指す。開いているサインインの方式（メールの登録・SMS・匿名・外部プロバイダ・外部の認証基盤・ウォレット）が `providers` か `local_only` に載っているものだけであること・外へ出すスキーマがプラットフォームの設定の `exposedSchema`（surface の公開スキーマ）の 1 つだけであること（deploy 先の上書きも同じ規則で、許すのは `providers` だけ）。**セッションの寿命が `sessions` と同じ長さであること・アクセストークンの寿命が無操作の時間切れより短く、クライアントのライブラリの更新の余裕(90 秒)より長いこと・更新トークンの回転を無効にしていないこと**（Supabase は `[auth.sessions] timebox` / `inactivity_timeout`・`[auth] jwt_expiry` / `enable_refresh_token_rotation`。deploy 先は自分で書いたキーだけ）。**多要素認証を要求するなら、要素が 1 つ以上登録も確認も有効であること**（Supabase は `[auth.mfa.totp]` / `phone` / `web_authn`）。**本番の方式にパスワードで登録・サインインできる方式（許可表: `providers` に `email` か `phone`）を置くなら、パスワードの守りが ASVS L2 の値であること**（Supabase は共通に `[auth] minimum_password_length` ≥ 8・`[auth.email] secure_password_change = true`、`email` は `[auth.email] enable_confirmations = true`・`double_confirm_changes = true`（既定 true。書いて外したときだけ赤）、`phone` は `[auth.sms] enable_confirmations = true`。**総当たり・リスト型攻撃の抑止（ASVS V6.3.1）として、認証基盤の流量の上限 `[auth.rate_limit] sign_in_sign_ups`・`token_verifications` が 1 以上 30 以下（1 つの IP から 5 分あたり。Supabase の既定）**。上限の値の根拠: ASVS V6.3.1 は数を定めず、NIST SP 800-63B §5.2.2 の「アカウントごとの連続失敗 100 回以下」は Supabase の設定に書く場所が無い（設定は IP ごとの流量）ので、「認証基盤が安全側として出荷する既定より緩めない」を許可表にする（30 / 5 分でも 1 つの IP から 1 日 8,640 回試せる。0 は上限として意味を持たない）。**送信の流量（メールの爆撃・送るたびに課金される SMS の水増し。ASVS V2.4.1）も同じ方式で、`email` は `[auth.rate_limit] email_sent` が 1 以上 2 以下、`phone` は `sms_sent` が 1 以上 30 以下（1 時間あたりの通数。Supabase の既定。点検 7 回目 B7-7）**。書かれていなければ既定で読む（パスワードの守りの 5 キーは赤・流量の 4 キーは既定で通る）。`local_only` だけの方式は見ない）。**`secure_password_change` は「最近のサインインか再認証のコード」で、今のパスワードの入力ではない** —— ASVS V6.2.3（変更に今のパスワードを求める）は設定では満たせないので、**パスワードの変更の画面を持つ製品は、変更の前に今のパスワードで `signInWithPassword` を通して確かめる**（製品の責任。H5 は見ない）。**書かれていないキーはプラットフォームの既定で読む**（書き忘れが開いた口にならない）。設定ファイルが無ければ未実施 | プラットフォームの後段（Supabase は `lib/targets/supabase/config/h5-auth-config.ts`）。口の ID と契約は `lib/auth/platform-config.ts` |

**なぜ検査群の記号が `H` なのか。** 素直な `A`（auth）は仕様⇔テストのトレース群が使っており、`S`（session / sign-in）は画面仕様が使っている。`H` は空いている中で「入口（Hall）」を連想でき、他のどの名前空間とも衝突していない（`K` = Konfiguration と同じ選び方）。

**実装側の閉世界は生成物 + app 側のテストで閉じる。** `app/src/domain/generated/auth.ts` に決定表（`SIGN_IN_BRANCHES`）と着地先のパス（`AUTH_LANDING_PATHS`）を出し、
- `app/src/operation/__tests__/shared/sign-in-sync.test.ts` が**決定表を回して** `syncMembershipOnSignIn` を駆動する（着地・実行する操作・在籍問い合わせの有無を宣言と突合）
- OAuth コールバックの Route Handler は `AUTH_LANDING_PATHS` を import する（対応表を実装側に持たない）

これで「仕様 → 生成物 → 実装 → 仕様」の輪が閉じる。

### 検証方法

- `npm run verify`（H0〜H9 が走る。H5 の本体はプラットフォームの後段が登録する）
- `npm run generate`（決定表の図とマトリクス・ハンドブックの章・実装側の期待表を再生成）
- `cd app && npm run test`（決定表 ⇔ 実装の突合）

### session 属性 — 利用者フィールドをログインセッションに載せる(手順 1)

**何のためにあるか。** 画面共通ヘッダのような、`reads` を持てない場所(`chrome_spec` は 6 項目の
allowlist)でも、利用者の表示名のような「ほぼ毎回欲しい 1〜数個の値」を出したい場面がある。
そのたびに DB を読み直すのではなく、**ログインセッション(JWT の `app_metadata`)に載せて
持ち回る**、という形を宣言できるようにしたのがこの属性である。

**宣言。** `entity_spec` の `fields[]` に `session: true` を書く(`personal` と並ぶ任意キー。
省略時 `false`)。付けられるのは**認証ユーザーに対応する集約(1 つだけ)**に限る —
複数の集約に付くと、生成物 `SESSION_FIELDS`(列名だけの平たい配列)は「どの集約の列か」を
持たないため、書く側が主語を決められなくなる。この制約は **V13**(`session: true` の集約が
2 つ以上あればエラー)が全集約を横断して見る。`personal: true` との併存は可(claims は本人にしか
見えないため、公開範囲の制約とは独立)。実物: `patron.display_name`。

**生成。** `app/src/domain/generated/session-profile.ts` に `SessionProfile` 型(`session: true`
の列だけを持つインターフェース)と `SESSION_FIELDS`(そのキーの配列。閉世界)を出す。
`session: true` が 0 件でも空の型・空配列を出す(欠かさず言える生成物にする)。

**書く。** 書き先は **`app_metadata.profile` のみ**(`user_metadata` には触れない —
`user_metadata` は利用者自身が `auth.updateUser({ data })` で書ける領域であり、そこに
セッションの正を置くと本人が偽装できてしまう)。書き込みは 2 箇所から起こるが、実装は
`writeSessionProfile`(`app/src/infrastructure/supabase/session.ts`)1 つだけで、
両方がそれを呼ぶ(書き込みキーの実体が 1 か所にしかない = 食い違いようがない)。

- サインイン完了時(`composition/sign-in.ts`)。利用者行を作った・読み直した直後に呼ぶ。
- `refresh_session_profile` ジョブ(`job_spec`。`source: outbox`)のハンドラ
  (`operation/jobs/handlers.ts`)。編集(`patron.update`)で `SESSION_FIELDS` の列が
  変わったときに、RPC(`update_patron`)が同一トランザクションで積む。
  **`patron.update` は状態遷移ではない**(access_spec の `writes` = update-fields の定型)ため
  `state_spec.effects` は宣言できないが、代わりに `access_spec` の `writes[].effects` が発火元
  になる(domain-spec-writing.md §access_spec)。`writes[].effects` も J1 の母集合に含まれるため
  `source: outbox` のまま双方向閉世界に乗る。宣言列(`display_name`)が実際に変わった行に
  対してだけ、遷移 RPC と同じ `p_effects text[]` + foreach で積む(判断の経緯は
  builder-report-11b2.md)。

**読む。** `composition/auth.ts` の `resolveSessionProfile()` がサーバー側のセッション
(`auth.getUser()`)から `app_metadata.profile` を読む。**DB(`patrons` テーブル)は読み直さない**
── 表示できる値は「直近で `writeSessionProfile` が走った時点」のものになる。

**H 群の突合。** 生成 `SESSION_FIELDS` ⇔ 書く側の実装(`writeSessionProfile`)は、
唯一の実装を両呼び出し元が共有することで構造的に一致する(2 箇所が別々にキーを書き並べる
形にしていないため、突合テストが「食い違い」を発見する余地自体が無い)。この単一経路が
正しく `SESSION_FIELDS` の列だけを読み書きすることは
`app/src/operation/__tests__/jobs/session-profile-handler.test.ts` が見る。

**保証。** `guarantees.md` の `session_profile_server_only`(`enforced_by: [auth_provider]`)
── anon / authenticated の JWT で `auth.updateUser({ data })` を呼んでも `app_metadata` は
変わらない(Supabase Auth の API 契約そのものが執行者であり、このリポジトリのコードは
何も守っていない — 見張りテスト (旧製品の保証台帳の行))。

## 関連ドキュメント

- [config-spec-writing.md](./config-spec-writing.md) — 同型の先行実物（1 プロジェクト 1 カタログ）。語彙の持ち主の線引きはここと逆で、その理由も書いてある
- [screen-spec-writing.md](../../../frontend/specification/standards/screen-spec-writing.md) — 着地先の画面と `variants` の書き方（H2 の突合相手）
- [domain-spec-writing.md](../../../common/specification/standards/domain-spec-writing.md) — 主語の状態機械と `by: system` のイベント（H1 の突合相手）
