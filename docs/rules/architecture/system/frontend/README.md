---
doc_type: directory_guide
id: DG-FE-0003
norms: [ARCH-BE-0001]
scope: frontend
---

# architecture/system/frontend — UI 側のコード構造

この階層が担当するのは、UI 側(`app/src/components` と `app/src/app` のクライアント境界)の構造である。**配下に `ARCH-FE-xxxx` はまだ 1 本も無い。**

空でも設計が抜けているわけではない。前提として、`app/` は**単一パッケージ**であり UI も同じ依存グラフの中にある。したがって層構成と依存方向は [ARCH-BE-0001](../backend/ARCH-BE-0001-app-layer-structure.md) が全体を扱い、**FE 専用の層文書は別に立てない**。1 つの依存グラフに正典を 2 枚持たせないための線引きである。

---

## 既に決まっていること（ここではなく ARCH-BE-0001 が正）

この階層が空である間も、UI を縛っている規範が 3 つある。正は [ARCH-BE-0001](../backend/ARCH-BE-0001-app-layer-structure.md) と [ARCH-BE-0013](../backend/ARCH-BE-0013-server-action-structure.md) にある。

- **`src/components` が依存してよいのは `src/domain` の型と zod スキーマだけである。** UI が業務手順や取得実装に触れ始めると、層の向きが逆流する。
- **`src/components` から Supabase クライアントと `server-only` モジュールを import しない。** これは読み手の自制ではなく**リンターで機械執行される**(境界ルールの全件は [enforcement-matrix.md](../../../process/backend/system/standards/conventions/enforcement/enforcement-matrix.md) にある)。
- **データ取得は RSC 経由で行い、`useEffect` でのデータ取得はしない。** 根拠は ARCH-BE-0013。クライアント側から取りに行く経路を許すと、認可の執行点が RLS の外に増える。

---

## ここに書き起こすもの（UI 実装フェーズ）

当初この階層は「UI 実装フェーズで実物と併走して整備する」としていた。**そのフェーズは既に進み、書き起こすとしていた 3 点は実質的に決着している。** 現在の正の所在は次のとおりで、残っているのは決着した内容を `ARCH-FE-xxxx` として構造の正典に書き起こす作業である。

| 書き起こすとしていたもの | 決着した先 |
|---|---|
| コンポーネントの分割方針と DI(テスト可能性を最初から両立させる) | [screen-test.md](../../../process/frontend/system/standards/conventions/screen-test.md) と `/add-screen` スキルの `_screens` DI |
| フォームと生成 zod スキーマの結線 | `entity_spec` からの生成物を使う運用(ARCH-SP-0002 由来) |
| 画面仕様(`docs/specs/frontend/`)との対応 | [screen-spec-writing.md](../../../process/frontend/specification/standards/screen-spec-writing.md) と [template.screen_spec.md](../../../../specs/frontend/screens/template.screen_spec.md) |

見た目の層(デザイントークンと部品のスタイル)も [styling.md](../../../process/frontend/system/standards/conventions/styling.md) が正であり、この階層の担当ではない。仕様書側の構成は [specification/frontend/](../../specification/frontend/README.md) を参照。
