---
doc_type: query_spec
scope: backend
id: "query-{name をハイフン区切りにしたもの}"   # 例: query-loan-own-list。ファイル名は {aggregate}/{name}.md 固定

name: "{name}"                       # 必須。snake_case。実装は {camelCase(name)}Query(配線)/ select{PascalCase(name)}(写像)
for: ["{role_1}"]                    # 必須。実行するロール＝観客。グローバルロール（binding を持たないもの）のみ
via: "{context_role}"                # 任意。行の可視性を供給する関係ロール。for 自身では読めないときだけ書く
source: "{entity}"                   # 必須。主エンティティ（entity_spec の entity）
scope_used: own                      # 必須。own | context({entity}) | all。for（via があればそのロール）の reads と一致すること
returns: many                        # 必須。one（1 件）| many（0 件以上）

params:                              # 任意。実行時に外から渡す入力。filters から param.{name} で参照する
  - name: "{param_name}"
    ref: "{entity}.{field}"          # 型の導出元。制約は entity_spec が正なので書かない

filters:                             # 任意。絞り込み（UX）。ガード式と同じ文法
  # 参照できるのは source のフィールド / context で辿れるパス / actor / now / param.{name}
  - "{field} == {value}"

includes:                            # 任意。併読するエンティティ
  - entity: "{entity_2}"
    scope_used: own                  # include 先の reads 宣言と一致すること
    via: "{context_role}"            # 任意。この併読の可視性を供給する関係ロール（source の via は継がない）
    filters:                         # 任意。文法・検査は source の filters と同じ（起点は併読先）
      - "{field} == {value}"
    projection: [id]                 # 併読先も返すフィールドを明示する（必須）
    sort: ["{field} asc"]            # 任意。書かなければ併読の順序は未定義
    limit: 20                        # 任意。件数が有界だと確かめられたときだけ書く

sort:                                # 任意。"{フィールド名} asc|desc"（方向を省くと asc）
  - "{field} desc"

paging: none                         # returns: many のとき必須。none | limit({件数}) | cursor

projection:                          # 必須。返すフィールド（entity_spec に実在し、fields_hidden と衝突しないこと）
  - id
  - "{field}"

test_cases:                          # 必須。1 つ以上。うち 1 つ以上は type: integration
  - id: "TC-{AGGREGATE}-{NAME}-001"
    type: integration                # unit | integration
    covers: [success]                # このケースが覆う意味クラス（値域、複数可）
    spec_ids: ["query-{name}"]       # query_spec の id / access_spec の id / イベント ID / 不変条件 ID
    implementation: "app/src/composition/__tests__/{aggregate}/{name}.test.ts::{テスト名}"
---

<!--
記入ガイド

- プレースホルダ（"{...}" で囲まれた部分）は実値に置き換え、引用符は不要になったら外す。
- この仕様は薄いことが正しい。以下は**ここに書かない**（ドメイン仕様が正）:
    誰にどこまで見えるか（スコープ・隠しフィールド） → specs/domain/{aggregate}/access.md（reads / fields_hidden）
    フィールドの型・制約                              → specs/domain/{aggregate}/entity.md
    状態遷移・書き込みの権限                          → specs/domain/{aggregate}/states.md
- **三分法**: 実行のたびに変わる値は params、いつ実行しても同じ取捨選択は filters、
  誰に見せてよいかは access_spec の reads（RLS が執行）。
  filters を消したときに見えてはいけないものが見えるなら、それは access_spec 側の宣言が間違っている。
- **for と via**: for＝観客（誰が実行するか。グローバルロールのみ）、via＝その行を見せている関係
  （文脈依存ロール）。via は「どの reads 宣言の上に立っているか」の名札であり、
  借りられるのは own / context(...) だけ（all は借りられない）。for のロール自身で読めるなら via は書かない。
- **可視性は二層**: 上界（見えてはいけないものが返らない）は RLS、スコープ条件（宣言どおりの集合が返る）は
  via のロールの binding から導かれる絞り込み。スコープ条件は仕様からの写しであって実装の判断ではない。
- test_cases の covers は必須（未記入はエラー）。spec_ids に書けるのは query_spec の id /
  access_spec の id / 不変条件 ID の 3 種で、ドメインイベント ID は書き込み側の語彙なので書かない。
- for に複数のロールを並べられるのは、全員の reads スコープが同じときだけ。違うなら別のクエリに分ける。
- 隠しフィールド（fields_hidden）は返せないだけでなく、filters・sort にも使えない
  （件数や順序から中身が漏れるため）。
- RLS を通る経路のテスト（type: integration）が 1 つ以上必要。ユニットテストだけでは
  「見えてはいけない行が見えない」ことを何も保証できない。
- test_cases の implementation は {リポジトリルートからのパス}::{テスト名}。
  テストコード側に対応する `// @tc {id}` を書く（双方向に突合される）。
- 本文の手書き散文は**標識**2種だけ（各 1〜3 行）: 否定（検討して捨てた代替案）と線引き（ここでは
  やらないの宣言）。事実の再記述はドリフト源なので書かない。経緯は NOTES へ。
- 書き方の正: docs/rules/process/backend/specification/standards/query-spec-writing.md
- 配置の正: docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md
-->

# {クエリの日本語名}（{name}）

{手書き散文は標識 2 種・各 1〜3 行のみ。スコープ・権限の再掲はしない。例:}

- {否定の標識: 「履歴を上限で切らない — filters で返す集合そのものを絞る（切ってよい行と悪い行を上限は区別できない）」}
- {線引きの標識: 「却下・取下げの履歴の閲覧は将来の別クエリで受ける」}

<!-- AUTO-GENERATED:query-body -->
（この見本では空のまま。実ファイルでは npm run generate が宣言のマトリクスを差し込む）
<!-- /AUTO-GENERATED:query-body -->
