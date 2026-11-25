---
id: DG-BE-0029
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001]
---

# domain 層（app/src/domain）

domain 層の**実装のきまりとコード例**を置く箱である。責務・構成・依存方向は [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の `app/src/domain` の節が正であり、ここでは定義しない。

文書はルール(`xx.md`)を置く。ルールだけでは形が像を結ばず、例だけでは何が禁止されているのか分からない。新規・改訂のとき、ルールは [../template.md](../template.md) に従う。

## 配下の文書（ルール＋例）

| ルール | 例 | 内容 |
|---|---|---|
| (未整備) | — | — |

配下に文書はまだ 1 件も無い。一方 `app/src/domain` の実装は動いており(生成物 `app/src/domain/generated/`、遷移のエンジン、`Result` とエラーの型)、domain 層の実装のきまりに相当する内容は現在ほかの文書に分散している。

- 層内の import 制限を含む依存方向の執行 —— [conventions/enforcement/layer-boundaries.md](../../conventions/enforcement/layer-boundaries.md)
- ドメインイベント ID から実装の配置と export 名が一意に決まること —— [conventions/enforcement/naming-and-placement.md](../../conventions/enforcement/naming-and-placement.md)

ここに文書を足すのは、**層に閉じたきまりが出てきたとき**である(層をまたぐものは conventions 側に置く)。
