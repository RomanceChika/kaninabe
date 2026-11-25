---
doc_type: directory_guide
id: DG-FE-0005
norms: []
scope: frontend
---

# フロントエンドの決定（frontend）

**この階層が持つのは、フロントエンド固有の技術的決定である。** アーキテクチャ・フレームワーク・ライブラリ・状態管理など、フロントエンド開発に関わる重要事項を対象とする。両方の層に効く決定は [common](../common/README.md) に置く。

**現在、この階層の ADR は 0 件である。** 空であること自体が情報なので、表の行もカテゴリの節も消さずに残す。なお [backend](../backend/README.md) と違い、この階層には移植元から引き継いだ欠番が無い。**最初の 1 本は ADR-FE-0001 である。**

## 全決定（時系列）

| ID | タイトル | Status | 日付 | 概要 |
|---|---|---|---|---|
| 未作成 | （まだありません） | - | - | - |

<!-- 記入例:
| ADR-FE-0001 | App Router + RSC を前提にデータ取得を組む | accepted | 2026-08-06 | 画面のデータ取得をサーバー側に寄せ、クライアントでの再取得を作らない |
-->

## カテゴリ別

カテゴリの語彙は Architecture / State Management / UI Components / Testing の 4 種である。該当が無いカテゴリも節ごと残し、「（まだありません）」と書く。

### Architecture

（まだありません）

<!-- 記入例: ADR-FE-0001 — なぜ App Router + RSC を選んだか。Pages Router・クライアント取得との比較 -->

### State Management

（まだありません）

<!-- 記入例: ADR-FE-0002 — サーバーの状態はサーバーで解決し、`useEffect` での再取得を禁じる判断とその代償 -->

### UI Components

（まだありません）

<!-- 記入例: ADR-FE-0003 — 画面を `_screens` の DI で組み、testid を生成物から引く方式 -->

### Testing

（まだありません）

<!-- 記入例: ADR-FE-0004 — 画面テストを screenTest（RSC を関数として呼ぶ）で行い、ブラウザを使わない判断 -->

実運用では、App Router と RSC を前提にしたデータ取得、`useEffect` での再取得の禁止、`_screens` による部品の DI、生成された testid、screenTest、デザイントークン経由のスタイリングといった決定が既に確立している。それらの ADR がここに 1 件も無いことが、この階層のギャップである（記録漏れ）。上の記入例は、その未記録の決定をそのまま題材にしている。

## 新しい ADR の追加方法

1. 次の番号を確認する。

   ```bash
   ls docs/rules/decisions/frontend/ADR-FE-*.md | tail -1
   # → 1 件も無い。欠番も無いので、次は ADR-FE-0001
   ```

2. テンプレートをコピーする。

   ```bash
   cp docs/rules/decisions/frontend/template.md \
      docs/rules/decisions/frontend/ADR-FE-0001-my-decision.md
   ```

3. フロントマターを更新する。

   ```yaml
   doc_type: decision
   scope: frontend
   id: ADR-FE-0001
   status: proposed
   targets: [screen_implementation]
   date: 2026-08-23
   norms: [PRIN-0002]
   ```

4. このファイルを更新する。「全決定（時系列）」の表に 1 行足し、「カテゴリ別」の該当する節にも足す。1 件目を書くときは `| 未作成 | （まだありません） | - | - | - |` の行を置き換える。

## 関連リンク

- [../README.md](../README.md) — ADR の書き方ガイド（ID・Status・参照方法の正）
- [template.md](./template.md) — ADR テンプレート
- [architecture/system/frontend/](../../architecture/system/frontend/README.md) — フロントエンドのアーキテクチャ
- [process/frontend/](../../process/frontend/README.md) — フロントエンドの開発プロセス
