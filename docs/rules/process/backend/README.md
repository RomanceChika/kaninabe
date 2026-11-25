---
doc_type: directory_guide
id: DG-BE-0004
norms: []
scope: backend
---

# process/backend — バックエンドのプロセス

バックエンドの作業手順とルールの入口。**プロセスを 2 軸で割る**——仕様を作るルール(Specification)と、コードを書くルール(System)。そのそれぞれに基準(standards)と手順(playbooks)を置き、合計 4 箱にする。

分け方の理由は単純で、**基準と手順は寿命が違う**からである。基準は決めたら滅多に変わらず、手順は道具立てが変わるたびに書き直される。同じ文書に混ぜると、手順を直すたびに基準まで揺れる。

## 配下の構成（4 箱）

| 箱 | 中身 | 状態 |
|---|---|---|
| [specification/standards/](./specification/standards/README.md) | 仕様のルール・基準(仕様書の書き方・テンプレート) | `action-spec-writing.md` / `query-spec-writing.md` が整備済み |
| [specification/playbooks/](./specification/playbooks/README.md) | 仕様を書く手順 | 骨格のみ(README と template だけ) |
| [system/standards/](./system/standards/README.md) | コードのルール・基準。配下に `conventions/` と `layers/` を持つ | `conventions/` はこのリポジトリで最も厚い領域。`layers/` は骨格 |
| [system/playbooks/](./system/playbooks/README.md) | コードを書く手順 | 骨格のみ(README と template だけ) |

**手順の箱が空である**のは事実として書いておく。実運用の実装手順は `.claude/skills/{add-operation,add-query,add-screen}/SKILL.md` が担っており、それらは**手順の索引であって正典ではない**。内容の正はこの 4 箱と architecture 側にあり、食い違ったらこちらが正である。

## テンプレート（template_policy）

各階層に `template.md` を置いてある。新規文書を書くときに従うテンプレートは、解決順「**同階層 → 上**」で決まる([template_policy.md](../../meta/standards/template_policy.md))。同じディレクトリの `template.md` を使い、無ければ 1 つ上へ遡る。

4 箱でテンプレートが違うのは意図的である。standards のテンプレートは「すべきこと / してはいけないこと」の 2 ラベルで基準を書く形、playbooks のテンプレートは番号付き手順を H3 で展開する形になっている。**どちらのテンプレートが解決されたかが、その文書が基準なのか手順なのかを決めている。**

## 参照するもの

| 知りたいこと | 正の場所 |
|---|---|
| 仕様書の配置・構成 | [ARCH-SP-BE-0001](../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)(`docs/specs/backend/{actions,queries}/` の配置と、パス ⇔ ドメインイベント ID の一意対応) |
| コードのレイヤー・ディレクトリ | [architecture/system/backend/](../../architecture/system/backend/README.md)(ARCH-BE-0001 ほか) |
| 原則 | [principles/](../../principles/README.md) |

配置とレイヤーの定義は architecture 側が正である。ここで再定義しない。
