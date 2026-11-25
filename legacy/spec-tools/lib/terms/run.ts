/**
 * 用語の台帳の検証(M7〜M9)と、人が書く文の検査(M10 = 語の接地・M12 = 文体)の実行口。
 *
 * ローダー(M11)が構築した台帳と、走査(I/O)が読んだ本文を検証器に流すところまでをまとめる。
 * 配線(lib/compose/verify-pipeline.ts)はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。チェック内容の正は term-ledger-writing.md。
 */

import type { Finding } from '../kernel/finding.js';
import type { TermCorpus, TermLedgerModel } from '../model/terms/types.js';
import { TERM_STEPS } from './checks.js';

/** runTermVerification の結果。 */
export interface TermRunResult {
  readonly findings: Finding[];
  /** 台帳があったか。false なら M7〜M9 は実行していない。 */
  readonly available: boolean;
  /** 読み込めた語の数(CLI のサマリ表示用)。 */
  readonly termCount: number;
}

/**
 * 台帳の検証(M7〜M9)を実行する。
 *
 * 台帳が無い環境(まだ開設していない製品・台帳が壊れて読めなかったとき)では検証をスキップする
 * —— 読めなかった理由は M11 が別に報告しているので、ここで二重に言わない。
 *
 * @param model 読み込み済みの台帳
 * @param corpus 走査入力(本文と `first` の生テキスト)
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runTermVerification(model: TermLedgerModel, corpus: TermCorpus): TermRunResult {
  if (!model.available || model.ledger === null) return { findings: [], available: false, termCount: 0 };
  const { ledger } = model;
  return {
    findings: TERM_STEPS.flatMap((step) => step.run(ledger, corpus)),
    available: true,
    termCount: ledger.terms.length,
  };
}
