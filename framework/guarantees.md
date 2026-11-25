---
doc_type: guarantee_spec
scope: framework
id: framework-guarantee-catalog

vocabulary:
  enforcer:                      # 執行者の語彙(仕組み自身の事情。製品の台帳の語彙とは別に持つ。検査器は分岐しない)
    - id: type_system
      label: TypeScript の型(コンパイルで落ちる)
    - id: pure_function
      label: 純関数に切り出した判定(ユニットテストが実行できる)
    - id: differential_test
      label: 意味の正(TS)と写し(SQL)の差分テスト(fast-check + 実 DB)
    - id: parity_test
      label: 2 か所の写しが過不足なく一致することの突合
    - id: static_scan
      label: 静的走査(ファイルと import を読むテスト。型情報は使わない)
    - id: db_scenario_test
      label: 生成した SQL を実 DB に当て、決めた筋書きどおりの行集合が返ることを確かめる統合テスト

guarantees:
  - id: fw_engine_permit_required
    label: エンジンに聞かずに書けない(FireAllowed の偽造不可)
    enforced_by: [type_system]
    status: enforced
    canaries: [TC-FW-ENGINE-001]
    summary: 状態遷移の許可(FireAllowed)は非公開シンボルで封印されており、構造的に一致するオブジェクトを作っても代入・キャスト・satisfies のいずれでも通らない
  - id: fw_engine_follows_table
    label: 生成した表に無い遷移・作成・削除・編集は許さない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-TABLE-001, TC-FW-TABLE-002, TC-FW-TABLE-003, TC-FW-TABLE-004]
    summary: エンジン(canFire / canCreate / canDelete / canWrite)は渡された表に無いイベント・ロールを deny by default で拒否し、表に無い遷移・作成・削除・編集を許さない
  - id: fw_guard_semantics
    label: ガード式の評価は仕様の意味論どおりにしか成立しない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-GUARD-001]
    summary: ガード評価器は domain-spec-writing.md の演算子・型・評価不能の意味論どおりに成立・不成立・評価不能を判定する
  - id: fw_guard_sql_parity
    label: ガード式とロールの SQL 翻訳は TS の評価器と同じ判定を下す
    enforced_by: [differential_test]
    status: enforced
    canaries: [TC-FW-GUARDSQL-001, TC-FW-GUARDSQL-002]
    summary: 同じ 1 つの宣言を TS の評価器と DB の両方が読むので、ガード式の SQL 翻訳(lib/sql/guard-to-sql.ts)とロールの by の SQL 翻訳(lib/sql/roles-to-sql.ts)は、式と環境を fast-check で振って実 DB の `select <述語>` と TS の判定を突き合わせても一致する(不明 = NULL は両側で不成立に畳まれる)。振るのは boolean を含む全ての欄 × 全ての演算子であり、TS が常に不明にする組(boolean への in / 順序比較)は翻訳器が Result の失敗として断る。text の順序比較の照合順序は翻訳器が `collate "C"` で固定し、実行者のロール集合は implies の推移閉包で閉じたものを渡す
  - id: fw_url_format
    label: "URL の書式(format: url)の文法は、入力スキーマ・表の CHECK・実行時の判定で同じ答えを返し、設定の URL は宣言した scheme に合わない値を例外にする"
    enforced_by: [pure_function, differential_test]
    status: enforced
    canaries: [TC-FW-URL-001, TC-FW-URL-002, TC-FW-URL-003]
    summary: "`format: url` の文法(絶対 URL の http / https だけ。`javascript:` `data:`・スキームの無い綴り・プロトコル相対・ユーザー名つき・空白と制御文字・非 ASCII・長さ 2048 超を通さない)は検証器・生成器の kernel と実行時パッケージ `@kaninabe/runtime/url` の 2 か所に綴られ、受理と拒否の正解表を両方に当てて同じ答えを返す。生成される表の CHECK(`~`)は同じ綴りを Postgres に置くので、正解表の全行で DB と TS が一致することを実 DB で突き合わせる(後読み・括弧内のバックスラッシュなど ARE と JS で揺れうる構文を使わない)。設定の URL は `readConfigUrl` が宣言した scheme(https / 自分の機械への http だけ例外)に合わない値を例外にし、文面に値を出さない。ASVS V1.2.2 / V12.3.1"
  - id: fw_service_secret
    label: "サービスの認証の秘密は、下限に満たない値で口が開かず、固定長要約の比較で照合し、更新の間は新旧どちらも受ける"
    enforced_by: [pure_function, static_scan]
    status: enforced
    canaries: [TC-FW-SECRET-001, TC-FW-SECRET-002, TC-FW-SECRET-003]
    summary: "`@kaninabe/runtime/secret` の `readServiceSecret` は、未設定・空・設定カタログの `strength.min_length` に満たない秘密を「設定されていない」ものとして閉じ(`undefined`)、下限以上の値だけを返す(下限が正の整数でない呼び出しは書き間違いとして例外にし、値は文面に出さない)。照合は `constantTimeEquals`(両辺を SHA-256 にして `timingSafeEqual`。長さが違っても例外にならず、比較は食い違った位置で早く終わらない。入力の長さに時間が依存しないとは主張しない。時間の実測はしていない)で、`matchesAnySecret` は現在の秘密と更新前の秘密(設定カタログの `previous`)の**全部と**比べる(どちらに一致したかを時間に出さない)ので、秘密の更新の間は新旧どちらを付けた呼び出しも受け、どちらでもなければ・受け付ける秘密が無ければ閉じる。受信の署名の検証(`verifyInboundSignature`)も鍵の並びを同じ部品で受ける。設定仕様検証の K6 が、カタログの `strength` を宣言した秘密を実装の木が `readServiceSecret` の関門(本物の import に束縛できる形)で読んでいること・下限がカタログと同じことを見る。ASVS V13.2.3・V11.2.2"
  - id: fw_regexp_escape
    label: 利用者の値を正規表現に入れるときの特殊文字のエスケープ(escapeRegExp)は、値を元の文字列にだけ一致させる
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-REGEXP-001]
    summary: "`@kaninabe/runtime/regexp` の `escapeRegExp` は、正規表現の特殊文字(`\\ ^ $ . * + ? ( ) [ ] { } |` と `/` `-`)をその文字そのものに一致させる。エスケープした値で組んだ `^…$` は、敵対的な値(`(a+)+$`・`.*`・`[a-z]*`・`a|b` など)でも元の文字列にだけ全体一致し、`u` フラグの下でも文字クラスの中でも範囲や量指定に化けない。アプリと仕組みの実行コードで `new RegExp(…)` のパターンに静的でない値を入れる唯一の道で、lint の `layer/no-dynamic-regexp` がこの部品を通した置換だけを通す(ASVS V1.2.9)"
  - id: fw_text_input
    label: 利用者が入力する文字列は、制御文字(改行・復帰・タブ以外の C0・DEL・C1)と対にならない surrogate を持たない(入力スキーマの生成器が文字列の欄を 1 か所で textInput() から始める)
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-TEXTINPUT-001]
    summary: "`@kaninabe/runtime/text-input` の `textInput()` は、`z.string()` に「改行・復帰・タブ以外の C0・DEL・C1・孤立した surrogate を含まない」検査を載せた文字列のスキーマで、`.trim()` `.min()` `.max()` `.regex()` などの鎖はそのまま続けられる。判定は code point で行い(対になった surrogate は 1 字の補助面として通る)、正規化はしない。入力スキーマの生成器は entity_spec の文字列(string / text)の欄を、行にも入力にも、欄ごとの記述なしに 1 か所でこの部品から始める(更新の入力スキーマは行のスキーマから借りるので、行にも要る)。NUL は Postgres の text が拒むため、通すと 500 になる(点検 17 回目 O17-3・18 回目 O18-2)。製品側の見張りは、入力スキーマの文字列の欄の閉じた表と実物の突合・操作の入力スキーマの全部の欄の NUL 拒否・手書きの `z.string(` の禁止(text-input-coverage.test.ts)"
  - id: fw_markdown_sanitize
    label: "書式つきの本文(format: markdown)の描画は、許可リストの外の要素・属性・URL を出力に残さず、描けない本文は例外を投げず素の文に縮退する"
    enforced_by: [pure_function, static_scan]
    status: enforced
    canaries: [TC-FW-MD-001, TC-FW-MD-002, TC-FW-MD-003]
    summary: "`@kaninabe/runtime/markdown` の `renderMarkdown` は、生の HTML を構文木にする時点で捨て、`rehype-sanitize` に**許可リスト**(見出し・段落・改行・強調・削除・コード・整形済み・引用・リスト・区切り線・リンクの要素と、`a[href]`・`ol[start]`・`code[class=language-…]` の属性だけ。画像・表・フォーム・埋め込み・style・id・target・イベント属性は無い)を渡して通し、リンクは `safeHttpUrl`(絶対の http / https・ユーザー名なし)を通ったものだけアンカーとして残して(通らないものは文字だけ)`rel=\"noopener noreferrer\"` を付ける。XSS の定番・符号化の細工(実体参照・タブ・NUL・全角)・入れ子・変異 XSS を表にした敵対的な入力 85 本すべてで、出力が許可リストの外に出ないことを 1 つの検算器(要素・属性・href・要素の外の `<`)で見て、検算器自身が壊した出力で鳴ることも見る。深すぎる入れ子と解釈の天井(`format: markdown` の `max_length` の天井と同じ値)を超える本文は、解釈せず素の文の段落に縮退する(例外を投げない)。`MarkdownView` は `renderMarkdown` の出力だけを `dangerouslySetInnerHTML` に載せる唯一の部品で、引数は Markdown の元の文字列である。書式つきの本文として描く欄が `format: markdown` で宣言されているかは R15(描く口の走査)が見て、アプリのコードの `dangerouslySetInnerHTML` / `innerHTML` などの差し込み口と Markdown を自前で解く部品は ESLint の `layer/no-raw-html` が書けなくする(ASVS V1.3.1・V1.3.5。製品側の見張りは製品の台帳 url_scheme_safe)"
  - id: fw_bearer_value
    label: "持っていれば効く値(bearer)は列の既定値の CSPRNG(32 バイトの base64url)だけが作り、UUID を使わず、URL のパスにも監査ログにも載せず、寿命を宣言する"
    enforced_by: [pure_function, differential_test]
    status: enforced
    canaries: [TC-FW-BEARER-001, TC-FW-BEARER-002, TC-FW-BEARER-003]
    summary: "`bearer` を宣言した欄(`string`・`supplied_by: db`・`max_length` 43 以上)の値は、data_table の `defaults` の式 `translate(encode(gen_random_bytes(32), 'base64'::text), '+/='::text, '-_'::text)`(pgcrypto の CSPRNG の 32 バイト = 256 ビットを base64url の 43 字にしたもの)だけが作る。R16 は、`defaults` の式がこの綴りでない(UUID の式を含む)・`defaults` が無い・表の関数が値を引数(`p_{欄}` / `p_new_{欄}`)で受ける・画面の route の動的セグメントが欄を名指す(`:code` / `:{集約}_{欄}`)・寿命の宣言(`expires_at` と `used_at` の datetime の欄、または理由つきの `reusable`)が欠ける・名指した欄が実在しないか datetime でない、のどれも error にし、`reusable` は毎回 warning(受け入れた危険)で名指す。実 DB で式を 1,000 回評価して、43 字・base64url の文字だけ・重複なしを見て、`pg_get_expr` が返す綴りが宣言の綴りと一致することを突き合わせる。生成する作成の RPC は `bearer` の欄を監査ログ(`domain_events.payload`)に載せず(`redacted` にも載せない)、外部連携が `bearer` の欄を送ることは X7 が止める(ASVS V11.5.1・V14.2.1・V6.4.1)"
  - id: fw_neutralize_outbound
    label: "外へ送る自由文は、外部連携の宣言(sends.neutralize)した無害化の部品を通って送られ、部品は敵対的な本文でも危ない文脈へ値を渡さない"
    enforced_by: [pure_function, static_scan]
    status: enforced
    canaries: [TC-FW-NEUTRALIZE-001, TC-FW-NEUTRALIZE-002]
    summary: "`@kaninabe/runtime/neutralize` の `neutralizeDiscordMentions`(`@everyone` / `@here` / `<@…>` の綴りを壊す)・`allowedDiscordMentionsOf`(呼んでよい相手をアダプタ自身が先頭に置いたメンションだけに絞る)・`stripControlChars`(改行・タブ・復帰以外の制御文字を除く)・`clampLength`(長さを上限に収める。サロゲートペアを割らない)は、効く型と触らない型を表で固定する。外部連携カタログの行は `sends.neutralize`(部品の宣言。`discord_mentions` / `control_chars` / `length:N`)か `sends.neutralize_none`(理由つき)を宣言し、X7 が、宣言した部品を手書きのアダプタが `@kaninabe/runtime/neutralize` の import に束縛された呼び出しで呼んでいること(`length:N` は第 2 引数が同じ数のリテラル)・`neutralize_none` なのに利用者が書ける文字列の欄を送っていないことを突き合わせる(ASVS V1.3.3)"
  - id: fw_engine_table_sanity
    label: 到達不能・行き止まり・非決定な遷移表はランタイムでも検出される
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-SANITY-001]
    summary: 遷移表の健全性(到達性・行き止まり・終端不変・決定性)は生成時だけでなくランタイムでも assertValidTable が検証する(既知解テストの初実物)
  - id: fw_refusal_maps_to_action_error
    label: エンジンの拒否理由は実装が文言を組み立てず、決まったエラーの種類へ写る
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-REFUSAL-001]
    summary: canFire / canCreate の拒否は toActionError / toCreateActionError が ActionError の 3 分類(guard_unsatisfied / forbidden / invariant_violated)へ機械的に写し、実装が理由文を独自に組み立てる箇所を持たない
  - id: fw_run_plan_outcome
    label: 実行器は書き込みの結末（コミットの状態・拒否の分類）を取りこぼさず、運ぶ値を変えない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-RUNPLAN-001, TC-FW-RUNPLAN-002, TC-FW-RUNPLAN-003, TC-FW-RUNPLAN-004, TC-FW-RUNPLAN-005, TC-FW-RUNPLAN-006, TC-FW-RUNPLAN-007, TC-FW-RUNPLAN-008, TC-FW-RUNPLAN-009]
    summary: 実行計画の実行器(run-plan)は、引数の供給元をいくつ並べても引数の順序と JSON が旧い実装と一致し、運ぶ値の正規化は正当な値の JSON を変えない(Date は ISO 8601・欄の undefined は鍵ごと運ばない)。通信の失敗・想定外の失敗は、コミットの状態を欄に残した DbInfrastructureError として投げ(ポートは 1 回だけ呼ぶ)、再送の読み直しでも outbox は unknown のままで「積んだ」と言わない。拒否の SQLSTATE は分類の語に写り、本文の接頭辞の後ろから落ちた操作の ID を取る。冪等キーは画面の実行器が送る送信の意図の鍵(UUID の形のときだけ。押し直しで同じ値)を使い、無ければ 1 呼び出しに 1 回作る。生成した Server Action は DB の失敗(DbInfrastructureError)を例外の境界の手前で書けたかどうか(not_committed / unknown)つきの一時的な失敗の値にし、それ以外の例外は投げ直す(点検 20 回目 B20-1)
  - id: fw_role_row_condition
    label: 実行者の行の条件(claim の値の集合・含意の先の条件)を満たさない実行者には、先読みもオラクルも役を立てない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-ROLECLAIM-001, TC-FW-ROLECLAIM-002, TC-FW-ROLECLAIM-003, TC-FW-ROLECLAIM-004, TC-FW-ROLECLAIM-005, TC-FW-ROLECLAIM-006, TC-FW-ROLECLAIM-007]
    summary: 既定のログインロールが行の条件(state / enum の欄が値の集合のどれか)を併記していれば、先読み(ロール解決の表)は行があるだけでは既定のロールを立てず、満たさない実行者は未ログインと同じロールになる。claim を持つロールを含意するロールは、束縛や配列から立っていても含意の先の条件を満たさなければ立たない(DB の述語 `自分の根拠 AND 含意の先の行の条件` の写し)。値の集合の claim は集合に入る値のときだけ立ち、boolean の claim は従来どおり真のときだけ立つ。RLS のオラクルも同じ規則で期待を計算する。セッションの写しは遅れうるので先読みは甘い側に外れうるが、権威は DB の述語である
  - id: fw_runtime_dependency_closed
    label: runtime の核はベンダーの依存もサーバー専用の印も持たず、ベンダー依存は adapters にだけ住み、依存は adapter → runtime の一方通行
    enforced_by: [static_scan]
    status: enforced
    canaries: [TC-FW-CLOSURE-001, TC-FW-CLOSURE-002]
    summary: 実行時パッケージ(`@kaninabe/runtime`)の宣言した依存にも配布するソースの import にも @supabase / PostgREST / server-only が無く、DB への口は中立のポートである。runtime の核(framework/runtime)はベンダーの依存(@supabase など)を持たず、ベンダー依存は adapters(framework/adapters/*)にだけ住む。依存は adapter → runtime の一方通行で、どの adapter もサーバー専用の印を持たない。PostgREST の adapter は @supabase も持たず(接続層は製品が渡す)、認証基盤ごとの adapter はその認証基盤のライブラリに依存してよい(静的な import の閉包を読む。配布物ではなくソースが正)
  - id: fw_refusal_codes_parity
    label: 拒否の分類の語は検証器・生成器と実行時パッケージで 1 つである
    enforced_by: [parity_test]
    status: enforced
    canaries: [TC-FW-REFUSALCODES-001, TC-FW-REFUSALCODES-002]
    summary: errcode と接頭辞の組、およびエンジンの拒否理由 → errcode の写像が、検証器・生成器の側(lib/sql/refusal-codes.ts。生成される plpgsql が使う)と実行時パッケージの側(refusal-codes.ts。実行時側の唯一の写し)で過不足なく一致する。ずれると「DB は 403 のつもり・アプリは競合と読む」が黙って作れる
  - id: fw_form_refresh_pure
    label: refresh で届いた他者の変更を、触っていない欄の再送で上書きしない判定は純関数として成り立つ
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-FORMREFRESH-001, TC-FW-FORMREFRESH-002, TC-FW-FORMREFRESH-003, TC-FW-FORMREFRESH-004, TC-FW-FORMREFRESH-005, TC-FW-FORMREFRESH-006]
    summary: 編集フォームの下書きを baseline との差で決める純関数(`reconcileFormDraft` / `changedFields` / `acceptSaved` / `held`)は、触っていない欄は最新へ追従し、触った欄は手元を守り、両方が変えた欄は競合として残して黙って解決しない。自分の保存の直後の refresh は競合にせず、保存してから最新が届くまでの旧い props での再描画でも欄は旧い値に戻らない。2 欄の全状態の列挙（729 通り）で、触っていない欄は dirty にならず、競合の集合は定義どおりで、冪等で、入力を書き換えない。画面がその判定を使っていること(配線)は製品の台帳の見張りテストが見る
  - id: fw_tenant_boundary_reads_actor_row
    label: テナント境界の RLS は実行者の行で判定し、親の列で書いた境界も他社の行を返さない
    enforced_by: [db_scenario_test, pure_function]
    status: enforced
    canaries: [TC-FW-TENANTRLS-001, TC-FW-TENANTRLS-002, TC-FW-TENANTRLS-003, TC-FW-TENANTRLS-004]
    summary: reads[].filters の右辺 actor.{欄} は、生成した RLS の中で security definer の補助関数 public.actor_{欄}() が実行者自身の行から読む(トークンの属性の写しは読まない)。だから運営が所属を付け替えたあとは、写しが古いトークンでも元のテナントの行を読めない。左辺に context で 2 段まで辿れる親の列({集約}.{列})を書いた境界は、参照の鎖をスカラー副問い合わせで辿って比べ、テナントの列を持たない子表でも他のテナントの行を返さない。実行者の集約そのものに境界を書いた表も、補助関数が所有者の権限で読むので再帰しない。生成する RLS の挙動テストのオラクルも同じ正(参照列の鎖を実 DB の行で辿り、実行者の行の欄と比べる)で期待を計算する
  - id: fw_browser_defense
    label: ブラウザ側の守りの組み方は、要求ごとの推測できない nonce と、出どころの確かめられない状態を変える要求の拒否から外れない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-BROWSER-001, TC-FW-BROWSER-002, TC-FW-BROWSER-003, TC-FW-BROWSER-004, TC-FW-BROWSER-005, TC-FW-BROWSER-006, TC-FW-BROWSER-007, TC-FW-BROWSER-008]
    summary: 実行時パッケージの `@kaninabe/runtime/http` は、文書の CSP の nonce を暗号論的な乱数 16 バイトで要求ごとに作り(UUID は使わない)、宣言した指令にだけ差し込み、開発中の源を本番に載せない。状態を変える要求は Sec-Fetch-Site の same-origin と、スキームとホストの両方が自分のオリジン(ホストは X-Forwarded-Host の先頭か Host、スキームは X-Forwarded-Proto の先頭か要求の URL)に一致する Origin の両方が揃ったときだけ通し、片方でも欠ければ理由を書かない 403 で閉じる(Next.js が Origin の無い Server Action を警告だけで通す分を足す)。進ませる文書の要求には同じ nonce の CSP を要求と応答の両方に載せ、応答にキャッシュの禁止を付ける。ログアウトの応答は Clear-Site-Data と no-store を付ける。生成した見張りテストが使う観測の道具(`@kaninabe/runtime/testing/http/route-isolation`)は、関門を後置した実装・関門の結果を捨てる実装・コメントに書いただけの実装・先に本文や外部に触れる実装を「閉じていない」と判定する(負例で固定。TC-FW-BROWSER-008)。値(どのヘッダを付けるか)はアプリの枠の後段の宣言が持ち、床を下回る宣言は後段の選択の契約が止める
  - id: fw_response_charset_and_safe_fetch
    label: 本文のある応答は charset つきの Content-Type で出て、外の URL を呼ぶ fetch は転送について行かない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-HTTPPARTS-001, TC-FW-HTTPPARTS-002, TC-FW-HTTPPARTS-003]
    summary: 実行時パッケージの `@kaninabe/runtime/http/response` の `jsonResponse` / `textResponse` は、本文のある応答の `Content-Type` を常に `application/json; charset=utf-8` / `text/plain; charset=utf-8` に決める(呼び出し側が別の値を渡しても上書きし、ステータスとほかのヘッダは残す。JSON にならない値は TypeError)。`@kaninabe/runtime/http/safe-fetch` の `safeFetch` は `redirect` を `"error"` に固定し(呼び出し側は変えられない・`Request` を渡しても勝つ)、実物のサーバーが 3xx を返しても転送先に届かず TypeError で失敗する(素の fetch は同じ呼び先でついて行く対照つき)。この 2 つを使わない書き方(`Response.json`・charset の無い本文つき `new Response`・グローバルの `fetch`)の禁止は、製品の台帳の response_charset_set と outbound_no_redirect が見る
  - id: fw_safe_redirect_parts
    label: 安全な転送の部品は、外のオリジンへ出る行き先を転送・遷移に渡さない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-SAFEREDIRECT-001, TC-FW-SAFEREDIRECT-002, TC-FW-SAFEREDIRECT-003, TC-FW-SAFEREDIRECT-004]
    summary: 転送を作れる仕組みの部品は 3 つ —— Route Handler の応答の `safeRedirectResponse`(`@kaninabe/runtime/http/redirect`)・サーバーの転送の `safeRedirect`(`@kaninabe/runtime/navigation`)・クライアントの遷移の `useSafeNavigate`(`@kaninabe/runtime/navigation/client`。push / replace / assign / refresh)。どれも行き先を核の `safeReturnPathOr`(`@kaninabe/runtime/url`)に通し、同じオリジンの相対パス(`/` で始まり、`//`・`/\`・スキーム・制御文字・正規化で `//` に畳まれる綴りでない)だけを `Location` / 転送の合図 / ルーターに渡す。通らない値は書いた人が決めた既定の行き先に置き換わり、既定の行き先も通らなければ例外にする(外へは倒さない)。`safeRedirectResponse` は呼び出し側の見出しの `Location` を決め直し `Refresh` を消す。**Route Handler の出口の関所 `guardRoute`**(`@kaninabe/runtime/http/route-guard`。点検 10 回目 B10-1)は、包んだ口が返した応答の `Location`(大文字小文字を問わない。組み方を問わない)が同じオリジンの相対パスでも宣言した外のオリジン(完全なオリジンの閉じた表。要るときにだけ読む)の絶対 URL でもなければ、口の応答を捨てて行き先・本文・応答に載った `Set-Cookie` の無い 500(`no-store`)を返し、セキュリティログに値を載せない `redirect_refused` を 1 行書く(`next/headers` の `cookies()` の書き込みは Next.js が後から足すので残る)。`Refresh` は値に関係なく止め、口が投げた転送の合図(`NEXT_REDIRECT`)の行き先も同じ判定に通す。応答の `Content-Type` は閉じた表(`application/json`・`text/plain`)だけを通し、表の外の型は口が理由つきで宣言したダウンロードの型(実行しない型の閉じた表)をダウンロードの見出し(`attachment`)つきで出すときだけ通す。ほかは同じ 500 と `response_type_refused` にする。包んだ口は `isGuardedRoute` が真になる(モジュールを読み込み直しても同じ印)。セッションの adapter の生の転送の部品は公開の入口から出さず、ログアウトとサインインの失敗の着地は同じ判定に通らなければ例外、サインインの開始は認証基盤のオリジンでない認可の URL を失敗の着地に倒す。製品のコードから生の転送の口を止めるのは製品の台帳の url_scheme_safe(ESLint の `layer/require-safe-redirect` と、全部の口を包むことの J2)が見る
  - id: fw_function_acl_closing_runs_on_empty_plan
    label: 関数の実行権限を閉じる migration は、呼べる側も必須の作成主体も空の計画でも型の解決で止まらずに流れる
    enforced_by: [db_scenario_test]
    status: enforced
    canaries: [TC-FW-FNACL-001]
    summary: 公開面を外へ出す能力が無く RLS 補助関数も無い構成では、面のロールから呼べる関数の宣言が空になり、必須の作成主体も空でありうる。生成器は宣言の配列・作成主体の並び・剥奪するロールの並びを空でも型の決まる text[] で出し、先頭の欠けた並び(array[, …])を出さないので、その計画から生成した migration は実 DB で流れる。型の付与だけを外した同じ SQL は要素の型が決まらず止まる(42P18)ことを対照にして、空の緑でないことを固定する
  - id: fw_session_cookie_policy
    label: 認証の cookie は全部が __Host- の HttpOnly・Secure・SameSite=Lax で書かれ、開始とログアウトの口は出どころを確かめる
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-SESSIONCOOKIE-001, TC-FW-SESSIONCOOKIE-002]
    summary: "セッションの adapter(`framework/adapters/supabase-session`)が書く cookie と消す cookie(セッションとその分割・PKCE の検証子・サインインの往復で運ぶ値)は、ライブラリが渡した属性の寿命だけを拾い、名前は `__Host-` で、`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`・`Domain` なしに上書きされる(書き手は adapter の中にしか居ない)。PKCE の検証子はライブラリの既定(400 日)ではなく 10 分で切れる。移行前の既定の名前(`sb-{ref}-auth-token`)の残りも同じ属性で消す。サインインの開始とログアウトの口は、`Sec-Fetch-Site: same-origin` と自分のホストに一致する `Origin` の両方が無ければ 403 で、cookie を書かずセッションも閉じない。ログアウトの範囲はこの端末だけ(`scope=local`)で、認証基盤への問い合わせが失敗しても認証の cookie は全部消し、`Clear-Site-Data` を返す。製品のコードがこの形を崩す書き方(ブラウザの認証基盤のクライアント・`document.cookie`・トークンの欄の読み取り)の禁止は、製品の台帳の session_tokens_server_only が見る"
  - id: fw_mfa_write_boundary
    label: 多要素認証を要求するロールの実行者は、多要素認証を済ませていないセッションでは書き込みの入口を通れない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-MFA-001, TC-FW-MFA-002, TC-FW-MFA-003, TC-FW-MFA-004, TC-FW-MFA-005, TC-FW-MFA-006, TC-FW-MFA-007, TC-FW-MFA-008, TC-FW-MFA-009, TC-FW-MFA-010]
    summary: "認証フロー仕様が多要素認証を要求すると、生成された束(`runtime-bindings.ts` の `mfa`)が範囲(全員 / ロールの一覧)を運び、生成された Server Action はセッションが多要素認証を済ませたか(Supabase なら署名を確かめたクレームの `aal` が `aal2`。adapter の `sessionMfaVerified`)を解決して実行器へ渡す。実行器(run-plan)は判断と書き込みの前に、要求するロールが判断に立つサインインした実行者のセッションが済ませていなければ `forbidden`(印 `mfaRequired: true`)で返し、事実の読み取りも RPC の呼び出しもしない。範囲が全員なら対象の有無を読む前に止める。済ませたかを渡されなかった呼び出しは済ませていないとして扱う。内部実行(system の入口)・未ログイン・要求の対象外のロールの操作・要求を宣言しない製品は何も変わらない。実行器を通らない `runner: manual` の操作の手書きの Server Action は、同じ判定を `@kaninabe/runtime/template/mfa` の `refuseUnverifiedMfa`(呼び手が解いたロールを受ける口)で引く(呼んでいることは verify の H6 が構文木で見る)。cookie で認証する有料の口(Route Handler)も実行器を通らないので、共通の入口 `runPaidEntry`(`@kaninabe/runtime/http/paid-entry`)が認可の直後・本文を読む前に同じ判定を引き、済ませていないセッションは 403(`mfa_required`。事象は `mfa_refused`)で、本文を読まず・枠を消費せず・有料の処理を呼ばない(要求しない製品は変わらず、セッションの解決も引かない。解決を渡さない・投げるときは済ませていないとして止める)。口が生成した束と役を渡していることは製品側の検査 X8 が構文木で見る"
  - id: fw_security_log
    label: 拒否・認証・出どころの確認のログは、閉じた欄の ID と判断だけを 1 行で出し、個人の値を載せない
    enforced_by: [pure_function, type_system]
    status: enforced
    canaries: [TC-FW-SECLOG-001, TC-FW-SECLOG-002, TC-FW-SECLOG-003, TC-FW-SECLOG-004]
    summary: "実行時パッケージの `@kaninabe/runtime/security-log` は、Server Action の拒否(権限・多要素認証・入力・状態・ガード・不変条件の 6 つに割った事象)・サインインの開始と帰り道とログアウト・出どころを確かめられなかった要求を、事象の目録(`SECURITY_EVENTS`)の ID を持つ 1 行で出す(V16.3.1〜V16.3.3)。行は閉じた欄(`LogRecord` と `LOG_FIELDS` が型で 1 対 1)だけで、入力値・理由文・ロール ID・指摘のフィールド名・メールアドレス・トークン・cookie・経路を載せる欄も、受け取る口も無い。要求の識別子は形の合うヘッダだけを読み、配置先が付け直す `x-vercel-id` を利用者が送れる `x-request-id` より先に読む(行の偽造と肥大、ログの突き合わせを断たれることを防ぐ)。生成された Server Action は実行者をパースより先に解いて拒否を記録し、`runner: manual` の手書きの入口は verify の H7 が構文木で同じ形を見る。ログの保管先・保管日数・読める人の目録は設定カタログの `logging` が宣言し(K5)、転送先が本番で有効かは検査から見えないので毎回未検証と名指す"

  - id: fw_log_sink_optional
    label: ログのホストの外への転送はオプトインで、送れなくてもアプリを止めず、失敗の行にトークンも本文も載らない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-LOGSINK-001, TC-FW-LOGSINK-002, TC-FW-LOGSINK-003]
    summary: "実行時パッケージの `@kaninabe/runtime/log-sink` は、セキュリティの事象の行を標準出力に先に出したうえで、送り先(中立の `LogSink`。Axiom の綴りは adapter `@kaninabe/adapter-log-axiom` が持つ)が渡されたときだけ、応答の後に同じ瞬間の分を 1 回にまとめて送る(V16.4.3)。送り先が無ければ標準出力の口がそのまま返り、送る処理は 1 行も走らない(鍵が設定されたときだけ有効になるオプトイン。配線は製品の `composition/log-sink.ts`)。送り先が投げても・予約が投げても・失敗の行を出す口が投げても `write` は例外を出さず、失敗は理由の閉じた語(`misconfigured` / `unauthorized` / `rate_limited` / `rejected` / `server_error` / `timeout` / `network`)1 つだけの 1 行で名指し、トークン・行の中身・例外の文言は載せない。送る行は `LogRecord` のまま(欄を足さない)。adapter は送り先を `axiom.co` 配下に縛り、転送について行かず、3 秒で打ち切る。設定カタログの `logging.sink` は送り方と鍵の環境変数名を宣言し、K5 が、本番の置き場を宣言した製品にだけ転送先を求める(外す製品は理由つきの受け入れた危険として毎回名指す)"
  - id: fw_session_end_declared
    label: アカウントを止める遷移はセッションを終える効果を宣言し、生成する遷移の RPC は同じトランザクションで認証基盤を呼ぶ
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-SESSIONEND-001, TC-FW-SESSIONEND-002]
    summary: "認証フローの主語が状態機械のとき、終端の状態・`tone: negative` の状態へ行く遷移と、主語を匿名化する遷移は、ジョブカタログの `ends_sessions` の効果を `effects` に宣言していなければ J7 が error にする(効果が 1 本も宣言されていない製品でも。一時停止には求めない)。宣言は認証フローの主語の集約を指し、その状態機械の `effects` から積まれ、書き込みと同一トランザクションで実現される語で、`platform_call`(認証基盤の呼び出しを本文に持つ RPC。引数は uuid 1 つ)を名指しする。`realized_by` の RPC がそれを `calls` に宣言することは T19 が見る。生成する遷移の RPC は、効果を載せたイベントの `p_event_id` のときだけ、遷移と同じトランザクションの中で `platform_call` を呼ぶ本文になる(認証基盤の綴りは呼び先の本文に閉じ、生成物に出ない)。保証の範囲: 行を消した時点で `getUser` と更新は失敗し、発行済みのアクセストークンを PostgREST に直接使う経路も、全ての表の制限ポリシーが閉じる(fw_session_alive_rls)"
  - id: fw_logout_visible
    label: 認証の要る全画面が、ログアウトの遷移を持つ共有クロームを被る
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-LOGOUT-001]
    summary: "認証フロー仕様が `logout` を宣言したなら、`control`(ログアウトの操作の名前。共有クロームの `navigations[].on`)も宣言し、`requires_auth` の全画面がその遷移を持つ共有クロームを被る。被っていない画面は H8 が画面ごとに error にする(画面が自分で書いた同名の遷移は数えない)。見えることまでを見る — 押したら本当にログアウトするかは実装の木の見張りテストと E2E が持つ"
  - id: fw_session_server_validated
    label: セッションが生きているかの確かめは、署名を確かめただけのクレームではなく認証基盤への問い合わせを通る
    enforced_by: [pure_function, static_scan]
    status: enforced
    canaries: [TC-FW-SESSIONVALID-001, TC-FW-SESSIONVALID-002]
    summary: "非対称の署名鍵ではクレームの検証が手元で終わり、セッションが終わった(ログアウト・無効化・全端末の終了)あともアクセストークンの期限まで署名は有効なままである。セッションの adapter の `sessionMfaVerified` は `aal2` を信じる前に `getUser`(認証基盤への問い合わせ)でセッションの存在を確かめ、終わっていれば済ませていないと答える。製品の実装とセッションの adapter は cookie から読んだだけの値(`getSession`)を使わず、署名だけを確かめるクレーム(`getClaims`)の読み取りは許可した 3 か所(多要素認証の水準・ログアウトの記録の実行者・いまの端末のセッション ID)だけにある。実行者の解決は `getUser` で行う。保証の範囲: 発行済みのアクセストークンを PostgREST に直接使う経路は、全ての表の制限ポリシーが「セッションの行が実在する」ことを要求して閉じる(fw_session_alive_rls)"
  - id: fw_session_admin_ops
    label: セッションの管理(一覧・終える)は欄を絞って返し、ID の形を確かめてから呼ぶ
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-SESSIONADMIN-001]
    summary: "セッションの adapter の `createSessionAdmin` は、メンバーのセッションの一覧(id・作成時刻・最後に使った時刻・User-Agent・IP だけ。RPC がほかの列を返しても通さない)・1 本終える・自分以外を終える・メンバーの全部を終える・全員を終える(除外は 1 人まで)を、特権 RPC の呼び出しとして持つ。ID が UUID の形でなければ呼ぶ前に落とし、認証基盤の応答は失敗の理由に載せない。メンバー ID を本人のセッションから導くのは呼ぶ側(製品の配線)の責務で、実 DB での挙動は製品の保証 `session_management` が見る"
  - id: fw_session_alive_rls
    label: 全ての表の RLS の migration が、ログインセッションの生死を要求する制限ポリシーを持ち、判定の関数は持ち主の権限・空の search_path で認証基盤のセッションの表を引く
    enforced_by: [pure_function, static_scan]
    status: enforced
    canaries: [TC-FW-SESSIONALIVE-001, TC-FW-SESSIONALIVE-002, TC-FW-SESSIONALIVE-003]
    summary: "署名として有効なアクセストークンは、ログアウト・強制終了でセッションが終わった後も期限(既定 1 時間)まで残る。生成する RLS の migration は、表ごとに制限ポリシー `{表}_session_alive`(`as restrictive`・ログイン済みのロール宛て・`using ((select <土台のスキーマ>.session_alive()))`)を 1 本出し、許可ポリシーが何本あっても・何も無くても論理積になる(未ログインのロールには掛からない)。土台の関数 `session_alive` はプラットフォームの設定の `sessionAliveExpr`(トークンが運ぶセッションの識別子が認証基盤のセッションの表に実在し、期限内であること。識別子が無ければ偽)を `security definer`・空の `search_path` の関数に包み、実 DB の定義と権限まで期待表(api-expectations)が突き合わせる。期待ポリシー表は制限ポリシーを全数に含めるので、無い表・余分な表は policy-parity が落とす。保証の範囲: 止まるのは表の行の取得で、終了の確定より後に始まった要求から効く(期限の比較は `now()`、見え方は要求のトランザクションのスナップショット。走行中の 1 要求は開始時点の見え方で答えうる)。ログイン済みのロールが呼べる補助関数(実行者の解決・隠し列の述語)は例外として閉じたセッションでも答える — 表の行は返さないが、隠し列の述語の真偽は渡した行と本人の関係のオラクルとして残る(製品の保証 session_tokens_server_only が実 DB で見る)"
  - id: fw_platform_op_result
    label: 認証基盤の操作(platform_ops)の拒否は 3 種だけで、画面の文言は仕様の表から引き、記録には理由の語も入力値も載らない
    enforced_by: [pure_function]
    status: enforced
    canaries: [TC-FW-PLATFORMOP-001]
    summary: "実行時パッケージの `@kaninabe/runtime/platform-op` は、認証基盤の操作の戻り値を成功か拒否 3 種(入力の検証・多要素認証・配線先が宣言した理由)に限る。画面に出す文言は仕様(`platform_ports` の `refusals`)の表から引き、宣言に無い理由は理由の語を出さず一般の文言にする。拒否の記録(`recordRefusal`)に載せる写しは分類と操作 ID だけで、理由の語も入力値も載せない。生成した入口・組み立ての根・画面の部品の関門の順序と対応表の整合は、製品側の検査 H9 と生成テストが見る"
  - id: fw_paid_entry
    label: 有料の口(呼び出しごとにお金を使う連携を呼ぶ Route Handler)は、認可 → 多要素認証 → 本文の上限 → 形の検査 → 枠の消費 → 有料の処理 の順を共通の入口が持ち、本文は上限を超えて読まず、枠は課金の前に消費する
    enforced_by: [pure_function, static_scan]
    status: enforced
    canaries: [TC-FW-PAIDENTRY-001, TC-FW-PAIDENTRY-002, TC-FW-PAIDENTRY-003, TC-FW-PAIDENTRY-004, TC-FW-PAIDENTRY-005, TC-FW-PAIDENTRY-006, TC-FW-PAIDENTRY-007, TC-FW-PAIDENTRY-008, TC-FW-PAIDENTRY-009]
    summary: "実行時パッケージの `@kaninabe/runtime/http/paid-entry` の `runPaidEntry` は、有料の口の順序を 1 か所で持つ(V2.4.1・V15.2.2)。①認可(未ログインは 401・宣言した役を持たない人は 403。本文は 1 バイトも読まない)①b多要素認証(要求する製品で、済ませていないセッションは 403。本文は読まず、枠も消費せず、有料の処理も呼ばない。保証 fw_mfa_write_boundary)②本文の上限(`Content-Length` が上限を超えていれば読まずに 413。無い・偽っているときは読みながら数え、超えた最初の塊で打ち切って溜めない)③形の検査(壊れた JSON・UTF-8 でない本文・本文なし・形の不正は 400。枠は消費しない)④枠の消費(使い切りは 429・DB が役を持たない実行者を拒めば 403。有料の処理の前)⑤有料の処理(ここまで来たときだけ)。拒否は既存の事象の目録(`authz_refused` / `mfa_refused` / `input_rejected` / `invariant_refused`)で 1 行ずつ残り、入力・経路を載せない。上限が 1 以上の整数でなければ TypeError(上限のない口を作らない)。応答の本文は固定の語だけ。口がこの入口を実際の import で使い、上限・役を生成した定数表から読み、有料の連携に届く束縛を `handler` の中でしか使わないことと、枠を消費する RPC が役を DB の行で確かめて原子的に消費することは、製品側の検査 X8 が構文木と migration の本文で見る(口の宣言は R5-7)。形の許可表の外で開いた口も落とすため、製品の口を実物のまま叩く見張りテスト(未ログイン 401・役を持たない人 403 で、本文・枠の RPC・書き込み・有料の宛先に触れない)を生成する。その観測の道具(`@kaninabe/runtime/testing/http/paid-gate`)は、役を捨てる認可・meter を呼ばない消費の口を「閉じていない」と判定する(負例で固定。TC-FW-PAIDENTRY-009)"
  - id: fw_connection_path_closed
    label: 枠の adapter の公開の口は、どれもやり直しの口を通らない生の rpc・schema・表の書き込みを返さず受け取らず、生の口の型は外から名指せない
    enforced_by: [type_system, static_scan]
    status: enforced
    canaries: [TC-FW-CONNPATH-001, TC-FW-CONNPATH-002, TC-FW-CONNPATH-003, TC-FW-CONNPATH-004, TC-FW-CONNPATH-005, TC-FW-CONNPATH-006, TC-FW-CONNPATH-007]
    summary: "RPC と表の書き込みの道は、やり直しの口(`@kaninabe/adapter-postgrest` の `retryRollbacks` / `retryTableWrites`)が返した型の印つきの口(`RpcSource`・`TableWriteSource`・手書きの口 `HandwrittenRpc`)だけである(掴む順の手書きの本文はこの前提でやり直しに頼る)。`framework/adapters/*` の全部の adapter は `src/__tests__/public-surface.test.ts` に公開の口の閉じた表を持ち、照らし(`@kaninabe/adapter-postgrest/testing/closed-surface`)が TypeScript の型検査器で `package.json` の `exports` の全部の鍵(文字列の入口・`test` 条件の無い `types` / `import` / `require` / `default`・入れ子の条件も型検査器と同じ順に解く。`./testing/` の入口も外さない。解けない鍵 —— `*` の入口・型のファイルを指さない・ファイルが無い —— は赤)の全部の口(値と型)を数えて、表と両方向で一致すること・各口の型を型検査器で全部の多重定義の引数と戻り値・構築子・欄(export したクラスは継承の先から届く `protected` の欄も。`private` と `#名前` は外から届かないので外す)・添字まで上限の深さ(12 段。循環は 1 回で止まる)までたどり(型引数を持つ口は、表が書いた型引数の型と、宣言の型を型の引数の制約の上限で読んだものの両方。標準の型は TypeScript の lib と Node の実行時の型で、型引数だけをたどる)、たどった先の各型を規則 `RawPathRule`(`rpc` か `schema` の関数を持つのに型の印が無い・`from` のどれか 1 本の多重定義が `select` と書き換えのメソッドを返す・口とその直下が渡す `any`)に掛けて 1 つも当たらないことを見る。上限でまだ奥に関数が続く型・型検査器が解けない型・制約の上限を解けない条件型・どの段でも口が渡す `any` は「読み切れない」として赤で、表の `UnreadAddresses` の理由つきの行(住所 → 理由。当たる住所の無い行も赤)と、宣言の行 `UnreadDeclarations`(`パッケージ/ファイル#名前` → 理由。置き場まで照らし、同じ名前の別の宣言は受けない。受けるのはその宣言の中に書かれた欄・添字・引数・戻り値の奥だけ。当たらない行も赤)だけが受ける(どちらの行の中でも生の道は名指す)。セッションの adapter の行は Realtime(チャンネルとソケットの再帰の型)・Storage・読み取りの組み立て `from().select()`(絞り込みのたびに型引数が育つ再帰の型)・Edge Functions の `functions.invoke().error`(`any`)の 7 住所 × 接続層の形 2 つと、認証基盤の SDK の利用者・ID の情報の袋 `{ [key: string]: any }` の宣言 6 つ(`@supabase/auth-js` の `UserMetadata`・`UserAppMetadata`・`UserIdentity`・`JwtPayload`・`Pagination`・`CustomOAuthProvider`)で、`auth` のほかの所は行無しで底まで読み切れて生の道に届かない。Axiom の adapter は行を持たない。生の口の型(`RawRpc` / `RawTableWrite`)は入口が出さず、`exports` の名指しが深い住所を開かず、やり直しの口の入力の型は `object` なので、公開の口の型から生の形を引き出す道も無い(`as` で戻そうとしても名前が無い)。接続層に触る adapter は探り(`src/__tests__/surface-probe.ts`)を持ち、素通りの書き方の各行が書いた番号の型の誤りだけで落ちる(TS2305・TS2307・TS2694・TS2741・TS2345・TS2339)。保証の範囲: 構造の型を `as unknown as` で作り直す道(TypeScript の型では閉じられない)・製品が自分で `@supabase/supabase-js` を import して作る生のクライアント(製品の接続層の型が枠の読み取りだけの型であることは製品の台帳 TC-GUAR-RETRY-002/003 が見る)・表の `UnreadAddresses` の行が受けた住所の奥の、上限より深い所"
test_cases:
  - id: TC-FW-CLOSURE-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/runtime-dependency-closure.test.ts::runtime の宣言した依存にも、配布するソースの import にも、@supabase / PostgREST / server-only が 1 つも無い

  - id: TC-FW-CLOSURE-002
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/runtime-dependency-closure.test.ts::runtime の核はベンダーの依存(@supabase など)を持たず、ベンダー依存は adapters にだけ住む。依存は adapter → runtime の一方通行で、PostgREST の adapter は @supabase / server-only を持たない

  - id: TC-FW-ENGINE-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/engine/__tests__/fire-allowed.test.ts::遷移の中身を並べただけのオブジェクトは FireAllowed として代入できない"

  - id: TC-FW-FNACL-001
    type: integration
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/function-acl-empty-plan.integration.test.ts::呼べる側も必須の作成主体も空の計画から生成した SQL は、型の解決で止まらずに流れる(対照: 型の付与を外すと止まる)"

  - id: TC-FW-FORMREFRESH-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/form-refresh.test.ts::旧い判定は触っていない欄を送り、新しい判定は触った欄だけを送る

  - id: TC-FW-FORMREFRESH-002
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/form-refresh.test.ts::手元も最新も変えた欄は競合として残り、何度 refresh しても黙って解決しない

  - id: TC-FW-FORMREFRESH-003
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/form-refresh.test.ts::保存 → 追加入力 → refresh が届いても、自分の保存は競合にならず追加入力は残る

  - id: TC-FW-FORMREFRESH-004
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/form-refresh.test.ts::最新を取ると、手元の編集を捨てて最新になり、変更も競合も残らない

  - id: TC-FW-FORMREFRESH-005
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/form-refresh-held.test.ts::保存 → 旧 props のまま再描画しても値は旧値に戻らず、refresh のあとは通常の判定になる

  - id: TC-FW-FORMREFRESH-006
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/form-refresh-exhaustive.test.ts::729 通りの 2 欄の状態で、触っていない欄は dirty にならず、競合の集合は定義どおりで、冪等で、入力を書き換えない

  - id: TC-FW-GUARD-001
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/engine/__tests__/guard.test.ts::等値比較が成立すれば true を返す

  - id: TC-FW-URL-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/__tests__/url.test.ts::format: url の文法は受理の型と拒否の型を表で網羅し、危ないスキーム・ユーザー名・空白・制御文字・非 ASCII・長すぎる値を通さない"

  - id: TC-FW-URL-002
    type: integration
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/url-format-parity.integration.test.ts::正解表の全行で、生成される CHECK の判定(DB)と実行時の判定(TS)が一致する"

  - id: TC-FW-URL-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/__tests__/url.test.ts::設定の URL は宣言した scheme に合わない値を例外にし、文面に値を入れない(Webhook の URL は URL 自体が秘密)"

  - id: TC-FW-SECRET-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/inbound/__tests__/secret.test.ts::未設定・空・下限に満たない秘密は設定されていないものとして閉じ(undefined)、下限以上は値をそのまま返す。下限が正の整数でなければ書き間違いとして例外にし、値は文面に出さない"

  - id: TC-FW-SECRET-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/inbound/__tests__/secret.test.ts::現在の秘密と更新前の秘密のどちらにも一致を受け、どちらでもなければ・受け付ける秘密が無ければ閉じる(受信の署名の検証も、鍵の並びで同じ)"

  - id: TC-FW-SECRET-003
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/inbound/__tests__/secret.test.ts::秘密の照合は timingSafeEqual で行い、等しい文字列だけが true になる(長さが違っても例外にならない)。秘密を === / !== で比べる行が無い"

  - id: TC-FW-REGEXP-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/__tests__/regexp.test.ts::エスケープした値は、元の文字列にだけ全体一致する(敵対的な値を含む)"

  - id: TC-FW-TEXTINPUT-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/__tests__/text-input.test.ts::利用者が入力する文字列は、制御文字と孤立した surrogate を custom で拒み、改行・復帰・タブと対の surrogate は通す"

  - id: TC-FW-MD-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/__tests__/markdown-guarantee.test.ts::敵対的な入力の表は全行で出力が許可リストの外に出ない(件数の固定。足したら数える)"

  - id: TC-FW-MD-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/rich-text-declared.test.ts::format: markdown でない欄を書式つきで描くと止まる"

  - id: TC-FW-MD-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/__tests__/markdown.test.ts::解釈の長さの天井を超える本文は解釈せず素の文で出す(要素は p と br だけ)"

  - id: TC-FW-BEARER-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/bearer-declared.test.ts::UUID の式・値を渡す口・URL のパスに載る route・欠けた寿命の宣言は R16 が止める"

  - id: TC-FW-BEARER-002
    type: integration
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/bearer-default.integration.test.ts::実 DB で式を 1,000 回評価すると、43 字の base64url で重複せず、宣言の綴りと pg_get_expr の綴りが一致する"

  - id: TC-FW-BEARER-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/bearer-audit.test.ts::作成の監査ログに bearer の欄の値は載らない"

  - id: TC-FW-NEUTRALIZE-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/domain/__tests__/neutralize.test.ts::壊した本文は、メンションの綴りを 1 つも含まない"

  - id: TC-FW-NEUTRALIZE-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/neutralize-declared.test.ts::宣言した部品をアダプタが呼んでいなければ X7 が止める"

  - id: TC-FW-GUARDSQL-001
    type: integration
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts::文法の全構成要素と NULL を振っても実 DB の述語と TS の評価器が同じ判定を下す"

  - id: TC-FW-GUARDSQL-002
    type: integration
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts::グローバル・claim・1 段と 2 段の束縛・contains・implies を振っても実 DB の述語と解決済みロールが一致する"

  - id: TC-FW-REFUSAL-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/action-error.test.ts::表に無いイベントは状態で塞がれた拒否として写す

  - id: TC-FW-PLATFORMOP-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/platform-op.test.ts::宣言に無い理由は一般の文言になり、理由の語を画面に出さない

  - id: TC-FW-REFUSALCODES-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/refusal-codes-parity.test.ts::errcode と接頭辞の組が過不足なく一致する"

  - id: TC-FW-REFUSALCODES-002
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/refusal-codes-parity.test.ts::エンジンの拒否理由 → errcode の写像が過不足なく一致する"

  - id: TC-FW-ROLECLAIM-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/_template/actor-roles.test.ts::条件を満たさない実行者は、束縛が成立していても含意の先の条件を満たさないロールが付かない

  - id: TC-FW-ROLECLAIM-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/step-decision-roles.test.ts::条件を満たさない実行者は、配列から来たロールも claim・binding で立つロールも落ちる

  - id: TC-FW-ROLECLAIM-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-decide-claims.test.ts::値の集合の claim: 集合に入る状態のときだけ立つ(ログインロールは立たず未ログインと同じ)"

  - id: TC-FW-ROLECLAIM-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/rls-oracle-claims.test.ts::含意の先の条件を満たさない人は、束縛が成立していても boolean の claim が真でも立たない(E2)

  - id: TC-FW-ROLECLAIM-005
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/rls-oracle-claims.test.ts::未ログインのロールの読み取りは、ログイン中の人にも同じに効く(条件を満たさない人・行が無い人も、見られるものが減らない)

  - id: TC-FW-ROLECLAIM-006
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/sql/__tests__/eq-subject-actor.test.ts::名指しした集約は、的ではなく実行者の行を指す(置き直しも実行者の行に当たり、実行者の行の値に載る)

  - id: TC-FW-ROLECLAIM-007
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/insert-order.test.ts::遅延できない外部キーの参照先を先に並べ直す(循環の遅延できる辺は後ろ向きに残す)

  - id: TC-FW-RUNPLAN-001
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/_template/wire.test.ts::文字列・有限数・真偽・null はそのまま運ぶ

  - id: TC-FW-RUNPLAN-002
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/_template/run-plan-args-parity.test.ts::1 回の呼び出しに全供給元を並べても、引数の順序と JSON が旧い実装と一致する

  - id: TC-FW-RUNPLAN-003
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/commit-outcome.test.ts::通信の失敗・想定外の失敗は、コミットの状態を欄に残した DbInfrastructureError として投げる

  - id: TC-FW-RUNPLAN-004
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/commit-outcome.test.ts::再送の読み直し（同じキーで既存の結果が返る）でも outbox は unknown のまま・requestedEffects は要求の写しで「積んだ」とは言わない

  - id: TC-FW-RUNPLAN-005
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/_template/run-plan-commit.test.ts::単発も保存点も、通信の失敗は DbInfrastructureError で投げ、コミットの状態が欄に残る（ポートは 1 回だけ呼ぶ）

  - id: TC-FW-RUNPLAN-006
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/_template/run-plan-commit.test.ts::正当な値では、運ぶ JSON が正規化を入れる前と同じ（Date は ISO 8601・欄の undefined は鍵ごと運ばない）

  - id: TC-FW-RUNPLAN-007
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/refusal/__tests__/classify.test.ts::拒否の SQLSTATE は分類の語に写り、本文の接頭辞の後ろから落ちた操作の ID を取る(message / details / hint のどこでもよい)

  - id: TC-FW-RUNPLAN-008
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/intent.test.ts::意図の冪等キーは UUID の形のときだけ取り出し(小文字に揃える)、それ以外は使わない

  - id: TC-FW-RUNPLAN-009
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/operation/__tests__/intent.test.ts::DB の失敗だけを書けたかどうかつきの一時的な失敗の値にし、それ以外の例外は null(呼び手が記録して投げ直す)

  - id: TC-FW-SANITY-001
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/engine/__tests__/validate.test.ts::整合の取れた表では問題を報告しない

  - id: TC-FW-TABLE-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/engine/__tests__/machine.test.ts::表に無いイベントは unknown_event として拒否する

  - id: TC-FW-TABLE-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/engine/__tests__/create.test.ts::表に無いロールは作成できない（deny by default）

  - id: TC-FW-TABLE-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/engine/__tests__/delete.test.ts::表に無いロールは削除できない（deny by default）

  - id: TC-FW-TABLE-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/engine/__tests__/write.test.ts::表に無いロールは編集できない（deny by default）

  - id: TC-FW-SESSIONCOOKIE-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-cookie-policy.test.ts::サインインの開始とログアウトが書く cookie・消す cookie は、全部が __Host- の HttpOnly・Secure・SameSite=Lax・Path=/ で、Domain を持たず、検証子は 10 分で切れる

  - id: TC-FW-SESSIONCOOKIE-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-cookie-policy.test.ts::同じオリジンのページから出たと確かめられない要求は、開始もログアウトも 403 で、cookie を 1 本も書かず、セッションを閉じない

  - id: TC-FW-TENANTRLS-001
    type: integration
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/tenant-boundary-rls.integration.test.ts::親の集約の列で書いた境界は、生成した RLS で他社の行を返さない"

  - id: TC-FW-TENANTRLS-002
    type: integration
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/tenant-boundary-rls.integration.test.ts::実行者の所属を付け替えたあとは、写しが古いトークンでも元の会社の行を読めない"

  - id: TC-FW-TENANTRLS-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/rls-oracle-boundary.test.ts::親の列の境界は、参照列を辿った先の行の列で比べる(自分の会社の部門の予約だけが見える)

  - id: TC-FW-TENANTRLS-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: framework/runtime/src/domain/__tests__/rls-oracle-boundary.test.ts::比べる相手は実行者の行であり、セッションの写しではない(写しが古くても行に従う)
  - id: TC-FW-BROWSER-001
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/browser-defense.test.ts::nonce は乱数 16 バイトの base64 で、既定の乱数源では要求ごとに変わる"

  - id: TC-FW-BROWSER-002
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/browser-defense.test.ts::nonce は宣言した指令の先頭にだけ入り、開発の源は開発中にしか足さない"

  - id: TC-FW-BROWSER-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/browser-defense.test.ts::出どころを確かめられない状態を変える要求(Origin の無い Server Action・他サイトから)は、描画に進ませず 403 で閉じる"

  - id: TC-FW-BROWSER-004
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/browser-defense.test.ts::進ませる要求には同じ nonce の CSP を要求と応答の両方に載せ、応答にキャッシュの禁止を付ける"

  - id: TC-FW-BROWSER-005
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/request-origin.test.ts::Sec-Fetch-Site: same-origin と、自分のホストに一致する Origin の両方が揃ったときだけ同じオリジンと認める"

  - id: TC-FW-BROWSER-006
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/request-origin.test.ts::状態を変える要求で出どころを確かめられなければ 403(理由は書かない)、確かめられるか状態を変えない要求なら本体へ進む"

  - id: TC-FW-BROWSER-007
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/request-origin.test.ts::ログアウトの応答は 204 で、Clear-Site-Data と no-store を付ける"

  - id: TC-FW-MFA-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::要求するロールの実行者は、多要素認証を済ませていなければ判断にも書き込みにも届かずに拒否される"

  - id: TC-FW-MFA-002
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::多要素認証を済ませたセッションなら、要求するロールの実行者も書ける"

  - id: TC-FW-MFA-003
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::要求の対象外のロールの操作は、済ませていなくても通る(要求するロールを持つ人でも、その操作の判断に関わらなければ掛からない)"

  - id: TC-FW-MFA-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::サインインした実行者は、済ませていなければ対象を読む前に拒否される(対象の有無を明かさない)"

  - id: TC-FW-MFA-005
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::内部実行(system の入口)は要求の影響を受けない"

  - id: TC-FW-MFA-006
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::要求を宣言しない製品(外す宣言・認証フロー仕様を持たない)では、済ませていなくても何も変わらない"

  - id: TC-FW-MFA-007
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::実行器と同じ判定を、呼び手が解いたロールで引く(要求するロールが立ち済ませていなければ拒否・済ませれば通る・要求の無い製品では何もしない)"
  - id: TC-FW-MFA-008
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry-mfa.test.ts::要求する製品で、多要素認証を済ませていないセッションは 403(mfa_required)で、本文を読まず・形も枠も有料の処理も呼ばれない"
  - id: TC-FW-MFA-009
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry-mfa.test.ts::多要素認証を済ませたセッションは従来どおり 認可 → 形 → 枠の消費 → 有料の処理 の順に通る"
  - id: TC-FW-MFA-010
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry-mfa.test.ts::要求しない製品(外す宣言・IdP に任せる宣言・認証フロー仕様なし = bindings.mfa が無い)では何も変わらず、セッションの解決も引かない"

  - id: TC-FW-SECLOG-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/security-log.test.ts::拒否の分類(権限・多要素認証・入力・状態・ガード・不変条件)ごとに、閉じた欄だけの 1 行が出る"

  - id: TC-FW-SECLOG-002
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/security-log.test.ts::入力値・理由文・ロール ID・指摘のフィールド名は行に載らない"

  - id: TC-FW-SECLOG-003
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/security-log.test.ts::認証の事象は、目録の重大度で、事象・実行者・結末・要求の識別子だけが出る"

  - id: TC-FW-SECLOG-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/security-log.test.ts::出どころの拒否は、事象・分類・要求の識別子だけを持つ(経路は載せない)"

  - id: TC-FW-LOGSINK-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/log-sink.test.ts::送り先が無ければ標準出力の口がそのまま返る(送る処理は走らない)"

  - id: TC-FW-LOGSINK-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/log-sink.test.ts::送り先が投げても write は返り、network の失敗の 1 行になる(投げた文言は載らない)"

  - id: TC-FW-LOGSINK-003
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/operation/__tests__/log-sink.test.ts::標準出力の行は先に出て、セキュリティの事象の行だけが欄を変えずに送られる"

  - id: TC-FW-BROWSER-008
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/route-isolation.test.ts::関門を後置した実装・関門の結果を捨てる実装・コメントに書いただけの実装・先に本文や外部に触れる実装は、閉じていないと判定する"
  - id: TC-FW-HTTPPARTS-001
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/response.test.ts::application/json; charset=utf-8 を付け、ステータスとほかのヘッダを残す"

  - id: TC-FW-HTTPPARTS-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/safe-fetch.test.ts::呼び出し側は redirect を変えられない(型に無く、実行時に渡されても \"error\" に決め直す)"

  - id: TC-FW-HTTPPARTS-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/safe-fetch.test.ts::301・302・303・307・308 の転送について行かず TypeError で失敗する(転送先に届かない)"

  - id: TC-FW-SAFEREDIRECT-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/redirect.test.ts::外のオリジンへ出る行き先は Location に載らず、既定の行き先に置き換わる"

  - id: TC-FW-SAFEREDIRECT-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/navigation/__tests__/navigation.test.ts::外のオリジンへ出る行き先は転送せず、既定の行き先に置き換わる(恒久の転送も同じ)"

  - id: TC-FW-SAFEREDIRECT-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/navigation/__tests__/navigation.test.ts::push / replace / assign は外のオリジンへ出る行き先を渡さず、既定の行き先に置き換わる"

  - id: TC-FW-SAFEREDIRECT-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/route-guard.test.ts::口が返した応答の Location が同じオリジンの相対パスでなければ、行き先の無い 500 にしてログを 1 行書く(綴りを問わない)"

  - id: TC-FW-SESSIONEND-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::終端の状態へ行く遷移がセッションを終える効果を宣言していなければ J7 が止め、宣言すれば通る(一時停止には求めない)

  - id: TC-FW-SESSIONEND-002
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::生成する遷移の RPC は、効果を宣言したイベントでだけ、遷移と同じトランザクションの中で呼び出しを持つ

  - id: TC-FW-LOGOUT-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::ログアウトの遷移を持つ共有クロームを被っていない要ログインの画面を H8 が止め、被っていれば通る

  - id: TC-FW-SESSIONVALID-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::署名が有効で aal2 のアクセストークンでも、セッションが終わっていれば(getUser が落ちる)多要素認証を済ませたと答えない

  - id: TC-FW-SESSIONVALID-002
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::製品の実装とセッションの adapter は、cookie から読んだだけの値(getSession)を使わず、署名だけを確かめるクレーム(getClaims)は許可した 3 か所だけで読む

  - id: TC-FW-SESSIONALIVE-001
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-alive.test.ts::全ての表にログインセッションの生死を要求する制限ポリシーが 1 本ある(許可ポリシーの数・述語に依らない・ログイン済みのロールだけが宛先)
  - id: TC-FW-SESSIONALIVE-002
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-alive.test.ts::生死を答える土台の関数は、持ち主の権限・空の search_path で認証基盤のセッションの表を引き、識別子が無ければ偽になる式を持つ
  - id: TC-FW-SESSIONALIVE-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-alive.test.ts::宣言した全ての policies_migration が、その表の制限ポリシーを (select …) で包んで持つ(許可ポリシーだけの古い生成物を残さない)

  - id: TC-FW-CONNPATH-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::framework/adapters の全部の adapter が閉じた表を持ち、全部の入口の全部の口が載り、どの口も生の道を返さず受け取らない。接続層に触る adapter は探りの全行が書いた番号の誤りで落ちる"
  - id: TC-FW-CONNPATH-002
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::照らしは生の道を名指し、表の抜け・余り・指し違い・書き方の違い・入口の抜けを赤にする(正しい形は赤にしない)"
  - id: TC-FW-CONNPATH-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::期待した誤りの番号の照らしは、別の番号で落ちる行・落ちない行・番号の無い印・印の無い行の誤り・番号のほかの誤りを全部赤にする"
  - id: TC-FW-CONNPATH-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::照らしは全部の多重定義と上限の深さまでたどり、上限で読み切れない口は表の理由つきの行が無ければ赤にする(多重定義の 1 本目・4 段目より深い所・auth.admin の作り物・行の有無と形・循環・値だけの型・解けない型・ベンダーの型・どの段の渡す any・クラスの protected の欄)"
  - id: TC-FW-CONNPATH-005
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::照らしは exports の全部の鍵を数え、test 条件の無い入口(文字列・types / default・入れ子)も型の入口を解いて照らし、解けない鍵は赤にする(差分点検 fix27 C27-1)"
  - id: TC-FW-CONNPATH-006
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::型引数を持つ口は、表が書いた型引数の 1 点だけでなく宣言の型(型の引数を制約の上限)でもたどり、上限を解けない条件型は読み切れない(差分点検 fix27 C27-4)"
  - id: TC-FW-CONNPATH-007
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::宣言の行(置き場#名前)は、その宣言の中の読み切れないものだけを受け、同じ名前の別の宣言・宣言の外の any・行の中の生の道・当たらない行・理由の短い行は赤にする"
  - id: TC-FW-SESSIONADMIN-001
    type: unit
    covers: [other]
    spec_ids: [framework-guarantee-catalog]
    implementation: legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::一覧は欄を絞って返し(トークンの類は通さない)、ID が UUID の形でなければ RPC を呼ばずに落とす
  - id: TC-FW-PAIDENTRY-001
    type: unit
    covers: [success]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::通る要求は 認可 → 形 → 枠の消費 → 有料の処理 の順に進み、処理の応答がそのまま返る"
  - id: TC-FW-PAIDENTRY-002
    type: unit
    covers: [invariant]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::枠を使い切っていれば 429 で、有料の処理は 1 度も呼ばれない(課金の前に断る)"
  - id: TC-FW-PAIDENTRY-003
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::未ログインは 401、役を持たない人は 403 で、本文は 1 バイトも読まず・形も枠も処理も呼ばれない"
  - id: TC-FW-PAIDENTRY-004
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::壊れた JSON・UTF-8 でない本文・本文なし・形の不正は 400 で、枠は消費しない(使えない入力で枠を減らさない)"
  - id: TC-FW-PAIDENTRY-005
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::Content-Length が上限を超えていれば 413 で、本文を 1 バイトも読まず、形も枠も処理も呼ばれない"
  - id: TC-FW-PAIDENTRY-006
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::Content-Length が無い(塊で流れる)本文は、上限を超えた最初の塊で読みを打ち切り、残りの塊を引かない"
  - id: TC-FW-PAIDENTRY-007
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::Content-Length が実際より小さく偽られていても、読みながら数えて 413 にする"
  - id: TC-FW-PAIDENTRY-008
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-entry.test.ts::maxBodyBytes が 1 以上の整数でなければ、何も呼ばずに TypeError(上限なしで動く口にしない)"
  - id: TC-FW-PAIDENTRY-009
    type: unit
    covers: [forbidden]
    spec_ids: [framework-guarantee-catalog]
    implementation: "framework/runtime/src/http/__tests__/paid-gate.test.ts::役を捨てる認可(点検 5 回目 B5-2 の probe4): 未ログインでも通り、本文を読み、枠の RPC と有料の宛先に触れる → 漏れを全部名指す"

---

# 仕組みの保証台帳

仕組み自身が「起こりえない」と言い切る事実の目録(`framework/` の下の見張りテストの宣言)。製品の保証台帳(`specs/backend/guarantees.md`)とは別の台帳で、**製品が外せない義務**である(製品の `uses` や宣言からは選べない)。

- 保証 ID は `fw_` 始まり・テストケース ID は `TC-FW-` 始まり・文書 ID は `framework-guarantee-catalog` に予約してある。製品の台帳はこれらを使えない(Z0 が検査する)
- 見張りテストは仕組みの根の下(`framework/runtime/src` と `legacy/spec-tools/__tests__/guarantees`)に置く。突合は Z3(仕組みの走査 ⇔ この台帳)が、製品の木の有無に依らず行う
- 書き方の正: `docs/rules/process/backend/specification/standards/guarantee-spec-writing.md`

<!-- AUTO-GENERATED:guarantee-body -->
### 保証の全数(見張りテストを宣言していない保証は無い — enforced は canaries が必ず 1 つ以上ある)

| 保証 ID | 何が起こりえないか | 執行者 | 状態 | 見張りテスト | summary |
| --- | --- | --- | --- | --- | --- |
| `fw_engine_permit_required` | エンジンに聞かずに書けない(FireAllowed の偽造不可) | type_system(TypeScript の型(コンパイルで落ちる)) | enforced | `TC-FW-ENGINE-001` | 状態遷移の許可(FireAllowed)は非公開シンボルで封印されており、構造的に一致するオブジェクトを作っても代入・キャスト・satisfies のいずれでも通らない |
| `fw_engine_follows_table` | 生成した表に無い遷移・作成・削除・編集は許さない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-TABLE-001`, `TC-FW-TABLE-002`, `TC-FW-TABLE-003`, `TC-FW-TABLE-004` | エンジン(canFire / canCreate / canDelete / canWrite)は渡された表に無いイベント・ロールを deny by default で拒否し、表に無い遷移・作成・削除・編集を許さない |
| `fw_guard_semantics` | ガード式の評価は仕様の意味論どおりにしか成立しない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-GUARD-001` | ガード評価器は domain-spec-writing.md の演算子・型・評価不能の意味論どおりに成立・不成立・評価不能を判定する |
| `fw_guard_sql_parity` | ガード式とロールの SQL 翻訳は TS の評価器と同じ判定を下す | differential_test(意味の正(TS)と写し(SQL)の差分テスト(fast-check + 実 DB)) | enforced | `TC-FW-GUARDSQL-001`, `TC-FW-GUARDSQL-002` | 同じ 1 つの宣言を TS の評価器と DB の両方が読むので、ガード式の SQL 翻訳(lib/sql/guard-to-sql.ts)とロールの by の SQL 翻訳(lib/sql/roles-to-sql.ts)は、式と環境を fast-check で振って実 DB の `select <​述語>` と TS の判定を突き合わせても一致する(不明 = NULL は両側で不成立に畳まれる)。振るのは boolean を含む全ての欄 × 全ての演算子であり、TS が常に不明にする組(boolean への in / 順序比較)は翻訳器が Result の失敗として断る。text の順序比較の照合順序は翻訳器が `collate "C"` で固定し、実行者のロール集合は implies の推移閉包で閉じたものを渡す |
| `fw_url_format` | URL の書式(format: url)の文法は、入力スキーマ・表の CHECK・実行時の判定で同じ答えを返し、設定の URL は宣言した scheme に合わない値を例外にする | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), differential_test(意味の正(TS)と写し(SQL)の差分テスト(fast-check + 実 DB)) | enforced | `TC-FW-URL-001`, `TC-FW-URL-002`, `TC-FW-URL-003` | `format: url` の文法(絶対 URL の http / https だけ。`javascript:` `data:`・スキームの無い綴り・プロトコル相対・ユーザー名つき・空白と制御文字・非 ASCII・長さ 2048 超を通さない)は検証器・生成器の kernel と実行時パッケージ `@kaninabe/runtime/url` の 2 か所に綴られ、受理と拒否の正解表を両方に当てて同じ答えを返す。生成される表の CHECK(`~`)は同じ綴りを Postgres に置くので、正解表の全行で DB と TS が一致することを実 DB で突き合わせる(後読み・括弧内のバックスラッシュなど ARE と JS で揺れうる構文を使わない)。設定の URL は `readConfigUrl` が宣言した scheme(https / 自分の機械への http だけ例外)に合わない値を例外にし、文面に値を出さない。ASVS V1.2.2 / V12.3.1 |
| `fw_service_secret` | サービスの認証の秘密は、下限に満たない値で口が開かず、固定長要約の比較で照合し、更新の間は新旧どちらも受ける | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-SECRET-001`, `TC-FW-SECRET-002`, `TC-FW-SECRET-003` | `@kaninabe/runtime/secret` の `readServiceSecret` は、未設定・空・設定カタログの `strength.min_length` に満たない秘密を「設定されていない」ものとして閉じ(`undefined`)、下限以上の値だけを返す(下限が正の整数でない呼び出しは書き間違いとして例外にし、値は文面に出さない)。照合は `constantTimeEquals`(両辺を SHA-256 にして `timingSafeEqual`。長さが違っても例外にならず、比較は食い違った位置で早く終わらない。入力の長さに時間が依存しないとは主張しない。時間の実測はしていない)で、`matchesAnySecret` は現在の秘密と更新前の秘密(設定カタログの `previous`)の**全部と**比べる(どちらに一致したかを時間に出さない)ので、秘密の更新の間は新旧どちらを付けた呼び出しも受け、どちらでもなければ・受け付ける秘密が無ければ閉じる。受信の署名の検証(`verifyInboundSignature`)も鍵の並びを同じ部品で受ける。設定仕様検証の K6 が、カタログの `strength` を宣言した秘密を実装の木が `readServiceSecret` の関門(本物の import に束縛できる形)で読んでいること・下限がカタログと同じことを見る。ASVS V13.2.3・V11.2.2 |
| `fw_regexp_escape` | 利用者の値を正規表現に入れるときの特殊文字のエスケープ(escapeRegExp)は、値を元の文字列にだけ一致させる | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-REGEXP-001` | `@kaninabe/runtime/regexp` の `escapeRegExp` は、正規表現の特殊文字(`\ ^ $ . * + ? ( ) [ ] {​ ​} \|` と `/` `-`)をその文字そのものに一致させる。エスケープした値で組んだ `^…$` は、敵対的な値(`(a+)+$`・`.*`・`[a-z]*`・`a\|b` など)でも元の文字列にだけ全体一致し、`u` フラグの下でも文字クラスの中でも範囲や量指定に化けない。アプリと仕組みの実行コードで `new RegExp(…)` のパターンに静的でない値を入れる唯一の道で、lint の `layer/no-dynamic-regexp` がこの部品を通した置換だけを通す(ASVS V1.2.9) |
| `fw_text_input` | 利用者が入力する文字列は、制御文字(改行・復帰・タブ以外の C0・DEL・C1)と対にならない surrogate を持たない(入力スキーマの生成器が文字列の欄を 1 か所で textInput() から始める) | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-TEXTINPUT-001` | `@kaninabe/runtime/text-input` の `textInput()` は、`z.string()` に「改行・復帰・タブ以外の C0・DEL・C1・孤立した surrogate を含まない」検査を載せた文字列のスキーマで、`.trim()` `.min()` `.max()` `.regex()` などの鎖はそのまま続けられる。判定は code point で行い(対になった surrogate は 1 字の補助面として通る)、正規化はしない。入力スキーマの生成器は entity_spec の文字列(string / text)の欄を、行にも入力にも、欄ごとの記述なしに 1 か所でこの部品から始める(更新の入力スキーマは行のスキーマから借りるので、行にも要る)。NUL は Postgres の text が拒むため、通すと 500 になる(点検 17 回目 O17-3・18 回目 O18-2)。製品側の見張りは、入力スキーマの文字列の欄の閉じた表と実物の突合・操作の入力スキーマの全部の欄の NUL 拒否・手書きの `z.string(` の禁止(text-input-coverage.test.ts) |
| `fw_markdown_sanitize` | 書式つきの本文(format: markdown)の描画は、許可リストの外の要素・属性・URL を出力に残さず、描けない本文は例外を投げず素の文に縮退する | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-MD-001`, `TC-FW-MD-002`, `TC-FW-MD-003` | `@kaninabe/runtime/markdown` の `renderMarkdown` は、生の HTML を構文木にする時点で捨て、`rehype-sanitize` に**許可リスト**(見出し・段落・改行・強調・削除・コード・整形済み・引用・リスト・区切り線・リンクの要素と、`a[href]`・`ol[start]`・`code[class=language-…]` の属性だけ。画像・表・フォーム・埋め込み・style・id・target・イベント属性は無い)を渡して通し、リンクは `safeHttpUrl`(絶対の http / https・ユーザー名なし)を通ったものだけアンカーとして残して(通らないものは文字だけ)`rel="noopener noreferrer"` を付ける。XSS の定番・符号化の細工(実体参照・タブ・NUL・全角)・入れ子・変異 XSS を表にした敵対的な入力 85 本すべてで、出力が許可リストの外に出ないことを 1 つの検算器(要素・属性・href・要素の外の `<​`)で見て、検算器自身が壊した出力で鳴ることも見る。深すぎる入れ子と解釈の天井(`format: markdown` の `max_length` の天井と同じ値)を超える本文は、解釈せず素の文の段落に縮退する(例外を投げない)。`MarkdownView` は `renderMarkdown` の出力だけを `dangerouslySetInnerHTML` に載せる唯一の部品で、引数は Markdown の元の文字列である。書式つきの本文として描く欄が `format: markdown` で宣言されているかは R15(描く口の走査)が見て、アプリのコードの `dangerouslySetInnerHTML` / `innerHTML` などの差し込み口と Markdown を自前で解く部品は ESLint の `layer/no-raw-html` が書けなくする(ASVS V1.3.1・V1.3.5。製品側の見張りは製品の台帳 url_scheme_safe) |
| `fw_bearer_value` | 持っていれば効く値(bearer)は列の既定値の CSPRNG(32 バイトの base64url)だけが作り、UUID を使わず、URL のパスにも監査ログにも載せず、寿命を宣言する | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), differential_test(意味の正(TS)と写し(SQL)の差分テスト(fast-check + 実 DB)) | enforced | `TC-FW-BEARER-001`, `TC-FW-BEARER-002`, `TC-FW-BEARER-003` | `bearer` を宣言した欄(`string`・`supplied_by: db`・`max_length` 43 以上)の値は、data_table の `defaults` の式 `translate(encode(gen_random_bytes(32), 'base64'::text), '+/='::text, '-_'::text)`(pgcrypto の CSPRNG の 32 バイト = 256 ビットを base64url の 43 字にしたもの)だけが作る。R16 は、`defaults` の式がこの綴りでない(UUID の式を含む)・`defaults` が無い・表の関数が値を引数(`p_{​欄}` / `p_new_{​欄}`)で受ける・画面の route の動的セグメントが欄を名指す(`:code` / `:{​集約}_{​欄}`)・寿命の宣言(`expires_at` と `used_at` の datetime の欄、または理由つきの `reusable`)が欠ける・名指した欄が実在しないか datetime でない、のどれも error にし、`reusable` は毎回 warning(受け入れた危険)で名指す。実 DB で式を 1,000 回評価して、43 字・base64url の文字だけ・重複なしを見て、`pg_get_expr` が返す綴りが宣言の綴りと一致することを突き合わせる。生成する作成の RPC は `bearer` の欄を監査ログ(`domain_events.payload`)に載せず(`redacted` にも載せない)、外部連携が `bearer` の欄を送ることは X7 が止める(ASVS V11.5.1・V14.2.1・V6.4.1) |
| `fw_neutralize_outbound` | 外へ送る自由文は、外部連携の宣言(sends.neutralize)した無害化の部品を通って送られ、部品は敵対的な本文でも危ない文脈へ値を渡さない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-NEUTRALIZE-001`, `TC-FW-NEUTRALIZE-002` | `@kaninabe/runtime/neutralize` の `neutralizeDiscordMentions`(`@everyone` / `@here` / `<​@…>` の綴りを壊す)・`allowedDiscordMentionsOf`(呼んでよい相手をアダプタ自身が先頭に置いたメンションだけに絞る)・`stripControlChars`(改行・タブ・復帰以外の制御文字を除く)・`clampLength`(長さを上限に収める。サロゲートペアを割らない)は、効く型と触らない型を表で固定する。外部連携カタログの行は `sends.neutralize`(部品の宣言。`discord_mentions` / `control_chars` / `length:N`)か `sends.neutralize_none`(理由つき)を宣言し、X7 が、宣言した部品を手書きのアダプタが `@kaninabe/runtime/neutralize` の import に束縛された呼び出しで呼んでいること(`length:N` は第 2 引数が同じ数のリテラル)・`neutralize_none` なのに利用者が書ける文字列の欄を送っていないことを突き合わせる(ASVS V1.3.3) |
| `fw_engine_table_sanity` | 到達不能・行き止まり・非決定な遷移表はランタイムでも検出される | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-SANITY-001` | 遷移表の健全性(到達性・行き止まり・終端不変・決定性)は生成時だけでなくランタイムでも assertValidTable が検証する(既知解テストの初実物) |
| `fw_refusal_maps_to_action_error` | エンジンの拒否理由は実装が文言を組み立てず、決まったエラーの種類へ写る | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-REFUSAL-001` | canFire / canCreate の拒否は toActionError / toCreateActionError が ActionError の 3 分類(guard_unsatisfied / forbidden / invariant_violated)へ機械的に写し、実装が理由文を独自に組み立てる箇所を持たない |
| `fw_run_plan_outcome` | 実行器は書き込みの結末（コミットの状態・拒否の分類）を取りこぼさず、運ぶ値を変えない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-RUNPLAN-001`, `TC-FW-RUNPLAN-002`, `TC-FW-RUNPLAN-003`, `TC-FW-RUNPLAN-004`, `TC-FW-RUNPLAN-005`, `TC-FW-RUNPLAN-006`, `TC-FW-RUNPLAN-007`, `TC-FW-RUNPLAN-008`, `TC-FW-RUNPLAN-009` | 実行計画の実行器(run-plan)は、引数の供給元をいくつ並べても引数の順序と JSON が旧い実装と一致し、運ぶ値の正規化は正当な値の JSON を変えない(Date は ISO 8601・欄の undefined は鍵ごと運ばない)。通信の失敗・想定外の失敗は、コミットの状態を欄に残した DbInfrastructureError として投げ(ポートは 1 回だけ呼ぶ)、再送の読み直しでも outbox は unknown のままで「積んだ」と言わない。拒否の SQLSTATE は分類の語に写り、本文の接頭辞の後ろから落ちた操作の ID を取る。冪等キーは画面の実行器が送る送信の意図の鍵(UUID の形のときだけ。押し直しで同じ値)を使い、無ければ 1 呼び出しに 1 回作る。生成した Server Action は DB の失敗(DbInfrastructureError)を例外の境界の手前で書けたかどうか(not_committed / unknown)つきの一時的な失敗の値にし、それ以外の例外は投げ直す(点検 20 回目 B20-1) |
| `fw_role_row_condition` | 実行者の行の条件(claim の値の集合・含意の先の条件)を満たさない実行者には、先読みもオラクルも役を立てない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-ROLECLAIM-001`, `TC-FW-ROLECLAIM-002`, `TC-FW-ROLECLAIM-003`, `TC-FW-ROLECLAIM-004`, `TC-FW-ROLECLAIM-005`, `TC-FW-ROLECLAIM-006`, `TC-FW-ROLECLAIM-007` | 既定のログインロールが行の条件(state / enum の欄が値の集合のどれか)を併記していれば、先読み(ロール解決の表)は行があるだけでは既定のロールを立てず、満たさない実行者は未ログインと同じロールになる。claim を持つロールを含意するロールは、束縛や配列から立っていても含意の先の条件を満たさなければ立たない(DB の述語 `自分の根拠 AND 含意の先の行の条件` の写し)。値の集合の claim は集合に入る値のときだけ立ち、boolean の claim は従来どおり真のときだけ立つ。RLS のオラクルも同じ規則で期待を計算する。セッションの写しは遅れうるので先読みは甘い側に外れうるが、権威は DB の述語である |
| `fw_runtime_dependency_closed` | runtime の核はベンダーの依存もサーバー専用の印も持たず、ベンダー依存は adapters にだけ住み、依存は adapter → runtime の一方通行 | static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-CLOSURE-001`, `TC-FW-CLOSURE-002` | 実行時パッケージ(`@kaninabe/runtime`)の宣言した依存にも配布するソースの import にも @supabase / PostgREST / server-only が無く、DB への口は中立のポートである。runtime の核(framework/runtime)はベンダーの依存(@supabase など)を持たず、ベンダー依存は adapters(framework/adapters/*)にだけ住む。依存は adapter → runtime の一方通行で、どの adapter もサーバー専用の印を持たない。PostgREST の adapter は @supabase も持たず(接続層は製品が渡す)、認証基盤ごとの adapter はその認証基盤のライブラリに依存してよい(静的な import の閉包を読む。配布物ではなくソースが正) |
| `fw_refusal_codes_parity` | 拒否の分類の語は検証器・生成器と実行時パッケージで 1 つである | parity_test(2 か所の写しが過不足なく一致することの突合) | enforced | `TC-FW-REFUSALCODES-001`, `TC-FW-REFUSALCODES-002` | errcode と接頭辞の組、およびエンジンの拒否理由 → errcode の写像が、検証器・生成器の側(lib/sql/refusal-codes.ts。生成される plpgsql が使う)と実行時パッケージの側(refusal-codes.ts。実行時側の唯一の写し)で過不足なく一致する。ずれると「DB は 403 のつもり・アプリは競合と読む」が黙って作れる |
| `fw_form_refresh_pure` | refresh で届いた他者の変更を、触っていない欄の再送で上書きしない判定は純関数として成り立つ | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-FORMREFRESH-001`, `TC-FW-FORMREFRESH-002`, `TC-FW-FORMREFRESH-003`, `TC-FW-FORMREFRESH-004`, `TC-FW-FORMREFRESH-005`, `TC-FW-FORMREFRESH-006` | 編集フォームの下書きを baseline との差で決める純関数(`reconcileFormDraft` / `changedFields` / `acceptSaved` / `held`)は、触っていない欄は最新へ追従し、触った欄は手元を守り、両方が変えた欄は競合として残して黙って解決しない。自分の保存の直後の refresh は競合にせず、保存してから最新が届くまでの旧い props での再描画でも欄は旧い値に戻らない。2 欄の全状態の列挙（729 通り）で、触っていない欄は dirty にならず、競合の集合は定義どおりで、冪等で、入力を書き換えない。画面がその判定を使っていること(配線)は製品の台帳の見張りテストが見る |
| `fw_tenant_boundary_reads_actor_row` | テナント境界の RLS は実行者の行で判定し、親の列で書いた境界も他社の行を返さない | db_scenario_test(生成した SQL を実 DB に当て、決めた筋書きどおりの行集合が返ることを確かめる統合テスト), pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-TENANTRLS-001`, `TC-FW-TENANTRLS-002`, `TC-FW-TENANTRLS-003`, `TC-FW-TENANTRLS-004` | reads[].filters の右辺 actor.{​欄} は、生成した RLS の中で security definer の補助関数 public.actor_{​欄}() が実行者自身の行から読む(トークンの属性の写しは読まない)。だから運営が所属を付け替えたあとは、写しが古いトークンでも元のテナントの行を読めない。左辺に context で 2 段まで辿れる親の列({​集約}.{​列})を書いた境界は、参照の鎖をスカラー副問い合わせで辿って比べ、テナントの列を持たない子表でも他のテナントの行を返さない。実行者の集約そのものに境界を書いた表も、補助関数が所有者の権限で読むので再帰しない。生成する RLS の挙動テストのオラクルも同じ正(参照列の鎖を実 DB の行で辿り、実行者の行の欄と比べる)で期待を計算する |
| `fw_browser_defense` | ブラウザ側の守りの組み方は、要求ごとの推測できない nonce と、出どころの確かめられない状態を変える要求の拒否から外れない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-BROWSER-001`, `TC-FW-BROWSER-002`, `TC-FW-BROWSER-003`, `TC-FW-BROWSER-004`, `TC-FW-BROWSER-005`, `TC-FW-BROWSER-006`, `TC-FW-BROWSER-007`, `TC-FW-BROWSER-008` | 実行時パッケージの `@kaninabe/runtime/http` は、文書の CSP の nonce を暗号論的な乱数 16 バイトで要求ごとに作り(UUID は使わない)、宣言した指令にだけ差し込み、開発中の源を本番に載せない。状態を変える要求は Sec-Fetch-Site の same-origin と、スキームとホストの両方が自分のオリジン(ホストは X-Forwarded-Host の先頭か Host、スキームは X-Forwarded-Proto の先頭か要求の URL)に一致する Origin の両方が揃ったときだけ通し、片方でも欠ければ理由を書かない 403 で閉じる(Next.js が Origin の無い Server Action を警告だけで通す分を足す)。進ませる文書の要求には同じ nonce の CSP を要求と応答の両方に載せ、応答にキャッシュの禁止を付ける。ログアウトの応答は Clear-Site-Data と no-store を付ける。生成した見張りテストが使う観測の道具(`@kaninabe/runtime/testing/http/route-isolation`)は、関門を後置した実装・関門の結果を捨てる実装・コメントに書いただけの実装・先に本文や外部に触れる実装を「閉じていない」と判定する(負例で固定。TC-FW-BROWSER-008)。値(どのヘッダを付けるか)はアプリの枠の後段の宣言が持ち、床を下回る宣言は後段の選択の契約が止める |
| `fw_response_charset_and_safe_fetch` | 本文のある応答は charset つきの Content-Type で出て、外の URL を呼ぶ fetch は転送について行かない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-HTTPPARTS-001`, `TC-FW-HTTPPARTS-002`, `TC-FW-HTTPPARTS-003` | 実行時パッケージの `@kaninabe/runtime/http/response` の `jsonResponse` / `textResponse` は、本文のある応答の `Content-Type` を常に `application/json; charset=utf-8` / `text/plain; charset=utf-8` に決める(呼び出し側が別の値を渡しても上書きし、ステータスとほかのヘッダは残す。JSON にならない値は TypeError)。`@kaninabe/runtime/http/safe-fetch` の `safeFetch` は `redirect` を `"error"` に固定し(呼び出し側は変えられない・`Request` を渡しても勝つ)、実物のサーバーが 3xx を返しても転送先に届かず TypeError で失敗する(素の fetch は同じ呼び先でついて行く対照つき)。この 2 つを使わない書き方(`Response.json`・charset の無い本文つき `new Response`・グローバルの `fetch`)の禁止は、製品の台帳の response_charset_set と outbound_no_redirect が見る |
| `fw_safe_redirect_parts` | 安全な転送の部品は、外のオリジンへ出る行き先を転送・遷移に渡さない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-SAFEREDIRECT-001`, `TC-FW-SAFEREDIRECT-002`, `TC-FW-SAFEREDIRECT-003`, `TC-FW-SAFEREDIRECT-004` | 転送を作れる仕組みの部品は 3 つ —— Route Handler の応答の `safeRedirectResponse`(`@kaninabe/runtime/http/redirect`)・サーバーの転送の `safeRedirect`(`@kaninabe/runtime/navigation`)・クライアントの遷移の `useSafeNavigate`(`@kaninabe/runtime/navigation/client`。push / replace / assign / refresh)。どれも行き先を核の `safeReturnPathOr`(`@kaninabe/runtime/url`)に通し、同じオリジンの相対パス(`/` で始まり、`//`・`/\`・スキーム・制御文字・正規化で `//` に畳まれる綴りでない)だけを `Location` / 転送の合図 / ルーターに渡す。通らない値は書いた人が決めた既定の行き先に置き換わり、既定の行き先も通らなければ例外にする(外へは倒さない)。`safeRedirectResponse` は呼び出し側の見出しの `Location` を決め直し `Refresh` を消す。**Route Handler の出口の関所 `guardRoute`**(`@kaninabe/runtime/http/route-guard`。点検 10 回目 B10-1)は、包んだ口が返した応答の `Location`(大文字小文字を問わない。組み方を問わない)が同じオリジンの相対パスでも宣言した外のオリジン(完全なオリジンの閉じた表。要るときにだけ読む)の絶対 URL でもなければ、口の応答を捨てて行き先・本文・応答に載った `Set-Cookie` の無い 500(`no-store`)を返し、セキュリティログに値を載せない `redirect_refused` を 1 行書く(`next/headers` の `cookies()` の書き込みは Next.js が後から足すので残る)。`Refresh` は値に関係なく止め、口が投げた転送の合図(`NEXT_REDIRECT`)の行き先も同じ判定に通す。応答の `Content-Type` は閉じた表(`application/json`・`text/plain`)だけを通し、表の外の型は口が理由つきで宣言したダウンロードの型(実行しない型の閉じた表)をダウンロードの見出し(`attachment`)つきで出すときだけ通す。ほかは同じ 500 と `response_type_refused` にする。包んだ口は `isGuardedRoute` が真になる(モジュールを読み込み直しても同じ印)。セッションの adapter の生の転送の部品は公開の入口から出さず、ログアウトとサインインの失敗の着地は同じ判定に通らなければ例外、サインインの開始は認証基盤のオリジンでない認可の URL を失敗の着地に倒す。製品のコードから生の転送の口を止めるのは製品の台帳の url_scheme_safe(ESLint の `layer/require-safe-redirect` と、全部の口を包むことの J2)が見る |
| `fw_function_acl_closing_runs_on_empty_plan` | 関数の実行権限を閉じる migration は、呼べる側も必須の作成主体も空の計画でも型の解決で止まらずに流れる | db_scenario_test(生成した SQL を実 DB に当て、決めた筋書きどおりの行集合が返ることを確かめる統合テスト) | enforced | `TC-FW-FNACL-001` | 公開面を外へ出す能力が無く RLS 補助関数も無い構成では、面のロールから呼べる関数の宣言が空になり、必須の作成主体も空でありうる。生成器は宣言の配列・作成主体の並び・剥奪するロールの並びを空でも型の決まる text[] で出し、先頭の欠けた並び(array[, …])を出さないので、その計画から生成した migration は実 DB で流れる。型の付与だけを外した同じ SQL は要素の型が決まらず止まる(42P18)ことを対照にして、空の緑でないことを固定する |
| `fw_session_cookie_policy` | 認証の cookie は全部が __Host- の HttpOnly・Secure・SameSite=Lax で書かれ、開始とログアウトの口は出どころを確かめる | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-SESSIONCOOKIE-001`, `TC-FW-SESSIONCOOKIE-002` | セッションの adapter(`framework/adapters/supabase-session`)が書く cookie と消す cookie(セッションとその分割・PKCE の検証子・サインインの往復で運ぶ値)は、ライブラリが渡した属性の寿命だけを拾い、名前は `__Host-` で、`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`・`Domain` なしに上書きされる(書き手は adapter の中にしか居ない)。PKCE の検証子はライブラリの既定(400 日)ではなく 10 分で切れる。移行前の既定の名前(`sb-{ref}-auth-token`)の残りも同じ属性で消す。サインインの開始とログアウトの口は、`Sec-Fetch-Site: same-origin` と自分のホストに一致する `Origin` の両方が無ければ 403 で、cookie を書かずセッションも閉じない。ログアウトの範囲はこの端末だけ(`scope=local`)で、認証基盤への問い合わせが失敗しても認証の cookie は全部消し、`Clear-Site-Data` を返す。製品のコードがこの形を崩す書き方(ブラウザの認証基盤のクライアント・`document.cookie`・トークンの欄の読み取り)の禁止は、製品の台帳の session_tokens_server_only が見る |
| `fw_mfa_write_boundary` | 多要素認証を要求するロールの実行者は、多要素認証を済ませていないセッションでは書き込みの入口を通れない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-MFA-001`, `TC-FW-MFA-002`, `TC-FW-MFA-003`, `TC-FW-MFA-004`, `TC-FW-MFA-005`, `TC-FW-MFA-006`, `TC-FW-MFA-007`, `TC-FW-MFA-008`, `TC-FW-MFA-009`, `TC-FW-MFA-010` | 認証フロー仕様が多要素認証を要求すると、生成された束(`runtime-bindings.ts` の `mfa`)が範囲(全員 / ロールの一覧)を運び、生成された Server Action はセッションが多要素認証を済ませたか(Supabase なら署名を確かめたクレームの `aal` が `aal2`。adapter の `sessionMfaVerified`)を解決して実行器へ渡す。実行器(run-plan)は判断と書き込みの前に、要求するロールが判断に立つサインインした実行者のセッションが済ませていなければ `forbidden`(印 `mfaRequired: true`)で返し、事実の読み取りも RPC の呼び出しもしない。範囲が全員なら対象の有無を読む前に止める。済ませたかを渡されなかった呼び出しは済ませていないとして扱う。内部実行(system の入口)・未ログイン・要求の対象外のロールの操作・要求を宣言しない製品は何も変わらない。実行器を通らない `runner: manual` の操作の手書きの Server Action は、同じ判定を `@kaninabe/runtime/template/mfa` の `refuseUnverifiedMfa`(呼び手が解いたロールを受ける口)で引く(呼んでいることは verify の H6 が構文木で見る)。cookie で認証する有料の口(Route Handler)も実行器を通らないので、共通の入口 `runPaidEntry`(`@kaninabe/runtime/http/paid-entry`)が認可の直後・本文を読む前に同じ判定を引き、済ませていないセッションは 403(`mfa_required`。事象は `mfa_refused`)で、本文を読まず・枠を消費せず・有料の処理を呼ばない(要求しない製品は変わらず、セッションの解決も引かない。解決を渡さない・投げるときは済ませていないとして止める)。口が生成した束と役を渡していることは製品側の検査 X8 が構文木で見る |
| `fw_security_log` | 拒否・認証・出どころの確認のログは、閉じた欄の ID と判断だけを 1 行で出し、個人の値を載せない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), type_system(TypeScript の型(コンパイルで落ちる)) | enforced | `TC-FW-SECLOG-001`, `TC-FW-SECLOG-002`, `TC-FW-SECLOG-003`, `TC-FW-SECLOG-004` | 実行時パッケージの `@kaninabe/runtime/security-log` は、Server Action の拒否(権限・多要素認証・入力・状態・ガード・不変条件の 6 つに割った事象)・サインインの開始と帰り道とログアウト・出どころを確かめられなかった要求を、事象の目録(`SECURITY_EVENTS`)の ID を持つ 1 行で出す(V16.3.1〜V16.3.3)。行は閉じた欄(`LogRecord` と `LOG_FIELDS` が型で 1 対 1)だけで、入力値・理由文・ロール ID・指摘のフィールド名・メールアドレス・トークン・cookie・経路を載せる欄も、受け取る口も無い。要求の識別子は形の合うヘッダだけを読み、配置先が付け直す `x-vercel-id` を利用者が送れる `x-request-id` より先に読む(行の偽造と肥大、ログの突き合わせを断たれることを防ぐ)。生成された Server Action は実行者をパースより先に解いて拒否を記録し、`runner: manual` の手書きの入口は verify の H7 が構文木で同じ形を見る。ログの保管先・保管日数・読める人の目録は設定カタログの `logging` が宣言し(K5)、転送先が本番で有効かは検査から見えないので毎回未検証と名指す |
| `fw_log_sink_optional` | ログのホストの外への転送はオプトインで、送れなくてもアプリを止めず、失敗の行にトークンも本文も載らない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-LOGSINK-001`, `TC-FW-LOGSINK-002`, `TC-FW-LOGSINK-003` | 実行時パッケージの `@kaninabe/runtime/log-sink` は、セキュリティの事象の行を標準出力に先に出したうえで、送り先(中立の `LogSink`。Axiom の綴りは adapter `@kaninabe/adapter-log-axiom` が持つ)が渡されたときだけ、応答の後に同じ瞬間の分を 1 回にまとめて送る(V16.4.3)。送り先が無ければ標準出力の口がそのまま返り、送る処理は 1 行も走らない(鍵が設定されたときだけ有効になるオプトイン。配線は製品の `composition/log-sink.ts`)。送り先が投げても・予約が投げても・失敗の行を出す口が投げても `write` は例外を出さず、失敗は理由の閉じた語(`misconfigured` / `unauthorized` / `rate_limited` / `rejected` / `server_error` / `timeout` / `network`)1 つだけの 1 行で名指し、トークン・行の中身・例外の文言は載せない。送る行は `LogRecord` のまま(欄を足さない)。adapter は送り先を `axiom.co` 配下に縛り、転送について行かず、3 秒で打ち切る。設定カタログの `logging.sink` は送り方と鍵の環境変数名を宣言し、K5 が、本番の置き場を宣言した製品にだけ転送先を求める(外す製品は理由つきの受け入れた危険として毎回名指す) |
| `fw_session_end_declared` | アカウントを止める遷移はセッションを終える効果を宣言し、生成する遷移の RPC は同じトランザクションで認証基盤を呼ぶ | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-SESSIONEND-001`, `TC-FW-SESSIONEND-002` | 認証フローの主語が状態機械のとき、終端の状態・`tone: negative` の状態へ行く遷移と、主語を匿名化する遷移は、ジョブカタログの `ends_sessions` の効果を `effects` に宣言していなければ J7 が error にする(効果が 1 本も宣言されていない製品でも。一時停止には求めない)。宣言は認証フローの主語の集約を指し、その状態機械の `effects` から積まれ、書き込みと同一トランザクションで実現される語で、`platform_call`(認証基盤の呼び出しを本文に持つ RPC。引数は uuid 1 つ)を名指しする。`realized_by` の RPC がそれを `calls` に宣言することは T19 が見る。生成する遷移の RPC は、効果を載せたイベントの `p_event_id` のときだけ、遷移と同じトランザクションの中で `platform_call` を呼ぶ本文になる(認証基盤の綴りは呼び先の本文に閉じ、生成物に出ない)。保証の範囲: 行を消した時点で `getUser` と更新は失敗し、発行済みのアクセストークンを PostgREST に直接使う経路も、全ての表の制限ポリシーが閉じる(fw_session_alive_rls) |
| `fw_logout_visible` | 認証の要る全画面が、ログアウトの遷移を持つ共有クロームを被る | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-LOGOUT-001` | 認証フロー仕様が `logout` を宣言したなら、`control`(ログアウトの操作の名前。共有クロームの `navigations[].on`)も宣言し、`requires_auth` の全画面がその遷移を持つ共有クロームを被る。被っていない画面は H8 が画面ごとに error にする(画面が自分で書いた同名の遷移は数えない)。見えることまでを見る — 押したら本当にログアウトするかは実装の木の見張りテストと E2E が持つ |
| `fw_session_server_validated` | セッションが生きているかの確かめは、署名を確かめただけのクレームではなく認証基盤への問い合わせを通る | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-SESSIONVALID-001`, `TC-FW-SESSIONVALID-002` | 非対称の署名鍵ではクレームの検証が手元で終わり、セッションが終わった(ログアウト・無効化・全端末の終了)あともアクセストークンの期限まで署名は有効なままである。セッションの adapter の `sessionMfaVerified` は `aal2` を信じる前に `getUser`(認証基盤への問い合わせ)でセッションの存在を確かめ、終わっていれば済ませていないと答える。製品の実装とセッションの adapter は cookie から読んだだけの値(`getSession`)を使わず、署名だけを確かめるクレーム(`getClaims`)の読み取りは許可した 3 か所(多要素認証の水準・ログアウトの記録の実行者・いまの端末のセッション ID)だけにある。実行者の解決は `getUser` で行う。保証の範囲: 発行済みのアクセストークンを PostgREST に直接使う経路は、全ての表の制限ポリシーが「セッションの行が実在する」ことを要求して閉じる(fw_session_alive_rls) |
| `fw_session_admin_ops` | セッションの管理(一覧・終える)は欄を絞って返し、ID の形を確かめてから呼ぶ | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-SESSIONADMIN-001` | セッションの adapter の `createSessionAdmin` は、メンバーのセッションの一覧(id・作成時刻・最後に使った時刻・User-Agent・IP だけ。RPC がほかの列を返しても通さない)・1 本終える・自分以外を終える・メンバーの全部を終える・全員を終える(除外は 1 人まで)を、特権 RPC の呼び出しとして持つ。ID が UUID の形でなければ呼ぶ前に落とし、認証基盤の応答は失敗の理由に載せない。メンバー ID を本人のセッションから導くのは呼ぶ側(製品の配線)の責務で、実 DB での挙動は製品の保証 `session_management` が見る |
| `fw_session_alive_rls` | 全ての表の RLS の migration が、ログインセッションの生死を要求する制限ポリシーを持ち、判定の関数は持ち主の権限・空の search_path で認証基盤のセッションの表を引く | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-SESSIONALIVE-001`, `TC-FW-SESSIONALIVE-002`, `TC-FW-SESSIONALIVE-003` | 署名として有効なアクセストークンは、ログアウト・強制終了でセッションが終わった後も期限(既定 1 時間)まで残る。生成する RLS の migration は、表ごとに制限ポリシー `{​表}_session_alive`(`as restrictive`・ログイン済みのロール宛て・`using ((select <​土台のスキーマ>.session_alive()))`)を 1 本出し、許可ポリシーが何本あっても・何も無くても論理積になる(未ログインのロールには掛からない)。土台の関数 `session_alive` はプラットフォームの設定の `sessionAliveExpr`(トークンが運ぶセッションの識別子が認証基盤のセッションの表に実在し、期限内であること。識別子が無ければ偽)を `security definer`・空の `search_path` の関数に包み、実 DB の定義と権限まで期待表(api-expectations)が突き合わせる。期待ポリシー表は制限ポリシーを全数に含めるので、無い表・余分な表は policy-parity が落とす。保証の範囲: 止まるのは表の行の取得で、終了の確定より後に始まった要求から効く(期限の比較は `now()`、見え方は要求のトランザクションのスナップショット。走行中の 1 要求は開始時点の見え方で答えうる)。ログイン済みのロールが呼べる補助関数(実行者の解決・隠し列の述語)は例外として閉じたセッションでも答える — 表の行は返さないが、隠し列の述語の真偽は渡した行と本人の関係のオラクルとして残る(製品の保証 session_tokens_server_only が実 DB で見る) |
| `fw_platform_op_result` | 認証基盤の操作(platform_ops)の拒否は 3 種だけで、画面の文言は仕様の表から引き、記録には理由の語も入力値も載らない | pure_function(純関数に切り出した判定(ユニットテストが実行できる)) | enforced | `TC-FW-PLATFORMOP-001` | 実行時パッケージの `@kaninabe/runtime/platform-op` は、認証基盤の操作の戻り値を成功か拒否 3 種(入力の検証・多要素認証・配線先が宣言した理由)に限る。画面に出す文言は仕様(`platform_ports` の `refusals`)の表から引き、宣言に無い理由は理由の語を出さず一般の文言にする。拒否の記録(`recordRefusal`)に載せる写しは分類と操作 ID だけで、理由の語も入力値も載せない。生成した入口・組み立ての根・画面の部品の関門の順序と対応表の整合は、製品側の検査 H9 と生成テストが見る |
| `fw_paid_entry` | 有料の口(呼び出しごとにお金を使う連携を呼ぶ Route Handler)は、認可 → 多要素認証 → 本文の上限 → 形の検査 → 枠の消費 → 有料の処理 の順を共通の入口が持ち、本文は上限を超えて読まず、枠は課金の前に消費する | pure_function(純関数に切り出した判定(ユニットテストが実行できる)), static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-PAIDENTRY-001`, `TC-FW-PAIDENTRY-002`, `TC-FW-PAIDENTRY-003`, `TC-FW-PAIDENTRY-004`, `TC-FW-PAIDENTRY-005`, `TC-FW-PAIDENTRY-006`, `TC-FW-PAIDENTRY-007`, `TC-FW-PAIDENTRY-008`, `TC-FW-PAIDENTRY-009` | 実行時パッケージの `@kaninabe/runtime/http/paid-entry` の `runPaidEntry` は、有料の口の順序を 1 か所で持つ(V2.4.1・V15.2.2)。①認可(未ログインは 401・宣言した役を持たない人は 403。本文は 1 バイトも読まない)①b多要素認証(要求する製品で、済ませていないセッションは 403。本文は読まず、枠も消費せず、有料の処理も呼ばない。保証 fw_mfa_write_boundary)②本文の上限(`Content-Length` が上限を超えていれば読まずに 413。無い・偽っているときは読みながら数え、超えた最初の塊で打ち切って溜めない)③形の検査(壊れた JSON・UTF-8 でない本文・本文なし・形の不正は 400。枠は消費しない)④枠の消費(使い切りは 429・DB が役を持たない実行者を拒めば 403。有料の処理の前)⑤有料の処理(ここまで来たときだけ)。拒否は既存の事象の目録(`authz_refused` / `mfa_refused` / `input_rejected` / `invariant_refused`)で 1 行ずつ残り、入力・経路を載せない。上限が 1 以上の整数でなければ TypeError(上限のない口を作らない)。応答の本文は固定の語だけ。口がこの入口を実際の import で使い、上限・役を生成した定数表から読み、有料の連携に届く束縛を `handler` の中でしか使わないことと、枠を消費する RPC が役を DB の行で確かめて原子的に消費することは、製品側の検査 X8 が構文木と migration の本文で見る(口の宣言は R5-7)。形の許可表の外で開いた口も落とすため、製品の口を実物のまま叩く見張りテスト(未ログイン 401・役を持たない人 403 で、本文・枠の RPC・書き込み・有料の宛先に触れない)を生成する。その観測の道具(`@kaninabe/runtime/testing/http/paid-gate`)は、役を捨てる認可・meter を呼ばない消費の口を「閉じていない」と判定する(負例で固定。TC-FW-PAIDENTRY-009) |
| `fw_connection_path_closed` | 枠の adapter の公開の口は、どれもやり直しの口を通らない生の rpc・schema・表の書き込みを返さず受け取らず、生の口の型は外から名指せない | type_system(TypeScript の型(コンパイルで落ちる)), static_scan(静的走査(ファイルと import を読むテスト。型情報は使わない)) | enforced | `TC-FW-CONNPATH-001`, `TC-FW-CONNPATH-002`, `TC-FW-CONNPATH-003`, `TC-FW-CONNPATH-004`, `TC-FW-CONNPATH-005`, `TC-FW-CONNPATH-006`, `TC-FW-CONNPATH-007` | RPC と表の書き込みの道は、やり直しの口(`@kaninabe/adapter-postgrest` の `retryRollbacks` / `retryTableWrites`)が返した型の印つきの口(`RpcSource`・`TableWriteSource`・手書きの口 `HandwrittenRpc`)だけである(掴む順の手書きの本文はこの前提でやり直しに頼る)。`framework/adapters/*` の全部の adapter は `src/__tests__/public-surface.test.ts` に公開の口の閉じた表を持ち、照らし(`@kaninabe/adapter-postgrest/testing/closed-surface`)が TypeScript の型検査器で `package.json` の `exports` の全部の鍵(文字列の入口・`test` 条件の無い `types` / `import` / `require` / `default`・入れ子の条件も型検査器と同じ順に解く。`./testing/` の入口も外さない。解けない鍵 —— `*` の入口・型のファイルを指さない・ファイルが無い —— は赤)の全部の口(値と型)を数えて、表と両方向で一致すること・各口の型を型検査器で全部の多重定義の引数と戻り値・構築子・欄(export したクラスは継承の先から届く `protected` の欄も。`private` と `#名前` は外から届かないので外す)・添字まで上限の深さ(12 段。循環は 1 回で止まる)までたどり(型引数を持つ口は、表が書いた型引数の型と、宣言の型を型の引数の制約の上限で読んだものの両方。標準の型は TypeScript の lib と Node の実行時の型で、型引数だけをたどる)、たどった先の各型を規則 `RawPathRule`(`rpc` か `schema` の関数を持つのに型の印が無い・`from` のどれか 1 本の多重定義が `select` と書き換えのメソッドを返す・口とその直下が渡す `any`)に掛けて 1 つも当たらないことを見る。上限でまだ奥に関数が続く型・型検査器が解けない型・制約の上限を解けない条件型・どの段でも口が渡す `any` は「読み切れない」として赤で、表の `UnreadAddresses` の理由つきの行(住所 → 理由。当たる住所の無い行も赤)と、宣言の行 `UnreadDeclarations`(`パッケージ/ファイル#名前` → 理由。置き場まで照らし、同じ名前の別の宣言は受けない。受けるのはその宣言の中に書かれた欄・添字・引数・戻り値の奥だけ。当たらない行も赤)だけが受ける(どちらの行の中でも生の道は名指す)。セッションの adapter の行は Realtime(チャンネルとソケットの再帰の型)・Storage・読み取りの組み立て `from().select()`(絞り込みのたびに型引数が育つ再帰の型)・Edge Functions の `functions.invoke().error`(`any`)の 7 住所 × 接続層の形 2 つと、認証基盤の SDK の利用者・ID の情報の袋 `{​ ​[key: ​string]: ​any ​}` の宣言 6 つ(`@supabase/auth-js` の `UserMetadata`・`UserAppMetadata`・`UserIdentity`・`JwtPayload`・`Pagination`・`CustomOAuthProvider`)で、`auth` のほかの所は行無しで底まで読み切れて生の道に届かない。Axiom の adapter は行を持たない。生の口の型(`RawRpc` / `RawTableWrite`)は入口が出さず、`exports` の名指しが深い住所を開かず、やり直しの口の入力の型は `object` なので、公開の口の型から生の形を引き出す道も無い(`as` で戻そうとしても名前が無い)。接続層に触る adapter は探り(`src/__tests__/surface-probe.ts`)を持ち、素通りの書き方の各行が書いた番号の型の誤りだけで落ちる(TS2305・TS2307・TS2694・TS2741・TS2345・TS2339)。保証の範囲: 構造の型を `as unknown as` で作り直す道(TypeScript の型では閉じられない)・製品が自分で `@supabase/supabase-js` を import して作る生のクライアント(製品の接続層の型が枠の読み取りだけの型であることは製品の台帳 TC-GUAR-RETRY-002/003 が見る)・表の `UnreadAddresses` の行が受けた住所の奥の、上限より深い所 |

### まだ執行されていない保証

無し(すべて enforced)。

### テストケース

| ID | type | covers | spec_ids | implementation |
| --- | --- | --- | --- | --- |
| TC-FW-CLOSURE-001 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/runtime-dependency-closure.test.ts::runtime の宣言した依存にも、配布するソースの import にも、@supabase / PostgREST / server-only が 1 つも無い` |
| TC-FW-CLOSURE-002 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/runtime-dependency-closure.test.ts::runtime の核はベンダーの依存(@supabase など)を持たず、ベンダー依存は adapters にだけ住む。依存は adapter → runtime の一方通行で、PostgREST の adapter は @supabase / server-only を持たない` |
| TC-FW-ENGINE-001 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/engine/__tests__/fire-allowed.test.ts::遷移の中身を並べただけのオブジェクトは FireAllowed として代入できない` |
| TC-FW-FNACL-001 | integration | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/function-acl-empty-plan.integration.test.ts::呼べる側も必須の作成主体も空の計画から生成した SQL は、型の解決で止まらずに流れる(対照: 型の付与を外すと止まる)` |
| TC-FW-FORMREFRESH-001 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/form-refresh.test.ts::旧い判定は触っていない欄を送り、新しい判定は触った欄だけを送る` |
| TC-FW-FORMREFRESH-002 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/form-refresh.test.ts::手元も最新も変えた欄は競合として残り、何度 refresh しても黙って解決しない` |
| TC-FW-FORMREFRESH-003 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/form-refresh.test.ts::保存 → 追加入力 → refresh が届いても、自分の保存は競合にならず追加入力は残る` |
| TC-FW-FORMREFRESH-004 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/form-refresh.test.ts::最新を取ると、手元の編集を捨てて最新になり、変更も競合も残らない` |
| TC-FW-FORMREFRESH-005 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/form-refresh-held.test.ts::保存 → 旧 props のまま再描画しても値は旧値に戻らず、refresh のあとは通常の判定になる` |
| TC-FW-FORMREFRESH-006 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/form-refresh-exhaustive.test.ts::729 通りの 2 欄の状態で、触っていない欄は dirty にならず、競合の集合は定義どおりで、冪等で、入力を書き換えない` |
| TC-FW-GUARD-001 | unit | success | framework-guarantee-catalog | `framework/runtime/src/domain/engine/__tests__/guard.test.ts::等値比較が成立すれば true を返す` |
| TC-FW-URL-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/url.test.ts::format: url の文法は受理の型と拒否の型を表で網羅し、危ないスキーム・ユーザー名・空白・制御文字・非 ASCII・長すぎる値を通さない` |
| TC-FW-URL-002 | integration | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/url-format-parity.integration.test.ts::正解表の全行で、生成される CHECK の判定(DB)と実行時の判定(TS)が一致する` |
| TC-FW-URL-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/url.test.ts::設定の URL は宣言した scheme に合わない値を例外にし、文面に値を入れない(Webhook の URL は URL 自体が秘密)` |
| TC-FW-SECRET-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/inbound/__tests__/secret.test.ts::未設定・空・下限に満たない秘密は設定されていないものとして閉じ(undefined)、下限以上は値をそのまま返す。下限が正の整数でなければ書き間違いとして例外にし、値は文面に出さない` |
| TC-FW-SECRET-002 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/inbound/__tests__/secret.test.ts::現在の秘密と更新前の秘密のどちらにも一致を受け、どちらでもなければ・受け付ける秘密が無ければ閉じる(受信の署名の検証も、鍵の並びで同じ)` |
| TC-FW-SECRET-003 | unit | other | framework-guarantee-catalog | `framework/runtime/src/inbound/__tests__/secret.test.ts::秘密の照合は timingSafeEqual で行い、等しい文字列だけが true になる(長さが違っても例外にならない)。秘密を === / !== で比べる行が無い` |
| TC-FW-REGEXP-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/regexp.test.ts::エスケープした値は、元の文字列にだけ全体一致する(敵対的な値を含む)` |
| TC-FW-TEXTINPUT-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/text-input.test.ts::利用者が入力する文字列は、制御文字と孤立した surrogate を custom で拒み、改行・復帰・タブと対の surrogate は通す` |
| TC-FW-MD-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/markdown-guarantee.test.ts::敵対的な入力の表は全行で出力が許可リストの外に出ない(件数の固定。足したら数える)` |
| TC-FW-MD-002 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/rich-text-declared.test.ts::format: markdown でない欄を書式つきで描くと止まる` |
| TC-FW-MD-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/markdown.test.ts::解釈の長さの天井を超える本文は解釈せず素の文で出す(要素は p と br だけ)` |
| TC-FW-BEARER-001 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/bearer-declared.test.ts::UUID の式・値を渡す口・URL のパスに載る route・欠けた寿命の宣言は R16 が止める` |
| TC-FW-BEARER-002 | integration | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/bearer-default.integration.test.ts::実 DB で式を 1,000 回評価すると、43 字の base64url で重複せず、宣言の綴りと pg_get_expr の綴りが一致する` |
| TC-FW-BEARER-003 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/bearer-audit.test.ts::作成の監査ログに bearer の欄の値は載らない` |
| TC-FW-NEUTRALIZE-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/neutralize.test.ts::壊した本文は、メンションの綴りを 1 つも含まない` |
| TC-FW-NEUTRALIZE-002 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/neutralize-declared.test.ts::宣言した部品をアダプタが呼んでいなければ X7 が止める` |
| TC-FW-GUARDSQL-001 | integration | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts::文法の全構成要素と NULL を振っても実 DB の述語と TS の評価器が同じ判定を下す` |
| TC-FW-GUARDSQL-002 | integration | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/guard-sql-parity.integration.test.ts::グローバル・claim・1 段と 2 段の束縛・contains・implies を振っても実 DB の述語と解決済みロールが一致する` |
| TC-FW-REFUSAL-001 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/action-error.test.ts::表に無いイベントは状態で塞がれた拒否として写す` |
| TC-FW-PLATFORMOP-001 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/platform-op.test.ts::宣言に無い理由は一般の文言になり、理由の語を画面に出さない` |
| TC-FW-REFUSALCODES-001 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/refusal-codes-parity.test.ts::errcode と接頭辞の組が過不足なく一致する` |
| TC-FW-REFUSALCODES-002 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/refusal-codes-parity.test.ts::エンジンの拒否理由 → errcode の写像が過不足なく一致する` |
| TC-FW-ROLECLAIM-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/actor-roles.test.ts::条件を満たさない実行者は、束縛が成立していても含意の先の条件を満たさないロールが付かない` |
| TC-FW-ROLECLAIM-002 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/step-decision-roles.test.ts::条件を満たさない実行者は、配列から来たロールも claim・binding で立つロールも落ちる` |
| TC-FW-ROLECLAIM-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-decide-claims.test.ts::値の集合の claim: 集合に入る状態のときだけ立つ(ログインロールは立たず未ログインと同じ)` |
| TC-FW-ROLECLAIM-004 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/rls-oracle-claims.test.ts::含意の先の条件を満たさない人は、束縛が成立していても boolean の claim が真でも立たない(E2)` |
| TC-FW-ROLECLAIM-005 | unit | success | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/rls-oracle-claims.test.ts::未ログインのロールの読み取りは、ログイン中の人にも同じに効く(条件を満たさない人・行が無い人も、見られるものが減らない)` |
| TC-FW-ROLECLAIM-006 | unit | success | framework-guarantee-catalog | `framework/runtime/src/sql/__tests__/eq-subject-actor.test.ts::名指しした集約は、的ではなく実行者の行を指す(置き直しも実行者の行に当たり、実行者の行の値に載る)` |
| TC-FW-ROLECLAIM-007 | unit | success | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/insert-order.test.ts::遅延できない外部キーの参照先を先に並べ直す(循環の遅延できる辺は後ろ向きに残す)` |
| TC-FW-RUNPLAN-001 | unit | success | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/wire.test.ts::文字列・有限数・真偽・null はそのまま運ぶ` |
| TC-FW-RUNPLAN-002 | unit | success | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-args-parity.test.ts::1 回の呼び出しに全供給元を並べても、引数の順序と JSON が旧い実装と一致する` |
| TC-FW-RUNPLAN-003 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/commit-outcome.test.ts::通信の失敗・想定外の失敗は、コミットの状態を欄に残した DbInfrastructureError として投げる` |
| TC-FW-RUNPLAN-004 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/commit-outcome.test.ts::再送の読み直し（同じキーで既存の結果が返る）でも outbox は unknown のまま・requestedEffects は要求の写しで「積んだ」とは言わない` |
| TC-FW-RUNPLAN-005 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-commit.test.ts::単発も保存点も、通信の失敗は DbInfrastructureError で投げ、コミットの状態が欄に残る（ポートは 1 回だけ呼ぶ）` |
| TC-FW-RUNPLAN-006 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-commit.test.ts::正当な値では、運ぶ JSON が正規化を入れる前と同じ（Date は ISO 8601・欄の undefined は鍵ごと運ばない）` |
| TC-FW-RUNPLAN-007 | unit | other | framework-guarantee-catalog | `framework/runtime/src/refusal/__tests__/classify.test.ts::拒否の SQLSTATE は分類の語に写り、本文の接頭辞の後ろから落ちた操作の ID を取る(message / details / hint のどこでもよい)` |
| TC-FW-RUNPLAN-008 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/intent.test.ts::意図の冪等キーは UUID の形のときだけ取り出し(小文字に揃える)、それ以外は使わない` |
| TC-FW-RUNPLAN-009 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/intent.test.ts::DB の失敗だけを書けたかどうかつきの一時的な失敗の値にし、それ以外の例外は null(呼び手が記録して投げ直す)` |
| TC-FW-SANITY-001 | unit | success | framework-guarantee-catalog | `framework/runtime/src/domain/engine/__tests__/validate.test.ts::整合の取れた表では問題を報告しない` |
| TC-FW-TABLE-001 | unit | other | framework-guarantee-catalog | `framework/runtime/src/domain/engine/__tests__/machine.test.ts::表に無いイベントは unknown_event として拒否する` |
| TC-FW-TABLE-002 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/engine/__tests__/create.test.ts::表に無いロールは作成できない（deny by default）` |
| TC-FW-TABLE-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/engine/__tests__/delete.test.ts::表に無いロールは削除できない（deny by default）` |
| TC-FW-TABLE-004 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/engine/__tests__/write.test.ts::表に無いロールは編集できない（deny by default）` |
| TC-FW-SESSIONCOOKIE-001 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-cookie-policy.test.ts::サインインの開始とログアウトが書く cookie・消す cookie は、全部が __Host- の HttpOnly・Secure・SameSite=Lax・Path=/ で、Domain を持たず、検証子は 10 分で切れる` |
| TC-FW-SESSIONCOOKIE-002 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-cookie-policy.test.ts::同じオリジンのページから出たと確かめられない要求は、開始もログアウトも 403 で、cookie を 1 本も書かず、セッションを閉じない` |
| TC-FW-TENANTRLS-001 | integration | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/tenant-boundary-rls.integration.test.ts::親の集約の列で書いた境界は、生成した RLS で他社の行を返さない` |
| TC-FW-TENANTRLS-002 | integration | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/tenant-boundary-rls.integration.test.ts::実行者の所属を付け替えたあとは、写しが古いトークンでも元の会社の行を読めない` |
| TC-FW-TENANTRLS-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/rls-oracle-boundary.test.ts::親の列の境界は、参照列を辿った先の行の列で比べる(自分の会社の部門の予約だけが見える)` |
| TC-FW-TENANTRLS-004 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/domain/__tests__/rls-oracle-boundary.test.ts::比べる相手は実行者の行であり、セッションの写しではない(写しが古くても行に従う)` |
| TC-FW-BROWSER-001 | unit | success | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/browser-defense.test.ts::nonce は乱数 16 バイトの base64 で、既定の乱数源では要求ごとに変わる` |
| TC-FW-BROWSER-002 | unit | success | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/browser-defense.test.ts::nonce は宣言した指令の先頭にだけ入り、開発の源は開発中にしか足さない` |
| TC-FW-BROWSER-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/browser-defense.test.ts::出どころを確かめられない状態を変える要求(Origin の無い Server Action・他サイトから)は、描画に進ませず 403 で閉じる` |
| TC-FW-BROWSER-004 | unit | success | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/browser-defense.test.ts::進ませる要求には同じ nonce の CSP を要求と応答の両方に載せ、応答にキャッシュの禁止を付ける` |
| TC-FW-BROWSER-005 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/request-origin.test.ts::Sec-Fetch-Site: same-origin と、自分のホストに一致する Origin の両方が揃ったときだけ同じオリジンと認める` |
| TC-FW-BROWSER-006 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/request-origin.test.ts::状態を変える要求で出どころを確かめられなければ 403(理由は書かない)、確かめられるか状態を変えない要求なら本体へ進む` |
| TC-FW-BROWSER-007 | unit | other | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/request-origin.test.ts::ログアウトの応答は 204 で、Clear-Site-Data と no-store を付ける` |
| TC-FW-MFA-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::要求するロールの実行者は、多要素認証を済ませていなければ判断にも書き込みにも届かずに拒否される` |
| TC-FW-MFA-002 | unit | success | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::多要素認証を済ませたセッションなら、要求するロールの実行者も書ける` |
| TC-FW-MFA-003 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::要求の対象外のロールの操作は、済ませていなくても通る(要求するロールを持つ人でも、その操作の判断に関わらなければ掛からない)` |
| TC-FW-MFA-004 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::サインインした実行者は、済ませていなければ対象を読む前に拒否される(対象の有無を明かさない)` |
| TC-FW-MFA-005 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::内部実行(system の入口)は要求の影響を受けない` |
| TC-FW-MFA-006 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::要求を宣言しない製品(外す宣言・認証フロー仕様を持たない)では、済ませていなくても何も変わらない` |
| TC-FW-MFA-007 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/_template/run-plan-mfa.test.ts::実行器と同じ判定を、呼び手が解いたロールで引く(要求するロールが立ち済ませていなければ拒否・済ませれば通る・要求の無い製品では何もしない)` |
| TC-FW-MFA-008 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry-mfa.test.ts::要求する製品で、多要素認証を済ませていないセッションは 403(mfa_required)で、本文を読まず・形も枠も有料の処理も呼ばれない` |
| TC-FW-MFA-009 | unit | success | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry-mfa.test.ts::多要素認証を済ませたセッションは従来どおり 認可 → 形 → 枠の消費 → 有料の処理 の順に通る` |
| TC-FW-MFA-010 | unit | other | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry-mfa.test.ts::要求しない製品(外す宣言・IdP に任せる宣言・認証フロー仕様なし = bindings.mfa が無い)では何も変わらず、セッションの解決も引かない` |
| TC-FW-SECLOG-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/security-log.test.ts::拒否の分類(権限・多要素認証・入力・状態・ガード・不変条件)ごとに、閉じた欄だけの 1 行が出る` |
| TC-FW-SECLOG-002 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/security-log.test.ts::入力値・理由文・ロール ID・指摘のフィールド名は行に載らない` |
| TC-FW-SECLOG-003 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/security-log.test.ts::認証の事象は、目録の重大度で、事象・実行者・結末・要求の識別子だけが出る` |
| TC-FW-SECLOG-004 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/security-log.test.ts::出どころの拒否は、事象・分類・要求の識別子だけを持つ(経路は載せない)` |
| TC-FW-LOGSINK-001 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/log-sink.test.ts::送り先が無ければ標準出力の口がそのまま返る(送る処理は走らない)` |
| TC-FW-LOGSINK-002 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/log-sink.test.ts::送り先が投げても write は返り、network の失敗の 1 行になる(投げた文言は載らない)` |
| TC-FW-LOGSINK-003 | unit | other | framework-guarantee-catalog | `framework/runtime/src/operation/__tests__/log-sink.test.ts::標準出力の行は先に出て、セキュリティの事象の行だけが欄を変えずに送られる` |
| TC-FW-BROWSER-008 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/route-isolation.test.ts::関門を後置した実装・関門の結果を捨てる実装・コメントに書いただけの実装・先に本文や外部に触れる実装は、閉じていないと判定する` |
| TC-FW-HTTPPARTS-001 | unit | success | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/response.test.ts::application/json; charset=utf-8 を付け、ステータスとほかのヘッダを残す` |
| TC-FW-HTTPPARTS-002 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/safe-fetch.test.ts::呼び出し側は redirect を変えられない(型に無く、実行時に渡されても "error" に決め直す)` |
| TC-FW-HTTPPARTS-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/safe-fetch.test.ts::301・302・303・307・308 の転送について行かず TypeError で失敗する(転送先に届かない)` |
| TC-FW-SAFEREDIRECT-001 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/redirect.test.ts::外のオリジンへ出る行き先は Location に載らず、既定の行き先に置き換わる` |
| TC-FW-SAFEREDIRECT-002 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/navigation/__tests__/navigation.test.ts::外のオリジンへ出る行き先は転送せず、既定の行き先に置き換わる(恒久の転送も同じ)` |
| TC-FW-SAFEREDIRECT-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/navigation/__tests__/navigation.test.ts::push / replace / assign は外のオリジンへ出る行き先を渡さず、既定の行き先に置き換わる` |
| TC-FW-SAFEREDIRECT-004 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/route-guard.test.ts::口が返した応答の Location が同じオリジンの相対パスでなければ、行き先の無い 500 にしてログを 1 行書く(綴りを問わない)` |
| TC-FW-SESSIONEND-001 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::終端の状態へ行く遷移がセッションを終える効果を宣言していなければ J7 が止め、宣言すれば通る(一時停止には求めない)` |
| TC-FW-SESSIONEND-002 | unit | success | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::生成する遷移の RPC は、効果を宣言したイベントでだけ、遷移と同じトランザクションの中で呼び出しを持つ` |
| TC-FW-LOGOUT-001 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::ログアウトの遷移を持つ共有クロームを被っていない要ログインの画面を H8 が止め、被っていれば通る` |
| TC-FW-SESSIONVALID-001 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::署名が有効で aal2 のアクセストークンでも、セッションが終わっていれば(getUser が落ちる)多要素認証を済ませたと答えない` |
| TC-FW-SESSIONVALID-002 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::製品の実装とセッションの adapter は、cookie から読んだだけの値(getSession)を使わず、署名だけを確かめるクレーム(getClaims)は許可した 3 か所だけで読む` |
| TC-FW-SESSIONALIVE-001 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-alive.test.ts::全ての表にログインセッションの生死を要求する制限ポリシーが 1 本ある(許可ポリシーの数・述語に依らない・ログイン済みのロールだけが宛先)` |
| TC-FW-SESSIONALIVE-002 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-alive.test.ts::生死を答える土台の関数は、持ち主の権限・空の search_path で認証基盤のセッションの表を引き、識別子が無ければ偽になる式を持つ` |
| TC-FW-SESSIONALIVE-003 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-alive.test.ts::宣言した全ての policies_migration が、その表の制限ポリシーを (select …) で包んで持つ(許可ポリシーだけの古い生成物を残さない)` |
| TC-FW-CONNPATH-001 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::framework/adapters の全部の adapter が閉じた表を持ち、全部の入口の全部の口が載り、どの口も生の道を返さず受け取らない。接続層に触る adapter は探りの全行が書いた番号の誤りで落ちる` |
| TC-FW-CONNPATH-002 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::照らしは生の道を名指し、表の抜け・余り・指し違い・書き方の違い・入口の抜けを赤にする(正しい形は赤にしない)` |
| TC-FW-CONNPATH-003 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::期待した誤りの番号の照らしは、別の番号で落ちる行・落ちない行・番号の無い印・印の無い行の誤り・番号のほかの誤りを全部赤にする` |
| TC-FW-CONNPATH-004 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::照らしは全部の多重定義と上限の深さまでたどり、上限で読み切れない口は表の理由つきの行が無ければ赤にする(多重定義の 1 本目・4 段目より深い所・auth.admin の作り物・行の有無と形・循環・値だけの型・解けない型・ベンダーの型・どの段の渡す any・クラスの protected の欄)` |
| TC-FW-CONNPATH-005 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::照らしは exports の全部の鍵を数え、test 条件の無い入口(文字列・types / default・入れ子)も型の入口を解いて照らし、解けない鍵は赤にする(差分点検 fix27 C27-1)` |
| TC-FW-CONNPATH-006 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::型引数を持つ口は、表が書いた型引数の 1 点だけでなく宣言の型(型の引数を制約の上限)でもたどり、上限を解けない条件型は読み切れない(差分点検 fix27 C27-4)` |
| TC-FW-CONNPATH-007 | unit | forbidden | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/connection-path-closed.test.ts::宣言の行(置き場#名前)は、その宣言の中の読み切れないものだけを受け、同じ名前の別の宣言・宣言の外の any・行の中の生の道・当たらない行・理由の短い行は赤にする` |
| TC-FW-SESSIONADMIN-001 | unit | other | framework-guarantee-catalog | `legacy/spec-tools/__tests__/guarantees/session-lifecycle.test.ts::一覧は欄を絞って返し(トークンの類は通さない)、ID が UUID の形でなければ RPC を呼ばずに落とす` |
| TC-FW-PAIDENTRY-001 | unit | success | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::通る要求は 認可 → 形 → 枠の消費 → 有料の処理 の順に進み、処理の応答がそのまま返る` |
| TC-FW-PAIDENTRY-002 | unit | invariant | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::枠を使い切っていれば 429 で、有料の処理は 1 度も呼ばれない(課金の前に断る)` |
| TC-FW-PAIDENTRY-003 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::未ログインは 401、役を持たない人は 403 で、本文は 1 バイトも読まず・形も枠も処理も呼ばれない` |
| TC-FW-PAIDENTRY-004 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::壊れた JSON・UTF-8 でない本文・本文なし・形の不正は 400 で、枠は消費しない(使えない入力で枠を減らさない)` |
| TC-FW-PAIDENTRY-005 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::Content-Length が上限を超えていれば 413 で、本文を 1 バイトも読まず、形も枠も処理も呼ばれない` |
| TC-FW-PAIDENTRY-006 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::Content-Length が無い(塊で流れる)本文は、上限を超えた最初の塊で読みを打ち切り、残りの塊を引かない` |
| TC-FW-PAIDENTRY-007 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::Content-Length が実際より小さく偽られていても、読みながら数えて 413 にする` |
| TC-FW-PAIDENTRY-008 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-entry.test.ts::maxBodyBytes が 1 以上の整数でなければ、何も呼ばずに TypeError(上限なしで動く口にしない)` |
| TC-FW-PAIDENTRY-009 | unit | forbidden | framework-guarantee-catalog | `framework/runtime/src/http/__tests__/paid-gate.test.ts::役を捨てる認可(点検 5 回目 B5-2 の probe4): 未ログインでも通り、本文を読み、枠の RPC と有料の宛先に触れる → 漏れを全部名指す` |
<!-- /AUTO-GENERATED:guarantee-body -->
