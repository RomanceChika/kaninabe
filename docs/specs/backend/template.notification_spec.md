---
doc_type: notification_spec
scope: backend
id: notification-catalog          # 固定。1 プロジェクト 1 カタログなので導出元が無い

vocabulary:                       # 必須。**語彙はこのアプリの事情**であり、体系(パーサ・検査器)は軸だけを持つ
  medium:                         # 送信経路
    - id: "{経路}"
      label: "{表示名}"           # 任意
  audience:                       # 宛先(誰に届くか)
    - id: "{宛先}"
      label: "{表示名}"
  mention:                        # メンション(どこまで人を叩き起こすか)
    - id: none
      label: 付けない

notifications:                    # 通知の全数。effects の notify_* と双方向に閉じる(N1)
  - id: "notify_{何を知らせるか}"  # 接頭辞 notify_ は「effects のどれが通知か」の唯一の手がかり
    medium: "{vocabulary.medium の語}"
    audience: "{vocabulary.audience の語}"
    mention: "{vocabulary.mention の語}"
    trigger: auto                 # auto(effects から自動)| manual(下書きを人が送る)
    summary: "{何を知らせるかを 1 行で}"

test_cases:                       # 必須。1 つ以上。実装側の突合テストの宣言
  - id: "TC-NOTIFICATION-CATALOG-001"
    type: unit
    covers: [success]
    spec_ids: [notification-catalog]
    implementation: "app/src/operation/__tests__/jobs/notification-catalog.test.ts::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換え、引用符は不要になったら外す。
- **ここに書かないもの**(書くと正が割れる):
    Webhook の URL・メンションの文字列・文面      → 運用設定(env)と文面テンプレート
    どの遷移で飛ぶか                              → state_spec の effects(N1 が双方向に突合する)
    宛先の利用者が停止されていたら送らない等の規則  → invariant_spec(INV-LOAN-002 など)
- 宣言は**閉世界**である。`effects` の notify_* とカタログの `trigger: auto` の行は 1 対 1 で、
  片方だけ足すと N1 が落ちる。実装のハンドラ一覧との突合は app 側のユニットテストが持つ。
- 本文の手書き散文は**標識**2 種だけ(各 1〜3 行): 否定(検討して捨てた代替案)と線引き。
- 書き方の正: docs/rules/process/backend/specification/standards/notification-spec-writing.md
-->

# 通知カタログ — このシステムが送る通知の全数

{手書き散文は標識 2 種・各 1〜3 行のみ。}

<!-- AUTO-GENERATED:notification-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:notification-body -->
