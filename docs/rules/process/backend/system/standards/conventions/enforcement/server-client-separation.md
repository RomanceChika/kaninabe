---
doc_type: process
scope: backend
norms: [PRIN-0005, PRIN-0009, PRIN-0010, ARCH-BE-0001, ARCH-BE-0013]
---

# server / client 分離の機械執行

サーバーでしか動いてはいけないコードが、クライアントバンドルに入らないことを保証する。対応表の **S1〜S3** の詳細。

## 目的・スコープ

- **目的:** 秘密（サービスロールキー・DB 接続情報）と、認可判定を含むコードがブラウザに配られる経路を、構造として存在させない（PRIN-0009）。
- **スコープ:** `app/src/infrastructure` / `app/src/composition`（サーバー専用層）と、`app/src/components`（クライアントに配られうる層）の境界。
- **正の所在:** [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) の E3 / E7、および「DB アクセスはサーバー経由に限る」制約。

## 前提となる考え方

### なぜ二重に守るのか

境界は 3 枚ある。**1 枚目が破れても 2 枚目・3 枚目が残る**ように積んでいる。

| 枚数 | 執行者 | 何を見ているか | すり抜けうる経路 |
|---|---|---|---|
| 1 | ESLint `boundaries/dependencies`（B8） | 静的な import グラフ | 動的 `import()`、文字列で組み立てたパス、新しい層の追加 |
| 2 | ESLint `layer/require-server-only`（S1） | サーバー専用層の各ファイルの先頭宣言 | 宣言を書いたうえで、それでもクライアントから参照される経路 |
| 3 | `server-only` パッケージ + `npm run build`（S2） | 実際のバンドルグラフ | （なし。ビルドが失敗する） |

`src/operation` がこの対象に含まれていないのは、**具象を一切 import せず**（B3）、`components` / `src/app` からの直接 import も禁止されている（B7）ため、クライアントに漏れる経路が構造的に存在しないからである。

## ルール

### サーバー専用層は `import "server-only"` を宣言する（S1）

- **対象:** `src/infrastructure/**/*.ts(x)` と `src/composition/**/*.ts(x)`。ただし `**/*.test.ts(x)` は除く。
- **すべきこと:** ファイルの先頭で `import 'server-only';` を書く。
- **してはいけないこと:** 宣言を省く。「このファイルは秘密を触らないから」という理由での省略も認めない（層単位で一律にすることで、判断の余地をなくす）。
- **執行者:** `app/eslint.config.mjs` 内で定義しているローカルルール `layer/require-server-only`。Program ノードの先頭で `source.value === "server-only"` の `ImportDeclaration` があるかだけを見る。

### `src/components` はサーバー専用パッケージを import しない（B8 / S2）

- **してはいけないこと:** `src/components` から `server-only`、`@supabase/**`、`node:**` を import する。
- **執行者:** `boundaries/dependencies` の `from: components` ポリシーの `disallow` 節（`origin: ["external", "core"]`, `source: ["server-only", "@supabase/**", "node:**"]`）。

### `useEffect` 内でデータ取得しない（S3）

- **してはいけないこと:** `useEffect` のコールバック内で `fetch` を呼ぶ。
- **すべきこと:** 読み取りは Server Component（RSC）から composition 経由でクエリ関数を呼ぶ。書き込みは Server Action（[server-actions.md](../server-actions.md)）。
- **なぜ:** クライアントからの直接取得は、認可の判定点をブラウザ側に増やす。判定点が増えるほど、仕様（`access_spec`）との突合対象が増え、抜けが生まれる。加えて、ウォーターフォールと二重取得という性能上の問題も同時に持ち込む。
- **執行者:** `no-restricted-syntax`。`useEffect` の呼び出しの中に `fetch(...)` / `x.fetch(...)` があるパターン、および `React.useEffect(...)` 形式の 3 セレクタで検出する。

## コード例

### この例が示すルール: サーバー専用層は先頭で宣言する（S1）

✅ 正しい

```ts
// app/src/infrastructure/supabase/client.ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
  // service_role キーはここから外に出ない
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
}
```

❌ 間違い

```ts
// app/src/infrastructure/supabase/client.ts
import { createClient } from '@supabase/supabase-js'; // ← import 'server-only' が無い
```

これは ESLint の `layer/require-server-only` で検出される（1 行目に「サーバー専用層のモジュールは先頭で import "server-only"; を宣言すること」と報告される）。

**ポイント:** このルールは「秘密が漏れたか」ではなく「宣言があるか」だけを見る。判定が単純だから確実に効く。実際の漏洩検出は `npm run build`（S2）が行う。

### この例が示すルール: UI はデータを受け取るだけ（B8 / S3）

✅ 正しい

```tsx
// app/src/app/items/[id]/page.tsx — Server Component 側で取得する
import { getLoanInteractor } from '@/composition';
import { LoanList } from '@/components/loan-list';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { listLoans } = await getLoanInteractor();
  const loans = await listLoans({ itemId: id });
  return <LoanList loans={loans} />;
}
```

```tsx
// app/src/components/loan-list.tsx — props で受けるだけ
'use client';
import type { Loan } from '@/domain/generated/loan.schema';

export function LoanList({ loans }: { loans: Loan[] }) {
  return <ul>{loans.map((l) => <li key={l.id}>{l.state}</li>)}</ul>;
}
```

❌ 間違い

```tsx
// app/src/components/loan-list.tsx
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js'; // ← ①
import type { Loan } from '@/domain/generated/loan.schema';

export function LoanList({ itemId }: { itemId: string }) {
  const [loans, setLoans] = useState<Loan[]>([]);
  useEffect(() => {
    fetch(`/api/loans?itemId=${itemId}`) // ← ②
      .then((r) => r.json())
      .then(setLoans);
  }, [itemId]);
  return <ul>{loans.map((l) => <li key={l.id}>{l.state}</li>)}</ul>;
}
```

- ① は ESLint の `boundaries/dependencies` で検出される（`from: components` ポリシーの `disallow` に `@supabase/**` を挙げているため）。
- ② は ESLint の `no-restricted-syntax` で検出される（`CallExpression[callee.name='useEffect'] CallExpression[callee.name='fetch']` セレクタ）。

**ポイント:** 正しい側では、`LoanList` が「どこから来たデータか」を知らない。この無知が、UI テストを props の差し替えだけで書ける状態を作る（PRIN-0003）。

### この例が示すルール: 層境界を動的 import ですり抜けない（S1 / S2）

❌ 間違い

```tsx
// app/src/components/admin-panel.tsx
'use client';

export function AdminPanel() {
  const load = async () => {
    // 静的な import グラフに現れないため boundaries はこれを見逃す
    const mod = await import('@/infrastructure/supabase/client');
    return mod.createServiceClient();
  };
  // …
}
```

これは `boundaries/dependencies` では**検出されない**。しかし `@/infrastructure/supabase/client` が `import 'server-only'` を宣言している（S1 が保証）ため、`npm run build` がクライアントバンドルへの混入としてビルドを失敗させる（S2）。

**ポイント:** 「lint が通る＝安全」ではない。S1 は lint 自身のためのルールではなく、**ビルド時防衛線を全モジュールに確実に張るためのルール**である。

## 注意点・例外

- **テストでは `server-only` を空実装に差し替えている。** `vitest.config.mts` / `vitest.integration.config.mts` の `resolve.alias` で `node_modules/server-only/empty.js` に向けている。Node 環境では `server-only` が例外を投げるためであり、この差し替えは**テスト実行時に限る**。
- **テストファイルは `layer/require-server-only` の対象外。** `src/**/*.test.ts(x)` は除外している（テストは Node 上で直接実行され、クライアントバンドルに入らない）。
- **`src/operation` は対象外。** 理由は「前提となる考え方」のとおり。operation が外部 SDK を import できるようになった時点でこの前提は崩れるため、B3 を緩める変更はこの文書と `SERVER_ONLY_LAYER_FILES` の同時改訂を伴う。
- **Server Action の中身の規約は別文書。** 4 手順・エラー分類は [server-actions.md](../server-actions.md) と ARCH-BE-0013 が正。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [layer-boundaries.md](./layer-boundaries.md)（1 枚目の境界）
- [database-guards.md](./database-guards.md)（アプリを迂回された場合の最後の防衛線）
- [ARCH-BE-0013 — Server Action の構造](../../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)
- [server-actions.md](../server-actions.md)
