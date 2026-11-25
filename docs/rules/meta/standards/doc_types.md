---
doc_type: meta
scope: repository
norms: [PRIN-0011]
decisions: [ADR-0005]
---

# doc_type の定義 — 文書の種類と、その種類が書いてよいこと

この台帳は、**文書の中身が層を越境しないようにする**ためにある。doc_type は「これは何の文書か」の宣言であり、配置・参照・必須フロントマターの判定はすべてここを基点に決まる。

全 doc_type を同じ型で書く。**何を書くか / 書いてはいけないこと / 主な参照元 / 主な参照先**、必要なら配置・ID・テンプレートを添える。「書いてはいけないこと」を各 doc_type に持たせているのが要点で、これが無いと層分離([PRIN-0011](../../principles/common/PRIN-0011-document-layer-separation.md))は執行力を失う。

**doc_type の一覧はここが正である。** ここに無い doc_type を宣言する文書は、`npm run verify` の M1 が「doc_types.md に定義の無い doc_type」として警告する。新しい種類が本当に要るなら、先にこの文書へ足す。

## directory_guide（ディレクトリガイド）

- **書くこと:** ディレクトリの唯一の入口。責務・構成・次に読む場所。AI と人間の両方に向けて書く。配下に共通でかかる規範があればフロントマターの `norms` で明示する
- **書いてはいけないこと:** 個別の原則・仕様・手順の詳細。具体的な規範やルールの本文(それは適切な名前を持つ別ファイルに書く)
- **主な参照元:** ほぼ無い。入口なので参照される側ではなく案内する側である
- **主な参照先:** `norms` に上位の principle / architecture を書いてよい。無ければ空配列 `[]` を書く
- **配置:** 各ディレクトリの README.md。入口は 1 つとし、AI 用と人間用に分けない([ADR-0005](../../decisions/common/ADR-0005-single-entry-point.md))。AI 向けの案内は README 内の節にする
- **ID:** 必須。`DG-0001`(common / repository)/ `DG-BE-0001` / `DG-FE-0001`。参照グラフに参加させるため、案内文書であっても ID を持たせる
- **テンプレート:** [docs/template.directory_guide.md](../../../template.directory_guide.md)。rules と specs に共通の 1 枚で、節の語彙は open(固有の節を足してよい)。ただし節がひとつも無い README は M5 が警告する

## principle（原則）

- **書くこと:** 憲法レベルの大原則。抽象度が高く、個別の実施ルールには落とさないもの
- **書いてはいけないこと:** 個別論(「ここでは〇〇する」)、実装手順の詳細、アーキテクチャの構造説明
- 個別論は process と規約文書に「大原則の適用」という形で書く
- **主な参照元:** なし(原則が最上位である)
- **主な参照先:** process・spec が principle を参照してよい

## domain（ドメイン）

- **書くこと:** ドメインの概要・用語集・業務概念。仕様が「何について」のものかを与える
- **書いてはいけないこと:** API のリクエスト / レスポンスの詳細、技術的なレイヤー構成
- **主な参照元:** principle・decision
- **主な参照先:** spec・process が参照してよい

## domain_glossary（ドメイン用語）

- **書くこと:** 用語の業務上の意味、混同しやすい用語との区別、自然な使用例、その用語に閉じた不変条件、関連用語
- **書いてはいけないこと:** 処理方法・API・DB・画面の詳細。データ構造(ツリー・テーブル・配列・リレーション)。技術的制約や実装方針。システム用語(バージョン・フラグ・ID)。**単語をまたぐ不変条件**(それは domain_invariant)
- **主な参照元:** principle
- **主な参照先:** domain_invariant・domain_example・spec

## domain_invariant（ドメイン不変条件）

- **書くこと:** 必ず守られる条件のうち、**複数の用語にまたがるもの**。内容・補足・関連する glossary 用語
- **書いてはいけないこと:** 処理方法・API・DB・仕様の詳細。個別の用語に閉じた条件(それは glossary)。歴史的経緯や判断理由(それは decision)
- **主な参照元:** principle
- **主な参照先:** domain_glossary・domain_example・spec

## domain_example（ドメイン例）

- **書くこと:** 前提・結果・根拠がはっきりした業務上の例。どう判定され、どの状態になり、なぜその結果なのか
- **書いてはいけないこと:** 処理方法・API・DB・仕様の詳細。実装手順やテストデータの詳細
- **主な参照元:** domain_glossary・domain_invariant
- **主な参照先:** spec・process

## domain_design_context（ドメイン設計文脈）

ドメインの理解から導かれるが、業務知識そのものではない設計の前提知識を置く場所である。

- **書くこと:** ドメインの性質から来る設計前提(あるデータが不変である理由)。概念間の構造的な関係(2 つが独立している理由)。業務の人には自明だが実装者が見落とす特性
- **書いてはいけないこと:** 業務上の意味の定義(→ glossary)。技術的な実装方式やレイヤー構成(→ architecture)。個別の API・テーブルの仕様(→ spec)。不変条件そのもの(→ domain_invariant)
- **主な参照元:** domain_glossary・domain_invariant
- **主な参照先:** architecture・spec・process が設計判断の根拠として引用してよい

## domain_precedent（設計判例）

**実際に起きた 1 件の設計判断の記録である。** domain_design_context が「一般化された前提知識」を置くのに対し、こちらは**まだ型になっていない個別の経緯**を、将来同じ壁にまた当たったときにゼロから考え直さないために残す。私有層(このリポジトリだけ)の文書であり、配布物には含めない([placement_policy](./placement_policy.md)「knowledge 配下」)。

- **書くこと:** 症状(何が問題だったか)→ 検討した迂回(どの代替案を比べたか)→ 採った形(何を決めたか)→ 代償(何を諦めたか)→ 結果(何が消えた・変わったか)、の 5 点。実例は具体的なほうがよい(架空化しない)
- **書いてはいけないこと:** 一般化した判断原理そのもの(複数の判例が同じ型に定まったら、その型は domain_design_context や [dsl-extension-triage.md の迂回パターン集](../../process/common/specification/playbooks/dsl-extension-triage.md#patterns)へ昇格させ、判例側はその出典として残す)。歴史の生ログ(経緯の時系列そのものは `NOTES.md` が正。判例は熟した結論だけを書く)
- **主な参照元:** なし(判例は経緯から昇格した終端であり、他の文書から根拠として引かれるのを待つ側)
- **主な参照先:** spec・process・architecture が設計判断の根拠として引用してよい

## architecture（アーキテクチャ）

- **書くこと:** レイヤー構成・依存関係・ディレクトリ構造・技術選定の構造面
- **書いてはいけないこと:** 個別の API の仕様。「なぜその構成にしたか」の意思決定の詳細(→ decision)
- **主な参照元:** principle・decision
- **主な参照先:** process・spec
- **2 種に分ける。** 置き場所で区別する
  - **system** — コードと実行系の構造。層・ディレクトリ・依存の向き・技術スタック。`architecture/system/{scope}/`
  - **specification** — 仕様書を作るレベルの構造。`docs/specs/` の構成、仕様書の分割方針、仕様の置き場所と命名。`architecture/specification/{scope}/`

## process（プロセス）

- **書くこと:** 仕様の執筆手順・検証手順・実装手順。何をいつどうやるか
- **書いてはいけないこと:** 原則の本文。個別の仕様の内容
- **主な参照元:** principle・architecture・domain(必要なら decision)
- **主な参照先:** なし。process は参照する側の終端であり、上位から process が参照されることはない([reference_policy](./reference_policy.md) の参照可否表)

## decision（ADR）

- **書くこと:** なぜその選択をしたか。文脈・選択肢・結論・結果
- **書いてはいけないこと:** 原則・アーキテクチャ・仕様の本文
- **主な参照元:** principle・architecture・domain(決定の前提として)
- **主な参照先:** 全層が decision を参照してよい。参照するときは「この決定に基づく」と明示する

## meta（メタ）

- **書くこと:** 文書体系そのものの定義とルール。doc_type の定義、配置ポリシー、参照の辿り方など
- **書いてはいけないこと:** 個別の仕様・手順・原則
- **主な参照元:** なし(土台である)
- **主な参照先:** すべての doc_type が meta を参照してよい

## product_roots（製品の根の宣言）

- **書くこと:** この製品の木がリポジトリのどこにあるか（`roots` の 7 欄。詳細は [placement_policy](./placement_policy.md)「根は製品が宣言する」）。あわせて製品の名前（`name`）・採る仕様の種類（`uses`）・製品が何かを言う 1 行（`summary`。任意）を持つ
- **書いてはいけないこと:** 手書き層の置き場（仕組みが形として決める）・設定値・題材の紹介
- **置き場所:** リポジトリ直下の `product.md` **1 枚だけ**。仕組みはこのファイルを上へ探してリポジトリルートを決めるので、位置は動かせない
- **主な参照元:** 検査器・生成器・通し実行（`legacy/spec-tools/**`）が唯一のパスの出どころとして読む
- **主な参照先:** なし（宣言であって説明ではない。理由は placement_policy が持つ）
- **検査:** P0 がスキーマ適合、P1 が仕様の木の実在、W3 が「仕組みがこの宣言の外でパスを組み立てていない」ことを見る

## spec（仕様）

- **書くこと:** 具体的な仕様。エンドポイント・スキーマ・画面・振る舞い・テストケース
- **書いてはいけないこと:** 原則やプロセスの本文。意思決定の理由の詳細
- **主な参照元:** principle・architecture・domain。関連する decision を参照すべきである
- **主な参照先:** なし。仕様は実装が直接参照する終端である
- **分類:** 対象はディレクトリ構成で表す。scope(backend / frontend / common)ごとに専用の doc_type を持つ

### doc_type を増やすかどうかの打ち切り規則

**検証器がコード分岐に使う doc_type だけが専用型を持つ。それ以外はすべて `spec` である。** 「概念として別物だから」を理由に doc_type を増やすと、機械にとって区別のない名前が増えるだけで、どちらを宣言するかの判断が書き手に任される。分岐が要らない区別はディレクトリ名で表す。

### backend の仕様 doc_type（scope: backend）

配置は [ARCH-SP-BE-0001](../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) に従う。

**backend 仕様が保有してよいのは境界の情報だけである** —— 受け入れる内容・返す内容・保護対象のテスト。ドメインの状態・権限・不変条件・フィールド制約を backend 仕様の中で**再定義してはいけない**(根拠 [ARCH-SP-0002](../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md))。書けるのは名前への参照だけである。

| doc_type | 何の仕様か | 必須フィールド | 配置 |
|---|---|---|---|
| `spec` | 汎用。専用型を持たないものはすべてこれ | `id` | ARCH-SP-BE-0001 に従う |
| `action_spec` | Server Action(ドメインイベントのハンドラ) | `id` / `handles` / `input` / `errors` / `test_cases` | `docs/specs/backend/actions/{aggregate}/{event}.md` |
| `query_spec` | 読み取りクエリ(action_spec と対になる読み取り側) | `id` / `name` / `for` / `source` / `scope_used` / `returns` / `projection` / `test_cases` | `docs/specs/backend/queries/{aggregate}/{name}.md` |
| `data_table` | DB テーブルの**物理実装判断**(インデックス・FK の ON DELETE・トリガ・関数の帰属・非導出 CHECK) | `id` / `table` / (`entity` か `internal: true` の一方) / `test_cases` | `docs/specs/backend/data/tables/{table}.md` |
| `notification_spec` | このシステムが送る**通知の全数**(宛先・メンション・経路・発火のしかた) | `id` / `vocabulary` / `notifications` / `test_cases` | `docs/specs/backend/notifications.md`(1 プロジェクト 1 ファイル) |
| `job_spec` | このシステムが**人手なしで動かすものの全数**(発火の出どころ・種別・失敗時の挙動・いつ動くか) | `id` / `vocabulary` / `jobs` / `test_cases` | `docs/specs/backend/jobs.md`(1 プロジェクト 1 ファイル) |
| `auth_spec` | **サインインすると何が起きるか**の全数(状況ごとの着地・実行する操作・画面に入るときの関門) | `id` / `subject` / `landings` / `sign_in` / `gates` / `test_cases` | `docs/specs/backend/auth.md`(1 プロジェクト 1 ファイル) |
| `config_spec` | このシステムを**動かすのに要る設定の全数**(値の性質・要求度・無いとどうなるか・何のために繋がっているか) | `id` / `vocabulary` / `variables` | `docs/specs/backend/config.md`(1 プロジェクト 1 ファイル) |
| `guarantee_spec` | **設計で不可能にした事実の全数**(執行者・状態・見張りテスト) | `id` / `vocabulary` / `guarantees` / `test_cases` | `docs/specs/backend/guarantees.md`(1 プロジェクト 1 ファイル) |
| `external_spec` | **外の誰と何のためにやり取りし、鍵が無いとどうなるかの全数**(向き・効果・縮退・リトライ・送る情報) | `id` / `vocabulary` / `integrations` | `docs/specs/backend/external.md`(1 プロジェクト 1 ファイル) |
| `surface_spec` | **SQL の公開面 `surface`**(外に出すスキーマ・ビュー・土台の関数・DB ロールへの grants。責務は SQL の境界だけ)のうち仕様から導けないもの —— 土台の書き出し先と、生成物にできず手書きで残すビュー | `id` | `docs/specs/backend/surface.md`(1 プロジェクト 1 ファイル) |

- `action_spec` の `handles` はドメインイベント ID を **1 つ**だけ持つ。書き方は [action-spec-writing.md](../../process/backend/specification/standards/action-spec-writing.md)
- `query_spec` の `paging` は `returns: many` のとき必須。`scope_used` は access_spec の `reads` と一致しなければならない(**可視性の正はドメイン仕様の側にある**)。書き方は [query-spec-writing.md](../../process/backend/specification/standards/query-spec-writing.md)
- `notification_spec` は **1 プロジェクト 1 カタログ**で、`id` は `notification-catalog` 固定である(導出元となる名前が無い — `design_token_spec` と同じ)。宣言するのは「誰に飛ぶか」という保証の側だけで、Webhook の URL・メンション文字列・文面(運用設定)や、どの遷移で飛ぶか(`state_spec` の `effects` が正)を書いてはいけない。**語彙(medium / audience / mention)はカタログ自身の `vocabulary` が宣言する** — 機械が分岐に使う軸(`trigger`)だけが体系側の値域である。書き方と検査(N0〜N2)は [notification-spec-writing.md](../../process/backend/specification/standards/notification-spec-writing.md)
- `config_spec` も **1 プロジェクト 1 カタログ**で、`id` は `config-catalog` 固定である。宣言するのは「何を設定すれば動くか」の全数と、行ごとの**無いとどうなるか**(`absence`)であり、値そのもの・どのファイルが読んでいるか(実装が正)・投入の手順(runbook)を書いてはいけない。**語彙は 3 軸ともカタログ自身の `vocabulary` が宣言する** — K1 / K2 が語で分岐しないため、体系側が固定する軸は 1 つも無い(`notification_spec` の `trigger`・`job_spec` の `source` に当たるものが要らない)。`used_by` の軸が**連携カタログを兼ねる**。書き方と検査(K0 / K1 / K2)は [config-spec-writing.md](../../process/backend/specification/standards/config-spec-writing.md)
- `auth_spec` も **1 プロジェクト 1 ファイル**で、`id` は `auth-flow` 固定である。宣言するのは「どの状況の人がどこへ着き、何が勝手に実行されるか」を**決定表**(順序を持たない行の集合)として書いたものであり、画面の中身(`screen_spec` の `variants` が正)・着地先の URL(`screen_spec` の `route` が正)・操作の可否(`state_spec` が正)・OAuth の作法や文言(実装の自由)を書いてはいけない。**軸はすべて体系側の値域である** — `config_spec` とは逆で、H1〜H3 と生成物が値で分岐するため(語彙は「認証フロー」1 本に固有であり、アプリごとに増えない)。主語の状態機械の**全状態が尽くされていること**を H1 が見る(暗黙の「その他」を作らせない)。書き方と検査(H0 / H1 / H2 / H3)は [auth-spec-writing.md](../../process/backend/specification/standards/auth-spec-writing.md)
- `job_spec` も **1 プロジェクト 1 カタログ**で、`id` は `job-catalog` 固定である。宣言するのは「誰も見ていないときに動くもの」の全数(イベントで積まれる outbox と、時刻で起きる schedule)であり、どの遷移が積むか(`state_spec` の `effects` が正)・リトライの回数やバックオフの秒数(実装と DB の既定値が正)・`payload` の中身を書いてはいけない。**語彙(kind / on_failure)はカタログ自身の `vocabulary` が宣言する** — 機械が分岐に使う軸(`source`)だけが体系側の値域である。書き方と検査(J0 / J1 / J2)は [job-spec-writing.md](../../process/backend/specification/standards/job-spec-writing.md)
- `data_table` は **entity_spec から導出できない DB 固有の実装判断だけ**を宣言する。列・型・NOT NULL(→ entity_spec)、読み取りポリシー(→ access_spec の `reads`)、不変条件の条件式(→ invariant_spec)を再定義してはいけない。ドメイン仕様に現れない内部テーブル(`jobs` / `domain_events`)は `entity` の代わりに `internal: true` で宣言する。書き方と突合の設計は [ARCH-SP-BE-0001](../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) §テーブル仕様、検査は T0 / T1 + 統合テスト(data-table-parity)
- `guarantee_spec` も **1 プロジェクト 1 カタログ**で、`id` は `guarantee-catalog` 固定である。宣言するのは「設計で不可能にした事実」の全数であり、**保証の中身の実装**(RLS ポリシー・GRANT 文・トリガの本体・型の定義)と**テストの中身**を書いてはいけない(実装・テストコードが正)。`status: enforced` の行は見張りテスト(`canaries`)を 1 つ以上持たないと書けない — 見張りテストを宣言していない保証は主張しているだけとして Z0 が落とす。**語彙(enforcer)はカタログ自身の `vocabulary` が宣言する** — 機械が分岐に使う軸(`status`)だけが体系側の値域である。書き方と検査(Z0 / Z1 / Z2)は [guarantee-spec-writing.md](../../process/backend/specification/standards/guarantee-spec-writing.md)
- `external_spec` も **1 プロジェクト 1 カタログ**で、`id` は `external-catalog` 固定である。宣言するのは「外の誰と何のためにやり取りし、鍵が無いとどうなるか」の全数であり、**アダプタの実装**(SDK 呼び出し・認証・レスポンス変換)と**値そのもの**(URL・トークン・API キー。config_spec が正)を書いてはいけない。`direction` はこの版では `outbound` 固定である(inbound は実物が無いので書けない)。**語彙(service)はカタログ自身の `vocabulary` が宣言する** — 機械が分岐に使う軸(`direction` / `effect` / `degrade` / `retry`)だけが体系側の値域である。X1 が `app/src/infrastructure/` 直下のディレクトリの全数を分類し、無宣言のアダプタを検出する。書き方と検査(X0〜X4)は [external-spec-writing.md](../../process/backend/specification/standards/external-spec-writing.md)
- `surface_spec` も **1 プロジェクト 1 ファイル**で、`id` は `surface` 固定である(旧い綴りの `api_spec` は受けない)。宣言するのは**`surface` のうち仕様から導けないもの**だけ —— 公開スキーマの土台の書き出し先(`surface_base_migration`)と、列の正がどこにも無いので生成物にできないビュー(`hand_written_views`)である。**ビューの一覧・列・隠し列をここに書いてはいけない**(entity_spec の `fields` と access_spec の `fields_hidden` / `reads` が正であり、書き写すと正が 2 つになる)。ビューの書き出し先は表ごとの data_table の `surface_migration` である。書き方と検査(T12)は [surface-spec-writing.md](../../process/backend/specification/standards/surface-spec-writing.md)

### frontend の仕様 doc_type（scope: frontend）

**画面仕様が宣言するのは構造と配線だけである。** 見た目・文言・操作感は実装の自由に残す。backend と同じく、ドメインの状態・権限・フィールド制約・読み取り経路を FE 仕様に再定義してはいけない(ARCH-SP-0002)。画面が書けるのは名前への参照 —— `reads` に置く query_spec の id、`actions` に置くドメインイベント ID —— だけである。

| doc_type | 何の仕様か | 必須フィールド | 配置 |
|---|---|---|---|
| `screen_spec` | 1 ルートの画面の構造と配線 | `id` / `name` / `route` / `for` / `layout` | `docs/specs/frontend/screens/{group}/{name}.md` |
| `chrome_spec` | 画面をまたぐ共有レイアウトの骨格と、そこから出る遷移 | `id` / `name` / `layout` | `docs/specs/frontend/chrome/{name}.md` |
| `design_token_spec` | 視覚層の意匠の値域(色・字組・余白・角丸・意味色) | `id` / `theme` / `palette` / `groups` | `docs/specs/frontend/design/tokens.md` |
| `usecase_spec` | 1 タスク(人がやりたいこと)を、ドメインの操作の組み合わせとして宣言する | `id` / `name` / `goal` / `actor` / `start` / `done` / `saves` | `docs/specs/frontend/usecases/{name}.md` |
| `ux_principles_spec` | **UX 原則の台帳**(原則・見張る検査・閾値) | `id` / `principles` | `docs/specs/frontend/ux-principles.md`(1 プロジェクト 1 ファイル) |

- `screen_spec` の任意キー: `chrome` / `requires_auth` / `subject`+`precondition`+`on_fail` / `reads` / `actions` / `navigations` / `overlays` / `states` / `test_cases`。書き方は [screen-spec-writing.md](../../process/frontend/specification/standards/screen-spec-writing.md)
- **`chrome_spec` に書けるのは `doc_type` / `scope` / `id` / `name` / `layout` / `navigations` の 6 つだけである(allowlist)。** `for` / `route` / `reads` / `actions` は書けない。`navigations` はロード時に継承先の画面へ展開される
- `design_token_spec` は 1 プロジェクト 1 ファイルで、`id` は `design-tokens` 固定である(導出元となる名前が無いため)。任意キーは `externals` / `contrast`。書き方は [styling.md](../../process/frontend/system/standards/conventions/styling.md)
- **screen_spec と design_token_spec の分担** — 画面仕様は構造と配線を宣言し、トークン仕様は意匠の語彙を宣言する。**どちらの対象でもないのが「部品ごとの配色指定」**で、部品スタイル(トークンの当て先)は実装の裁量に残る。機械が見るのは、トークン外の値を使っていないこと(G1・G2)と、宣言された重ね順が判読可能であること(G3)である
- **`usecase_spec` に書けるのは allowlist のキーだけである(ADR-0011 §2)。** ガード・権限・必須・不変条件に相当するキーは無い —— ユースケースはドメインの操作を**組み合わせる**だけで、操作の意味を**定義し直せない**。任意キーは `budget`(認知の予算の上書き)/ `accept`(予算超過の理由つき受け入れ)。書き方は [usecase-spec-writing.md](../../process/frontend/specification/standards/usecase-spec-writing.md)

- `ux_principles_spec` は 1 プロジェクト 1 ファイルで、`id` は `ux-principles` 固定である(導出元となる名前が無いため)。宣言するのは**既存の宣言から原則を導く検査の ID(`enforced_by`)と閾値(`budget`)**であり、**新しい事実**(状態・権限・画面の構成)と**生成物の形を直接決める項目**を書いてはいけない(原則 → 属性 → 生成物の経路は、閉じた属性の名前 `affects` を必ず通る)。`doc_type` を専用にしたのは、検証器(U 群の閾値・Y5 の既定予算・U8)が台帳を読んで分岐に使うからである(上の打ち切り規則)。画面ごとの受け入れは各 `screen_spec` の `ux:` に書き、台帳には書かない。書き方と検査(U8)は [ux-lint.md](../../process/frontend/specification/standards/ux-lint.md)

**不採用の記録。** 参考にした体系にあった `view_spec` / `component_spec` / `validation_spec` / `flow_spec` / `platform_spec` は採らない。`view_spec` の役割(テストと 1 対 1 になる単位)は screen_spec の `layout` スロットが担い、`validation_spec` の役割は entity_spec から生成される zod スキーマが担う(ARCH-SP-0002)。画面横断のシナリオ(`flow_spec`)と共有 UI 部品(`component_spec`)は、実例が出たときに検討する。

### domain の仕様 doc_type（scope: common）

ドメインの形式定義 —— 状態機械・権限・不変条件・フィールド制約 —— を置く。**YAML フロントマターが正であり、Markdown 本文の図や表は `<!-- AUTO-GENERATED -->` の生成物である。** これらは検証器(V1〜V12)と生成器(zod スキーマ・遷移テーブル)の入力になる。

配置は `docs/specs/domain/` で、`roles.md` だけが直下、他は `{aggregate}/` 配下にファイル名固定で置く(構成の正は ARCH-SP-0002、YAML スキーマとガード式の文法は [domain-spec-writing.md](../../process/common/specification/standards/domain-spec-writing.md))。

| doc_type | 何の仕様か | 必須フィールド | ファイル |
|---|---|---|---|
| `role_spec` | ロールの定義(グローバル / 文脈依存) | `id` / `roles` | `domain/roles.md`(ドメイン全体で 1 つ) |
| `entity_spec` | エンティティのフィールドと制約 | `id` / `entity` / `fields` | `domain/{aggregate}/entity.md` |
| `state_spec` | 状態機械と遷移の実行権限 | `id` / `state_machine` / `states` / `initial` / `final` / `events` | `domain/{aggregate}/states.md` |
| `access_spec` | 読み取り権限とフィールド更新権限 | `id` / `entity` / `reads` | `domain/{aggregate}/access.md` |
| `invariant_spec` | 不変条件と、その執行点の宣言 | `id` / `invariants` | `domain/{aggregate}/invariants.md` |

- `role_spec` の文脈依存ロールには `binding` 式が必須である
- `entity_spec` は**フィールド制約の唯一の定義場所**であり、zod 生成の源である。文脈依存ロールを使うなら `context` が必須。`table`(DB テーブル名。既定は複数形化の規則)は任意
- `state_spec` の各イベントには `from` / `to` / `by` / `otherwise_forbidden` が必須で、`guard` / `effects` は任意である
- `access_spec` は**全ロールの `reads` を明示しなければならない**(`scope: none` も書く)。`fields_hidden` / `writes` は任意
- `invariant_spec` の各不変条件には `statement` / `entities` / `enforced_by`(1 つ以上)が必須である

### common の仕様 doc_type

`api_contract`(FE / BE 間の API インターフェース契約)を定義してあるが、**現構成では `docs/specs/common/` を使っていない**。FE と BE に共通の型・バリデーションは `docs/specs/domain/` からの生成物が担うためである(ARCH-SP-0002)。別のコードベースの利用者が現れたときに復活させる枠である。

### 用語の台帳(scope: common)

| doc_type | 何の仕様か | 必須フィールド | 配置 |
|---|---|---|---|
| `term_ledger` | **仕組みの説明語の台帳**(語・1 行の定義・初出・使わない綴り) | `id` / `terms` | `docs/specs/terms.md`(1 プロジェクト 1 ファイル) |

- `term_ledger` は **1 プロジェクト 1 ファイル**で、`id` は `term-ledger` 固定である(導出元となる名前が無い — `design_token_spec` と同じ)。宣言するのは**仕組みの側の説明語だけ**であり、業務の語(`docs/knowledge/TERM-*.md` の `domain_glossary`)と語釈の長い散文を書いてはいけない。`doc_type` を専用にしたのは、検証器(M7〜M9 / M11)が台帳を読んで分岐に使うからである(上の打ち切り規則)。書き方と検査は [term-ledger-writing.md](../../process/common/specification/standards/term-ledger-writing.md)

### 現構成で使わない doc_type

参考にした体系から持ち込まれた `api_type` / `data_query` / `batch_spec` / `feature_spec` は**新規に使わない**(`surface_spec`〔旧称 `api_spec`、2026-10-10 に改名〕は 2026-09-23 に**別物として開設した** —— 持ち込み元の「REST エンドポイントの定義」ではなく、**`api` スキーマという外から届く `surface` のうち仕様から導けないものだけ**を宣言する 1 枚である。上の backend の表を参照)(`feature_spec` は「機能仕様」の一般化枠。実物が 3 つ揃った時点で一般化を判断する — 1 つ目が `notification_spec`・2 つ目が `job_spec`・**3 つ目が `config_spec`(2026-08-26)。三の法則を満たしたので、一般化するかどうかの判断が起票の対象になった** — 3 つに共通するのは「1 プロジェクト 1 カタログ・語彙は仕様が宣言・実装と双方向に閉じる」であり、違うのは閉じる相手(effects / Cron 登録 / ソースの `process.env` 参照)である。**4 つ目が `auth_spec`(2026-08-26)で、共通点のうち「語彙は仕様が宣言」だけが当てはまらなかった**(軸が体系側の値域になる)。一般化するなら共通形は「1 プロジェクト 1 ファイル・行の集合・実装と双方向に閉じる」までで、語彙の持ち主は仕様種ごとの判断として残る。**裁定(2026-08-27): 一般化も共通部分の括り出しもしない。** 閉じる相手が 4 つとも違い、共通形は**設計パターンとしては確立したが、コードの重複はまだ実害を出していない** —— 抽象を先に買わない。**再訪の条件は「5 つ目のカタログを作るとき」または「語彙検査の重複が実バグを出したとき」**)。**`guarantee_spec`(2026-09-03)は同じ形の 5 つ目のカタログだが、再訪トリガーは BACKLOG の裁定で `external_spec`(外部連携の仕様化)に引いてあるため、ここでは同型の実物が増えた事実だけ触れる(判断のやり直しはしない)。** **`external_spec`(2026-09-04)は同じ形の 6 本目のカタログであり、ここで引いていた再訪トリガー(`external_spec` の開設)にちょうど到達した。それでも重複はまだ実バグを出していないため、判断は変えない(一般化も共通部分の括り出しもしない)。次の再訪条件は「7 つ目のカタログを作るとき」または「語彙検査の重複が実バグを出したとき」のまま据え置く。**`ux_principles_spec`(2026-10-03)は目録型の 7 つ目にあたり、この再訪条件に到達した。再裁定: 7 つ目でも一般化しない(共通部分の括り出しもしない)。** 理由は、6 つの台帳は項目の意味も検査も違い、共通化で消えるのはフロントマターの読み方だけで、それは `lib/model/decl-list.ts` が既に担っているからである。**次に再訪するのは 8 つ目のカタログを作るとき**。REST エンドポイントと Go 系のバリデータを前提にした語彙であり、現構成では `action_spec`(書き込み)と `query_spec`(読み取り)、および frontend の 3 種が同じ役割を担う。`data_table` は長らく置き場所だけの予約枠だったが、**2026-08-26 に開設済み**(上の backend の表を参照)。

## README.md のルール

- **README.md は常に `doc_type: directory_guide` である。** ディレクトリの案内であって、仕様や規約の定義ではない
- 内容に関する概念説明を README に含めるのは構わないが、それで doc_type を変えない
- **仕様・規約の定義は README ではなく、適切な名前を持つファイルに書く**
- 書式は [docs/template.directory_guide.md](../../../template.directory_guide.md)。頻出の節(すべて任意)は 目的・構成・一覧・参照するもの・関連・テンプレート・整備方針・AI向けナビゲーション
- 迷ったら、**「このディレクトリに何があるか」(一覧 / 構成)と「次にどこを読むか」(関連 / 参照するもの)の 2 つだけ**書けばよい
