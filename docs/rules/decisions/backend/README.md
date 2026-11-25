---
doc_type: directory_guide
id: DG-BE-0010
norms: []
scope: backend
---

# バックエンドの決定（backend）

**この階層が持つのは、バックエンド固有の技術的決定である。** アーキテクチャ・フレームワーク・ライブラリ・テスト戦略など、共通しているのは「バックエンド開発の上で重要な決定であること」だけで、対象領域そのものは限定しない。両方の層に効く決定は [common](../common/README.md) に置く。

**現在、この階層の ADR は 0 件である。** 空であること自体が情報なので、表の行もカテゴリの節も消さずに残す。

## 全決定（時系列）

<!-- 欠番: ADR-BE-0001 / ADR-BE-0002 / ADR-BE-0003 は移植元のリポジトリで使用済みの番号である。
     ADR-BE-0001（ISBN の一意性）・ADR-BE-0002（depguard）・ADR-BE-0003（arch-check）はいずれも
     蔵書管理ドメイン固有 + Go 言語固有の決定だったため、このリポジトリには移植していない。
     一度使った番号は再付与しないため、この 3 つは欠番のままにする。次に使えるのは ADR-BE-0004 である。 -->

| ID | タイトル | Status | 日付 | 概要 |
|---|---|---|---|---|
| 未作成 | （まだありません） | - | - | - |

## カテゴリ別

カテゴリの語彙は Architecture / Infrastructure / Testing / Development Process / Conventions の 5 種である。該当が無いカテゴリも節ごと残し、「（まだありません）」と書く。

### Architecture

（まだありません）

### Infrastructure

（まだありません）

<!-- 記入例:
- **ADR-BE-0004** — Supabase をバックエンド基盤として採用する（RDB・認証・RLS を 1 つのサービスに寄せる判断と、その代償）
-->

### Testing

（まだありません）

### Development Process

（まだありません）

### Conventions

（まだありません）

<!-- 記入例:
- **ADR-BE-0005** — 認可の境界を RLS で担保する（アプリ層の条件分岐に認可を持たせない理由）
-->

実運用では、Supabase の採用、認可境界を RLS に置くこと、書き込みの排他制御（OCC）、非同期ジョブの台帳方式、ESLint による境界 89 ルール、統合テストを実 DB で回す方針といった重要な決定が既に確立している。それらの ADR がここに 1 件も無いことが、この階層の最大のギャップである（記録漏れ）。上の記入例は、その未記録の決定をそのまま題材にしている。

## 新しい ADR の追加方法

1. 次の番号を確認する。**この階層は ADR-BE-0001〜0003 が欠番なので、最初の 1 本は ADR-BE-0004 になる。**

   ```bash
   ls docs/rules/decisions/backend/ADR-BE-*.md | tail -1
   # → 1 件も無い。欠番を再利用しないので、次は ADR-BE-0004
   ```

2. テンプレートをコピーする。

   ```bash
   cp docs/rules/decisions/backend/template.md \
      docs/rules/decisions/backend/ADR-BE-0004-my-decision.md
   ```

3. フロントマターを更新する。

   ```yaml
   doc_type: decision
   scope: backend
   id: ADR-BE-0004
   status: proposed
   targets: [domain_implementation]
   date: 2026-08-23
   norms: [PRIN-0001, ARCH-BE-0013]
   ```

4. このファイルを更新する。「全決定（時系列）」の表に 1 行足し、「カテゴリ別」の該当する節にも足す。1 件目を書くときは `| 未作成 | （まだありません） | - | - | - |` の行を置き換える。

## 関連リンク

- [../README.md](../README.md) — ADR の書き方ガイド（ID・Status・参照方法の正）
- [template.md](./template.md) — ADR テンプレート
- [architecture/system/backend/](../../architecture/system/backend/README.md) — バックエンドのアーキテクチャ
- [process/backend/](../../process/backend/README.md) — バックエンドの開発プロセス
