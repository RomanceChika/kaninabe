---
doc_type: config_spec
scope: backend
id: config-catalog

vocabulary:
  kind:
    - id: endpoint
      label: 接続先の URL
    - id: secret
      label: 漏れたら作り直しが要る秘密
  requirement:
    - id: required
      label: 無いとアプリが動かない
      default_targets: [local, production]   # targets を書かない行が引く既定
  provision:
    - id: prompt
      label: 人が値を貼る(端末で 1 回。既定)
  used_by:
    - id: bank_transfer
      label: 銀行の送金 API — 承認済みの申請の振込
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
  - id: BANK_TRANSFER_ENDPOINT
    kind: endpoint
    requirement: required
    used_by: [bank_transfer]
    summary: 銀行の送金 API のエンドポイント
    absence: 支払いの操作が資格情報エラーで断られる(状態は動かない)
  - id: BANK_TRANSFER_TOKEN
    kind: secret
    requirement: required
    used_by: [bank_transfer]
    summary: 銀行の送金 API に提示するアクセストークン
    absence: 支払いの操作が資格情報エラーで断られる(状態は動かない)
---

# 設定カタログ — 動かすのに要る設定の全数

- 振込手数料の負担区分は設定に置かない — 交渉できる値は業務のルールであり、置くならドメインの側である。

<!-- AUTO-GENERATED:config-body -->
<!-- /AUTO-GENERATED:config-body -->
