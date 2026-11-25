---
doc_type: access_spec
scope: common
id: claim-access
entity: claim
reads:
  - by: anonymous
    scope: none
  - by: employee
    scope: none                   # 他人の経費は見えない
  - by: claim_owner
    scope: own
  - by: approver
    scope: own                    # 自分が承認者に指名された申請
  - by: accountant
    scope: all                    # 経理は支払いのために全件を見る
  - by: system
    scope: all
creates:
  - by: employee
    # 2 つの受け入れは別の問いである。delegate = 作成の入力に出した実行者の参照の欄(承認者)に自分以外を入れてよい
    # (作成の縛り。名指した欄だけを解く。申請者の欄 employee_id は入力に無く、claim.create の owner で作成者に縛られたまま)。self_assign = 役の根拠の欄(approver の binding の
    # approver_id)をこの規則の書き手が書いてよい(R2)。自分を承認者にする形は INV-CLAIM-002(DB の CHECK)が止める
    delegate:
      - field: claim.approver_id
        reason: 申請者が承認者(別の社員)を選んで申請する
    self_assign:
      - field: claim.approver_id
        role: approver
        by: [employee]
        reason: 申請を作る社員が承認者を入力で指名する(承認者に役を与える)。自分を承認者に指名することはできない(INV-CLAIM-002 の CHECK)
      - field: claim.employee_id
        role: claim_owner
        by: [employee]
        reason: 申請を作った社員がその申請の申請者になる(claim.create の owner)。得るのは自分の申請の操作だけ
writes:
  - by: claim_owner
    fields: [title, purpose, approver_id]
    when: state == draft
    self_assign:
      - field: claim.approver_id
        role: approver
        by: [claim_owner]
        reason: 下書きの間は申請者が承認者を指名し直せる。自分を承認者に指名することはできない(INV-CLAIM-002 の CHECK)
  # 提出の遷移が確定させる合計額(total_amount)は、ここに行を持たない。書くのは提出の遷移の計算値
  # (claim/submit.md の computes)だけで、計算で決まる値は入力として受け付けない(編集の経路を作らない)。
deletes:
  - by: claim_owner
    when: state == draft
---

# 経費申請のアクセス権限

- 承認者に編集権は与えない — 直したいなら差し戻す、が業務のルールである。
- 経理の読み取りを context(...) に狭めない — 支払いの対象は部署をまたぐため全件が要る。

<!-- AUTO-GENERATED:access-matrix -->
<!-- /AUTO-GENERATED:access-matrix -->
