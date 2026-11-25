/**
 * W4: **同じ本文の `@split-review` が 3 本以上ない**こと(warning)。
 *
 * 300 行を超えるファイルは、冒頭の JSDoc の `@split-review` に「責務で割れるかを検討した結果」
 * (割る案と、採らなかった具体の理由)を書く。ここに**どのファイルにも貼れる文**(例: 「割ると
 * 2 枚を行き来するので割らない」)を書くと、宣言は検討の跡ではなく使い回しの文になる。
 * ファイル 1 本を見る規則(`layer/declared-oversize`)には見えない**ファイルをまたぐ性質**なので、
 * 全ファイルを数える verify がここで拾う。
 *
 * warning である —— 同じ文が正しいファイルもありうる(3 本が本当に同じ理由で割れない)ので、
 * 機械は「使い回しに見える」と言うだけで、直すか(そのファイルで実際に考えたことを書く)・
 * そのままにするかは人が決める。組 1 つにつき 1 件で、ファイルを名指しする。
 *
 * 判定の本体は `@kaninabe/lint-config` の `oversize.mjs` の `repeatedSplitReviews`(純関数)で、
 * ここはそれが返した組を Finding にするだけである。
 */

import type { RepeatedReview } from '../../io/oversize-rule.js';
import type { Finding } from '../../kernel/finding.js';

/** 検証器 ID。 */
export const VERIFIER_ID = 'W4';

/** 人に示す本文の長さ(これを超える分は省く)。 */
const EXCERPT_LENGTH = 60;

/**
 * 使い回しの組を Finding にする。
 *
 * @param groups 同じ本文の `@split-review` の組(3 本以上)
 * @returns W4 の警告(組 1 つにつき 1 件。組が無ければ空)
 */
export function repeatedReviewFindings(groups: readonly RepeatedReview[]): Finding[] {
  return groups.map((group) => {
    const excerpt = [...group.body].length > EXCERPT_LENGTH ? `${[...group.body].slice(0, EXCERPT_LENGTH).join('')}…` : group.body;
    return {
      verifier: VERIFIER_ID,
      severity: 'warning',
      message: `同じ本文の @split-review が ${String(group.files.length)} 本ある(「${excerpt}」)— どのファイルにも貼れる文は検討の跡にならない`,
      location: { file: group.files[0] ?? '' },
      suggestion:
        '各ファイルの @split-review を、そのファイルで実際に考えられる割り方(例: 状態ごとに割る・読む側と書く側に割る)と、' +
        '採らなかったファイル固有の理由に書き直す(理由が書けないなら割れるので、責務の境界で割る)',
      counterexample: { files: group.files.join(', ') },
    };
  });
}
