---
doc_type: directory_guide
id: DG-0035
norms: []
scope: common
---

# tooling/guides — ツールの使い方・機能一覧

開発ツールの使い方と機能の一覧を置く箱である。**現状は空である。**

<!--
  TODO(port): 移植元には arch-check.md(Go AST ベースの静的解析)と doc-refs-cli.md が存在したが、
  骨格のみ移植の方針により持ってきていない。移植元の2本はスタックごと現行(Next.js / TypeScript / Supabase)と
  噛み合わないため、そのままの書き起こしは行わない。
  再開条件だった「ツールの整備」は既に到来している:
    - legacy/spec-tools/ に検査器と生成器が実在し、`npm run verify` / `npm run generate` / `npm run generate:check` として稼働中。
  よって書き起こすなら対象はこの実在のツールであり、移植元の2本ではない。
-->

## 構成

| 文書 | 内容 |
|---|---|
| （未整備） | — |

**空でも README を残し、未整備であることを明示する。** 一覧の行を消してしまうと、書いていないのか要らないのかが読み手に伝わらない。

いま使い方を知りたい場合の実際の入口は CLAUDE.md の「コマンド」節である。ルートで `npm run verify`(仕様の意味検証と仕様⇔テストのトレース)、`npm run generate`(文書と実装部品の生成)、`npm run generate:check`(生成物の鮮度チェック)が回る。この箱に文書を書くとしたら、そこに載っている一行の説明を、機能単位まで割った一覧に育てる作業になる。

guides は tooling 枝にしかない箱である(standards / playbooks は他の枝にもある)。ツールは「守るべき基準」や「変更の手順」だけでなく、**使う人に向けた説明**を必要とするからで、その説明の置き場がここになる。文書を足すときは同階層の [template.md](./template.md) に従う。
