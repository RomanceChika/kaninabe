---
doc_type: config_spec
scope: backend
id: config-catalog                # 固定。1 プロジェクト 1 カタログなので導出元が無い

vocabulary:                       # 必須。**語彙はこのアプリの事情**であり、体系(パーサ・検査器)は軸だけを持つ
  kind:                           # 値の性質(取り扱いの重さがここで決まる)
    - id: secret
      label: 漏れたら作り直しが要る秘密
      confidential: true                # この種類の行は rotation(寿命・更新の手順・持つ者)を必ず宣言する(K6。ASVS V11.1.1)
  requirement:                    # 無いと困る度合い
    - id: required
      label: 無いとアプリが動かない
      default_targets: ["{vocabulary.target の語}"]   # targets を書かない行が引く既定(空リスト = どこにも入れない)
  used_by:                        # **何のために繋がっているか**。この軸が連携カタログを兼ねる
    - id: "{使う先}"
      label: "{外部サービス名} — {何のために}"
      # service_auth: true        # 共有秘密だけで口を開ける使い先(定期実行の口など)。この使い先の秘密の行は strength が必須(K6。ASVS V13.2.3)
  target:                         # **置き場**(値がどこに要るか)。probe は名前の列挙しか返せない形だけを書ける
    - id: "{置き場}"
      label: "{どこの・何が読むか}"
      probe: { kind: dotenv, path: "{dotenv 形式のファイル}" }
      # probe: { kind: command, argv: [gh, secret, list, --json, name], cwd: "{. か app}" }   # argv は許可表の形だけ(gh secret list / vercel env ls {環境} / supabase secrets list)。npx は書けない
      # read_by: { kind: workflow_secret, path: "{この置き場の名前を読んでいる場所}" }  # K3 が双方向に見る

logging:                          # 必須。ログの目録(V16.1.1)と別の系への転送先(V16.4.3)。何を出すかは仕組みの事象の目録が持つので書かない
  format: json_lines              # 1 行 1 JSON
  sink:                           # 省略できる(本番を宣言しない・転送先も書かない = 試験環境・趣味の用途。K5 は何も言わない)。導入はマストではない
    required_in: ["{vocabulary.target の語}"]   # 本番の置き場。書いたときだけ、転送先が無いと K5 が警告する(省略・空 = 本番を宣言しない)
    # --- 転送先(次のどちらか。どちらも無ければ K5 が警告) ---
    mode: app_direct              # app_direct = アプリから直接送る(鍵が設定されたときだけ送る = オプトイン)/ host_drain = 配置先のログドレイン
    label: "{転送先の呼び名}"
    off_host: true                # 転送先がアプリの動くホストの外にあること(false は K5 が止める)
    key_env: AXIOM_TOKEN          # app_direct だけ。鍵を読む環境変数(variables に行を持つ。値は書かない)。未設定なら送らず標準出力だけで動く
    configured_in: "{設定する場所(管理画面・CLI など)。設定の値は書かない}"   # 本番の設定は検査から見えない(K5 が毎回未検証と名指す)
    # exempt: "{本番でもログを別の系へ送らない理由}"   # 転送先の代わりに書くと外せる(上の mode〜configured_in は消す)。verify が毎回受け入れた危険として名指す
  dead_letter_alert:              # 省略できる。死んだジョブの知らせ先(形は sink と同じ)。省略すると sink の required_in を継いで宛先なし = K5 が警告する。エラーのログは宣言によらず必ず出る
    required_in: ["{vocabulary.target の語}"]
    mode: app_direct
    label: "{知らせ先の呼び名}"
    off_host: true
    key_env: "{鍵や URL を読む環境変数}"
    configured_in: "{設定する場所}"
    # exempt: "{本番でも知らせ先を持たない理由}"   # 宛先の代わりに書くと外せる。verify が毎回受け入れた危険として名指す
  retention:
    days: 30                      # Axiom の無料のプランの保持は 30 日。本番の前に 90 日(有料のプラン)へ決め直す
    reason: "{その日数にした理由}"
  readers:
    - "{読める人の呼び名}"

variables:                        # 設定の全数。実装の process.env 参照(K1)と雛形(K2)に双方向で閉じる
  - id: "{ENV_VAR_NAME}"          # 環境変数名そのもの(SCREAMING_SNAKE)
    kind: "{vocabulary.kind の語}"
    requirement: "{vocabulary.requirement の語}"
    used_by: ["{vocabulary.used_by の語}"]   # 1 つ以上
    # targets: ["{vocabulary.target の語}"]  # requirement の既定と違う行だけが書く(同じなら K0 が落とす)
    summary: "{何を制御するかを 1 行で}"
    absence: "{無いとどうなるか — 必須かどうかを言い換えでなく挙動で書く}"
    # rotation:                    # 種類が confidential: true の行は必須(K6。ASVS V11.1.1)。値は書かない
    #   every: 365 day             # "{正の整数} day" か "{正の整数} month"
    #   reason: "{周期の根拠。運営がまだ決めていない仮置きなら『仮置き・運用で決める』}"
    #   procedure: "{更新の手順、または手順の文書の場所}"
    #   holders: ["{持つ者・置き場の呼び名}"]
    # strength: { min_length: 32 } # サービスの認証の秘密は必須(K6。ASVS V13.2.3)。実装は readServiceSecret で読む
    # previous: "{旧い値の環境変数名}"   # 更新の間だけ旧い値も受ける(ASVS V11.2.2)。別の行として宣言する
    # not_in_template_reason: "{app/.env.example に雛形の行を置かない理由}"  # 置かない行だけが持つ
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換え、引用符は不要になったら外す。
- **ここに書かないもの**(書くと正が割れる):
    値そのもの(鍵・URL・トークン)          → 環境ごとの運用設定。仕様は「何が要るか」だけを持つ
    どのファイルが読んでいるか              → 実装が正(K1 が走査して双方向に突合する)
    設定を投入する手順                      → runbook(運用文書)
- 宣言は**閉世界**である。実装が読む環境変数とカタログの行は 1 対 1 で、片方だけ増えると K1 が
  落ちる。雛形(app/.env.example)との一致は K2 が見る(置かない行は理由を書いて免除する)。
- `absence` は必須である。「無いとどうなるか」を書けない設定は、**未設定のまま動いているのか
  止まっているのかが誰にも分からない**状態そのものである。
- **置き場(`targets`)は宣言と導出の両方向である。** 大半の行は `requirement` の語が配る
  `default_targets` から導出されるので書かない。既定と同じ値を書き写した行は K0 が落とす
  (既定を変えた日にどこが追随しないかが読めなくなるため)。
- 本文の手書き散文は**標識**2 種だけ(各 1〜3 行): 否定(検討して捨てた代替案)と線引き。
- 書き方の正: docs/rules/process/backend/specification/standards/config-spec-writing.md
-->

# 設定カタログ — このシステムを動かすのに要る設定の全数

{手書き散文は標識 2 種・各 1〜3 行のみ。}

<!-- AUTO-GENERATED:config-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:config-body -->
