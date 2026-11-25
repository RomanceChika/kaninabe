---
id: DG-BE-0022
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001, PRIN-0005]
---

# process/backend/system/standards — コードのルール・基準

バックエンドの**コードを書くときのルール・基準**を置く箱である。手順書(playbooks)ではなく、守るべき状態の側を書く。置くものは 2 種類しかない —— 層をまたいで効く**規約**(conventions)と、特定の層に閉じた**きまり**(layers)。

## 配下の構成

| ディレクトリ | 何を置くか |
|---|---|
| [conventions/](./conventions/README.md) | 層をまたいで効くコードの共通規約。Server Action・クエリ関数・Route Handler・構造化ログの各規約と、配下の `testing/`(テスト規約)・`enforcement/`(機械執行ルールの全件一覧)・`security/`(セキュリティ規約の箱) |
| [layers/](./layers/README.md) | 層ごとの実装のきまりとコード例。1 層 = 1 ディレクトリで、`domain` / `operation` / `infrastructure` / `presentation` / `composition` の 5 つ |

**層の構造・責務・依存方向そのものはここには置かない。** それは [ARCH-BE-0001](../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) が正である。ここに書くのは「その構造のとおりに書くための形」であり、構造の定義を二重に持たない。

規約と層の振り分けは**層をまたぐかどうか**で決まる。Server Action の書き方もテストの書き方も複数の層を貫くので `conventions/` に置き、ある層の内側だけで完結するきまりだけを `layers/` に置く。実運用では前者が先に育っており、`layers/` 配下は現在すべて骨格(README のみ)である。

なお、日々の作業でここを目次として辿ることは少ない。実際の入口はリポジトリ直下の `CLAUDE.md` のルーティング表であり、「やること」から該当の規約へ直接飛ぶ。この README は、そこに載っていない文書を探すときと、新しい規約を**どこに置くか**を決めるときに読むものである。

## テンプレート

新規文書は同階層の [template.md](./template.md) に従う。ただし**下位のテンプレートが優先**する —— `conventions/` 配下なら [conventions/template.md](./conventions/template.md)、`layers/` 配下なら [layers/template.md](./layers/template.md)、さらにその下の `enforcement/` / `testing/` にはそれぞれ専用の `template.md` がある。テンプレートの解決は「同階層 → 上の階層」の順で行う。

## 参照するもの

- [architecture/system/backend](../../../../architecture/system/backend/README.md) —— 層の構造と責務、依存方向の定義。規約が「そのとおりに書く」対象である正典
- [process/backend/specification/standards](../../specification/standards/README.md) —— 仕様(action_spec / query_spec)の書き方。**仕様のルールはコードのルールとは別系統**であり、ここには置かない
- 規範は [ARCH-BE-0001](../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)(`app` パッケージの層構成と依存方向)と [PRIN-0005](../../../../principles/common/PRIN-0005-respect-boundaries.md)(境界の尊重)の 2 つ。この配下の規約はすべて、この 2 つが定めた境界をコードの上で守らせるためにある
