---
doc_type: directory_guide
id: DG-0033
norms: []
scope: common
---

# tooling/standards — ツールコードの品質基準

`legacy/spec-tools/`(検証器・生成器・CLI)のコードをどう保つかの基準を置く箱である。検査ルールはこれからも増え続けるので、**足すことが安全で局所的に済む構造**を先に決めておく必要がある。それを宣言するのがここに入る文書である。

## 構成

| 文書 | 内容 |
|---|---|
| [scripts-code-quality.md](./scripts-code-quality.md) | `legacy/spec-tools/` の設計・実装・テストの規約。要旨は4点 — **インターフェース先行** / **I/O と純粋ロジックの分離** / **`any` 禁止** / **1ファイル300行** |
| [dependency-accepted.md](./dependency-accepted.md) | 依存の脆弱性の受け入れ表。`npm run deps:check` が読む(直さずに受け入れる指摘を、理由と見直しの期限つきで残す) |
| [dependency-patch-policy.md](./dependency-patch-policy.md) | 依存の脆弱性を直す期限(重大度ごと)・push の判断・SBOM をいつ作って保つか。受け入れ表の期限の上限もここ |
| [template.md](./template.md) | この階層で新規文書を作るときの見出し構成。`検証方法` 節まで含めて4節すべてが必須 |

`scripts-code-quality.md` は CLAUDE.md のルーティング表に「legacy/spec-tools のコードを書く」の正典として載っており、**この枝の実運用の入口は README ではなく配下の文書のほう**である。

規約が実装から逆に参照されている箇所もある。たとえば `legacy/spec-tools/lib/model/docs/template.ts` の冒頭コメントは「規約: scripts-code-quality.md『I/O と純粋ロジックの分離』」を名指しており、コードを読んだ人がその場から規約へ戻れるようになっている。規約 → 実装コメントの逆参照は、規約が生きているかどうかの実地の目印になる。

### 守備範囲の境界

**ここが扱うのはツール側(`legacy/spec-tools/`)だけである。** `app/`(製品コード)の機械執行ルールは backend スコープに置く。置き場は [process/backend/system/standards/conventions/enforcement/](../../../backend/system/standards/conventions/enforcement/README.md) で、全件の対応表は [enforcement-matrix.md](../../../backend/system/standards/conventions/enforcement/enforcement-matrix.md) にある。

分けている理由は、両者で執行者も失敗の重さも違うからである。ツール側が壊れても直せば済むが、製品側の境界違反はそのまま出荷される。片方の基準をもう片方に流用しないよう、置き場から分けてある。
