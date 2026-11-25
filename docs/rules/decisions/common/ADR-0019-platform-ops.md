---
doc_type: decision
scope: common
id: ADR-0019
status: accepted
targets: [spec_dsl, verification]
date: 2026-10-23
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0009, ADR-0003, ADR-0012, ADR-0015]
---

# ADR-0019: 認証基盤の操作を画面から叩く — auth_spec の `platform_ops` と画面の第 3 の露出口

## Status

accepted (2026-10-23)

---

## Context

### 背景

画面が起こせる操作は `actions` だけで、中身は「状態機械のイベント ID か予約 ID(`{entity}.create/update/delete`)」に**決め打ち**である。
セッションの一覧・終了(ASVS V7.4.5・V7.5.2・V10.4.9)のような、**ドメインの状態機械に写らない認証基盤の操作**は、画面から叩く口が文法に無かった。

- S2 は接地しない `actions` を error「対応するドメインイベントがありません」で止め、直し先として示すのが「先に specs/domain を直す」(=セッションを集約にせよ)になる。
- 読みの `source` は entity_spec の entity で、認証基盤の表(`auth.sessions`)は仕様に出さない約束のため、セッションの一覧を読みとして書けない。
- 例外はログアウトだけで、auth_spec の `logout.control` が名前を持ち、H8 が「認証の要る全画面が被る」を見ていた。

特権 RPC 4 本・adapter・配線(セッションの管理の配線)は入っており、足りないのは画面の宣言だけだった。設計の全体は
設計メモ「セッションの管理の画面 — ドメインイベントでない操作を画面で宣言する」(開発用リポジトリの設計メモ)(裁定 2026-10-23: U-1〜U-7 は推奨どおり)。

### 前提条件

- 拡張の手順は [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md) に従った(下の記録)。
- 宣言しなければ検査・生成物は 1 バイトも変わらない(`platform_ops` が無い製品では H9・S20・S21 は何も言わない)。
- この ADR が決めるのは**仕様の語彙と検査(束 A)**。Server Action・権限表の生成(束 B)と 製品の画面(束 C)は別の束である。

### トリアージの記録

- **手順 0(1 行)**: screen_spec の `actions` に、ドメインイベントでない認証基盤の操作(自分のセッションを終える等)を書きたいが、接地先が文法に無い。
- **手順 1(迂回パターン集)**: P-2 に近いが、非決定の分岐ではないので当たらない。`runner: manual`(action_spec)は「生成に乗らないドメイン操作」の逃げ道で、接地(イベント)が要り、セッションには使えない。
- **手順 2(別の見方)**: キャッシュ・不在による安全・運用・告知のいずれも非該当(状態は認証基盤にあり、ドメインに置かないほうが安全)。
- **手順 3(2 実例)**: ログアウト(既に auth_spec が専用の形を一度作った事実)とセッション管理(本人側 + 管理者側。同じ関心なので併せて 1 例)。多要素認証の登録は候補。独立した製品の実例は 2 つ。
  ログアウトは既に解けているとも読めるので、例外条項(「実装とテストに固着してから直すと全面改修になる」)に頼る。可視性・権限は固着すると全面改修になる型である(裁定 U-1)。
- **手順 4(決定可能性)**: 操作は列挙された名前・引数は型つき・実行者は本人かロールで、変数の域は有限のまま。決定可能性は変わらない(ADR-0003 の決定は動かない)。消費するのは検証器の単純さ(新しい検査 3 本)とレビューの面(auth_spec の節が 1 つ増える)。

---

## Decision

### 決定内容

**P1 auth_spec に任意の節 `platform_ops` を足す**(正は 1 か所)。名前つきの操作の閉じた一覧で、ログアウト(`logout.control`)を一般化する。

```yaml
platform_ops:
  - id: session.list_mine                 # "{グループ}.{名前}"。画面の platform_op.{id}.success の id になる
    label: 自分のセッションの一覧
    kind: read                            # read | do
    actor: { self: true }                 # 本人(利用者 ID はセッションから導く) | { role: staff, active_member: true }
    returns: session_summary              # read だけ。shapes の閉じた欄の集合
    binding: { port: SessionManagement, method: listMySessions }
  - id: session.end_mine
    kind: do
    actor: { self: true }
    args: { session_id: { from: row, of: session.list_mine, field: id } }   # 識別子は一覧の行からだけ
    confirm: false                        # do だけ。必須(確認の要否を暗黙にしない)
    binding: { port: SessionManagement, method: endMySession }
  # needs: current_session(本人の do だけ。いまの端末が不明なら拒む)・型つきの入力 { type: bool|int|string, default } も書ける
shapes:
  session_summary: { fields: [id, created_at, last_used_at, user_agent, ip, is_current] }
secret_field_words: [token, refresh, secret, jwt]   # shapes を書くなら必須。欄名に含めてはいけない語(体系は語彙を持たない)
```

軸は仕組み(`kind`・`actor` の形・引数の出どころの種類)、語はアプリ(操作 id・欄名・`port` / `method`・秘密語)である。

**P2 画面は `usecases:` と並ぶ第 3 の露出口 `platform_ops:` で参照する**(`actions:` とは別の口なので、S2・S4・S10・生成物が読む `declaredActionRefs` の母集合に触れない。母集合は兄弟の `declaredPlatformOpRefs`)。
重ね表示も `platform_ops:` を持てる(確認の器の相手)。結果の遷移・閉じるきっかけは `platform_op.{id}.success`(`usecase.` と同じ作法の名前空間)。

**P3 部品は 2 種を足す**(ADR-0015 の `kind` の値域に `platform_read` / `platform_actions`)。`platform_read` は `read` の操作を表にし(`op` / `shows` / `row_actions`)、
`platform_actions` は `do` のボタン列(`ops`)。行ごとのボタン `row_actions` は `kind: table`(query_spec の表)にも書ける(利用者管理の表の行のボタン)。

**P4 検査を 3 本足す**(いずれも error)。

| 検査 | 見るもの |
|---|---|
| **H9**(auth) | 操作 id・配線先(`port.method`)の重複なし・`actor.role` が roles.md に実在・`needs` は本人の `do` だけ・型つき入力に `string` を許さない(識別子は `from: row` の欄だけ)・本人の操作の `from: row` は本人の読み(`actor: self` の `read`)の行から・`of` が宣言した読みなら `field` が返す欄にある・`returns` が `shapes` に居る・欄名に `secret_field_words` の語を含まない |
| **S20**(screen) | 参照が auth_spec に実在・露出する画面は `requires_auth`・ロールの操作は画面を見る全ロールがそのロールを持つ(同じか含意)・`platform_op.X.success` は画面が露出する `do` の操作・`op` は `read`、`ops` / `row_actions` は `do` で画面の `platform_ops` に居る・`shows` は返す欄の部分集合・`from: row` の操作は `row_actions` にだけ載り出どころは部品が表にする読み・`confirm: true` は重ね表示と `confirm_bar` を持つ・chrome に書けない |
| **S21**(screen) | 人間が起こす全操作が、どれかの画面に現れる。出さないなら README の `unexposed_platform_ops`(`- op` / `reason`)で理由宣言(S10 の `unexposed` と同じ方式。用済みは warning) |

**P5 宣言と配線先の ABI の対応表を明示する**（束 B。設計レビューの指摘: 欄の名前 `is_current` ⇔ `current`、引数 `keep_self` ⇔ `options.keepSelf` が食い違ったまま画面が組まれる事故を宣言の時点で止める）。
`binding` に `params`（配線先のメソッドの引数を位置の順に宣言した引数へ。スカラーかオブジェクトの引数）と `result`（結果の union の `value` の型。読みは行の配列 `{ rows }`）を、`platform_ports` に結果の union の判別の欄・失敗の理由と画面に出す文言（閉じた集合）・行の型（型と null の有無）を、
`shapes` に欄 → 行のプロパティの対応表（`row` / `fields`。見出し `labels` と整形 `formats` は任意）を持たせる。H9 が未対応・余剰・重複・型の食い違いを拒み、**配線先の TypeScript の形そのもの**（メソッド・引数・戻り値・結果の union の失敗の理由・同じファイルの行の型）を構文木で突き合わせる。
引数の `skip_if`（行のこの真偽値の欄が true のボタンを出さない）と `format: uuid`（壊れた識別子を配線先に届く前に弾く）もここで宣言する。

**P6 生成物と関門の順序を固定する**。生成器は 型・入力のスキーマ・表（`domain/generated/platform-ops.ts`）・操作ごとの Server Action と組み立ての根・画面の部品（`platform_read` / `platform_actions` / `table` の `row_actions`）・生成テストを出す。
入口は 実行者の解決（パースより先）→ パース（スキーマは `.strict()`。本人の操作に利用者 ID の欄は無く、余剰の鍵は弾く）→ 〔多要素認証の解決〕→ 組み立ての根（多要素認証の判定 → 宣言した対応表どおりに配線先を呼ぶ → **宣言した欄だけを明示の射影で写す** → 失敗の理由は宣言の閉じた集合）→ 拒否の記録。要求の出どころの確認はリクエスト前段（Server Action を含む文書の口の保護範囲）が掛ける。
`from: row` は UI の出どころであって改竄不能の証明ではない —— 認可は配線先がセッションから導いた利用者とリクエストの識別子で決め、他人の ID は拒む（生成テストが偽造した ID・一覧に無い ID・壊れた ID の直呼びを試す）。

**P7 配線先の場面（`.scenario`）で権限表を実際の配線に当てる**。配線の隣に手書きの `{配線}.scenario`（`PlatformScenarioFactory`）を置き、配線の本物の組み立てに偽の部品（実行者・資格・認証基盤の写し）を渡す。
生成テストはそこで 権限表（未ログイン・有効利用者・ロールの持ち主・無効化された持ち主）・現在の端末が不明な拒否・偽造 ID・配線先が受ける呼び出し（引数の名前・値・型つきの入力の true / false）・結果の写し（配線先の応答に余分な秘密の欄があっても画面の値に残らない）・入口の関門の順序を確かめる。

### 適用範囲

仕様の語彙(auth_spec・screen_spec)・パーサー・H9・S20・S21。Server Action・権限表・返す欄の型の生成と、`binding` の実在(port の型が住む場所の対応)の検査は束 B、
製品の 2 画面・導線・E2E は束 C。ログアウト(`logout.control`・H8)と多要素認証の登録を `platform_ops` へ寄せるかは束 D で判断する(裁定 U-2: この束では寄せない)。

---

## Consequences

### Positive（メリット）

- 操作の**正が 1 か所**(auth_spec)になり、実行者の資格・引数の出どころ・返す欄・確認の要否・配線先を宣言から閉じた形で検査できる。
- 識別子を自由入力にできない(`from: row` の欄だけ)ので、「他人の利用者 ID・セッション ID を渡せる」形が宣言を書いた時点で書けない(PRIN-0009)。トークン系の欄は `shapes` に宣言できない。
- 既存の母集合(S2・S4・S10・生成物)を変えない。宣言しなければ何も変わらない。

### Negative（デメリット・トレードオフ）

- 語彙・パーサー・検査 3 本・レビューの面(auth_spec の節)が増える。宣言が 5 本を超えたら置き場(新しい doc_type)を再検討する(裁定 U-4)。
- `binding` の実在は束 B まで検査されない(束 A では形と重複まで)。
- 実例は同じ関心の 2 つ(ログアウトとセッション管理)で、別プロジェクトでの再現ではない。多要素認証の登録の画面が現れたら再点検する。

### Neutral（その他の影響）

- ログアウトは `logout.control` のまま(束 D まで二重の形が残る)。
- 一覧の IP・User-Agent は本人の端末の見分けのために `shapes` に出し、ログには出さない(裁定 U-5。ユーザーが覆しうる)。

---

## Alternatives Considered

### Option A: セッションをドメインの集約に見せる(却下)

`auth_session` 集約を作り、状態機械 `active → ended`・イベント `end`(`by: [account_owner]`)・`end_all`(`by: [staff]`)を書き、`runner: manual` で配線は手書きにする。

- **Pros**: DSL は無改造。S10・S13・S19 の既存の網羅と確認(U1)がそのまま効く。
- **Cons**: 状態の写しは認証基盤が持つ(`auth.sessions` の綴りは特権 RPC の本文に閉じる約束)。ドメイン側に**嘘の表**(entity・data_table・RLS・DDL)が生え、同期の責任が生まれる。
  `end_other` は集合に対する操作で状態機械の遷移ではなく、**宣言が実体を写さない**(迂回の限界)。
- **Why rejected**: 状態が認証基盤にあり置かないほうが安全で、宣言が実体を写さない。トリアージの記録に「写しをドメインに持つ迂回は不可」の 1 行を残した(裁定 U-6)。

### Option B: `actions` に `platform:` 接頭辞を許す(却下)

- **Pros**: 画面側の変更が最小(S2・action-ground に 1 分岐)。
- **Cons**: 操作の正がどこにも無い(誰が実行できるか・引数・戻り・配線先が画面側の文字列になる)。`declaredActionRefs` の母集合が全検査(S4・S10・生成物)へ漏れ、各所で「イベントか否か」の分岐が増える。実行ロールも導けない。
- **Why rejected**: 正が無く、既存の検査の母集合を汚す。

### Option C: 新しい doc_type を作る(却下)

- **Cons**: 実行者の解決・ロール・MFA の関門と同じ文脈(auth_spec)から離れ、レビューの面が増える。
- **Why rejected**: 5 本を超えたら再検討(裁定 U-4)。

---

## Implementation

### Tasks

- [x] 束 A: auth_spec のパーサー・型(`platform_ops` / `shapes` / `secret_field_words`)・画面のパーサー(`platform_ops:`・`platform_read` / `platform_actions` / `row_actions`・README の `unexposed_platform_ops`)・H9・S20・S21
- [x] 束 B: 宣言と配線先の対応表（P5）・Server Action と組み立ての根と画面の部品の生成器（P6）・生成テスト（P7）・`binding` の実在と形の検査（H9）
- [x] 束 C: 製品の宣言と 2 画面（sessions・patron_admin の追加）・導線（共有クロームの `sessions_link`）・E2E 1 本。ASVS 対応表の更新は台帳の担当
- [ ] 束 D(任意): ログアウト・多要素認証の登録を `platform_ops` へ寄せる

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: [ADR-0003](./ADR-0003-constrained-spec-dsl.md)(表現力の制限。適用範囲を広げる)・[ADR-0015](./ADR-0015-layout-component-kind.md)(部品の `kind` の値域に 2 語を足す)・[ADR-0012](./ADR-0012-db-as-authority.md)(DB が権威。実行者の資格は配線がいまの DB の行で確かめる)
- **Blocks**: None
- **Blocked by**: None

---

## References

- 設計メモ「セッションの管理の画面 — ドメインイベントでない操作を画面で宣言する」(開発用リポジトリの設計メモ)
- [dsl-extension-triage.md](../../process/common/specification/playbooks/dsl-extension-triage.md)
- [auth-spec-writing.md](../../process/backend/specification/standards/auth-spec-writing.md)・[screen-spec-writing.md](../../process/frontend/specification/standards/screen-spec-writing.md)

---

## Notes

- 2 実例ルールの数え方(ログアウトを実例に数えてよいか)は裁定 U-1 で例外条項に寄せた。多要素認証の登録の画面が現れたら、実例が 3 つになる。
