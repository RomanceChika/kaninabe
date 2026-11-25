---
doc_type: directory_guide
id: DG-0021
norms: []
scope: repository
---

# architecture/specification — 仕様書の構造

この階層が担当するのは「**仕様書をどこに置き、どう分けるか**」である。`docs/specs/` のディレクトリ構成、仕様書の分割方針、仕様ファイルの命名 —— つまり「仕様書作成」に関する構造がここに集まる。

仕様の**中身**(状態機械の定義、操作の契約、画面の配線)はここには書かない。書き方の規約は process 側にあり、実物は `docs/specs/` にある。ここが決めるのは器の形だけである。

---

## テンプレート

specification 配下の文書は、**同階層の [template.md](./template.md)** に従って作成する。

テンプレートの解決は [template_policy.md](../../meta/standards/template_policy.md) どおり「同じディレクトリに無ければ 1 つ上を参照する」であり、specification/common・specification/backend・specification/frontend のいずれも同階層にテンプレートを持たないため、この 1 枚に解決される。

**system 用のテンプレート([../template.md](../template.md))とは見出し構成が違う。** system 用はレイヤーと依存の向きを書くための節構成を持ち、specification 用は仕様書の構成・命名・分割に特化した節構成を持つ。混ぜて使わない。

---

## ディレクトリ構成

| スコープ | パス | 内容 | ID |
|---|---|---|---|
| common | [common/](./common/README.md) | 仕様書のトップ構成、ドメイン仕様の配置など FE/BE 双方が参照する共通方針 | `ARCH-SP-0002` 以降 |
| backend | [backend/](./backend/README.md) | バックエンド仕様(`docs/specs/backend/` の `actions/` と `queries/`)のディレクトリ構成とファイル対応 | `ARCH-SP-BE-0001` 以降 |
| frontend | [frontend/](./frontend/README.md) | フロントエンド仕様(`docs/specs/frontend/` の `screens/` `chrome/` `design/`)のディレクトリ構成 | `ARCH-SP-FE-0001` 以降 |

スコープを足したらこの表に行を足す。

### 採番の規範

- **specification は system と採番を共通にしない。** `ARCH-SP-xxxx` / `ARCH-SP-BE-xxxx` / `ARCH-SP-FE-xxxx` を使う。仕様書の構成とコードの構造は寿命も改訂の理由も違うため、同じ番号空間に混ぜると片方の欠番が他方を巻き込む。
- **各スコープで 0001 から採番する。** ただし common の `ARCH-SP-0001` は移植元で使用済みのため欠番であり、common に実在するのは `ARCH-SP-0002` から。事情は [common/README.md](./common/README.md) を参照。
- 詳細は [id_policy.md](../../meta/standards/id_policy.md) に従う。
