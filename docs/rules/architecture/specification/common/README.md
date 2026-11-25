---
doc_type: directory_guide
id: DG-0006
norms: []
scope: common
---

<!--
  欠番の記録(消さないこと。消すと番号衝突が起きる)

  - 移植元の ARCH-SP-0001(API 契約ディレクトリの構成)は未移植である。骨格だけを移植したため。
    必要になった時点で書き起こす。起票の条件は「契約文書が復活するとき」のみ。
  - ARCH-SP-0001 は移植元で使用済みの番号なので **再利用しない**(id_policy「再利用しない」)。
  - よって common スコープの新規採番は 0002 から始めている。
  - ARCH-SP-0002 が決めた内容のうち関連するのは「docs/specs/common を使わない」という現構成の決定である。
-->

# architecture/specification/common — 共通領域の仕様書構造

この階層が担当するのは、仕様書のうち **FE と BE の双方が参照する共通領域**の配置・命名・運用ルールである。ドメイン仕様(`docs/specs/domain/`)の構造がその中心にある。

**スコープ単位(backend / frontend)に閉じない architecture だけをここに置く。** 片方しか読まないものをここに置くと、共通領域が「とりあえずの置き場」に膨らみ、共有の頂点がどこなのか分からなくなる。

---

## 配下の文書

| 文書 | 内容 |
|---|---|
| [ARCH-SP-0002-domain-spec-structure.md](./ARCH-SP-0002-domain-spec-structure.md) | ドメイン仕様(`docs/specs/domain/`)の構成。5 つの `doc_type` の責務分担、集約ディレクトリの構造、`docs/specs/common/` を廃して `domain` を共有の頂点とする決定、他レイヤーからドメインイベント ID を参照する原則、生成物の置き場所 |

`ARCH-SP-xxxx` を足したらこの表に行を足す。

### 落としてはいけない規範

- **`ARCH-SP-0001` は欠番であり、再利用しない。** 番号を使い回すと、移植元の記録や過去のやり取りが別の文書を指すようになる。
- **common スコープの採番は 0002 から始まる。** 上の欠番の帰結である。
- **`docs/specs/common/` は使わない。** FE と BE が共有する頂点は `docs/specs/domain/` である。共通の置き場を 2 つ持つと、どちらが正かの判定が人間の記憶に依存する。

---

## 関連

| 知りたいこと | 見る場所 |
|---|---|
| バックエンド仕様の構成 | [specification/backend/](../backend/README.md)(ARCH-SP-BE-0001) |
| フロントエンド仕様の構成 | [specification/frontend/](../frontend/README.md) |
| ドメイン仕様の書き方 | [domain-spec-writing.md](../../../process/common/specification/standards/domain-spec-writing.md) |
