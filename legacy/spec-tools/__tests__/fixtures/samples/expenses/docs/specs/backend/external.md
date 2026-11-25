---
doc_type: external_spec
scope: backend
id: external-catalog

vocabulary:
  service:
    - id: bank
      label: 取引銀行の送金 API
      adapter_root: app/src/infrastructure/bank
      # 送金 API の SDK(値で import できるのは adapter_root の下だけ。X1 の (d) と ESLint の層の境界が同じ表を見る)
      sdk_packages: ["@bank-api/*"]

integrations:
  - id: bank_transfer
    service: bank
    direction: outbound
    effect: write
    port: TransferPort
    adapter: app/src/infrastructure/bank/transfer.ts
    config: [BANK_TRANSFER_ENDPOINT, BANK_TRANSFER_TOKEN]
    degrade: refuse
    degrade_summary: 資格情報が無いときは送金せずに断る(申請の状態は動かさない)
    timeout_ms: 10000
    retry: job
    idempotency: 申請 id を送金リクエストの冪等キーにする(同じ申請は 2 度振り込まない)
    idempotency_source: external_key
    sends:
      fields: [claim.total_amount, employee.display_name]
      text: 振込金額と受取人の表示名だけを渡す(明細の中身は送らない)
      neutralize: [control_chars]
    summary: 承認済みの経費申請の金額を申請者の口座へ振り込む

test_cases: []
---

# 外部連携カタログ — 外の誰と何をやり取りするか

- 受取口座の番号は仕様に載せない — 値は銀行側の台帳が持ち、この系は識別子だけを渡す。
- 受信(`direction: inbound`)はこの題材に置かない — 振込の結果を相手から受け取る実物がまだ無い(受信の実例は別の題材が持つ)。

<!-- AUTO-GENERATED:external-body -->
<!-- /AUTO-GENERATED:external-body -->
