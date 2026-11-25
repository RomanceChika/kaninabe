/**
 * 通し実行の**結末の型と印字**(題材ごとの 1 行と、落ちた段の出力)。
 *
 * CLI が呼ぶ印字の側で、判断は 1 つだけ —— **黙って飛ばさない**。
 *
 *   - 実行しなかった段は「実行する段に届かなかった」と報告する(`null` を緑として数えない)
 *   - 実行した段は**本数と件数**を報告する(0 本の緑と全部の緑を区別できるようにする)
 *   - 落ちた題材は**最初に落ちた段**の出力だけを出す(後段は実行していないので出力が無い)
 */

import { appendFileSync, readFileSync } from 'node:fs';
import type { ResetResult } from './db-reset.js';
import type { TestRunResult } from './db-tests.js';
import type { ParityStage } from './db-parity.js';
import type { CoverageRunStage } from './wiring-tests.js';
import { describeWait } from '@kaninabe/runtime/testing/local/supabase-ready';

/** 題材 1 つの結末(3 段ぶん)。 */
export interface SampleOutcome {
  /** 題材の名前。 */
  readonly name: string;
  /** 一時 workdir に並べた migration の本数。 */
  readonly migrations: number;
  /** 1 段目: 空の DB への構築。 */
  readonly reset: ResetResult;
  /** 2 段目: 一致の証明と RLS の挙動(構築が落ちたら実行しないので null)。 */
  readonly tests: TestRunResult | null;
  /** 実行した RLS の挙動テストのファイル数(画面と同じ経路 = api のビューで読む)。 */
  readonly rlsFiles: number;
  /** 3 段目: 構造の突合(2 段目が落ちたら実行する段に届かないので null)。 */
  readonly parity: ParityStage | null;
  /** 配線の段: 実 DB の要らない生成した試験(DB を作る前に回す。一時ツリーが返らなかったときは null。fix27 A2)。 */
  readonly wiring: CoverageRunStage | null;
  /** 実 DB の段を持たない理由(data_table を持たない題材。持つなら null)。 */
  readonly noDb: string | null;
}

/**
 * 秒に丸めた所要。
 *
 * @param elapsedMs 所要(ミリ秒)
 * @returns 印字する字面
 */
export function seconds(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)} 秒`;
}

/**
 * 作り直したあとの待ち合わせを報告する行(待たなかったときは何も言わない)。
 *
 * **待った秒数は通ったときも印字する** —— 0 秒の緑と 20 秒の緑では「次にここが赤くなる
 * 距離」が違い、CI のログだけでそれが読めるようにしておく。
 *
 * @param reset `db reset` の結末
 * @returns 印字する行(migration が落ちて待つ段に届かなければ空)
 */
export function readyLines(reset: ResetResult): readonly string[] {
  return reset.ready === null ? [] : describeWait(reset.ready);
}

/**
 * vitest の JSON の報告から通った試験の数を読む(**件数の正**。出力の文字を読まない: 着色・報告の書式で黙って読めなくなる。fix27 差分点検 5 回目 A5-1)。
 * 報告が無い・JSON として読めない・`numPassedTests` が 0 以上の整数でないなら null(読めない = 赤)。
 *
 * @param reportFile vitest の JSON の報告
 */
export function readPassed(reportFile: string): number | null {
  try {
    const value = (JSON.parse(readFileSync(reportFile, 'utf-8')) as { numPassedTests?: unknown }).numPassedTests;
    return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
  } catch {
    return null;
  }
}

/** 走り手に返す件数の内訳(目録の samples の段の `count: { tests: [...] }` と同じ名前)。 */
export const STEP_COUNT_PARTS = ['wiring', 'generated', 'parity'] as const;

/**
 * 題材の全部で通った試験の数を、配線の段・生成テスト・構造の突合の 3 つに分けて数える。題材が実 DB の段を持たない(`noDb`)ときだけ、
 * 生成テストと突合を 0 と数える(理由つきで持たない段)。それ以外で段に届かなかった・件数を読めないものが 1 つでもあれば、その内訳は null
 * (0 として足さない。読めない = 赤)。
 *
 * @param outcomes 題材ごとの結末
 */
export function stepCounts(outcomes: readonly SampleOutcome[]): Readonly<Record<(typeof STEP_COUNT_PARTS)[number], number | null>> {
  const sum = (values: readonly (number | null)[]): number | null => (values.some((value) => value === null) ? null : (values as number[]).reduce((total, value) => total + value, 0));
  return {
    wiring: sum(outcomes.map((outcome) => (outcome.wiring === null ? null : [...outcome.wiring.kinds.values()].reduce((total, kind) => total + kind.passed, 0)))),
    generated: sum(outcomes.map((outcome) => (outcome.noDb !== null ? 0 : outcome.tests === null ? null : outcome.tests.passed))),
    parity: sum(outcomes.map((outcome) => (outcome.noDb !== null ? 0 : outcome.parity === null ? null : outcome.parity.run.passed))),
  };
}

/**
 * 走り手が段の子に渡す件数のファイル(`ST_STEP_COUNT`)に、内訳ごとの件数を 1 行ずつ書く(`<内訳> <数|null>`。読めない内訳は `null` と書く)。
 * 走り手の外(環境変数が無い)では何もしない。件数を書く口なので、開発用リポジトリでは走り手の信頼の根に固定する(件数を書く口)。
 *
 * @param outcomes 題材ごとの結末
 * @param env 環境
 */
export function writeStepCounts(outcomes: readonly SampleOutcome[], env: Readonly<Record<string, string | undefined>>): void {
  const file = env['ST_STEP_COUNT'];
  if (file === undefined || file === '') return;
  const counts = stepCounts(outcomes);
  appendFileSync(file, STEP_COUNT_PARTS.map((part) => `${part} ${String(counts[part])}\n`).join(''));
}

/** 生成テストの結末を 1 行にする。 */
function testLine(outcome: SampleOutcome): string {
  // `null` は「構築が落ちたので実行する段に届かなかった」だけである(0 本は赤として tests を持つ)。
  if (outcome.tests === null) return '生成テスト 実行する段に届かなかった';
  const count = outcome.tests.passed === null ? '件数不明' : `${outcome.tests.passed} 件`;
  return `生成テスト ${outcome.tests.ok ? '緑' : '赤'}(${count}) / ${seconds(outcome.tests.elapsedMs)}`;
}

/** 構造の突合の結末を 1 行にする(**実行したファイル数も報告する**)。 */
function parityLine(outcome: SampleOutcome): string {
  if (outcome.parity === null) return '構造の突合 実行する段に届かなかった';
  const { fired, run } = outcome.parity;
  const count = run.passed === null ? '件数不明' : `${run.passed} 件`;
  return `構造の突合 ${run.ok ? '緑' : '赤'}(${fired.length} ファイル / ${count}) / ${seconds(run.elapsedMs)}`;
}

/** 配線の段の結末を 1 行にする。 */
function wiringLine(outcome: SampleOutcome): string {
  if (outcome.wiring === null) return '配線の段 実行する段に届かなかった';
  const count = [...outcome.wiring.kinds.values()].reduce((sum, kind) => sum + kind.passed, 0);
  return `配線の段 ${outcome.wiring.run.ok ? '緑' : '赤'}(${count} 件)`;
}

/** 落ちた題材について印字する出力(最初に落ちた段のもの)。 */
function failureOutput(outcome: SampleOutcome): string {
  if (outcome.wiring?.run.ok === false) return outcome.wiring.run.output;
  if (!outcome.reset.ok) return outcome.reset.output;
  if (outcome.tests?.ok === false) return outcome.tests.output;
  return outcome.parity?.run.output ?? '';
}

/**
 * 結末を 1 行ずつ印字して、落ちた題材の数を返す。
 *
 * @param outcomes 題材ごとの結末(実行順)
 * @returns 落ちた題材の数(0 なら終了コード 0)
 */
export function report(outcomes: readonly SampleOutcome[]): number {
  console.log('');
  console.log('題材ごとの結末:');
  for (const outcome of outcomes) {
    if (outcome.noDb !== null) {
      console.log(`  ${outcome.name}: ${wiringLine(outcome)} / 実 DB の段なし — ${outcome.noDb}`);
      continue;
    }
    const verdict = outcome.reset.ok ? '通った' : '落ちた';
    console.log(
      `  ${outcome.name}: migration ${outcome.migrations} 本 ${verdict} / ${seconds(outcome.reset.elapsedMs)}` +
        ` / ${testLine(outcome)}` +
        ` / うち RLS の挙動テスト ${outcome.rlsFiles} ファイル` +
        ` / ${parityLine(outcome)}` +
        ` / ${wiringLine(outcome)}`,
    );
  }
  const failed = outcomes.filter(
    (outcome) => outcome.wiring === null || !outcome.wiring.run.ok || !outcome.reset.ok || outcome.tests?.ok === false || outcome.parity?.run.ok === false,
  );
  for (const outcome of failed) {
    console.error('');
    console.error(`samples:db: ${outcome.name} が落ちました`);
    console.error(failureOutput(outcome));
  }
  return failed.length;
}
