---
doc_type: decision
scope: common
id: ADR-0005
status: accepted
targets: [documentation_structure]
date: 2026-08-06
norms: [PRIN-0002, PRIN-0007, PRIN-0011]
---

# ADR-0005: ディレクトリの入口を README.md ひとつに統一する（AI.md の廃止）

## Status

accepted (2026-08-06)

---

## Context

### 背景

rules の各層（meta 〜 decisions）には、入口ドキュメント（`doc_type: directory_guide`）が **2 つ**置かれていました。

- `README.md`（`audience: human`）— 人間向けの構成説明
- `AI.md`（`audience: ai`）— AI 向けの責務・他レイヤーとの関係・次に読むファイル

この分離は **AI 導入初期の名残**です。当時は「AI に読ませる文書は人間向けとは別に、簡潔で機械的に辿れる形で用意すべきだ」という前提がありました。現在のモデルは人間向けに書かれた README をそのまま読み、リンクを辿り、表を解釈できます。**読者によって入口を分ける前提そのものが失効しています。**

そのうえで、入口が 2 つある構造には次の問題があります。

#### 1. 腐る場所が 2 つある

責務・他レイヤーとの関係・「次にどこへ行くか」は、README と AI.md の両方に書かれていました。片方を更新して片方を忘れれば、同じディレクトリについて 2 つの異なる説明が残ります。これは PRIN-0007（単一の出典を保つ）への正面からの違反です。

#### 2. どちらが正か決められない

両者が食い違ったとき、どちらを正とするかのルールはありませんでした。実際 architecture では、README は system / specification / tooling の 3 種を挙げているのに、AI.md は tooling に触れていない、という乖離が発生していました。

#### 3. 「AI 向け」に閉じ込められた情報が人間に届かない

process/AI.md にあった「AI実行時の共通ガイドライン」（`common/ai_execution_guidelines.md` への導線）は README には存在せず、README だけを読む人間には見えませんでした。逆に、reference_policy の制約（principle から process を参照してはいけない等）は AI.md にしか書かれておらず、README からは辿れませんでした。**入口を分けた結果、どちらの読者も全体を見られない**という状態です。

#### 4. 参照側がどちらを指すか揺れる

playbook（how-to-create-rules, rule-update）は AI.md を指し、placement_policy と doc_types は「AI.md または README.md」と両論併記していました。参照先が一意に決まらないため、リンクの正しさを機械的に検査できません。

### 前提条件

- 各層の入口ドキュメントは `doc_type: directory_guide` であり、ID（DG-NNNN）を持つ。
- フロントマターの `audience` は任意項目で、**省略時は AI・人間の両方を対象とする**（frontmatter_policy）。
- README.md は常に `directory_guide` とする既存ルールがある（placement_policy）。

---

## Decision

### 決定内容

**ディレクトリの入口を `README.md` ひとつに統一し、`AI.md` を廃止する。**

1. **入口は README.md のみ**
   - 各ディレクトリの `directory_guide` は `README.md` 1 ファイルとする。読者（AI / 人間）でファイルを分けない。
   - 入口ドキュメントの `audience` は指定しない（省略＝両方が対象）。

2. **AI 向け固有の内容は README 内のセクションとして残す**
   - 層の責務、他レイヤーとの参照関係の制約、「ここを読んだら次にどこへ行くか」といった AI 向けナビゲーションは、**README 内の「## AI向けナビゲーション」セクション**に置く。情報は捨てない。
   - 重複していた内容（責務説明・構成の案内など）は README 本体に 1 回だけ書く（PRIN-0007）。

3. **参照は README を指す**
   - playbook・placement_policy・doc_types など、AI.md を指していた参照はすべて README.md に置き換える。「AI.md または README.md」という両論併記は廃止する。

4. **ai_reference_guide.md は残す**
   - `meta/standards/ai_reference_guide.md` は「入口」ではなく「**フロントマターの参照（norms / decisions / definitions）をどう辿るかの詳細ガイド**」として位置づけを明確化し、ファイルは維持する。入口は各層の README であることを本文に明記する。

### 適用範囲

- `docs/rules/` 配下のすべての `directory_guide`（現行 6 層の AI.md を削除済み）
- `meta/standards/placement_policy.md`、`meta/standards/doc_types.md` の directory_guide 配置ルール
- 今後新設するディレクトリの入口ドキュメント

---

## Consequences

### Positive（メリット）

- **腐る場所が 1 箇所になる**。層の責務・構成・導線の出典が README ひとつに定まり、更新漏れによる自己矛盾が構造的に起きなくなる（PRIN-0007）。
- **どちらの読者も全体を見られる**。AI 向けにしか書かれていなかった参照制約や実行ガイドラインが人間にも、人間向けにしか書かれていなかった構成表が AI にも届く。
- **参照先が一意に決まる**。「そのディレクトリの入口 = そのディレクトリの README.md」となり、リンクの正しさを機械的に検査できる（PRIN-0008 の下地）。
- **新規ディレクトリの作成が単純になる**。README を 1 つ書けばよく、AI.md との書き分けを毎回判断する必要がない。
- **DG の ID 消費が半減する**。1 ディレクトリ 1 ID になり、採番と参照グラフが単純化する。

### Negative（デメリット・トレードオフ）

- **README が長くなる**。人間向けの構成説明と AI 向けナビゲーションが同居するため、1 ファイルあたりの分量は増える。見出しでの区切りとリンク集中で可読性を保つ必要がある（PRIN-0002）。
- **「AI にはここだけ読ませる」という絞り込みができなくなる**。README 全体が読み込み対象になるため、極端に長い README はコンテキストを圧迫しうる。README に詳細を書かず正へのリンクに留める運用（directory_guide は案内に徹する、PRIN-0011）で対処する。
- **廃止した AI.md の DG-ID（DG-0011, DG-0015, DG-0017, DG-0019, DG-0023, DG-0025）は欠番になる**。id_policy に従い再利用しない。

### Neutral（その他の影響）

- フロントマターの `audience` 項目自体は廃止しない。`ai_execution_guidelines.md` や `ai_reference_guide.md` のような、入口ではない AI 特化文書では引き続き有効である。
- 統合により README の `doc_type` は変わらない（`directory_guide` のまま）。

---

## Alternatives Considered

### Option 1: 現状維持（README + AI.md の二重入口）

- **Pros**:
  - 変更コストがゼロ。既存の参照リンクを触らなくてよい
  - AI に読ませる範囲を意図的に絞れる
- **Cons**:
  - 同じ内容が 2 箇所にあり続け、更新漏れによる乖離が発生し続ける（PRIN-0007 違反）
  - どちらが正かのルールがなく、食い違ったときに解決できない
  - 参照側が「AI.md または README.md」と両論併記になり、リンク検査ができない
- **Why rejected**: 分離の前提（AI は人間向け文書を読めない）が既に失効しており、コストだけが残っている。

### Option 2: AI.md に統一し README.md を廃止する

- **Pros**:
  - 入口が 1 つになるという目的は同様に達成できる
  - AI 向けの簡潔な記法に揃えられる
- **Cons**:
  - `README.md` は GitHub 等でディレクトリを開いた際に自動表示される、エコシステム標準の入口である。これを捨てるのは人間側の発見性を大きく損なう
  - 既存の `README.md` は rules 配下だけでなく specs 配下や下位ディレクトリにも多数あり、改名コストが大きい
- **Why rejected**: 入口を 1 つにするなら、外部ツールが入口と認識する `README.md` を選ぶのが自然。

### Option 3: AI.md を残し、README から内容を全部消して AI.md へのリンクだけにする

- **Pros**:
  - 出典が 1 つになる（README は転送のみ）
  - AI 向けの記述をそのまま維持できる
- **Cons**:
  - 入口を開いてから中身に到達するまでのホップが 1 つ増える
  - ファイルは 2 つ残るため、「なぜ 2 つあるのか」を説明し続ける必要がある
  - 転送専用ファイルという役割不明な文書が各層に残る
- **Why rejected**: ファイル数が減らず、構造の単純化という目的を達成しない。

---

## Implementation

### Tasks
- [x] 各層の AI.md 固有情報を README の「AI向けナビゲーション」セクションへ統合
- [x] `rules/{meta,principles,architecture,process,decisions}/AI.md` を削除
- [x] playbook（how-to-create-rules.md, rule-update.md）の AI.md 参照を README へ置換
- [x] `placement_policy.md` / `doc_types.md` の directory_guide 配置ルールを README 単一入口に更新
- [x] `ai_reference_guide.md` を「入口ではなく辿り方の詳細ガイド」として位置づけを明記
- [ ] リンク切れ検査（AI.md への参照が残っていないこと）を検証スクリプトに組み込む

### Timeline
- 決定・適用: 2026-08-06

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: [ADR-0009](./ADR-0009-retire-audience-key.md)（Consequences の Neutral 節にあった「`audience` は非入口文書で有効」という一節のみ。単一入口の決定自体はそのまま有効）
- **Related**: [ADR-0002](./ADR-0002-legal-structure-documentation.md)（法律的階層構造によるドキュメント体系の再構築 — 入口ドキュメントを各層に置く構造を導入した決定）
- **Blocks**: None
- **Blocked by**: None

---

## References

- [PRIN-0002 — 可読性・一貫性](../../principles/common/PRIN-0002-readability-and-consistency.md)
- [PRIN-0007 — 単一の出典を保つ](../../principles/common/PRIN-0007-single-source-of-truth.md)
- [PRIN-0011 — 文書レイヤーの分離](../../principles/common/PRIN-0011-document-layer-separation.md)
- [placement_policy — 置き場所ルール](../../meta/standards/placement_policy.md)
- [doc_types — directory_guide の定義](../../meta/standards/doc_types.md)
- [ai_reference_guide — 階層構造と参照の辿り方](../../meta/standards/ai_reference_guide.md)

---

## Notes

### 廃止した AI.md と統合先

| 廃止ファイル | ID（欠番） | 統合先 |
|--------------|-----------|--------|
| `meta/AI.md` | DG-0011 | [meta/README.md](../../meta/README.md)（DG-0013） |
| `principles/AI.md` | DG-0015 | [principles/README.md](../../principles/README.md)（DG-0016） |
| `architecture/AI.md` | DG-0019 | [architecture/README.md](../../architecture/README.md)（DG-0020） |
| `process/AI.md` | DG-0023 | [process/README.md](../../process/README.md)（DG-0024） |
| `decisions/AI.md` | DG-0025 | [decisions/README.md](../../decisions/README.md)（DG-0032） |
