---
doc_type: decision
scope: common
id: ADR-0010
status: accepted
targets: [infrastructure]
date: 2026-09-06
norms: [PRIN-0001, PRIN-0007]
---

# ADR-0010: 10 分間隔のジョブは Supabase pg_cron + pg_net から Vercel の口を叩く(Vercel Cron は日次のみ)

## Status

accepted (2026-09-06)

---

## Context

### 背景

ARCH-0001 / ADR-0007 は「アプリケーションの計算は Vercel に一元化する」既定方針を定めており、定時処理（業務）は Vercel Cron → operation という配置になっていた。`docs/specs/backend/jobs.md` の 2 本のジョブ(`run_due_jobs` = 取り残しの掃除役、`report_overdue_loans` = 期限走査)は `*/10 * * * *`(10 分間隔)で `app/vercel.json` に登録されていた。

本番デプロイを実施したところ、Vercel が次のメッセージでデプロイを拒否した(実測 2026-09-06)。

```
Hobby accounts are limited to daily cron jobs.
```

**Vercel Hobby プランの Cron は 1 日 1 回までしか登録できない。** 10 分間隔の 2 本は Hobby のままでは動かせない。

### 前提条件

- このプロジェクトは「小規模」であり、有料プランは現時点では使わない(ADR-0007 の前提条件と同じ)。
- ARCH-0001 の昇格条件表には「Cloudflare Cron Triggers | プラン都合で Vercel Cron の頻度が足りない」という項目が既に用意されている。ただし Cloudflare Workers を新たに使い始めることになり、ADR-0007 が避けたかった「ランタイムの分裂」を新しい形で持ち込む。
- Supabase は pg_cron(スケジューラ)と pg_net(HTTP クライアント)を最初から `shared_preload_libraries` に積んでおり(実測: ローカル Postgres で確認済み)、`create extension` だけで使える。**新しいサービスを増やさずに済む**。
- ADR-0007 の Notes は「pg_cron は『DB に閉じた定期メンテのみ』という例外であり、ここに業務ロジックが入り始めたら実行場所が二重化した合図」と書いており、pg_cron の使用範囲を広げること自体は無条件には許されない。
- ADR-0007 の Neutral は「Cloudflare Cron Triggers から Vercel のエンドポイントを叩く運用は、既定を外れる『昇格』ではなくプラン差の吸収として扱う(計算は Vercel のままであるため)」と既に書いている。Supabase pg_cron + pg_net による同じ形のトリガも、この考え方をそのまま延長できる。

### なぜ Cloudflare Cron Triggers ではないか

ARCH-0001 の昇格条件は Cloudflare Cron Triggers を名指ししているが、今回は採用しない。

- Cloudflare Workers アカウントの新規セットアップ・別 CI 系統・別デプロイパイプラインが要る。
- Supabase は既にこのプロジェクトの必須インフラであり、pg_cron / pg_net は追加のプロビジョニングなしで使える(実測確認済み)。
- 叩くだけの HTTP トリガという役割において、Cloudflare Cron Triggers と Supabase pg_cron + pg_net の間に機能差は無い。

---

## Decision

### 決定内容

**job_spec に「実行者」(`runner`)の軸を追加し、`vercel_cron` と `pg_cron` の 2 値の値域にする。10 分間隔の 2 本(`run_due_jobs` / `report_overdue_loans`)は `runner: pg_cron` とし、Supabase の pg_cron + pg_net から Vercel の Route Handler を HTTP で叩く。日次の 2 本(`sync_tutorial_docs` / `detect_reachability`)は `runner: vercel_cron` のまま Vercel Cron に残す。**

1. **計算は Vercel のまま動かさない**。pg_cron の migration に書くのは `net.http_get(...)` の呼び出し 1 行だけであり、業務ロジック(ジョブの取り出し・期限判定等)は一切書かない。ARCH-0001 が言う「業務ロジックを含めない pg_cron」の例外規定として明文化する。
2. **仕様の宣言に実行者を持ち込む**。`runner: vercel_cron | pg_cron` を job_spec に追加し、機械検査(J2 の対象を `vercel_cron` に限定・J3 を新設して `pg_cron` を `supabase/migrations` の `cron.schedule` と双方向に突き合わせる・J4 を新設して `vercel_cron` の cron 式が 1 日 1 回以下であることを見る)で「どちらの実行者が、どの頻度で叩くか」を暗黙にしない。
3. **秘密は migration に書かない**。叩く先の URL と認可トークンは Supabase Vault(`cron_base_url` / `cron_secret`)に置き、migration はそこから読む。
4. **ADR-0007 の既定方針(計算は Vercel に一元化)は変えない**。今回の変更は「時刻をトリガする場所」をプランの制約に合わせて 2 通りに分けただけであり、Neutral に書かれた Cloudflare Cron Triggers の扱いと同じ考え方(プラン差の吸収)を Supabase pg_cron + pg_net に広げるものである。

### 適用範囲

- `docs/specs/backend/jobs.md` の `source: schedule` の全行(`runner` は 4 件とも必須)
- `legacy/spec-tools/lib/job/`(J2 の対象限定・J3 / J4 の新設)
- `app/vercel.json`(`vercel_cron` の行だけが残る)
- `supabase/migrations/`(pg_cron の登録)

---

## Consequences

### Positive（メリット）

- **無料プランのまま 10 分間隔の掃除役・期限走査を維持できる。** Pro プランへの課金判断を先送りできる。
- **新しいサービスを増やさない。** Supabase は既存の必須インフラであり、pg_cron / pg_net はそこに元から積まれている。
- **「どちらの実行者が叩くか」が仕様の宣言になる。** J2〜J4 が両方向を機械的に見るため、Vercel Cron と pg_cron のどちらに登録したかが暗黙の挙動に戻らない。
- **Vercel Hobby の制約が仕様の検査(J4)になる。** 今後 `vercel_cron` のジョブを足すときに、うっかり 1 日複数回の cron 式を書いても verify が落とす。

### Negative（デメリット・トレードオフ）

- **時刻起点のトリガが 2 系統に割れる。** Vercel Cron と Supabase pg_cron のどちらで動いているかを見るには job_spec の `runner` を読む必要がある(以前は `app/vercel.json` を見れば全部わかった)。
- **pg_net の呼び出しは非同期(fire-and-forget)である。** `net.http_get` はリクエストを `net._http_response` に積んで返すだけで、HTTP レスポンスの成否をその場で確認できない。失敗の検知は `cron.job_run_details` を見る運用に頼る。
- **Supabase Vault への値投入が本番構築の手順に 1 つ増える**(runbook.md §2-3')。投入を忘れると、10 分間隔のジョブが「登録はされているが叩けていない」状態で気づかれずに放置されうる。

### Neutral（その他の影響）

- ARCH-0001 の配置決定表・昇格条件表は「pg_cron は DB に閉じたメンテのみ」という原則を維持しつつ、「Vercel の口を叩くだけのトリガ」を明示的な例外として追記する(本 ADR が根拠)。
- Pro プランに上げて Vercel Cron の頻度制約が緩んだ場合、`run_due_jobs` / `report_overdue_loans` を `runner: vercel_cron` に戻すことは可能だが、必須の変更ではない(pg_cron のままでも動作上の問題は無い)。

---

## Alternatives Considered

### Option 1: Cloudflare Cron Triggers から Vercel の口を叩く(ARCH-0001 が既に用意していた昇格条件)

- **Pros**:
  - ARCH-0001 に既に条件が明文化されている「正規の昇格パス」である
  - Cloudflare は既にこのプロジェクトの前段(DNS・WAF)を担っており、契約は増えない
- **Cons**:
  - Cloudflare Workers(Cron Triggers はその機能)のセットアップ・デプロイパイプラインが新たに要る
  - Supabase pg_cron + pg_net という「既存インフラで完結する」選択肢に比べ、可動部が 1 つ増える
- **Why rejected**: Supabase は既に必須インフラであり pg_cron / pg_net はプロビジョニング不要で使える。同じ「トリガだけ」という役割なら、増やすサービスが少ない方を採る。

### Option 2: Vercel を Pro プランに上げる

- **Pros**:
  - `runner` の軸を導入する必要がなく、既存の Vercel Cron 宣言のままで済む
  - Cron の頻度・本数の制約が大きく緩和される
- **Cons**:
  - 小規模開発規模で継続課金が発生する
  - 制約に当たるたびにプランを上げる、を繰り返す設計にしてしまう
- **Why rejected**: 「小規模体制」で品質を仕組みで担保するという前提(ADR-0007)に対し、プラン課金で制約を消す解決は再現性が低い。無料の範囲で仕組みとして解決できるなら、そちらを優先する。

### Option 3: 10 分間隔をやめ、日次バッチに寄せる

- **Pros**:
  - 変更が一切不要(`app/vercel.json` の頻度を落とすだけ)
- **Cons**:
  - `run_due_jobs`(通知の遅延)・`report_overdue_loans`(期限切れの延滞の自動記録)のどちらも、体感の即時性が大きく損なわれる
  - ARCH-BE-0015 の「Cron は掃除役、遅れても壊れない」という設計はあるが、1 日 1 回まで遅延を許すのは業務要件として許容できない
- **Why rejected**: 頻度を落とすのは設計判断ではなく機能の劣化であり、Hobby プランの都合をユーザー体験に転嫁することになる。

---

## Implementation

### Tasks

- [x] job_spec に `runner` 軸を追加(J0 でスキーマ検査)
- [x] J2 の対象を `runner: vercel_cron` に限定
- [x] J3(`runner: pg_cron` ⇔ `supabase/migrations` の `cron.schedule`)を新設
- [x] J4(`runner: vercel_cron` の cron 式が 1 日 1 回以下)を新設
- [x] 元の製品の migration で pg_cron + pg_net を有効化し、2 本を登録
- [x] `app/vercel.json` から 10 分間隔の 2 本を外す
- [ ] 本番の Supabase Vault に `cron_base_url` / `cron_secret` を投入する(runbook.md §2-3'。実施は本番構築時)

### Timeline

- 決定: 2026-09-06

---

## Related Decisions

- **Supersedes**: None
- **Superseded by**: None
- **Related**: [ADR-0007](./ADR-0007-vercel-centralized-compute.md)(計算の Vercel 一元化という既定方針そのものは変えず、時刻トリガの配置だけをプラン差として吸収する)
- **Blocks**: None
- **Blocked by**: None

---

## References

- [ARCH-0001 — 計算基盤の配置ポリシー](../../architecture/system/common/ARCH-0001-compute-placement.md)
- [ADR-0007 — 計算は Vercel に一元化し、他ランタイムは昇格条件付きで温存する](./ADR-0007-vercel-centralized-compute.md)
- [job-spec-writing.md §runner](../../process/backend/specification/standards/job-spec-writing.md)
- [ARCH-BE-0015 — 非同期ジョブ実行基盤（outbox + ワーカー）](../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)

---

## Notes

### この ADR と ADR-0007 の関係

本 ADR は ADR-0007 の既定方針(計算は Vercel に一元化)を覆すものではない。ADR-0007 の Notes が予告していた「pg_cron に業務ロジックが入り始めたら実行場所が二重化した合図」という条件には該当しない —— pg_cron の migration に書くのは `net.http_get` の呼び出し 1 行だけであり、ジョブの取り出し・締切判定といった業務ロジックは今までどおり Vercel の Route Handler(`app/src/app/api/jobs/run` / `app/src/app/api/deadlines/run`)が担う。ADR-0007 の Neutral に書かれた「Cloudflare Cron Triggers から Vercel のエンドポイントを叩く運用はプラン差の吸収として扱う」という考え方を、Supabase pg_cron + pg_net という別の実装手段に広げただけである。

### 秘密の運用

`cron_base_url` / `cron_secret` を Vault に投入する手順は runbook.md §2-3' に置く。値が未投入のローカル環境では `net.http_get` の呼び出しが失敗し、`cron.job_run_details` にエラーとして記録される(素通しにしない設計)。本番では初期構築のチェックリスト(runbook.md §2)の一部として必ず投入する。
