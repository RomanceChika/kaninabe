---
doc_type: process
scope: frontend
norms: [PRIN-0001, PRIN-0006, PRIN-0007]
decisions: [ADR-0011]
---

# ユースケース仕様（usecase_spec）の書き方

`docs/specs/frontend/usecases/{name}.md` に置く `usecase_spec`（1 ユースケース 1 ファイル）の YAML スキーマと、検証器が実行するチェック（Y0〜Y12）を定義する。背景と原則は [ADR-0011](../../../../decisions/common/ADR-0011-usecase-layer-two-origins.md)（「起点は 2 つ — 正しさはドメイン、手軽さはユースケース」）。

## 目的

- **「人がやりたいこと」を表す語彙を仕様に持たせる。** ドメインの操作単位（1 遷移 = 1 Server Action）がそのまま人に押しつけられると、「自分一人で貸出に申し込む」のような単純なタスクが 5 回以上の操作・6 個の新しい名詞に膨れる（[ADR-0011](../../../../decisions/common/ADR-0011-usecase-layer-two-origins.md)）。ユースケースはその「1 つのタスク」を単位として宣言する。
- **ドメインは変えない。** ユースケースにできるのはドメインの操作を**組み合わせる**ことだけで、ガード・権限・必須・不変条件を**定義し直す**ことはできない。書けるキーを allowlist で閉じることで、その経路自体を無くす。
- **面倒を数える。** 手数・画面・概念・前提・入力・確認の 6 指標を導出し、認知の予算（既定値または宣言）と比べる。数えられないものは守れない、という原則をここにも適用する。

## 参照するもの

- **原則**: [ADR-0011](../../../../decisions/common/ADR-0011-usecase-layer-two-origins.md)
- **発端**: [ADR-0011](../../../../decisions/common/ADR-0011-usecase-layer-two-origins.md) の Context(「面倒」の 10 成分と導出の元案は非公開の設計記録)
- **画面仕様の書き方**: [screen-spec-writing.md](./screen-spec-writing.md)（`start` が参照する screen_spec の正）
- **Server Action 仕様の書き方**: [action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md)（`steps[].op` が参照する action_spec の正）
- **テンプレート**: [template.usecase_spec.md](../../../../../specs/frontend/usecases/template.usecase_spec.md)

## スキーマ（allowlist）

書けるのは次のキーだけである（Y0 が閉じる。共通フロントマターキー `norms` / `decisions` 等は別途書ける）。

| キー | 必須 | 意味 |
|---|---|---|
| `id` | ✓ | `usecase-{name をハイフン区切りにしたもの}`。`name` から導かれる形と一致すること |
| `name` | ✓ | ユースケース名（snake_case）。ファイル名 `{name}.md` と一致すること |
| `goal` | ✓ | 人の言葉での目的（ハンドブック「タスク」の章の見出しになる） |
| `actor` | ✓ | 実行者。roles.md の**グローバル人間ロール**1 つ（`binding` を持たないもの）。文脈依存ロール（loan_owner 等）は書けない — それはユースケースの結果として立つものであり、開始時点では持てない |
| `start` | ✓ | 起点の画面 id（実在する screen_spec） |
| `done` | ✓ | 達成条件。`"{entity}.{状態フィールド} == {状態ID}"` の形（ガード式と同じ文法の部分集合。比較演算子は `==` のみ、右辺は状態リテラル） |
| `saves` | ✓ | 保存点の列（1 つ以上）。各要素は `id` / `label` / `migration` / `steps` |
| `saves[].migration` | ✓ | この保存点の複合 RPC を書き出す migration のファイル名。`{14 桁}_usecase_{name}_{save}.sql`(Y7) |
| `saves[].steps` | ✓ | 手順の列（1 つ以上）。各要素は `op`（必須）/ `as`（任意）/ `label`（任意）/ `repeat`（任意・既定 false）/ `defaults`（任意） |
| `saves[].steps[].as` | — | 手順の**別名**（snake_case）。入力（`p_input`）・結果・入力スキーマ・フォームの節・testid の鍵になる。書かなければ鍵は `op`。保存点の中で一意（Y11） |
| `saves[].steps[].label` | — | フォームの節の見出し（人の言葉）。書かなければ操作の label（遷移の `label` / 集約の `label`）、それも無ければ `op` |
| `saves[].steps[].defaults` | — | 書けるのは `self: true` だけ（語彙は閉じている）。「自分として」= 実行者自身を指す入力欄の既定値のヒント |
| `budget` | — | 予算の上書き（下記の既定値を指標ごとに上書きする） |
| `accept` | — | **warning の理由つき受け入れ**。1 要素は `reason` + `metric`（予算超過 = Y5）か `invariant`（実行しない不変条件 = Y10。id の実在は Y1 が見る）の**どちらか一方**。両方は書けない |
| `test_cases` | ✓ | 複合 RPC の突合テストの宣言。action_spec と同じ形式。保存点 1 つにつき「署名の実在」「本文の一致」の 2 件以上(Y9)。**`AUTO-GENERATED:usecase-eq-tests` の印の中は生成物**(保存点の一致の証明の宣言 `TC-EQ-UC_{名前}-{番号}`。束 ⑳-5a2)—— 手で書く行は印の外に置く |

**書けないもの(ADR-0011 §2)**: ガード式・権限（`by` 相当）・必須/任意の宣言・不変条件。これらはすべて `steps[].op` が接地するドメイン仕様（state_spec / access_spec / entity_spec）の側にあり、ユースケース仕様に書き写さない。

### `steps[].op` の書き方

`op` は次のいずれかで、A1 と同じ規則で接地する。

- ドメインイベント ID（`{machine}.{event}`。例: `loan.submit`）
- 予約 ID（`{entity}.create` / `.delete` / `.update`）

### `saves`（保存点）の意味

保存点は「人が『保存』を押す単位」である。**内側は全部か無しか**（束⑯c で 1 トランザクションの複合 RPC になる）。保存点をまたぐ依存（前の保存点で作った実体を後の保存点で使う）は正しく、エラーにしない — 保存点の間はドメインの状態（下書き等）そのものが境界になる（ADR-0011 §4）。

**submit を持たない画面は「保存点が無い画面」ではなく「項目ごとに保存点 1 手順の画面」である。**
実例は司書のチェックシート（`item_check.update`）—— チェックを 1 つ付けるたびにその場で保存され、
まとめて送る「保存」ボタンは無い。この形を「保存点が無い」と読むと、1 回のチェックが失敗したときに
何が戻るのかが誰の宣言にも現れなくなる。**チェック 1 つ = 保存点 1 つ**であり、内側は 1 手順、
全部か無しかの単位もその 1 手順である。usecase_spec を起こすかどうかは別の判断で（手順が 1 つで
入力も 1 つなら予算も配線も増えない）、起こさない場合は画面の `actions` がその 1 手順を示す。

## 検査（Y0〜Y12）

Y0（スキーマ適合。ローダーが担う）に加えて、次の 12 の意味検証を行う（Y10 は error と warning の 2 つの目を持つ）。

| 検査 | 何を見るか | 重大度 |
|---|---|---|
| Y1 | 参照実在 — `actor` が実在するグローバル人間ロール、`start` が実在する画面、`steps[].op` がドメイン仕様に接地、`done` が評価可能な形（実在する状態フィールドと状態を指す） | error |
| Y2 | 順序の整合 — 手順の入力（`ref(...)` 型フィールド）が指す集約の `.create` が、ユースケース全体の宣言順でその手順より前にある | error |
| Y3 | 到達 — `actor` が `start` から、各手順を出す画面にナビゲーションで届く(S13 と同じ探索規則。起点だけ `start` に絞る) | error |
| Y4 | 保存点の原子性の前提 — 保存点の内側で作った実体の初期状態が、同じ保存点内の後続の遷移の `from` に入っている | error |
| Y5 | 予算 — 導出した 6 指標(下記)が予算(既定または `budget`)を超えていない | **warning** |
| Y6 | 達成条件 — `done` が `steps` の最後の遷移の `to` と矛盾しない | error |
| Y7 | 保存点の `migration` — `{14 桁}_usecase_{name}_{save}.sql` の形で、全ユースケース・全保存点で一意 | error |
| Y8 | 引数の供給元 — 各手順が呼ぶ RPC が data_table に実在し、その `params` が 1 本残らず下記の規約で解決できる。`defaults.self` が指す欄が一意に決まる | error |
| Y9 | テスト突合 — `test_cases` が保存点の数 × 2 件以上あり、`implementation` が実在するテストの `@tc` と一致する | error |
| Y10 | 実行計画 — 保存点の**`permit`**が要る値（ガード式の変数・文脈ロールの binding・保存点の外から読む行の絞り込み）の供給元が、1 つ残らず下記の規約で決まる | error |
| Y10 | 実行しない不変条件 — 保存点が触る集約の不変条件のうち、`enforced_by: application` なのにこの保存点が実行しないもの（下記） | **warning** |
| Y11 | 手順の鍵 — 各手順の鍵（`as`。無ければ `op`）が保存点の中で一意 | error |
| Y12 | 複合 RPC に写せる — 供給元が plpgsql の字面に写せる（計算値 `computes` は写せない）。再送のとき全手順の結果が「最初に作る行からの鎖」で読み直せる（下記「保存点に置ける手順の形」）。**最初に作る行の表に `resend` の宣言があり、`creator` がその作成の手順で実行者に埋まる列である**（返すのは作成者が実行者の行だけ） | error |

### Y2 の考え方

`loan_companion.create` の入力 `loan_companion.loan_id`(型 `ref(loan)`)は、`loan.create` が生む `loan` を指す。この参照先の `.create` がユースケースの `steps` に**後から**現れる(逆順)ならエラーにする。参照先の `.create` が `steps` に**現れない**場合(蔵書 id のように、ユースケースの外・`start` の文脈からすでに存在する場合)は指摘しない。

### Y3 の考え方・免除

探索は [screen-spec-writing.md](./screen-spec-writing.md) の S13(a)〜(d) のうち、ロールの入場判定とナビゲーション到達(b・d)を再利用する。起点をユースケースの `start` 1 点に絞る点だけが S13(全 entry_point が起点)と異なるため、免除は S13 の器(`screens/README.md` の `unreachable_states`)をそのまま使わない — まず「その手順を出す画面を `start` から届く場所に作る」または「steps を見直す」ことを優先し、それでも解決しない実例が出た時点で免除の要否を再検討する。

### Y4 の考え方

束⑯c(保存点 → 複合 RPC の生成)は「作った直後の状態で後続の遷移が起こせる」ことを前提にする。この前提が崩れている(作成の初期状態が後続イベントの `from` に無い)保存点は、複合 RPC を生成しても実行時に必ず 0 行(競合)になる。Y4 は仕様の時点でこれをエラーにする。

### 同じ操作を 1 つの保存点で 2 回以上実行する（別名 `as`）

同じ集約に**別の役割の行**を 1 保存で入れたいことがある（実例: `loan_self.register` の
「自分」と「他の同伴の利用者」）。操作はどちらも `loan_companion.create` なので、鍵が `op` のままでは
2 つの手順が同じ鍵を取り合う。そこで手順に**別名**（`as`）を書く。

```yaml
- op: loan_companion.create
  as: self
  label: 自分
- op: companion_link.link
  defaults: { self: true }
- op: loan_companion.create
  as: others
  label: 他の同伴の利用者
  repeat: true
```

- 鍵（別名。書かなければ `op`）は**入力・結果・入力スキーマ・実行計画・フォームの節・testid の
  すべて**で使われる。保存点の中で一意であること（Y11）。
- `label` はフォームの節の見出しである。同じ操作が 2 回並ぶ保存点では、**この見出しだけが 2 つの
  節を人に区別させる**（書かなければ操作の label が出る）。
- 拒否（`usecase_conflict:{op}` / `ActionError.event`）が載せるのは**操作 ID の側**である ——
  拒否は「どのドメイン操作が通らなかったか」であり、別名は入力の鍵だからである。

#### 同じ集約を複数の手順で作るときの参照規則

`p_{集約}_id` / 前の手順の結果（`step_result_id`）が指すのは、**「直前までの、その集約を作る
`repeat` でない手順のうち最も近いもの」**である。したがって上の例では、`companion_link.link` の
`p_loan_companion_id` は `self`（`others` は `repeat` なので候補にならない）に決まる。

**繰り返す作成しか先行していなければ生成時エラー**である（反例: どの手順が繰り返しか）——
繰り返す作成は行を何本も作るので「その集約の id」が 1 つに定まらない。親の行を作る
「繰り返さない手順」を前に置くか、その手順を保存点から外す。

#### 同じ表に行を作る手順が 2 つ以上あるとき（再送の読み直し）

再送（冪等）のとき、複合 RPC は既存の行を読み直して同じ形を返す。同じ表に行を作る手順が
2 つ以上ある保存点では、参照の鎖（`where {親}_id = …`）だけでは行が 1 つに定まらないので、
**別名ごとに読み直し方を決める**。

| 手順 | 読み直し方 |
|---|---|
| `repeat` でない | その行が**実行者で埋まる列**（`defaults.self` の欄、またはその行に適用された遷移が実行者で埋める列）で絞る = 実行者自身の行 |
| `repeat` | 同じ表の「`repeat` でない」手順の行を**除いた**残り |

どちらも決まらなければ**生成時エラー**である（反例: 別名・操作・表）。黙って全部を同じ鍵に
入れると、再送のときに「自分」と「他の同伴の利用者」が混ざる。

## 複合 RPC の生成(保存点 → 1 トランザクション)

保存点の内側は「全部か無しか」である(ADR-0011 §4)。その実装は `npm run generate` が書き出す
**複合 RPC**(plpgsql)であり、手書きしない。

### 生成先と migration の運用

- 生成先は `supabase/migrations/{saves[].migration}`(**ファイル全体**。先頭に AUTO-GENERATED の
  SQL コメント)。手で編集しても次の `generate` で消える。
- **SQL が変わる仕様変更をしたら `migration:` の名前を新しくする。** migration は追記専用の歴史であり、
  適用済みのファイルを書き換えると DB と食い違う。名前を新しくすると、旧ファイルは歴史として残り
  生成対象から外れ、新ファイルが `create or replace` で同じ名前の関数を置き換える
  (運用の正: [migrations.md](../../../backend/system/standards/conventions/migrations.md) §生成 migration)。
- 生成された関数は data_table に**手で宣言しない**。関数の閉世界(data-table-parity / api-parity)には
  生成器が同じ導出から足す(帰属表 = 最初の手順の表・`shape: composite`)。

### 本文の決まり方

| 何 | どう決まるか |
|---|---|
| 署名 | `api.usecase_{name}_{save}(p_id uuid, p_actor_id uuid, p_actor_roles text[], p_expected jsonb, p_input jsonb) returns jsonb`。`security definer` / `set search_path = public` / 実行は `service_role` だけ。旧い署名が残らないよう、本文の前に**同名で引数型の違う関数を落とす** do ブロックが並ぶ |
| 手順 | `steps` の宣言順に、既存の RPC を**名前付き記法**で呼ぶ。`repeat: true` は `p_input` の別名のキーにある配列を回す |
| 0 行 | 競合。`raise exception using errcode = 'UC409', message = 'usecase_conflict:{op}'`(全体が戻る)。ロール違い(`UC403`)とガード違い(`UC412`)は呼ばれた側の定型 RPC が返す(束 ⑳-3) |
| 再送 | 最初に作る行が `p_id` で既にあれば、以降の手順を実行せず既存の行を読んで同じ形を返す(冪等。同じ表に 2 つ以上作る保存点の読み直しは上記)。**返すのは錨の行の作成者が実行者のときだけ**で、他人の行なら中身を返さず `UC409`。錨の表が `resend.returns_existing: false` なら常に `UC409`(錨の表の `resend` が必須。無ければ Y12 が止める。[ARCH-SP-BE-0001 §作成の再送と実行者の縛り](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)) |
| 制約違反 | 23xxx はそのまま上げる(呼び側が今と同じ写像で不変条件違反にする) |
| 戻り値 | `{ "{手順の別名}": 行の to_jsonb }`(`repeat` は配列。別名を書かなければ鍵は op) |

### 引数名 → 供給元

複合 RPC は**引数名だけ**から「その引数に何を渡すか」を決める。したがって data_table の
`functions[].params`(引数名の並び)が必須になり、その名前は次の値域に載る形でなければならない
(外れた名前は Y8 が反例つきでエラーにする。実 DB の `pg_proc.proargnames` との突合は rpc-signatures-parity)。

| 引数名の形 | 供給元 |
|---|---|
| `p_id` | 保存点の**最初の作成**なら複合 RPC の `p_id`(呼び側が作った冪等キー)。それ以外の作成は `gen_random_uuid()` |
| `p_actor_id` | 複合 RPC の `p_actor_id` |
| `p_actor_roles` | 複合 RPC の `p_actor_roles`(実行者に立つロール。束 ⑳-3)。受信の RPC から呼ぶときは `kind: system` のロールとその `implies` の閉包 |
| `p_expected_state` | その手順の集約の状態を**仕様から予測**した値。保存点の中で作った → `initial` / 保存点の中で遷移した → 直前の `to` / どちらでもない → `p_expected ->> '{entity}.{列}'`。遷移の手順では見る軸(状態機械)がイベントから決まる |
| `p_expected_{集約}_{状態列}` | 同上(集約と軸を名前が名指しする。例: `p_expected_item_state`) |
| `p_next_state` | その遷移の `to` |
| `p_effects` | その遷移の `effects[].do`(state_spec) |
| `p_event_id` | その手順の op(= ドメインイベント ID) |
| `p_{フィールド名}`(欄を指す引数)| **下の「欄の出どころの許可表」**で決まる。表のどの出どころにも当たらなければ Y8 / A15 のエラー |
| `p_{集約}_id`(その手順自身の集約・保存点の外) | 入力 `p_input -> '{別名}' ->> 'id'`(action_spec の `{entity}.id`) |
| `p_{集約}_id`(保存点の中で作った集約) | その手順の結果の id(plpgsql 変数) |
| `p_values` | その手順の入力欄のうち、他の引数が受け取っていない残りを jsonb にしたもの |
| それ以外 | **生成時エラー**(反例: 関数名・引数名・手順)。仕様(data_table の `params` / action_spec の `input`)側の問題として止める |

#### 欄の出どころの許可表

欄を指す引数(`p_{フィールド名}`)の値は、次の出どころのどれか 1 つからしか来ない。**どれを使ってよいかは
手順の形が決め、経路(単発 / 保存点)と `runner`(auto / manual)では広がらない**
(`legacy/spec-tools/lib/usecase/param-source-fields.ts` の `FIELD_ORIGINS` が全マスを書き下している)。
上の行から順に試し、最初に当てはまった出どころが値になる。

| 出どころ | 当てはまる欄 | 値 | 作成 | 遷移 | 編集・削除 |
|---|---|---|---|---|---|
| 保存点の中で作った行 | 参照欄で、直前の繰り返さない作成がその集約を作った | その手順の結果の id(plpgsql 変数) | ○ | ○ | ○ |
| 自分として(`self`) | 実行者を指す参照欄で、その手順に `defaults.self` がある | `p_actor_id` | ○ | — | — |
| 自分に絞る(`self_narrowing`) | 同上で、**その遷移の action_spec の `input` にある** | `p_actor_id` | — | ○ | — |
| 持ち主の欄(`owner`) | 作成の action_spec が **`owner: {集約}.{欄}` で明示した**欄(実行者を指す必須の参照欄で、`input` に無い。接地は V18) | `p_actor_id`(作成者 = 実行者) | ○ | — | — |
| `records_actor` | その遷移の state_spec の `records_actor` に載る | `p_actor_id`(例: 対応開始が書く `handled_by`) | — | ○ | — |
| 入力 | その手順の action_spec の `input` にある | `p_input -> '{別名}' ->> '{欄}'`(entity_spec の型で cast) | ○ | ○ | ○ |
| 計算値 | その手順の action_spec の `computes` にある | 実行時に純関数が決める(複合 RPC には写せない —— Y12) | ○ | ○ | ○ |
| 遷移が自分で決めない | `access_spec` の `transition_writes` か、ほかの遷移の `computes` が書く列 | **空(null)**。「触れない」か「空にする」かは `clears` が決める(宣言があれば RPC は代入、無ければ `coalesce`) | — | ○ | — |

原則は 3 つである。

- **利用者の入力から読むのは action_spec の `input` に宣言された欄だけ。** 保存点でも `runner: manual` でも広がらない
  (点検 7 回目 A7-2: 保存点の作成だけ「決まらない欄は入力から読む」に落ちていて、作成を `runner: manual` にすると
  単発の安全網 A15 が外れ、宣言の無い欄(役の根拠になりうる列)を保存点の入力から書けた)。
- **実行者が入るのは `records_actor` か、作成の手順の実行者参照(`defaults.self` / `owner` で明示した持ち主の欄)だけ。**
- **遷移には作成の自動補完が効かない。** 遷移は既存の**他人の行**を書くので、「必須で入力に無い実行者への参照は
  実行者」「自分として」の作成の規則を当てると、遷移の RPC に `p_{列}` があるだけで `records_actor` を宣言して
  いない全イベントが遷移を起こした人をその列(binding の根拠)に書く(点検 7 回目 A7-1)。遷移で実行者を書くなら
  `records_actor` を宣言する。DB の側でも閉じている —— 遷移の RPC の `p_{列}` はその機械の宣言(`records_actor` /
  `clears` / `records_time`・そのイベントの `input` / `computes`)が名指す列だけ(T6)で、`records_actor` の列の
  引数は本文が書き込みの前に `p_{列} := case when p_event_id in (記録するイベント) then p_actor_id … else null end`
  で縛る(`rpc-parity` が実 DB の本文で、その文がちょうど 1 回・最初の `update` より前にあることまで見る。点検 8 回目 A8-2)。
- **持ち主の欄は推測しない。** 作成者で埋まるのは、作成の action_spec が `owner: {集約}.{欄}` で明示した欄だけである
  (1 つの作成に 1 本)。宣言の無い実行者への参照の欄は、`input`・`defaults.self`・計算値のどれでもなければ実行計画
  (Y8 / A15)が「値が仕様のどこにも無い」で止める。以前は「必須で入力に無い実行者への参照は作成者」を推測で当てていた ——
  2 本目(査閲者)を `input` に書き忘れると黙って作成者で埋まり(点検 8 回目 A8-1)、候補を 1 本に絞る柵を足すと今度は
  起案者を `input` に出した代理作成で残った査閲者が「ただ 1 本の候補」になった(9 回目 A9-1)ので、推測の仕組みごと無くした。
  人が選ぶ欄(代理で作る相手・査閲者・担当者)なら `input` に足し、作成者自身がその行の持ち主になる欄なら `owner` に書く。
  再送の作成者の欄(`resend.creator`)の候補も、この明示の欄(と `defaults.self`)だけである(T6 / Y12)。

`defaults.self`(「自分として」)が指す欄は、その集約の**実行者を指す参照欄**(`ref(...)` が
`session: true` を宣言した集約を指すもの)である。0 件でも 2 件以上でも「何を埋めるか」が決まらない
ので Y8 がエラーにする。

**どの遷移がどの列に実行者を書くかは、イベント単位でしか決まらない**(束 ⑰-2)。`access_spec` の
`writes` は集約単位の宣言なので「対応開始は対応者を書くが、再開は書かない」を表せない —— その 1 行を
書く場所が state_spec の `records_actor` である(書き方は
[domain-spec-writing.md §state_spec](../../../common/specification/standards/domain-spec-writing.md))。
宣言が無ければ**その遷移はその列を自分で決めない**(空を渡す)。その空が「触れない」のか「空にする」
のかも、同じくイベント単位の宣言が決める —— `clears` に並べた列は空にする、並ばない列は触れない
である(束 ⑰-3)。計画はどちらでも空を渡すだけなので、**実現するのは RPC の本文**であり、宣言と本文
(`coalesce` か代入か)の一致は `rpc-parity` の統合テストが実 DB で突き合わせる。宣言が無かった
あいだ、同じ状態が RPC しだいで正反対の結果を生んでいた(実測: `apply_purchase_request_transition` は
`coalesce` で触れず、`apply_companion_link_transition` は代入で空にしていた)。

**「自分として」は DB まで届かなければ宣言できない。** `defaults.self` が指す欄が**その手順の
RPC に届かない**(引数名にも `p_values` の中身にも現れない)なら、宣言は生成される SQL に
1 文字も現れず、行は誰のものでもないまま生まれる。この空手形も Y8 がエラーにする
(反例: 手順・欄名・RPC 名)。直し方は 2 つだけである。

- **紐付けを起こす手順そのものを `steps` に足す**(状態機械を持つ紐付けなら遷移として)。
  実例: `loan_self.register` は `loan_companion.create` の直後に `companion_link.link`
  (`defaults.self`)を置き、`apply_companion_link_transition` の `p_patron_id` を実行者で埋める。
  作成 RPC は `patron_id` を受け取らない(生まれる行は必ず `unresolved`。INV-LOAN-COMPANION-011)
  ので、これがドメインを変えずに「自分として」を届かせる唯一の道である(ADR-0011 §3 の 2 段目)。
- **作成の手順なら**、その欄を受け取る引数(`p_{欄}`)を作成の RPC の data_table の `params` に足す(作成では
  「自分として」が実行者で埋める)。**遷移の手順なら**、引数を足すのではなく state_spec のそのイベントに
  `records_actor` を宣言する —— 遷移の手順の `defaults.self` は、その遷移の `input` に宣言された欄を自分に絞る
  だけで、書ける列を増やさない(`input` に無い欄に書くと Y8 がエラーにする)。

どちらもできないなら `defaults` を書かない —— 宣言だけ残すと「自分として」が嘘になる。

### Y10 の考え方 — `permit` が要る値の供給元

Y8 が「複合 RPC の引数」を見るのに対し、Y10 は「**書き込みの前に立てる `permit`**が要る値」を見る。
実行器（`@kaninabe/runtime/template`（`framework/runtime/src/operation/_template/run-plan.ts`））は手順の順に `canCreate` / `canFire` を実行するので、
その入力（遷移元の状態・ガード式の変数・成立するロール）が仕様から決まらなければならない。
決まらなければ実行時に推測することになり、推測した環境は `guard_unknown` を生んで
「拒否の理由が仕様から説明できない」状態になる。

供給元の語彙は閉じている（`app/src/domain/generated/usecase-plans.ts` の `UsecaseFactSource`）。

| 形 | 供給元 |
|---|---|
| 保存点の中で作った・動かした集約の**状態** | 仕様からの予測（作成 = `initial` / 遷移 = 直前の `to`）。ADR-0011 §4 |
| 保存点の中で作った集約の**欄** | その手順の入力。実行者を指す必須の参照（および `defaults.self` の欄）は実行者そのもの |
| 保存点の**外**の集約の列 | 1 行読む（`{entity}_id` の入力欄、対象そのものなら `id`、実行者の集約なら実行者）|
| 予約語 `now` / `actor.id` | 判断時刻 / 実行者 |
| それ以外 | **生成時エラー**（反例に、どの保存点のどの手順のどの変数か）|

#### 保存点の経路で立つロール / 立たないロール

保存点の実行器が立てられるロールは 2 種類だけである。

- **`kind` を持つグローバルロール**（`anonymous` / `authenticated_default` / `system`）—— セッションから立つ。
- **`binding` を持つ文脈ロール** —— 実行計画がその左辺の供給元を持つ（上の表の規約で解決する）。

どちらも持たないロール（**実行者自身の行の属性が根拠**のもの。このアプリでは `librarian` = `patron.is_librarian`）は、
role_spec に機械可読な根拠が無いので**この経路では立たない**。仕組み側が「その列を読めばよい」と勝手に
知ることは「軸は仕組み・語はアプリ」を破る（[dsl-extension-triage.md](../../../common/specification/playbooks/dsl-extension-triage.md) §軸と語）。

- **MUST**: 手順の `by` に**立つロールが 1 つも無ければ Y10 のエラー**である（反例: ユースケース・保存点・
  手順・ロール）。そのロールしか認めていない操作は誰も通れないので、保存点に置けない。
- 立たないロールが**混じっているだけ**なら止めない（`patron` などで立つ）。ただし黙らせない ——
  生成物 `usecase-plans.ts` の各手順が `unresolvableRoles: ['librarian']` を明示し、ハンドブックの
  ハンドブックの「タスク」の章が「保存点では立たないロール」の表として出す。
  その人にはその手順が `forbidden` に見える（個別の操作の経路なら通る）。
- 語彙を足す（`role_spec` に「セッションの属性が根拠のロール」を書けるようにする）案は 2 実例目が
  来た日に検討する —— いまは `librarian` 1 件であり、**表現力を買う前に検査で止める**方が根が浅い。

### 保存点に置ける手順の形（Y12）

再送のとき、複合 RPC は**最初に作る行の id から参照の鎖を辿って**各手順の結果を読み直す。
したがって保存点の手順は、最初に作る行から辿れるものだけにする。
また**最初の作成を `repeat: true` にはできない** —— 冪等キーを置く行が 1 つに定まらないためである。
同じ表に行を作る手順が 2 つ以上あるときの絞り込みは「同じ操作を 1 つの保存点で 2 回以上実行する」の
節を参照する。

**辿れない形は 2 つあり、どちらも Y12 が反例つきで止める**(以前は verify が緑のまま generate が
例外で落ちていた。束 ⑱ の 4 題材が実測)。

| 書きたかった形 | なぜ写せないか | 対処 |
|---|---|---|
| 保存点の**外**にある別集約への遷移を混ぜる（貸出の成立と在庫の遷移を同時に） | その行は入力から来るので、最初に作る行からの鎖に乗らない | その集約をこの保存点の中で作る。できないなら**保存点を分ける**（遷移を単発の操作に出す） |
| 親を持たない兄弟行を N 行作る（台帳に移動を N 件） | どの行がその手順の結果なのか、再送のときに決まらない | **親集約を 1 つ置く**（入荷伝票 1 件 + 移動 N 件）。親の行から鎖で辿れるようになる |
| `computes`（計算値）を持つ遷移を置く | 値を決めるのは実行器（TS）であり、複合 RPC の中には置き場が無い | その手順を保存点から外して単発の操作にする（**保存点を分ける**）。または欄を入力 / `supplied_by: db` に変える |

どれも「表現力を買う」ではなく**形を変える**方向の対処である（[dsl-extension-triage.md](../../../common/specification/playbooks/dsl-extension-triage.md)）——
2 題材（`stores` の台帳・`library` の貸出）がどちらも集約を 1 つ増やす / 保存点を分けることで解けた。

## 認知の予算(Y5)

6 指標の既定値(規約)は次のとおりである。数字の根拠は cognitive-load.md の実測(旧 1 → 新 5+M 等)と、「1 分でできる」の目安から置いた初期値であり、実測が積み上がったら見直す。

| 指標 | 既定値 | 数え方 |
|---|---|---|
| ① 手数(`steps`) | 4 | **`saves` の長さ = 人が押す保存の回数**。保存点の内側の手順は 1 回の保存で機械が順に実行するので数えない(内側の手順数は参考値としてハンドブックの物語に出る) |
| ② 画面(`screens`) | 2 | `start` を含む、各手順を出す画面の重複なし合計(Y3 の探索結果を再利用) |
| ③ 概念(`concepts`) | 3 | 触る集約の数 + 到達する状態(`{machine}.{state}`)の数 |
| ④ 前提(`preconditions`) | 2 | `start` に入るのに要る関門の数(`requires_auth` / `role_gate`。H4 の `requiredGuardsOf` を再利用) |
| ⑤ 入力(`inputs`) | 8 | 各手順の action_spec `input` のうち、entity_spec で `required: true` のフィールド数の合計 |
| ⑥ 確認(`confirmations`) | 1 | 確認が要ると判定した手順の数(下記「確認の数え方」) |

超過は **warning** であり、`npm run verify` の「エラー 0」条件には影響しない。免除ではなく**理由つきで受け入れる**(`accept: [{ metric, reason }]`)。数字が出ること自体が目的であり、消し込み式の免除にしない(免除すると「面倒だった事実」が記録から消える)。`accept` は Y10 の warning(実行しない不変条件)でも使う口であり、そのときは `metric` の代わりに `invariant: {id}` を書く —— **受け入れは必ず対象を名指しする**(一括で黙らせる形は作らない)。

> **手数を「保存の回数」で数える理由**(2026-09-09 に数え方を変えた)。以前は保存点の内側の手順を 1 つずつ数えていたので、[ADR-0011](../../../../decisions/common/ADR-0011-usecase-layer-two-origins.md) §3 の 2 段目 —— **粒度を変える**(複数の操作を 1 つの保存点にまとめる)—— を使うほど手数が増える、という逆転が起きていた。人が数えているのは「何回押すか」であり、1 保存の内側で機械が 5 つの操作を実行することは人の手数ではない。既定値(4)は据え置いてある —— 意味が「押す回数」に変わったぶん実質は厳しくなるので、実測が積み上がってから見直す。

### 確認の数え方

確認が要るかどうかは**近似ではなく、画面が使うものと同じ導出**である。意味解析の層(`legacy/spec-tools/lib/semantics/operation-attributes.ts` の `deriveOperationAttributes`)が、方針の式(`negativeTone ∨ destructive ∨ (irreversible ∧ affectsOthers) ∨ settles`。`ux` の上書きが先)を 1 か所で計算し、Y5・ハンドブックの章・画面の生成物(`action-attributes.ts` の `confirmRequired`)が**同じ結果**を読む。

- 入力は仕様のモデルと 3 種のカタログ(テーブル仕様・ジョブ・通知)。検証も生成も同じカタログを同じ形(`OperationCatalogs`)で渡すので、cascade(複合 RPC の `also_writes`)由来の `destructive` / `affectsOthers` も見える。
- 手順の操作に action_spec が無ければ `ux` の上書きだけが無い(事実から決まる)。
- 数え方は「確認が要ると判定した手順の数」のまま。**食い違いを許す軽量版は持たない** — 画面で確認が出る操作を Y5 が数え落とすと、予算の警告が実際の面倒より少なく出るからである。

## app 側に生成されるもの（束⑯c-2）

保存点 1 つにつき、次の 4 つが**生成される**。手で書く場所は hooks だけである。

| 生成物 | 置き場 | 何をするか |
|---|---|---|
| 複合 RPC | `supabase/migrations/{saves[].migration}` | 手順を宣言順に 1 トランザクションで実行する plpgsql |
| 実行計画 | `app/src/domain/generated/usecase-plans.ts` | `permit` が要る値の供給元・読む行・適用が要る不変条件 |
| 入力スキーマ | `app/src/domain/generated/usecase-inputs.ts` | `{手順の別名}: {その手順の入力}`（`repeat` は配列）の zod |
| Server Action / composition | `app/src/app/_actions/usecase/{name}/{save}.ts` / `app/src/composition/usecase/{name}/{save}.ts` | パース → 実行者の解決 → 実行器の呼び出し（配線だけ） |
| 1 画面フォーム | `app/src/components/usecase/generated/{name}.{save}-form.tsx` | 手順ごとの欄を「1 手順 = 1 節（見出し = `label`）」として 1 枚に並べて 1 回で送る |

**生成物は `app/src/domain/generated/` の外にも出る**（層の配置規約が置き場を決めるため）。
どれも先頭に AUTO-GENERATED ヘッダを持ち、`npm run generate:check` の対象であり、
実在と主 export の閉世界は `structure-expectations.ts` の `expectedUsecaseFiles` が見る。

### 手書きするのは hooks だけ

`app/src/operation/usecase/{name}/{save}.ts` に `{camel(name)}{Pascal(save)}Hooks` を 1 つ export する。

```ts
export const loanSelfRegisterHooks: PlanHooks<
  (typeof usecasePlans)['loan_self.register']['invariantHooks'][number],
  LoanSelfRegisterInput
> = {
  'INV-LOAN-008': (input) => assertLoanHasContent(/* 入力から数える */),
};
```

- **鍵の全数を型が要求する。** 母集合は「invariant_spec が `application` の執行点を宣言し、かつ
  この保存点の手順を `guard` の執行点として名指ししている」不変条件である（実行計画の
  `invariantHooks`）。複合 RPC はその手順の operation を通らないので、宣言された執行点を
  ここで実行し直さないと執行が消える。
- **判定材料は入力そのもの**である。保存点の内側はまだ 1 行も書いていないので DB からは数えられず、
  「全部か無しか」なので入力 = 書かれる内容だからである。
- 適用が要る不変条件を 1 つも持たない保存点には、このファイルそのものが無い（composition が `{}` を渡す）。

#### 母集合を狭めたことを黙って通さない（Y10 の warning）

上の母集合は**判断である**。「集約は交わるのに、この保存点の手順を `guard` として名指ししていない」application 執行の不変条件は hooks に現れず、**複合 RPC の経路では誰も評価しない**（個別の操作を通れば、その operation の `persist` が評価する）。狭めた線の外側が静かに検査されない経路になるので、Y10 が **warning** で並べる（ADR-0012 §Implementation の当座の手当て）。

- **error にしない**のは意図である。交わることは「この保存点が壊しうる」ことを意味しない（例: 行を足すだけの保存点と、削除の側で守る不変条件）。判断は人がする。
- この保存点で守ると決めたら、invariant_spec の `enforced_by` に `- kind: guard / ref: {その手順の操作 ID}` を足す。実行計画が hooks を要求し、型が実行し忘れを許さなくなる。
- 守らなくてよいと決めたら、`accept: [{ invariant: {id}, reason: {なぜ壊れないか} }]` を書く。**免除リストは作らない** —— 受け入れは対象を名指しし、理由を残す形だけにする（id の実在は Y1 が見るので、不変条件が消えたら受け入れも落ちる）。

## 実例

`loan_self`(自分の貸出に、自分と一緒に借りる人をまとめて登録する。別名 `as` の実例)/ `item_publish`
(司書が蔵書を作って公開する。保存点 2)/ `invite_patron`(利用者が人を招待する)の 3 本を用意している
(`docs/specs/frontend/usecases/`)。2 実例ルールは満たしている。

生成された複合 RPC は `supabase/migrations/*_usecase_*.sql` のうち各保存点の `migration:` が
名指しした 4 本であり、実 DB との突合は
`app/src/infrastructure/__tests__/schema/usecase-rpc-parity.test.ts`(署名・本文・挙動)が担う。
