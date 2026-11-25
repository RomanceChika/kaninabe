/**
 * S22 プレビューの断片の許可表(点検 13 回目 C13-8 の残り)。
 *
 * 製品が `previews` の根に置く断片は、コミットされた入力である。許可表(`kernel/preview-check.ts`)を通らない断片は、これまで `generate` の中で初めて止まった
 * (前提の失敗の名前は `book-preview`)。`verify` にも載せて、実装を描き直した直後に手前で分かるようにする。実測で全部の断片を見て 16 ms なので、速さの費用は無い。
 *
 * 見るのは製品が置いた断片だけである。仕様から組む部品の見本は生成の中で組まれるので、`generate` の止め方(`preview-refusal.ts`)が見る。
 * 断片の置き場が無い構成は何も見ない。
 */

import { flatFragment, previewProblems } from '../../kernel/preview-check.js';
import type { ScreenInput } from '../../model/screen/types.js';
import { previewsPath, specPath } from '../../model/product/paths.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { screenFinding } from '../verifier.js';

/** S22 の実装。 */
export const previewFragmentsVerifier: ScreenVerifier = {
  id: 'S22',
  title: 'プレビューの断片 — 製品が置いた断片が全部、許可表を通る',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const findings: Finding[] = [];
    for (const [name, fragment] of input.previews ?? []) {
      const reasons = previewProblems(flatFragment(fragment));
      if (reasons.length === 0) continue;
      findings.push(
        screenFinding('S22', {
          message: `プレビューの断片 ${name} が許可表を通りません: ${reasons.join(' / ')}`,
          location: { file: previewsPath(ctx.roots) ?? specPath(ctx.roots, 'frontend/screens') },
          suggestion: '実装が描く HTML を許可表の中に直す(許可表は legacy/spec-tools/lib/kernel/preview-check.ts)。直したら cd app && npm run book:previews で断片を書き直す',
          counterexample: { fragment: name, reason: reasons[0] ?? '' },
        }),
      );
    }
    return findings;
  },
};
