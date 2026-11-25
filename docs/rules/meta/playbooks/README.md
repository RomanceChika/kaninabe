---
id: DG-0012
doc_type: directory_guide
scope: repository
norms: []
---

# meta/playbooks — ルール文書を作る・直す・評価する手順

ここに置くのは**手順**である。ルール文書を新しく起こす、既存のものを直す、書き上がったものを評価する —— この 3 つの手続きを並べる。

**定義そのものはここに書かない。** playbooks は [../standards/](../standards/README.md) を参照する側であり、逆はしない。手順の中で定義の説明が要るときは、要約や転記ではなくリンクで済ませる。そうしないと同じ定義が 2 か所に増え、片方だけが古くなる(PRIN-0007。分担の根拠は [../standards/subcategory_policy.md](../standards/subcategory_policy.md))。

**この一覧が meta 配下の playbooks の正である。** 親の [../README.md](../README.md) は目的別の導線だけを持つ。

## Playbooks

| Playbook | 用途 |
|---|---|
| [how-to-create-rules.md](./how-to-create-rules.md) | ルール文書を新しく 1 本作る。doc_type の判定から上位原則との整合確認まで |
| [rule-update.md](./rule-update.md) | 既存のルール文書を直す。影響分析と廃止の作法を含む |
| [rule-evaluation.md](./rule-evaluation.md) | 書き上がったルール文書をレビュアーが 6 観点で評価する |
| [rule-generation-workflow.md](./rule-generation-workflow.md) | 上の 3 本を「設計 → 実装 → 独立レビュー → 裁定」のループに組む段取り |

CLAUDE.md のルーティング表が名指ししているのは how-to-create-rules.md である。ルール文書を足す作業はそこから入る。

## 参照するもの

手順の各項目が従う定義は [../standards/](../standards/README.md) にある。

- [doc_types.md](../standards/doc_types.md) — 文書の種類の定義。何を書き、何を書いてはいけないか
- [placement_policy.md](../standards/placement_policy.md) — doc_type × scope からの配置の決定
- [id_policy.md](../standards/id_policy.md) — ID の形式・採番・再利用禁止
- [frontmatter_policy.md](../standards/frontmatter_policy.md) — フロントマターの項目と必須条件
- [template_policy.md](../standards/template_policy.md) — テンプレートの解決手順
- [reference_policy.md](../standards/reference_policy.md) — 参照キーの意味と参照の可否
- [change_policy.md](../standards/change_policy.md) — 変更時の ADR 要否と最低チェック
- [subcategory_policy.md](../standards/subcategory_policy.md) — standards と playbooks の責務分け
- [markdown_conventions.md](../standards/markdown_conventions.md) — Markdown の書き方
- [dependency_policy.md](../standards/dependency_policy.md) — 実装レベルの依存の書き方
- [agent_naming_policy.md](../standards/agent_naming_policy.md) — 生成と評価を分ける役割分担
- [ai_reference_guide.md](../standards/ai_reference_guide.md) — 参照を上位へ辿る手順
