---
doc_type: directory_guide
id: DG-0016
norms: []
decisions: [ADR-0005]
scope: repository
---

# principles — 原則

守るべき大原則(principle)を置く層。**この README がこの層の唯一の入口**であり、人間も AI もここから入る。

principle は憲法にあたる。抽象度は高く保ち、「ここでは〇〇する」型の個別の実施ルールは書かない。それらは process・規約文書の側に、**大原則の適用**として置く。レイヤー構成・依存関係・ディレクトリ構造は [architecture](../architecture/README.md) の担当である。

## 構成

| ディレクトリ | 中身 |
|---|---|
| [common/](./common/README.md) | スコープに閉じない共通の原則(`PRIN-0001-xxx` 形式)。**現在ある原則 11 本の一覧は common の README が持つ** |
| [backend/](./backend/README.md) | backend 固有の原則(`PRIN-BE-0001-xxx` 形式)。現在 0 本 |
| [frontend/](./frontend/README.md) | frontend 固有の原則(`PRIN-FE-0001-xxx` 形式)。現在 0 本 |

**原則の一覧をここには置かない。** 一覧の出典は [common/README.md](./common/README.md) 1 か所であり、この README はそこを指すだけである([PRIN-0007](./common/PRIN-0007-single-source-of-truth.md))。

- 各原則は、この README と同じ階層の [template.md](./template.md) に従って書く(template_policy の「同階層 → 上」で解決される)。
- ID とフロントマターは [id_policy](../meta/standards/id_policy.md) / [frontmatter_policy](../meta/standards/frontmatter_policy.md) に従う。

## AI向けナビゲーション

- **この層の責務**: 守るべき大原則を定義する。実装の手順は [process](../process/README.md)、レイヤー構成は [architecture](../architecture/README.md) にある。
- **他の層との関係**: principle は上位概念である。process と spec が principle を参照する。**principle から process を参照してはならない**([reference_policy](../meta/standards/reference_policy.md))。
- **スコープの関係**: common が共通の原則を持つ。backend / frontend の原則が common に準拠する場合は、フロントマターの `norms` に common の原則 id を列挙する。
- **次にどこへ行くか**: 原則を読むなら [common/](./common/README.md)。置き場所・ID・フロントマターの決まりを知りたいなら [meta](../meta/README.md)。新しい原則を書くなら [template.md](./template.md)。

## 整備方針

common から整備し、続いて backend / frontend を同じ構成で揃える。

現状、common は 11 本、backend と frontend は 0 本である。スコープ固有の原則を起こす条件は、**common で言い切れない事情が実際に出た時点**であり、先回りして作らない。各スコープの起票条件は [backend/README.md](./backend/README.md) と [frontend/README.md](./frontend/README.md) が持つ。

backend 固有の原則の候補として「観測可能性は境界で扱う」が挙がっているが、**まだ起こしていない**(`PRIN-BE-0001` は欠番ではなく未採番である)。

## principle と architecture の切り分け

この層で最も間違えやすいのが、principle と architecture の線引きである。

| | 書くもの | 例 |
|---|---|---|
| **principle**(principles) | 憲法レベル。抽象度が高く、個別論へ落とさないもの | 可読性を保つ / 観測可能性を境界で扱う / テスト可能な設計を保つ |
| **architecture**(architecture) | レイヤー構成・依存関係・ディレクトリ構造。「構成」の部分 | [ARCH-BE-0001](../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)(`app` の層構造と依存の向き) |

**principle に書いてはいけないもの**の見本を挙げる。いずれも個別論であり、記述先は process・規約文書の側である(大原則の**適用**という位置づけで置く)。

- コメントを必須にする
- エラーログを出す位置は Server Action の側とする
- 操作(operation)の戻り値は共通の `Result` 型に揃える
- ユニットテストの対象層は domain と operation とする

見分け方は 1 つで、**「ここでは」「この層では」と言い出したら、それは principle ではない**。原則は場所を指定しない。
