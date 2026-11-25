---
id: DG-BE-0032
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001]
---

# operation 層（app/src/operation）

operation 層の**実装のきまりとコード例**を置く箱である。責務・構成・依存方向は [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の `app/src/operation` の節が正であり、ここでは定義しない。

文書はルール(`xx.md`)を置く。新規・改訂のとき、ルールは [../template.md](../template.md) に従う。

## 配下の文書（ルール＋例）

| ルール | 例 | 内容 |
|---|---|---|
| (未整備) | — | — |

配下に文書はまだ 1 件も無い。ただし **operation は規約が最も育っている領域のひとつ**であり、実体は次の場所にある。

- **操作の 5 形の定型**(遷移 / 作成 / 削除 / 編集 / 項目更新)—— [conventions/server-actions.md](../../conventions/server-actions.md)。手順を手書きせず、`app/src/operation/_template/` の各テンプレートに設定を渡す形で書く
- **署名と依存方向の機械執行** —— [conventions/enforcement/enforcement-matrix.md](../../conventions/enforcement/enforcement-matrix.md) と [conventions/enforcement/layer-boundaries.md](../../conventions/enforcement/layer-boundaries.md)
- **この層のテスト**(フェイク注入、仕様網羅)—— [conventions/testing/unit.md](../../conventions/testing/unit.md)

ここに文書を足すのは、**層に閉じたきまりが出てきたとき**である(層をまたぐものは conventions 側に置く)。
