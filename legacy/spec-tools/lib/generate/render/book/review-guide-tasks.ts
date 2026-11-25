/**
 * レビューの手引きの「タスクから読む」節のデータ(ADR-0011 §5: ユースケース → 画面 → 操作カードの順に配る)。
 *
 * 題・導入・行を `review-guide.ts` と `html/review-guide-chapter.ts` が共有する。導入に入る各章へのリンクは、文を部品に割って呼ぶ側で解く(`text-segments.ts`)。
 * 純粋関数だけ。
 */

import type { SpecModel } from '../../../model/types.js';
import type { ScreenSpecModel } from '../../../model/screen/types.js';
import type { UsecaseInput } from '../../../usecase/derive.js';
import { deriveScreens, flattenSteps } from '../../../usecase/derive.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { RESULT_WORDS } from '../../../messages/messages-results.js';
import { operationCatalogsOf } from '../action-attributes-derive.js';
import { gatesOf } from '../gates-input.js';
import { gatesBlocked, gatesUnverifiedNote } from '../../../relations/screen-reachability/index.js';
import type { Segment } from './text-segments.js';

/** 空のスクリーン仕様モデル(ctx.screens が無い環境向けの安全側フォールバック)。 */
function emptyScreens(): ScreenSpecModel {
  return {
    available: false,
    screens: [],
    chromes: [],
    unexposed: [],
    unreachableStates: [],
    unseenStates: [],
  };
}

/** 「タスクから読む」の節の題。 */
export const TASK_HEADING = 'タスクから読む';

/** 「タスクから読む」の導入(各章へのリンクが文の途中に入る)。 */
export const TASK_INTRO: readonly Segment[] = [
  `レビューは**${RESULT_WORDS.readingOrder}**の順に読む` +
    '(ADR-0011 §5 の順に、結果表を 1 段足したもの)。ドメインの厳密さを疑うのではなく、' +
    'その厳密さを人にどう見せているかを疑う。' +
    '詳しい物語と数えた面倒は',
  { label: 'タスクの章', to: 'usecases' },
  '、画面の見え方は',
  { label: '画面の章', to: 'screens' },
  '、**結末(どういう場合に落ちるか)**は',
  { label: '操作の章', to: 'actions' },
  'と',
  { label: 'タスクの章', to: 'usecases' },
  'の結果表にある。',
];

/** 「タスクから読む」の 1 行ぶん(画面と操作は `` `識別子` `` を含む文)。 */
export interface TaskLine {
  readonly goal: string;
  readonly screens: string;
  readonly ops: string;
}

/**
 * 「タスクから読む」節の行(ADR-0011 §5: ユースケース → 画面 → 操作カードの順に配る)。
 *
 * `ctx.usecases` が無い環境では null(タスクをまだ仕様化していない = この順序を提案できる材料が無い)。
 */
export function taskLines(model: SpecModel, ctx: GenerateContext): readonly TaskLine[] | null {
  if (ctx.usecases?.available !== true || ctx.usecases.usecases.length === 0) return null;
  const input: UsecaseInput = {
    domain: model,
    usecases: ctx.usecases,
    actions: ctx.actions ?? null,
    screens: ctx.screens ?? emptyScreens(),
    gates: gatesOf(ctx),
    catalogs: operationCatalogsOf(ctx),
  };
  return [...ctx.usecases.usecases]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((usecase) => {
      const ops = flattenSteps(usecase).map(({ step }) => `\`${step.op}\``);
      // 関門が分からない(採ったのに読めない)とき、空の関門で探索した到達を「到達不能」と断定しない。
      const screens = gatesBlocked(input.gates)
        ? `(未検証。${gatesUnverifiedNote('到達')})`
        : deriveScreens(usecase, input)
            .screenIds.map((id) => `\`${id}\``)
            .join(' → ') || '(到達不能。Y3 を先に直す)';
      return { goal: usecase.goal, screens, ops: ops.join(', ') };
    });
}
