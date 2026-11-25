---
doc_type: directory_guide
id: DG-BE-0001
norms: []
scope: backend

# A4(ハンドラの網羅)の免除宣言。
unhandled: []

# A10(走査の網羅)の宣言。sales_order.pay は時刻で起きる走査ではなく外から届く通知で起きるので、
# 発火元の宣言は external.md の受信の行(direction: inbound の emits)が持つ。
scans: []
unscanned: []
# A12(注釈の台帳)のベースライン。無印テストは 1 本も無い。
test_tag_baseline: []
---

# Server Action 仕様(複数店舗の在庫と入金)

- 在庫の一括取り込み(CSV)の口は置かない — 部分成功の扱いが保存点(全部か無しか)と噛み合わない。
- 会社の作成・従業員の登録の口は置かない(契約と人事は仕組みの外)。

<!-- AUTO-GENERATED:actions-index -->
<!-- /AUTO-GENERATED:actions-index -->
