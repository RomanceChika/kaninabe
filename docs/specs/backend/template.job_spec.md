---
doc_type: job_spec
scope: backend
id: job-catalog                   # 固定。1 プロジェクト 1 カタログなので導出元が無い

vocabulary:                       # 必須。**語彙はこのアプリの事情**であり、体系(パーサ・検査器)は軸だけを持つ
  kind:                           # 種別(何をするジョブか)
    - id: "{種別}"
      label: "{表示名}"           # 任意
  on_failure:                     # 失敗したときにどうなるか
    - id: "{挙動}"
      label: "{表示名}"
      means: never_queued | retry_to_dead | next_run | pending_decision   # 必須。この語が失敗したらどうなるか(J6 が行の種類と対で見る。never_queued = 同一トランザクションで実現される行 / retry_to_dead = キューに積まれる行 / next_run = 時刻起点の行 / pending_decision = 未定。選んだ行ごとに J6 が warning を出し、出荷の門が止める)

jobs:                             # ジョブの全数。outbox は effects と・schedule は Cron の登録と双方向に閉じる
  # イベントで積まれるもの(発火元は state_spec の effects が正なので書かない)
  - id: "{ジョブID}"              # source: outbox の ID は effects[].do と同じ文字列
    source: outbox
    kind: "{vocabulary.kind の語}"
    on_failure: "{vocabulary.on_failure の語}"
    summary: "{何をするかを 1 行で}"

  # セッションを終える効果(任意。認証フローの主語が状態機械で、無効化・退会・消去の遷移があるなら J7 が宣言を要求する)
  # kind は vocabulary で { in_transaction: true, declares: [ends_sessions] } を宣言した語にし、on_failure は never_queued の語にする
  - id: "{ジョブID}"
    source: outbox
    kind: "{ends_sessions を declares した語}"
    ends_sessions: "{認証フローの主語の集約}"          # 遷移した行の持ち主のセッションを全部終える
    platform_call: "{認証基盤の呼び出しを本文に持つ RPC}" # 引数は uuid 1 つ。realized_by の RPC が calls で呼ぶ(T19)
    realized_by: { "{machine}.{event}": "{RPC 名}" }
    on_failure: "{never_queued の語}"
    summary: "{何をするかを 1 行で}"

  # 匿名化の認証基盤の側をコミットの後のジョブで消す形(任意)。匿名化の行に platform_call の代わりに platform_job: "{この行の ID}" を書き、
  # 匿名化と同じ遷移の effects に載せる(J5)。管理 API はトランザクションの外なので、コミットと同じトランザクションで積み、失敗は再試行に任せる
  - id: "{ジョブID}"
    source: outbox
    kind: "{キューに積まれる語}"
    on_failure: "{retry_to_dead の語}"
    summary: "{何をするかを 1 行で}"

  # 時刻で起きるもの
  - id: "{ジョブID}"
    source: schedule
    kind: "{vocabulary.kind の語}"
    schedule: "*/10 * * * *"      # cron 式。**app/vercel.json の登録と一致する**(J2 が双方向に見る)
    # not_scheduled_reason: "{まだ Cron に結線していない理由}"   # schedule と排他で必ずどちらか
    endpoint: /api/{...}          # Cron が叩く口。schedule を持つなら必須
    implementation: app/src/operation/{...}.ts                   # 実在も検査される
    fires: "{machine}.{event}"    # 任意。この走査が実行するドメインイベント
    due_from: "{entity}.{field}"  # 任意。**発火時刻の供給元**(「いつ」を仕様から辿れるように)
    on_failure: "{vocabulary.on_failure の語}"
    summary: "{何をするかを 1 行で}"

test_cases:                       # 必須。1 つ以上。実装側の突合テストの宣言
  - id: "TC-JOB-CATALOG-001"
    type: unit
    covers: [success]
    spec_ids: [job-catalog]
    implementation: "app/src/operation/__tests__/jobs/job-catalog.test.ts::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換え、引用符は不要になったら外す。
- **ここに書かないもの**(書くと正が割れる):
    どの遷移が積むか                      → state_spec の effects(J1 が双方向に突合する)
    リトライの回数・バックオフの秒数      → 実装(domain/jobs/retry.ts)と DB の既定値。ここは分類だけ
    payload の中身                        → 積む側(RPC)と読む側(ハンドラ)の間の話
    人の要求に同期して走るもの            → ここは「誰も見ていないときに動くもの」の全数
- 宣言は**閉世界**である。`effects` の副作用とカタログの `source: outbox` の行は 1 対 1、
  `schedule` の行と app/vercel.json の crons は (口, cron 式) で 1 対 1 で、
  片方だけ足すと `npm run verify` の J1 / J2 が落ちる。
- `schedule` と `not_scheduled_reason` の**どちらも無い行は書けない** —
  「いつ起きるか誰も知らない」が黙って通るのを防ぐため。
- 本文の手書き散文は**標識**2 種だけ(各 1〜3 行): 否定(検討して捨てた代替案)と線引き。
- 書き方の正: docs/rules/process/backend/specification/standards/job-spec-writing.md
-->

# ジョブカタログ — このシステムが人手なしで動かすものの全数

{手書き散文は標識 2 種・各 1〜3 行のみ。}

<!-- AUTO-GENERATED:job-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:job-body -->
