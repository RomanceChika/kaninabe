---
doc_type: directory_guide
id: DG-FE-0007
norms: []
scope: frontend
---

# process / frontend / specification

フロントエンド仕様書のルール——**構造・命名・配置・テスト追跡**の 4 種——の入口。画面仕様を書く人がまず来る場所であり、書かれた仕様そのもの(`docs/specs/frontend/`)はここには無い。

配下は 2 箱ある。

| パス | 中身 |
|------|------|
| [standards/](./standards/README.md) | 仕様書の書き方・基準([screen-spec-writing.md](./standards/screen-spec-writing.md) / [ux-lint.md](./standards/ux-lint.md) / [template.md](./standards/template.md)) |
| playbooks/ | 仕様を書く手順書の置き場。現在は[型紙](./playbooks/template.md)のみで、実文書はまだ無い |

## Standards（基準）

| 文書 | 何を定めるか |
|------|------------|
| [screen-spec-writing.md](./standards/screen-spec-writing.md) | 画面仕様(`screen_spec`)と共通枠(`chrome_spec`)の YAML スキーマ、および検証器が実行する検査 S0〜S10 |
| [ux-lint.md](./standards/ux-lint.md) | UX 経験則の機械検査(U 群 U1〜U5・台帳の整合 U8)の定義・UX 原則の台帳・閾値・画面ごとの受け入れ(`ux:`)の書式。U 群の経験則の指摘はすべて warning である |
| [template.md](./standards/template.md) | このディレクトリに新しい基準文書を足すときの型紙 |

U2 は長く欠番だった(ボタンの語が実装の手書きで、静的に比べられなかったため)が、画面の生成物が語を宣言から引くようになった 2026-10-03 に解禁した。検査番号は設計と実装でずれないよう欠番を詰めなかった。U6 / U7 は検査が無く、UX 原則の台帳に `advisory` の席だけがある(理由は ux-lint.md が持つ)。

## 参照するもの

- **配置・分割** — [architecture/specification/frontend/](../../../architecture/specification/frontend/README.md) の ARCH-SP-FE-0001。**未整備である**
- **ドメイン仕様の配置** — [ARCH-SP-0002](../../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md)。画面仕様が他の仕様を再定義しないという線引きの根拠
- **仕様の実体** — `docs/specs/frontend/screens/`([雛形](../../../../specs/frontend/screens/template.screen_spec.md)) / `docs/specs/frontend/chrome/`([雛形](../../../../specs/frontend/chrome/template.chrome_spec.md))
- **実装側の規約** — [system/standards/conventions/](../system/standards/conventions/README.md)(画面テストとスタイル)

## 補足: 正規な参照関係と将来方針

**フロントエンド仕様の正(canonical)は、配置・分割については ARCH-SP-FE-0001、書き方については本ディレクトリ配下の `standards/*.md` である。** この 2 つ以外を「フロントエンド仕様のルール」として引かない。

**バックエンドの仕様書やバックエンドの process は、UI の契約や画面仕様の正ではない。** 参照するのは任意だが、**スタックが異なるためスキームを同一視しない**。action_spec の節構成が screen_spec にそのまま当てはまるとは限らず、似ているという理由で片方の規約をもう片方へ持ち込むと、両者の変更が互いを縛り始める。

画面と backend の接点の正は、それぞれの仕様の側にある。操作の正は `action_spec`(`docs/specs/backend/actions/`。[雛形](../../../../specs/backend/actions/template.action_spec.md))、読み取り経路の正は `query_spec`(`docs/specs/backend/queries/`。[雛形](../../../../specs/backend/queries/template.query_spec.md))であり、`screen_spec` が書くのはそれらの**名前への参照**だけである。別スタック間の API 契約という層は現構成には無い(ARCH-SP-0002 の決定により `docs/specs/common` は使わない)。

**将来 `specification/common` 等へ抽出する条件**は 2 つで、どちらかに当たったときに「1 つの正 + 双方からリンク」へ寄せる。

1. 同じ説明を複数スタックの standards で**二重に保守し始めた**とき
2. クロススタック専用の ARCH を新設するほうが、既存の書き分けより簡潔になるとき

条件を書かずに「いずれ共通化する」とだけ書けば、その先送りは判定できないまま死ぬ。条件つきで残すのは、到来したかどうかを後から誰でも判定できるようにするためである。
