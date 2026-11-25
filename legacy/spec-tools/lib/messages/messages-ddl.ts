/**
 * 生成 DDL(表の形の migration)に出る**仕組みの文言**。
 *
 * 生成物が SQL でも事情は同じである —— 別のアプリに移したときに何が日本語のまま残るかは、
 * ここを見れば分かる(`messages.ts` の `RPC_BODY_WORDS` / `messages-rls.ts` と同じ規約)。
 */

/**
 * **api スキーマの土台**(`{14 桁}_api_base.sql`)の SQL に出る固定の文言。
 *
 * 中身がどのアプリでも同じである以上、ここに出る日本語も仕組みの文言である。
 *
 * **文言の中の仕様の欄名・種類名は旧い綴りのまま据え置く**(`api_base_migration` = 現 `surface_base_migration`・`api_spec` = 現 `surface_spec`。
 * 適用済みの migration の先頭コメントに同じ文があり、1 文字直すと次の generate と食い違う = C23)。直せるのは次に出す migration から。
 */
export const API_BASE_WORDS = {
  /** 正がどこにあるか(ファイル先頭)。表と違い、正になる仕様ファイルが無い。 */
  generatedNote: [
    'api スキーマの土台(スキーマ・呼び出し主体を解決する関数 3 本・その権限)である。',
    '中身はどのアプリでも同じであり、仕様が宣言するのは書き出す先のファイル名である',
    '(data_table の api_base_migration)。',
  ],
  /**
   * スキーマと使用権の節。
   *
   * 適用済みの migration に同じ文があり、台帳の語(例: surface)に改めると次の generate と食い違う(C23)ので、
   * 旧い綴りのまま据え置く。直せるのは次に出す migration から。
   */
  schema: '外から届く面(仕様から生成したビューと RPC)を置くスキーマ。',
  /** 呼び出し主体の識別子を返す関数の説明。 */
  actorId: '呼び出し主体の識別子。未ログインなら空を返す。',
  /** 一般利用者かどうかを返す関数の説明。 */
  isEndUser:
    '呼び出し主体がブラウザ経由の一般利用者かどうか。偽(特権のある接続)なら隠し列のマスクを無条件に解く。',
  /** ログインセッションがいまも生きているかを返す関数の説明。 */
  sessionAlive:
    'ログインセッションがいまも生きているか。トークンが運ぶセッションの識別子が認証基盤のセッションの表に実在し、期限内であれば真。' +
    'ログアウト・強制終了でセッションの行が消えた後は、署名として有効なトークンでも偽(識別子の無い呼び出しも偽)。' +
    '行の読み取りの RLS(制限ポリシー)が全ての表で要求する。',
} as const;

/**
 * **特権ロールの権限**(`{14 桁}_grants.sql`)の SQL に出る固定の文言。
 *
 * 節の見出しは `DDL_WORDS` の `privilegedGrants` / `grants` をそのまま使う(同じ意味の節に
 * 2 つの文言を持たない)。ここが持つのは**ファイル先頭の 2 つの note** だけである。
 */
export const GRANTS_WORDS = {
  /** 正がどこにあるか(ファイル先頭)。表と違い、正になる仕様ファイルが無い。 */
  generatedNote: [
    '表の権限(特権ロールに与える 1 組と、ポリシーを持たない表の面のロールの剥奪)である。',
    '与える権限はどの表でも同じであり、仕様が宣言するのは書き出す先のファイル名である',
    '(api_spec の grants_migration)。載る表は data_table の全数である。',
    '末尾に、関数の実行権限の閉世界(面のロールから呼べるのは宣言した関数だけ)も載る。',
  ],
  /** 追記専用の歴史との両立のしかた(ファイル先頭)。 */
  migrationNote: [
    '権限が変わる変更をしたら grants_migration の名前を新しくする(適用済みの migration は',
    '書き換えない。migrations.md §生成 migration)。中身は冪等なので、新しいファイルを',
    '流すと宣言どおりの権限へ寄る。連番と表の DDL の前後関係は無い —— 表ごとの権限は',
    'その表が在るときだけ流す(存在ガード)。表を 1 枚足すとこのファイルの中身が変わるので、',
    'そのとき採番し直せば新しい表も拾われる。',
  ],
  /** 関数の実行権限の節の見出しと説明(節の先頭)。 */
  functionGrants: [
    '関数の実行権限の閉世界。関数は作った瞬間に PUBLIC へ実行権限が開き、プラットフォームの既定では',
    '面のロールにも名指しで付く。`revoke … from public` は後者に触れないので、ここで宣言の外の関数',
    '(手続き・集約を含む)から面のロールと PUBLIC の実行権限を外す。面のロールから呼べるのは、土台の関数・隠し列の',
    '述語・RLS 補助関数(いずれも自分の宣言の migration が `grant execute` を持つ)だけである。',
    '書き込みの RPC は実行者を引数で信じるので、面のロールから呼べてはならない。',
  ],
  /** 新しい関数の既定の実行権限を、作成主体ごとに閉じることの説明。 */
  functionDefaults: [
    '新しい関数(手続き・集約を含む)の実行権限は、作った役の既定から決まる。既定は全体の付与と、スキーマごとの',
    '付与の 2 層で、どちらも役ごとの別の行であり、加算で効く(片方を外してももう片方は残る)。関数を作る役',
    '(と実行した役)ごとに、全体からも各スキーマからも PUBLIC と面のロールの両方を外す(宣言する関数は',
    '自分の migration で `grant execute` する)。実在するのに書き換えられない役があれば止める。',
  ],
  /** 外部の作成主体(migration から触れない役)を名指しするコメントの前書き(節の先頭の説明の後ろ)。 */
  externalCreators: [
    '次の作成主体はプラットフォームが持つ役で、この migration からは既定の実行権限を閉じられない。',
    'この役が後から作る関数の既定は閉じていない —— 保証は、流す時点の一覧の剥奪と、閉世界の突合',
    '(function-acl-parity)が持つ。',
  ],
  /** 外部の作成主体(migration の責務の外)の既定を、接続の役がメンバーなら外すことの説明。 */
  functionExternalBestEffort: [
    'プラットフォームが持つ作成主体は migration の責務の外だが、接続の役がそのメンバーなら既定も外す',
    '(メンバーでなければ触れない。止めない —— 下の事後条件が、残った付与を名指しして止める)。',
  ],
  /** 事後条件の説明(宣言の外の関数に、面のロールか PUBLIC の実行権限が残っていれば止める)。 */
  functionPostcondition: [
    '事後条件: 宣言の外の関数(拡張が持つものを除く)に、面のロールか PUBLIC の実行権限が 1 つでも残って',
    'いれば止める。外せなかった付与(所有者でない役が作った関数など)を黙って通さない。',
  ],
  /** 事後条件の例外の文(`%` に「関数 → 宛先」の並びが入る。SQL の文字列に入るので引用符を含めない)。 */
  leftoverRoutines: '宣言の外の関数に面のロールか PUBLIC の実行権限が残っています(外せなかった付与です。所有者の役で外すか、関数を宣言に加えてください): %',
  /** 実在する必須の作成主体の既定を書き換えられないときの例外の文(`%` に役の名前が入る。SQL の文字列に入るので引用符を含めない)。 */
  blockedCreator: '作成主体 % は実在しますが、この接続の役はそのメンバーではありません。この役の既定の実行権限を外せないので止めます(外す権限のある役で流してください)',
  /** sequence の権限の閉世界の節の見出し(点検 3 回目 A3-6)。 */
  sequenceGrants: [
    'sequence の権限の閉世界。表の revoke は sequence に効かず、プラットフォームの既定は面のロールに usage / select / update を',
    '与える(nextval / setval で採番を動かせる)。面のロールは表へ直に書かない(書き込みは全部 security definer の RPC を通る)ので、',
    '計画のスキーマの全 sequence から面のロールと PUBLIC の権限を外し、新しい sequence の既定の付与も作成主体ごとに閉じる。',
    '事後条件: 面のロールか PUBLIC の権限が 1 つでも残っていれば止める。',
  ],
  /** sequence の事後条件の例外の文(`%` に「sequence → 宛先」の並びが入る)。 */
  leftoverSequences: 'sequence に面のロールか PUBLIC の権限が残っています(外せなかった付与です。所有者の役で外してください): %',
  /** 必須の作成主体の sequence の既定を書き換えられないときの例外の文。 */
  blockedSequenceCreator: '作成主体 % は実在しますが、この接続の役はそのメンバーではありません。この役の sequence の既定の権限を外せないので止めます(外す権限のある役で流してください)',
} as const;

/**
 * **仕組みが自分で持つ表の執行点**(`framework-guards.ts`)の SQL に出る固定の文言。
 *
 * 権限とトリガは列と違って仕様のどこにも現れない(正は設計図)ので、そこに出る日本語も
 * 仕組みの文言である。拒否の文面は**実行時に人が見る唯一の文**であり、別の言語のアプリを
 * 起こすときに訳す対象になる。
 */
export const FRAMEWORK_GUARD_WORDS = {
  /** 追記専用を執行するトリガ関数の説明。 */
  appendOnlyFunction: '監査ログの改変を拒否する(特権のある接続からの更新・削除も含む)。',
  /** 改変を拒否したときに返す文面(`%` に SQL の操作名が入る)。 */
  appendOnlyRefusal: 'この台帳は追記専用です(% は許可されません)。',
} as const;

/** 生成 DDL の SQL に出る固定の文言。 */
export const DDL_WORDS = {
  /** 追記専用の歴史との両立のしかた(ファイル先頭)。 */
  migrationNote: [
    'DDL が変わる仕様変更をしたら ddl_migration の名前を新しくする(適用済みの migration は',
    '書き換えない。migrations.md §生成 migration)。中身は冪等なので、新しいファイルを',
    '流すと宣言どおりの形へ寄る。',
  ],
  /** 列を落とさない・型を変えないことの宣言(ファイル先頭)。 */
  additiveNote: [
    '**列は足すだけである** —— 落とさない・型は変えない。データに触る判断は人が手で書く',
    'migration で行い、宣言と実 DB の食い違いは突合(ddl-parity)が名指しで落とす。',
  ],
  /** 排他制約が要求する拡張。 */
  extension: '鍵の等値比較を gist 索引に載せるために要る(排他制約の前提)。',
  /** 採番の器の節(表より前に出す)。 */
  sequences:
    '列の既定値が採番に使う器。**表より前に作る** —— 既定値の式がこれを呼ぶので、' +
    '後ろに置くと表そのものが作れない。',
  /** 表そのもの。 */
  table: '表が無ければ作る(あれば何もしない)。',
  /** 列を足す節。 */
  columns: '宣言にあって DB に無い列を足す。既にある列には触れない(NOT NULL は人の判断)。',
  /** 導出 CHECK を置き換える節。 */
  derivedChecks: 'entity_spec から導出される CHECK。同じ式なら置き換えても差分にならない。',
  /** 宣言された非導出 CHECK を置き換える節。 */
  declaredChecks: '規則を仕様が持つ CHECK(data_table の checks[].rule)。',
  /**
   * 外部キーの節。
   *
   * **この文言は束「表の DDL を再発行しない変更の置き場」で 1 度だけ変えた** —— 置き場の規則
   * (番号の大きい側 → 両側に存在ガードつき)そのものが変わり、同じ束で全表の採番をやり直して
   * いたので、固着の代償が無かった(C23。migrations.md §生成 migration)。以後は変えない。
   */
  foreignKeys:
    '外部キー。**両側の表のファイルに出す** —— 両方の表が在って、その列にまだ外部キーが' +
    '無いときだけ張るので、先に当たった側は通り過ぎ、後から当たった側で張られる' +
    '(相互参照する 2 表でも当たる)。既にある(名前が違っていても同じ列の)ものには触れない。',
  /** 索引の節。 */
  indexes: '索引(主キーの裏は除く)。',
  /** 排他制約の節。 */
  exclusions: '排他制約。鍵が一致する行どうしで期間が重ならないことの執行点である。',
  /**
   * 権限の節(surface から外し、特権にだけ開ける)。**ポリシーを 1 本も持たない表が使う。**
   *
   * 出る先は**権限の migration**(`grants-migration.ts`)である —— 表の DDL に置いていた
   * ころは、仕組みの 1 行を変える日に表の数だけ migration が動いた。
   *
   * **文言を変えない。** この行は適用済みの migration に出ており、変えるとそのファイルが
   * 書き換わる(C23。migrations.md §生成 migration)。
   */
  grants:
    '権限。ブラウザから届くロールの既定権限を剥奪し、特権のある接続にだけ開ける' +
    '(更新・削除をあえて残す表では、執行点はトリガ 1 箇所である)。',
  /**
   * 権限の節(**ポリシーを持つ表**。特権のある接続だけを触る)。
   *
   * ブラウザから届くロールの権限はポリシーの migration が持つ(`reads` が正)ので、
   * ここで触らない —— 触ると同じ文が 2 つの生成物に出るうえ、可視性を変えただけで
   * 権限の migration の採番をやり直すことになる。出る先は `grants-migration.ts` である。
   */
  privilegedGrants:
    '権限。特権のある接続(RLS をバイパスするロール)の既定権限を剥奪し、宣言した分だけ' +
    '与え直す —— Supabase は新しい表に truncate / references / trigger / maintain を' +
    '既定で与えるので、「与えていない」は剥奪してはじめて成り立つ。' +
    'ブラウザから届くロールの権限はポリシーの migration が持つ(reads が正)。',
  /** 祖先の列の写しを埋めるトリガ関数の説明(`comment on function`)。 */
  copyTrigger: '祖先の列の写しを埋める。',
  /** 同じ行の日時列から一定の幅だけずらして導くトリガ関数の説明(`comment on function`)。導出の一覧が続く。 */
  deriveTrigger: '同じ行の日時列から一定の幅だけずらした値を埋める',
  appendTrigger: '親の行を排他で掴み、同じ親の下の末尾の番号を埋める',
  /** 条件を課すトリガ関数の説明(`comment on function`)。由来の不変条件 ID が続く。 */
  checkTrigger: '不変条件の執行点',
  /** 作成の後に変えない列を凍らせるトリガ関数の説明(`comment on function`。`ddl-freeze-triggers.ts`)。凍らせる列が続く。 */
  freezeTrigger: '作成の後に変えない列を凍らせる',
  /** 凍結の拒否の文面の不変条件 ID の位置に置く語(由来の不変条件を宣言しない凍結)。 */
  freezeWord: 'frozen',
  /** 凍結の拒否の文面(凍らせた列の並びが前に付く)。 */
  freezeRefusal: ' は作成の後に変えられません',
  /**
   * 執行のトリガの節(改変を拒否するもの・祖先の列の写しを埋めるもの)。
   *
   * **文言を変えない。** この行は適用済みの migration(`framework:` の表の DDL)に
   * 出ており、変えるとそのファイルが書き換わる(C23。migrations.md §生成 migration)。
   */
  guardTriggers:
    '執行のトリガ。まだ無いときだけ作る —— `drop` → `create` にすると、その窓のあいだ' +
    '拒否されるべき改変が通る。',
  /** RLS を有効にする 1 行の意味。 */
  enableRls: 'ポリシーが 1 本も無い表は全不可視になる(RLS が無効だと素通しになる)。',
  /** コメントの節。 */
  comments: '列の説明(entity_spec の description の写し)と、制約の由来(不変条件 ID)。',
} as const;

/**
 * 未ログインの作成の天井(`creates[].abuse`)の執行点を生成するトリガの文言。
 *
 * 拒否の文面の先頭は `{トリガ名}: {不変条件 ID}: ` で、呼び出し側の写像(制約名 → 不変条件 ID)がこの先頭を拾う。
 * 隔離の水準の拒否は**天井の超過ではない**(環境の前提が破れている)ので、不変条件 ID もトリガ名(制約名)も載せない
 * (呼び出し側の写像は本文から制約名・不変条件 ID を探すので、載せると天井の超過と誤読される)。
 */
/** 天井の鍵の受け入れの理由の前半(鍵の名前の前)。 */
const CEILING_ACCEPT_HEAD =
  '未ログインの作成の天井(生成物。access_spec の creates[].abuse から導いた受け入れ)は、数える行の集合に掴める親の行が無いので、表ごとの鍵 1 つ(';

/** 天井の鍵の受け入れの理由の後半(鍵の名前の後)。 */
const CEILING_ACCEPT_TAIL =
  ')で数えを直列化する。鍵を持った取引はその後に新しい行も別の鍵も待たない(api の関数の全部の閉包で acceptedKeyProblems が確かめる)ので、行を持って鍵を待つ相手と輪にならない';

/**
 * 天井の鍵の受け入れの理由の断片(生成物の日本語を分解する文言表の一部。`generate/message-fragments.ts` が束ねる)。
 *
 * @returns 断片
 */
export function ceilingFragments(): readonly string[] {
  return [CEILING_ACCEPT_HEAD, CEILING_ACCEPT_TAIL];
}

export const CEILING_WORDS = {
  /** 天井の鍵の受け入れの理由(生成物 dataTableParityAccepts。宣言から導く行。点検 26 回目の後の判断待ち 1)。 */
  advisoryAccept: (lockKey: string): string => `${CEILING_ACCEPT_HEAD}${lockKey}${CEILING_ACCEPT_TAIL}`,
  /** 天井の執行点の関数の説明(`comment on function`)。 */
  comment: '未ログインの作成の天井の執行点(コミット時評価。表への作成の全部を数える)',
  /** 全体の天井を超えた拒否の文面。 */
  globalRefusal: (max: number, per: string): string => `この表への作成が全体の天井(${per} に ${max} 件)を超えています`,
  /** 鍵ごとの天井を超えた拒否の文面。 */
  perKeyRefusal: (column: string, max: number, per: string): string =>
    `同じ ${column} の作成が鍵ごとの天井(${per} に ${max} 件)を超えています`,
  /** 隔離の水準が read committed でないときの拒否の文面(点検 D25s-3 で serializable も断る)。 */
  isolationRefusal:
    '取引の隔離の水準が read committed でない(repeatable read・serializable)ため、未ログインの作成の天井を数えられません(古い snapshot で先に確定した行を数え落とし、serializable も read committed の取引との交錯は検出しないので拒否します。read committed で実行してください)',
} as const;

/**
 * 親の下の末尾の番号のトリガ(`sql/ddl-derive-triggers.ts` の `appendLines`)の文言。
 *
 * 隔離の水準の拒否は**不変条件の違反ではない**(環境の前提が破れている)ので、不変条件 ID もトリガ名(制約名)も載せない。
 */
export const APPEND_WORDS = {
  /** 隔離の水準が read committed でないときの拒否の文面(点検 25 回目 A25-2。D25s-3 で serializable も断る)。 */
  isolationRefusal:
    '取引の隔離の水準が read committed でない(repeatable read・serializable)ため、親の下の末尾の番号を数えられません(古い snapshot で先にコミットされた番号を見落とし、serializable も read committed の取引との交錯は検出しないので拒否します。read committed で実行してください)',
} as const;

/**
 * 別の集約の列との等式の制約トリガ(`sql/ddl-cross-check-body.ts`)の文言。
 *
 * 隔離の水準の拒否は**不変条件の違反ではない**(環境の前提が破れている)ので、不変条件 ID もトリガ名(制約名)も載せない
 * (呼び出し側の写像は本文から制約名・不変条件 ID を探すので、載せると不変条件の違反と誤読される)。
 */
export const CROSS_CHECK_WORDS = {
  /** 隔離の水準が read committed でないときの拒否の文面(点検 D25s-3 で serializable も断る)。 */
  isolationRefusal:
    '取引の隔離の水準が read committed でない(repeatable read・serializable)ため、別の集約の列との等式を確かめられません(古い snapshot で先にコミットされた行を見落とし、serializable も read committed の取引との交錯は検出しないので拒否します。read committed で実行してください)',
} as const;

/**
 * 参照の欄が指す行を読む条件の**相手の端**の制約トリガ(`sql/ddl-ref-check-body.ts`。fix25s)の文言。
 *
 * 隔離の水準の拒否は不変条件の違反ではないので、不変条件 ID もトリガ名も載せない(`CROSS_CHECK_WORDS` と同じ理由)。
 */
export const REF_CHECK_WORDS = {
  /** 隔離の水準が read committed でないときの拒否の文面(点検 D25s-3 で serializable も断る)。 */
  isolationRefusal:
    '取引の隔離の水準が read committed でない(repeatable read・serializable)ため、参照される行の書き換えが条件を破らないかを確かめられません(古い snapshot で先にコミットされた行を見落とし、serializable も read committed の取引との交錯は検出しないので拒否します。read committed で実行してください)',
} as const;
