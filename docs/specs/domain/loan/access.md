---
doc_type: access_spec
scope: common
id: loan-access
entity: loan
reads:
  - by: loan_owner
    scope: own                    # 自分が借りた貸出
  - by: librarian
    scope: all                    # カウンター業務のため全件
  - by: patron
    scope: none                   # 他人の貸出は見えない
  - by: hold_owner
    scope: none
  - by: anonymous
    scope: none
  - by: system
    scope: all
creates:
  - by: patron
    when: item.state == available # 在架の蔵書にだけ貸出を申し込める
    # 借り手(patron_id)は入力に出した実行者の参照の欄なので、作成の縛りが本人に限る(delegate の無い規則。他人の名義は UC403)
    self_assign:
      - field: loan.patron_id
        role: loan_owner
        by: [patron]
        reason: 利用者が自分の名前で借りる(作成の縛りが借り手を本人に限る)。得るのは自分の貸出の返却・延長だけ
  - by: librarian
    when: item.state == available
    delegate:
      - field: loan.patron_id
        reason: 司書が窓口で利用者に代わって貸し出す(借り手を選ぶのは司書の仕事)
    self_assign:
      - field: loan.patron_id
        role: loan_owner
        by: [librarian]
        reason: 司書が窓口で利用者に貸し出す(借り手を選ぶのは司書の仕事)。司書は貸出を既に全件扱えるので、自分を借り手にしても新しい権限は増えない
---

# 貸出のアクセス権限

- 貸出の削除は持たない — 取り消しも返却も履歴として残す必要があるため、状態で表す。

<!-- AUTO-GENERATED:access-matrix -->
### 読み取り

| ロール | スコープ |
| --- | --- |
| loan_owner(借受本人) | own |
| librarian(司書) | all |
| patron(利用者) | none |
| hold_owner(予約本人) | none |
| anonymous(未ログイン) | none |
| system(システム) | all |

### 作成

| ロール | 条件 |
| --- | --- |
| patron(利用者) | `item.state == available` |
| librarian(司書) | `item.state == available` |
<!-- /AUTO-GENERATED:access-matrix -->
