---
doc_type: decision
scope: common
id: ADR-0006
status: accepted
targets: [domain_implementation, tooling, ci]
date: 2026-08-06
norms: [PRIN-0001, PRIN-0002, PRIN-0007, PRIN-0008]
---

# ADR-0006: 仕様からの生成物をリポジトリにコミットし、鮮度を CI で検証する

## Status

accepted (2026-08-06)

---

## Context

### 背景

ADR-0004 で「仕様から遷移テーブル・zod スキーマを生成し、実装は生成物を読む」方式を決めましたが、**生成物をリポジトリに置くのか、ビルド時に生成するのか**は未決のまま残っていました（ADR-0004 の Negative に「生成物をリポジトリに置くか生成時に作るかの運用が必要」と明記）。

この判断は次の 2 点に効きます。

#### 1. レビューで何が見えるか

この体系の前提は「人間はコードをほとんど読まず、仕様の意味だけを見る」ことです。ただし**仕様変更が実装に何をもたらしたか**は、レビューで見えたほうが安全です。生成物がリポジトリにあれば、仕様の 1 行の変更が遷移テーブルの何行の差分になるかが PR に現れます。生成物がビルド時にしか存在しなければ、差分は消えます。

#### 2. ビルドが何に依存するか

`app/`（Next.js の製品コード）と `legacy/spec-tools/`（検証器・生成器）は**別パッケージ**です（ARCH-BE-0001。workspaces は使わない）。ビルド時生成にすると、製品のビルドが生成器のツールチェーン（tsx・検証器の依存関係）に依存します。ホスティング環境のビルドで検証器・生成器側の依存を解決する必要が生じ、依存の向きが「製品 → ドキュメントツール」に逆流します。

### 前提条件

- 生成物は `app/src/domain/generated/` に置く（ARCH-SP-0002 / ADR-0004）。
- 生成器は `legacy/spec-tools/` にあり、`npm run generate` / `npm run generate:check`（鮮度チェック）が既に存在する。
- 生成物は決定的（同じ仕様からは同じ出力）である。
- 生成物を手で編集しても次回生成で上書きされる（PRIN-0007）。

---

## Decision

### 決定内容

**仕様からの生成物（`app/src/domain/generated/`）はリポジトリにコミットする。生成器は `legacy/spec-tools/` に集約し、生成物の鮮度は CI で `generate:check` により検証する。**

1. **コミットする対象**
   - `app/src/domain/generated/{aggregate}.schema.ts`（zod スキーマ + TS 型。ファイル名は集約名、export名はエンティティ名のcamelCase）
   - `app/src/domain/generated/{machine}.transitions.ts`（遷移テーブル）
   - `app/src/domain/generated/` 配下のスコープ定義データ
   - `docs/specs/` 本文の `<!-- AUTO-GENERATED -->` ブロック（図・表。既に運用中）

2. **生成器はツールチェーン 1 箇所に集約する**
   - 生成器の実体は `legacy/spec-tools/generators/` にのみ置く。`app/` 側に生成スクリプトを重複させない。
   - `app/` のビルド・テストは生成器を実行しない。生成物はソースとして存在する前提で動く。

3. **鮮度は CI で機械検証する**
   - CI で `npm run generate:check` を実行し、**仕様から再生成した結果とコミットされている生成物が一致しない場合は失敗**とする。
   - これにより「仕様を変えたが再生成し忘れた」状態がマージされない。生成物の正しさは人間のレビューではなく CI が保証する。

4. **手編集の防止**
   - 生成ファイルの先頭に自動生成であることを示すヘッダを置き、手編集を検出できるようにする（ARCH-BE-0001 の E5）。

### 適用範囲

- `app/src/domain/generated/` 配下のすべてのファイル
- `legacy/spec-tools/generators/` の実装方針
- CI の必須チェック（typecheck / test / verify / generate:check）

---

## Consequences

### Positive（メリット）

- **仕様変更の影響が PR で見える**。「この 1 行の仕様変更で遷移テーブルのここが変わる」がレビューに現れ、意味レビューの精度が上がる（PRIN-0002）。
- **製品のビルドが生成器に依存しない**。`app/` は普通の Next.js パッケージのままであり、ホスティング環境で検証器・生成器側のツールチェーンを解決する必要がない。
- **依存の向きが逆流しない**。製品コード → ドキュメントツールという依存を作らずに済む（PRIN-0005 の精神）。
- **クローン直後にビルドできる**。生成手順を知らなくても `app/` 単体で動く。
- **生成物の正しさが CI で保証される**。鮮度チェックが通っている限り、生成物は仕様と一致している（PRIN-0001 / PRIN-0007）。

### Negative（デメリット・トレードオフ）

- **PR の差分にノイズが乗る**。仕様の 1 行変更が生成物の数十行の差分になる。レビュー時は生成物の差分を「結果の確認」として読み、指摘対象にはしない運用が必要。
- **コンフリクトが起きうる**。複数のブランチが同じ仕様を触ると生成物でコンフリクトする。解決方法は「再生成してコミットし直す」に固定する（手でマージしない）。
- **CI を通さない経路で腐る余地が残る**。ローカルでの再生成忘れは CI が捕まえるが、CI を回さずに参照した中間状態では古い生成物を見る可能性がある。
- **生成物を手編集する誘惑が構造的には消えない**。ヘッダとリンターで検出はできるが、書けてしまうこと自体は防げない。

### Neutral（その他の影響）

- 生成物のフォーマットは決定的でなければならない（同じ入力から同じ出力）。整形器の設定変更は生成物の全面差分を生むため、生成器側の責務としてフォーマットを固定する。
- 将来 `legacy/spec-tools` を npm パッケージとして切り出す場合も、この決定は変わらない（生成物をコミットする運用は配布形態に依存しない）。

---

## Alternatives Considered

### Option 1: ビルド時に生成する（`prebuild` で `generate` を実行）

- **Pros**:
  - 生成物が常に仕様と一致する（鮮度チェックが不要）
  - リポジトリに生成物が入らず、差分がきれい
- **Cons**:
  - 製品のビルドが生成器のツールチェーンに依存する。`app/` と `docs/` を別パッケージにした前提が崩れる
  - 仕様変更が実装に与えた影響がレビューで見えない
  - ビルド環境（ホスティング側）で docs の依存関係を解決する必要がある
  - 生成器のバグ・非決定性がビルドの失敗として現れ、切り分けが難しくなる
- **Why rejected**: 「レビューで差分が見える」ことと「製品ビルドが生成器に依存しない」ことの 2 点が、鮮度チェックの実装コストを上回る。

### Option 2: 生成物を npm パッケージとして配布し、`app` が依存する

- **Pros**:
  - バージョンで固定でき、複数プロジェクトから使い回せる
  - 生成物と製品コードの境界が明確
- **Cons**:
  - 1 プロジェクト・1 リポジトリの規模では、公開・バージョン管理の手間が本体開発より重い
  - 仕様変更のたびに publish が挟まり、反復が遅くなる
  - レビューで差分を見るという目的は達成できない（別リポジトリの差分になる）
- **Why rejected**: ライブラリ化は「3 回使ってから」の方針であり、いまの時点では早い。将来切り出す場合もこの決定と両立する。

### Option 3: 生成物をコミットするが、鮮度検証は行わない

- **Pros**:
  - 実装コストが最小
- **Cons**:
  - 「仕様を変えたが再生成し忘れた」状態が検出されず、仕様と実装が静かに乖離する
  - ADR-0004 が構造的に排除したはずの乖離が、生成物の鮮度という形で復活する
- **Why rejected**: PRIN-0001 に正面から反する。生成物をコミットする方式を選ぶなら鮮度検証は必須の対価である。

---

## Implementation

### Tasks
- [x] `legacy/spec-tools` に `generate` / `generate:check` を実装（仕様本文の AUTO-GENERATED ブロック）
- [ ] `entity_spec` → zod スキーマ、`state_spec` → 遷移テーブルの生成器を実装
- [ ] 生成ファイルのヘッダ（自動生成・手編集禁止）の形式を固定
- [ ] CI に typecheck / test / verify / generate:check を必須チェックとして組み込む
- [ ] 生成物の手編集を検出するリンタールール（ARCH-BE-0001 の E5）

### Timeline
- 決定: 2026-08-06
- 生成器の実装: `app/` の実装着手と同時

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: [ADR-0004](./ADR-0004-generated-transition-table-engine.md)（遷移テーブル生成 + 汎用エンジン方式 — 本 ADR はその未決事項を確定させる）
- **Blocks**: None
- **Blocked by**: [ADR-0004](./ADR-0004-generated-transition-table-engine.md)

---

## References

- [PRIN-0001 — 仕様を唯一の正とする](../../principles/common/PRIN-0001-spec-as-truth.md)
- [PRIN-0007 — 仕様は単一の出典を保つ](../../principles/common/PRIN-0007-single-source-of-truth.md)
- [ARCH-BE-0001 — app パッケージの層構成と依存方向](../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)
- [ARCH-SP-0002 — ドメイン仕様（docs/specs/domain）の構成](../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md)

---

## Notes

### 現在どこまで効いているか

- CI（`.github/workflows/ci.yml`）の docs ジョブで `npm run verify` と `npm run generate:check` を実行しており、**「仕様を変えたが再生成し忘れた」状態はすでにマージ前に落ちる**。決定内容 3 はこの範囲で満たされている。
- 一方、決定内容 1 のうち `app/src/domain/generated/` の生成器（zod スキーマ・遷移テーブル）は未実装で、現時点で `generate:check` が見ているのは `docs/specs/` 本文の AUTO-GENERATED ブロックのみである。Implementation の未チェック項目がそのまま残差にあたる。

### 決定の弱いところ

- 決定内容 4 の「生成ファイルのヘッダによる手編集の検出」は、**ヘッダを消してから編集されると効かない**。実効的な防波堤は `generate:check`（差分検出）であり、ヘッダは事故の予防にとどまる。この非対称は enforcement-matrix の C1 / C2 に「C2 は未実装、現状は C1 のみで担保」として明記してある。
- 機械執行の一覧としての正は [enforcement/enforcement-matrix.md](../../process/backend/system/standards/conventions/enforcement/enforcement-matrix.md)（C1〜C8）であり、本 ADR は**なぜそうするか**だけを持つ。両者がずれたら matrix 側を正とし、本 ADR は改訂する（PRIN-0007）。
