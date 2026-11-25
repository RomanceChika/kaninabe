---
doc_type: directory_guide
id: DG-FE-0004
norms: []
scope: frontend
---

# process / frontend

フロントエンドのプロセス文書の入口。**画面仕様をどう書くか**と**画面のコードをどう書くか**の 2 箱に分かれる。実装手順・テスト手順・レビューの決まりのうち、frontend に属するものはすべてこの下にある。

| パス | 何の話か | いま実在する正典 |
|------|---------|----------------|
| [specification/](./specification/README.md) | 画面仕様(`screen_spec` / `chrome_spec`)の書き方・検査・免除の書式 | [screen-spec-writing.md](./specification/standards/screen-spec-writing.md) / [ux-lint.md](./specification/standards/ux-lint.md) |
| [system/](./system/README.md) | 画面のコードの規約(画面テスト・スタイル) | [screen-test.md](./system/standards/conventions/screen-test.md) / [styling.md](./system/standards/conventions/styling.md) |

**この 2 箱の線は「仕様書の話」と「コードの話」である。** architecture が specification / system で分けているのと同じ分割で、process 側もその対応関係を保つ。画面が何を読み・何を発火し・どこへ遷移するかは仕様(specification)、それを RSC と CSS でどう書くかはコード(system)である。

仕様の実体そのもの(YAML)はこのディレクトリではなく `docs/specs/frontend/` にある(雛形は [template.screen_spec.md](../../../specs/frontend/screens/template.screen_spec.md))。ここに置くのはその**書き方**であって、書かれた仕様ではない。

## 参照するもの

- **構成** — [architecture/system/frontend/](../../architecture/system/frontend/README.md)(フロントエンドの構成)、[architecture/specification/frontend/](../../architecture/specification/frontend/README.md)(フロントエンド仕様の配置・分割)。どちらも README のみで、ARCH-SP-FE-0001 は未整備である
- **原則** — [principles/](../../principles/README.md)。プロセスの決まりが何のためにあるかは原則に遡る
- **仕様の実体** — `docs/specs/frontend/screens/`(画面。雛形は [template.screen_spec.md](../../../specs/frontend/screens/template.screen_spec.md))、`docs/specs/frontend/chrome/`(共通の枠。[template.chrome_spec.md](../../../specs/frontend/chrome/template.chrome_spec.md))、`docs/specs/frontend/design/`(デザイントークン。[template.design_token_spec.md](../../../specs/frontend/design/template.design_token_spec.md))

## 整備方針

必要になった文書から追加してよい。frontend の規約は**実物と併走して書く**のが実際の進み方で、画面仕様の書き方は画面が 9 枚出そろう過程で、スタイルの規約はその 9 枚を見ながら確定した。実物が無いうちに書いた規約は、実物が出た瞬間に書き直しになる。

読む側の入口としては、CLAUDE.md のルーティング表が第一である。「画面仕様を足す」「画面を 1 枚足す」といった目的から、この README を経由せずに配下の正典へ直接飛ぶ経路が敷いてある。この README は**どこに何があるかを俯瞰したいとき**のための地図であり、日常の作業導線ではない。
