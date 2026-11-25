---
doc_type: auth_spec
scope: backend
id: auth-flow                     # 固定。1 プロジェクト 1 フローなので導出元が無い

subject: "{状態機械の名前}"        # 分岐の主語。この状態機械の**全状態**が尽くされていること(H1)

providers: ["{サインインの方式}"]  # 受け入れる方式の全数(語はプラットフォームの設定の綴り。例: [email])。
                                  # 宣言に無い方式がプラットフォームの設定で開いていると H5 が止める
# local_only:                     # (任意)ローカル(開発・テスト)の設定でだけ開けてよい方式。本番では開けない。理由が必須
#   - method: "{方式}"
#     reason: "{なぜローカルでだけ開けるのか}"

sessions:                         # セッションの寿命(必須)。プラットフォームの設定と同じ値か H5 が見る
  inactivity: "{無操作の時間切れ。例: 8h}"   # 最後にセッションを更新したときから。absolute より短く
  absolute: "{絶対の寿命。例: 24h}"           # サインインしたときから。更新トークンもここで使えなくなる
  reason: "{なぜこの長さで足りるのか}"       # 空不可
  concurrent:                      # 同時に持てるセッションの数(必須)
    unbounded: "{上限を置かない理由}"          # 上限を置かないとき
    # max: 1                                   # 置くとき: 1 人が同時に持てる数(1 以上の整数)と、上限に達したときの挙動(ends_oldest か refuses_new)と理由
    # on_limit: ends_oldest
    # reason: "{なぜこの数か}"

idp_session:                       # IdP とアプリのセッションの関係(必須)。書けるのは仕組みが支えられる主張だけ(H0)
  logout: keeps_idp                # アプリのログアウトが IdP のセッションにすること
  idp_ends: app_continues          # IdP のセッションが終わったとき / アカウントが失効したときのアプリのセッション
  lifetime: independent            # アプリのセッションの寿命の決め方(寿命は sessions)
  reason: "{この関係でよい理由}"   # 空不可

mfa:                              # 多要素認証(必須)。外部の IdP でログインする製品の既定は「IdP に任せる」(下)
  delegated:                      # IdP に任せる(アプリ側で 2 つ目の要素は求めない)。verify が毎回「受け入れた危険」の警告で名指す
    provider: "{providers に書いた外部の IdP}"   # 本番の方式(providers)はこの IdP 1 つだけに限る(ほかの方式が並ぶと H6 が止める)
    evidence: none                # 根拠なしで任せる(いまはこれだけ。組織のドメインに限る・IdP の amr を根拠にする形は未対応)
    reason: "{なぜ IdP の認証で足りるのか}"   # 空不可
# mfa:                            # 厳しくしたい製品のオプトイン: アプリ側で 2 つ目の要素(aal2)を要求する(上の delegated と差し替える)
#   # require: { roles: ["{roles.md のロール ID}"] }   # 任意。書かなければサインインした全員
#   to: "{多要素認証を済ませていない人を送る画面の screen_spec の id}"   # requires_auth: true の画面
#   implementation: "{パス}::{関数名}"                                   # 入場のたびに確かめる関数
#   summary: "{どういう要求かを 1 行で}"
# mfa:                            # 外すとき(メール等で IdP が無いとき。理由が必須。verify が毎回「受け入れた危険」の警告で名指す)
#   exempt: "{なぜ 1 つの要素のログインで足りるのか}"

landings:                         # 着地 = サインインの結末。id は実装が返す着地先の語と同じ
  - id: "{着地 ID}"
    screen: "{screen_spec の id}"  # 引数の要らない route であること(H2)
    # variant: "{画面の variants のキー}"   # 画面が排他表示を持つときは必須
    summary: "{どういう結末かを 1 行で}"

axes:                             # 決定表の軸。体系が要るのは「主語の軸がちょうど 1 本」だけで、名前・値・表示名はこの仕様が正(H0 / H1)
  - id: "{主語の軸 ID}"            # 名前はこのシステムの語
    kind: field                   # state(状態機械の状態) | field(entity_spec の enum の欄)。主語はちょうど 1 本
    of: "{エンティティ}.{欄}"       # state なら状態機械名。上の subject と一致すること
    absent: none                  # 主語の行が無いことを表す値
    summary: "{何を表す軸かを 1 行で}"
    labels:                       # 任意。値 -> 表示名(values / 値域に無い鍵は error)
      none: "{行が無い}"
      "{値}": "{表示名}"
  # - id: "{補助の軸 ID}"
  #   kind: enum
  #   summary: "{何を表す軸かを 1 行で}"
  #   when: { "{主語の軸 ID}": none }   # その条件の行だけが持つ。optional: true と同時には書けない(optional は行ごとに任意)
  #   values: [{値 1}, {値 2}]

sign_in:                          # 決定表。順に読むものではない(条件で結末が一意に決まる)
  - id: "{分岐 ID}"
    "{主語の軸 ID}": "{その軸の値 / none}"   # 主語の軸は全行で必須
    # "{補助の軸 ID}": "{その軸の値}"        # when / optional の軸は、持つ行だけ書く
    # runs: ["{ドメインイベント ID}"]        # この行で実行される操作(by: system であること)
    lands: "{landings の id}"
    summary: "{何が起きるかを 1 行で}"

gates:                            # 画面に入るときの関門(サインイン済みの人に対する資格の確認)
  - id: "{関門 ID}"
    guards: requires_auth         # requires_auth | role_gate
    # role: "{roles.md のロール ID}"  # guards: role_gate のときだけ必須(例: role: librarian)
    on_fail: redirect             # redirect(to が必須) | not_found(to を書かない)
    to: "{送り先の screen_spec の id}"
    implementation: "{パス}::{関数名}"
    summary: "{どういう関門かを 1 行で}"

# callback:                       # OAuth の帰り道の口(任意。OAuth でないサインインの仕組みは書かない)
#   endpoint: "/api/{...}"         # URL のパス(ジョブの endpoint と同じ形)。実装の木に Route Handler が要る(J2)
#   summary: "{どういう口かを 1 行で}"

# start:                          # サインインの開始の口(POST。callback を書いたら必須 —— セッションの cookie はスクリプトから読めないので OAuth はサーバーが始める)
#   endpoint: "/api/{...}"
#   summary: "{どういう口かを 1 行で}"

# logout:                         # ログアウトの口(POST。callback を書いたら必須。この端末のセッションを閉じ、認証の cookie を消し、Clear-Site-Data を返す)
#   endpoint: "/api/{...}"
#   control: signed_out            # ログアウトの操作の名前(共有クロームの navigations の on)。書いたら requires_auth の全画面がその遷移を持つクロームを被る(H8)
#   summary: "{どういう口かを 1 行で}"

# platform_ops:                   # 認証基盤が持つ操作(セッションの一覧・終了など)を画面から叩く閉じた一覧(任意。画面は platform_ops: で参照する。H9 / S20 / S21)
#   - id: "{グループ}.{名前}"       # 例: session.end_mine
#     label: "{表示名}"
#     kind: do                     # read | do
#     actor: { self: true }        # 本人 | { role: {ロール ID}, active_member: true }
#     args: { "{引数名}": { from: row, of: "{読みの操作 id か query_spec の id}", field: "{欄}", skip_if: "{行の真偽値の欄(任意)}", format: uuid } }   # 識別子は行の欄だけ。型つき入力は { type: bool | int }
#     confirm: false               # do だけ・必須
#     binding:
#       port: "{ポートの型名}"       # platform_ports のキー
#       method: "{メソッド名}"
#       params: [{ name: "{配線先の引数名}", arg: "{宣言した引数}", type: string }]   # 位置の順。オブジェクトの引数は { name, optional?, props: { "{プロパティ}": { arg, type, optional? } } }
#       result: boolean            # 結果の union の value の型(string | boolean | number)。read は { rows: "{行の型名}" }
#   # read は returns: "{shapes のキー}"(confirm は書かない)。shapes を書くなら secret_field_words も要る
# platform_ports:                  # 配線先のポートの宣言(配線の実際の形と H9 が構文木で突き合わせる)
#   "{ポートの型名}":
#     result: { type: "{結果の union の型名}", ok: ok, value: value, reason: reason }
#     refusals: { "{理由}": "{画面に出す文言}" }   # 閉じた集合。配線先が返す理由と過不足なく一致する
#     rows: { "{行の型名}": { "{プロパティ}": string } }   # string | boolean | number。null がありうるなら 'string?'
# shapes:
#   "{名前}":
#     row: "{行の型名}"
#     fields: { "{欄}": "{行のプロパティ}" }   # 欄ごとにちょうど 1 つ
#     labels: { "{欄}": "{表の見出し}" }      # 任意
#     formats: { "{欄}": datetime }          # 任意
# secret_field_words: ["{欄名・対応先に含めてはいけない語(小文字)}"]

test_cases:
  - id: "TC-AUTH-{SUBJECT}-001"
    type: unit
    covers: [success]
    spec_ids: ["auth-flow"]
    implementation: "{テストファイル}::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換え、引用符は不要になったら外す。
- **ここに書かないもの**(書くと正が割れる):
    画面の中身(何が表示されるか)          → screen_spec の variants(H2 が双方向に突合する)
    着地先の URL                            → screen_spec の route(生成物がそこから引く)
    操作の可否                              → state_spec の from / guard(認証層は「実行する」だけ)
    OAuth の作法・cookie の寿命・文言        → 実装と認証プロバイダの自由
    環境変数                                → config_spec(未設定時の縮退は absence の領分)
- `callback` は OAuth の帰り道の口(任意)。**実装の木の HTTP の入口は、ジョブの endpoint・受信口・この callback・外部連携の endpoints のどれかに宣言されていなければ
  ならない**(J2 の閉世界)ので、OAuth を使うなら書く。
- 決定表なので、**同じ条件の組を持つ行を 2 つ書けない**(H0 が落とす)。
- 主語の状態を 1 つ足したら、その人の着地を宣言しないと verify が通らない(H1)。
  これが「暗黙のその他」を作らせないための検査である。
- 書き方の正: docs/rules/process/backend/specification/standards/auth-spec-writing.md
-->

# 認証フロー — サインインすると何が起きるか

{手書き散文は標識(否定・線引き)のみ。}

<!-- AUTO-GENERATED:auth-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言の展開を差し込む）
<!-- /AUTO-GENERATED:auth-body -->
