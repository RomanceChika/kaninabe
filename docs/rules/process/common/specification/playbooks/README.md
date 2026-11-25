---
doc_type: directory_guide
id: DG-0041
norms: [PRIN-0001, PRIN-0006, PRIN-0007]
scope: common
---

# specification/playbooks — 仕様の作成・変更の手順

スコープ非依存の**手順書**(手を動かす順序)を置く箱である。宣言的な基準は置かない。基準は [../standards/](../standards/README.md) にあり、手順側からはそこへリンクする。

## 配下の文書

| 文書 | 内容 |
|---|---|
| [human-review-guide.md](./human-review-guide.md) | 人間レビューの手引き — ハンドブック(docs/book/)の読み方2モードと、判断ポイント・落とし先 |
| [system-spec-route.md](./system-spec-route.md) | システム全体の仕様化ルート(構想 → シミュレーション → A/B/C/D → 決定 → 本採用 → 実装)と人間レビューの3点セット |
| [domain-spec-change.md](./domain-spec-change.md) | ドメイン仕様(`docs/specs/domain/`)の追加・変更の標準手順。編集 → verify ループ → generate → 意味レビュー → 判断の記録 → コミット |
| [dsl-extension-triage.md](./dsl-extension-triage.md) | 「DSL に書けない」に当たったときの判定手順。迂回パターン集との突合 → 別の見方からの検討 → 2実例ルール → 起票。**拡張候補を起票する前に通す関門**であり、迂回の実例集(追記専用)もここが持つ |

先頭の1本は CLAUDE.md のルーティング表の第一エントリ(「ドメイン仕様の追加・変更」)であり、人間が手で回すときの手順書であると同時に、**Skill が実行する台本**でもある。`.claude/skills/add-operation/SKILL.md` はこの手順をそのまま踏む。台本は既に稼働しているので、手順を変えるときは Skill 側の踏み順とずれないかを確認する。

## 参照するもの

| 知りたいこと | 正 |
|---|---|
| 仕様の書き方(YAML スキーマ / ガード式の文法 / 検証チェック V1〜V12) | [../standards/domain-spec-writing.md](../standards/domain-spec-writing.md) |
| 仕様書をどこに・どういう構成で置くか | [ARCH-SP-0002](../../../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md)(`docs/specs/domain/` の構成) |
| 新しい playbook を書くときのテンプレート | 上位の [process/template.md](../../../template.md)(この階層に `template.md` は無い) |

## 整備方針

**置くもの** = 仕様の作成・変更の手順。**置かないもの** = 宣言的な基準(→ `../standards/`)。スコープ固有の手順もここには置かず、backend / frontend の `specification/playbooks/` へ振る。

手順を書くときは次の2条を守る。この2条がこの箱の実質であり、単なる一覧ではない。

- **完了を判定できる形で書く。** 各手順は「実行するコマンド」と「通ったと言える状態」の対で書く。「レビューする」では終わったかどうかが本人にしか分からず、Skill に渡したときに判定が消える(PRIN-0006)。
- **重複を作らない。** 同じ内容を standards と両方に書かない。手順側は「何を満たすべきか」を書かず、基準へリンクして「それを満たしたことをどう確かめるか」だけを書く(PRIN-0007)。

配下が少数でもこの README を残しているのは、standards / playbooks を持つ枝はすべて入口を持つという構造の規律による。
