---
doc_type: directory_guide
id: DG-0020
norms: []
decisions: [ADR-0005]
scope: repository
---

# architecture — 構造の正典

この層が守るのは「**構造の正が 1 か所にある**」ことである。どの層がどの層に依存してよいか、仕様書をどこに置くか、ツールコードをどう束ねるか —— これらは実装やテンプレートが各自の都合で決めてよい事柄ではなく、ここから導出される。

**この README が architecture の唯一の入口である**(人間にとっても AI にとっても)。根拠は [ADR-0005](../decisions/common/ADR-0005-single-entry-point.md)。AI 向けの案内も別ファイル(`AI.md`)を立てず、この文書の 1 節として持つ。入口が 2 枚になった瞬間、どちらが古いかを誰も判定できなくなる。

階層上の位置は、[principles](../principles/README.md) の下・process と `docs/specs/` が参照する側である。原則から導かれた要請を構造として具体化し、手順(process)と仕様(`docs/specs/`)がそれを前提に書かれる。

---

## 3種のアーキテクチャ

architecture が扱う「構造」は 3 種類ある。**どれに当たるかでディレクトリが決まる。**

| 種別 | パス | 内容 |
|------|------|------|
| system | [system/](./system/README.md) | コード・実行系の構造。レイヤー構成、ディレクトリ配置、依存の向き、技術スタックの構造 |
| specification | [specification/](./specification/README.md) | 仕様書作成レベルの構造。`docs/specs/` の構成、仕様書の分割方針・命名 |
| tooling | [tooling/](./tooling/README.md) | ツールコードの構造。検証ツール・生成ツールの統合方針、依存の向き、エントリポイント設計 |

スコープ(`common` / `backend` / `frontend`)は、**system と specification のそれぞれの直下**に置く。tooling はスコープ横断の `common/` のみを持つ。

### 書かないこと

この層に書いてはいけないものが 3 つある。どれも「置き場所が別にある」という理由であって、書く価値が無いという意味ではない。

| 書かないもの | どこに書くか | 理由 |
|---|---|---|
| 個々の操作・読み取り・画面の仕様 | `docs/specs/` | 構造は仕様の器であって中身ではない。中身をここに書くと仕様の変更でアーキテクチャ文書が動く |
| 「なぜその構成にしたか」の詳細 | [decisions/](../decisions/README.md) | 決定の経緯は時点情報である。構造の記述に混ぜると、決定が覆ったときにどこを直すか分からなくなる |
| 実装の手順 | [process/](../process/README.md) | 「どう書くか」は「何をどこに置くか」より変わりやすい。同じ文書に同居させると寿命の違う記述が混ざる |

### テンプレート

構造の概要を書くか、層の詳細を書くかでテンプレートが分かれる。

| 書くもの | テンプレート |
|---|---|
| 構成の概要(system / tooling 配下の ARCH 文書) | [architecture/template.md](./template.md) |
| 仕様書の構成(specification 配下の ARCH-SP 文書) | [architecture/specification/template.md](./specification/template.md) |
| 層の詳細 | [process/backend/system/standards/layers/template.md](../process/backend/system/standards/layers/template.md) |

ID の採番とフロントマターの書式は [id_policy.md](../meta/standards/id_policy.md) と [frontmatter_policy.md](../meta/standards/frontmatter_policy.md) に従う。

---

## AI向けナビゲーション

この節は「何を探すときにどこを見るか」の索引である。**別ファイルにしない**(ADR-0005)。

### 責務の再掲

- **system** が扱うのは、レイヤー構成 / 依存の向き / ディレクトリ配置 / 各層の責務と実装のきまりの所在である。`app/` は単一パッケージであり、UI もサーバー側も同じ依存グラフの中にある。層の一覧と依存方向の正は [ARCH-BE-0001](./system/backend/ARCH-BE-0001-app-layer-structure.md)。
- **specification** はここでは大枠だけを示す。詳細は [specification/README.md](./specification/README.md) に委譲する。
- **tooling** が扱うのは、ツール統合の方針(検証系・生成系)、依存の向き、エントリポイントの設計の 3 点である。

### 参照パス

| 探しもの | 見る場所 |
|---|---|
| リポジトリ全体の構成・計算基盤の配置 | [system/common/](./system/common/README.md) |
| `app/` の層構成と依存方向、サーバー側の主要構造 | [system/backend/](./system/backend/README.md) |
| 層ごとの構造文書 | [system/backend/layers/](./system/backend/layers/README.md) |
| UI 側のコード構造 | [system/frontend/](./system/frontend/README.md) |
| ドメイン仕様の構成 | [specification/common/](./specification/common/README.md) |
| バックエンド仕様の構成 | [specification/backend/](./specification/backend/README.md) |
| フロントエンド仕様の構成 | [specification/frontend/](./specification/frontend/README.md) |
| 検証ツール・生成ツールの設計方針 | [tooling/common/](./tooling/common/README.md) |
