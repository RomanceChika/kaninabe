---
doc_type: directory_guide
id: DG-BE-0001
norms: []
scope: backend

# A4（ハンドラの網羅）の免除宣言。作らないイベントが出たら理由つきで足す。
unhandled: []

# A10（走査の網羅）の宣言。by に system を含むイベントが 1 つも無いので空。
scans: []
unscanned: []

# A12（注釈の台帳）のベースライン。無印テストは 1 本も無い。
test_tag_baseline: []
---

# Server Action 仕様（会議室の予約）

- 予約の一括操作（部門の予約をまとめて取り消す）は置かない — 1 操作 1 予約に保つ。

<!-- AUTO-GENERATED:actions-index -->
<!-- /AUTO-GENERATED:actions-index -->
