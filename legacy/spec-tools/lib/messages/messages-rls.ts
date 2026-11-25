/**
 * 生成 RLS の SQL(ポリシーと補助関数)に出る**仕組みの文言**。
 *
 * 生成物が SQL でも事情は同じである —— 別のアプリに移したときに何が日本語のまま残るかは、
 * ここを見れば分かる(`messages.ts` の `RPC_BODY_WORDS` と同じ規約)。
 */

/** 生成 RLS の SQL に出る固定の文言。 */
export const RLS_WORDS = {
  /** 追記専用の歴史との両立のしかた(ポリシーのファイル先頭)。 */
  policiesMigrationNote: [
    'SQL が変わる仕様変更をしたら policies_migration の名前を新しくする(適用済みの',
    'migration は書き換えない。migrations.md §生成 migration)。ポリシーは drop してから',
    'create するので、新しいファイルが同じ名前のポリシーを置き換える。',
  ],
  /** 追記専用の歴史との両立のしかた(補助関数のファイル先頭)。 */
  helperMigrationNote: [
    'SQL が変わる仕様変更をしたら functions[].migration の名前を新しくする(適用済みの',
    'migration は書き換えない。migrations.md §生成 migration)。関数は create or replace',
    'なので、新しいファイルが同じ名前の関数を置き換える。',
  ],
  /** 既定の権限を落としてから付け直す理由。 */
  revokeFirst: [
    '既定の権限を落としてから、reads に対応する分だけを付け直す。書き込みの直接経路は',
    '作らない(全書き込みは security definer の RPC を通る)ので、付け直すのは select だけ',
    'である。RLS をバイパスする内部実行ロールの権限はここでは触らない。',
  ],
  /** RLS を有効にする 1 行の意味。 */
  enableRls: 'ポリシーが 1 本も無い表は全不可視になる(RLS が無効だと素通しになるので必ず有効にする)。',
  /** ポリシーを作り直す形の意味。 */
  replacePolicy: '同じ名前のポリシーを置き換える(何度流しても同じ結果になる)。',
  /** 補助関数が security definer である理由。 */
  helperDefiner: [
    '実行者の集約の行を見るので security definer にする —— その集約自身のポリシーの中から',
    '同じ表を読むと再帰するためである(所有者は自分の表の RLS を適用されない)。',
  ],
  /** 補助関数の `comment on function` に出る説明の作り。 */
  helperComment: (label: string, role: string): string => `${label}(roles.md のロール ${role})として立っているか`,
  /** 境界の補助関数が実行者の行を読む理由(セッションの写しを信じない)。 */
  boundaryHelperSource: [
    '境界(reads[].filters)の右辺の値は実行者自身の行から読む —— セッションの写し(トークンの属性)は',
    'トークンの寿命だけ古く、所属を付け替えたあとも古い所属の行を見せ続けるためである。',
  ],
  /** 境界の補助関数の `comment on function` に出る説明の作り。 */
  boundaryHelperComment: (entity: string, field: string): string =>
    `現在の実行者の ${field}(${entity} の行の値。境界の判定の正)`,
  /** ログインセッションの生死の制限ポリシーの上に出す説明(全ての表に同じ 1 本)。 */
  sessionAliveNote: [
    '制限ポリシー(restrictive)は、他の全ての許可ポリシーと論理積になる。ログアウト・強制終了でセッションの行が消えた',
    '後は、署名として有効なトークンでもこの表は 0 行になる(識別子の無い呼び出しも同じ)。許可ポリシーの述語に',
    '「実行者の行がある」が含まれていても、トークンの寿命の間は残るので、行の読み取りの関門として別に置く。',
  ],
  /** ポリシー 1 本の上に出す由来の行の作り。 */
  policyOrigin: (role: string, scope: string): string => `ロール ${role} / スコープ ${scope}`,
  /** 境界(テナント)を足したことを示す行の作り。 */
  policyBoundary: (fields: string): string => `実行者の属性で狭める境界: ${fields}`,
  /** 行の状態で見え方を絞る条件を足したことを示す行の作り。 */
  policyCondition: (when: string): string => `行の状態で見え方を絞る条件: ${when}`,
} as const;

/**
 * テナント境界の見張りテストのテスト名(表名と実行者の欄から機械的に決まる)。
 *
 * テストケースの宣言の宛先でもあるので**仕様から機械的に決まる**(T4 がその宣言の実在を見て、生成器が同じ名前の
 * `it` を書く)。検査器と生成器が読む共有の文言なので、文言の層に置く。
 *
 * @param table 物理テーブル名
 * @param actorField 実行者の属性の欄名(`filters` の右辺 `actor.{欄}` の `{欄}`)
 * @returns そのテーブルの境界見張りテストのテスト名
 */
export function tenantCanaryTestName(table: string, actorField: string): string {
  return `${table} は実行者の ${actorField} 以外の行を返さない`;
}

/**
 * 生成した RLS の**挙動テスト**に出る文言(束 ⑳-4b)。
 *
 * テスト名はテストケースの宣言の宛先でもあるので、**仕様から機械的に決まる**(T3 / T4 と同じ流儀)。
 * 名前を規約にすると、宣言を足した人がどこに何が現れるかを検査のメッセージが答えられる。
 */
export const RLS_TEST_WORDS = {
  /** テストの束(describe)の見出し。 */
  suite: (table: string): string => `${table} の RLS の挙動(生成)`,
  /** ロールごとの検査のテスト名。 */
  byRole: (table: string, role: string): string =>
    `${table} は ${role} として読むと宣言どおりの行だけが返る`,
  /** 境界(filters)を持つ表に足す「別の境界のもう 1 人」の検査のテスト名。 */
  byOtherTenant: (table: string, role: string): string =>
    `${table} は別の境界を持つもう 1 人の ${role} に宣言どおりの行だけが返る`,
  /** 「根拠は成立しているが行の条件を満たさない人」の検査のテスト名(ADR-0018)。 */
  byUnmetCondition: (table: string, role: string, gate: string): string =>
    `${table} は ${role} の根拠があっても ${gate} の行の条件を満たさない人に宣言どおりの行だけが返る`,
  /** 「ログインしているが実行者の集約に行が無い人」の検査のテスト名。 */
  byActorWithoutRow: (table: string, actorTable: string): string =>
    `${table} は ${actorTable} に行が無いログイン実行者に宣言どおりの行だけが返る`,
  /** world が設計図どおりに作られたことの検査のテスト名。 */
  worldBuilt: (table: string): string => `${table} の world が設計図どおりに作られている`,
} as const;

/** 差し込み位置を表す印(断片に分けるときだけ使う。出力には現れない)。 */
const HOLE = '\u0000';

/**
 * 挙動テストに出る文言の**断片**(出力側の目が生成コードの日本語を説明するのに使う)。
 *
 * テンプレートの穴に印を入れて割るので、**表はここ 1 つのまま**である ——
 * 断片を手で書き写すと、文言を直したときに片方だけが古くなる。
 *
 * @returns 断片の全数(空白だけの断片は落とす)
 */
export function rlsTestFragments(): readonly string[] {
  return [
    RLS_TEST_WORDS.suite(HOLE),
    RLS_TEST_WORDS.byRole(HOLE, HOLE),
    RLS_TEST_WORDS.byOtherTenant(HOLE, HOLE),
    RLS_TEST_WORDS.byUnmetCondition(HOLE, HOLE, HOLE),
    RLS_TEST_WORDS.byActorWithoutRow(HOLE, HOLE),
    RLS_TEST_WORDS.worldBuilt(HOLE),
    tenantCanaryTestName(HOLE, HOLE),
  ].flatMap((text) => text.split(HOLE).filter((part) => part.trim() !== ''));
}
