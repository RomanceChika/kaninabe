---
doc_type: directory_guide
id: DG-BE-0001
norms: []
scope: backend
unhandled: []
scans: []
unscanned: []
test_tag_baseline: []
---

# Server Action 仕様（経費精算）

- 申請の一括承認（部下の申請をまとめて承認する）の口は置かない — 1 操作 1 申請に保つ（まとめて押せる画面は、誰の何を承認したのかが監査ログから読めなくなる）。
- 明細の並べ替えの口は置かない — 明細に順序の概念を持たせない（金額の合計だけが意味を持つ）。

<!-- AUTO-GENERATED:actions-index -->
<!-- /AUTO-GENERATED:actions-index -->
