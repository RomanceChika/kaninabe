---
doc_type: external_spec
scope: backend
id: external-catalog

vocabulary:
  service:                                  # 相手の名前(アプリの事情。検査器は分岐しない)
    - id: payments
      label: 決済サービス
      adapter_root: app/src/infrastructure/payments

integrations:
  - id: payment_notice_webhook
    service: payments
    direction: inbound
    effect: write
    port: PaymentNoticeReceiver
    adapter: app/src/infrastructure/payments/receive-notice.ts
    config: [PAYMENTS_WEBHOOK_SECRET]
    degrade: refuse                         # 鍵が無い環境では受信口を閉じる(401)
    retry: none
    idempotency: 決済サービスの外部イベントIDを payment_notices.external_event_id の一意制約に載せる(再送は 200 で読み捨てる)
    idempotency_source: local_ledger        # 重複はこちらの表(event_id_table)が潰す
    signature: hmac_sha256                  # 共有秘密で本文の HMAC を検証する
    signature_key: PAYMENTS_WEBHOOK_SECRET  # 鍵は位置ではなく名前で指す
    event_id_table: table-payment_notices   # 冪等の実体(単一列の一意索引を持つ表)
    emits: sales_order.pay                  # 外部イベント → ドメインイベント(by に system)
    migration: 20260912000002_inbound_payment_notice_webhook.sql  # 記録と遷移を 1 tx で起こす RPC
    on_conflict: retry                      # 入金待ちでなければ 5xx(先に別の通知を処理中かもしれない)
    sends:
      text: 受信のみ。こちらから外へ出す情報は無い(応答は受け取ったかどうかだけ)
    summary: 決済サービスからの入金通知を受け取り、照合した注文を入金済みへ遷移させる

test_cases: []
---

# 外部連携カタログ — 外の誰と何をやり取りするか

- **この仕組みの外部連携は受信 1 本だけである。** 決済の実行そのもの(与信・請求)は決済
  サービスの画面で行い、こちらは結果の通知を受け取る側に徹する。送信(`outbound`)の行は無い。
- **署名の鍵が無ければ口は開かない**(`degrade: refuse`)。「鍵が未設定なら素通し」は事故の
  形として最悪なので、既定を閉じる側に倒す。
- **本文の形はここに書かない。** 決済サービスの JSON の形はアダプタ(`PaymentNoticeReceiver`)
  が知っている唯一の事実であり、カタログが宣言するのは「どの鍵で検証し・どの表で冪等にし・
  どのドメインイベントが起きるか」だけである。
- **記録と遷移は 1 トランザクションで起こす**(生成された `api.inbound_payment_notice_webhook`)。
  記録だけが残って遷移が落ちると、相手が再送しても「もう反映した」と読まれて入金が消える。
- **入金待ちでない注文への通知は 5xx で返す**(`on_conflict: retry`)。取消と入金が行き違った
  ときは、こちらが先に取消を処理しているだけのこともあるので、相手の再送に賭ける。

<!-- AUTO-GENERATED:external-body -->
<!-- /AUTO-GENERATED:external-body -->
