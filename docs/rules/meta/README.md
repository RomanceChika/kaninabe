---
id: DG-0013
doc_type: directory_guide
scope: repository
norms: []
decisions: [ADR-0005]
---

# meta — 文書体系そのもののルール

この層は、`docs/rules/` と `docs/specs/` の文書について**「種類・置き場所・ID・参照・変更」の 5 つだけ**を決める。文書の形を決める層であって、価値判断を書く層ではない。

由来は法律を模した階層化である。ルールが増えるほど、ルール同士の整合を人の注意力で保つのは無理になる。整合を保つには、まず「階層そのものの定義」が要る。その定義群がこの層である。

**具体ルールの本文と価値判断はここに書かない。** 「どう書くか」は meta が決め、「何を書くか」は principles 以下と `docs/specs/` が決める。層の関心事だけを書くという線引き(PRIN-0011)を meta 層に当てはめたものであり、この線引きが meta の存在理由そのものである。

## 構成

配下は 2 区分しかない。

| ディレクトリ | 責務 | 入口 |
|---|---|---|
| `standards/` | 基準・ポリシーの定義。**何が正しいか**を宣言する | [standards/README.md](./standards/README.md) |
| `playbooks/` | ルール文書を作る・直す・評価する手順。**どうやるか**を並べる | [playbooks/README.md](./playbooks/README.md) |

**各文書の一覧(ファイル・目的・主な読者)を持つのは、上の 2 つの README である。** ここに同じ一覧を重ねて置かない。同じ表が 2 か所にあると必ず片方だけが古くなり、どちらが正かを読み手が判断できなくなる(PRIN-0007)。

ディレクトリの入口は README.md ひとつとし、AI 用と人間用でファイルを分けない([ADR-0005](../decisions/common/ADR-0005-single-entry-point.md))。AI 向けの案内が要るなら README の中の節にする。下の「AI向けナビゲーション」がその節である。

rules 全体(principles〜decisions)の説明は [../README.md](../README.md) が持つ。

**他層との関係。** principles から decisions までの各層と `docs/specs/` は、meta が定めた doc_type / 配置 / ID / 参照 / 変更の規則に従う。逆に meta 側は「どこに何を書くか」だけを決め、中身は各層に委ねる。

## AI向けナビゲーション

目的から入る。番号は作業の順序であって重要度ではない。

1. **ルール文書を 1 本足したい** → [playbooks/how-to-create-rules.md](./playbooks/how-to-create-rules.md)(判定から整合確認までの通し手順)
2. **これは何の文書か決めたい** → [standards/doc_types.md](./standards/doc_types.md)(doc_type の定義と、書いてはいけないこと)
3. **どこに置くか決めたい** → [standards/placement_policy.md](./standards/placement_policy.md)(doc_type × scope → 置き場所)
4. **どのテンプレートに従うか知りたい** → [standards/template_policy.md](./standards/template_policy.md)(同階層 → 上へ辿る解決手順)
5. **フロントマターに何を書くか知りたい** → [standards/frontmatter_policy.md](./standards/frontmatter_policy.md)(項目と doc_type ごとの必須条件)
6. **ID をどう振るか知りたい** → [standards/id_policy.md](./standards/id_policy.md)(形式・採番単位・再利用禁止)
7. **この文書からあの文書を参照してよいか知りたい** → [standards/reference_policy.md](./standards/reference_policy.md)(参照キーの意味と参照の可否)
8. **既存のルールを変えたい** → [standards/change_policy.md](./standards/change_policy.md)(ADR 要否と変更時の最低チェック)
9. **なぜこのルールなのかを遡りたい** → [standards/ai_reference_guide.md](./standards/ai_reference_guide.md)(フロントマターの参照を辿る手順)

ここに出てこない standards / playbooks は [standards/README.md](./standards/README.md) と [playbooks/README.md](./playbooks/README.md) の一覧から辿る。

## 補足

**なぜ doc_types と placement_policy を揃えるのか。** 「これは何の文書か」と「どこに置くか」が 1 対 1 で決まっていれば、AI は迷わずに書き始められる。片方だけがあると、種類は決まったのに置き場所が決まらない(あるいはその逆)という停止が起きる。

**なぜ id_policy と reference_policy が要るのか。** 参照・履歴・自動処理はすべて ID をキーにしている。ID の形が揺れたり使い回されたりすると、参照グラフが静かに壊れる。

**change_policy は任意運用だが効果が大きい。** 原則や構造の変更は影響範囲が広く、後から「なぜ変えたか」を復元できないと同じ議論を繰り返すことになる。

**meta の規範の多くは機械で執行される。** `npm run verify` の M 群がそれで、M1(フロントマター必須項目)・M2(id の一意性と形式)・M3(参照先の実在)・M4(リンク切れ)・M5(テンプレート準拠 H2)・M6(循環参照)が `docs/rules/` と `docs/specs/` の全文書を 1 つの台帳として走査する。M1〜M4 は error、M5・M6 は warning である。**M7〜M9(と台帳の形を見る M11)は用語の台帳を見る別の群**で、規約・設計メモ・ブックの本文を台帳に照らす(書き方と検査は [term-ledger-writing.md](../process/common/specification/standards/term-ledger-writing.md))。**この層の文書を直したら verify を通してから閉じる。**

**作業の入口は CLAUDE.md のルーティング表である。** 「ディレクトリの入口は README ひとつ」はディレクトリ単位の話であり、実際の作業は CLAUDE.md の「やること → 読む文書」の表から直接目的の正典へ飛ぶ。この README は、その先で文書の形に迷ったときに戻ってくる場所である。
