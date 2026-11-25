---
doc_type: directory_guide
id: DG-BE-0005
norms: []
scope: backend
---

# process/backend/specification/playbooks — 仕様を書く手順

仕様書の作成・更新の**手順だけ**を置く箱。何が正しい仕様の形かは [standards/](../standards/README.md) が持ち、ここはその形に至る順序だけを持つ。

## 目的

1. **新規仕様書の作成手順を標準化する。**
2. **既存仕様書の更新手順を標準化する。**
3. **仕様書管理の道具の使い方を提供する。**
4. **PRIN-0007(Single Source of Truth)と PRIN-0008(Traceability)を運用で実現する。** 原則は「正は 1 か所」「仕様とテストは相互に辿れる」と言うが、それが実際に保たれるかは手順の順序で決まる。生成より先にテーブルを手で直せば正が 2 つになり、注釈を後回しにすればトレースが切れる。

## Playbooks

| 文書 | 内容 | 参照する Skill |
|---|---|---|
| （未整備） | — | — |

**この箱は現在空である。** 実運用で仕様を書く手順は次の 2 つが担っている。

- [process/common/specification/playbooks/domain-spec-change.md](../../../common/specification/playbooks/domain-spec-change.md) — ドメイン仕様を変える手順。CLAUDE.md のルーティング表の筆頭に置かれている。
- `.claude/skills/add-operation/SKILL.md` / `.claude/skills/add-query/SKILL.md` — 操作を 1 つ、読み取り経路を 1 本足すときの実行版。**スキルは手順の索引であって正典ではない。**

### 複雑なケース（今後追加予定）

次の 3 つは手順文書としては未着手である。作業の予約としてここに残す。

| 予定している手順 | 内容 | 現状 |
|---|---|---|
| 複数層に跨る作成 | 複数の仕様書を整合的に作成する手順 | 未着手 |
| 影響分析と参照更新 | 既存仕様への影響分析と、相互参照の更新 | 検査としては V 群・A 群・Q 群・M 群が実装済み。手順文書は未着手 |
| 整合性チェック | 複数仕様書間の整合性の検証 | 同上 |

検証器が壊れた整合を**見つける**ところまでは自動化されている。見つかった後に**どの順で直すか**が、ここに書かれるべき残りである。

## 参照するもの

| 系統 | 中身 |
|---|---|
| Standards | [specification/standards/](../standards/README.md) — [action-spec-writing.md](../standards/action-spec-writing.md)(YAML スキーマと `@tc` の対応)、[query-spec-writing.md](../standards/query-spec-writing.md)(YAML スキーマと Q 群の検査) |
| Templates | 各ディレクトリの `template.md`、および仕様側のテンプレート `docs/specs/backend/actions/template.action_spec.md` / `docs/specs/backend/queries/template.query_spec.md`(配置の正は [ARCH-SP-BE-0001](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)) |
| Tools | `npm run verify`(仕様の意味検証とトレース)/ `npm run generate`(表・図・実装部品の生成)/ `npm run generate:check`(生成物の鮮度) |

## テンプレート

新しい playbook は**同階層の `template.md`** に従う。目的 → 前提条件 → 番号付きの手順概要 → H3 での手順展開、という二段構えが手順文書の共通形である。この形が崩れると、基準(standards)と手順(playbooks)の書き分けが見た目から消える。
