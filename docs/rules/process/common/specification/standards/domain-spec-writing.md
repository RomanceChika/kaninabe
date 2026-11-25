---
doc_type: process
scope: common
norms: [PRIN-0001, PRIN-0006, PRIN-0007, PRIN-0009, PRIN-0010, ARCH-SP-0002]
decisions: [ADR-0003, ADR-0004, ADR-0014]
---

# ドメイン仕様（specs/domain）の書き方

`docs/specs/domain/` に置く 5 つの doc_type（role_spec / entity_spec / state_spec / access_spec / invariant_spec）の YAML スキーマ、ガード式の文法、および検証器が実行するチェックを定義する。

## 目的

- ドメイン仕様を**機械が検証できる形**に固定する（PRIN-0006）。書ける内容を有限の状態・イベント・ロール・制限された比較式に絞ることで、全検証を決定可能な範囲に収める。
- 「書いていないから起こらない」を許さない。全状態 × 全イベント、全ロール × 全エンティティが「定義」か「理由付きの禁止」のどちらかに必ず分類される状態を、スキーマの側から強制する。
- 「これが書けない」がバグではなく設計であることを明示し、DSL の外で扱うものの線引きを規定する。

## 参照するもの

- **配置・構成**: [architecture/specification/common](../../../../architecture/specification/common/)（ARCH-SP-0002）。どのファイルに何を置くか、集約ディレクトリの切り方、生成物の置き場所は ARCH-SP-0002 に従う。
- **doc_type の定義**: [meta/standards/doc_types.md](../../../../meta/standards/doc_types.md)（ドメイン仕様の節）
- **フロントマター**: [meta/standards/frontmatter_policy.md](../../../../meta/standards/frontmatter_policy.md)
- **判断の理由**: ADR-0003（表現力を絞る判断）、ADR-0004（遷移テーブル生成 + 汎用エンジン方式）、ADR-0014（`composite` の関数が守る `writes` の規則を `enforces` で名指す）
- **テンプレート**: `docs/specs/domain/template.{doc_type}.md`

## ルール・基準

### 共通形式

- **YAML フロントマターが正**とする。Markdown 本文の図・表は `<!-- AUTO-GENERATED -->` で囲まれた生成物であり、**手書きしてはならない**（次回生成で上書きされる）。
- フロントマターには frontmatter_policy に従い `doc_type` / `scope: common` / `id` を必ず書く。`id` はファイル・リソース名で管理する（例: `domain-roles`, `loan-states`）。
- ドメインイベント ID は `{state_machine}.{event}`（例: `loan.submit`）。他レイヤーはこの ID でのみドメインの操作を参照する。
- 識別子（ロール ID・状態 ID・イベント ID・フィールド名・エンティティ名）は**スネークケース**とする。
- **日本語の説明はコメントまたは説明用フィールドに書く**。`otherwise_forbidden` / `statement` のように、理由・意味を日本語で書くことが必須のフィールドがある。
- **日本語の説明文に `: `（コロン + 半角空白）が含まれるなら、その値を引用符で囲む**。YAML のプレーンスカラーは `key: value` の `: ` をマッピングの区切りとして読むため、引用符が無いと本文の途中で予期しないキーが始まったかのように誤読される（第1版・ストレステストの題材で 2 回踏んだ実測。第2版はこの規約で回避した）。例: `summary: "mention: everyone_and_alert の通知に打つ文字列"`（引用符が無いと `mention` がキーとして分離される）。

### 散文の規則

仕様ファイルの最終形は **YAML（正）＋生成ブロック（可読形）＋標識（手書き散文）** である（2026-08-24 のユーザー裁定）。

- 手書き散文で書いてよいのは**標識 2 種・各 1〜3 行**のみ:
  - **否定の標識** — 検討して捨てた自然な代替案（無いと未来の変更者が善意で壊すもの）
  - **線引きの標識** — 「ここではやらない」のスコープ宣言
- 事実の可読形は生成ブロックが担う。**手書きで再記述しない**（再記述はドリフト源）。この最終形はドメイン仕様に限らず、action_spec（`action-body`）・query_spec（`query-body`）・screen_spec / chrome_spec（`screen-body` / `chrome-body`）・design_token_spec（`token-tables`）の個別ファイルも同じである。
- 系全体の意味論（その仕様固有でない話）は書かず、該当する規約文書へのリンク 1 行に置き換える。
- 経緯・歴史・教育は `NOTES.md` へ。消費者への契約は標識 1 行に圧縮して残す。
- YAML フロントマター内のコメントは**行ローカルの短注（1 行）**のみ。段落級のコメントは標識に移すか削除する。

根拠: 同じ情報が二箇所に住むと片方が黙って嘘になる（2026-08-24 の例解ドリフト実測）。

### role_spec（roles.md）

ドメイン全体で 1 つ。ロールは**グローバルロール**（`binding` を持たない）と**文脈依存ロール**（binding 式で「この対象に対して誰がそのロールか」を定義）の 2 種。

グローバルロールには、根拠が**実行者自身の行の欄**にあるもの（司書・有効な利用者等）がある。その根拠は `claim: {entity}.{field}`（boolean の欄）か `claim: {entity}.{field} == {値}` / `in [{値}, ...]`（state / enum の欄）で宣言する —— 宣言が無かったあいだ、根拠は各 operation の手書き（実行者の行を DB から読む口）にだけ住んでおり、仕様からは「誰がそのロールか」が決まらなかった（ADR-0012 ④ / 束 ⑰。state / enum の値は ADR-0018）。

グローバルロールのうち 3 つは、仕組み側のコード（operation 層の `actor.ts` 等）が実行者を解決するために必ず要る 3 スロット ――「未ログイン」「認証ユーザーの既定ロール」「システム（Webhook/Cron からの内部実行）」―― に対応する。**どの語をこの 3 スロットに当てるかはこのアプリの事情**であり、仕組み側は `roles[].kind`（値域）だけを見て、対応するロール ID は生成物 `GLOBAL_ROLES`（`app/src/domain/generated/roles.ts`）経由で引く（`anonymous` / `patron` / `system` という具体的な語を仕組み側のコードは文字列リテラルとして持たない）。

```yaml
doc_type: role_spec
roles:
  - id: anonymous          # 未ログイン
    kind: anonymous
  - id: patron             # ログイン済み一般（このアプリでは「利用者」と呼ぶ）
    kind: authenticated_default
    claim: patron.state == active   # 任意: 「行がある」かつこの条件を満たすときだけ立つ(下の claim)
  - id: loan_owner        # 文脈依存ロール: 対象貸出の借りた人本人
    binding: loan.patron_id == actor.id
    implies: [patron]      # 借りた人は必ず利用者でもある(ロール階層)
  - id: item_librarian    # 文脈依存ロール: 対象蔵書の司書
    binding: item.librarian_ids contains actor.id
    implies: [patron]
  - id: librarian          # グローバルロール: 根拠は実行者自身の行の欄
    claim: patron.is_librarian # session: true の boolean の欄(実行器はセッションから読む)
    implies: [patron]      # 運営は必ず利用者 → 運営の述語は patron の行の条件(state == active)も満たす(下の implies)
  - id: system             # Webhook/Cronからの内部実行
    kind: system
```

- `roles[].id`（必須）: ロール識別子。ドメイン内で一意。
- `roles[].label`（推奨）: 人間向けの日本語名（例: 借りた人）。生成ドキュメントの表・図で ID と併記される。検証には使われない。
- `roles[].kind`（グローバルロールの 3 つだけ必須）: `anonymous` / `authenticated_default` / `system` のいずれか。**この 3 種はそれぞれちょうど 1 つのロールが持たなければならない**（ローダーが検査する）。文脈依存ロール（`binding` を持つロール)は `kind` を書かない(両方は書けない)。
  - **`authenticated_default` が立つ根拠は「認証済みであること」ではなく「実行者の集約（`session: true` を宣言した集約）にその人の行があること」である。** 読み取り（RLS の補助関数 `is_{role}()`）も書き込み（定型 RPC の述語）も実行者の行を見に行き、先読み（`resolveActorRoles`）はその行の写しであるセッションのプロフィール（`app_metadata.profile`）の有無で立てる。ログインはできるが行がまだ無い人（招待を受け取っただけの認証ユーザ）は**このロールを持たない** —— 止めるのが外部キーではなく権限の判定であることが、3 か所で同じ意味になる。
  - **実行者の集約が状態機械を持つなら、このロールには状態の `claim` を書く**（`claim: patron.state == active`。V23）。行の実在だけでは、招待を受けただけの人・休会者・退会者にもこのロール（と、これを含意する全てのロール）が立つ。
- `roles[].binding`（文脈依存ロールのみ必須）: そのロールが成立する条件。**binding 式が参照できるのは、対象エンティティからの参照パス（entity_spec の `context` を 2 段まで辿って解決）と `actor.id`（実行者の同一性）のみ**。
  - **相手のエンティティと欄だけを書けばよい**（`department.admin_id == actor.id`）。起点からの経路は解決器が探すので、この 1 行が「部屋から見れば 1 段・予約から見れば部屋を経由した 2 段」の両方で成立する（束 ⑲-2a）。
  - **比べてよいのは `actor.id` だけである**（V11）。`actor.{欄}`（実行者の属性）と比べる binding は、スコープ条件の生成にも保存点の `permit` にも写せない —— どちらも「その列を実行者の id と比べる」形に落ちているためである。テナントの境界のような「実行者の属性で絞る」宣言は、ロールではなく `access_spec` の `reads[].filters`（可視性）と `when`（書き込み）に書く。
  - 補足: `permit` は、書き込みの前にエンジンが判定して渡す値で、無ければ書き込めない。<!-- term: permit -->
- グローバルロールに `binding` は書かない。
- `roles[].claim`（任意）: **実行者自身の行の欄**が根拠のグローバルロール。書き方は 3 つ。
  - `claim: {entity}.{field}` — boolean の欄が真のとき立つ。
  - `claim: {entity}.{field} == {値}` — state / enum の欄がその値のとき立つ。
  - `claim: {entity}.{field} in [{値}, ...]` — state / enum の欄が値の集合のどれかのとき立つ。
  - 指せるのは**`session: true` を宣言した boolean / enum / state の欄**だけである（V11 が見る）。セッション
    （`app_metadata.profile`）に載っている値でなければ、実行器は書き込みの前にもう 1 本クエリを
    持つことになり、他の型では「立つ / 立たない」を仕組み側が推測で決めることになる。
  - **state / enum の欄は値を添える**（省略は不可・boolean の欄に値は書けない）。値は欄の値域になければ
    ならない —— 綴りが違うと**誰にも立たないロール**になり、黙って全員を締め出すため V11 が落とす。
    値の綴りは英数字と `_` だけ・重複は書けない（ローダーが見る）。
  - **`claim` は `kind: authenticated_default` と併記できる**（`claim: patron.state == active`）。根拠は「実行者の集約に行がある」**かつ**「その行の欄がこの条件を満たす」になり、DB の述語（定型 RPC の `by`）も RLS の補助関数 `is_{role}()` も、行の実在に欄の条件を足した形で生成される。
  - **`claim` を持つロールは「行の条件を持つロール」である。** このロールを `implies` している側の述語は、**自分の根拠 AND 含意の先の行の条件**になる（下の `implies`。ADR-0018）。
  - **先読み（engine）が読むのは「行の写し」である。** `claim` の根拠は実行者自身の行の欄だが、先読み（`resolveActorRoles`）が見るのはセッションのプロフィール（`app_metadata.profile`）であり、DB の述語（定型 RPC の `by`）は**行そのもの**を見る。したがって写しの遅延（行ができてから `refresh_session_profile` が走るまで）のあいだは**先読みだけが拒否する** —— **DB が正であり（ADR-0012）、先読みは厳しい側に外れるだけ**なので、設計としてこれを受ける（束 ⑳-5a2 で実測）。`kind: authenticated_default` の「行の実在」と同じ種類の話であり、宣言は 1 つ（`claim: {entity}.{欄}`）のまま、読む場所が先読みは写し・DB は行になる。
    **state / enum の値を持つ `claim` では向きが逆になりうる**: 取り消し（有効 → 退会・休会など）の直後は、写しが古いあいだ**先読みが許す側に外れる**（値がまだ有効のままに見える）。これも DB の述語が必ず落とす（DB が権威。行の条件は実行者の行を直に読むので偽造できない）ので、先読みの甘さを理由にこの条件を先読みに寄せない。
  - **先読みも行の条件を読む**（実行時のロール解決。ADR-0018）。生成物 `roles.ts` の `AUTHENTICATED_WHEN`（既定のログインロールに併記した条件）と `ROLE_GATES`（`claim` を持つロールを `implies` する側が併せて満たす条件）を `RoleTables` が読み、**セッションの写しが値の集合に入るとき**だけ既定のロールを立てる（入らない実行者は未ログインと同じロールになる）。`claim` のロールは集合に入るとき、`claim` を持つロールを含意するロール（束縛を含む）は含意の先の条件も満たすときだけ立つ。実行計画（`operation-plans.ts`）も、手順が認めるロールごとの条件を `roleGates` に運ぶ。条件を宣言していなければ、これらは生成物に出ない（従来と同じ）。
  - **配列を信じないことは古いロール一覧で見張る。** 条件を満たさない人には、条件を満たしていた頃に解決された配列（既定のログインロールと `claim` のロール）も渡す（一致の証明の `from_stale`・保存点の `_stale_` の人）。先読みは行の写しで拒否するが、DB は配列を見ずに実行者の行の条件で必ず落とさなければならない。`claim` / `binding` のロールは配列に入っていても行で決める（先読みの期待も同じ）。
  - **world（生成テストのオラクル）は条件を満たす人と満たさない人を分けて立てる。** 満たす人の行は boolean の欄を真・state / enum の欄を値の集合の先頭にする（**state / enum の欄に `true` は置かない**）。満たさない人（根拠の束縛・`claim` は成立しているが既定のログインロールの条件だけを満たさない人。`_unmet_{ロール}` の名前）の行には条件の外の値（欄の値域のうち集合に入らないものの先頭）を置く。生成ユニットテストのセッションも既定のログインロールの条件を満たす値で埋める（埋めないと、ログインした実行者が全員「条件を満たさない人」になって生成テストが全部落ちる）。
  - `binding` とは**同時に書けず**、`kind` とは **`authenticated_default` だけ**併記できる（未ログイン /
    システムは実行者の行を根拠にしない）。根拠は 1 つに決まらなければならない。3 つはそれぞれ
    別の解決経路である —— `kind` はセッションの有無、`binding` は**対象の行**の欄、`claim` は
    **実行者自身の行**の欄（`authenticated_default` は「行がある」を根拠にするので、`claim` と同じ経路）。
  - `binding` との違いは「対象に依るか」である。`claim` のロールは**どの対象に対しても同じ権限で
    立つ**ので、`entity_spec` の `context` に解決パスは要らない。
  - 任免の正は `access_spec` の `writes` 側にある（誰がその欄を書けるか）。`claim` はその欄を
    「ロールの根拠」として名指しするだけで、更新の権限を宣言しない。
  - **`claim` は `actor.{欄}` の特別な 1 例である**（束 ⑲-2a）。「セッションに載る欄を実行者の属性として
    引く」という機構は同じで、`claim` はその値で**ロールを立てる**用途に閉じたもの。
    ロールにせず式の条件として使いたいなら、`when` や `filters` に `actor.{欄}` を書く。
- `roles[].implies`(任意): **このロールを持つ主体が必ず併せ持つロール**(RBAC のロール階層)。
  「司書は必ず利用者である」のような業務上の包含関係を宣言する。
  - **「持ち得る」ではなく「必ず持つ」**である。例外が 1 件でもあるなら書いてはならない。
    書けば、権限の包含関係を機械が推論する場面(下記)で実際より広い権限を仮定してしまう。
  - **何に効くか**: 権限の包含判定。現在の唯一の用途は**期待 RLS ポリシー表の刈り込み**である
    — あるテーブルを `patron` が `scope: all` で読めて、`librarian` が `implies: [patron]` なら、
    `librarian` 用の読み取りポリシーは行集合として冗長なので「存在すべきポリシー」に数えない
    (ARCH-SP-BE-0001 の RLS 節)。**`reads` の書き方は変わらない**。全ロールの明示は引き続き必須で、
    `implies` があっても `scope` を省略できるようにはならない(全域性 V4 は独立)。
  - **実行者のロール集合は含意で閉じている**(束 ⑳-1b)。`by: [patron]` に対して DB 側の述語が
    見るのは実行者が渡すロール配列(`p_actor_roles`)の中身だけなので、`librarian implies patron` の実行者が
    `patron` を持たずに来ると、同じ 1 つの宣言に対して**DB だけが落とす**。したがって
    **`p_actor_roles` に渡す集合は、`claim` で立つロールを含み、`implies` の推移閉包で閉じて
    いなければならない**。閉包を取る規則は `legacy/spec-tools/lib/model/role-hierarchy.ts` の 1 か所に
    あり、その結果は生成物 `app/src/domain/generated/roles.ts` の `ROLE_IMPLICATIONS` に出る。
    app の `resolveActorRoles` はその表を読む(同じ導出を 2 度書かない)。渡す先は**定型 RPC の
    引数 `p_actor_roles text[]`** である(束 ⑳-3。server-actions.md §RPC が `by` とガードを守る)。
  - **含意の先に行の条件（`claim`）があれば、述語にも効く**(E2。ADR-0018)。ロール R の述語は
    **R 自身の根拠 AND（R が推移的に含意するロールのうち `claim` を持つもの）の行の条件**になる。
    「運営は必ず利用者」と書いたロールは、利用者の条件（例: `patron.state == active`）を満たさない実行者には
    立たない —— 対象の行の列だけを見る文脈依存ロールも同じである。足すのは**行の
    条件だけ**で、実行者が渡す配列（`p_actor_roles`）の照合は足さない（DB は実行者の行を直に読むので
    偽造できない）。定型 RPC の本文には `exists (select 1 from {表} a where a.id = p_actor_id and
    a.{欄} in ('{値}', ...))` が、RLS のポリシーには含意の先の補助関数 `public.is_{role}()` の呼び出しが
    **一様に**（`librarian` のポリシーにも）論理積で足される。補助関数の本体は自分の根拠だけを持ち、
    ポリシーが要求する補助関数の全数には含意の先のロールも入る（T7 が宣言の過不足を見る）。
    **含意の先に `claim` が無ければ何も足さない** —— 条件を宣言しなければ生成される SQL は変わらない。
  - **対象の行から立つロール(`binding` / `claim`)が含意できるのは `kind` を持つロールだけである**
    (V11。束 ⑳-3b)。DB が見るのは実行者が渡すロール配列だけであり、その配列は保存点では**手順ごとに
    立ったロールの和**になる —— 行から立ったロールが素の特権ロール(`kind` も `binding` も `claim` も
    持たないロール)を含意すると、**後段の手順で成立した束縛が前段の手順のロール判定を通す**。
    `kind` の 3 つ(未ログイン / 認証済みの既定 / システム)は実行者そのものの属性なので、含意しても
    同じ問題を起こさない。その特権を許したいなら、含意ではなく**許す宣言の `by` に並べる**。
  - **検査**: 参照先ロールの実在と、循環していないこと(A が B を、B が A を含意する = 2 つが
    同じロールになってしまう)をローダーが検査する。自分自身を指す宣言もエラー。

### entity_spec（{aggregate}/entity.md）

```yaml
doc_type: entity_spec
entity: loan
label: 貸出                  # 集約の表示名（任意）。章題・関係図の節点に出る
context:                          # 文脈依存ロールの解決パス
  item: loan.item_id       # 「この貸出の item_librarian」= item_id 先の蔵書の司書
fields:
  - name: id
    type: uuid
    auto: true
    personal: false
  - name: item_id
    type: ref(item)
    required: true
    personal: false                # ref(entity) は参照先の識別子であり、値自体は個人情報を運ばない
  - name: patron_id
    type: ref(patron)
    required: true
    personal: false
  - name: reference
    type: string
    max_length: 50
    required: true
    label: 照会番号                 # UI の表示名（任意）。説明文は description に書く
    personal: false
  - name: renewal_days            # 延長日数
    type: integer
    min: 1
    max: 30
    required: true
    personal: false
  - name: note
    type: string
    max_length: 500
    personal: true                 # 司書への連絡事項 = 自由記述で人について書く欄
    personal_placeholder: null     # NOT NULL でない列なので消去時は null にする
  - name: kind
    type: enum([self, proxy])
    required: true
    labels:                       # enum の値 → 人の言葉。input に現れる enum では必須（V16）
      self: 本人の貸出
      proxy: 代理受取の貸出
    personal: false
  - name: code
    type: string
    supplied_by: db               # 入力にも実行者にも現れない。DB（既定値・トリガ）が決める（V17）
    personal: false
  - name: state
    type: state(loan)            # 状態機械 loan と接続（states.md が定義の正）
    personal: false
```

- `entity`（必須）: エンティティ名。ディレクトリ名と一致させる。
- `summary`（任意）: **章頭の 1 文**（この集約が何か）。人が書く文で、書き方は §summary。書かなければブックに「（まだ書かれていない）」と出る。
- `label`（任意・推奨）: **この集約そのものの表示名**（業務の名詞。例: `label: 蔵書`）。`fields[].label` の 1 段上で、原則は同じ「内部名で配線・label で表示」— 実装は従来どおり `entity`（内部名）で配線し、**生成物だけがこの label を引く**（ハンドブックの章題 `集約 item（蔵書）`・集約関係図の節点・表紙の章立てリンク）。空文字は不可、**全エンティティ間で重複不可**（V1。同じ表示名が 2 つあると章題も関係図の節点も区別が付かない）。書かなければ従来どおり内部名だけで表示される。
- `display_field`（任意）: **この集約の行を人に名指す欄**（`fields` に居る `string` / `text` の欄 1 つの名前。例: `display_field: title`）。生成物が行の名前を出す場所 —— **確認ダイアログの本文**（`「{値}」{確認の見出し}。{注意書き}`。行の表の行のボタン・1 行に対するボタン列）と、**参照の欄の選択肢の表示名**（選択肢の読みの第 2 列がこの欄であること = S18）—— がこの欄を引く。名前の欄は集約ごとに綴りが違う（`name` / `title` / `display_name` / `subject` …）ので規約からは導けず、宣言する（[ADR-0016](../../../../decisions/common/ADR-0016-entity-display-field.md)）。書かなければ生成物は行の名前を出さない。実在と型は V22 が見る。**名前の欄は 1 つ**（複合の名前は表さない）。
- `table`（任意）: DB のテーブル名。**既定は `entity` の単純な英語複数形化**（`loan` → `loans`、`hold` → `holds`）であり、規則で導けない名前のときだけここに書いて上書きする。生成器（期待 RLS ポリシー表）はこの規則と宣言だけを見る（ドメイン固有の対応表は持たない）。
- `context`（文脈依存ロールを使う場合は必須）: `{エンティティ名}: {参照パス}` の写像。ガード式・binding 式・access_spec の `scope: context(...)`・query_spec の**スコープ条件**は、ここで解決できる範囲しか参照できない。
  - **書けるのは「自分の行から相手を辿る前方参照」だけである**（V2 が検査）。値は `{自エンティティ}.{フィールド}` の 2 段固定で、相手が自分自身でなければそのフィールドは `ref({相手})` 型でなければならない（例: `item: loan.item_id`）。自己参照（`item: item.id`）は**主キー相当の列**（`uuid` かつ `auto: true`）を指すこと — 外部キー列を指すと「自分の行」ではなく別のエンティティの行に届く。
  - **相手側の列から自分を指す逆参照は書けない**（例: event の context に `reservation: reservation.event_id`）。それは 1:N であって「1 行 → 1 行」の解決にならず、その上に乗る読み取り仕様の返す集合が静かに多対多になるためである。1:N の関係を可視性の根拠にしたい場合は、その関係を持つ側（子）の access_spec と query_spec で表す。逆参照そのものを DSL に入れるかは ADR で判断する未決事項とする。
- `fields[]`（必須）: フィールド定義。
  - `type` は**閉じた集合**とする: `uuid` / `string` / `text` / `integer` / `decimal` / `boolean` / `date` / `datetime` / `enum([...])` / `ref(entity)` / `state(machine)`。これ以外を書いてはならない。
  - 制約は `required` / `max_length` / `min` / `max` / `pattern` / `auto`。
  - **`format: url`** は `string` の欄だけが持つ書式の宣言で、**絶対 URL の http / https だけ**を通す(`javascript:` / `data:` / `vbscript:` / `file:` などの別のスキーム・スキームの無い綴り・プロトコル相対・ユーザー名つき・空白と制御文字・非 ASCII〈パーセントエンコードで書く〉・IPv6 のホスト・長さ 2048 超は通さない)。入力スキーマ(zod)・表の CHECK・world の値・生成する画面の部品(表と詳細は `@kaninabe/runtime/url` の `safeHttpUrl` を通したリンクだけを描く)が同じ 1 つの宣言から出る。`pattern` とは併記できず、`max_length` は 2048 以下。`pattern` で URL を書くと world が値を作れず生成テストが丸ごと消える(R14 が止める)。導入の理由(拡張トリアージの例外条項を使った)は設計記録 triage-format-url に残してある
  - **`format: markdown`** は `text` の欄だけが持つ書式の宣言で、**書式つきの本文(Markdown)**を表す(`pattern` とは併記できず、`max_length` は 8,000 以下。値の文法は課さない —— Markdown は任意の文字列が妥当なので入力スキーマ・表の CHECK には効かない)。効くのは**描くとき**で、生成する画面の部品(表と詳細)は `@kaninabe/runtime/markdown-view` の `MarkdownView` だけで描く。`MarkdownView` は `@kaninabe/runtime/markdown` の `renderMarkdown` の出力(生の HTML を捨て、要素と属性を許可リストで通し、リンクは `safeHttpUrl` を通った http / https だけ残す)だけを載せる唯一の部品で、アプリの手書きのコードは `dangerouslySetInnerHTML` / `innerHTML` などの差し込み口と Markdown を自前で解く部品を ESLint の `layer/no-raw-html` が書けなくする。書式つきの本文として描く欄が `format: markdown` を宣言していなければ R15 が止める(ASVS V1.3.1・V1.3.5)。導入の理由(拡張トリアージの例外条項を使った)は設計記録 triage-format-markdown に残してある
  - **`bearer`** は**持っていれば効く値**(その値を持っているだけで権能が手に入る。招待・使い捨てのリンクの鍵など)の宣言で、`string` の欄が `supplied_by: db`・`max_length: 43` 以上のときだけ書ける(`format` とは併記できない)。**値を作るのは DB の列の既定値だけ**で、data_table の `defaults` に CSPRNG の 32 バイトを base64url にした式(`translate(encode(gen_random_bytes(32), 'base64'::text), '+/='::text, '-_'::text)`。拡張は pgcrypto)を書く —— UUID は 122 ビットで ASVS V11.5.1 が不可とし、アプリが乱数を作って渡す口(`p_{欄}` / `p_new_{欄}` の引数)も閉じる。**寿命は必ず宣言する**: 短期で失効して使い切りなら `bearer: { expires_at: {datetime の欄}, used_at: {datetime の欄} }`(同じ集約の欄を名指す)、使い回す設計なら `bearer: { reusable: 理由 }`(**受け入れた危険**として毎回 warning で名指す。理由は空にできない)。宣言した欄は URL のパス(画面の route の動的セグメント `:{欄}` / `:{集約}_{欄}`)に載せられず(フラグメントか POST の本文で運ぶ)、生成する作成の RPC は監査ログ(`domain_events.payload`)に値を載せず(`redacted` にも載せない)、外部連携の `sends.fields` に入れられない。これらは R16(と X7)が見る(ASVS V11.5.1・V14.2.1・V6.4.1)。導入の理由(拡張トリアージの例外条項)は設計記録 triage-bearer に残してある
  - **上限は省略できない**(R10)。`string` / `text` は `max_length` を、`integer` / `decimal` は `min` と `max` を必ず書く —— 制約は生成される入力スキーマと表の CHECK の唯一の源なので、省略は「上限が無い」になり、巨大な本文・桁あふれ・費用の暴走の口になる。意図して上限を置かない文字列の欄だけが `unbounded: 理由`(空にできない・`max_length` と併記できない)を書く。数の欄に受け入れの口は無い。
  - `labels`（`enum([...])` の欄のみ。**入力に現れる enum では必須**）: enum の値 → 人の言葉の写像。**その欄がどれかの action_spec の `input` に現れるなら必須**で、キー集合は enum の値集合と一致しなければならない（V16。過不足はエラー）。人が選ぶ値には人の言葉が要るからであり、置き場が仕様に無かったあいだ、画面は対応表（`ENTRY_KIND_LABELS` の類）を手で持っていた——値を 1 つ足したときに直し忘れる形である。生成物は `app/src/domain/generated/{entity}.labels.ts` の `{entity}EnumLabels`（鍵は欄の名前）で、**保存点の 1 画面フォームの `select` もこれを引く**。入力に現れない enum（内部の区分）では任意。
  - `supplied_by`（任意。既定は「入力か実行者」）: 値の供給元。書けるのは `db` だけで、「**入力にも実行者にも現れず、DB が決める**」の宣言である。宣言した欄は作成入力スキーマから落ち（`auto: true` と同じ扱い。ただし**行で必須かどうかは `required` が正**のまま）、機構は data_table 側が宣言する。V17 が次の 3 つを見る:(a) どの action_spec の `input` にも現れない(ただし `supplied_by: db` が決めるのは**作るときの値**であり、作った後の書き換えは access_spec の `writes` が宣言する —— `writes` に載る欄は編集(`{集約}.update`)の `input` に現れてよい。親の下の末尾の番号を DB が振り、並べ替えは編集が持つ形。点検 24 回目 B24-1) (b) その表の data_table が `defaults`（列の既定値）か `triggers[].supplies`（トリガが埋める）で機構を宣言している (c) 作成 RPC（`insert_{entity}`）の `params` に `p_{欄}` が無い（渡す口が閉じている）。**「入力に無いがサーバーが決める値」を TS が計算していると、その規則は仕様のどこにも書かれていない知識になる** —— ユースケース起点で生成する複合 RPC も 1 画面フォームもその値を知りようがなく、招待を人に入力させるフォームが生成される、という形で現れた（束 ⑯e）。表現力を買う（DSL に式を書けるようにする）のではなく**値の決定を DB 側へ移す**のがこの宣言の趣旨である（dsl-extension-triage.md）。実例: `invitation.code`（列の既定値で採番）/ `item.loan_reminder_at`・`return_reminder_at`（before insert トリガが締切・返却日から逆算）。**機構は 4 通りある** —— 列の既定値（`defaults`。値が SQL の式 1 本で決まるもの）／**祖先の列の写し**（そのトリガが宣言する不変条件の `formal` が `{自集約}.{列} == {別の集約}.{列}`。**トリガ関数の本文が生成物になる**）／**同じ行の日時列 ± 定数の幅**（トリガの `derives: { {列}: { from, offset, mode } }`。幅の数を仕様が持ち、**本文が生成物になる**。`mode` は `initial`（挿入時に空のときだけ。初期値）と `follow`（発火のたびに引き直す。導出値）の別の約束で、書く人が選ぶ）／**親の下の末尾の番号**（トリガの `derives: { {列}: { append_within: {親を指す列}, mode: initial | insert_at } }` と `locks: { {親の表}: update }`。`insert_at` は入れてきた値を位置と読んで後ろをずらして差し込み、空なら末尾に振る —— その欄だけは `supplied_by: db` でも作成の `input` に任意で現れてよい(V17 (a)(c) の例外。fix25s)。並び順を画面が読み取りから導いて送ると、読みが古い回に一意の拒否に化ける。その欄は範囲の上端 `max` を必ず書く —— 上端を越える作成は閉じた語 `append_full` で断られる(点検 25 回目 B25-1)。ARCH-SP-BE-0001 §入力に無いがサーバーが決める値。実例: `hold.order_index` / `note.order_index`）／それ以外（子集約の畳み込み。本文は手書きのままで、その列は生成物だけでは埋まらないことを T15 が warning で報告する）。判断の記録は非公開の開発記録にある。**逆向きも見る（T9）** —— data_table の `triggers[].supplies` に載る列は、entity_spec 側で `supplied_by: db` を宣言しなければならない。片側にしか宣言が無いと、同じ列について「人が入れる値」と「DB が決める値」の 2 つの読みが同時に立つ（生成物は `supplied_by: db` を見て「置かない列」を決めるので、宣言していない写しの列にはテストやフォームが値を書き込もうとする）。
  - `label`（任意）: UI の表示名（業務の名詞。例: `label: 予約名`）。`states[].label` / `events[].label` の「内部名で配線・label で表示」の原則をフィールドまで延ばしたもの。**画面はフィールド名（内部名）で配線し、表示文字列は生成物（`{entity}.labels.ts` の `{entity}FieldLabels` — `writes` の有無に依らず全エンティティに出る・フィールド定義表の表示名列）経由でこの label を引く** — 手で同じ文字列を書き写すと仕様と表示が二重管理になる。`description`（説明文）とは役割を分けて混ぜない: **業務の名詞（フィールド名・見出し）は label で仕様が持ち、説明文・ヘルプ・エラー文は実装の自由**のまま。空文字は不可、同一エンティティ内で重複不可（V1）。書かなければ従来どおり文言は実装が持つ。
  - **`auto: true` は「値をシステムが供給する（入力に現れない）」の意味**であり、「無いことがある」ではない。生成される zod では**入力スキーマから除外され、行（row）のスキーマでは必須**になる（`required` を併記する必要は無い）。ID・作成時刻がこれにあたる。
  - **`state(...)` 型のフィールドも同じ扱い**とする（入力スキーマからは除外され、row では必須）。初期値は state_spec の `initial` が決め、その写像が列の DEFAULT になるので、永続化された行に状態が無いことはない。
  - **`required` の文字列（`string` / `text`）は「空白を除いて 1 文字以上」を含意する**。生成される zod は `z.string().trim().min(1).max(...)` であり、空文字も空白だけの値も受け付けない（`required: true` を書いた人が「空欄で通ってよい」と思っていることは無い、という読み方を仕様の意味論として固定する）。この含意はスキーマ生成側の第一防衛線であり、**DB の CHECK 制約には昇格させていない**（DB 側は `not null` と長さ上限までを持つ）。二重に彫ると仕様の 1 行に対して執行点が 2 つになるため、昇格の要否は「アプリを経由しない書き込み経路を認めるか」を決める日に判断する。
  - **フィールド制約はここが唯一の定義場所**とする（PRIN-0007）。zod スキーマ生成の源であり、フォーム（即時フィードバック）と Server Action（本検証）の両方がこの生成物を使う。バリデーション仕様を別文書に切り出してはならない。
  - `personal`（**全フィールドに必須**）: 特定の個人に結びつき、本人が消去を求めうる値かを `true` / `false` で書く（security-surface-proposal.md §3）。書き忘れは V1 エラーとし、「暗黙に非個人」を作らない。判定は「消去を求めうるか」の 1 問。**目安**: 表示名・本名・連絡先（メール・電話・外部アカウントの ID など）・自由記述で人について書く欄（司書への連絡事項・購入希望本文・備考）・本人の属性の申告（学生かどうか・子連れ等）は `true`。金額・状態・順序・日時・題名・著者・分館名・タイトル・団体や蔵書の説明は `false`。`ref(entity)` 型（他集約への参照）は値そのものが個人情報を運ばない構造上の識別子なので原則 `false`（personal データはそれを持つ集約側の列に宿る）。**迷ったら `true`**（消せる側に倒す）。`personal: true` の列の値は監査ログ（`domain_events.payload`）に書かれず、列名だけが `redacted` に残る（実装: 各集約の `insert_*` / `update_*` RPC。見張りテスト: `app/src/infrastructure/__tests__/guarantees/audit-no-personal-data.test.ts`）。
  - `personal_placeholder`（`personal: true` のフィールドのみ必須。`personal: false` には書けない）: 消去（手順 2 の anonymize。未着手）が書く置換値。文字列リテラル、または `{id}` を含めて行 id に置換する形（一意制約のある列用。`{id}` はハイフン無しの 16 進の 32 桁。例: `chat_user_id` の `{id}`）。NOT NULL でない列は `null` も書ける（消去時に NULL にする宣言）。**値は列の制約に収まらなければならない**（T25: 一意の索引の列は `{id}` を含むか `null`・長さは `{id}` を 32 桁で数えて `max_length` 以内・`pattern` に合う・空にできない列に `null` は書けない・`boolean` / 数 / `enum` は値域の値・ほかの型は `null` だけ）。
- **複数の直交状態フィールドを持ってよい**。`type: state(machine)` のフィールドを複数宣言することで、審査状態 × アーカイブ × 公開状態のような直交軸を、階層状態機械を導入せずフラットな機械の合成として表現する。各フィールドは独立した state_spec と接続する。

### state_spec（{aggregate}/states.md）

DSL の中核。状態機械そのものと、**遷移の実行権限**を定義する。

```yaml
doc_type: state_spec
state_machine: loan
states:
  - id: draft        # 下書き
  - id: submitted    # 提出済み(司書確認待ち)
  - id: accepted     # 受理(予約の並べ替えの対象)
  - id: rejected     # 却下
  - id: withdrawn    # 取下げ
initial: draft
final: [rejected, withdrawn]

events:
  - id: submit
    from: [draft]
    to: submitted
    by: [loan_owner]
    guard: item.state == available
    otherwise_forbidden: 提出は下書きからのみ。確定後の再提出は新規貸出として扱う
  - id: accept
    from: [submitted]
    to: accepted
    by: [item_librarian]
    otherwise_forbidden: 受理判断は提出済みに対してのみ行う
  - id: withdraw
    from: [submitted, accepted]
    to: withdrawn
    by: [loan_owner, item_librarian]
    guard: item.state != on_loan
    otherwise_forbidden: 下書きの取下げは削除で行う

effects:                         # イベント→副作用(outbox接続点)
  - on: submit
    do: [notify_circulation_librarian]
  - on: accept
    do: [notify_loan_owner]
```

- `state_machine`（必須）/ `states[]`（必須）/ `initial`（必須）/ `final`（必須。無い場合も空配列を明示）。
- `states[].label` / `events[].label`（推奨）: 人間向けの日本語名（例: draft → 下書き、submit → 提出）。生成される図・表・マトリクスで ID と併記され、仕様レビューの可読性を大きく上げる。検証には使われない。
- `summary`（機械ごと）/ `states[].summary`（任意）: **節の要約**と**段の場面**。人が書く文で、書き方は §summary。検証には使わない（文書の欄）。
- `states[].tone`（任意。値域 `negative`）: その状態が「悪い知らせ」であることの宣言（例: 利用者の `disabled` / `left`、蔵書の `cancelled`）。省略時は `neutral`。自由記述にしない — action-spec-writing.md の「方針の導出」がこれを読み、`tone: negative` への遷移を無条件で `confirm_required` にする。
- `states[].settles`（任意。ファイル先頭の `vocabulary.settles` に宣言した id のリスト）: その状態への遷移が「その場で確定させるもの」の宣言（例: 貸出の `overdue` は `settles: [fees]` — 記録した瞬間に延滞料が固定される）。`tone` と同じく方針の導出の入力であり、`settles` を持つ状態への遷移は無条件で `confirm_required` になる。**何を確定させるか（`fees` 等）はこのアプリの事情であり、体系側の値域ではない**（notification カタログの `vocabulary` と同じ線引き）。使う前にファイル先頭で宣言する:

  ```yaml
  vocabulary:
    settles:
      - id: fees
        label: 延滞料       # 確認文言「{label}がこの時点で確定します。」に直接使う。必須
  ```

  `vocabulary` は 1 つの states.md に複数機械があっても 1 か所（ファイル先頭）に書き、全機械が共有する。`settles` を使わないファイルでは省略できる。
- **1 つの states.md に複数の直交状態機械を書く場合**は、トップレベルを `machines:` のリストにし、各要素に上記のキー一式（`state_machine` 以下）を持たせる。単一機械ならトップレベルに直接書く。両形式の併記はエラー。
- `events[]`（必須）: 各イベントは `id` / `from` / `to` / `by` / `otherwise_forbidden` が必須、`guard` は任意。
- **全域性は `from` + `otherwise_forbidden` で担保する**。各イベントについて、`from` に無い状態はすべて `otherwise_forbidden` の理由で禁止と見なす。**理由の省略はエラー**とする。
  - 状態ごとに理由を分けたい場合のみ、明示的な `forbidden:` ブロック（`{event, from: [...], reason}`）を書ける。
  - 全マスを手書きする方式は採らない。「イベントごとに 1 つの包括的な理由」を最低ラインとし、**state × event マトリクスを生成物として人間に見せる**ことで、暗黙の禁止も目視できるようにする。
- `by`（必須）: 遷移を実行できるロールの**許可リスト**。**空はエラー**。載っていないロールは拒否する（deny by default = PRIN-0010）。
- `self_assign`（任意）: **この遷移の実行者が、持たない役の根拠の欄を書いてよい理由**(R2)を、access_spec の `self_assign` と同じ**欄 × 役 × 書き手を名指す形**(`[{ field, role, by, reason }]`)で並べる。`by` はこの理由が当てはまる書き手で、**遷移の `by` の部分集合**(空にできない)。状態の `claim` を満たす状態へ動かす遷移(根拠の欄は状態の列)・`records_actor` / 入力で `binding` の欄を書く遷移の `by` に、その役を持つか含意する役でない実行者がいるとき(本人の復帰・名前だけの行をアカウントに結ぶ)だけ書く。名指していない欄にも、**名指していない書き手にも効かない** —— 遷移の `by` は並びなので、理由を書いた後に `by` へ足したロールは、要素の `by` に足すまで R2 が普通に見る(点検 10 回目 A10-1: 以前は書き手を名指さず、`by: [self]` のために書いた本人の復帰の理由が、後から足した `anonymous` の自己昇格も黙って受け入れた)。何も受け入れない要素 × 書き手・遷移の `by` に無い書き手を名指した組は、腐った受け入れとして error になる(点検 9 回目 A9-2・10 回目 A10-1)。

  ```yaml
  events:
    - id: resume
      from: [suspended]
      to: active
      by: [account_owner, librarian]
      self_assign:
        - field: patron.state
          role: patron
          by: [account_owner]     # librarian は patron を含意するので受け入れは要らない(名指すと腐った受け入れ)
          reason: 休会は本人の申し出による一時停止なので、復帰も本人ができる
  ```
`events[]` の要素に書けるキーは閉じている(知らないキーはエラー)。
- `public`（任意）: **未ログインのロールが `by` に並ぶ遷移の、理由つき受け入れ**(R5)。未ログインが遷移を起こせる形は認証なしで他人の行を動かせるので、意図して開くときだけ理由を書く(空は通らない)。未ログインのロールが `by` にいない遷移に書くと腐った受け入れとして error になる。
  - 同一イベントを人間操作と system の両方から発火させる場合は、イベントを分けず `by: [role, system]` に畳む。
- `guard`（任意）: 後述のガード式。他の状態機械の状態を参照してよい（例: `item.state`）。**参照先は entity_spec の `context` 宣言で解決可能でなければならない**。
- `records_actor`（任意）: **この遷移が実行者を書き留める自分の列**のリスト（束 ⑰-2）。
  - 遷移の RPC は状態列のほかに `p_{列}` を受け取ることがある（対応者・担当者）。その値は入力にも DB にも無く、**その遷移を起こした人そのもの**である。
  - **「どの遷移がその列を書くか」はイベントごとに違う**（対応開始は対応者を書くが、再開は書かない）。`access_spec` の `writes` は集約単位の宣言なのでイベントを区別できず、この区別を書けるのはここだけである。
  - 書ける列は「実在し・`ref(実行者の集約)` 型であり・`access_spec` の **`transition_writes`** に載っている」もの（V19）。`writes` の `by: system` の行では満たさない（下の access_spec §`transition_writes`）。実行者以外の値を書く遷移は `records_actor` ではなく action_spec の `computes` が受け皿になる。
  - **宣言に無い列を RPC が引数に持つなら、その遷移はその列を自分で決めない**（実行計画は空を渡す）。その空が「触れない」のか「空にする」のかは `clears` が決める（下）。
  - **実例は 1 件である**（`purchase_request.start_handling` の `handled_by`）。2 実例ルール（[dsl-extension-triage.md](../playbooks/dsl-extension-triage.md) §手順3）の**例外条項で買った** —— 宣言が無いと 56 操作の生成経路そのものが立たず、代わりに「遷移は常に実行者を書く」という**誤った既定を実装とテストに焼き付ける**ことになるからである（「いま入れないと後から入れられない」に当たる）。

  ```yaml
  events:
    - id: start_handling
      from: [received]
      to: in_progress
      by: [librarian]
      records_actor: [handled_by]   # 対応者を書き留めるのはこの遷移だけ
      otherwise_forbidden: 対応開始は受信直後の購入希望にのみ行える
  ```
- `records_time`（任意）: **この遷移が「いま」を書き留める自分の列**のリスト（束 ㉖）。`records_actor` の対である。
  - 遷移が自分の行に書く値の種類は「実行者 / いま / 空 / 別集約からの写し / 純関数の値 / 入力の値」の **6 つで閉じており**、そのうち「いま」だけが遷移の側に置き場を持っていなかった（設計の経緯は非公開の開発記録: §2 の全数表）。行を**作る**ときは `effects[].snapshot` の `from: now` で書けるのに、行を**動かす**ときだけ書けなかった、という非対称である。
  - **RPC の引数は増えない。** `records_actor` は値が呼び出し側から届くので `p_{列}` が要るが、こちらの値は SQL の時刻（`v_now`）である。生成される UPDATE は `clears` と同じ形（`case when p_event_id in (…) then v_now else t.{列} end`）になる。**時刻のガード（予約語 `now`）と `records_time` は、行ロックを取った後の同じ 1 つの時刻（`v_now := clock_timestamp()`）を使う**（トランザクション開始時刻の `now()` ではない。ロック待ちが締切をまたいでも期限切れの後に通らず、1 回の呼び出しの中の「いま」は 1 つに決まる）。
  - 書ける列は「実在し・**`datetime` 型**であり・**空にできて**（`required` / `auto` / `state(...)` でない）・`access_spec` の `transition_writes` に載っている」もの（V19）。同じイベントが同じ列を `records_actor` / `clears` と重ねて並べることはできない。**別のイベントなら並べてよい** —— 「保管が保管日時を書き、復元が空に戻す」はまさにその形である。
  - `datetime` に限るのは、書き留めるのが「押した瞬間」だからである（日付に丸めるのは表示の判断）。空にできる列に限るのは、`records_time` の意味が「**この遷移より前はまだ起きていない = 空である**」だからで、生まれた瞬間から値がある列はその意味を運べない。
  - **実例は 1 件である**（`fixture` archive の `document.archive` の `archived_at`）。2 実例ルール（[dsl-extension-triage.md](../playbooks/dsl-extension-triage.md) §手順3）の**例外条項で買った** —— `records_actor` / `clears` と同じ扱いであり、三分（実行者を書く / 空にする / 触れない）を四分に閉じる語彙だからである。片方だけを持つと「宣言の不在」が 2 つの意味を持ち続ける（`archived_at` の宣言の不在は「触れない」と読めるが、実際には「書くはずの列」だった）。**買った結果**、「状態 ⇔ その欄の有無」の不変条件が**複数の手順で満たす不変条件ではなくなり**、行の CHECK で執行できるようになる（遷移が 1 文で状態と欄を同時に動かすため）。

  ```yaml
  events:
    - id: archive
      from: [circulating]
      to: archived
      by: [curator]
      records_actor: [archived_by]  # 保管したのが誰か
      records_time: [archived_at]   # 保管したのはいつか（値はロック後の時刻。引数は増えない）
      otherwise_forbidden: 書庫へ入れられるのは供覧中の文書だけ
  ```
- `clears`（任意）: **この遷移が空にする自分の列**のリスト（束 ⑰-3）。`records_actor` / `records_time` の裏返しである。
  - 遷移の RPC が受け取る自集約の列を、その遷移が「触れない」のか「空にする」のかは**業務上の事実**である（紐付けを外す遷移は、紐づくアカウントの列を空にする）。実行計画はどちらの場合も空を渡すので、**宣言が無いあいだは同じ状態が RPC の本文しだいで正反対の結果を生んでいた**（`coalesce` なら触れない／代入なら空になる）。
  - 書ける列は「実在し・**空にできて**（必須でない）・`access_spec` の `transition_writes` に載っている」もの（V19）。同じイベントが同じ列を `records_actor` / `records_time` と `clears` の両方に並べることはできない。
  - **宣言しなければ「その列に触れない」である。** 宣言と RPC の本文（`coalesce` か代入か）の一致は `rpc-parity` の統合テストが実 DB で突き合わせる。突合は**（イベント × 列）** で行う —— 同じ列を「触れない遷移」と「空にする遷移」が同居しうるので、列単位に潰すと片方が黙って壊れる（束 ⑰-3b）。
  - **実例は 1 件（`companion_link.unlink`）で買った。** 2 実例ルール（[dsl-extension-triage](../playbooks/dsl-extension-triage.md) §手順3）の例外条項に当たる —— `records_actor` と対になって三分（書く / 空にする / 触れない）を閉じる語彙であり、片方だけを持つと「宣言の不在」が 2 つの意味を持ち続けるためである（`records_actor` と同じ扱い）。

  ```yaml
  events:
    - id: unlink
      from: [linked]
      to: unresolved
      by: [loan_owner, item_librarian, librarian]
      clears: [patron_id]           # 外す = 紐づくアカウントの列を空にする
      otherwise_forbidden: 紐付けを外せるのは紐付け済みの同伴の利用者だけ
  ```
- `effects[]`（任意）: ドメインイベント → outbox ジョブの接続点。`on`（イベント ID）と `do`（副作用 ID のリスト）を書く。**副作用の実体**（チャンネル通知の文面など）は `specs/backend/external` が定義し、ここには ID だけを持つ。
  - **同じ `on` を持つ `effects` を複数書いてよい**。1 つの遷移が別々のものを 2 つ作る（蔵書の写しと予約の写し）ときに、それぞれを別の行として書き分ける。
- `effects[].snapshot`（任意）: **その副作用が作るスナップショット行の列対応表**（ADR-0008）。下記。

#### `effects[].snapshot` — 公開時Fix の写像

「公開してよい情報しか列が無い集約を作り、公開の遷移がそこへ写す」（公開時Fix）を採るとき、**写像そのものを宣言に載せる**ための欄である。

```yaml
effects:
  - on: publish_public
    do: [snapshot_public_item]
    snapshot:
      to: public_item                 # 写像先エンティティ
      fields:
        - from: item.id               # 写像元は {entity}.{field} の 2 段
          to: item_id                 # 写像先は裸のフィールド名
        - from: item.title
          to: title
        - from: branch.name
          to: branch_name
        - from: now                      # 予約語。この写しを作った時刻
          to: published_at
```

- **書けるのは列の対応表だけである。式ではない。** 変換（匿名化・連結・切り詰め）の中身はここに書けず、`do` に並ぶ副作用 ID の実装が持つ。その正しさは不変条件（`enforced_by: application`）とプロパティテストが守る。
- **写像元（`from`）に書けるのは `{entity}.{field}` の 2 段か、予約語 `now` だけ。**
- **写像元は「実在」までを見て「接地」を要求しない**（V12）。スナップショットは子の行の集まりから写す（蔵書 1 件 → 予約 N 件）ことがあり、その関係は `context`（1 対 1 の参照パス）では表せないためである。どう辿るかは副作用の実装が持つ。
- **写像先の `auto: true` でない列を全部覆う**（覆い漏れは V12 の**警告**）。これが「公開側の集約に列を足しても何も鳴らない」という穴を塞ぐ唯一の機械である。
- 写像表は `app/src/domain/generated/snapshots.ts` に生成される。**実装は列の並びを手で持たず、この表を読む。**
- **隠し列と個人列の約束は写し先でも保つ**（V12 の観点⑥）。写像元の `fields_hidden` で隠した相手が写像先の列を読めるなら error、写像元が `personal: true` なのに写像先が `personal: true` でなければ error（元の行を消去しても写しが残る）。**`personal: true` は消去の連鎖を作らない** —— 写し元を消去する効果（`anonymizes`）があるなら、それを実現する RPC の `also_writes` に写し先の表を `scrub` か `delete` で足し、本文でその列を消す（宣言の欠けは T24 が error にする）。「読める」は閉じた定義で、写像先の `reads` の `scope: none` でない規則の `by` が、隠した相手自身・その相手が `implies` で宣言したロール・未ログインのロールのどれかで、写像先の `fields_hidden` がその `by` から列を隠していないときである。値が匿名化の変換を通す・本人が公開を選んだ、のように約束が別の形で守られているなら、**写像の行に約束 × 相手 × 読み手を名指して理由を書く**。

  ```yaml
  - from: article.author_note
    to: author_note
    copy_accept:
      - on: hidden        # 隠し列の約束。隠した相手と、写し先を読める規則の by を 1 つずつ名指す
        role: patron
        reader: patron
        reason: 公開の遷移の入力で本人が確認した文面だけが入る
      - on: personal      # 個人列の約束（role は書かない）
        reason: 匿名化の変換を通した表示名が入る
  ```

  名指していない約束・相手・読み手には効かず（受け入れた後で写し先の `reads` に読み手を足すと、そこが新しい指摘になる）、何も受け入れていない要素は腐った受け入れとして V12 が error にする。写しのトリガも同じ判定で、`triggers[].copy_accept`（`column` も名指す）が受け入れる（T15）。
- **副作用 ID が `snapshot_` で始まるなら、`snapshot` を書かなければならない**（2026-09-04
  拡張。V12）。`snapshot` は任意欄なので、書かずに済ませれば V12 の 3 つの観点（写像元・
  写像先の実在と型、写像先の列の覆い）をまるごと素通りできてしまう —
  「`snapshot_public_item` という名前の副作用が実は何も写していない」という状態を、
  検査が見ていないだけで許してしまう穴だった。`snapshot_` はこの文書がここまで一貫して使ってきた
  命名（`snapshot_public_item` / `snapshot_public_program` / `snapshot_public_site_page`）を
  正式な合図に格上げしたもので、**この接頭辞を持つ副作用は「スナップショット行を作る」という
  意味を宣言しているのだから、その写像を省略できてはならない**という筋である。
  この接頭辞を使わない副作用（チャンネル通知など）は対象外。
- **写像先の集約は entity_spec に `mirror: true` を書く**（2026-10-20。V12 の観点⑤ = `snapshot.to` と双方向）。
  写しの表への `delete` は破壊的な書き込みに数えない（写しが消えても元は残る）が、その免除を「`snapshot.to` に名前が出た」
  ことから推測すると、無関係な遷移に `snapshot: { to: X }` を書くだけで X の削除が確認の文言から落ちる。免除は宣言に置き、
  宣言と写像の両方が揃ったものだけを写しと認める。写しの集約の access_spec の `creates` / `writes` / `deletes` は
  システムのロール（`kind: system`）の規則だけにする（V25。人が作れる・消せる行は写しではない）。
  写しに残る個人列を置き換えて消す書き込み（`scrub`）は、写しでも破壊的に数える。

### summary（人が書く文。3 か所だけ）

ハンドブックが章・節・段の頭に出す**人の言葉の文**を、仕様の欄に書く。生成物に書くと次の `generate` で消えるので、置き場は仕様である（book-human-face.md §2。仕様が正、ブックはその写し）。**書く場所は 3 か所だけ**で、イベントごと・操作ごとには置かない（2 実例ルール。dsl-extension-triage.md）:

| 場所 | 何を書くか | 長さ | ブックのどこに出るか |
|---|---|---|---|
| `entity_spec` のトップレベル `summary` | この集約が何か（章頭の 1 文） | 1 文 | 章の頭 |
| `state_spec` の機械ごとの `summary`（単一機械ならトップレベル。`machines:` なら各要素） | この状態機械が何を進めるか（節の要約） | 1〜2 文 | ライフサイクルの節 |
| `state_spec` の `states[].summary` | その段で何が起きているか（段の場面） | 1 文 | 段ごと |

```yaml
# entity.md
summary: 司書が所蔵に加え、利用者が借りる本 1 点の単位です。

# states.md（machines: の要素）
- state_machine: loan
  summary: 貸出が、受取待ちから返却まで進む流れです。
  states:
    - id: overdue
      label: 延滞
      summary: 返却期限を過ぎ、司書が延滞料を確定するのを待つ段です。
```

- **書くのは任意**（省略可）。**書かなければブックに「（まだ書かれていない）」と出る**（黙って空にしない）。状態を 1 つ足す作業が文章を書く作業にならないよう、検査は warning に留める。ブックのレビューの手引き（`review-guide.md`）が**未記入の件数**を数えて配る（数えていないと数えて 0 だったの区別のため）。
- **事実は仕様から取る。新しい業務の判断を文に入れない。** 状態の `label`・遷移・不変条件の `statement`・`access` に書かれたことだけを、人の言葉で言い直す。文が仕様とずれたら仕様が正で、文を直す。
- **文体は設計メモ §7-6 の規則**に従う: 1 文 1 主張で 50 字以内（目安 40〜50 字）・括弧の補足を書かない・文中を記号（`=` `→` `/` `・`）でつながない・主語を書く（「司書が」「利用者が」。「システムは」は書かない）・敬体（です・ます）で書く・専門語は仕様の語だけを使う。**判断の理由は書かない**（それは標識の仕事。summary は「いま何が起きているか」）。
- **数字・仕様 ID・ファイルパスを書かない。** 件数・欄数・本数は生成が入れる（書くと二重の正になる）。ID とパスは読者が持たない。他の集約の名前は書いてよいが、リンクは生成器が張る。
- **YAML の値に `: `（コロン + 半角空白）を含めるなら引用符で囲む**（共通形式の規則と同じ）。
- **検査**: 文体は **M12**（長い文・括弧・記号・常体）、語の接地は **M10**（仕様に無い語・数字・識別子・等幅。試験運用）。どちらも warning で、`npm run verify` が見る。M10 の語彙は**ドメイン仕様の frontmatter の値**と**用語の台帳の語**で、`summary` 自身は入れない。書いた文が M10 に指摘されたら、仕様に書かれた語で言い直す（term-ledger-writing.md）。
- **文の意味は検証しない。** 検証が見るのは「文体」と「語が仕様にあるか」だけで、文が仕様と同じことを言っているかは人がレビューする（読む量の「必読」に入る。分類は公理で、`semantics/reading-class.ts` の `entity.summary` / `machine.summary` / `state.summary`。書き換わったかどうかは `spec:diff` の「公理の側」に出る）。

### access_spec（{aggregate}/access.md）

状態遷移（書き込み）の権限は state_spec の `by` が持つ。読み取り・**新規作成**・「状態を変えない編集」・**物理削除**は別軸なのでここで定義する。

```yaml
doc_type: access_spec
entity: loan
reads:
  - by: loan_owner
    scope: own                   # 自分が借りた人である貸出のみ
  - by: item_librarian
    scope: context(item)      # 自分が司書である蔵書の貸出全部
  - by: patron
    scope: none                  # 他人の貸出は見えない
  - by: anonymous
    scope: none
  - by: system
    scope: all
  - by: staff_member
    scope: all
    filters: { company_id: actor.company_id }   # テナントの境界(任意。実行者の属性で一律に狭める)
    when: loan.state != cancelled              # 行の状態の条件(任意。その状態の行は見えない)
fields_hidden:                   # スコープ内でも隠すフィールド(任意)
  - field: note
    from: [patron]
creates:                         # 新規作成の権限(任意)
  - by: patron
    when: item.state == available   # ガード式(任意)
writes:                          # 状態遷移によらないフィールド更新の権限
  - by: loan_owner
    fields: [reference, renewal_days, note]
    when: state == draft         # ガード式(状態・フィールド条件)
  - by: item_librarian
    fields: [note]
    when: state in [submitted, accepted]
transition_writes: [handled_by]  # 遷移だけが書く列(任意。ロールを持たず、編集の経路を作らない)
deletes:                         # 物理削除の権限(任意)
  - by: loan_owner
    when: state == draft         # ガード式(任意)
```

- **書けるキーは閉じている**（V1 が allowlist で見る）。トップレベルは `entity` / `reads` / `fields_hidden` / `creates` / `writes` / `transition_writes` / `deletes` / `accept`（＋ frontmatter 共通キー）、要素は `reads: by / scope / filters / when`・`accept: by / filter / reason / on`・`fields_hidden: field / from`・`creates: by / when / self_assign / delegate / abuse`・`deletes: by / when / public`・`writes: by / fields / when / effects / self_assign / public` だけである。**スキーマに無いキー・綴り違いはエラーになる**。読まれないキーが素通りすると「書いたのに効いていない宣言」が仕様に残り、生成物にも突合にも現れないまま、人間だけがそれが効いていると信じることになる。
- `reads[]`（必須）: **全ロールについて明示必須**とする（全域性）。`scope: none` を書かない限り検証エラーになる。「書き忘れて公開」を構造的に起こさないための規定である（PRIN-0009）。
- `scope` は**閉じた集合**: `own` / `context(entity)` / `all` / `none`。これが RLS ポリシー生成・突合の単位になる。
  - **`scope` とロールの根拠は同じことを言っていなければならない**（T7。束 ⑳-4a）。ポリシーの述語はロールの根拠から出るので、対象に依らず立つロール（`kind` / `claim`）に `own` / `context(…)` を書くと述語は補助関数だけになり、**宣言より広い**（実質 `all` の）ポリシーが黙って出る。逆に `binding` を持つロールに `all` は書けない（述語が束縛で狭まる）。`context(X)` の X は束縛が指す集約である。
  - **`scope` そのものは行の状態を見ない。** 状態で見え方を変えるのは次の `when` の役であり、`scope` は「原理としてどの行か」だけを答える。
- `reads[].when`（任意）: **行の状態で見え方を絞る条件**（束 §14。設計の経緯は非公開の開発記録）。ガード式を書き、`scope` / `filters` と**論理積**で重なる。
  - 3 つの軸が別のことを答える —— `scope` が「原理としてどの行か」、`filters` が「実行者の側の境界」、`when` が「**対象の行の側の判定**」である。
  - **書けるのは対象の行の欄と、`context` で 2 段までで辿れる親の欄だけである。** `actor.{欄}` は書けない（V2 が error にする）—— 実行者の属性で狭めるのは `filters` の役であり、同じ境界を 2 つの口で書けると宣言の正が 2 つになる。文法は `guard` と同じで、「空かどうか」（`is null`）は書けない（§ガード式の文法）。
  - **RLS の `using` に状態の条件が入る**（生成物。`legacy/spec-tools/lib/sql/rls-when.ts`）。したがって**読み取り経路を何本足しても効く** —— これが `query_spec` の `filters` との決定的な違いである。query の `filters` は「その経路のための絞り込み」であって集約の可視性ではないので、4 本目の経路を足した人が書き忘れても誰も鳴らない（`reads[].when` を買う前の archive は、一覧から消えた保管文書が**1 件引きの経路からは返っていた**）。**ポリシー名には出ない**（名前に畳めるのは列の名前のような短い語であって式ではない）ので、条件が変わったことは `spec:diff` の「見える行」の軸が宣言から直に言う。
  - **`state_spec` の遷移や集約の分割で表せるなら、そちらが先である。** 「公開したものを見せる」のように**公開物が別の物**であるときは、公開時の写し（P-1: 別集約へのスナップショット）でモデル化する —— 同じ物の状態で見せ分ける場合にだけ `when` を書く（2026-08-23 の方針と §14 の線引き）。判定の手順は [拡張トリアージ](../playbooks/dsl-extension-triage.md)。
  - **見えない行は `world` に置かれる**（束 §14）。`when` を持つ表の RLS の挙動テストは、系統ごとに「その条件を偽にする状態の行」をもう 1 つ置いて「返らないこと」を実行する。**反例の無い `world` では、条件を落としたポリシーでも検査が緑になる**ので、反例を置けないことは黙って通さない。報告する検査は 2 つに分かれる。
    - **条件そのものから反例の状態が決まらない**（自集約の状態の欄を `==` / `!=` / `in` で比べていない・時刻を比べている・どの状態でも偽にならない）→ **V2 が error**。宣言として使えないので、仕様の段で落とす。
    - **その状態の行を置けない**（不変条件が要求する欄を `world` の中から埋められない等。data_table の宣言に依る）→ **T8 が warning** で「`world` を作れない」と報告し、その表の挙動テストは生成されない（T11 = 一致の証明は読み取りの可視性を見ないので、ここでは何も言わない）。
  - **書いても効かない置き場がある**（T7 が error。束 §14 / 独立レビュー）。RLS のポリシーは論理和で合成されるので、**無条件の `scope: all` が同じ行を見せている規則のポリシーは刈り込まれる** —— 刈り込まれる側（`own` / `context`）や `scope: none` の規則に `when` を書いても 1 文字も効かず、期待表にも `spec:diff` にも出ない。**条件は上界の規則に書く**。上界に条件を足すと刈り込みの根拠が消えるので、狭い規則のポリシーが新しく生える（= 可視性が変わる）ことに注意する。
- `reads[].filters`（任意）: **実行者の属性で一律に狭める境界**。`{対象の列}: actor.{欄}` か `{親の集約}.{列}: actor.{欄}` の写像で書く（束 ⑲-2a）。
  - `scope` が「原理としてどの行か」を答え、`filters` が「その中の、実行者の側の境界」を答える。2 つは**直交する**（行の状態ではなく実行者の属性で決まる）。
  - 右辺に書けるのは `actor.{欄}` だけで、その欄は `session: true` を宣言していなければならない（V2）—— 保存点の `permit` の先読みはセッションの写しから引くからである。**ただし DB の判定の正は実行者の行である**: RLS の述語は右辺を security definer の補助関数 `public.actor_{欄}()` で**実行者自身の行から**読み、トークンの属性（`app_metadata.profile`）は読まない。写しは最長でトークンの寿命だけ古く、運営が所属を付け替えたあとも古い所属の行を見せ続けるためである（役の判定 `is_{role}()` と書き込みの `when: actor.{欄}` が既に行を読んでいるのと揃えた）。補助関数は実行者の集約の data_table の `functions[]` に `kind: helper` + `actor_field: {欄}` + `migration:` で宣言する（本文は生成物。T7 が両方向を見る）。左辺と右辺の**値の種別が同じ**であることも V2 が見る（比べるのは行の値そのものなので、cast で揃えない）。
  - **左辺には `context` で 2 段まで辿れる親の列を書ける**（`{集約}.{列}`。`binding` / `when` と同じ語彙・同じ上限）。予約 → 部屋 → 部門 のように**テナントの列が祖先にしか無い子表**でも境界を書ける —— 以前は自表の列しか書けず、子表は境界を宣言しようがなかった。親へ届くこと・その列が実在することは V2 が見る。述語は参照の鎖をスカラー副問い合わせで辿り（`when` の親の欄と同じ届き方）、親の行が無ければ不成立になる。**親の行の読み取りもその親の RLS に従う**（ポリシーの式は読む人の権限で評価される）ので、親の `reads` にも同じ境界を書くのが自然な形である。3 段より遠い祖先の列で狭めたいなら、近い集約に写しの列を持たせる。自集約の名前で書いた左辺（`{自集約}.{列}`）は裸の `{列}` に畳まれる。
  - **これがテナント境界の言い方である。** 語彙が無かったあいだ、複数テナントのシステムは全集約を `scope: all` と書くしかなく、**テナントを越える読み取りが「正しい仕様」として verify 緑で通っていた**（束 ⑱ の題材 D が実測した最大の穴）。書き込み側の境界は `creates` / `writes` / `deletes` の `when`（例: `when: "store.company_id == actor.company_id"`）が受け持ち、**書き忘れは V26 が error で止める**（下記）。
  - **ポリシーの `USING` 句そのものが生成される**（束 ⑳-4a）。`{表}.{列} = (select public.actor_{欄}())`（親の列なら `(select …親の列… where id = 鎖) = (select public.actor_{欄}())`）という比較がロールの根拠の述語と `and` で結ばれ、式全体が 1 回 `coalesce(…, false)` で閉じられる。補助関数を `(select …)` で包むのは、行ごとに呼ばずに初期計画として 1 回だけ評価させるためである（関数は `stable`。Supabase の RLS の作法で、現在の実行者の式 `(select auth.uid())` と同じ手）。`actor.id` は補助関数を経ず、現在の実行者の式と直に比べる。名前にも `_within_{列}`（親の列なら `_within_{集約}_{列}`）が付く（`stores_select_staff_member_all_within_company_id`）ので、名前の突合と**本文の意味の突合**（生成ファイルをトランザクションで適用して `pg_policies` を読み直す）の 2 つが掛かる。
  - **境界の欄が 1 本も無いときも黙らない**（V20。点検 5 回目 A5-4）。テナントの欄に `session: true` を付けず、`actor.{欄}` も 1 度も書かなかった製品では境界の欄が 0 本になり、V20 / V26 は何も見ない。そこで実行者の集約（`session: true` の欄を持つ集約）の参照の欄で、ほかの集約も同じ参照先を指すもの（テナントの欄に見える形）を error で名指す。テナントなら `session: true` を付けて境界を書き、テナントでないなら、その欄に `not_boundary: {なぜ見える行を狭めないか}`（参照の欄だけ・理由は空にできない）を書いて外す。**`not_boundary` を書けるのは実行者の集約の、境界でない参照の欄だけ**で、ほかの集約の欄・`session: true` を併記した欄・`actor.{欄}` として境界に結んでいる欄に書くと V20 の error（点検 6 回目 A6-3。「境界ではない」との矛盾・外す名指しが起きない死んだ宣言）。書けた宣言は毎回 V20 の warning（区分は**受け入れた危険**。宣言の実在は W5）で名指し、外した欄をレビューの目に出す。
  - **書き忘れも黙って通らない**（V20。束 ⑲-2a）。どこかで `actor.{欄}` を使っている欄・**`session: true` の参照の欄（使っていなくても。全部書き忘れると検査がそろって黙る形を閉じる）**と同じ名前（または同じ `ref` 先）の列を持つエンティティが、その列の `filters` 無しで `scope: all` / `scope: context(...)` を宣言していたら **error** が出る（以前は warning。子表が境界を書き忘れると他テナントの行が全部返るので、warning のままでは商用の製品に当てられない）。書けるようになっただけでは「書き忘れ」は防げないためである。**自分はその列を持たないが、`context` で 2 段まで辿れる祖先が持つ**エンティティも候補になり、祖先の列（`{集約}.{列}`）を名指して error が出る（その境界の欄で狭める `filters` が 1 本あれば黙る）。受け入れる `accept` の `filter` にも祖先の列（`{集約}.{列}`）を書ける。**祖先は `context` ではなく生の `ref` の閉包で探す** —— 境界の列を持つ表へ生の参照では届くのに `context` で 2 段以内・1 通りに辿れない（宣言が無い・経路が 2 通り以上・3 段以上）なら「境界を書けない形」として error（`context` を宣言する・写しの列を持たせる・その参照の欄を名指した `accept`）。**境界の根**（境界の欄の参照先。`actor.company_id` が `ref(company)` なら `company`）は自分を指す参照の列を持たないので、**`id` を境界の列として扱う**（読み取りは `filters: { id: actor.company_id }`、書き込み・遷移は `company.id == actor.company_id`。点検 4 回目 A4-1: 以前は根の表が候補 0 件で、境界を消しても黙っていた）。**実行者の集約（`session: true` の欄を持つ集約）を経た祖先の列は境界にしない**（起案者・記録者の参照の先の `staff_member.department_id` は人の今の所属であって行のテナントではない。異動すると過去の行が新しい所属から見え・動かせる。A4-2）—— その道しか無ければ「境界を書けない形」になる。**未ログインの `scope: all` をテナントを持つ表に書くと warning**（未ログインの許可はログイン中の人にも当たり、ほかの規則の `filters` が実質効かない。跨いで見せてよいなら `accept` に理由）。
  - **書き込みの側の書き忘れも止まる**（V26）。境界の列（V20 と同じ目で導く: `actor.{欄}` として使われている欄を表す自分の列、または `context` で辿れる祖先の列）を持つエンティティの `creates` / `writes` / `deletes` は、`when` の**トップレベルの `and` の項**に「境界の列 == `actor.{欄}`」（どちらの辺でもよい）を持たなければならない。`or` / `not` の中・`!=`・順序比較は結んだことに数えない。作成は境界の列を**入力で受ける**ことが多く、`when` が結んでいなければ他のテナントの行を作れる（題材 stores の商品の作成が実例）。**入力で受ける参照の欄は `context` に無くても全部見る** —— 参照先が境界の列を持つなら、`when` で結ぶ（`context` でその欄を通って届くこと）か、自分の境界の列と参照先の境界の列の等式を執行点つきの不変条件で持つか、`accept(on: [create])` が要る（他社の商品を指す注文を作れた形）。
    - 入力から来る**自分の列**はその列そのものを結ぶ。**作成では、DB が埋める自分の列は結んだことに数えない**（まだ行が無く、`when` が読めない）。
    - **作成では、入力で受ける参照の欄を経て届く祖先の境界の列を、欄ごとに結ぶ**（同じ欄を経て届く祖先はどれか 1 本でよい）。DB の写し（`supplied_by: db`）の参照の先は要らない。「祖先のどれか 1 本」が成り立つのは、ほかの祖先が DB の写しのときだけである —— 在庫の移動が入力で受ける商品は、伝票の会社を結んだだけでは別の会社のものを指せる（題材 stores の実例）。作成の規則が実行者に縛る参照の欄（持ち主など）の先は実行者そのものなので結ばない（claim のロールや system は縛りを解くので、その先も結ぶ）。
    - 編集・削除の `when` が読む親は今ある行の親であり、付け替える新しい親ではない（権限の事実を読む `permit` も、作成でない手順は現在の行の `context` から親を辿り、入力の新しい参照の欄は使わない）。DB が埋める自分の列・祖先だけを持つ編集・削除は、その列か祖先の列のどれかを結べばよい。
    - **編集で行の持ち主を動かす口は、旧い値への `when` では塞がらない**。`writes[].fields` が自分の境界の列、または境界の列を持つ祖先への入力の参照の欄を含むと、書いたあとの行が実行者のテナントに留まる保証が無いので、(a) その欄を結ぶ**執行点が実在する不変条件**（data_table の check / trigger が `invariant` で名指す。宣言されているだけ・T16 が warning で報告する「実在しない執行点」・編集の経路を通らない `guard` は数えない。自分の境界の列を書く口は別のテナントの列との一致、参照の欄の付け替えは自分の境界の列と祖先の境界の列の一致を formal に持つこと）か、(b) `accept: [{ by, filter, on: [write], reason }]` が無ければ **error**。編集で動かす必要が無ければ、その欄を `fields` から外す（作成のときにだけ入力で受ける）のが定石。会社の列を持たない子の親の付け替えは、行に会社が無いので不変条件では結べず `accept` だけが消す。
    - ロールの種別が `authenticated_default` 以外（未ログイン・システム起点）の規則は error にせず **warning** で名指す（実行者の属性が供給されず結びようが無いが、テナントを持つ集約へ書けるのに誰も理由を言っていない形は黙って通さない）。書き込みの規則はあるのに境界の列を導けない集約（境界の欄がモデルにあるとき）も warning で名指す（V20 / V26 の死角）。**状態遷移も対象である**（点検 3 回目 A3-1）—— `by` に対象に依らず立つロール（既定のログインロール・`claim`）がある遷移は、`guard` のトップレベルの `and` の項に「境界の列 == `actor.{欄}`」を持たなければ error（取消・承認で他社の行を動かせる形。`binding` のロールは対象の行と結ばれて立つので要らない・システム起点は対象外。**未ログインの遷移は書き込みと同じく warning**（A4-3））。境界の列を導けない集約の死角の warning は遷移も数える。ガードで結べば生成される遷移の RPC の述語も結ぶ（実行者の行から属性を読む）。`records_actor` が binding の根拠の列を書く遷移も同じ規則で止まる。
    - 受け入れは V20 と同じ `accept: [{ by, filter, reason }]` だが、**書き込みは既定で受け入れない**（読み取りで跨がない理由は書き込みで跨がない理由とは限らない）。書き込みも受け入れるなら `on: [create, write, delete, transition]` で種類を名指す。**遷移を受け入れるときは `events: [{イベント ID}, ...]` で遷移も名指す**（必須。V1。名指した遷移にだけ効き、後から足した同じロールの遷移には効かない —— 1 つの遷移のために書いた理由が取消・無効化の境界まで外していた。A4-4）。**名指しの単位は遷移の定義**である（点検 5 回目 A5-1）: 同じ ID の遷移が遷移元違いで 2 本以上あるときは `{イベント ID}@{遷移元の状態}`（例: `suspend@active`）で絞る。名指しは受け入れの `by` で起こせる定義の**ちょうど 1 本**に当たらなければ V2 が error（当たらない = 死んだ宣言 / 曖昧 = 後から足した同じ ID の遷移まで黙って効く）。**`on` を書いたら書いた種類にだけ効く** —— 読み取りも受け入れるなら `read` を並べる（`on: [create]` が読み取りの境界まで黙って受け入れていた。逆向きの理由で開くのを防ぐ）。`filter` は自分の列（`{列}`）か `context` で辿れる祖先の列（`{集約}.{列}`。V2 が実在と届くことを見る）。真の境界（`when`）を足せるなら足し、受け入れは「結べないが他の機構が保証する」ときに限り、保証の中身を理由に書く。
  - 狭めなくてよい理由が別にあるなら（文脈依存ロールがそもそも境界の中にしか立たない、など）、**対象を名指しして受け入れる**。免除の一覧ではなく 1 件ずつ理由が読める形にするのが、この体系の `accept` の流儀である。

    ```yaml
    accept:
      - by: store_manager          # 受け入れる読み取り規則のロール
        filter: company_id         # 受け入れる列（テナントを表す列）
        reason: store_manager は store.manager_id == actor.id で立つロールなので、context(store) の行は必ず境界の中にある
    ```

  - **境界には見張りテストの宣言が要る**（T4。束 ⑲-2a）。宣言を置いたのは、宣言から生成されるのが RLS の**ポリシー名**までだったからである（`..._within_company_id` という名前で `USING (true)` と書いても、宣言も名前の突合も緑になった）。束 ⑳-4a で `USING` 句が生成物になり意味の突合も入ったが、**見張りテストの宣言は残す** —— 突合が言えるのは「生成物どおりのポリシーが当たっている」までで、**そのポリシーで実際に他のテナントの行が返らないか**は行を置いて実行するテストしか言えない。**束 ⑳-4b でその宣言も生成物になった** —— `filters` を持つ表の RLS の挙動テストが生成され、その `it` の名前が T4 が要求する名前そのものであり、data_table の `test_cases` の生成ブロックがその宣言を書く（`legacy/spec-tools/lib/generate/render/code-rls-behaviour-tests.ts`）。したがって**境界を宣言するだけで見張りテストの宣言は揃う**のが通常の姿であり、T4 が鳴るのは**`world` を宣言から作れない表**（執行点の条件が宣言から読めない表。T8 が理由を報告する）だけである —— そのときは手書きの統合テストを宣言して満たす。テスト名は**表名と実行者の欄から機械的に決まり**（`{表名} は実行者の {欄} 以外の行を返さない`）、置き場は保証台帳（`guarantees.md`）の見張りテストでも、その表の data_table の `test_cases` でもよい。
- `fields_hidden[]`（任意）: スコープ内でも隠すフィールド。`field` と `from`（ロールのリスト）。`field` は entity_spec に実在する列で、同じ列は 1 要素にまとめる（V2）。`from` は roles.md に実在し、その access_spec の reads に現れ、`kind: system` でないロール（V11）—— どちらも字面の一致で効く宣言なので、綴りを違えると何も隠さないまま verify が通る形になる。
- `creates[]`（任意）: **新規作成の権限**。`by`（ロール ID）と `when`（任意のガード式）。
  - **`creates` に現れないロールは作成できない**（deny by default）。宣言そのものが無い access_spec は「誰も作れない」を意味する。
  - `self_assign`（任意。`creates[]` と `writes[]` の要素）: **この規則の書き手が、持たない役の根拠の欄を書いてよい理由**(R2)を、**欄 × 役 × 書き手を 1 本ずつ名指して**並べる —— `self_assign: [{ field: {集約}.{欄}, role: {その欄が根拠の役}, by: [{書き手}], reason: {理由} }]`(実行者の属性の欄 `actor.{欄}` が根拠なら `role` を書かない)。受け入れは**名指した欄 × 役 × 書き手にだけ効く**(点検 9 回目 A9-2: 以前は規則単位の 1 文字列で、ある欄のために書いた理由が、後から同じ規則に足した別の役の根拠の欄も黙って受け入れた)。`creates[]` / `writes[]` の規則は `by` が 1 ロールなので要素の `by` は `[{その規則の by}]` だが、**形は遷移と揃えて毎回書く** —— 規則の `by` を後で替えたとき、古い書き手のための理由が新しい書き手を黙って受け入れないように(名指した書き手が規則の `by` にいなければ腐った受け入れとして error。点検 10 回目 A10-1)。1 つの文字列では書けない(読み込みが止める)。所有者を入力で指名する・管理者が責任者を任免する・名前だけの行をアカウントに結ぶ、のように書き手が役を与える / 得ることを意図した規則にだけ書く。**作成者で埋める持ち主の欄**(作成の action_spec の `owner` で明示した欄)も作成の書き手として数える —— 作成者がその欄の役を自分の行に持つので、書き手がその役を持たない(含意しない)なら、その欄 × 役を名指して理由を書く(以前は「必須で入力に無い `ref(実行者の集約)`」を推測で持ち主と見なして数えなかったが、推測が 2 度漏れたので明示と名指しに変えた。点検 8 回目 A8-1・9 回目 A9-1)。ユースケースの「自分として」(`defaults.self`)は数えない。名指したのにその規則がその欄 × 役を書き手に書かせていない要素は、**要素ごとに**腐った受け入れとして error になる。理由は「何を得て、何に及ばないか」を具体的に書く。V20 の `accept` と同じく**その場で名指す**形で、免除の一覧ではない。`deletes[]` には書けない。

    ```yaml
    creates:
      - by: patron
        self_assign:
          - field: loan.owner_id      # loan.create の owner(作成者で埋める欄)
            role: loan_owner
            by: [patron]               # この規則の by(理由が当てはまる書き手)
            reason: 借りた利用者がその貸出の持ち主になる。得るのは自分の貸出の操作だけで、他人の貸出には及ばない
    ```
  - `when` には作成の前提条件を書く（例: `item.state == available` = 在架の蔵書にだけ貸出を作れる）。文法は `guard` と同じで、参照できるのは entity_spec の `context` で解決できるパスに限る（V2 が検査する）。
  - **`delegate`（任意）は「この規則のロールが、input に出した実行者の参照の欄（代理で作る相手・承認者など）に自分以外を入れてよい」欄と理由**で、**欄を 1 本ずつ名指す** —— `delegate: [{ field: {集約}.{欄}, reason: {理由} }]`（理由の空・1 つの文字列・作る集約でない欄は読み込みが止める）。解けるのは名指した欄だけである（点検 10 回目 A10-2: 以前は規則単位の 1 文字列で、承認者の欄のために書いた理由が、後から input に足した別の実行者への参照の欄の縛りも黙って外した）。名指した欄が作成の action_spec の `input` に無い・`ref(実行者の集約)` でない・規則がもともと縛らない（下の system の規則）なら、何も解かない腐った宣言として V18 が error にする。作成の RPC は実行者の集約を指す参照の欄を実行者そのものに縛る（違えば UC403）。input に**無い**欄（持ち主・発行者）を解くのは `by` が `kind: system` のロールの規則だけで、`delegate` では解けない。ロールの種類では解かないので、管理のロール（`claim` のロール）が代理で作るときも `delegate` で欄と理由を名指す（点検 11 回目 A11-3）。input に**ある**欄はそれに加えて、その欄を `delegate` で名指した規則が解く。input にある欄を解く規則が 1 つも無ければ T6 が error にする（[ARCH-SP-BE-0001 §作成の再送と実行者の縛り](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)）。 `self_assign`（R2）とは別の問いである —— `delegate` は「作成の入力で他人を指せるか」、`self_assign` は「役の根拠の欄を書き手が書けるか」。承認者を入力で選ぶ形（申請者が承認者を指名し、承認者のロールの `binding` がその欄を読む）は両方が要る。
  - **`abuse`（未ログインのロールの規則にだけ書ける。R5）は「毎回違う鍵で送られても効く、表への作成の全体の天井」**である: `abuse: { global_ceiling: { max, per }, per_key?: { column, max, per }, at? }`。`global_ceiling`（必須）は期間 `per`（`{n} {minute|hour|day}`）の中に存在してよい行数 `max`（1 以上の整数）で、**数えるのはその表への作成の全部**（未ログインだけではない。実行者を DB が見分けないので、より広く弾く）。`per_key` は同じ鍵（`column`。自集約の欄）の作り直しを数える任意の天井で、`max` は `global_ceiling.max` 以下。`at` は期間を切る日時の欄で、**`auto: true` の `datetime` 欄でなければならない**（NOT NULL・作成時の既定値 now()・作成の入力にも後の編集・遷移にも現れない、を一度に満たす唯一の形。空にできる欄や入力で書ける欄は数えをすり抜けられる）。省略時は `auto: true` の `datetime` 欄がちょうど 1 つあるときだけその欄。`per` は 366 日まで。1 つの access_spec に書けるのは 1 規則だけ（制約トリガは表に 1 本）。値の大きさは製品が決める（検査は有無と書き方だけを見る）。未ログインでない規則に書くと効かない宣言として error。**天井の執行点は生成される**: 生成器が `check_{entity}_rate_limit`（コミット時評価の制約トリガ）を表の DDL に出す —— data_table に同じトリガ・関数を手で宣言しない（二重になるので R5-4 が止める）。トリガは表ごとの advisory lock を取ってから期間の中の行を数え、取引の隔離の水準が repeatable read なら数える前に拒否する。期間はスライドする（行が消されれば枠は空く。累計の受付の上限ではない）。索引は `at` の `[at]` と `per_key` の `[column, at]` が T2 の導出に載る（data_table の `indexes:` に宣言する。`functions[].lookup` は書かない）。
  - **`public`（任意。`writes[]` / `deletes[]` の要素）は「未ログインのロールが更新・削除できる形を意図して開けている」理由**（R5。`self_assign` と同じく**その場で名指す**形）。`by` が未ログインのロールの更新・削除・（state_spec の）遷移は、この理由が無いと error。未ログインのロールでない規則に書いた `public` は腐った受け入れとして error。`creates[]` には書けない（作成は `abuse` で受ける）。
  - **作成後の状態は書かない**。新しいレコードは state_spec の `initial` で生まれる。`creates` が決めるのは「作ってよいか」だけである。
  - **フィールドの制約は書かない**。何を受け取れるかは entity_spec が正であり、生成 zod スキーマ（`{entity}InputSchema`）が実装との唯一の接点になる。
  - **作成時の副作用（`effects`）は v1 では持たない**。`effects` は状態遷移に紐づく宣言であり、作成は遷移ではない。作成通知が必要になったら `creates[].effects` の追加を ADR で判断する。
- `writes[]`（任意）: 状態を変えないフィールド更新の権限。`by` / `fields` / `when`（ガード式）/ `effects`（任意）。
  - **writes に現れないフィールド × ロールは編集不可**（deny by default）。
  - `auto: true` のフィールドと `state(...)` 型のフィールドは **writes の対象にできない**。状態は遷移イベント経由でのみ変わる。
  - **計算で決まる列（action_spec の `computes` の書き先）は writes に並べない**（ロールを問わない。V18 が error にする。2026-10-20 の裁定）。計算で決まる値は入力として受け付けない —— 書くのは `computes` を宣言した操作の RPC（または計画）だけで、書いてよい根拠は `computes` の宣言そのものである。人の行に並べれば人が計算値を直に書ける形、`by: system` の行に並べれば内部実行が編集の RPC で計算値を直に書ける形になる。編集の `computes` の列は、編集の RPC が変更集合（`p_changes`）の外の引数 `p_{列}` で計画から受けて書き、変更集合の書ける列の母集合にもロールの門にも入らない（どちらも `writes` から作るので、並べなければ経路は生まれない）。
  - **規則を守る執行点は data_table が持つ。** 定型の `update` は本文が `writes` から生成されるが、複数行を一括で動かすなど定型に乗らない手書きの `composite` の関数が守る規則は、その関数の `enforces`（`writes` のエンティティ・`by`・見張りテストの id）が名指す（[ADR-0014](../../../../decisions/common/ADR-0014-composite-enforces.md)。A18 が名指しを執行点として数え、T18 が実在を見る）。
  - **`effects`（任意。outbox ジョブの ID のリスト）: 編集の副作用**。`state_spec` の
    `effects[].do` と同じ語彙で、参照先は job_spec の `source: outbox` のジョブ（J1 が
    双方向に見る母集合に `writes[].effects` も含む）。`writes` は状態遷移ではないため
    `state_spec.effects` を宣言できない（対応するドメインイベントが無い）——
    この欄がその代わりの接続点である。
    - **条件（値が変わったときだけ、等）はここに書かない**。`effects` は「この規則の
      `fields` のうち実際に値が変わった列があれば積む候補」を宣言するだけであり、
      **「本当に積むか」の判定は編集 RPC が同一トランザクションで行う**（判断時に
      アプリ側が読んだ値ではなく、書き込み直前の値と比べる——楽観的並行制御の隙間で
      値が動いている可能性があるため）。「宣言列が変わったら積む」は規約の意味論として
      ここに固定し、仕様には条件式を書かせない。
    - 実装は update-fields テンプレート（`_template/update-fields.ts`）が `canWrite` の
      許可から `effects` を集め、遷移 RPC（`apply_*_transition`）と同じ
      `p_effects text[]` + `foreach … insert into jobs` の形で積む（ARCH-BE-0015）。
    - 実物: `patron` の `account_owner` 規則（`display_name` が entity_spec で
      `session: true`）が `effects: [refresh_session_profile]` を宣言している
      （docs/specs/domain/patron/access.md）。
  - **`by: system` の行は「内部実行の入口が編集で書く」という実行の許可である**（2026-10-20 の裁定）。生成する編集の RPC と実行器の編集の表に、ロール配列に内部実行のロールを入れた呼び出しが書ける経路を作る。だから**役の根拠の欄**をこの行に並べると、R2 が入口の追える内部実行の遷移（サインインの決定表・受信 Webhook・発火時刻の供給元つきの走査が起こす、同じ欄を書く `by: system` の遷移）を要求する。**遷移だけが書く列の印として使わない** —— その印は次の `transition_writes` である。
- `transition_writes`（任意。列名のリスト）: **遷移だけが書く列**（人の操作としては現れず、状態遷移の `records_actor` / `records_time` / `clears` が書く列）の、集約単位の宣言。
  - **ロールを持たず、どの経路も作らない。** 編集の RPC の書ける列にも、実行器の編集の表にも入らない。書くのは遷移の RPC だけで、どの遷移がどう書くかはイベントの 3 語が決める。
  - 以前はこの宣言を `writes` の `by: system` の行で近似していた。その行は編集の RPC に「内部実行のロールなら書ける」経路も作っていたので、たとえば同伴の利用者の紐づくアカウント（同伴の利用者本人の役の根拠）を、誰の指示かが仕様から追えないまま書き換えられた。宣言を分けたのはそのためである。
  - V19 が両方向に見る —— 3 語が名指す列は `transition_writes` に載っていなければならず、載せた列は実在し、どれかの遷移が 3 語で書かなければならない（載せたのに誰も書かない列は腐った宣言）。
  - 計算で決まる列（action_spec の `computes` の書き先。別の集約の欄も含む）は**ここにも `writes` にも書かない**（V18。2026-10-20 の裁定）。遷移が計算して書く列であることは `computes` の宣言そのものから導く —— 実行計画の「遷移が自分で決めない列は空を渡す」とウォーカーのオラクルの「遷移が書く自分の列」は、`transition_writes` と、どれかの遷移の `computes` が書く列の和を読む。手で写す印を置かないので、書き忘れも腐った写しも起きない。以前はこの列を `writes` の `by: system` の行で許していたが、その行は内部実行が編集の RPC で確定額を直に書ける経路を作っていた。

  ```yaml
  transition_writes: [handled_by]   # 対応者を書くのは対応開始の遷移だけ(records_actor)
  ```
- `deletes[]`（任意）: **物理削除の権限**。`by`（ロール ID）と `when`（任意のガード式）。`creates` と対称の形で書く。
  - **`deletes` に現れないロールは削除できない**（deny by default）。宣言そのものが無い access_spec は「誰も消せない」を意味する。
  - `when` には削除の前提条件を書く（例: `state == draft` = 下書きのうちだけ消せる）。文法は `guard` と同じで、参照できるのは entity_spec の `context` で解決できるパスに限る（V2 が検査する）。
  - **ここで表せるのは行そのものを消す操作だけである**。「取下げ」「無効化」のように履歴を残す取消しは**状態機械の領分**であり、`deletes` に書いてはならない。同じ「消す」に見える 2 つを分ける基準は「あとから参照する必要があるか」で、必要なら状態、不要なら削除である。
  - **削除時の副作用（`effects`）は v1 では持たない**。`creates` と同じ理由（`effects` は状態遷移に紐づく宣言）であり、必要になったら `deletes[].effects` の追加を ADR で判断する。
  - 削除される行に紐づく子の扱い（連鎖削除・削除禁止）は DSL では表さない。参照整合は DB の外部キー制約が執行し、invariant_spec の `enforced_by` に宣言する。

#### なぜ `creates` がドメイン仕様側にあるのか（判断）

「誰がこのエンティティを作れるか」は**業務の意味**であり、UI や API の都合ではない。同じ問いを
`action_spec`（Server Action 仕様）側に書くと、次の 2 つが同時に起きる。

- **正が割れる**。「読める / 編集できる」は access_spec、「作れる」だけ action_spec、という分割になり、
  権限の全体像がどこにも無くなる（PRIN-0007）。
- **免除が黙って起きる**。`action_spec` は「公開の判断」を書く薄い層なので、Server Action を作らない限り
  作成権限の宣言も存在しない。「宣言が無い = 禁止」を検証器が言えなくなる。

したがって `creates` は `writes` と同じ流儀（`by` + 任意の `when`）で access_spec に置き、
`action_spec` 側は「その作成操作を境界に公開するか」だけを `handles: {entity}.create` で宣言する
（[action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md) の予約 ID）。

**`deletes` も同じ理由でここにある。** 「誰がこの行を消してよいか」は業務の意味であり、
`action_spec` に書けば権限の全体像が割れ、Server Action を作らない限り宣言も無い状態になる。
`creates` と `deletes` は「対象を生む / 対象を消す」という対の操作なので、宣言の形も対称に保つ。

#### `deletes`（物理削除）と状態機械（論理削除）の線引き

| やりたいこと | 書く場所 | 例 |
|-------------|---------|---|
| 行を消して、以後どこからも参照しない | access_spec の `deletes` | 下書き貸出の取り消し、予約一覧からの予約の除去 |
| 「もう有効でない」ことを記録して残す | state_spec の遷移 | 貸出の取下げ（`withdraw`）、蔵書の中止（`cancel`） |

論理削除（`deleted_at` 列や `deleted` 状態）を `deletes` で表現してはならない。それは状態であり、
状態機械が全域性・到達可能性の検証対象として扱う。逆に、履歴を残す必要がない操作に状態を足すと、
状態機械が「実質使われない終端状態」で膨らみ、V3 の全域性チェックが無意味な組み合わせで埋まる。

### invariant_spec（{aggregate}/invariants.md）

```yaml
doc_type: invariant_spec
invariants:
  - id: INV-LOAN-001
    statement: 同じ蔵書について、アクティブな(取下げ・却下でない)貸出は同時に1件しか存在しない
    entities: [loan]
    formal:
      type: uniqueness
      keys: [item_id]
      where: state not in [withdrawn, rejected]
    enforced_by:
      - kind: db_constraint      # Postgresの部分ユニークインデックス
        ref: loans_active_item_unique
      - kind: guard              # 提出時のアプリ側チェック(UX用の早期エラー)
        ref: loan.submit
```

- `invariants[].id`（必須）: `INV-{ENTITY}-{NNN}` 形式。
- `statement`（必須）: 日本語の平文。人間のレビュー対象。
- `entities`（必須）: 関与するエンティティ。集約をまたぐ不変条件は主たる集約側に置き、ここで関与を宣言する。
- `involves`（任意）: この不変条件が**数えている・参照している別集約**の一覧（例: `involves: [note, loan_companion]`）。`entities` が「関与するエンティティ全般」を指す緩い宣言なのに対し、`involves` は**この不変条件が住む集約以外**を狭く名指しする。
  - **これを書かないと、その別集約の create / delete に義務が配られない。** action-spec-writing.md の A7（意味的カバレッジ）は不変条件の義務を「その不変条件が住む集約」の遷移にしか配れない（`enforced_by: guard` が指せるのは同じ集約のイベントだけのため）。件数を数える不変条件（`cardinality` や、集計のため `formal` を省略した DSL 外の不変条件）が**子集約の作成・削除**で破れる場合、`involves` を書かない限り「子集約の delete がその不変条件を破りうる」という事実が A7 にも人間にも見えないまま緑になる（実例: INV-LOAN-008「提出済みの貸出は同伴の利用者 ≥ 1」は `note` / `loan_companion` を数えるが、`involves` が無いと `note.delete` / `loan_companion.delete` にテスト義務が配られず、削除操作が状態を見ない穴が放置される）。
  - `involves` を書くと、A7 はそこに挙げた集約の **create / delete（`access_spec` の `creates` / `deletes`）と、その集約の全遷移**に `covers: invariant` の義務を配る。あわせて、この不変条件が住む集約自身の「守られる状態へ入る遷移」に義務を配りたい場合は、従来どおり `enforced_by` に `kind: guard, ref: {その遷移}` を足す（`involves` とは独立した仕組みである）。
  - `involves` に書けるのは**実在する集約名**だけで、V10 が接地を検査する。`entities` も同じである（A7 の義務の配り先・計画の世界の行を `entities` で引くので、綴り違いの集約名は義務が誰にも配られないまま緑になる）。
- `formal.type` は**閉じた集合**（v1）:
  - `check`: **1 行を起点に `context` で辿れる範囲**で常に成り立つ条件。`expr` にガード式で書き、パスの解決規則もガード式と同じである（自エンティティのフィールド・`context` で辿れるエンティティのフィールド・予約語）。
    - **同じ行の中だけで閉じるなら** Postgres の CHECK 制約と zod の refine に機械的に対応する（例: `item.loan_deadline < item.starts_at`）。
      **その CHECK は生成物である** —— data_table の `checks[]` に制約の名前を置き、`rule` を書かずに `invariant` だけを宣言すれば、この式が表の DDL に反映される（写像は `lib/sql/check-expression.ts`、規約は [ARCH-SP-BE-0001 §テーブル仕様](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)、設計の経緯は非公開の開発記録）。反映できない形（別の集約の欄・`now`・集合・日時のリテラル）は名前だけの宣言のままで、**反映できない理由は T16 が毎回報告する**。
    - **`context` の先を参照するなら**（例: `loan.item_id == item_part.item_id`）1 行の中だけでは判定できないので、執行点はトリガになる。`enforced_by` がどちらかを宣言する。「別集約の列との一致」はこの形であり、**新しい `formal.type` は要らない**（2 つの集約の一致で、`context` の 1 段の参照の欄が required なら、**両端の表のコミット時評価の制約トリガの本文が生成物になる** —— 両端に `invariant` を宣言するトリガが要る。規約は [ARCH-SP-BE-0001 §条件を課すトリガの本文](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)）（相手に届いていなければ V10 が「`context` に {相手} がありません」と名指しする — 届かせるには `entity_spec` の `context` にその相手を 1 行足す）。
    - `expr` の文法は `clause ( ("and"|"or") clause )*` なので、**等式を 2 本以上並べてよい**（例: 「会社も店舗も伝票と一致する」）。
    - **「その欄が空かどうか」を問えるのはここだけである**（`is null` / `is not null`。束 ㉒）。`where` / `if` / `then` を含む `formal` の式全部で書けるが、`guard` / `when` / `binding` / query_spec の `filters` では書けない（§ガード式の文法）。**同値（「状態が保管であることと、保管日時を持つことは同値」）は 2 本の含意に割って `or` 1 つで書く** —— `and` は `or` より強く結合するので括弧は要らない。実例は `INV-LOAN-COMPANION-011` / `INV-PURCHASE-REQUEST-001` / `INV-ITEM-CHECK-002`。
    - **集計（合計・件数など複数レコードの計算）は書けない** — count は cardinality という固定テンプレで扱い、それ以外の集計は formal 省略 + application 執行で扱う。
  - `uniqueness`: `keys` と任意の `where` によるユニーク制約。**鍵の一致までしか表さない** — 「期間が重なってはいけない」は `exclusion` の領分である。
  - **鍵はテナントの範囲を含める**（V26）。`uniqueness` / `exclusion` / `cardinality` の `keys` が境界の列も境界へ届く参照の欄も持たず、鍵の欄を人の入力で書けるなら error（一意の索引は RLS の外で効くので、他のテナントの値の存在が拒否で分かり、先に登録して登録を止められる）。鍵を人の入力で書けるかには、作成の入力・編集の `fields`・遷移の入力に加えて、その操作の `computes` も数える（計算の材料で分けない）。`invariant` を持たない `unique: true` の索引の `on` も同じ規則で見る。全体で一意が正しい鍵は、その不変条件の `formal.global_key`（不変条件の無い索引は行の `global_key`）に `{ keys: [受け入れる鍵の列], reason: 理由 }` で受け入れる（その鍵 1 本にだけ効く。何も受け入れていない・`keys` が今の鍵と違う `global_key` は error）。内部実行だけが書く欄、境界の根の表の鍵、entity_spec を持たない内部表の索引は対象外である。
  - **隠し列を鍵にしない**（V26）。鍵の欄が `fields_hidden` で隠されていて、隠した相手がその欄を書けるなら error（候補の値を書くと、拒否で値の有無が分かる）。受け入れは無い。
  - **`uniqueness` の鍵は実際の一意の索引と一致させる**（T23）。`enforced_by` の `db_constraint` が指す索引は `unique: true`・`on` の列の集合が `keys` と同じ・`where` が `formal.where` と同じ条件で、索引の `invariant` が不変条件を指し返す。`where` の比べ方は ARCH-SP-BE-0001 §インデックスに書いてある。
  - T23 は `where` を閉じた原子の連言としてしか読まない。読めない形は error で、受け入れる手段はない。複雑な部分索引が要るなら不変条件を分ける。
  - `exclusion`: **鍵が一致する行どうしで期間が重なってはいけない**（排他）。`keys`（一致していなければ重なってよい鍵。例 `[room_id]`）+ `range`（期間の `[開始, 終了]` の 2 フィールド）+ 任意の `where` で書く。実体は Postgres の排他制約（`exclude using gist`）であり、data_table の `exclusions` と `keys` / `range` まで突き合わされる（T5）。
    - **端の扱いは体系が半開区間 `[開始, 終了)` に固定しており、宣言では選べない**。「前の予約の終了時刻 = 次の予約の開始時刻」は重なりにならない側である。宣言ごとに端が違うと `statement` の日本語と執行が静かにずれるので、選択肢そのものを持たせない。
    - `range` の 2 つは**時間軸の型**（`datetime` / `date`）でなければならない（V10）。文字列や整数の 2 列は範囲型に畳めず、執行点に落ちない。
    - **`uniqueness` で代用しない。** `keys: [room_id, starts_at, ends_at]` は「開始も終了も完全に一致する 2 行」しか止めず、宣言（鍵の一致）と執行（重なり）が食い違ったまま緑になる。これが束 ⑱ rooms で実測された形であり、`exclusion` を買った理由である。
  - `cardinality`: 親に対する子の数の上限。`max` はリテラルまたは**親エンティティのフィールド参照**（例: `max: item.copies` で同時に貸せる冊数の上限を表現）。**`keys` に複数フィールドを並べた複合キー（group-by）を書いてよい**（例: 「イベント × 性別ごとに予約は最大 5」= `keys: [event_id, gender], max: 5`）。
  - `state_dependency`: A.state が X ならば関連する B の state は Y に限る。
- **`where` 句では関連エンティティの状態を参照してよい**（例: 「予約中かつ貸出前の予約は 1 利用者 1 件」）。ただしこの場合 DB の部分ユニークインデックスだけでは守れないため、`enforced_by` は `trigger` または `application` になる。その事実を宣言で明示すること。
- **`keys` と `where` / `if` / `then` / `expr` の参照はすべて実在が検査される**（V10）。`keys` に書けるのは**この不変条件が属する集約のエンティティの裸のフィールド名**だけであり、式のパス解決はガード式と同じ規則（自エンティティのフィールド・`context` で辿れるエンティティのフィールド・予約語）に従う。綴り違いの `where` は「制約が誰にも掛からないまま緑」を生むため、ここで落とす。
- **不変条件の式のパスは、その不変条件が「属する集約」を起点に解決される**。したがって**集約をまたぐ条件（`state_dependency` 等）は、両辺に届く側の集約に置く** — 1:N の関係なら**子**の側である（子は親への外部キーを持つので `context` で親に届くが、親から子へは前方参照で届かない）。親側に置くと「相手のフィールドが解決できない」というエラーになる。これは検査の不備ではなく、**その集約からはその条件を検査できない**という事実の表明である。上の INV-HOLD-003（`hold` に置き、`item` と `loan` を参照する）がこの形。
- `enforced_by[]`（必須・1 つ以上）: 執行点の宣言。`kind` は `db_constraint` / `trigger` / `guard` / `application`、`ref` は執行点の識別子（インデックス名・イベント ID・関数名）。
  - **`kind: guard` の執行点が不変条件に「触れてすらいない」場合は警告が出る**（V10）。`formal` が `check` / `state_dependency` の不変条件について、`ref` が指すイベントのガード式に、その不変条件の式が参照するフィールドが 1 つも現れなければ警告する。
  - **これは下限の検査であり、「そのガードが不変条件を本当に守っているか」は見ない**（含意の判定は列挙ベース検証の範囲外）。関与フィールドが 1 つでも現れれば、条件の向きが逆でも比較する値が違っても通る。**執行の宣言は依然として人間の善意に依存する**。
  - `uniqueness` / `cardinality` は**この検査の対象外**とする。複数行にまたがる集計はガード式で原理的に表せず、そこでの `kind: guard` は「アプリ側の早期チェックが走る遷移」を指す正当な宣言だからである（上の INV-LOAN-001 の例がその形）。
  - **題材の製品では現在この警告は 0 件である**。`kind: guard` を持つ不変条件が `uniqueness` / `cardinality` しか無く、対象が存在しないためであって、検査が効いていないのではない。
  - **複数の手順で満たす不変条件（ある欄は作成で決まり、別の欄は遷移で決まる、のように 1 文では満たせないもの）は、行単位の CHECK ではなくコミット時評価（`deferrable initially deferred` な制約トリガ）で執行する。**不変条件は「コミットされた状態」について成り立つものであり、保存点（[ADR-0011](../../../../decisions/common/ADR-0011-usecase-layer-two-origins.md) §4 = 1 保存が 1 トランザクション）の内側の途中状態には課さない。**判定の目安**は「`formal` の式が参照する欄が、同じ集約の『作成入力で決まる欄』と『遷移で変わる状態』にまたがっているか」である。またがっていれば行 CHECK では原理的に満たせない（作成の瞬間に必ず落ちるので、条件を満たすには保存を分けてもう 1 手を人に強制することになる）。**変えるのは執行の時点だけで、`statement` も `formal` も変えない** —— これは[ADR-0011](../../../../decisions/common/ADR-0011-usecase-layer-two-origins.md) §3 の 2 段目（実装の形を変える）であり、3 段目（制約を緩める）ではない。単発の書き込み（1 文 = 1 トランザクション）では今までどおり同じ時点で拒否される。宣言は `kind: trigger` + `ref: {トリガ関数名}` になり、data_table 側の書き方は[ARCH-SP-BE-0001 §テーブル仕様](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)にある（実例: INV-LOAN-COMPANION-003「貸出料金の負担者はアカウントに紐づいている」—— 負担フラグは作成入力・紐付けは遷移）。
- **DB の執行点の名前は 1 つの不変条件だけが宣言する**（V10）。`db_constraint` / `trigger` の `ref` は制約名・トリガ関数名であり、書き込み側は**例外の本文からその名前を拾って** `invariant_violated` に写す（写像表は生成物 `constraint-invariants.ts`）。したがって同じ名前を 2 つの不変条件が宣言すると、DB が拒否した理由を人に返せない。**守る事実ごとに執行点を分ける** —— 写しの列が 2 本あれば、同じ 1 回の代入でもトリガの宣言は 2 本要る（実測: 束 ⑱ の題材 D。それまではこの前提を生成器が例外で守っており、`verify` は緑のまま `generate` がスタックトレースで落ちていた）。
- **`enforced_by: application` の ref は「呼ばれている」ことまで見る**（V10。束 ⑰-3b）。export されているだけでは執行点ではない —— **呼ぶ側が消えても、純関数とその単体テストは残る**。実際、操作の実装が仕様からの生成物になった束で、INV-PURCHASE-REQUEST-002（購入希望のスパム防止の天井）と INV-PATRON-007（司書の下限）の呼び出し口が同時に失われ、どちらの天井も効かない状態が全検査緑のまま通っていた。走査はコメントと文字列を落としてから数えるので、doc コメントの中で名前を挙げているだけでは呼び出し口にならない。テスト（`__tests__` / `*.test.ts`）と生成物も走査の対象外である。
  - **直し方は「呼ぶ」か「執行点を移す」かの 2 つ**。集計を数える判定なら、SQL で数えられるので DB のコミット時評価（`deferrable` な制約トリガ）に寄せて `kind: trigger` を宣言する（[ADR-0012](../../../../decisions/common/ADR-0012-db-as-authority.md) §1）。
- **集計を含む制約（DSL の守備範囲外）は `formal` を省略してよい**。その場合 `statement` が定義のすべてであり、`enforced_by` に**実体のある執行**（`application` / `trigger` / `db_constraint` のいずれか）の宣言が必須になる（V10 が検証）。`guard` だけでは足りない —— ガードはその遷移を通る書き込みしか守らず、直接 UPDATE で破れるためである。`formal` があるのに `enforced_by` が無い・その逆の書き漏れは、いずれも V10 が検出する。
  - **トリガが名指す不変条件で `formal` を省略するなら、書けない理由を `formal_outside` に 1 文で書く**(点検 22 回目 C22-3。例: 遷移の時点の条件・件数の下限・更新の前後の単調性・3 段の参照)。理由を書いた不変条件だけが、照らせない警告(T17)と実在しない執行点の警告(T16)で拡張候補の宿題(`X-trigger-condition-words` / `X-trigger-bodies`)に数えられ、警告は不変条件の名前と理由つきで毎回出る。書かなければ「書けるのに書いていない」と区別できないので未分類(`--fail-on-unclassified` で赤)になる。`formal` と同時には書けない。
  - 検証器は「**宣言があること**」と「**ref の実在**」を機械チェックし、さらに宣言から**テスト義務**（このインデックスに対する統合テスト等）を生成する。「不変条件を書いたのに何も守っていない」を防ぐ。

### ガード式の文法

`guard` / `when`（`creates` / `writes` / `deletes` / **`reads`**）/ `binding` / `where` に書ける式は次の文法に限る。

> **名前が複数あるのは意図的である(2026-08-12 決定)**。同一の式言語に、置かれる文脈で別のフィールド名を与えている — `guard` は**遷移の発火条件**(一瞬の出来事に付く。ステートチャート/UML の標準用語)、`when` は**常設の許可規則の適用条件**(`by X when Y` が文として読める)。式の文法・評価器・検証は完全に共通であり、名前の違いは「揺れ」ではなく判定文脈の区別を運んでいる。どちらか一方への統一はしない。

```text
expr    := clause ( ("and" | "or") clause )*
clause  := [ "not" ] atom
atom    := path op ( literal | path )
         | path [ "not" ] "in" "[" literal ("," literal)* "]"
         | path "contains" path
         | path "is" [ "not" ] "null"  # 不変条件の formal にだけ書ける（下記）
path    := name ( "." name )*          # 例: item.state, actor.id
op      := "==" | "!=" | "<" | "<=" | ">" | ">="
literal := number | ISO日時 | 識別子   # 裸トークン。ドットを含む/予約語(actor,now)ならパスと解釈
```

- **予約語は `and` / `or` / `not` / `in` / `contains` / `is` / `null` の 7 語**である。欄名・enum 値・状態 ID にこの綴りは使えない。

- **比較の右辺でフィールドを参照するときは必ず `entity.field` のドット付き完全形で書く**(例: `now >= item.open_at`)。ドット無しの裸トークン(`x == n` の `n`)は enum 値等のリテラルと解釈され、フィールド参照にはならない(予約語 `actor` / `now` のみ例外)。
- 演算子の優先順位は **`not` > `and` > `or`**(いずれも左結合)。例: `a and b or c` は `(a and b) or c` と解釈される。括弧が書けないため、`or` を含む複雑な条件は優先順位に依存せず読める形(イベント分割等)に書き換えることを推奨する。
- 参照できる `path` は「**entity_spec の `context` を辿って解決できるエンティティのフィールド**」と `actor` / `now` のみ。
  - **`context` は 2 段まで辿れる**（束 ⑲-2a）。`booking.room.department.admin_id` は `booking → room → department` の 2 ホップであり、各段は「手前のエンティティの `context` に宣言があり、その参照パスが `ref(次のエンティティ)` の欄である」ことを要求する。3 段目はどの生成物にも写せないためエラーになる（中継のエンティティを起点にする形へ書き換える）。
  - **経路は書き手ではなく解決器が探す。** `department.admin_id` のように相手のエンティティと欄だけを書けば、起点から 2 段以内に届く経路が自動で選ばれる —— 文脈依存ロールの `binding` は 1 度しか書かないのに、使う集約ごとに段数が違う（部屋から見れば 1 段・予約から見れば 2 段）ためである。**同じ相手へ 2 通りの経路があるときは、仕組みは選ばずに断る**（V2 / V11 がエラー。束 ⑲-2a）—— 中継が違えば指す行も違うので、宣言順で先に来た方を黙って採ると「意図と別の行を指す宣言」が警告なしに通る（レビューが `fixture` で実測した）。どちらを通るかは、起点の `context` に相手への参照パスを直接足すか、明示の連鎖（`{起点}.{中継}.{相手}.{欄}`）で書き手が決める。
  - 2 段まで開く前は、木の各段に**写しの列**（`booking.department_id`）とそれを埋めるトリガと一致を守る不変条件が要った —— 階層の深さぶんの非正規化である（束 ⑱ の実測）。
- **`actor` の後ろに書けるのは `id` と、`session: true` を宣言した欄だけ**（V2 が閉じている）。
  - `actor.id` は実行者の**同一性**。`actor.{欄}` は実行者の**属性**であり、セッション（`app_metadata.profile`）に載る欄に限る —— 載らない値では保存点の `permit` の先読みが DB を読まずに引けない。**DB の判定（RLS の境界・RPC の `when`）はセッションではなく実行者自身の行を読む**（写しが古くても DB が正しく落とす）。`actor.role` や `actor.is_staff` のような宣言の無いパスはエラーにする。
  - これは `claim`（`{entity}.{boolean の欄}` を根拠にロールを立てる）の**一般化**である（束 ⑲-2a）。`claim` は「その欄が true ならこのロール」という 1 つの用途に閉じていたが、同じ機構で「実行者の会社」「実行者の拠点」のような属性を式から参照できる。
  - **値はセッションから供給される。** 保存点・単発の操作の実行計画では `actor.{欄}` は `{ kind: 'session', field }` に落ち、実行器はログインセッションの profile を読む（DB は読まない。`claim` と同じ経路）。**実行者の行を読む形には畳まない** —— 対象の集約が実行者の集約でもあるとき、外の行を読む供給元は「入力が指した対象の行」に解決されるため、`{対象}.{列} == actor.{列}` が黙って恒真になる（束 ⑲-2a の実測）。
  - 主な使い道は**テナントの境界**である。可視性は `access_spec` の `reads[].filters`、書き込みは `creates` / `writes` / `deletes` の `when`（例: `when: "store.company_id == actor.company_id"`）に書く。**文脈依存ロールの `binding` と `reads[].when` では使えない**（V11 / V2 がエラーにする。可視性の実行者の側は `filters` の 1 つの口に閉じる）—— スコープ条件の生成と保存点の `permit` はどちらも「その列を実行者の id と比べる」形に落ちており、別の値と比べる binding は写せない。ロールで分けたいなら `by` に書く。
- **比較の右辺のリテラルは、左辺の値域と突き合わされる**（V2）。左辺が state / enum / boolean のように値域が閉じているフィールドなら、右辺は宣言済みの値でなければならない（`state == publik` はエラー）。綴り違いは**式としても型としても妥当**なので、この照合が無いと「永久に成立しない条件」「その節だけが死んだ式」が緑のまま残る。恒偽判定（V9）は式全体が成立し得ないときしか鳴らないので、代わりにはならない。
- **関数呼び出し・算術・ネストした括弧は書けない**（v1）。
- 比較可能なのは enum / state / boolean / ref と、リテラルとの数値比較のみ。これにより変数のドメインがすべて有限または区間になり、**充足可能性・矛盾検出が決定可能**になる。
  - **判定器は既製品（Z3）である**（束 ⑳-5c）。仕組み側が持つのは「ガード式 + 変数ドメイン → SMT-LIB」の**写像だけ**（`legacy/spec-tools/lib/guard/smt.ts`）であり、探索も推論も書かない（2026-09-11 の原則「推論・探索の道具は既製品を採り、写像だけを自作する」）。写像表（finite は値の綴り → 整数・ordered は `Real`（整数の欄は `is_int`）・opaque は相異なるリテラルの `distinct`・素直に写せない比較は自由な `Bool` に緩める）は `smt.ts` の冒頭が正である。
  - **自作の列挙器（`lib/guard/satisfiability.ts`）は先読みとして残る。** 同期で呼べる場所（V8 の共存判定・UX の照合・画面の入場判定・SQL の畳み込み）はそれを使い、**V9 / V10 の判定は Z3 を正とする**。2 つが食い違わないことは fast-check の差分テスト（`legacy/spec-tools/__tests__/unit/guard/z3-differential.test.ts`）が実測する —— 同じ 1 つの宣言に対して場所によって違う答えが出ると、どちらが仕様なのかが誰にも言えなくなる。
  - **判定できなかった式は黙って通さない。** ただし `unknown` には 2 つの意味があり、**報告の仕方が違う**（束 ⑳-5c-b）。**時間内に答えられなかった**（式が難しい）なら V9 / V10 が warning で報告する。**判定器そのものが動かなかった**（起動できない・写像が吐いた SMT-LIB を拒まれた ＝ 写像のバグ）なら **error** である —— 後者を前者と見分けのつかない形で出すと診断が丸ごと嘘になり、**Z3 が 1 件も解けない状態でも `verify` が exit 0 で終わる**（warning 止まりだから）。文面と severity の出し分けは `legacy/spec-tools/lib/verify/satisfiability-findings.ts` の 1 か所が正であり、V9 と V10 が共有する。列挙器が持つ 3 つの上限（finite の直積・自由な原子の数・その積）は判定には効かない。
- **予約語 `now`**: 現在時刻を表す。**全イベントのガードで使ってよい**（ユーザー操作の時間窓の表現を可能にするため。例: 開始 10 分前から入室可）。検証器は時刻を**順序付き不透明値**として扱い、区間の整合性まで検証する（決定可能性は維持される）。生成される RPC は**行ロックを取った後に 1 度だけ**時刻（`clock_timestamp()`）を取り、`now` のガードと `records_time` の両方がその 1 つの値を使う（`now()` = トランザクション開始時刻だと、ロック待ちの間に過ぎた締切を見逃す）。
- **`now` は単独でしか書けない**（`now` の 1 形。V2 が閉じている）。`now` は 1 つの値であってフィールドを持つオブジェクトではないので、`now.date` や `now.year` はどの宣言にも接地しない。時刻の一部（日付だけ・年だけ）で条件を書きたくなったら、その値を持つフィールドをエンティティ側に宣言して `{entity}.{field}` で参照する。
- 時間駆動の進行（締切が来たら自動で closed 等）は新構文を作らず、`by: [system]` の通常イベント + Cron 仕様側の `emits:` で表現する（ARCH-SP-0002）。
- **「不明」は不成立である ―― TS でも SQL でも同じ**（束 ⑳-1）。値が env に無い・型が仕様と食い違う・`contains` が未解決のとき、評価器は第 3 の値 `unknown` を返し（`and` / `or` / `not` は Kleene の規則で伝播する）、**最後に「不明 → 不成立」で畳む**。同じ式を DB でも評価する（RPC 本文・RLS）ので、SQL 側もこの意味でなければならない。SQL の NULL 論理は同じ Kleene 論理なので、**原子はそのまま訳し、式全体を 1 回だけ `coalesce(…, false)` で閉じる**のが正しい写しになる。
  - **原子ごとに `coalesce` してはならない**。`not （原子）` で原子が不明のとき、TS は不成立（偽）だが、原子を先に偽へ潰すと `not false` = 真になり、**DB だけが通す**。差分テスト（`app/src/infrastructure/__tests__/schema/guard-sql-parity.test.ts`）が `not doc.state == draft` + 全欄 NULL という反例で実測した（規約とテストは同じ字面を使う。反例は「どれでもいい例」ではなく注釈である）。
  - **文字列の順序比較は照合順序に依る**。TS は JS の文字列比較（コード単位順）で決めるので、DB 既定の照合順序（大小文字・記号を無視する）のままでは食い違う。**`collate "C"` を付けるのは翻訳器の仕事である**（束 ⑳-1b）—— 呼び側の作法にすると与え忘れを誰も見ないまま DB だけが別の判定を下すので、呼び側は列の**種別**（boolean / number / datetime / text / uuid・ref）だけを宣言し、text の順序比較に照合順序を固定するのは `lib/sql/guard-to-sql.ts` が機械的に行う。
  - **日時は ISO 8601 の正規形に畳んでから比べる**。TS の評価器は datetime を文字列として比べるので、`2026-01-01T00:00:00Z` と `2026-01-01T00:00:00.000Z` が字句順では別物になる（19 文字目で `.` < `Z`）。評価器は両辺が ISO 8601 として読めるとき **`…T…:…:….sssZ` の正規形に正規化してから**比べ、DB 側は timestamptz の時刻順で比べる —— どちらも「書式に依らない時刻の順序」になる（[datetime.md](../../../backend/system/standards/conventions/datetime.md)）。
- **「空かどうか」（`is null` / `is not null`）は不変条件の `formal` にだけ書ける**（束 ㉒。設計の経緯は非公開の開発記録）。`guard` / `creates.when` / `writes.when` / `deletes.when` / **`reads[].when`** / ロールの `binding` / query_spec の `filters` / 画面の `precondition` には書けない —— 書くと**パースの段で落ちる**（その場所を検査している V2 / S5 / Q4 が error で報告し、対処に「不変条件へ移す」を書く）。`access_spec` の `reads[].filters` は**そもそも式の置き場ではない**（`{対象の列}: actor.{欄}` の写像であって AST を持たない）ので、落ちるのではなく書く場所が無い。
  - **比較の意味は 1 文字も変わらない。** 値が無ければ比較は今までどおり「不明」→ 不成立であり、**新しい原子だけが全域な真偽値**である（`x is null` は決して不明にならない）。3 値論理は作り直していない。
  - **`is not null` は `is null` の否定として読まれる。** 2 つの綴りが同じ原子になるので、`x is null and x is not null` は恒偽・`x is null or x is not null` は恒真として判定器が読む。**その欄が空である割り当てでは、その欄に触れる比較原子はすべて偽**になる（「値が無ければ比較は不明 → 不成立」の言い換え）。自作の列挙器と Z3 の写像は**同じ縛り**を張り、食い違わないことは差分テストが実測する。
  - **書けるのは空になりうる欄だけ**である。`required: true` / `auto: true` / `state(...)` の欄は行に必ず値があるので、`is null` は決して成立せず `is not null` は常に成立する —— **V10 が error にする**。**この誤りを捕るのは V10 だけである**: `kind: check` の充足性判定は「空かどうか」を欄ごとの**自由な真偽値**として扱い `required` を 1 度も見ないので、必須の欄への `is null` も `satisfiable` のまま通る（恒偽と読めるのは `x is null and x == v` のように同じ式の中で矛盾しているときだけ）。判定は V19（`clears` が空にできる列か）と**同じ 1 本**（`canBeEmpty` = `required` でも `auto` でも `state(...)` でもない）を使う。
  - **括弧は無いままでよい。** 同値（`A ⟺ B`）は 2 本の含意に割れば `or` 1 つで書け、`and` は `or` より強く結合するので 1 本の式に収まる（実例: `INV-LOAN-COMPANION-011`）。
  - **`guard` に開かない理由**は実装の非対称にある。`formal` の式は TS の評価器に反映されないが、`guard` の式は反映される —— 評価器の `lookup` は「列が NULL」と「env の組み立て漏れ」を同じ `unknown` に畳んでおり、`is null` を正しく評価するにはその区別を作り直すことになる。**落ちる検査を設計できない拡張は、書けるようになるだけで守られない**。
- **その欄をその演算子で比べられるか（型一致）も見る**（V2。束 ⑳-1b）。文法としては妥当でも、**TS の評価器が常に「不明」を返す = その条件が永久に成立しない**組み合わせがある。書いた人の意図が実現しないので error にする。
  - `boolean` の欄は `==` / `!=` だけ。`doc.flag in [true]` も `doc.flag > false` も TS は常に不明（不成立）にするが、SQL に素直に写すと**DB だけが通す**（Postgres は `'true'` を boolean に解決し、`false < true` の順序も持つ）。
  - `uuid` / `ref(...)` の欄は順序で比べられない（同一性しか持たない値であり、SQL にも照合順序が無い）。
  - 左辺の種別と右辺のリテラル（またはパス）の種別が食い違う比較も error。`loan.count == draft` は TS では不明（不成立）だが、SQL では `loan.count = 'draft'` となり**実行時に 22P02 で落ちる**。日時の欄と比べてよいのは ISO 8601 として読める字面だけである。
  - 同じ組み合わせは SQL 翻訳器も断る（`ok: false` の `rejected`）。検査器 1 つに寄りかからない。

### 検証チェック（V1〜V13・V16〜V26）

検証器（verify）は次のチェックを実行する。仕様はこれらを**すべて通過することを前提に**書く。

| # | チェック | 内容 | 出力例 |
|---|---------|------|--------|
| V1 | スキーマ適合 | 各 doc_type の YAML 構造・型・必須フィールド。**access_spec・entity_spec(トップレベルと fields[]の要素の両方)・invariant_spec(invariants[]の要素)は書けるキーが閉じている**（スキーマに無いキー・綴り違いはエラーにする。読まれないキーは「書いたのに効いていない」宣言になるため） | `state_spec loan: initial がありません` / `reads の要素 に wehn は書けません` / `fields の要素 に max_lenght は書けません` |
| V2 | 参照整合 | `state(machine)` / `ref(entity)` / `context` の値（前方参照であること）/ guard・`when`（creates / writes / deletes）・binding 内 path / `enforced_by.ref` の実在。パスは **`context` を 2 段まで辿って**解決する（各段は `ref(次のエンティティ)` の欄でなければならない。**同じ相手へ 2 通りの経路があれば断る** — 中継が違えば指す行も違うので、仕組みは良い方を選ばない）。**予約語 `actor` の後ろは `id` と `session: true` の欄だけ・`now` の後ろは何も書けない**（`actor.role` / `now.date` のような接地しないパスはエラーにする）。**`reads[].filters`** の左辺の列が実在し、右辺の `actor.{欄}` が `session: true` であること。**`reads[].when`** は同じ式言語として同じ検査に通り、加えて 2 点を見る —— **実行者（`actor.*`）が現れないこと**（実行者の属性で狭めるのは `filters` の役であり、2 つの口で書けると宣言の正が 2 つになる）と、**自集約の状態の欄を `==` / `!=` / `in` で比べていること**（「見えない行」を宣言から決められる形でなければ、挙動テストが丸ごと消える）。**比較の右辺のリテラル**も、左辺の値域が閉じている（state / enum / boolean）なら宣言済みの値であること。**比較の型一致**（boolean の欄への `in` / 順序比較・uuid / ref への順序比較・左右で種別が食い違う比較は、TS の評価器が常に「不明」＝不成立にするので error） 。**access_spec の列を名指す口** —— `fields_hidden[].field`（実在し、同じ列を 2 回宣言しない。綴り違いのマスクはどの列にも掛からず、隠したつもりの列が surface に素で出る）/ `writes[].fields`（実在し、状態の列・`auto: true` の列でない。状態の列を並べると遷移を通らずに状態を書ける編集の口が開く）/ `accept[].filter`（実在し、`by` が reads に現れる）/ access_spec の `entity`（同じ集約の entity_spec の名前と一致する） | `loan.submit の guard が参照する item.state: 状態機械 item が未定義` / `store の reads(by: staff_member)の filters が actor.company_id を参照していますが、その欄は session: true を宣言していません` / `patron の fields_hidden が隠す emial は、entity_spec patron の列にありません` |
| V3 | **全域性（遷移）** | 全状態 × 全イベントが定義済みか理由付き禁止に分類される | `loan: 状態 accepted × イベント revise が未定義（otherwise_forbidden もなし）` |
| V4 | 全域性（読み取り） | 全ロール × 全エンティティの reads が明示されている | `loan: ロール patron の読み取りスコープが未定義` |
| V5 | 到達可能性 | initial から全状態への経路があるか。**見るのは「ガードを無視した到達性」**（遷移グラフ `from → to` の BFS）であり、ガード式は 1 つも読まない。**「到達可能」には 3 段ある** ——「宣言の網羅」（V3 / V4）/「ガードを無視した到達性」（**V5 = ここ**）/「実行列としての到達性」（ガードを満たしながら複数集約の状態が噛み合う列が存在するか。**V21 が有界（K 手）で見る**）。したがって V5 が緑でも「その状態に実際に至れる」は言えない（言えるのは「辺を辿っても届かない状態は無い」までである。設計の経緯は非公開の開発記録） | `状態 rejected へ到達する遷移がありません` |
| V6 | デッドエンド | final 以外の状態に出ていく遷移があるか | `状態 submitted から出る遷移がありません（final でもない）` |
| V7 | final 不変 | final 状態から出る遷移がないか | `withdrawn は final ですが withdraw の from に含まれています` |
| V8 | 決定性 | 同一（状態, イベント, ロール）でガードが重複成立し行き先が異なる遷移がないか | 反例: `state=submitted, item.state=available のとき遷移が 2 つ成立` |
| V9 | ガード充足性 | ガード（`guard` / `creates.when` / `writes.when` / `deletes.when` / `binding`）が恒偽（書いたのに絶対成立しない）／恒真（書く意味がない）でないか。**判定器は Z3（既製品）**で、仕組み側は SMT-LIB への写像だけを持つ（上の §ガード式の文法）。**判定できなかった式は黙って通さない** —— 時間内に答えられなかったものは warning、**判定器そのものが壊れていたら error**（上の §ガード式の文法）。**同じ扱いを V10 の行内制約（`kind: check`）もする** | `guard "item.state == available and item.state == closed" は充足不能` / `guard "…" は充足性を判定できませんでした（判定器が時間内に答えていません）` / `guard "…" の充足性を判定できませんでした（判定器が壊れています: …）` |
| V10 | 不変条件の執行 | `entities` / `involves` が実在する集約名であり、各 invariant に `enforced_by` が 1 つ以上あり、ref が実在する(`kind: guard` はイベント ID・`kind: application` は app/src に export された関数/定数名としての実在を見る)。**DB の執行点(`db_constraint` / `trigger`)の名前を 2 つの不変条件が宣言していない**(後述)。**`kind: application` の ref には呼び出し口が要る**(どこからも呼ばれていない執行点はエラー。後述)。`formal` の `keys` / `max` / `where`・`if`・`then`・`expr` の参照が実在し、**比較の右辺のリテラルが左辺の値域にある**（V2 と同じ照合）。**`involves` に挙げた集約名が実在する**。`kind: guard` の執行点が不変条件に触れていない場合は**警告**（下限の検査。後述）。**`kind: check`（行内制約）の充足性は V9 と同じ扱い** —— 恒偽は error・恒真は警告・判定できなかった式も黙って通さない（時間切れは警告、判定器の故障は error。束 ⑳-5c-b） | `INV-LOAN-001: enforced_by がありません` / `INV-LOAN-003: formal.where が loan.kind を proxy と比べています` / `INV-LOAN-008: involves の memo は未定義の集約です` |
| V11 | ロール接地 | `by` / `reads` / `creates` / `writes` / `deletes` / `fields_hidden[].from` に出るロールが roles.md に定義され（**`fields_hidden[].from` はさらに、その access_spec の reads に現れ、`kind: system` でない** —— 隠す相手は `reads[].by` との一致で外すので、綴り違い・reads に無いロールは誰からも隠さず、内部実行は RLS を迂回するので隠せない）、文脈依存ロールの binding の参照先へ **`context` を 2 段までで辿れる**こと（**辿れる経路が 2 通り以上あってもエラー**。どちらの行を指すのかが宣言から決まらない）。加えて **binding が比べてよいのは `actor.id` だけ**（`actor.{欄}` と比べる binding はスコープ条件にも `permit` にも写せない — テナントの境界は `reads[].filters` と `when` に書く）。さらに **`claim` が指す欄は `session: true` の boolean / enum / state で、enum / state は立つ値を添え、その値が欄の値域にある**こと（綴り違いは誰にも立たないロールになる。ADR-0018）。**値の集合が値域を全部含む `claim` は条件が常に真**（何も絞らず、条件を満たさない実行者を world に立てられない）、**自分の `claim` と含意の先の `claim` が同じ欄で共通の値を持たない**（誰にも立たない）ロールも落とす。さらに **`binding` / `claim` を持つロールが含意できるのは `kind` を持つロールだけ**（行から立つロールが素の特権ロールを含意すると、保存点でロールの和を渡す DB 側の判定が後段の束縛で通る。束 ⑳-3b） | `loan の by: item_librarian — loan から item へ context を 2 段までで辿れません` / `ロール tenant_staff の binding が actor.company_id を参照しています` / `ロール store_manager(対象の行から立つロール)が company_admin を含意しています` / `activ は patron.state の値域(guest / active / suspended)にありません` |
| V12 | **スナップショット写像** | `effects[].snapshot` の①写像先のエンティティと列が実在し型が一致する（必須列へ空になりうる値を写していない）②写像先の非 `auto` 列で写像に現れないものがあれば**警告**③写像元のエンティティと列が実在する⑥隠し列を隠した相手が写像先を読めない・個人列の写像先も `personal: true`（受け入れは行の `copy_accept`。消去の実体は T24） | `item_publication.publish_public の snapshot の写像に現れない public_item の列があります: branch_photo_url` |
| V13 | セッション属性の集約スコープ | `session: true` を宣言できるのは**認証ユーザーに対応する集約 1 つだけ**（複数集約にまたがると、どの行の値がセッションを表すのか宣言から決まらない。auth-spec-writing.md §session 属性） | `session: true が複数の集約(patron, item)にまたがっています` |
| V16 | **enum の表示名** | `enum(...)` の欄がどれかの action_spec の `input` に現れるなら `labels` が必須で、キー集合が enum の値集合と一致する（人が選ぶ値には人の言葉が要る。入力に現れない enum では任意） | `loan.kind は入力に現れる enum ですが labels がありません` |
| V17 | **DB が決める値** | `supplied_by: db` の欄が (a) どの `input` にも現れない (b) data_table が機構（`defaults` / `triggers[].supplies`）を宣言している (c) 作成 RPC の `params` に `p_{欄}` が無い。**逆向きは T9**（`triggers[].supplies` に載る列は `supplied_by: db` を宣言する） | `invitation.code が supplied_by: db ですが invitations.md が機構を宣言していません` |
| V19 | **遷移が自分の列に何をするか** | `records_actor` に並ぶ列が (a) entity_spec に実在する (b) `ref(実行者の集約)` 型である (c) `access_spec` の `transition_writes` に載っている（`writes` の `by: system` の行では満たさない）(d) **値の口（`p_{列}` の引数）が遷移 RPC にある**。`records_time` に並ぶ列が (a) 実在する (b) **`datetime` 型である** (c) 空にできる (d) 同じく `transition_writes` に載っている（**値の口は要らない** —— 書く値は行ロックの後に取った SQL の時刻）。`clears` に並ぶ列が (a) 実在する (b) 空にできる（必須でない）(c) 同じく `transition_writes` に載っている（口は要らない）。同じイベントが同じ列を 2 つの語に並べない。逆向きに、`transition_writes` に載せた列は実在し、どれかの遷移が上の 3 語で書く（載せたのに誰も書かない列は腐った宣言）。イベント単位の宣言なので、「対応開始は対応者を書くが再開は書かない」「保管だけが保管日時を書く」「外す遷移だけが列を空にする」をここでしか表せない | `purchase_request.reopen の records_actor が指す purchase_request.subject は実行者への参照ではありません` |
| V20 | **テナント境界の宣言漏れ** | どこかで `actor.{欄}` として使われている欄と同じ名前（または同じ `ref` 先）の列を持つエンティティが、その列の `filters` 無しで `scope: all` / `scope: context(...)` を宣言していたら **error**（以前は警告）。受け入れは access_spec の `accept: [{ by, filter, reason }]` で対象を名指しして消し込む（免除リストは無い。`on` を書いたら `read` を名指したときだけ読み取りに効く）。境界の欄は `session: true` の参照の欄からも導き、祖先は生の `ref` の閉包で探す（`context` で辿れなければ error）。未ログインの `scope: all` は warning | `store の reads(by: staff_member)は scope: all ですが、実行者の属性を表す列 company_id で狭める filters がありません` |
| V21 | **有界到達性** | 各状態・各遷移に、初期状態から **K 手以内に到達する実行列があるか**（V5 の 3 段の③を有界で）。**判定器は Z3（既製品）**で、仕組み側は「遷移を時間軸に展開して SMT-LIB に写す」写像だけを持つ（`legacy/spec-tools/lib/reach/**`）。`world` は**1 行ずつ**（各集約 1 行）で、関与するのは*その機械と、関与する機械のガードが**状態変数を読んでいる**機械*（推移的。同じ集約にあるだけで誰も読まない機械は入らない）。`access_spec.writes` に載る欄は**手ごとに自由**（誰かがいつでも書ける）、載らない欄は**実行中不変**（作成時に決まる。**遷移だけが書く欄も不変扱い**）とし、時刻 `now` は**単調非減少**。**`by`（誰が実行するか）も不変条件も見ない** —— 実行列を多めに認める写しなので、「K 手以内に無い」は**本当に無い**（= 仕様の問題。**warning**）であり、「ある」は保証ではない。**縮める側の仮定は 2 つ**（1 行ずつの `world` / `writes` に無い欄は実行中不変）で、Finding の文面がその 2 つを必ず報告する。K は関与する機械の状態数の積 − 1（上限 128 で打ち切り、打ち切ったことを文面が報告する）。**判定できなかったものは黙って通さない**（時間切れ・判定器を通していない = warning、判定器の故障 = error。V9 と同じ表） | `loan.confirm は from の状態とガードが同時に成り立つ瞬間へ、初期状態から 104 手以内に至る実行列がありません` |
| V22 | **行の名前の欄** | entity_spec の `display_field` が `fields` に居る `string` / `text` の欄である（生成物が確認の本文・選択肢の表示名で引く。実在しない欄・数値や参照の欄は名前にならない）。書かなければ何も言わない | `branch の display_field title は fields に居ません` |
| V23 | **ログインの既定ロールの状態の条件** | 実行者の集約（`session: true` の欄を持つ集約）が**状態機械を持つ**とき、`kind: authenticated_default` のロールが**その状態の欄に `claim` を宣言していること**（`claim: patron.state == active`。ADR-0018）。書かなければ「行があれば状態に関わらず」そのロールと、これを含意する全てのロールが立ち、止めたい状態の人を DB の述語も RLS も止めない。状態機械を持たない実行者の集約は対象外（実行者の集約は `session: true` の欄を持つ最初の集約で、`actorEntity` と同じ前提）。**重さは `ROLE_STATE_CONDITION_SEVERITY`（`lib/verify/verifiers/v23-login-role-state-condition.ts`）の 1 か所で決まる** —— 製品の仕様が条件を足すまでの移行のあいだは警告（拡張候補の台帳 `X-login-role-state-condition`）だったが、足した束 5 で error に切り替えた（候補は `done`） | `ログインの既定ロール patron が状態の条件を宣言していません(実行者の集約 patron は状態機械を持つので、行があれば state がどの状態でも patron が立ちます)` |
| V24 | **状態の `claim` の対応範囲** | 値の集合を持つ `claim`（と `kind` との併記）に、DB の述語（定型 RPC・RLS）・先読み（実行時のロール解決）・オラクル（world）が追随しているか。追随していない対象を足すあいだだけ、宣言した仕様を **error で止める**（通すと挙動テストが誤った世界で緑になる）。切り替えは `STATE_CLAIM_SUPPORTED`（`lib/verify/verifiers/v24-state-claim-support.ts`）の 1 か所で、**追随が済んだ今は `true`（何も言わない）** | `ロール patron の claim(patron.state == active)は未対応です(状態の claim は実行時のロール解決とオラクルの追随(束 3・4)が済むまで使えません)`（`false` に戻したときの出力） |
| V25 | **写しの集約の書き込み** | `mirror: true` の集約の access_spec の `creates` / `writes` / `deletes` が、システムのロール（`kind: system`）の規則だけである（V12 ⑤ は `mirror` と `snapshot.to` の双方向） | `public_note は写し(mirror: true)なのに、deletes にシステム(system)以外の規則 by: librarian があります` |
| V26 | **テナント境界の宣言漏れ（書き込み）** | V20 と同じ目で導いた境界の列を持つエンティティの `creates` / `writes` / `deletes`（未ログイン・システム起点のロールの規則を除く）の `when` が、トップレベルの `and` の項に「境界の列 == `actor.{欄}`」を持たなければ **error**（`or` / `not` の中・`!=`・順序比較は数えない）。入力から来る自分の列はその列そのものを、DB が埋める列・祖先の列だけを持つ集約はその列か祖先の列（`{集約}.{列}`）を結ぶ。受け入れは V20 と同じ `accept` だが書き込みは `on: [create, write, delete]` で名指したものだけに効く（既定は読み取りだけ）。作成では DB が埋める自分の列は数えず、入力で受ける参照の欄ごとに親の境界の列を結ぶ。未ログイン・システム起点のロールの規則と、境界の列を導けない集約は warning。`writes[].fields` が境界の列自身・境界を持つ祖先への参照の欄を含む編集は、執行点が実在する不変条件か `accept(on: [write])` が無ければ **error**（旧い値への `when` は新しい値を縛らない）。**状態遷移も見る**: 実行者のいるロール（対象に依らず立つロール**と binding のロール**。binding も編集の `when` と揃える —— 人の側の境界の属性が変わると、結ばれた行の元の境界の行を動かせてしまう。点検 5 回目 A5-2）の遷移は `guard` に境界の項が要る（受け入れは `on: [transition]` + `events` で遷移の定義を名指す。未ログインの遷移は warning）。**境界の欄が 0 本でも黙らない**: 実行者の集約の参照の欄で、ほかの集約も同じ参照先を指すもの（テナントの欄に見える形）を V20 が error で名指す（`session: true` を付け忘れて境界を 1 本も書かなかった製品。テナントでないなら欄に `not_boundary: 理由`。A5-4）。境界の根は `id` を境界の列として扱い、実行者の集約を経た祖先の列は境界にしない。作成の入力の参照の欄は `context` に無くても見る。**一意の範囲**: `uniqueness` / `exclusion` / `cardinality` の `keys` が境界の列も境界へ届く参照の欄も持たず、鍵の欄を人の入力か `computes` で書ける形も error（`invariant` の無い一意の索引の `on` も同じ。受け入れは `global_key: { keys, reason }`）。隠し列の鍵を隠した相手が書ける形も error | `product の creates(by: company_admin)は、実行者の属性を表す列 company_id を actor.company_id に結ぶ when を持っていません —— 他のテナントの行を書ける形です` |

- **V9 と V21 の違い**: V9 は**式 1 本**が恒偽・恒真でないかを見る（その式が真になる状態へ至れるかは見ない）。V21 は**実行列**を見る —— ガード単体は充足可能でも、その遷移の `from` に居る間にそのガードが立つ瞬間が来ないことがある（「ボタンがいつ押しても効かない」）。どちらも判定器は同じ Z3 だが、問うているものが違うので両方要る。
- **番号の欠番について**: `V14`（`ux` 上書きの理由必須）は同じ番号体系だが**トレース群（A 群）と同じ CLI 段**にいる（対象が action_spec なので、ドメイン仕様の検証器の一覧には現れない）。`V15` は使っていない（束 ⑯e の設計が V16 / V17 を名指しで凍結したため。番号は連番であることに意味を持たせていない）。`V18`（`computes` の接地）は対象が action_spec なので [action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md) 側の一覧にいる。
- 実装は**列挙ベース**（状態・イベント・ロール・enum 値の全組み合わせを回す）。例外は**ガードの充足性の判定だけ**で、そこは既製品（Z3。WASM）に任せ、仕組み側は SMT-LIB への写像を持つ（束 ⑳-5c。[ADR-0003](../../../../decisions/common/ADR-0003-constrained-spec-dsl.md) の末尾の追記）。DSL の表現力は変えていない。
- エラーは必ず「**何が・どこで・どう直すか**」の 3 点セットで出す。
- **v2 以降の候補（v1 ではやらない）**: 不変条件の遷移列探索（「この操作列で INV が破れる」の反例生成）、時相的性質（「いつか必ず通知される」）。

### 危ない形の検査(R 群。R2・R5・R10・R14・R15)

正しく読めた仕様の中の、攻撃に開いた形を止める横断の群である(対応表は enforcement-matrix の C32)。どれも error。実装は `legacy/spec-tools/lib/risk/`。

| ID | 何を見るか | 受け入れ | 出力例 |
|----|-----------|---------|--------|
| R2 | **役の根拠の欄の書き手**。根拠の欄は `claim` の欄・`binding` に出る実行者側の参照の列・`reads[].filters` の右辺と式の中の `actor.{欄}`(実行者の集約の欄)。経路は編集(`writes`)・作成の初期値(入力・計算・action_spec の `owner` で明示した持ち主の欄・役を与える既定値と初期状態。「自分として」は数えない)・遷移(状態の `claim` を満たす状態への遷移・`records_actor`・遷移の入力)・内部実行の入口の全部。書けるのは**その役を持つか含意する役**と、**誰の指示で何を書くかが追える内部実行の入口**(サインインの決定表の `runs` で主語以外の軸の条件つき・受信 Webhook の `emits` / `event_id_table`・`due_from` つきの走査)だけ。`kind: system` を無条件では許さない。**`writes` の `by: system` の行は、同じ欄を書く内部実行の遷移で入口の追えるものがあるときだけ通る**(人の遷移や入口の追えない遷移が同じ欄を書くことは根拠にならない。遷移だけが書く列は `transition_writes` に宣言する) | その規則の場所の `self_assign`(欄 × 役 × 書き手を名指す要素 `{ field, role, by, reason }`。`by` は規則・遷移の `by` の部分集合。名指した欄 × 役 × 書き手にだけ効き、何も受け入れない要素 × 書き手・`by` に無い書き手は腐った受け入れとして error。内部実行に受け入れの口は無い) | `department の writes[1](by: user) は、役 department_admin の根拠の欄 department.admin_id(binding)をその役を持たない user が書ける形です` |
| R10 | **上限の無い欄**。`string` / `text` の `max_length`、`integer` / `decimal` の `min` と `max` | `unbounded: 理由`(文字列だけ) | `note.order_index は範囲の上限が無い数の欄です` |
| R14 | **URL を自由な文字列で書いた欄**。`pattern` の綴りが URL の文法(`http` / `://` / `script:`)を手で書いている | `format: url`(`pattern` を消して宣言する。免除の口は無い) | `note.source_url は pattern で URL の文法を書いています` |
| R15 | **書式つきの本文として描いている欄が `format: markdown` で宣言されていない**。描く口(`MarkdownView` の `value`・`renderMarkdown` / `plainTextOf` の第 1 引数)に渡す式が欄の参照でない、または渡す欄の名前(末尾の識別子を camelCase にしたもの)がどの集約の `format: markdown` の欄とも一致しない(テストの木は見ない) | その欄を `type: text` + `format: markdown` で宣言する(免除の口は無い) | `画面の実装 x.tsx が title を書式つきの本文として描いていますが、format: markdown で宣言された欄ではありません` |
| R5 | **未ログインの書き込みの歯止め**。①未ログインのロールの `creates` の規則に `abuse.global_ceiling` が無い(R5-1)。②`abuse` の書き方(`max` は 1 以上の整数・`per` は `{n} {minute\|hour\|day}`・`per_key.column` と `at` は集約の欄で `at` は日時・`per_key.max` ≤ `global_ceiling.max`・1 つの access_spec に 1 規則まで。R5-2)。③未ログインでない規則の `abuse`(R5-3)。④未ログインのロールが `by` に並ぶ `writes[]` / `deletes[]` / `events[]` に `public: 理由` が無い・空(R5-5)。⑤未ログインの規則でないのに `public` がある(腐った受け入れ。R5-6)。**値の妥当性は見ない**。生成器が天井を出せない宣言（表が無い・DDL が生成物でない・同名の手書きの宣言がある。判定は生成器と同じ関数。R5-4）も止める。有料の口(外部連携の `spend: paid` と `abuse`。R5-7 / R5-8)は[外部連携の書き方](../../../backend/specification/standards/external-spec-writing.md)。**宣言と検査だけで執行は証明しない** | ④は `public: 理由`(その規則の場所)。①は受け入れの口が無い(値は自由) | `purchase_request.creates[0](by: anonymous) は未ログインが書ける作成で、全体の天井がありません` |

読み込みの文法(R17)は検査ではなく各種類のローダーの拒否で、生成 SQL / TS にそのまま置かれる名前(ロール ID・エンティティ名・状態機械名・状態 ID・イベント ID・access_spec の `entity` と `filters` の列名ほか)が識別子の文法に合わなければ V1(ほかの種類は各 0 番の検査)で落ちる。

### DSL の外に置くもの

書けないものは通常のコードとテストの領域で扱う。線引きは以下のとおり。

- **集計を含む制約**（「貸出合計時間が蔵書の貸出上限を超えない」等）は DSL の守備範囲外とする。
  - 制約を operation 内の**純粋関数に隔離する**（規約として強制）。
  - invariant 側に `enforced_by: { kind: application, ref: {関数名} }` を宣言し、そこから**テスト義務**を発行する。trace 検証で「義務が果たされていない」を検出する。
  - 境界値などケースの中身の設計は人／AI が行う。ここだけは網羅の証明がなく、テスト設計の質に依存する。
- **技術的保護**（レートリミット・タイムアウト・リトライ上限・サイズ上限など）も**同じ器に入る**。サーバーが黙って弾く天井であって、団体や業務が決めた決まりではない —— だから**集約としては持たない**（回数を数える列も、上限を引き上げる操作も、残数を見せる読み取り経路も作らない。数えるのはインフラの側である）。
  - **それでも不変条件としては宣言する。「集約として持たない」と「仕様書に書かない」は別のことである。** 宣言しなければ、実装すればテストは書かれるのに**仕様に現れず・注釈も付かず・人間の目にも触れない**。形は集計を含む制約とまったく同じで、`enforced_by: { kind: application, ref: {関数名} }` + テスト義務であり、ハンドブックには「機械は守れない → テストが守る」の注記で出る。
  - **上限の値そのもの（N と時間窓）は不変条件に書かない。** 運用設定なので [config カタログ](../../../../../specs/backend/template.config_spec.md)が宣言する（通知カタログが宛先だけを宣言して Webhook の URL を持たないのと同じ線である）。
- **階層状態機械・並行状態機械**は v1 では書けない。直交軸は entity_spec の複数状態フィールドで表現する。必要になったら ADR を書いて拡張する。
- **表示状態**（満席・残りわずか等）はドメイン状態ではなく**導出値**である。state_spec に状態として足してはならない。
- **組み合わせ生成**（マッチングの割り当てなど）は DSL 外。純粋関数に隔離し、プロパティベーステストで保証する。
- **台帳**（ポイント残高・ローリング期限）は v1 では通常のコードとテストで扱う。v2 で `ledger` 専用 doc_type を検討する。

#### 判定の型 —— 「技術的保護か、業務のルールか」

天井を足したくなったら、1 問だけ聞けばよい。**その天井は、誰かと交渉できるものか。**

| | **技術的保護** | **業務のルール** |
|---|---|---|
| 天井の性格 | サーバーが黙って弾く（ファイアウォールと同じ） | 団体が決めた決まり |
| entity_spec / access_spec / query_spec | **書かない** | 書く |
| 不変条件 | **書く**（`enforced_by: application` + テスト義務） | 書く |
| 上限の値の置き場 | config カタログ | 仕様（列・enum・`formal` のいずれか） |

**ドメインへ昇格する兆候は 3 つある。** ①残数を画面に出す（可視性の宣言が要る）②誰かが個別に引き上げる（操作 = `access_spec`）③利用者区分やプランで値が変わる（不変条件）。**誰かが見る・触る・交渉するようになった瞬間に、それはもう業務のルールである。** その日にドメインへ引き上げる。

実例は 2 件ある(開発用リポジトリの製品仕様)。どちらも**執行点は DB 側**（数える判定はアプリに置かない）で、宣言だけが仕様書にある。

- **INV-PURCHASE-REQUEST-002** — 未ログインからの購入希望のスパム防止。数えるのは同一メールアドレスの直近件数で、送信回数の列も IP も持たない。天井と時間窓は執行するトリガの `params` が宣言する。
- **INV-PATRON-008** — 1 人が 1 日に実行できる AI の応答生成の上限（コスト保護）。計数は集約ではない内部テーブル（`ai_usage`）で、**残り回数は画面に出さない** —— 出した瞬間にそれは交渉できる値になるからである（上限の値だけは運用設定 `AI_CHAT_LIMIT_PER_DAY`）。

**天井の判定をアプリの純関数に置かない。** 「数えるのはインフラ、判定するのは純関数」という形は読みやすいが、**その手順を通らない書き込み**（複合 RPC・管理スクリプト・将来の別クライアント）では天井ごと消える。実際、操作の実装が生成物になった束で呼び出し口が失われ、上の 2 件はどちらも黙って無効になっていた（束 ⑰-3b で検出）。集計は SQL で数えられるので、執行点は DB のコミット時評価に置く（ADR-0012 §1）。

---

## 関連ドキュメント

- [ARCH-SP-0002](../../../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md) — specs/domain の構成と配置
- [ADR-0003](../../../../decisions/common/ADR-0003-constrained-spec-dsl.md) — 仕様 DSL の表現力を制限し列挙ベース検証を採用する
- [ADR-0004](../../../../decisions/common/ADR-0004-generated-transition-table-engine.md) — 遷移テーブル生成 + 汎用エンジン方式
- [template.entity_spec.md](../../../../../specs/domain/template.entity_spec.md) ほか `template.*` — テンプレート
