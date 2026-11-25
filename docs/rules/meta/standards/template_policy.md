---
doc_type: meta
scope: repository
---

# テンプレートポリシー — どの template が適用されるかの決め方

新しい文書を書くとき、**どのテンプレートに従うかを探索規則で一意に決める**ためのルールである。あわせて、テンプレートが H2 の集合をどこまで縛るかの宣言方法を定める。

同じ種類の文書が同じ順路で読めることに価値がある。読み手(人間も AI も)は「この種類ならこの節にこれが書いてある」という当てを持って読むからである。テンプレートはその当てを保証する仕掛けであり、**執行者は `npm run verify` の M5** である。

## テンプレートの種類

2 種類しかない。

| 置き方 | 適用範囲 |
|---|---|
| `template.md` | 汎用。そのディレクトリ配下の全 doc_type に適用される |
| `template.{doc_type}.md` | doc_type 別。特定の doc_type にのみ適用される(`template.screen_spec.md` など) |

## 基本ルール

- テンプレートは README と同じ階層に置ける
- **新規の文書は、解決されたテンプレートに従って作る**
- 解決の順序は**同じ階層 → 上の階層**。各階層の中では **doc_type 別テンプレートが汎用テンプレートより優先**する
- **同じ階層に複数の doc_type が混在する場合は `template.{doc_type}.md` を使う。** `template.md` はディレクトリにつき 1 つしか置けないため、doc_type が異なる文書に対応できない

## 解決手順（優先順位）

各ディレクトリで上から順に評価し、最初にマッチしたものを使う。

1. **`template.{doc_type}.md` があれば無条件で採用する**(doc_type が一致しているため)
2. **`template.md` があれば、そのフロントマターの `doc_type` と文書の `doc_type` を比べる**
   - 一致する、またはテンプレート側に `doc_type` の指定が無い → 採用する
   - **不一致 → 採用せず、上の階層へ探索を続ける**
3. どちらも無ければ、1 つ上の階層で 1 から繰り返す
4. `docs/` まで遡って見つからなければ「テンプレート未定義」とする(作成時は [doc_types.md](./doc_types.md) と [frontmatter_policy.md](./frontmatter_policy.md) に従う。M5 の対象にもならない)

**手順 2 の「不一致ならスキップして上へ」が最も間違えやすい。** 例えば `principles/template.md` のフロントマターが `doc_type: principle` になっているのはこの規則のためである。ここが `meta` のままだと、principle 文書に対して手順 2 が不一致となり、このテンプレートは採用されない。**テンプレート自身の `doc_type` は「誰に適用されるか」の宣言である。**

### docs/ ルートに置いてよい場合

ルート配置が許されるのは、**全ディレクトリに共通で現れる doc_type であり、かつ rules と specs の両方の木で書式が同一**であるときだけである。現状の該当は `directory_guide` の 1 つで、[docs/template.directory_guide.md](../../../template.directory_guide.md) として置いてある。

**それ以外の doc_type をルートに置くことを禁じる。** 理由は、配下の階層で解決されるべき文書が、遠くの 1 枚に引きずられる事故を防ぐためである。

### 解決の例

- **rules(1 つの木に 1 つの doc_type)** — `principles/frontend/` の文書は、`principles/frontend/template.md` があればそれを使い、無ければ `principles/template.md` を使う
- **specs(1 つの木に複数の doc_type)** — `docs/specs/frontend/screens/` の screen_spec は `screens/template.screen_spec.md` が配下の全グループに適用され、`docs/specs/frontend/chrome/` の chrome_spec は `chrome/template.chrome_spec.md` が適用される。同じ木に 2 つの doc_type が居るので `template.md` ではなく `template.{doc_type}.md` を使う

## 適用対象

| doc_type | 解決されるテンプレート |
|---|---|
| `directory_guide`(README.md) | [docs/template.directory_guide.md](../../../template.directory_guide.md)。rules / specs の全ディレクトリに現れるので木の根に 1 枚だけ置く。H2 の語彙は **open** |
| `principle` | README と同じ階層の `template.md`(`principles/` またはその配下の scope ディレクトリ) |
| `architecture`(system) | `architecture/template.md`。`system/` 配下は同階層に無ければこれが正本になる |
| `architecture`(specification) | `architecture/specification/template.md`。仕様書の構成・命名を書くためのもので、system 用とは見出しが異なる |
| `screen_spec` / `chrome_spec` | `docs/specs/frontend/screens/template.screen_spec.md` / `docs/specs/frontend/chrome/template.chrome_spec.md` |
| その他(process / decision ほか) | 同じ「同階層 → 上」で解決する |

`process/` は複数の階層に `template.md` を持つ。現状 18 枚あり、**より深い階層にあるものが勝つ**。内訳はスコープごとに揃っていない。

| スコープ | 置かれている場所 |
|---|---|
| ルート | `process/template.md` |
| backend(8 枚) | `specification/playbooks` / `specification/standards` / `system/playbooks` / `system/standards` / `system/standards/layers` / `system/standards/conventions` / 同 `conventions/enforcement` / 同 `conventions/testing` |
| frontend(4 枚) | `specification/playbooks` / `specification/standards` / `system/playbooks` / `system/standards/conventions` |
| common(4 枚) | `specification/standards` / `tooling/guides` / `tooling/playbooks` / `tooling/standards` |

**common に `system/` は無い**(common に置くのは仕様の書き方とツールの規約だけで、プロダクトコードの実装規約はスコープ側にある)。逆に **backend だけが `layers` と `conventions` の下位 3 種を持つ**。「どのスコープにも同じ形がある」と思って探すと外れる。

## H2 の語彙（closed / open）

テンプレートのフロントマターで宣言する。

| 宣言 | 意味 | M5 が見るもの |
|---|---|---|
| 既定(何も書かない) | **closed**。H2 の集合はテンプレートが決める | 必須節の欠落 と テンプレートに無い節 の両方 |
| `h2_policy: open` | テンプレートの H2 は「よく使う節の語彙」であり、文書ごとに固有の節を足してよい | 必須節の欠落 と **節がひとつも無いこと**だけ(テンプレートに無い節は咎めない) |

**open を許すのは、案内すべき中身がディレクトリごとに異なる doc_type だけである。** 現状の該当は `directory_guide` のみ。反対に、規約・仕様・原則のように「同種の文書は同じ順路で読める」ことに価値がある doc_type は closed を維持する。

**open は無制限ではない。** 語彙の外の節を足してよい根拠は「そのディレクトリに固有の事情」だけである。そして**同じ節が 3 か所以上に現れたら、テンプレートの語彙へ昇格させる。** この昇格ルールが無いと、open は「何でもあり」に劣化する。

見出しの**「（任意）」は closed / open と直交する**。書いても書かなくてもよい節を表す注記であり、M5 は「（任意）」の付いた節の欠落を咎めない。

### M5 が検査しない文書

- **`docs/specs/` の仕様文書**(`action_spec` / `state_spec` などの doc_type)。本文は `<!-- AUTO-GENERATED -->` の生成物が主で、節の構成を決めているのは生成器である。テンプレートとの H2 突合は「人が書く文書」への検査としての意味を持たない。仕様がテンプレートどおりかは A0 / Q0 / V1 のスキーマ検査が実質的に担う。ただし `docs/specs/` にあっても README(directory_guide)は人が書く案内なので対象に残る
- **テンプレートが解決できない文書**(該当する doc_type のテンプレートがどの階層にも無い場合)
- **繰り返しパターンのテンプレート**の配下。H2 に `{リソース名}` のようなプレースホルダーや `N:` の連番を含むテンプレートは、H2 の集合が文書ごとに変わるため突合できない。**見出しに `{}` を書くと、そのテンプレート配下の M5 検査が丸ごと外れる**ことに注意する(末尾のアンカー `{#statement}` は繰り返しとは判定されない)

## 運用メモ

- より具体的な階層に template を置けば、その階層だけ別のフォーマットにできる
- カテゴリのルートにだけ置けば、common / backend / frontend で共通のフォーマットになる
- **meta 自体はテンプレートに従う必要はない。** `meta/` に `template.md` を置くかどうかは任意であり、現状は置いていない(結果として meta 文書はテンプレート未定義となり、M5 の対象外になる)
- M5 の判定は現在すべて **warning** である。テンプレート自体がまだ育っている最中で、過不足が「文書の不備」なのか「テンプレートの不足」なのかを人が振り分ける必要があるためで、掃除が済んだ時点で error に上げる
