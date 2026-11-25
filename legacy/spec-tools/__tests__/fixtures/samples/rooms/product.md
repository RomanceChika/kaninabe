---
doc_type: product_roots
scope: common
id: product-roots

# 製品の名前(W1 / W2 の語彙に入る。パスではない)。**一般語を置かない** ——
# `rooms` のような普通名詞は仕組み側コードの散文に素で現れ、題材で W 群を回す日に
# 誤検出になる(束 ①-c-c のレビュー指摘)。
name: sample-rooms

roots:
  # 仕様の木(この題材が持つ唯一の正。`fixture` は `.md` だけの製品である)
  specs: docs/specs
  # 生成される読み物の置き場(通し実行は書き出した本文を字面で確かめる)
  book: docs/book
  # 生成物の総置き場(通し実行が一時ツリーへ書き出し、本物のエンジンにつないで型検査する)
  generated: app/src/domain/generated
  # 生成 SQL の置き場(通し実行は字面の検査だけを行う)
  migrations: supabase/migrations
  # 実装の木。**通し実行が型検査のために後から組む**ので、検証の時点ではまだ無い ——
  # 「宣言したがまだ無い」を appGrounded が false と判定する(それが正しい扱い)。
  app: app
  # knowledge / previews は持たない(行ごと書かないのが「持たない製品」の書き方)

# この題材が採る仕様の種類(閉じた一覧。置き場に仕様がある種類は全部書く —— 書き忘れも書き過ぎも P2 が落とす)。
# 書いていない種類を要る検査は「未実施」と報告される(ファイルの有無から推定しない)。
uses:
  - actions
  - queries
  - data_tables
  - surface
  - screens
  - usecases
---

# `fixture` の根の宣言

この題材は**仕様だけを持つ製品**である。通し実行(`legacy/spec-tools/__tests__/samples/harness.ts`)は
この宣言を一時ツリーの直下へ写し、`detectRepoRoot` がそれを見つけて根を決める ——
以前は**空の `.git` を置いて `.git` 探索を騙していた**(設計メモ §3 の発見 2)。
