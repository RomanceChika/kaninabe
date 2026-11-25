---
id: DG-BE-0028
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001, PRIN-0003, PRIN-0005, PRIN-0009, PRIN-0010]
---

# process/backend/system/standards/layers — 層ごとの実装のきまり

**層の構造・責務・依存方向は [ARCH-BE-0001](../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) が正である。ここには置かない。** この箱に置くのは、その構造のとおりに書くための**実装のきまりとコード例**だけである。定義を二か所に持つと、必ず片方が古くなる。

## 構成（層＝ディレクトリ）

**1 層 = 1 ディレクトリ**とする。

| ディレクトリ | 対応する実装パス | 内容 | 状態 |
|---|---|---|---|
| [domain/](./domain/README.md) | `app/src/domain` | 生成物の使い方、エンジン、純粋関数のきまり | 未整備 |
| [operation/](./operation/README.md) | `app/src/operation` | インターフェースの切り方、DI の受け方、トランザクション境界 | 未整備 |
| [infrastructure/](./infrastructure/README.md) | `app/src/infrastructure` | Supabase 実装、外部アダプタ、スキーマ変換 | 未整備 |
| [presentation/](./presentation/README.md) | `app/src/app` | Server Action / Route Handler / RSC。規約は [conventions/server-actions.md](../conventions/server-actions.md) が先行 | 未整備 |
| [composition/](./composition/README.md) | `app/src/composition` | Composition Root の配線 | 未整備 |

`app/src/components`(UI)の実装のきまりは**この箱には置かない**。frontend 側の [process/frontend/system/standards/conventions](../../../../frontend/system/standards/conventions/README.md) に置く。なお依存方向の機械執行(層境界のリンタールール)は `components` を含めて 6 層として数えており、この表の 5 ディレクトリとは数え方が違う。数える対象が「backend の層ごとの文書」か「`app/src` の依存グラフ」かの違いである。

## 共通テンプレート

- **ルール文書(`xx.md`)** は同階層の [template.md](./template.md) に従う。節構成は Overview / Scope / Directory Structure / Public API & Naming / Constraints / Interaction Rules / Testing Rules / Minimal Example の 8 節で固定する。
- 参照系(`norms` など)は本文ではなく frontmatter で管理する。

## 整備方針

**層ごとの文書は、その層の実装に着手した時点で追加する。先回りして書かない。** 実物が無いうちに書いたきまりは、実装が始まった瞬間に嘘になる。

現時点で配下 5 ディレクトリはすべて骨格(README のみ)である。一方で `app/` の実装は相当進んでいる。文書が増えていないのは着手していないからではなく、**書かれた規約が層をまたぐものだったため conventions 側に置かれている**からである。

- Server Action の規約は [conventions/server-actions.md](../conventions/server-actions.md)、テストの規約は [conventions/testing/](../conventions/testing/README.md) にある。いずれも複数の層を貫くため、層のディレクトリには入らない。
- operation 層の書き方は、規約とテンプレートコード(`@kaninabe/runtime/template` の 5 形)の側に実体がある。

**層に閉じたきまりが出てきたときに、ここへ書く。** **層をまたぐものは conventions、層に閉じるものだけここ**に置く。
