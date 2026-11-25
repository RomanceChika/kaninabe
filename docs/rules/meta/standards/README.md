---
id: DG-0014
doc_type: directory_guide
scope: repository
norms: []
---

# meta/standards — 文書体系の基準

ここに置くのは**基準・ポリシー**である。何が正しいかを宣言し、他の文書から参照される側になる。手順は書かない(手順は [../playbooks/](../playbooks/README.md) の側にある)。

**この一覧が meta 配下の standards の正である。** 親の [../README.md](../README.md) は目的別の導線だけを持ち、ファイルの一覧はここに一本化してある(PRIN-0007)。ファイルを足したら、この表に行を足すまでが 1 つの作業である。

## Standards

| ファイル | 目的 | 主な読者 |
|---|---|---|
| [doc_types.md](./doc_types.md) | 文書の種類の定義。doc_type ごとに何を書き、何を書いてはいけないか | AI / 人間 |
| [placement_policy.md](./placement_policy.md) | doc_type × scope から置き場所を一意に決める対応表 | AI |
| [id_policy.md](./id_policy.md) | ID の形式・採番単位・再利用禁止 | AI / 人間 |
| [frontmatter_policy.md](./frontmatter_policy.md) | フロントマターの全項目と、doc_type ごとの必須条件 | AI / 人間 |
| [template_policy.md](./template_policy.md) | テンプレートの解決手順(同階層 → 上)と H2 語彙の closed / open | AI |
| [reference_policy.md](./reference_policy.md) | 参照キー(norms / decisions / definitions)の意味と参照の可否 | AI / 人間 |
| [dependency_policy.md](./dependency_policy.md) | 実装レベルの依存(`dependencies`)の意味と記載形式 | AI |
| [change_policy.md](./change_policy.md) | 変更時の ADR 要否・breaking change の定義・最低チェック | 人間 / AI |
| [subcategory_policy.md](./subcategory_policy.md) | 層の内部(standards / playbooks、conventions / layers)の責務分け | AI |
| [markdown_conventions.md](./markdown_conventions.md) | Markdown の書き方(コードブロックの言語指定・ネスト禁止・見出し) | AI / 人間 |
| [agent_naming_policy.md](./agent_naming_policy.md) | 生成と評価を分ける役割分担と、その名付けの規則 | AI / 人間 |
| [ai_reference_guide.md](./ai_reference_guide.md) | フロントマターの参照を上位へ辿るときの手順 | AI |

読む順に迷ったら、doc_types → placement_policy → frontmatter_policy → id_policy の 4 本で新しい文書は書ける。残りは必要になったときに引く。

## 参照するもの

- [../playbooks/how-to-create-rules.md](../playbooks/how-to-create-rules.md) — ここの standards を順に適用してルール文書を 1 本作る手順。**standards は参照される側であり、手順を持たない**(subcategory_policy)
- [../playbooks/rule-update.md](../playbooks/rule-update.md) — 既存のルール文書を直す手順
- [../playbooks/rule-evaluation.md](../playbooks/rule-evaluation.md) — 書き上がったものを独立の目で評価するチェックリスト
