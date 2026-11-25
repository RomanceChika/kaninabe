---
doc_type: access_spec
scope: common
id: hold-access
entity: hold
reads:
  - by: hold_owner
    scope: own                    # 自分がかけた予約
  - by: librarian
    scope: all                    # 取置の準備のため全件
  - by: patron
    scope: none
  - by: loan_owner
    scope: none
  - by: anonymous
    scope: none
  - by: system
    scope: all
fields_hidden:
  - field: note                   # カウンターへの連絡事項は司書だけが読む
    from: [hold_owner]
creates:
  - by: patron
    # 予約は自分の名前でだけかけられる —— 予約者(patron_id)は hold.create の owner(作成者で埋める欄)なので、
    # 実行器が実行者で埋め、作成の RPC と engine が実行者そのものに縛る(when で重ねて書かない)。
    # 作成者が自分の行の hold_owner になることは、欄 × 役を名指して受け入れる(R2)
    self_assign:
      - field: hold.patron_id
        role: hold_owner
        by: [patron]
        reason: 予約をかけた利用者がその予約の予約者になる(hold.create の owner)。得るのは自分の予約の取り消しだけ
---

# 予約のアクセス権限

- 予約の削除は持たない — 取り消した事実を残すため、取消は状態で表す。

<!-- AUTO-GENERATED:access-matrix -->
### 読み取り

| ロール | スコープ |
| --- | --- |
| hold_owner(予約本人) | own |
| librarian(司書) | all |
| patron(利用者) | none |
| loan_owner(借受本人) | none |
| anonymous(未ログイン) | none |
| system(システム) | all |

### 作成

| ロール | 条件 |
| --- | --- |
| patron(利用者) | — |

### 隠しフィールド

| フィールド | 隠す対象ロール |
| --- | --- |
| note | hold_owner |
<!-- /AUTO-GENERATED:access-matrix -->
