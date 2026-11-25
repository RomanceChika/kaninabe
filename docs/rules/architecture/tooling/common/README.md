---
doc_type: directory_guide
id: DG-0030
norms: []
scope: common
---

<!--
  ARCH-CM-0001(legacy/spec-tools のツール設計方針)の状況

  - 移植元の ARCH-CM-0001 は骨格のみを移植した。本体は未移植である。
  - 書き起こしのタイミングは「ドキュメントの検証・生成ツールを整備する時点」としていた。
    その条件は既に満たされている(verify / generate が実運用に入っている)にもかかわらず、文書は不在のままである。
  - 番号 ARCH-CM-0001 はこの主題に予約されており、他の主題に使い回さない。
-->

# architecture/tooling/common — スコープ横断のツール設計

この階層が担当するのは、スコープをまたぐツールコード(`legacy/spec-tools` など)の**設計方針**である。ツールをどう分割し、どちらの向きに依存させ、どこをエントリポイントにするか —— それを定めるのがここの役目である。

**現状、この階層に文書は無い。** 一方でツール自体は既に大きく育っており、`npm run verify`(V 群 / A 群ほか)、`npm run generate`、`npm run generate:check`(C1)は実運用に入っている。**設計方針の空白が、この階層で最も大きい実運用とのずれである。**

---

## 一覧

| 文書 | 内容 |
|---|---|
| ARCH-CM-0001（未整備） | `legacy/spec-tools` のツール設計方針 |

**未整備の行を消さない。** 行ごと消すと「その文書は要らない」と読める。空であることを明示するのが directory_guide の役目である。

ツール系の ID は `ARCH-CM-xxxx` を使う。`ARCH-xxxx`(system)や `ARCH-SP-xxxx`(specification)とは別の接頭辞であり、番号空間を共有しない。

---

## 関連

| 知りたいこと | 見る場所 |
|---|---|
| ツールコードのアーキテクチャの入口 | [architecture/tooling/](../README.md) |
| `legacy/spec-tools` の実装規約(書き方の正) | [scripts-code-quality.md](../../../process/common/tooling/standards/scripts-code-quality.md) |

ここでも「**設計方針は architecture、実装規約は process**」という 2 軸の分担が効いている。ツールをどう組み立てるかは構造の問題であり、コードをどう書くかは手順の問題である。
