---
doc_type: data_table
scope: backend
id: "table-{テーブル名}"             # 例: table-entries。ファイル名は tables/{table}.md 固定

table: "{テーブル名}"                # 必須。物理テーブル名(スネークケース・複数形)
entity: "{エンティティ名}"           # entity_spec の entity(単数形)。内部テーブルなら書かず internal: true にする
# internal: true                     # ドメイン仕様に現れない台帳(jobs / domain_events)だけ true。entity と排他

policies_migration: "{14 桁}_policies_{テーブル名}.sql"  # access_spec を持つ表は必須(読み取りポリシーの
                                     # 本文の生成先。名前は表名から導く)。internal: true の表は宣言できない
ddl_migration: "{14 桁}_ddl_{テーブル名}.sql"            # entity を持つ表(と framework: を宣言する表)は必須。
                                     # 列・型・NOT NULL・主キー・導出 CHECK・索引・外部キー・RLS・comment on の生成先
surface_migration: "{14 桁}_{公開スキーマ}_view_{テーブル名}.sql"  # entity_spec と access_spec の両方を持つ表は必須。
                                     # SQL の公開面 `surface`(外に出すスキーマのビュー)の生成先。公開スキーマ名は後段の設定
                                     # (exposedSchema)から導く。列と並びの正は entity_spec、
                                     # 隠し列の正は access_spec の fields_hidden。**SQL が変わる変更では名前を新しくする**

# 内部テーブルが写しの表(entity_spec の mirror: true)に添える表のときだけ書く。添え表の行の削除は写しの行の削除と同じに数える(T22 / 操作の属性)
# mirror_of: "{写しの表}"

# 参照を辿って本人に届く個人列を、消去の連鎖に入れないときだけ書く(T24。段の数は問わない。この表の参照の列・個人列・理由を名指す。表の単位では受け入れない)
# erasure_accept:
#   - via: "{本人への参照の列}"(本人の行がこの表を指す参照なら "{本人の表}.{列}")
#     columns: ["{個人列}"]
#     reason: "{連鎖に入れない理由}"

# 本人の行がこの表を指す参照があり、個人列の持ち主が宛先(本人)のときだけ書く(T24。分類の無い個人列は赤)。本文でその行を消す。
# erasure_addressee:
#   - column: "{個人列}"
#     via: "{本人の表}.{参照の列}"
#     reason: "{持ち主が宛先である理由}"

# 構造の突合の照らしが赤にする形を、この表で受け入れるときだけ書く(理由と、理由を示す試験の ID。試験はこの表の test_cases で spec_ids に
# その不変条件の ID を持つもの)。突合は生成物 dataTableParityAccepts を読む。要らなくなった受け入れ・登録簿に無い試験の ID は赤(点検 26 回目 A26-1)
# parity_accepts:
#   - check: invariant_edge          # 不変条件の書き込みの端のうち、どの DB の執行点も発火しないもの(data-table-parity)
#     invariant: "{INV-...}"
#     edge: "{update of 列 | insert | update | unreadable ...}"
#     reason: "{執行点が要らない理由}"
#     test: "TC-TABLE-{TABLE}-{連番}"
#   - check: trigger_advisory        # トリガの本文が advisory lock を取る(trigger-advisory-parity) | isolation_gate(生成物でないトリガ関数が隔離の門を持たない)
#                                    # 未ログインの作成の天井(creates[].abuse から生成する check_{entity}_rate_limit)の鍵は書かない —— 生成器が
#                                    # abuse と天井を名指す不変条件・その不変条件を spec_ids に持つ試験から導く(書くと R5-4 が止める)
#     function: "{トリガ関数名}"
#     invariant: "{この表の集約の INV-...}"
#     reason: "{受け入れる理由}"
#     test: "TC-TABLE-{TABLE}-{連番}"

# 内部テーブル(internal: true)の個人列。本人へ届く外部キーを持つ表は必須で、持たないなら [] と書く(T24)。
# personal_columns: ["{個人列}"]

indexes:                             # 任意。主キーの裏のインデックス以外の全数(突合は双方向)
  - name: "{インデックスの実名}"
    on: ["{列}"]                     # キー列(宣言順)
    unique: false                    # 一意インデックスなら true
    where: "{部分インデックスの述語}" # 任意。突合は「部分インデックスであること」まで
    invariant: "{INV-...}"           # 任意。由来する不変条件 ID(定義の正は invariant_spec。uniqueness は on / unique / where の一致を T23 が見る)
    # global_key:                    # 任意。invariant の無い unique の索引の鍵が全体で一意であることの受け入れ(V26)
    #   keys: ["{列}"]               # 受け入れる鍵の列(今の on と同じ集合。違えば腐った受け入れとして error)
    #   reason: "{なぜ全体で一意か}"

exclusions:                          # 任意。全数(排他制約。突合は名前の集合が双方向 + T5 が中身)
  - name: "{排他制約の実名}"
    keys: ["{列}"]                   # 一致していなければ重なってよい鍵(例: room_id)
    range: ["{開始列}", "{終了列}"]   # 期間の 2 列。端は半開区間 [開始, 終了) に固定
    where: "{部分制約の述語}"          # 任意。例: state <> 'cancelled'(T5 が不変条件の where と同じ条件であることを見る)
    invariant: "{INV-...}"           # 必須。formal.type: exclusion の不変条件を指す

foreign_keys:                        # 任意。全数(突合は双方向。同一性は 列 + 参照先 + on_delete)
  - column: "{列}"
    references: "{参照先テーブル}"    # public 以外は auth.users のようにスキーマ修飾
    on_delete: no_action             # cascade | no_action | restrict | set_null | set_default
    # refuse_erased: { column: state, values: [erased], word: "{拒否の語}", message: "{画面の文言}" }   # 任意。消去の対象(個人列を持つ集約)を指す外部キーだけ。
                                     #   message は必須: 拒否の語は ActionError の reason として画面まで運ばれ、画面はこの文言を出す(wording.ts の refusalWordText)
                                     #   この列を引数で書く定型 RPC は紐づけ先の行を共有で先に掴み、印の列が values なら
                                     #   UC412・detail = word で断る(生成物)。関所の無い書き込みは erased-link-parity が赤(T27・点検 19 回目 A19-4)
                                     #   freezes_personal: { word: "{凍結の拒否の語}", message: "{画面の文言}" } は自表が個人列を持つなら必須(T27・点検 20 回目 A20-1)。
                                     #   消去済みを指したままの行の個人列を、値が変わる書き込みなら UC412・detail = 凍結の語で断る(生成物。紐づけを外した行は凍らない)

triggers:                            # 任意。全数(突合は名前・関数・deferred・fires。列の名指しは見ない)
  - name: "{トリガの実名}"
    function: "{関数名}"             # 同じファイルの functions に kind: trigger で帰属させる
    # 発火の細部。いつ(before / after)・何で(insert / update / delete / truncate)・
    # 何ごとに(行 / 文)を pg_trigger.tgtype と両方向で突き合わせる
    fires: "{before insert or update of ...}"
    invariant: "{INV-...}"           # 任意
    # supplies: ["{列}"]             # 任意。このトリガが値を決める列(entity_spec の supplied_by: db。V17 / T9)
    # freezes: ["{列}"]              # 任意。作成の後に変えない列を DB が凍らせる(fires は "after update" だけ = 列を絞らない AFTER の行トリガ。
                                     #   本文は生成物で、OLD と NEW を is distinct from で比べ違えば check_violation で断る。その列を writes / transition_writes /
                                     #   遷移の records_* / clears で書く宣言・外部キーの on_delete: set_null / set_default・個人列・更新で発火する供給 / 導出の先
                                     #   (見ている元の列が全部凍っていれば可)・insert_at の番号・作成でない操作の computes の列なら T17 が止める。
                                     #   凍らせた列の update of の端は不変条件の端の覆いに数える。supplies / derives と併記しない。点検 fix26 2 回目)
    # derives:                       # 任意。supplies の列を「同じ行の日時列 ± 定数の幅」で決めるなら書く。本文は生成物になる
    #   "{列}":                      #   (functions の handwritten は併記できない。fires に表名を書かない。T15 が見る)
    #     from: "{自表の日時列}"      #   元の列(entity_spec で datetime の欄。自分自身は不可)
    #     offset: "{-14 days}"       #   {±n} {minute|hour|day}(数は整数。符号の省略は加算)
    #     mode: initial              #   initial = 挿入時に空のときだけ / follow = fires のたびに引き直す(fires に update of {from} が要る)
    #   "{列}":                      #   親の下の末尾の番号なら(蔵書の下の予約順など。画面に「次の番号」を導かせない)
    #     append_within: "{親を指す列}" #   foreign_keys の列。locks にその親を update で書く(必須)。from / offset と混ぜない
    #     mode: initial              #   initial = 空のときだけ末尾 / insert_at = 入れてきた値を位置と読み後ろをずらして差し込む(空なら末尾。作成の input に任意で載せてよい)。並べ替えは writes の口が持つ。列の entity_spec に max が要る(上端を越えた作成は append_full で断られる)。indexes に ({親を指す列}, {列}) の一意の索引が要る
    # locks: { "{親の表}": update }   # 任意。トリガが、発火させた行が直の外部キーで指す親の行を掴む強さ(share | update)。
                                     #   書き込む定型 RPC はその行をこの強さで先に掴む(共有で先に掴んでトリガが排他で掴み直すと、
                                     #   2 本が互いを待つ = 格上げ。T27・lock-order-parity。点検 19 回目 A19-1)
    # copies_from:                   # 任意。供給する列の写し元(個人列を供給するなら必須 = T27)。予約を作る RPC などは写し元の行を
    #   - column: "{供給する列}"      #   共有で先に掴む(写しの作成と写し元の消去を 1 本ずつに並べる。lock-order-parity。点検 19 回目 A19-3)
    #     from: "{表}.{列}"
    #     match: { "{写し元の列}": "{自表の列}" }
    # advisory: ["{鍵の接頭辞}"]      # 任意。本文が取る pg_advisory_xact_lock(hashtext('{接頭辞}' …)) の鍵。宣言の外の鍵は lock-order-parity が赤(O19-2)
    # remembers_owner: "{持ち主の列}"  # 任意。このトリガが行の元の持ち主と古い個人列の値を記録する(写しに残った古い値に消去が届くように)。
                                     #   個人列が写され、本人を直に指す持ち主の列が作った後に書ける表は必須で、fires は行の削除・持ち主の列・
                                     #   写される個人列の全部の更新で発火する(T28。点検 19 回目の後の性質テストの反例)

# 作成の冪等な再送で既存の行を返すか(shape: create の関数を持つ表・保存点の錨の表に必須)。
# 返すなら作成者の欄(作成の RPC が実行者で埋める列)を名指す。無い表は creator を書かない(監査ログの実行者で確かめる。点検 20 回目 B20-1)。
# 同じ鍵で入力が違う再送は resend_input_mismatch(UC412)。返さないなら returns_existing: false(押し直しが UC409 になる)
resend:
  returns_existing: true
  creator: "{作成者の欄}"

functions:                           # 任意。この表を持ち場とする public スキーマの関数。全ファイルの和集合が閉世界
  - name: "{関数名}"
    args: [uuid, text]               # 引数型の並び(pg_catalog の型名。無しは [])
    params: [p_id, p_title]          # kind: rpc では必須。引数名を args と同じ順で(^p_[a-z_]+$)
    kind: rpc                        # rpc(書き込み RPC。security definer + service_role 限定)| trigger | helper
    shape: transition                # kind: rpc では必須。create | update | delete | transition | composite
    # returns: rows                  # shape: composite では必須(rows = 帰属表の行の列 | scalar = 消した件数のような単一の値)。
                                     # 定型 4 形は常に行の列を返すので書けない。省略を rows とみなさない(署名の表の戻り値の形の出どころ)
    migration: "{14 桁}_rpc_{関数名}.sql"   # 定型 5 形(composite 以外)は本文が生成物。書き出す先を宣言する
    # handwritten: "{手で書く理由}"  # migration と排他。定型の形だが仕様から導けない手順が本文にあるとき
                                     # だけ(理由が空なら宣言として通らない)。shape: composite はどちらも書けない
    also_writes: { "{テーブル}": [insert] }   # 任意。主対象のほかに書き込む表と、その書き込みの種類(必須):
                                     # insert | update | delete | scrub(個人列を置き換えて消す。本文では update)。
                                     # 本文(migration)が実際に行う書き込みを書く(rpc-parity が本文と突き合わせる)。
                                     # 操作の属性は種類から導く: delete(mirror: true の写しの表を除く)か scrub があれば destructive。
                                     # shape: composite では必須(他の表に書かないなら also_writes: {})。外部キーの on delete
                                     # cascade / set null で暗黙に起きる書き込みも載せる(T21)。帰属表は書かない(self_writes へ)
    # scrub_via: { "{テーブル}": ["{本人へ届く参照の列}"] }   # 消去の RPC だけ。本人へ届く道のうち本文が消す道の全部(T24・erase-parity)
    # self_writes: [update]          # 帰属表への書き込みの種類。shape: composite では必須(書かないなら [])。
                                     # 定型 4 形は形が決める(本文が handwritten のときだけ書ける)。rpc-parity が本文と突き合わせる
    # event_writes:                  # 複数のイベントが通る RPC が破壊的な書き込み(写しでない表の delete・scrub)を持つときは必須(T22)。
    #   "{機械}.{イベント}": { "{テーブル}": [delete] }   # 全イベントについて、そのイベントの書き込み(also_writes の部分集合)
    #   "{機械}.{別のイベント}": {}                      # そのイベントで書かないなら {}
    # calls: ["{関数名}"]            # 本文が呼ぶ他の関数(呼ばれた側の書き込みが操作の属性に合流する)。宣言の無い呼び出しは rpc-parity が赤
    # dynamic_sql: "{理由}"          # 本文が動的 SQL(execute)を使うときだけ。宣言の無い execute は rpc-parity が「読めない」で赤
    lookup: ["{列}"]                 # 任意。この関数の本文が自表を絞り込み・並べる列(等値で絞る列 → 範囲・並びの列)。
                                     # 例: 直近の件数を数えるトリガ関数なら [sender_email, created_at]。T2 が索引の要求に
                                     # 数え(indexes: に無ければ error)、data-table-parity が本文にその列が現れることを見る。
                                     # app が引く索引はここでなく query_spec に書く
    # enforces:                      # 任意。shape: composite の関数だけが書ける(ADR-0014)。この関数が
    #   - writes: "{エンティティ}"   # access_spec の writes のどの規則の執行点かを名指す(by で一意。
    #     by: "{ロール ID}"          # when / fields は写さない = 正は access_spec)。見張りテストは
    #     test_case: "TC-TABLE-{TABLE}-002"  # 必須で、同じ表の test_cases の id(T18 が実在と一意性を見る)
  - name: "is_{ロール}"              # RLS 補助関数(実行者の集約の表に置く)。ポリシーの中から実行者の
    args: []                         # 集約を直に読むと再帰するので、security definer の関数に逃がす
    kind: helper
    role: "{ロール ID}"              # そのロールの根拠を判定する = 本文は生成物、という宣言。
                                     # 宣言するなら migration と対であり、ポリシーが要求するロールと
                                     # 過不足なく一致する(T7 が両方向)。生成しない補助関数は role を書かない
    migration: "{14 桁}_helper_is_{ロール}.sql"  # 連番は全 policies_migration より前(ポリシーが関数を参照する)
  # 送信の上限(outbox = jobs の表にだけ置く。本文は生成物。書き方の正は ARCH-SP-BE-0001 §送信の上限。T26)
  # - name: "send_limit_{名前}"
  #   args: [text, uuid, text]           # 種別・keys の順(uuid)・payload の順(text)
  #   params: [p_type, "p_{鍵}", "p_{欄}"]
  #   kind: send_limit
  #   migration: "{14 桁}_send_limit_{名前}.sql"
  #   send_limit:
  #     event: "{集約}.{操作}"           # 呼ぶ RPC(calls で名指す)の集約の操作
  #     types: ["{ジョブ ID}"]           # 数える種別 = 積んでよい種別
  #     keys: [{ name: "{鍵}", blocked: { table: "{表}", column: "{状態の欄}", values: ["{状態}"], word: "{語}" } }]
  #     # 鍵に unit: { via: [{ table, column, to }, …] } を書くと、参照を辿った先(例: 招いた利用者)ごとに数える(既定 actor = 鍵の値ごと)
  #     # ※ unit.via は試験段階で未決(T26 が警告を出す。決めるまで書かない)
  #     payload: ["{欄}"]
  #     limits: [{ word: "{語}", key: "{鍵}", max: 10, per: 24 hours }]   # 宣言の順 = 拒否の理由を選ぶ順

checks:                              # 任意。entity_spec / state_spec の導出でない CHECK だけ(長さ・範囲・状態集合は書かない)
  - name: "{制約の実名}"
    rule: "{条件式}"                 # 正が invariant_spec にあるものは rule を書かず invariant で参照する
    invariant: "{INV-...}"           # 任意。invariant だけを宣言すれば formal から式が生成される(T16)
    handwritten: "{手書きに残す理由}" # 任意。手書きの migration が既に作っている執行点だけ(rule とは併記できない)

test_cases:                          # 必須。1 つ以上。突合テスト(data-table-parity)の宣言
  - id: "TC-TABLE-{TABLE}-001"
    type: integration
    covers: [success]
    spec_ids: ["table-{テーブル名}"]
    implementation: "app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ("{...}")は実値に置き換え、引用符は不要になったら外す。
- この仕様は薄いことが正しい。以下は**ここに書かない**:
    列・型・NOT NULL・DEFAULT              → specs/domain/{aggregate}/entity.md(row-parity が突合)
    読み取りポリシー(RLS)の中身            → access_spec の reads(名前も USING 句も生成物。ここに書くのは
                                            書き出す先の policies_migration と補助関数の宣言だけ)
    不変条件の条件式                        → specs/domain/{aggregate}/invariants.md(名前と invariant ID で参照する)
- data_table が持つのは **DB 固有の実装判断だけ**: インデックス・FK の ON DELETE・トリガ・
  関数の帰属・非導出 CHECK。導出できる情報を書き写すと正が割れる(PRIN-0007)。
- 宣言は**閉世界**である。インデックス・FK・トリガは表ごとに、関数は全ファイルの和集合として、
  統合テスト(data-table-parity)が pg_catalog と双方向に突き合わせる。宣言に無い実体を DB に
  足すと赤くなる(そのときは migration と同じ変更でここも直す)。
- 本文の手書き散文は**標識**2種だけ(各 1〜3 行): 否定(検討して捨てた代替案)と線引き(ここでは
  やらないの宣言)。事実の再記述はドリフト源なので書かない。経緯は NOTES へ。
- 配置と書き方の正: docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md
-->

# {テーブルの日本語名}({table})— テーブル実装

{手書き散文は標識 2 種・各 1〜3 行のみ。列・型・可視性の再掲はしない。例:}

- {否定の標識: 「patron_id の on delete を cascade にしない — 貸出が利用者の行を守る」}
- {線引きの標識: 「単行の予約順更新 RPC は持たない — 書き込み口は一括の reorder_holds に一本化」}

<!-- AUTO-GENERATED:data-table-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:data-table-body -->
