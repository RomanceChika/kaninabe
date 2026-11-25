/**
 * 6 軸の差分(導出の側)と公理の側の差分を、**1 つの結果にまとめる**段。
 *
 * 公理の側の源(不変条件の言明・表示名・要約の写し)が**読めなかった**ことは、6 軸が読めなかったときと同じく
 * 「判定できなかった生成物」として結果の問題に載せる(赤になる)。公理の側だけ別の扱いにすると、
 * 壊れた写しが「公理の側に動いたものはありません」として通る。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { ProductRoots } from '../model/product/types.js';
import type { ReadingChange } from '../semantics/reading-change.js';
import { axiomReading } from './axioms.js';
import { readAxiomFacts } from './axiom-read.js';
import { semanticDiff } from './collect.js';
import type { DiffOutcome, SideSnapshot } from './types.js';

/** 6 軸と公理の側をまとめた結果。 */
export interface FullDiff {
  /** 6 軸の差分。問題には公理の側の源が読めなかった報告も入る。 */
  readonly outcome: DiffOutcome;
  /** 公理の側の差分(読めなかった源の分は含まない)。 */
  readonly axiom: readonly ReadingChange[];
}

/**
 * 2 版の写しから、6 軸と公理の側の差分を組み立てる。
 *
 * @param base 基点側の写し
 * @param head 比較先の写し
 * @param roots 製品が宣言した根
 */
export function semanticDiffWithAxioms(base: SideSnapshot, head: SideSnapshot, roots: ProductRoots): FullDiff {
  const outcome = semanticDiff(base, head, roots);
  const reading = axiomReading(readAxiomFacts(base, roots, 'base'), readAxiomFacts(head, roots, 'head'));
  return {
    outcome: { ...outcome, problems: [...outcome.problems, ...reading.problems] },
    axiom: reading.changes,
  };
}
