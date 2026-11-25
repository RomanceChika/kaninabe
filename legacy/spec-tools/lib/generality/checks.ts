/**
 * 語彙漏れ・散文・パスの綴り・定型の分割理由の検査(W1〜W4)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `GENERALITY_STEPS` を上から回すだけである(走査の結果は実行口が 1 回だけ作って配る)。
 * 並びは**違反の並び**を決める。ID は各検証器のファイルが持つ ID の定数を参照する。全検査の表は `GENERALITY_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import type { OversizeCount } from './oversize-count.js';
import type { GeneralityRunInput } from './run.js';
import { VERIFIER_ID as W1, verifyVocabularyLeak } from './verifiers/w1-vocabulary-leak.js';
import { VERIFIER_ID as W2, verifyProseLeak } from './verifiers/w2-prose-leak.js';
import { W3_VERIFIER_ID as W3, verifyPathSpelling } from './verifiers/w3-path-spelling.js';
import { VERIFIER_ID as W4, repeatedReviewFindings } from './verifiers/w4-repeated-split-review.js';

/** 実行口が 1 回だけ作って各検査へ配る走査の結果。 */
export interface GeneralityScans {
  /** 仕様が宣言した語彙の母集合(カタログの語彙軸を含む)。 */
  readonly vocabulary: ReadonlySet<string>;
  /** 散文の走査の結果(W2 の違反と、免除した行数)。 */
  readonly prose: ReturnType<typeof verifyProseLeak>;
  /** 300 行を超える宣言つきファイルの数え上げ(W4 の材料)。 */
  readonly oversize: OversizeCount;
}

/** 実行の段 1 つ(検査 1 本)。 */
export interface GeneralityStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: GeneralityRunInput, scans: GeneralityScans): Finding[];
}

/** 実行の順(違反の並びを決める)。 */
export const GENERALITY_STEPS: readonly GeneralityStep[] = [
  {
    id: W1,
    title: '仕組み側コードに仕様が宣言した id と一致する文字列リテラルが無い(閉世界)',
    run: (i, s) => verifyVocabularyLeak(i.domain, s.vocabulary, i.repoRoot, i.roots, i.layout),
  },
  { id: W2, title: 'アプリ側の仕組みの層の散文に、仕様が宣言した id が例示の印なしで書かれていない', run: (_i, s) => s.prose.findings },
  { id: W3, title: '仕組みは製品の根の綴りでパスを組み立てない', run: (i) => verifyPathSpelling({ repoRoot: i.repoRoot, roots: i.roots }) },
  { id: W4, title: '同じ本文の @split-review が 3 本以上ない', run: (_i, s) => repeatedReviewFindings(s.oversize.repeated) },
];

/** W1〜W4 の全検査(全検査の表が読む)。 */
export const GENERALITY_CHECKS: readonly CheckEntry[] = GENERALITY_STEPS;
