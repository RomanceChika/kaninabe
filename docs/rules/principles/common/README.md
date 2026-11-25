---
doc_type: directory_guide
id: DG-0001
norms: []
scope: common
---

# principles/common — 共通の原則

スコープに閉じない原則(`PRIN-0001-xxx` 形式)の置き場。**現在ある原則の一覧の出典はこの README である**([PRIN-0007](./PRIN-0007-single-source-of-truth.md))。

新しい原則を書くときは [principles/template.md](../template.md) に従う(template_policy の「同階層 → 上」で解決される)。

## 一覧

| 文書 | 内容 |
|---|---|
| [PRIN-0001](./PRIN-0001-spec-as-truth.md) | 仕様を唯一の正とする(Spec as Truth) |
| [PRIN-0002](./PRIN-0002-readability-and-consistency.md) | 可読性と一貫性を保つ |
| [PRIN-0003](./PRIN-0003-testability.md) | テスト可能性を保つ |
| [PRIN-0004](./PRIN-0004-record-intent.md) | 意図を記録する |
| [PRIN-0005](./PRIN-0005-respect-boundaries.md) | 境界を尊重する |
| [PRIN-0006](./PRIN-0006-evaluability.md) | 仕様は判定可能な形で記述する |
| [PRIN-0007](./PRIN-0007-single-source-of-truth.md) | 仕様は単一の出典を保つ |
| [PRIN-0008](./PRIN-0008-traceability.md) | 仕様と実装の対応は追跡可能に保つ |
| [PRIN-0009](./PRIN-0009-secure-by-default.md) | セキュリティはデフォルトで担保する |
| [PRIN-0010](./PRIN-0010-least-privilege.md) | 最小権限と責務分離を守る |
| [PRIN-0011](./PRIN-0011-document-layer-separation.md) | ドキュメントレイヤーの分離 |

**この表を実体と一致させ続けることが、このディレクトリの README の義務である。** 原則を足したら、この表に 1 行足す。

一行要旨の言い回しは、他の文書からこの原則を呼ぶときの名前として使われている。**事実上の固有名詞として扱い、気軽に言い換えない。**

## 関連

- [principles/README.md](../README.md) — 原則層の入口。principle と architecture の切り分けはここにある
- [backend/](../backend/README.md) / [frontend/](../frontend/README.md) — スコープ固有の原則(いずれも現在 0 本)
- [principles/template.md](../template.md) — 新規作成の骨格
