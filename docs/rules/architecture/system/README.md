---
doc_type: directory_guide
id: DG-0022
norms: []
scope: repository
---

# architecture/system — コードの構造

この階層が担当するのは、**コード・実行系のアーキテクチャ**である。レイヤー構成、ディレクトリ配置、依存の向き、技術スタックの構造がここに集まる。

仕様書の構成は [specification/](../specification/README.md)、ツールコードの構造は [tooling/](../tooling/README.md) が持つ。ここに書くのは「動くコードの形」だけである。

---

## 構成

| スコープ | パス | 内容 |
|---|---|---|
| common | [common/](./common/README.md) | リポジトリ全体の構成。計算基盤の配置ポリシー(ARCH-0001) |
| backend | [backend/](./backend/README.md) | `app/` パッケージの層構成と依存方向(ARCH-BE-0001)。Server Action・読み取り経路・外部連携・非同期ジョブそれぞれの構造。層の詳細は [backend/layers/](./backend/layers/README.md) に委譲する |
| frontend | [frontend/](./frontend/README.md) | UI 側のコード構造。配下に `ARCH-FE-xxxx` はまだ無い。層構成と依存方向は `app/` 全体を扱う ARCH-BE-0001 が持つ |

`ARCH-xxxx` / `ARCH-BE-xxxx` を足したら、この表の内容欄も合わせて直す。**上位の一覧が下位より遅れている状態を作らない。**

### frontend が空でも困らない理由

`app/` は**単一パッケージ**であり、UI もサーバー側も同じ依存グラフの中にある。したがって層構成と依存方向は FE 専用に立て直す必要がなく、[ARCH-BE-0001](./backend/ARCH-BE-0001-app-layer-structure.md) が全体を扱う。FE 専用の層文書を別に立てると、1 つの依存グラフに 2 つの正典ができる。

### テンプレート

| 書くもの | テンプレート |
|---|---|
| 構成の概要 | [architecture/template.md](../template.md) |
| 層の詳細 | [process/backend/system/standards/layers/template.md](../../process/backend/system/standards/layers/template.md) |
