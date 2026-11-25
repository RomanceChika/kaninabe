---
doc_type: config_spec
scope: backend
id: config-catalog

vocabulary:
  kind:
    - id: secret
      label: 漏れたら作り直しが要る秘密
      confidential: true
  requirement:
    - id: required
      label: 無いとアプリが動かない
      default_targets: [local, production]   # targets を書かない行が引く既定
  provision:
    - id: prompt
      label: 人が値を貼る(端末で 1 回。既定)
  used_by:
    - id: payments_webhook
      label: 決済サービスの入金通知の受信口 — 署名の検証
  target:                             # 置き場(値がどこに要るか)。語ごとに「名前を列挙する手」を宣言する
    - id: local
      label: 開発機の .env.local
      probe: { kind: dotenv, path: app/.env.local }
    - id: production
      label: 本番の環境変数
      probe: { kind: command, argv: [vercel, env, ls, production], cwd: app }

logging:                              # ログの目録と別の系への転送先(ASVS V16.1.1 / V16.4.3)
  format: json_lines
  sink:
    mode: host_drain
    label: ログドレイン(本番のログをホストの外のログ収集サービスへ転送する)
    off_host: true
    required_in: [production]
    configured_in: 配置先のダッシュボードまたは CLI(設定の値は書かない。本番の設定は検査から見えない)
  dead_letter_alert:
    mode: host_drain
    label: ログドレインの先の知らせ(error の行に掛ける)
    off_host: true
    required_in: [production]
    configured_in: ログ収集サービスの管理画面(設定の値は書かない。本番の設定は検査から見えない)
  retention:
    days: 90
    reason: サンプルの暫定値
  readers:
    - 運用担当

variables:
  - id: PAYMENTS_WEBHOOK_SECRET
    kind: secret
    requirement: required
    used_by: [payments_webhook]
    summary: 決済サービスの入金通知の署名を検証する共有秘密
    rotation:
      every: 365 day
      reason: 仮置き・運用で決める(見本の値)
      procedure: 決済サービスの管理画面で鍵を作り直し、環境変数を新しい値にして出し直す
      holders: [運用担当]
    strength:
      min_length: 32
    absence: 受信口が閉じる(署名を検証できないので 401 で断る。状態は動かない)
---

# 設定カタログ — 動かすのに要る設定の全数

- 外部連携(`external.md`)の各連携が挙げる設定は、ここに載っているものだけである(X2 が接地を見る)。

<!-- AUTO-GENERATED:config-body -->
<!-- /AUTO-GENERATED:config-body -->
