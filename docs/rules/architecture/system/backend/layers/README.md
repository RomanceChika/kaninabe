---
doc_type: directory_guide
id: DG-BE-0021
norms: [ARCH-BE-0001]
scope: backend
---

# architecture/system/backend/layers — 層ごとの構造文書

このディレクトリは、**1 つの層について書くことが多くなったとき**にその層の構造文書を置く枠である。現在は空である。

**各レイヤーの責務・構成・制約の正は [ARCH-BE-0001](../ARCH-BE-0001-app-layer-structure.md) であり、このディレクトリではない。** 下の一覧は ARCH-BE-0001 からの転記であって、正ではない。

分割の発火条件は「1 層あたりの記述量が増えたとき」である。現時点の判断は「層ごとの構造文書は不要」であり、根拠は全層の責務と依存方向が ARCH-BE-0001 の 1 文書に収まっていることである。**先回りして空ファイルを作らない。**

---

## 層の一覧（ARCH-BE-0001 より）

| 層 | 責務 | 層ごとの構造文書 |
|---|---|---|
| `src/domain` | 純粋 TypeScript。生成物(`generated/`)と汎用エンジン(`engine/`)。依存ゼロ | （未整備） |
| `src/operation` | 業務手順。Repository と外部連携インターフェースを DI で受ける | （未整備） |
| `src/infrastructure` | Supabase 実装・外部アダプタ | （未整備） |
| `src/composition` | Composition Root(DI の配線のみ) | （未整備） |
| `src/app` | Next.js のルート(RSC)+ Server Actions + Route Handlers | [ARCH-BE-0013](../ARCH-BE-0013-server-action-structure.md)(Server Action の構造) |
| `src/components` | UI | （未整備） |

**（未整備）の行を消さない。** 空であることを明示するのが directory_guide の役目であり、行ごと消すと「その層は存在しない」と読める。

---

## 書く場所の分担

このリポジトリで繰り返し現れる 2 軸の分担が、ここでは最も端的な形で出ている。

| 書くこと | 置き場所 |
|---|---|
| 層の責務・構成・制約(何をどこに置くか) | このディレクトリ、または [ARCH-BE-0001](../ARCH-BE-0001-app-layer-structure.md) |
| 実装のきまり・コード例(どう書くか) | [process/backend/system/standards/layers/](../../../../process/backend/system/standards/layers/README.md) |

受け皿は既にある。process 側には `domain` / `operation` / `infrastructure` / `composition` / `presentation` の各ディレクトリが実在する(層の括り方はこの表と完全には一致していない)。
