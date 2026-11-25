---
id: DG-BE-0033
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001, ARCH-BE-0013]
---

# presentation 層（app/src/app）

presentation 層の**実装のきまりとコード例**を置く箱である。責務・構成は [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の `app/src/app` の節と、[ARCH-BE-0013](../../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)(Server Action の構造)が正であり、ここでは定義しない。

**この層の実装規約は [conventions/server-actions.md](../../conventions/server-actions.md) として先行整備済みである。** 層の文書より規約のほうが先に立った珍しいケースで、理由は Server Action の書き方が composition・operation・infrastructure を貫くため、層に閉じた文書に収まらなかったことである。

文書はルール(`xx.md`)を置く。Server Action / Route Handler / RSC のように責務を分ける場合は、その責務ごとにルール文書を追加する。新規・改訂のとき、ルールは [../template.md](../template.md) に従う。

## 配下の文書（ルール＋例）

| ルール | 例 | 内容 |
|---|---|---|
| (未整備) | — | — |

配下に文書はまだ 1 件も無い。この層の規範は現在ほかの文書にある。

- **Server Action の実装規約**(配置・命名、定型の手順、`Result` とエラーの分類)—— [conventions/server-actions.md](../../conventions/server-actions.md)
- **Route Handler**(`app/src/app/api/**/route.ts`。Cron・Webhook など人間のセッションを持たない呼び出し元の受け口)—— [conventions/route-handlers.md](../../conventions/route-handlers.md)
- **サーバー専用コードがクライアントバンドルに入らないことの保証** —— [conventions/enforcement/server-client-separation.md](../../conventions/enforcement/server-client-separation.md)

ここに文書を足すのは、**層に閉じたきまりが出てきたとき**である(層をまたぐものは conventions 側に置く)。
