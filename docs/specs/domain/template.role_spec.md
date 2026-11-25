---
doc_type: role_spec
scope: common
id: domain-roles          # ドメイン全体で 1 つ。ファイル名は roles.md 固定
roles:
  # --- グローバルロール（対象に依存しない。binding は書かない）---
  # kind は anonymous / authenticated_default / system のいずれか。それぞれちょうど 1 つの
  # ロールが持つ（仕組み側のコードは生成物 GLOBAL_ROLES 経由でこの id を引く）。
  - id: anonymous
    label: 未ログイン
    kind: anonymous
  - id: patron
    label: 利用者               # ログイン済み一般
    kind: authenticated_default
  - id: system
    label: システム         # Webhook / Cron からの内部実行
    kind: system

  # --- 文脈依存ロール（「この対象に対して誰がそのロールか」を binding で定義）---
  # binding が参照できるのは、対象エンティティからの参照パス（entity_spec の context で解決）と actor のみ。
  # 文法: path op literal / path in [...] / path contains ref  を and / or / not で結合。
  - id: "{role_id}"       # 例: loan_owner — 対象の貸出を借りた本人
    binding: "{entity}.{field} == actor.id"
    implies: [patron]     # 任意。「このロールを持つ人は必ず patron でもある」ときだけ書く
  - id: "{role_id_2}"     # 例: hold_owner — 対象の予約をかけた本人
    binding: "{entity}.{field} contains actor.id"
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- ここで定義した id 以外を state_spec の by / access_spec の reads・writes に書くとエラー（V11）。
- 文脈依存ロールを使うエンティティは、entity_spec に context 宣言が必要（無いと V11 でエラー）。
- implies は「必ず併せ持つ」ロールの宣言（RBAC のロール階層）。「持ち得る」ではないので、
  例外が 1 件でもあるなら書かない。宣言先の実在と循環はローダーが検査する。
- ロールを増やすと、全 access_spec の reads に「そのロールの行」が必要になる（V4: 全域性）。
  見せないロールにも scope: none を明示すること。書き忘れは公開ではなくエラーになる。
- 説明は行末コメントで日本語で書く。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の可読形は生成ブロックが担う（手書きで再記述しない）。YAML コメントは
  行ローカルの短注（1 行）のみ。経緯は NOTES へ。
-->

# ロール定義

<!-- AUTO-GENERATED:role-table -->
<!-- ロール一覧表（グローバル / 文脈依存、binding、参照しているエンティティ）がここに生成される。手書きしない。 -->
<!-- /AUTO-GENERATED:role-table -->
