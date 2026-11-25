/**
 * UX 検証器のレジストリ。
 *
 * 検査を 1 つ足すときに触るのはこのファイルだけであり、CLI も run.ts も変わらない
 * (規約: scripts-code-quality.md「インターフェース先行」)。
 *
 * U2(画面横断の操作の語の一貫性)は、操作の表示名が宣言から生成物へ引かれるようになってから
 * 静的に検査できるので解禁した(docs/design/ux-lint-draft.md §2)。番号は欠番を詰めずに U2 のまま使う。
 */

import type { UxVerifier } from '../verifier.js';
import { destructiveConfirmVerifier } from './u1-destructive-confirm.js';
import { wordingVerifier } from './u2-wording.js';
import { deadEndVerifier } from './u3-dead-end.js';
import { choiceCountVerifier } from './u4-choice-count.js';
import { formLengthVerifier } from './u5-form-length.js';

/** 実行順に並べた全 UX 検証器。 */
export const ALL_UX_VERIFIERS: readonly UxVerifier[] = [
  destructiveConfirmVerifier,
  wordingVerifier,
  deadEndVerifier,
  choiceCountVerifier,
  formLengthVerifier,
];
