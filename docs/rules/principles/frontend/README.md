---
doc_type: directory_guide
id: DG-FE-0001
norms: []
scope: frontend
---

# principles/frontend — frontend 固有の原則

frontend 向けの原則(`PRIN-FE-0001-xxx` 形式)の置き場。新しい原則を書くときは [principles/template.md](../template.md) に従う(template_policy の「同階層 → 上」で解決される)。

## 一覧

| 文書 | 内容 |
|---|---|
| （未整備） | — |

## 整備方針

**common の原則から整備する。** frontend 固有の原則を起こすのは、**common で言い切れない事情が実際に出た時点**である。実物が無いうちに先回りして原則を作らない。

common の原則に準拠する形で書く場合は、フロントマターの `norms` に common の原則 id を列挙する。

画面側の実装は既に一周しており(画面仕様・生成トークン・画面テスト・UX リント)、原則化しうる考え方の材料は蓄積している。ただし現状それらは仕様の構造規約([screen-spec-writing.md](../../process/frontend/specification/standards/screen-spec-writing.md))と実装規約([styling.md](../../process/frontend/system/standards/conventions/styling.md) / [screen-test.md](../../process/frontend/system/standards/conventions/screen-test.md))の側に書かれており、原則へ昇格させるかどうかは未判断である。**「実装フェーズが来たら書く」ではなく「common で言い切れなくなったら書く」が起票条件である。**
