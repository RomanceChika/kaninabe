---
doc_type: external_spec
scope: backend
id: external-catalog                 # 固定。1 プロジェクト 1 カタログなので導出元が無い

vocabulary:                          # 相手の名前の語彙(このアプリの事情。検査器は分岐しない)
  service:
    - id: "{service ID}"              # 例: discord / anthropic / notion / line
      label: "{表示名}"
      adapter_root: "app/src/infrastructure/{service}"   # この service のアダプタが住むディレクトリ(X1 の閉世界の単位)
      # sdk_packages: ["{SDK のパッケージ名}"]   # この service の SDK(包みの名前か `@scope/*`)。値で import できるのは adapter_root の下と client_ui だけ(X1 (d) と ESLint の層の境界)
      # client_ui:                               # SDK の UI 部品を値で引いてよい、自サイトの口とだけ話すクライアントの部品(任意)
      #   - file: "app/src/app/{...}/_components/{file}.tsx"
      #     packages: ["{sdk_packages に当たる包みの名前}"]

integrations:                        # 外部連携の全数
  - id: "{連携 ID}"                   # スネークケース・一意
    service: "{vocabulary.service の id}"
    direction: outbound              # outbound(こちらから呼ぶ) | inbound(向こうから届く)
    effect: read                     # read | write。write なら idempotency が必須
    port: "{業務側の IF 名}"          # 例: DeliveryPort。X1 がアダプタのファイル内に実在を見る
    adapter: "app/src/infrastructure/{service}/{file}.ts"   # X1 が実在を見る
    config: ["{config カタログの id}"]  # 1 つ以上。X2 が実在と requirement の食い違いを見る
    degrade: not_configured          # refuse | not_configured | fallback
    degrade_summary: "{鍵が無いときの挙動}"   # not_configured | fallback は必須
    timeout_ms: 5000                 # direction: outbound は必須(正の整数)
    retry: none                      # none | job | inline
    # retry_max: 3                    # retry: inline のときだけ必須(正の整数)
    # idempotency: "{冪等キーの作り方}" # effect: write のときだけ必須
    sends:                           # 外へ出す情報。実在するフィールドに接地できないものは text にだけ書く
      fields: ["{entity}.{field}"]    # entity_spec に実在するフィールドへの参照(X3 が見る)
      text: "{散文での補足。fields で言い切れない内容、または fields の代わり}"
      neutralize: [control_chars]     # 送る自由文を通す無害化の部品(discord_mentions / control_chars / length:N)。送る行(outbound)は必須(X7 がアダプタの呼び出しを見る)
      # neutralize_none: "{無害化する自由文を送らない理由}"   # neutralize の代わり。利用者が書ける文字列の欄を送る行には書けない
    # endpoints: ["/api/{...}"]       # この連携を使う手書きの口(Route Handler)の URL。direction: outbound の行だけが持てる(任意)。実装の木に口が要る(J2)
    # spend: paid                     # 呼び出しごとに費用のかかる連携(endpoints を持つ送信の行だけ)。書くなら abuse・meter・authz が要る(R5-7)
    # meter: "{枠を消費する RPC}"      # data_table の kind: rpc の関数。本文が authz の役を DB の行で確かめ、消費を 1 文で原子的に行う(X8)
    # authz: { kind: role, role: "{実行者の行の条件(claim)を持つグローバルロール}" }   # public は書けない(R5-7)
    # abuse:                          # 有料の口の濫用の歯止めの宣言(値は生成物 PAID_ENTRIES になり、口が共通の入口へ渡す)
    #   max_body_bytes: { "/api/{...}": 262144 }   # endpoints の全部に必須(口ごとの本文の上限。バイト)
    #   quota: { source: "{config の id}", per: 1 day, key: actor }   # source の代わりに max: n も書ける
    summary: "{何をする連携かを 1 行で}"
  # --- 受け取る側(direction: inbound)。下の軸は全部必須で、timeout_ms は書けない ---
  # - id: "{連携 ID}"
  #   service: "{vocabulary.service の id}"
  #   direction: inbound
  #   effect: write
  #   port: "{受信アダプタの IF 名}"    # 例: PaymentNoticeReceiver。配線は create{この名前}() を呼ぶ
  #   adapter: "app/src/infrastructure/{service}/{file}.ts"
  #   config: ["{署名の鍵の config id}"]
  #   degrade: refuse                 # signature が none でなければ refuse(鍵が無ければ口を閉じる)
  #   retry: none
  #   idempotency: "{外部イベント ID を event_id_table の一意制約に載せる}"
  #   signature: hmac_sha256          # hmac_sha256 | provider_sdk | none
  #   signature_key: "{config の id}"  # 鍵は位置ではなく名前で指す(none のときは書かない)
  #   # signature_reason: "{なぜ署名が要らないか}"   # signature: none のときだけ必須
  #   event_id_table: "table-{表}"     # 単一列の一意索引をちょうど 1 本持つ data_table(X5)
  #   emits: "{machine}.{event}"      # by に system を含み、from がちょうど 1 つでガードが無い遷移
  #   migration: "{14 桁}_inbound_{連携 ID}.sql"   # 記録と遷移を 1 tx で起こす RPC の生成先
  #   on_conflict: retry              # retry(5xx で再送させる) | ack(2xx で閉じる)。既定は無い
  #   # max_body_bytes: 65536         # 受け取る本文の上限(任意。省略は 65536。緩めるのは宣言だけ)
  #   sends:
  #     text: "受信のみ。外へ出す情報は無い"
  #   summary: "{何を受け取る口かを 1 行で}"

test_cases: []                       # 任意。書けば X4 が @tc と突合する(他カタログと同じ形)
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換え、引用符は不要になったら外す。
- **ここに書かないもの**(書くと正が割れる):
    アダプタの実装(SDK 呼び出し・認証・レスポンス変換)  → アダプタ本体(TypeScript)が正
    値そのもの(URL・トークン・キー)                    → config_spec の領分(値は書かない)
    相手の本文の形(JSON のキー・イベント ID の在りか)  → アダプタ(port の実装)が正
- **`direction: inbound`(受け取る側)は受け取る側の軸が全部必須**である(`signature` +
  `signature_key` / `event_id_table` / `emits` / `migration` / `on_conflict`)。揃って初めて
  受信口を生成できるので、部分的には書けない。行を 1 本足すと
  `app/src/app/api/inbound/{連携}/route.ts` と `app/src/composition/inbound/{連携}.ts` と
  `supabase/migrations/{migration}`(**記録と遷移を 1 トランザクションで起こす RPC**)が
  **生成される** —— 手で書くのは本文を読むアダプタだけである
  (external-spec-writing.md §受け取る側の軸)。
- **`emits` に `action_spec` は要らない。** `by` が system だけのイベントは Server Action の
  入口を持たないためである(actions/README.md)。
- `timeout_ms` は `direction: outbound` の行に必須(X0)。**実装にタイムアウトが無いアダプタは
  実装へ足す**(宣言と実装の食い違いを作らない)。
- `degrade: not_configured | fallback` の行は `degrade_summary` と `config`(1 つ以上)が必須。
  `refuse` は `config`(1 つ以上)が必須(X0)。挙げた `config` の `requirement` は degrade と
  食い違ってはならない(X2。`refuse` なら `required`、`not_configured` / `fallback` なら
  `optional_degrades` か `production_only`)。
- `endpoints` は、ブラウザから叩かれてサーバーの側でこの連携を呼ぶ**手書きの口**(AI の応答の
  逐次配信など)の URL を並べる(`direction: outbound` の行だけ・任意)。**実装の木の HTTP の入口は、
  ジョブの endpoint・受信口・認証の callback・ここの endpoints のどれかに宣言されていなければ
  ならない**(J2 の閉世界)ので、手書きの口から連携を使うなら書く。受信口は生成物で URL が
  `/api/inbound/{連携 ID}` に決まっているので、`direction: inbound` の行は持てない。
- `spend: paid` は、ブラウザから叩かれる口(`endpoints`)が費用のかかる連携を呼ぶときに書く。書いたら
  `abuse`(口ごとの `max_body_bytes` と回数の枠 `quota`)・`meter`(枠を消費する RPC)・`authz`(口を使える役)が要る(R5-7)。
  値は生成物(`PAID_ENTRIES`)になり、**口は共通の入口 `runPaidEntry`(`@kaninabe/runtime/http/paid-entry`)で包んでそこから読む**。
  本文を読む前に上限で落とし・課金の前に枠を消費することは入口が持ち、口が入口を使っていること・有料の処理が
  `handler` の中だけにあること・`meter` の RPC が役を DB の行で確かめて原子的に消費することは X8 が見る。受信の行・
  `endpoints` の無い行には書けない(R5-8)。
- `effect: write` の行は `idempotency` が必須(X0)。
- 送る行(`direction: outbound`)は `sends.neutralize`(部品の宣言)か `sends.neutralize_none`(理由)を必ず書く。宣言した部品をアダプタが `@kaninabe/runtime/neutralize` から呼ぶ(X7)。
- `sends.fields` は `{entity}.{field}` の形で entity_spec に実在するフィールドを指す(X3)。
  生成した文面・要約など実在するフィールドに接地できない情報は `sends.text` に書く。
- `vocabulary.service` の `adapter_root` 配下のディレクトリ(`app/src/infrastructure/` 直下)は、
  集約名(entity_spec の entity / state machine 名)・`supabase`・`jobs`・語彙の `adapter_root`
  のいずれかに分類できなければならない(X1)。アダプタを増やしたら、まずここに `service` を足す。
- 書き方の正: docs/rules/process/backend/specification/standards/external-spec-writing.md
-->

# 外部連携カタログ — 外の誰と何をやり取りするか

{手書き散文は標識(否定・線引き)のみ。}

<!-- AUTO-GENERATED:external-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言の展開を差し込む）
<!-- /AUTO-GENERATED:external-body -->
