---
doc_type: decision
scope: common
id: ADR-0009
status: accepted
targets: [documentation_structure]
date: 2026-09-04
norms: [PRIN-0002, PRIN-0006, PRIN-0007, PRIN-0011]
---

# ADR-0009: フロントマターの `audience` キーを廃止する（ADR-0005 の追補）

## Status

accepted (2026-09-04)

---

## Context

### 背景

[ADR-0005](./ADR-0005-single-entry-point.md) は、各ディレクトリの入口を README.md 1 本に統一し、AI 向けの案内を README 内の節へ統合することを決定した。この決定自体は実装済みであり、現在も有効である。

ADR-0005 の Consequences（Neutral）は、フロントマターの `audience` キー自体は廃止しないと書いていた。「入口ではない AI 特化文書（`ai_execution_guidelines.md` / `ai_reference_guide.md`）では引き続き有効」という位置づけである。

しかし、その後の運用でこの「引き続き有効」は実体を持たなかったことが分かった。

1. **検証器（M1）は `audience` を一度も読まない。** `frontmatter_policy.md` の「doc_type ごとの必須フロントマター対応表」にも `audience` は必須項目として現れず、M1 の実装（`legacy/spec-tools/lib/docs/`）にも対応する分岐が無い。
2. **値を使う読み手がいない。** `audience: ai` を付けた 2 文書（`ai_reference_guide.md` / `ai_execution_guidelines.md`）は、ファイル名と配置と本文の内容そのものによって「AI 実行時に参照する文書である」ことが既に自明であり、`audience` の値を読んで初めて分かることが無い。
3. **PRIN-0006（判定可能性）に抵触する。** 宣言してあるのに、テスト・レビュー・観測のいずれでも照合されない項目は、宣言しているだけで運用されていない。ADR-0005 が「捨てない」と決めた時点では執行の当てがあるように見えたが、実際には無かった。

### 前提条件

- `audience` は frontmatter_policy.md 上「4. 読者・運用補助系（任意）」に分類されており、必須項目ではない。廃止しても M1 のエラーは増えない（そもそも見ていないため）。
- `doc_types.md` に別の意味で登場する `audience`（`notification_spec` の `vocabulary` が宣言する通知の宛先軸）とは無関係である。これはカタログ自身が定義する語彙の一部であり、本 ADR の対象外。

---

## Decision

### 決定内容

1. **フロントマターの `audience` キーを廃止する。** `ai` / `human` の書き分けという運用そのものをやめる——AI 向けの文書かどうかは、配置（`docs/rules/process/common/ai_execution_guidelines.md` のようなファイル名・ディレクトリ）と本文の宣言（「AI が...」で始まる導入文）で示す。フロントマターのキーとしては持たない。
2. **ADR-0005 の単一入口（README 1 本）の決定はそのまま維持する。** 本 ADR が変えるのは ADR-0005 の Consequences（Neutral）にあった「`audience` は非入口文書でなら有効」という一節だけである。
3. `frontmatter_policy.md` から `audience` の行・記述をすべて削除する。
4. `ai_reference_guide.md` / `ai_execution_guidelines.md` のフロントマターから `audience: ai` を削除する。

### 適用範囲

- `docs/rules/meta/standards/frontmatter_policy.md`
- `docs/rules/meta/standards/ai_reference_guide.md`
- `docs/rules/process/common/ai_execution_guidelines.md`
- 今後のすべての文書作成（`audience` キーを新規に書かない）

---

## Consequences

### Positive（メリット）

- **死語彙が 1 つ減る。** 書いても誰にも読まれないフロントマターが無くなり、フロントマターの語彙と検証器の実装が一致する（PRIN-0006）。
- **判定基準が単純になる。** 「AI 向けかどうか」を書き手がキーの値で選ぶ必要がなくなり、配置と本文だけが基準になる（PRIN-0002）。

### Negative（デメリット・トレードオフ）

- **将来 AI 向け・人間向けを本当に書き分けたくなったとき、キーが無い状態から作り直す。** ただし、その必要が生じた時点で当時の要件に合わせて設計し直す方が、使われなかった旧キーを流用するより安全である。

### Neutral（その他の影響）

- `doc_types.md` の `notification_spec` の項にある `audience`（通知の宛先軸の語彙）は本 ADR と無関係であり、変更しない。

---

## Alternatives Considered

### Option 1: 現状維持（`audience` を非入口文書向けに残す）

- **Pros**: 変更コストがゼロ
- **Cons**: 検証器が読まない項目を「有効」と言い続けることになり、PRIN-0006 に反したまま
- **Why rejected**: 「有効」の実体（誰かが読む・何かが検証する）が無いまま 1 年近く放置されていたことが今回の棚卸しで判明した。実体の無い「有効」を維持する理由が無い。

### Option 2: `audience` を必須項目に格上げし、M1 に検証を追加する

- **Pros**: 死語彙ではなくなる
- **Cons**: AI 向け／人間向けの書き分けという運用自体に価値が見出せない（Context 参照）。検証を追加するコストに見合う効用が無い
- **Why rejected**: 使われていない区分を執行可能にするより、区分自体をやめる方が単純である。

---

## Implementation

### Tasks

- [x] `frontmatter_policy.md` から `audience` の記述を削除
- [x] `ai_reference_guide.md` / `ai_execution_guidelines.md` のフロントマターから `audience: ai` を削除
- [x] `ADR-0005` の Related Decisions に `Superseded by: ADR-0009` を追記
- [x] `decisions/common/README.md` の一覧（時系列・カテゴリ別）に追記

### Timeline

- 決定・適用: 2026-09-04

---

## Related Decisions

- **Supersedes**: [ADR-0005](./ADR-0005-single-entry-point.md)（Consequences の Neutral 節にあった「`audience` は非入口文書で有効」という一節のみ。単一入口の決定自体は継承する）
- **Superseded by**: None
- **Related**: None
- **Blocks**: None
- **Blocked by**: None

---

## References

- [ADR-0005 — ディレクトリの入口を README.md ひとつに統一する](./ADR-0005-single-entry-point.md)
- [PRIN-0006 — 仕様は判定可能な形で記述する](../../principles/common/PRIN-0006-evaluability.md)
- [PRIN-0007 — 単一の出典を保つ](../../principles/common/PRIN-0007-single-source-of-truth.md)
- [frontmatter_policy.md](../../meta/standards/frontmatter_policy.md)

---

## Notes

`doc_types.md` の `notification_spec` の項にある `audience`（通知カタログの `vocabulary` が宣言する宛先軸）は、本 ADR が扱うフロントマターの `audience` キーとは無関係の別語彙である。棚卸しの際に混同しないよう、ここに明記しておく。
