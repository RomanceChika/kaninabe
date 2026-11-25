---
id: DG-BE-0030
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001]
---

# infrastructure 層（app/src/infrastructure）

infrastructure 層の**実装のきまりとコード例**を置く箱である。責務・構成・依存方向は [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の `app/src/infrastructure` の節が正であり、ここでは定義しない。

文書はルール(`xx.md`)を置く。層の内側で責務を分ける場合は、その責務ごとにルール文書を追加してよい。新規・改訂のとき、ルールは [../template.md](../template.md) に従う。

## 配下の文書（ルール＋例）

| ルール | 例 | 内容 |
|---|---|---|
| (未整備) | — | — |

配下に文書はまだ 1 件も無い。一方 `app/src/infrastructure` の実装は動いており(Supabase 実装、書き込みの RPC への集約、DB 制約名と `INV-*` の対応)、実装のきまりに相当する内容は現在ほかの文書にある。

- **DB 側の防衛線**(権限・RLS・CHECK・トリガー・書き込み RPC と、その既知の限界)—— [conventions/enforcement/database-guards.md](../../conventions/enforcement/database-guards.md)
- **読み取りの写像**(projection どおりの `select`、行の選別を書かないこと)—— [conventions/queries.md](../../conventions/queries.md)
- **実 DB に対する検証** —— [conventions/testing/integration.md](../../conventions/testing/integration.md)

ここに文書を足すのは、**層に閉じたきまりが出てきたとき**である(層をまたぐものは conventions 側に置く)。
