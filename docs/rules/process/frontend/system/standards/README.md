---
id: DG-FE-0013
doc_type: directory_guide
scope: frontend
norms: [PRIN-0002, PRIN-0007]
---

# process / frontend / system / standards

フロントエンドの**コードを書くうえでのルール・基準(規約)**の置き場。規約は好みの表明ではなく、**読みやすさと一貫性を保つための規範**であり(PRIN-0002)、同じ判断を各画面が別々に下し直さないためにある。

## 配下の構成

| パス | 内容 |
|------|------|
| [conventions/](./conventions/README.md) | テスト・スタイル・命名等のコード規約。現在は [screen-test.md](./conventions/screen-test.md)(画面テスト)と [styling.md](./conventions/styling.md)(デザイントークンと部品のスタイル) |

配下が 1 箱しかないのは、フロントエンドの規約がまだ層をまたいで分かれるほど増えていないためである。増えたときは conventions と並ぶ箱を足す。

## 参照するもの

- **仕様書のルール** — [specification/standards/](../../specification/standards/README.md)(画面仕様の構造・命名の規約)
- **テスト注釈(`@spec` / `@tc`)の正** — [action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md) の test_cases の節。仕様とテストの対応の書き方は backend 側に 1 つだけ置いてあり、frontend では持たない(PRIN-0007)
- **アーキテクチャ** — [architecture/system/frontend/](../../../../architecture/system/frontend/README.md)。現在は README のみで、構成を定める ARCH は未整備である

## 整備方針

必要になった文書から追加する。**conventions 配下に規約を追加する場合は [conventions/template.md](./conventions/template.md) に従う。**
