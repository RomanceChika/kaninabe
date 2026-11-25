---
doc_type: directory_guide
id: DG-FE-0002
norms: []
scope: frontend
---

<!--
  ARCH-SP-FE-0001(フロントエンド仕様書のディレクトリ構成)の状況

  - 移植元の ARCH-SP-FE-0001 は未移植のままである(骨格のみ移植した)。番号は予約されており、他の主題に使い回さない。
  - 書き起こしの方針は「Next.js の構成に整合させる」こと。
  - 当初の書き起こし時期は「UI 実装フェーズ」としていたが、そのフェーズは既に過ぎ、
    形式は process と docs/specs/frontend 側で確立した。この階層に文書が無いのはそのためである。
-->

# architecture/specification/frontend — フロントエンド仕様の構造

この階層が担当するのは、フロントエンド仕様書の**構成と分割方針**である。ディレクトリ構成の正は `ARCH-SP-FE-0001` に置く予定だが、**この文書はまだ書かれていない**。

配下が空であることには理由がある。以下はその理由と、空白の外で既に決まっていることの案内である。

---

## 現状: 意図的な先送り

この階層は「未着手の放置」ではなく、**意図的な先送り**として空にしてあった。

先送りしていたのは、フロントエンド仕様の**形式**である。具体的には次の 3 つだった。

- 画面 / ビューの分割
- テストとの対応
- `testid` の規約

先送りの決め方は「**UI 実装フェーズで実物と併走して設計する**」であり、理由は「先に形式だけ決めても、実装を始めた時点で作り直しになる」ことだった。

**そのフェーズは既に済んでおり、先送りは解けている。** 3 つはいずれも実物と併走して決着し、正はこの階層ではなく次の場所にある。

| 決めたこと | 正の所在 |
|---|---|
| 画面 / ビューの分割、仕様の書き方 | [screen-spec-writing.md](../../../process/frontend/specification/standards/screen-spec-writing.md) |
| テストとの対応、`testid` の規約 | [screen-test.md](../../../process/frontend/system/standards/conventions/screen-test.md) |
| 仕様の書式の雛形 | [template.screen_spec.md](../../../../specs/frontend/screens/template.screen_spec.md) |

残っているのは、**確立した形式を `ARCH-SP-FE-0001` として構成の正典に書き起こす**作業だけである。それが済むまで、配置と分割の根拠は上の 3 文書から読むことになる。

---

## 先送りしていないもの

形式が未確定だった間も、**先送りしていない決まりが 2 つある**。どちらも根拠は [ARCH-SP-0002](../common/ARCH-SP-0002-domain-spec-structure.md) であり、いまも有効である。

- **画面はドメインイベントを `emits` で参照する。状態・権限・制約を画面側で再定義しない。** 画面が独自に「この状態なら押せる」と書き始めると、ドメイン仕様を直しても画面が古い判断を持ち続ける。
- **フォームのバリデーションは `entity_spec` からの生成物(zod スキーマ)を使う。** 手書きのバリデーションはドメインの制約と静かにずれる。

---

## 関連

| 知りたいこと | 見る場所 |
|---|---|
| 仕様書の YAML スキーマ・書き方 | [process/frontend/specification/](../../../process/frontend/specification/README.md) |
| UI 側のコード構造 | [architecture/system/frontend/](../../system/frontend/README.md) |
| 参照先のドメイン仕様の構成 | [specification/common/](../common/README.md)(ARCH-SP-0002) |
