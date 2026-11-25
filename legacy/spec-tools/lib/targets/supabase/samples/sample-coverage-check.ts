/**
 * 題材の表(`sample-coverage.ts`)と実物の照らし(fix27 A2)。純関数で、観測は呼び手が渡す。
 *
 * 照らしは 2 つに分かれる。どちらも表の同じ行を読む(表は 1 つ):
 *
 * - **pre-commit で照らす分**(`preCommitProblems`。題材の通し実行 `__tests__/samples/coverage.test.ts` が呼ぶ。軽い)—— 生成の後の木で回し直した
 *   検査の回数と指摘・回し直す前の verify の行・生成した試験の生成器の一覧(行との双方向)・n/a の条件・ESLint の行。
 * - **試験を実行して照らす分**(`runProblems`。`samples:db` が呼ぶ。取り込みの台本と夜間)—— 段(配線 / 実 DB)ごとに、通った it の数・落ちた it・
 *   読み込みの失敗が名指す部品・拒否の観測。
 */

import type { KindOutcome } from './wiring-tests.js';

/** 行の段(どこで回るか)。 */
export type CoverageStage = 'pre-app' | 'generated-tree' | 'wiring' | 'db' | 'lint';

/** 行の段を回す関門(重さで選ぶ。軽いものは pre-commit、vitest で実行するものは取り込みの台本と夜間 = samples:db)。 */
export type CoverageGate = 'pre-commit' | 'merge-check と夜間' | '未対応';

/** n/a の条件(閉じた語。照らしが題材の実物で確かめ、崩れたら赤)。 */
export type NaCondition =
  /** 有料の連携(`spend: paid`)が 0 件(X8 の見る相手が無い)。 */
  | 'no-paid-integration'
  /** 時刻起点のジョブが 0 件(Cron の起動口の見張りの表が空で、見張る相手が無い)。 */
  | 'no-scheduled-job'
  /**
   * 本文が手書きの RPC(`kind: rpc` で `handwritten` を宣言したもの・本文の生成先 `migration` を持たない `composite`)と、本文が手書きのトリガ
   * (`kind: trigger` で `handwritten` を宣言したもの。他の表へ書く・掴むことがある)が 0 件(掴む順を逆順にぶつける相手が無い)。
   */
  | 'no-handwritten-rpc';

/** 表の 1 行。 */
export interface CoverageRow {
  readonly stage: CoverageStage;
  readonly gate: CoverageGate;
  /** 実際に回った回数(段ごとの数え方は上の表)。 */
  readonly runs: number;
  /**
   * n/a(理由と、それが成り立つ条件)。回数は 0。`ungenerated: true` は「条件が成り立つ間は、その試験を生成しない」(生成器は見るものの無い試験を出さない)—
   * 条件が成り立つのに生成されたら赤・条件が崩れたのに生成されなければ赤(試験の行の双方向は、この行を生成しない側として数える)。
   */
  readonly na?: { readonly reason: string; readonly when: NaCondition; readonly ungenerated?: true };
  /**
   * 題材にもホストの製品にも無い手書きの部品を import するので、読み込みで落ちるファイルがある(名指すモジュールと理由)。読み込みの失敗が名指す
   * モジュールの集合がこれと食い違えば赤。ソースの根の別名の指定は、別名を外したソースの根からの相対で書く(別名の綴りは配置が持つ)。
   */
  readonly absent?: { readonly modules: readonly string[]; readonly reason: string };
  /** 拒否の観測: 関門を外した木(リクエスト前段を素通し)で赤になる it の数(0 より大きいこと)。 */
  readonly refusal?: number;
  /** 未対応の行の中身(黙らせない。段 2 の宿題)。 */
  readonly pending?: string;
}

/** 題材 → 行の鍵 → 行(表の値は題材の通し実行の側 `__tests__/samples/sample-coverage.ts`)。 */
export type CoverageTable = Readonly<Record<string, Readonly<Record<string, CoverageRow>>>>;

/**
 * 「assertion が 0 の it は実行時に赤」の守りの行の鍵(`guard:require-assertions`。どの題材にも要る)。題材の木の vitest の設定が `expect.requireAssertions` を
 * 持つことを、assertion を 1 つも持たない it を 1 本置いて実行し、赤になることで見る(回数 = 赤になった it の数 = 1)。生成器が見るものの無い試験を出さない決まりの、実行時の側の網。
 */
export const GUARD_ROW = 'guard:require-assertions';

/** どの題材にも要る名指しの行(回し直す前の verify と、未対応の ESLint)。 */
export const NAMED_ROWS: readonly string[] = ['verify:pre-app', 'lint:eslint', GUARD_ROW];

/** 題材の実物から読む n/a の条件の材料。 */
export interface NaFacts {
  /** 有料の連携(`spend: paid`)の数。 */
  readonly paid: number;
  /** 時刻起点のジョブの数。 */
  readonly scheduled: number;
  /** 本文が手書きの RPC とトリガの数(data_table の `functions[]` の宣言から数える。字面は見ない)。 */
  readonly handwritten: number;
}

/** 構造の突合の行の鍵の接頭辞(`突合:{ファイル名}`)。回る突合を 1 行ずつ持つ(今は掴む順の逆順の実測だけ)。 */
export const PARITY_ROW_PREFIX = '突合:';

export { naFactsOf } from './sample-na-facts.js';

/** pre-commit で照らす観測。 */
export interface PreCommitObservation extends NaFacts {
  /** 生成の後の木で回し直した検査 ID → 見た相手の数。 */
  readonly checks: Readonly<Record<string, number>>;
  /** 回し直した検査の error の文面。 */
  readonly checkErrors: readonly string[];
  /** 試験を生成した生成器(`*.test.ts` を出したもの)。 */
  readonly testKinds: readonly string[];
}

/** 試験を実行して照らす観測。 */
export interface RunObservation extends NaFacts {
  /** 生成器 → 結末。 */
  readonly kinds: ReadonlyMap<string, KindOutcome>;
  /** 生成器 → 関門を外した木で落ちた it の数(拒否の観測を宣言した行の生成器だけ)。 */
  readonly refusal: ReadonlyMap<string, number>;
  /** assertion を 1 つも持たない it を題材の木の設定で実行して、赤になった it の数(配線の段だけ。実行しなければ undefined)。 */
  readonly assertionProbe?: number | undefined;
}

/** n/a の条件が今の題材で成り立つか。 */
function naHolds(when: NaCondition, facts: NaFacts): boolean {
  if (when === 'no-paid-integration') return facts.paid === 0;
  return when === 'no-scheduled-job' ? facts.scheduled === 0 : facts.handwritten === 0;
}

/** 行の n/a の条件が崩れていれば、その文面。 */
function naProblem(sample: string, key: string, row: CoverageRow, facts: NaFacts): readonly string[] {
  if (row.na === undefined || naHolds(row.na.when, facts)) return [];
  return [`[n/a の条件が崩れた] ${sample} × ${key} —— n/a の条件 ${row.na.when} が成り立ちません(有料の連携 ${facts.paid} 件・時刻起点のジョブ ${facts.scheduled} 件・手書きの RPC ${facts.handwritten} 件)。回る段と回数を書く(手書きの RPC が現れたなら、逆順の実 DB の試験をその題材の木で回す)`];
}

/** 鍵の集合の双方向の食い違い。 */
function twoWay(sample: string, rows: readonly string[], observed: readonly string[], what: string): readonly string[] {
  return [
    ...observed.filter((key) => !rows.includes(key)).sort().map((key) => `[行の無い生成物] ${sample} × ${key} —— ${what}なのに表(sample-coverage.ts)に行がありません(回る段と回数を足す)`),
    ...rows.filter((key) => !observed.includes(key)).sort().map((key) => `[古い行] ${sample} × ${key} —— 表に行があるのに、${what}ではありません(行を消す)`),
  ];
}

/**
 * pre-commit で照らす分の食い違い。
 *
 * @param sample 題材の名前
 * @param observed 観測
 * @param table 題材の表
 * @returns 食い違いの文面(無ければ空)
 */
export function preCommitProblems(sample: string, observed: PreCommitObservation, table: CoverageTable): readonly string[] {
  const rows = table[sample];
  if (rows === undefined) return [`[表に無い題材] ${sample} —— 題材の表(sample-coverage.ts)にこの題材の行がありません`];
  const keys = Object.keys(rows);
  const checkIds = Object.keys(observed.checks).sort();
  const problems: string[] = [
    ...NAMED_ROWS.filter((key) => rows[key] === undefined).map((key) => `[名指しの行が無い] ${sample} × ${key} —— どの題材にも要る行です`),
    ...twoWay(sample, keys.filter((key) => key.startsWith('check:')), checkIds.map((id) => `check:${id}`), '生成の後の木で回し直す検査(段の宣言 onGeneratedTree)'),
    ...twoWay(sample, keys.filter((key) => key.startsWith('test:') && rows[key]?.na?.ungenerated !== true), observed.testKinds.map((kind) => `test:${kind}`), '試験を生成した生成器'),
    ...keys.filter((key) => rows[key]?.na?.ungenerated === true && observed.testKinds.includes(key.slice('test:'.length))).map((key) => `[見るものの無い試験を生成した] ${sample} × ${key} —— 条件 ${rows[key]?.na?.when ?? ''} の行は生成しない行です(生成器は見るものの無い試験を出さない)`),
    ...observed.checkErrors.map((message) => `[回し直しの赤] ${sample} —— ${message}`),
  ];
  const preApp = rows['verify:pre-app'];
  if (preApp !== undefined && preApp.runs !== checkIds.length) problems.push(`[回数の食い違い] ${sample} × verify:pre-app —— 表は ${preApp.runs}・生成の後に回し直す検査は ${checkIds.length}`);
  const lint = rows['lint:eslint'];
  if (lint !== undefined && (lint.pending ?? '').trim() === '') problems.push(`[未対応の理由が空] ${sample} × lint:eslint —— 未対応なら中身(どの段で回すか)を書く`);
  for (const id of checkIds) {
    const key = `check:${id}`;
    const row = rows[key];
    if (row === undefined) continue;
    const seen = observed.checks[id] ?? 0;
    problems.push(...naProblem(sample, key, row, observed));
    if (row.runs !== seen) problems.push(`[回数の食い違い] ${sample} × ${key} —— 表は ${row.runs}・見た相手は ${seen}`);
    if (seen === 0 && row.na === undefined) problems.push(`[0 回の行] ${sample} × ${key} —— 生成の後の木で見る相手が 0 です(n/a なら理由と条件を書く)`);
  }
  for (const key of keys.filter((candidate) => candidate.startsWith('test:') || candidate.startsWith(PARITY_ROW_PREFIX))) {
    const row = rows[key];
    if (row !== undefined) problems.push(...naProblem(sample, key, row, observed));
  }
  for (const key of keys.filter((candidate) => candidate.startsWith(PARITY_ROW_PREFIX))) {
    // n/a で無い行は「その題材で実際に回る」宣言。手書きの RPC が 0 件なら、ぶつける相手が無いので n/a でなければ赤。
    if (rows[key]?.na === undefined && observed.handwritten === 0) problems.push(`[相手の無い突合] ${sample} × ${key} —— 手書きの RPC が 0 件なのに回る行です(n/a と条件を書く)`);
  }
  return problems;
}

/** 1 行の実行の結末の食い違い。 */
function rowRunProblems(sample: string, key: string, row: CoverageRow, outcome: KindOutcome, refusal: number | undefined): readonly string[] {
  const problems: string[] = [];
  if (outcome.failed > 0) problems.push(`[落ちた試験] ${sample} × ${key} —— ${outcome.failed} 本の it が落ちました`);
  for (const broken of outcome.broken) problems.push(`[読み込めない試験] ${sample} × ${key} —— ${broken}`);
  if (outcome.passed !== row.runs) problems.push(`[回数の食い違い] ${sample} × ${key} —— 表は ${row.runs}・通った it は ${outcome.passed}`);
  const declared = [...(row.absent?.modules ?? [])].sort();
  if (declared.join('\n') !== outcome.missing.join('\n')) {
    problems.push(`[ホストに無い部品の食い違い] ${sample} × ${key} —— 表は [${declared.join(', ')}]・読み込みの失敗が名指したのは [${outcome.missing.join(', ')}]`);
  }
  if (row.runs === 0 && row.absent === undefined && row.na === undefined) problems.push(`[0 回の行] ${sample} × ${key} —— 生成したのに 1 本も回りません(理由を書く)`);
  if (row.refusal !== undefined) {
    if (row.refusal <= 0) problems.push(`[拒否の観測が 0] ${sample} × ${key} —— 拒否の観測は 1 本以上の it で宣言する`);
    else if (refusal !== row.refusal) problems.push(`[拒否の観測の食い違い] ${sample} × ${key} —— 関門を外した木で赤になる it は表で ${row.refusal}・実測 ${refusal ?? 0}`);
  }
  return problems;
}

/** 「assertion が 0 の it は赤」の守りの行(配線の段で見る)の食い違い。 */
function guardProblems(sample: string, stage: CoverageStage, rows: Readonly<Record<string, CoverageRow>>, probe: number | undefined): readonly string[] {
  const row = rows[GUARD_ROW];
  if (row === undefined || row.stage !== stage) return [];
  if (row.runs <= 0) return [`[守りの行が 0] ${sample} × ${GUARD_ROW} —— 守りが効くことは、assertion の無い it が 1 本以上赤になることで宣言する`];
  if (probe === undefined) return [`[守りを観測していない] ${sample} × ${GUARD_ROW} —— assertion の無い it を題材の木の設定で実行していません`];
  return probe === row.runs ? [] : [`[守りが効かない] ${sample} × ${GUARD_ROW} —— assertion の無い it を実行して赤になったのは表で ${row.runs}・実測 ${probe}(題材の木の設定に expect.requireAssertions が無い)`];
}

/**
 * 試験を実行して照らす分の食い違い(1 つの段の分)。
 *
 * @param sample 題材の名前
 * @param stage 照らす段(`wiring` = 実 DB の要らない試験・`db` = 実 DB に当てる試験)
 * @param observed 観測
 * @param table 題材の表
 * @returns 食い違いの文面(無ければ空)
 */
export function runProblems(sample: string, stage: Extract<CoverageStage, 'wiring' | 'db'>, observed: RunObservation, table: CoverageTable): readonly string[] {
  const rows = table[sample];
  if (rows === undefined) return [`[表に無い題材] ${sample} —— 題材の表(sample-coverage.ts)にこの題材の行がありません`];
  const staged = Object.entries(rows).filter(([key, row]) => key.startsWith('test:') && row.stage === stage && row.na?.ungenerated !== true);
  const problems: string[] = [...twoWay(sample, staged.map(([key]) => key), [...observed.kinds.keys()].map((kind) => `test:${kind}`), `段 ${stage} で実行した生成器`)];
  problems.push(...guardProblems(sample, stage, rows, observed.assertionProbe));
  for (const [key, row] of staged) {
    const kind = key.slice('test:'.length);
    const outcome = observed.kinds.get(kind);
    if (outcome === undefined) continue;
    problems.push(...naProblem(sample, key, row, observed), ...rowRunProblems(sample, key, row, outcome, observed.refusal.get(kind)));
  }
  return problems;
}

/**
 * 題材 1 つで実際に回る突合と、閉じた表の食い違い。
 *
 * @param sample 題材の名前
 * @param fired 実際に回る突合(ファイル名)
 * @param reasons 回らない突合 → 分類が導いた理由(外れた対の理由を添える。ここに載る突合の全部が回らない対で、理由の表と照らす)
 * @param table 回る組の閉じた表(題材の表の PARITY_FIRED_PAIRS)
 * @param skippedTable 回らない対の理由の表(題材の表の PARITY_SKIPPED_PAIRS)
 * @returns 食い違いの文面(無ければ空)
 */
export function firedPairProblems(
  sample: string,
  fired: readonly string[],
  reasons: ReadonlyMap<string, string>,
  table: Readonly<Record<string, readonly string[]>>,
  skippedTable: Readonly<Record<string, Readonly<Record<string, string>>>>,
): readonly string[] {
  const expected = table[sample];
  if (expected === undefined) {
    return [`[表に無い題材] ${sample} —— 構造の突合を回す組の閉じた表(sample-coverage.ts)に、この題材の行がありません(回った ${fired.length} 本を行として足す)`];
  }
  const now = new Set(fired);
  const want = new Set(expected);
  const skipped = skippedTable[sample] ?? {};
  return [
    ...[...reasons.keys()]
      .filter((file) => !want.has(file) && (skipped[file] ?? '').trim() === '')
      .sort()
      .map((file) => `[理由の無い回らない対] ${sample} × ${file} —— 回らない理由が回らない対の表(sample-coverage.ts の PARITY_SKIPPED_PAIRS)にありません(分類: ${reasons.get(file) ?? ''})`),
    ...Object.keys(skipped)
      .filter((file) => now.has(file))
      .sort()
      .map((file) => `[回り始めた対] ${sample} × ${file} —— 回らない対の表に理由があるのに回りました(表から消し、回る組に足す)`),
    ...expected
      .filter((file) => !now.has(file))
      .map((file) => `[外れた対] ${sample} × ${file} —— 前に回っていた突合が回らなくなりました(${reasons.get(file) ?? '分類の理由なし'})`),
    ...fired
      .filter((file) => !want.has(file))
      .map((file) => `[表に無い対] ${sample} × ${file} —— 新しく回り始めた突合です(閉じた表 sample-coverage.ts に足す)`),
  ];
}
