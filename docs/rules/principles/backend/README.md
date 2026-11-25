---
doc_type: directory_guide
id: DG-BE-0001
norms: []
scope: backend
---

# principles/backend — backend 固有の原則

backend 向けの原則(`PRIN-BE-0001-xxx` 形式)の置き場。新しい原則を書くときは [principles/template.md](../template.md) に従う(template_policy の「同階層 → 上」で解決される)。

## 一覧

| 文書 | 内容 |
|---|---|
| （未整備） | — |

## 整備方針

**common の原則から整備する。** backend 固有の原則を起こすのは、**common で言い切れない事情が実際に出た時点**である。実物が無いうちに先回りして原則を作らない。

common の原則に準拠する形で書く場合は、フロントマターの `norms` に common の原則 id を列挙する。

候補として「観測可能性は境界で扱う」が挙がっているが、まだ起こしていない。現状、backend の判断は共通の原則([PRIN-0003](../common/PRIN-0003-testability.md) / [PRIN-0005](../common/PRIN-0005-respect-boundaries.md) など)と [ARCH-BE-0001](../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) 以下のアーキテクチャ文書で足りている。
