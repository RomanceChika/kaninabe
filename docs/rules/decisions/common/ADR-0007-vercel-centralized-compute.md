---
doc_type: decision
scope: common
id: ADR-0007
status: accepted
targets: [infrastructure, testing_strategy]
date: 2026-08-06
norms: [PRIN-0003, PRIN-0005, PRIN-0007, PRIN-0009]
---

# ADR-0007: 計算は Vercel に一元化し、他ランタイムは昇格条件付きで温存する

## Status

accepted (2026-08-06)

---

## Context

### 背景

技術スタックは Next.js（Vercel）+ Supabase + Cloudflare です。この 3 者はいずれも**計算を実行できる場所**を提供します。

- Vercel: Node ランタイムの関数（RSC / Server Action / Route Handler / Cron）
- Supabase: Edge Functions（Deno）
- Cloudflare: Workers（workerd）

素直に「それぞれ得意なところに置く」と、**デプロイ先が 3 つのランタイムに分裂**します。その帰結は次のとおりです。

#### 1. テスト戦略が系統ごとに割れる

ランタイムが違えば、ローカル実行方法・モックの張り方・統合テストの起こし方が変わります。「1 コマンドで完結しないとテスト先行の運用は回らない」という前提に対して、3 系統のテスト起動は正面から反します（PRIN-0003）。

#### 2. 仕様突合が 3 系統になる

ドメインイベント ID を共通通貨として、画面 / Server Action / Webhook の宣言を突合する設計（ARCH-SP-0002）は、**実装の置き場が一意であること**を前提にしています。同じ種類の処理が Vercel にも Edge Functions にもある状態では、突合器が両方の領域を知る必要があり、検証器の複雑さが跳ね上がります。

#### 3. 層構成が分裂する

Edge Functions に処理を置くと、その処理は `app/src/operation` の層構成の外に出ます。DI・IF・テスト戦略が及ばない第 2 の実装体系ができ、ARCH-BE-0001 の依存方向の執行が届かなくなります。

### 前提条件

- 「小規模体制」で品質を仕組みで担保することが目的であり、運用の面倒を増やす選択は割高になる。
- ホスティングの制約（配達保証なし・常駐不可・実行時間上限・ボディサイズ上限）は、outbox・Realtime・署名 URL 等の設計で吸収可能である（ARCH-0001）。
- Cloudflare は前段（DNS・CDN・WAF・レート制限）としての価値が計算とは独立に大きい。
- 将来スケールした場合の逃げ道（専用ジョブ基盤・Workers）は、必要になってから足せる。

---

## Decision

### 決定内容

**アプリケーションの計算は Vercel に一元化する。Supabase Edge Functions は使わない。Cloudflare は前段の守りに徹し、Workers 等での計算は既定では使わない。いずれも「昇格条件」を明示して温存する。**

1. **既定の配置**: 処理の種類から実行場所が一意に決まる配置決定表を ARCH-0001 に置き、それを正とする。
2. **Supabase Edge Functions を使わない**: 別ランタイムを増やさないため。DB に閉じた定期メンテのみ pg_cron を許容する（業務ロジックは置かない）。
3. **Cloudflare は前段のみ**: DNS・CDN・WAF・レート制限。Workers での計算は既定から外す。
4. **昇格条件を先に決めておく**: 実測で条件が成立したときに限り、ADR を書いて既定を外れる（条件の一覧は ARCH-0001）。
5. **プラン差は構成ではなく設定で吸収する**: 商用利用や Cron 頻度の要件はプランで解決し、アーキテクチャを変えない。Cron はもともと掃除役であり、頻度が粗くても遅延するだけで壊れない設計にしておく。

### 適用範囲

- アプリケーションのすべての実行形態（同期処理・ストリーミング・非同期副作用・定時処理・Webhook 受信）
- `app/` の層構成が及ぶ範囲（ARCH-BE-0001）
- テスト戦略（ローカル実行の単一化）

---

## Consequences

### Positive（メリット）

- **テストが 1 系統で済む**。ローカル実行・統合テスト（ローカル Supabase）・仕様突合がすべて同じ環境で完結する（PRIN-0003）。
- **層構成の執行が全処理に及ぶ**。ワーカーも Webhook 処理も `operation` として書かれ、同じ依存方向の検査・同じ仕様突合に乗る。
- **配置の判断が毎回不要になる**。配置決定表を引けば決まる。「どこに置くか」で悩む時間と、判断のばらつきが消える。
- **移行の余地を残せる**。昇格条件を先に書いてあるため、必要になったときの判断が「条件が成立したか」の確認で済む（PRIN-0007 の運用版）。

### Negative（デメリット・トレードオフ）

- **各サービスの得意技を使い切らない**。エッジでの低レイテンシ処理や、DB に近い Edge Functions の利点は取りこぼす。
- **単一ベンダーへの依存が濃くなる**。Vercel 固有の機能（`waitUntil` 等）に触れる箇所ができる。利用は `src/app` に閉じる規約で被害範囲を限定する。
- **上限に当たったときの作業が後ろ倒しになる**。実行時間・頻度の制約に当たった時点で、昇格の実装が必要になる。
- **プラン費用が構成の前提に入る**。商用利用・Cron 頻度は有料プランで解決する方針のため、無料での商用運用はできない。

### Neutral（その他の影響）

- Cloudflare Cron Triggers から Vercel のエンドポイントを叩く運用は、既定を外れる「昇格」ではなくプラン差の吸収として扱う（計算は Vercel のままであるため）。
- Supabase Realtime の利用はこの決定と矛盾しない。Realtime はデータ基盤の機能であり、計算の配置ではない。

---

## Alternatives Considered

### Option 1: 適材適所（Edge Functions / Workers / Vercel を処理ごとに使い分ける）

- **Pros**:
  - 各処理を最適な実行環境に置ける（レイテンシ・コスト・DB 近接）
  - ベンダー分散によりロックインが薄まる
- **Cons**:
  - デプロイ先が 3 ランタイムに分裂し、テスト戦略・仕様突合・層構成が系統ごとに割れる
  - 同じ種類の処理がどこに置かれているか、都度判断と記憶が必要になる
  - 小規模開発規模では、得られる最適化より運用の複雑さのほうが高くつく
- **Why rejected**: 本フレームワークの価値は「機械が全域を検査できること」にある。実装の置き場が分裂すると検査の前提が崩れる。

### Option 2: Cloudflare Workers を主計算基盤にする（Next.js を Workers 上で動かす）

- **Pros**:
  - エッジ実行によるレイテンシ改善、コストの点での優位
  - Cron Triggers など定時実行の自由度が高い
- **Cons**:
  - workerd 上での Next.js 実行に固有の制約があり、Node 前提のライブラリ選定に制約が乗る
  - ローカル開発・テストの構成が Vercel 前提より複雑になる
  - 現時点の要件（個人〜小規模）でレイテンシが制約になっていない
- **Why rejected**: 単一ランタイムという利点は満たすが、制約の総量が増える。前段の守りとしての Cloudflare の価値は、計算を移さなくても得られる。

### Option 3: ジョブ基盤（Inngest / QStash 等）を最初から導入する

- **Pros**:
  - リトライ・スケジュール・可視化が最初から揃う
  - ワーカーの自作が不要
- **Cons**:
  - 外部サービスが 1 つ増え、リトライ方針が自作のテスト可能な純粋関数ではなくなる（ARCH-BE-0015 の利点が消える）
  - 仕様（`effects`）との突合が外部サービスの設定に散る
- **Why rejected**: outbox + 自作ワーカーは約 100 行で、リトライ方針をユニットテストできる利点が大きい。昇格条件を書いて温存する。

---

## Implementation

### Tasks
- [x] 配置決定表と昇格条件を ARCH-0001 として明文化
- [ ] `waitUntil` 等のランタイム固有 API の利用箇所を `src/app` に限定するリンタールール
- [ ] Cron から叩く掃除役エンドポイントの実装（ARCH-BE-0015）
- [ ] 昇格条件に該当したときの ADR テンプレート運用（条件・実測値・移行先を書く）

### Timeline
- 決定: 2026-08-06

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: [ADR-0004](./ADR-0004-generated-transition-table-engine.md)（ワーカーも通常の operation 関数として同じ層構成に乗せる前提）・[ADR-0010](./ADR-0010-pg-cron-vercel-trigger.md)（Vercel Cron の頻度制約を Supabase pg_cron + pg_net の「叩くだけのトリガ」で吸収する。計算の Vercel 一元化はそのまま維持する）
- **Blocks**: None
- **Blocked by**: None

---

## References

- [PRIN-0003 — テスト可能性を保つ](../../principles/common/PRIN-0003-testability.md)
- [PRIN-0005 — 境界を尊重する](../../principles/common/PRIN-0005-respect-boundaries.md)
- [ARCH-0001 — 計算基盤の配置ポリシー](../../architecture/system/common/ARCH-0001-compute-placement.md)
- [ARCH-BE-0015 — 非同期ジョブ実行基盤（outbox + ワーカー）](../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)

---

## Notes

### この ADR と ARCH-0001 の役割分担

本 ADR は**なぜ一元化するか**だけを持ち、**どこに何を置くか**（配置決定表・昇格条件・ホスティング制約への対処）の正は [ARCH-0001](../../architecture/system/common/ARCH-0001-compute-placement.md) にある。配置を調べるときは ARCH-0001 を見る。両者がずれた場合は ARCH-0001 を正とし、本 ADR の記述を改訂する（PRIN-0007）。

### 昇格条件の運用

「昇格条件を先に決めておく」（決定内容 4）は、**実測値なしに昇格しない**という縛りとセットで初めて機能する。既定を外れる実装を入れるときは、条件・実測値・移行先を書いた新しい ADR を起こし、本 ADR の Related Decisions に相互リンクを張る。条件を満たさないまま「将来必要になりそうだから」で別ランタイムを足すのは、この決定が禁じているもの（Context の「ランタイムが増えるとテスト戦略と仕様突合が分裂する」）そのものである。

### 温存しているもの

Supabase Edge Functions と Cloudflare Workers は**捨てていない**。使わないと決めているだけで、契約・依存関係としては残っている。pg_cron は「DB に閉じた定期メンテのみ」という例外であり、ここに業務ロジックが入り始めたら実行場所が二重化した合図なので、本 ADR の見直しに入る。
