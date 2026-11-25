/**
 * S17(`kind: form` の部品の宣言の書き間違い)の**文面**(事実 → 日本語)。
 *
 * 判定そのもの(どの部品の宣言が書き間違いか)は `lib/screen/verifiers/s17-form-component.ts` にある。
 * ここは事実を受けて字面を組むだけで、文言の層に置く。
 */

/** `kind: form` の部品の書き間違い(事実。文面は持たない)。 */
export type FormComponentProblem =
  /** chrome の部品に書いた(chrome は操作を持たない)。 */
  | { readonly kind: 'in_chrome'; readonly chrome: string; readonly component: string }
  /** `action` が 2 つ以上ある(1 部品 1 操作)。 */
  | { readonly kind: 'not_single'; readonly screen: string; readonly component: string; readonly actions: readonly string[] }
  /** 載せる操作が、その画面の `actions`(重ね表示を含む)に居ない。 */
  | {
      readonly kind: 'not_declared';
      readonly screen: string;
      readonly component: string;
      readonly action: string;
      readonly declared: readonly string[];
    }
  /** 載せる操作が作成でも編集でもない(遷移・削除はフォームではなくボタン)。 */
  | {
      readonly kind: 'wrong_shape';
      readonly screen: string;
      readonly component: string;
      readonly action: string;
      readonly shape: 'transition' | 'delete';
    }
  /** 載せる操作が `runner: manual`(実行計画の外)で、フォームの材料が無い。 */
  | { readonly kind: 'manual_runner'; readonly screen: string; readonly component: string; readonly action: string }
  /** 同じ操作を別の `kind: form` 部品がすでに載せている。 */
  | {
      readonly kind: 'duplicate';
      readonly screen: string;
      readonly component: string;
      readonly action: string;
      readonly first: string;
    };

/** 指摘の文面(message と suggestion)。 */
export interface FormComponentWords {
  readonly message: string;
  readonly suggestion: string;
}

/** 操作の形の呼び名。 */
const SHAPE_WORDS = { transition: '状態機械の遷移', delete: '削除' } as const;

/**
 * 書き間違い 1 つの文面(事実 → 日本語)。
 *
 * @param problem 書き間違い(事実)
 * @returns 指摘の message と suggestion
 */
export function formComponentProblemWords(problem: FormComponentProblem): FormComponentWords {
  switch (problem.kind) {
    case 'in_chrome':
      return {
        message: `chrome ${problem.chrome} の部品 ${problem.component} に kind: form は書けません`,
        suggestion:
          'chrome は操作を持たない外枠である(actions を書けない)。フォームは画面の layout の部品に書く。' +
          '共有クロームに置きたい操作の入口はリンク(navigations)にする',
      };
    case 'not_single':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の action が ${problem.actions.length} つあります(${problem.actions.join(' / ')})`,
        suggestion:
          '1 部品 1 操作にする。2 つの操作のフォームが要るなら部品を分けて、それぞれに kind: form と action を書く',
      };
    case 'not_declared':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の action ${problem.action} が、この画面の actions にありません`,
        suggestion:
          `画面の actions に ${problem.action} を足す(いまある操作: ${listWords(problem.declared)})。` +
          '画面が起こすと宣言していない操作を、部品が載せてよい道理は無い',
      };
    case 'wrong_shape':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の action ${problem.action} は${SHAPE_WORDS[problem.shape]}で、フォームにできません`,
        suggestion:
          'kind: form が載せられるのは作成(create)か編集(update)の操作だけである。' +
          '遷移と削除は欄を持たないのでフォームではなくボタン(確認つきの重ね表示を含む)で出す。' +
          'この部品は kind を書かない手書きの部品にするか、作成・編集の操作を指す',
      };
    case 'manual_runner':
      return {
        message: `画面 ${problem.screen} の部品 ${problem.component} の action ${problem.action} は runner: manual の操作で、フォームを生成できません`,
        suggestion:
          'manual の操作は実行計画の外にある(定型では書けない)ので、入力欄の集合を仕様から導けない。' +
          'この部品は kind を書かない手書きの部品にする。計画で走るように仕様を直せる(runner を外せる)なら、' +
          'A15 が runner: manual の宣言を error にするので、そちらを先に直す',
      };
    case 'duplicate':
      return {
        message: `画面 ${problem.screen} の ${problem.action} のフォームを ${problem.component} と ${problem.first} の両方が載せています`,
        suggestion:
          '同じ操作のフォームは 1 つにする(2 つあると生成物が同じ操作の入口を 2 つ持ち、どちらが正か決まらない)。' +
          'どちらかの kind / action を消す',
      };
  }
}

/** 候補の並び(空なら「なし」)。 */
function listWords(items: readonly string[]): string {
  return items.length === 0 ? 'なし' : items.join(' / ');
}
