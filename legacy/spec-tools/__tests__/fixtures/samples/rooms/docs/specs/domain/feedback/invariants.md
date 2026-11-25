---
doc_type: invariant_spec
scope: common
id: feedback-invariants
invariants:
  # 未ログインの作成の天井(access_spec の creates[].abuse)の執行点は生成物のトリガである。集約としては持たないが、
  # 執行点が取る advisory lock を受け入れる根拠として不変条件に宣言する(点検 26 回目 A26-1。製品の INV-INQUIRY-002 と同じ形)
  - id: INV-FEEDBACK-001
    statement: 未ログインからの意見の作成は、全体で一定期間内の件数を超えない(検査の足場の天井)
    entities: [feedback]
    formal_outside: 時間の窓の中の件数の上限で、形式定義の cardinality は窓(作成の時刻からの期間)を持たない
    enforced_by:
      - kind: trigger
        ref: check_feedback_rate_limit
---

# 匿名の意見の不変条件

- 天井の値は access_spec の `creates[].abuse` の 1 か所だけが持つ(ここに数を書き写さない)。
