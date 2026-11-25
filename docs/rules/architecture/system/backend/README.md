---
doc_type: directory_guide
id: DG-BE-0003
norms: []
scope: backend
---

<!--
  採番の由来(消さないこと。消すと番号の誤再利用が起きる)

  - 移植元には Go + Echo + GORM を前提にした ARCH-BE-0001〜0012 があった。
  - そのうち「レイヤー構成」という同一主題を Next.js + Supabase 構成で書き起こしたものが ARCH-BE-0001 である。
    番号を引き継いだのは主題が同じだからであり、例外的な措置である。
  - それ以外の主題は、移植元で使用済みの番号を再利用しない(id_policy「再利用しない」)。
    したがって新規は ARCH-BE-0013 以降で採番している。
  - 結果として **ARCH-BE-0002〜0012 は欠番** である。
-->

# architecture/system/backend — app パッケージのサーバー側構造

この階層が担当するのは、`app/` パッケージの**レイヤー構成と依存方向**、およびサーバー側の主要構造(Server Action・読み取り経路・外部連携・非同期ジョブ)である。

「どこに何を置き、どの向きに依存してよいか」がここで決まる。「どう書くか」は process 側にある。

---

## 構成の概要（直下）

| ID | 文書 | 内容 |
|---|---|---|
| ARCH-BE-0001 | [ARCH-BE-0001-app-layer-structure.md](./ARCH-BE-0001-app-layer-structure.md) | `app/` パッケージの層構成と依存方向。6 層(`domain` / `operation` / `infrastructure` / `composition` / `app` / `components`)それぞれの責務と依存の向き、ESLint 境界ルールによる執行の範囲、`supabase/` との関係 |
| ARCH-BE-0013 | [ARCH-BE-0013-server-action-structure.md](./ARCH-BE-0013-server-action-structure.md) | Server Action の構造。1 アクション = 1 ドメインイベントの原則、定型 4 手順、エラー 3 分類の契約、読み取り(RSC + クエリ関数)との分離 |
| ARCH-BE-0014 | [ARCH-BE-0014-external-integration.md](./ARCH-BE-0014-external-integration.md) | 外部連携の構造。アウトバウンド(インターフェース + アダプタ + outbox + 冪等キー)とインバウンド(Webhook → ドメインイベント)の 2 パターン |
| ARCH-BE-0015 | [ARCH-BE-0015-async-job-execution.md](./ARCH-BE-0015-async-job-execution.md) | 非同期ジョブ実行基盤。outbox のジョブテーブル設計、`waitUntil` + Cron の二段構え、リトライと dead letter、昇格条件 |
| ARCH-BE-0016 | [ARCH-BE-0016-read-path.md](./ARCH-BE-0016-read-path.md) | 読み取り経路の構造。経路は RSC → クエリ関数 → JWT クライアント(RLS 有効)。`operation` を経由しない理由。原則「**絞り込みは宣言、可視性は RLS、実装は写像**」と、`fields_hidden` の執行点 |

`ARCH-BE-xxxx` を足したらこの表に行を足す。

テンプレートは直下・`layers/` とも [architecture/template.md](../../template.md) に解決される(同階層にテンプレートを置かず、上位の 1 枚だけを使う)。

---

## 層の詳細（layers/）

1 つの層について書くことが増えたら、その層の構造文書を [layers/](./layers/README.md) に置く。現時点では全層の責務と依存方向が ARCH-BE-0001 の 1 文書に収まっているため、層ごとの構造文書は作っていない。

層ごとの**実装のきまり・コード例**は architecture ではなく [process/backend/system/standards/layers/](../../../process/backend/system/standards/layers/README.md) が持つ。こちらは既に整備されている。

---

## 関連

| 知りたいこと | 見る場所 |
|---|---|
| どこで実行するか(計算基盤の配置) | [system/common/](../common/README.md)(ARCH-0001) |
| 仕様書の構成 | [specification/backend/](../../specification/backend/README.md)(ARCH-SP-BE-0001) |
| 実装のきまり・コード例 | [process/backend/system/standards/](../../../process/backend/system/standards/README.md) |
