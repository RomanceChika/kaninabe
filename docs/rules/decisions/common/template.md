---
doc_type: decision
scope: common          # common | backend | frontend
id: ADR-0000           # 連番を振る。ADR-0001 / ADR-BE-0001 / ADR-FE-0001
status: proposed       # proposed | accepted | deprecated | superseded
targets: []            # この決定が効く対象。既存 ADR の例: [spec_dsl, verification] / [documentation_structure] / [infrastructure, testing_strategy]
date: YYYY-MM-DD       # 決定日。承認した日に書き換える
norms: []              # 根拠となる原則・アーキテクチャ。例 [PRIN-0001, ARCH-0001]
---

<!--
common スコープ ADR の雛形。使い方は ../README.md（ADR の書き方）を見る。
H1 は `# {id}: {タイトル}` の形にする。H2 見出しは英語で固定（増やさない・改名しない・順序を変えない）。
H3 以下は日本語で書いてよい。書き終えたら common/README.md の一覧 2 か所に追記する。
-->

# ADR-0000: [タイトル]

## Status

proposed (YYYY-MM-DD)

<!--
フロントマターの status と本文の両方に書く（本文には日付を添える）。
状態が変わったら次の書式で書き換える。
  - 承認された     → accepted (日付)
  - 非推奨になった → deprecated (日付)
                     次の行に `Reason: [理由]` を書く
  - 上書きされた   → superseded by ADR-0003 (日付)
                     置き換えた側の id を必ず書く。id が無いと、どこへ行ったか辿れない
-->

---

## Context

<!-- なぜこの決定が必要になったか。決定そのものではなく、決定を迫った状況を書く。 -->

### 背景

<!-- どんな問題・課題・制約があったか。 -->

### 前提条件

<!-- この決定に影響した前提。技術・組織・スケジュールなど。 -->

---

## Decision

<!-- 何を決定したか。 -->

### 決定内容

<!-- 簡潔に、具体的に。「〜する」「〜しない」と言い切る。 -->

### 適用範囲

<!-- この決定が影響する範囲。例: リポジトリ全体、docs/ 配下のみ、仕様の書き方のみ -->

---

## Consequences

<!--
どんな影響があるか。3 つとも埋める。
特に Negative を空のままにしない —— 代償の書かれていない決定は、
後から見直すときに「何を我慢していたのか」が分からず、判断のやり直しができない。
-->

### Positive（メリット）

-

### Negative（デメリット・トレードオフ）

-

### Neutral（その他の影響）

-

---

## Alternatives Considered

<!--
検討した他の選択肢。選択肢ごとに 1 つの H3 を立て、Pros / Cons / Why rejected を書く。
**Why rejected は必ず書く。** 却下の理由が無い記録は「他も検討しました」という表明にすぎず、
同じ選択肢が再提案されたときに何も止められない。
-->

### Option 1: [選択肢1]

- **Pros**:
- **Cons**:
- **Why rejected**:

### Option 2: [選択肢2]

- **Pros**:
- **Cons**:
- **Why rejected**:

---

## Implementation

<!-- Optional。決定を実行に移すために必要な作業がある場合だけ書く。 -->

### Tasks

- [ ]
- [ ]

### Timeline

- 開始:
- 完了予定:

---

## Related Decisions

<!-- 関連する ADR。5 つの関係すべてを書き、無ければ None と書く（空欄にしない）。 -->

- **Supersedes**: None
- **Superseded by**: None
- **Related**: None
- **Blocks**: None
- **Blocked by**: None

---

## References

<!-- 参考資料。`- [ドキュメント名](URL)` の形式。 -->

-

---

## Notes

<!-- Optional。補足情報・議論のメモ。 -->
