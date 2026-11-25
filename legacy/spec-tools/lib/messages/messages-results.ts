/**
 * **結果表**(束 ⑳-5b)に出る仕組みの文言。
 *
 * 結果表は「こういう場合は落ちるよ」を人に見せる表である。表に出る日本語は 2 種類しか無い ——
 * 仕様の label(ロール・状態・欄・イベント)と、ここに並ぶ仕組みの語(✅ / ❌ / 拒否の分類の
 * 言い換え)である。別のアプリに移したときに何を訳せばよいかは、ここを見れば分かる。
 *
 * 拒否の分類の語は**engine の `reason` の言い換え**であり、増やすものではない —— engine が
 * 返す分類は 5 つで閉じている(`unknown_event` / `invalid_from` / `role_forbidden` /
 * `guard_unsatisfied` / `guard_unknown`)。表に無い分類が来たら、それ自体が反例として出る。
 */

/** 通った印。 */
export const RESULT_ALLOWED = '✅';

/** 落ちた印。 */
export const RESULT_REFUSED = '❌';

/** その組み合わせが列挙に無い(畳まれた・実行しない)。 */
export const RESULT_ABSENT = '—';

/** 結果表に出る文言。 */
export const RESULT_WORDS = {
  /** 折り畳みの見出し(操作)。 */
  operationSummary: (op: string, count: number): string => `${op} の結果表(全 ${count} 通り)`,
  /** 折り畳みの見出し(保存点)。 */
  saveSummary: (label: string, count: number): string => `${label} の結果表(全 ${count} 通り)`,
  /**
   * 表の読み方(操作)。**列が何かは形で違う**ので、その 1 文だけを差し替える。
   *
   * 状態を持つ形は状態が列、編集は欄が列(`canWrite` は欄ごとに判定する)、どちらも無い形は
   * 1 列である —— 「列は対象の状態」と決め打つと、40 表のうち 23 表で前書きが嘘になる。
   */
  operationLead: (columns: string): string =>
    `行は**実行者**(その人と、ロール配列の 3 通り)、${columns}。` +
    'セルは先読み(engine)の判定そのもので、同じ判定を DB 側の執行も下すことは生成した' +
    '一致の証明が実 DB で実測している。ガード変数の境界(成立 / 不成立)はセルの中に注記する。' +
    '結末が同じ列はまとめてある(見出しにその全部を並べる)。',
  /** 列が何か(状態を持つ形)。 */
  columnsAreStates: '列は**対象の状態**である',
  /** 列が何か(編集。`canWrite` は欄ごとに判定する)。 */
  columnsAreFields: '列は**動かす欄**である(判定は欄ごとに走る)',
  /** 列が何か(状態も欄も持たない形)。 */
  columnsAreSubject: '列は**対象**の 1 本だけである(状態も動かす欄も持たない形)',
  /** 表の読み方(保存点)。 */
  saveLead:
    '行は**実行者と呼び出し元の文脈**、列は**手順**である。実行器は手順の順に `permit` を立て、' +
    '1 つでも立たなければそこで止まるので、**落ちた手順より後ろは「判定に届かない」**と書く。',
  /** 列の見出し(実行者)。 */
  actorHeader: '実行者',
  /** 列の見出し(ロール配列)。 */
  arrayHeader: 'ロール配列',
  /** 列の見出し(呼び出し元の文脈。保存点の軸は配列ではなくこちらである)。 */
  callerHeader: '呼び出し元の文脈',
  /** 列の見出し(状態を持たない形の 1 列)。 */
  subjectHeader: '対象',
  /** ロール配列の 3 通りの言い換え。 */
  arrays: {
    from_session: 'セッションから解決',
    from_runtime: 'システム起点',
    empty: '渡さない',
    from_stale: '古いロール一覧(DB が行の条件で落とす)',
  } as Readonly<Record<string, string>>,
  /** 実行者の根拠の言い換え(`basis`)。 */
  basis: {
    binding: '対象の行から立つ役',
    claim: '自分の行から立つ役',
    default: 'ログインしただけの人',
    no_row: '認証済みだが自分の行が無い人',
  } as Readonly<Record<string, string>>,
  /** 根拠は成立しているが、そのロールの行の条件(ADR-0018)を満たさない人の言い換え(引数はロールの表示名)。 */
  unmet: (role: string): string => `${role}の条件を満たさない`,
  /** 判定に届かなかった手順。 */
  notReached: '判定に届かない',
  /** 拒否の分類(engine の `reason` の言い換え)。 */
  reasons: {
    unknown_event: 'その操作を知らない',
    invalid_from: '状態違い',
    role_forbidden: '権限が無い',
    guard_unsatisfied: '前提が成立しない',
    guard_unknown: '前提を読めない',
  } as Readonly<Record<string, string>>,
  /** 表に無い分類が来たとき(それ自体が反例)。 */
  unmappedReason: '表に無い拒否の分類',
  /** 許されるロールの並び。 */
  allowedRoles: (roles: string): string => `許されるのは ${roles}`,
  /** 成立しなかったガード条件。 */
  guardNote: (guard: string): string => `条件: ${guard}`,
  /** ガード変数の値の注記(境界が見えるようにする)。 */
  axisNote: (values: string): string => `(${values})`,
  /** 一致の証明が無い(world を宣言から作れない)。 */
  noProof: (reason: string): string => `一致の証明が無い —— ${reason}`,
  /** その RPC が拒否を返さない(`shape: composite`)。 */
  unenforced:
    'この操作の RPC は判定を持たない(`shape: composite`)—— 下の表は**先読みだけ**が守って' +
    'いる範囲である。',
  /** 手順の RPC が拒否を返さない。 */
  unenforcedSteps: (ops: string): string =>
    `次の手順の RPC は判定を持たない(\`shape: composite\`)—— その拒否は DB 側では実測して` +
    `いない: ${ops}`,
  /**
   * 代表値に畳んだ軸(表の主張の範囲)。
   *
   * **表に出ていない値は「実行していない」である。** 畳んだ軸があることを書かずに表だけを出すと、
   * 読む人は「全部の組み合わせを見た」と受け取る —— 主張が実際より広くなる。
   */
  foldedNote: (axes: string): string =>
    `代表値に畳んだ軸がある(${axes})—— 表に出ていない値はこの表では実行していない`,
  /** 畳んだガード変数 1 本の内訳。 */
  foldedGuard: (key: string, satisfying: string, refuting: string): string =>
    `${key} 成立 ${satisfying} / 不成立 ${refuting}`,
  /** 元データの置き場への案内。 */
  dataNote: (file: string): string => `畳む前の全列挙(機械が読む形): \`${file}\``,
  /** 章の頭に置く案内(操作カードの下に畳んである)。 */
  chapterNote:
    '操作ごとに**結果表**が畳んである(「結果表」の折り畳みを開く)—— 「誰が・どの状態のものを' +
    '動かせるか」と、**どういう場合に落ちるか**を、宣言ではなく**結末**で並べた表である。' +
    '判定は先読み(engine)そのものであり、同じ判定を DB 側の執行も下すことは生成した一致の証明が' +
    '実 DB で実測している。',
  /** 章の頭に置く案内(保存点の下に畳んである)。 */
  saveChapterNote:
    '**保存点ごとに**結果表が畳んである(「結果表」の折り畳みを開く)—— 「誰が・どの手順で' +
    '落ちるか」を、宣言ではなく**結末**で並べた表である。判定は先読み(engine)そのものであり、' +
    '同じ判定を DB 側の執行も下すことは生成した一致の証明が実 DB で実測している。',
  /** 「—」(そのマスは実行していない)の説明。 */
  absentNote: `\`${RESULT_ABSENT}\` は**そのマスを実行していない**印である(行と列の組み合わせが列挙に無い)。`,
  /** 判断ポイントの内訳に出る見出し(レビューの手引きが件数を添えて出す)。 */
  reasonKindsLabel: '結果表の ❌ の理由',
  /** 読む順(レビューの手引き)。 */
  readingOrder: 'タスク → 画面 → 結果表 → ドメイン(句として)',
} as const;

/**
 * 結果表に出る文言の**断片**(出力側の目が生成物の日本語を説明するのに使う)。
 *
 * @returns 断片の全数(空白だけの断片は落とす)
 */
export function resultFragments(): readonly string[] {
  const hole = '\u{E000}';
  return [
    RESULT_WORDS.operationSummary(hole, 0).split('0').join(hole),
    RESULT_WORDS.saveSummary(hole, 0).split('0').join(hole),
    RESULT_WORDS.operationLead(hole),
    RESULT_WORDS.columnsAreStates,
    RESULT_WORDS.columnsAreFields,
    RESULT_WORDS.columnsAreSubject,
    RESULT_WORDS.saveLead,
    RESULT_WORDS.actorHeader,
    RESULT_WORDS.arrayHeader,
    RESULT_WORDS.callerHeader,
    RESULT_WORDS.subjectHeader,
    ...Object.values(RESULT_WORDS.arrays),
    ...Object.values(RESULT_WORDS.basis),
    RESULT_WORDS.unmet(hole),
    RESULT_WORDS.notReached,
    ...Object.values(RESULT_WORDS.reasons),
    RESULT_WORDS.unmappedReason,
    RESULT_WORDS.allowedRoles(hole),
    RESULT_WORDS.guardNote(hole),
    RESULT_WORDS.noProof(hole),
    RESULT_WORDS.unenforced,
    RESULT_WORDS.unenforcedSteps(hole),
    RESULT_WORDS.foldedNote(hole),
    RESULT_WORDS.foldedGuard(hole, hole, hole),
    RESULT_WORDS.chapterNote,
    RESULT_WORDS.saveChapterNote,
    RESULT_WORDS.absentNote,
    RESULT_WORDS.dataNote(hole),
    RESULT_WORDS.reasonKindsLabel,
    RESULT_WORDS.readingOrder,
  ].flatMap((text) => text.split(hole).filter((part) => part.trim() !== ''));
}
