---
doc_type: directory_guide
scope: common
good:
  - event: a.one
    reason: 理由が書いてある
blank:
  - event: a.two
    reason: "   "
missing:
  - event: a.three
---

# decls フィクスチャ

lib/model/decl-list.ts のテスト用。複数のキーを 1 回の読み取りで扱えることを確かめる
(正常形 1 件 + 壊れた宣言 2 件を同時に読む)。
