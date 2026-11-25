---
id: DG-BE-0031
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001]
---

# Composition（app/src/composition）

composition の**実装のきまりとコード例**を置く箱である。責務・構成・依存方向は [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の `app/src/composition` の節が正であり、ここでは定義しない。

文書はルール(`xx.md`)を置く。責務を分ける場合は、その責務ごとにルール文書を追加する。新規・改訂のとき、ルールは [../template.md](../template.md) に従う。

## 配下の文書（ルール＋例）

| ルール | 例 | 内容 |
|---|---|---|
| (未整備) | — | — |

配下に文書はまだ 1 件も無い。一方 `app/src/composition` は実装済みで、Composition Root として実装を配線している。相当する内容は次の 2 本にある。

- **配線の形**(ポートに実装を差し込み、operation に渡す)—— [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の composition の節

ここに文書を足すのは、**ここに閉じたきまりが出てきたとき**である(層をまたぐものは conventions 側に置く)。
