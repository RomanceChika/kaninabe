---
doc_type: process
scope: backend
norms: [PRIN-0002, PRIN-0003, PRIN-0005, ARCH-BE-0001]
decisions: [ADR-0006]
---

# ファイルサイズの機械執行

1 ファイル 300 行は**信号**である（上限ではない）。超えるファイルの宣言の規則。対応表の **F1・F2** の詳細。

## 目的・スコープ

- **目的:** 責務が増えたことを行数という単純な信号で気づき、**超える妥当な理由と、責務で割れるかの検討**を条件に通す。行数は本質ではなく、必要があるなら長いファイルは問題ない。ただし何も意識しないと巨大な無駄なファイルもできるので、超えるファイルに自分で理由を書かせる（PRIN-0002。裁定 2026-09-30）。
- **スコープ:** `app/src/**/*.ts` / `*.tsx`。ただし `src/**/*.test.ts(x)` と `src/domain/generated/**` は除く。`framework/**` と `legacy/spec-tools/` にも同じ規則が掛かる（執行者は同じ 1 本）。
- **正の所在:** [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の E8（「全層。`legacy/spec-tools` と同じ方針」）。`legacy/spec-tools/` 側の同じ規定は [scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md)。

## ルール

- **すべきこと:** 手書きファイルが 300 行を超えるなら、**ファイル冒頭の JSDoc に 2 つのタグ**を書く。
  - `@oversize` … **1 つの責務のまま 300 行を超える妥当な理由**（例: 「1 つの表の全規則を 1 か所で読み通せるようにする」）
  - `@split-review` … **責務で割れるかを検討した結果**（割る案と、採らなかった理由。割れるなら割る）
- **本文の条件:** どちらも 10 文字以上。**「行数」「300 行」「制限」「上限」を理由として書いたら違反**（行数は理由にならない。理由は中身から書く）。
- **腐った宣言:** 300 行以下のファイルに `@oversize` / `@split-review` が残っていたら違反。
- **宣言の無い超過**は違反（従来の `max-lines` と同じ）。**絶対の上限は置かない** —— 宣言の本数は `npm run verify` の W 群の 1 行に毎回出す（増え方が見える）。
- **数え方:** **空行もコメントも数える**（`max-lines` の `skipBlankLines: false`, `skipComments: false` と同じ。末尾の改行が作る空の最終行は数えない）。JSDoc を書いたぶん信号が緩むことはない。
- **執行者:** `@kaninabe/lint-config` の自作 ESLint 規則 `layer/declared-oversize`（`{ max: 300 }`）。判定の純関数は `framework/lint-config/src/oversize.mjs` に 1 つだけあり、verify の本数の報告も同じ関数を呼ぶ。
- **除外（F2）:**
  - `src/**/*.test.ts(x)` — テストは仕様網羅のために長くなるのが正しい形であり、行数で圧力をかけると網羅が削られる（[testing/unit.md](../testing/unit.md)）。
  - `src/domain/generated/**` — 生成物は人間が分割できない。分割したければ生成器を直す（ADR-0006）。

## 直し方

**行数を減らすのではなく、責務を分ける。** 層ごとに、超えたときに疑うべきことが違う。

| 層 | 300 行を超えたとき、まず疑うこと | 分割の方向 |
|---|---|---|
| `src/domain` | 1 つのエンジンに複数の関心（遷移判定・ガード評価・検証）が同居している | `engine/machine.ts` / `engine/guard.ts` / `engine/validate.ts` のように関心ごとに分ける |
| `src/operation` | 1 つの関数に複数のドメインイベントが混ざっている | 1 ファイル 1 操作（`{aggregate}/{operation}.ts`）に分ける |
| `src/infrastructure` | 1 つの Repository が複数の集約を扱っている | 集約ごとに `{aggregate}/{operation}.repository.ts` に分ける |
| `src/composition` | 配線以外のコード（判定・変換）が紛れ込んでいる | 判定は operation / domain へ、変換は infrastructure へ移す |
| `src/app` | Server Action に業務ロジックが入り込んでいる | 4 手順の②〜④を operation に戻す（[server-actions.md](../server-actions.md)） |
| `src/components` | 1 コンポーネントが複数のビューを兼ねている | 表示単位で分割し、状態は props で受ける |
| `__tests__/fakes/` | IF（`ports.ts`）が大きすぎる | IF を役割ごとに分ける。fake の肥大は**本体の設計の信号**として読む |

**してはいけないこと:** 信号を回避するために、意味のない位置でファイルを切る。ヘルパーだけを別ファイルに逃がして呼び出し元は変えない、といった分割は行数を移動させただけで責務は分かれていない。「行数のために分けた。境界に意味は無い」と書かざるを得ない分割は、くっつけて宣言で通すか、責務の名前で割り直す。

## 注意点・例外

- **`app/tests/*.mts` と設定ファイルは対象外。** `layer/declared-oversize` は `src/**` にのみ適用している。
- **`__tests__/fakes/*.ts` は対象。** `*.test.ts` ではないため 300 行の宣言の規則がかかる（「直し方」の表のとおり、これは意図した設計である）。テスト支援コードは JSDoc 必須（[public-symbol-docs.md](./public-symbol-docs.md)）と命名規則（[naming-and-placement.md](./naming-and-placement.md)）からは免除されるが、300 行の宣言からは免除されない。**免除の範囲は規則ごとに違う。**
- **`legacy/spec-tools/` 側にも同じ規則（`layer/declared-oversize`）が掛かる。** 設定は別（`legacy/spec-tools/eslint.config.mjs`）だが規則の実体は同じ 1 本で、正は [scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md)。**信号の値を変える場合は両方の文書を同時に改訂する**（PRIN-0007）。
- **300 という値そのものに根拠はない。** 「1 ファイルを読み通せる長さ」の経験則であり、厳密な閾値ではない。だから上限でなく信号として扱う。重要なのは値ではなく、**信号が機械で執行されていて、超えたときに必ず「なぜ 1 責務で超えるのか」と「責務で割れるか」を書く機会が来ること**である。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)（E8）
- [scripts-code-quality.md](../../../../../common/tooling/standards/scripts-code-quality.md)（`legacy/spec-tools/` 側の同一方針）
- [layer-boundaries.md](./layer-boundaries.md)（層内部の構造は 300 行の宣言（信号）とレビューで保つ）
