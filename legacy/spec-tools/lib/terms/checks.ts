/**
 * 用語の台帳と人が書く文の検査(M7〜M12)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `TERM_STEPS` を上から回すだけである。並びは**違反の並び**を決める。
 * ID は各検証器のファイルが持つ `VERIFIER_ID` を参照する。全検査の表(`lib/compose/all-checks.ts`)は `TERM_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { LEDGER_SCHEMA_VERIFIER_ID } from '../model/terms/loader.js';
import type { TermCorpus, TermLedgerSpec } from '../model/terms/types.js';
import { VERIFIER_ID as M7, verifyFirstExists } from './verifiers/m7-first-exists.js';
import { VERIFIER_ID as M8, verifyDeadTerms } from './verifiers/m8-dead-term.js';
import { VERIFIER_ID as M9, verifyAvoidedSpellings } from './verifiers/m9-avoided-spelling.js';
import { VERIFIER_ID as M10, verifySummaryGrounding } from './verifiers/m10-summary-grounding.js';
import { VERIFIER_ID as M12, verifyProseStyle } from './verifiers/m12-prose-style.js';

/** 実行の段 1 つ(検査 1 本)。 */
export interface TermStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(ledger: TermLedgerSpec, corpus: TermCorpus): Finding[];
}

/** 実行の順(違反の並びを決める)。 */
export const TERM_STEPS: readonly TermStep[] = [
  { id: M7, title: '台帳の各行の first(初出)に、その語が実在する', run: (ledger, corpus) => verifyFirstExists(ledger, corpus) },
  { id: M8, title: '台帳の語が走査範囲のどこにも出てこない(死んだ語)', run: (ledger, corpus) => verifyDeadTerms(ledger, corpus) },
  { id: M9, title: '台帳が avoid に挙げた綴りが本文に出ていない(旧綴りの再発を止める)', run: (ledger, corpus) => verifyAvoidedSpellings(ledger, corpus) },
  {
    id: M10,
    title: '人が書く文(summary)が仕様に書かれた語だけで書かれている',
    run: (ledger, corpus) =>
      verifySummaryGrounding(corpus.summaries, {
        specText: corpus.specText,
        ledgerWords: ledger.terms.flatMap((decl) => [decl.term, decl.id]),
      }),
  },
  { id: M12, title: '人が書く文(summary)が文体の規則を守っている', run: (_ledger, corpus) => verifyProseStyle(corpus.summaries) },
];

/** 用語の台帳まわりの全検査(ローダーの M11 を含む。全検査の表が読む)。 */
export const TERM_CHECKS: readonly CheckEntry[] = [
  { id: LEDGER_SCHEMA_VERIFIER_ID, title: '用語の台帳のスキーマ適合(ローダーが実施)' },
  ...TERM_STEPS,
];
