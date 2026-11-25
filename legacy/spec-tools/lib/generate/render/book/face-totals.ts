/**
 * 人向けの表示の章の**読む量の数**(必読 = 公理 + 受け入れ / 変更 / 参照)と、読み手ごとの内訳。
 *
 * 集計(`face-facts.ts` の `FaceFacts`)から出す純粋関数だけ。章のカード・本文・「数の出どころ」・手引きが
 * 同じ数を読む。必読の読み手(業務 / 開発者)は項目の種類で決まる(`semantics/reading-class.ts`)。
 */

import { readerOf, readerOfFinding, type ReadingReader } from '../../../semantics/reading-class.js';
import { acceptItems, acceptTotal } from '../../../semantics/reading-load.js';
import type { FaceFacts, TestRow } from './face-facts.js';

/** 公理の内訳(合計は `ReadingTotals.axioms`)。 */
export interface AxiomBreakdown {
  /** 不変条件(この章の範囲)。 */
  readonly invariants: number;
  /** 不変条件(写した分)。 */
  readonly carried: number;
  readonly access: number;
  readonly states: number;
  readonly summaries: number;
  /** 計算の例の表の行。 */
  readonly examples: number;
}

/** 読み手 1 人ぶんの必読の内訳(公理は業務の判断なので、業務にだけ載る)。 */
export interface ReaderTotals {
  readonly axioms: number;
  /** 理由つきの受け入れ(人が通した分)。 */
  readonly reasoned: number;
  /** まだ通していない受け入れ(検証器の警告)。渡されていなければ null。 */
  readonly pending: number | null;
  /** 必読(公理 + 受け入れ。まだ通していない分が引けていなければ、引けた分だけ)。 */
  readonly required: number;
}

/** 読む量の数(必読 = 公理 + 受け入れ)。 */
export interface ReadingTotals {
  /** 公理の本数(不変条件のこの章 + 写した分 + アクセスの宣言の行・状態の意味・要約の文・計算の例の表の行)。 */
  readonly axioms: number;
  /** 公理の内訳。不変条件(この章の範囲 / 写した分)と、それ以外の 4 種。 */
  readonly axiomParts: AxiomBreakdown;
  /** 理由つきの受け入れ(人が通した分)。 */
  readonly reasoned: number;
  /** まだ通していない受け入れ(検証器の警告)。渡されていなければ null。 */
  readonly pending: number | null;
  /** 受け入れの合計(理由つき + まだ通していない)。 */
  readonly accept: number;
  /** 必読(公理 + 受け入れ)。 */
  readonly required: number;
  /** 変更(基点つきのときだけ)。 */
  readonly changed: number | null;
  /** 参照 = 導出の件数(遷移 + 執行点 + テスト + ジョブ)。 */
  readonly derived: number;
  /** 読み手ごとの必読(業務 + 開発者 = `required`)。 */
  readonly byReader: Readonly<Record<ReadingReader, ReaderTotals>>;
}

/** 読み手 1 人ぶんの必読。 */
function readerTotals(facts: FaceFacts, reader: ReadingReader, axioms: number): ReaderTotals {
  const reasoned = acceptItems(facts.accept).filter((item) => readerOf(item.element) === reader).length;
  const pending = facts.pending === null ? null : facts.pending.filter((finding) => readerOfFinding(finding.verifier) === reader).length;
  return { axioms, reasoned, pending, required: axioms + reasoned + (pending ?? 0) };
}

/** 読む量の数。数え方は章の「数の出どころ」が説明する。 */
export function readingTotals(facts: FaceFacts): ReadingTotals {
  const parts: AxiomBreakdown = { invariants: ownAxiomCount(facts), carried: facts.carried.length, ...facts.axiomParts };
  const axioms = Object.values(parts).reduce((sum, count) => sum + count, 0);
  const reasoned = acceptTotal(facts.accept);
  const pending = facts.pending === null ? null : facts.pending.length;
  const accept = reasoned + (pending ?? 0);
  return {
    axioms,
    axiomParts: parts,
    reasoned,
    pending,
    accept,
    required: axioms + accept,
    changed: facts.changes === null ? null : facts.changes.items.length,
    derived: facts.transitions + facts.enforcementOwn + facts.enforcementCarried + testTotal(facts.tests) + facts.jobs,
    byReader: { business: readerTotals(facts, 'business', axioms), developer: readerTotals(facts, 'developer', 0) },
  };
}

/** 公理の本数(範囲の中)。 */
export function ownAxiomCount(facts: FaceFacts): number {
  return facts.own.reduce((sum, group) => sum + group.invariants.length, 0);
}

/** テストの件数の合計。 */
export function testTotal(tests: readonly TestRow[]): number {
  return tests.reduce((sum, row) => sum + row.unit + row.integration, 0);
}
