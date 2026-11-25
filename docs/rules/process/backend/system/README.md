---
doc_type: directory_guide
id: DG-BE-0009
norms: []
scope: backend
---

# process/backend/system — コードを書く側のルールと手順

バックエンドで**コードを書くうえでの** standards(ルール・基準)と playbooks(手順)の入口。architecture の system に対応する箱であり、あちらが層の構造と責務を、ここがその中で書くコードの決まりと順序を持つ。

**仕様のルールと実装のルールを混ぜない。** 仕様側は [../specification/](../specification/README.md) が別に持つ。

## 配下の構成

| 箱 | 中身 | 状態 |
|---|---|---|
| [standards/](./standards/README.md) | コードのルール・基準。配下に `conventions/`(規約)と `layers/`(層ごとの実装のきまり)を持つ | `conventions/` はリポジトリで最も整備の進んだ領域。Server Action・クエリ・ルートハンドラ・ログの規約、機械執行ルールの全件一覧(`enforcement/`)、正誤のコード例(`examples/`)、テスト規約(`testing/`)が揃っている。`layers/` は各層の README のみで骨格 |
| [playbooks/](./playbooks/README.md) | コードを書く手順(実装・レビュー・品質チェック) | 骨格のみ。実運用の手順は `.claude/skills/{add-operation,add-query,add-screen}/SKILL.md` が担っている |

**規約が厚く、手順が空である**のが現状の姿である。理由は、規約は機械(ESLint の境界 89 ルール = E 群、検証器の V / A / Q / S / M 群)が執行できるのに対し、手順は執行者を持てず、書いても守られたかを確かめられないからである。スキルが手順の受け皿になっているのは、そこに実行と検査がくっついているためである。ただし**スキルは手順の索引であって正典ではなく、`docs/rules/` 側にスキルの規約は作らない**。

## 参照するもの

| 知りたいこと | 正の場所 |
|---|---|
| 層の構造・責務・依存方向 | [architecture/system/backend/](../../../architecture/system/backend/README.md)([ARCH-BE-0001](../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) が層構造の正) |
| 仕様のルール・手順 | [../specification/](../specification/README.md) |

architecture の層文書は「責務・構成・何をどこに置くか」に絞ってあり、「どう書くか・実装例」はこの箱の `standards/layers/` と `standards/conventions/` に委ねられている。
