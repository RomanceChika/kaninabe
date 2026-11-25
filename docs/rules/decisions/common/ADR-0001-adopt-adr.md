---
doc_type: decision
scope: common
id: ADR-0001
status: accepted
targets: [documentation_process]
date: 2026-08-06
norms: [PRIN-0001]
references_required: false
---

# ADR-0001 — 意思決定を ADR として記録する

意思決定の記録方法を ADR(Architecture Decision Record)形式に定め、リポジトリの中に置くことを決めた記録。**この ADR 自身が、ADR を採用する最初の実例になっている。**

## Status

accepted(2026-08-06 — このリポジトリの立ち上げ時に採用)

## Context

この決定の実質は、発案者が前身の文書体系(前職で自ら構築・運用したもの)で確立した ADR 方式を、**このリポジトリの立ち上げ(2026-08-06)時点で初日から採用した**ことである。前身では、決定を記録する場所が無かったために次の 4 つが起きており、ADR の導入で解消された実績があった。

1. **コンテキストの喪失** — 時間が経つと、決定の背景と理由が誰にも分からなくなる。
2. **再議論の繰り返し** — 同じ議論を何度もやり直す。
3. **新規参加者の混乱** — 「なぜこうなっているのか」が伝わらない。
4. **変更の難しさ** — 過去の決定を変えてよいのかどうかを判断できない。

このリポジトリでの採用時に既にあった前提は次のとおりである(立ち上げ時の骨格移植で同時に整った)。

- `rules/` と `specs/` の 2 つのツリーが存在していた。
- `meta` で文書の種類・配置のルールが定義済みだった。
- `principles` 〜 `process` で、原則・アーキテクチャ・プロセスを管理していた。

## Decision

**意思決定を ADR(Architecture Decision Record)形式で記録する。**

- **配置**: `decisions/` の下に、scope 別(`common/` / `backend/` / `frontend/`)で**フラットに**置く。階層を作らない。
- **ID 形式**: `ADR-0001-xxx.md`(common)/ `ADR-BE-0001-xxx.md`(backend)/ `ADR-FE-0001-xxx.md`(frontend)。
- **Status の管理**: `proposed` → `accepted` → `deprecated` / `superseded` と遷移させる。
- **一度書いたら変更しない。** 決定を変えるときは、既存の ADR を書き換えるのではなく、**新しい ADR で上書きする**。決定記録は履歴であり、履歴を書き換えれば履歴ではなくなる。
- **適用範囲**: プロジェクト全体の技術的決定 / アーキテクチャの選択 / ツール・フレームワークの選定 / 開発プロセスの変更 / 重要なコーディング規約。

## Consequences

**Positive**

- **透明性** — 決定の理由と背景が明確になる。
- **履歴管理** — いつ何を決めたかを追跡できる。
- **オンボーディング** — 新しく入る者が過去の決定を理解できる。
- **変更の根拠** — 将来見直すときの材料が残る。
- **議論の効率化** — 過去の検討内容を参照できる。

**Negative**

- **追加の作業** — 決定のたびに ADR を書く必要がある。
- **メンテナンス** — README の一覧を更新する手間がかかる。
- **形式化のコスト** — 小さな決定でも形式に従わなければならない。

**Neutral**

- ADR は、原則・アーキテクチャ・プロセスの各文書から参照される側になる。
- 既存の文書体系(`meta` 〜 `process`)との統合作業が発生する。

## Alternatives Considered

**Option 1: GitHub Issues に記録する**

- Pros: 既存のツールで済み、追加コストが無い。議論の履歴が残る。
- Cons: 検索性が低い。体系的に整理しにくい。コードと分離される。
- 却下理由: 文書体系との統合が難しく、長期的な参照に向かない。

**Option 2: Wiki に記録する**

- Pros: 編集が簡単で、構造を自由に決められる。
- Cons: バージョン管理が弱い。コードと分離される。形式が統一されない。
- 却下理由: コードと一緒に管理したい。形式の統一が重要である。

**Option 3: コミットメッセージに記録する**

- Pros: コードと直接関連づけられる。ファイルを増やさない。
- Cons: 発見しにくい。体系的な整理が不可能。長文に向かない。
- 却下理由: 検索性と参照性が極めて低い。

3 案に共通する却下理由は 1 つである。**コードと一緒に管理したい**こと、そして**検索と参照で辿り着ける場所に置きたい**ことである。

## Implementation

完了したこと。

- `decisions/` の構造を作成した。
- `decisions/README.md`(ADR のガイド)を作成した。
- `decisions/common/template.md` を作成した。
- 各 scope の README を作成した。
- ADR-0001(この文書)を作成した。
- `meta/standards/doc_types.md` に decision の説明を追加した。
- `meta/standards/placement_policy.md` に配置ルールを追加した。

Timeline: 前身での確立は 2026-02。このリポジトリでは 2026-08-06 の骨格移植と同時に採用。

## Related Decisions

- **Supersedes**: None(最初の ADR である)
- **Superseded by**: None
- **Related**: None
- **Blocks**: None
- **Blocked by**: None

## References

- Michael Nygard, "Documenting Architecture Decisions"(Cognitect)— <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>
- Architectural Decision Records — <https://adr.github.io>
- Architecture Decision Record(テンプレート集)— <https://github.com/joelparkerhenderson/architecture-decision-record>

## Notes

この ADR 自体が、ADR を採用する最初の例になっている。

**追記(2026-08)**: Consequences の Negative に挙げた「形式化のコスト」は現実になった。日々の判断は ADR ではなく作業ログ(`NOTES.md`)に一次記録され、未処理の項目は `BACKLOG.md`、ユーザーの判断待ちは `review-queue.md` が持つ、という 3 つの台帳の分業が実運用として成立している。ADR に昇格するのは、そこから正式化できると判断されたものだけである。**この線引きをどこに正式に書くかは、まだ決めていない。**
