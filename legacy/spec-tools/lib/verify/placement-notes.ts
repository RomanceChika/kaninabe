/**
 * A2(続き・実装の置き場の取り合い)の実行ログ — 使えなかった入力のために**見ていない分**を名指す。
 *
 * 置き場の取り合いは、操作(action_spec)・保存点とフォーム(usecase_spec)・受信の配線(外部連携カタログ)の 3 つの主張の集まりを突き合わせる。
 * どれかの入力が**阻害**(採ったのに検査へ渡せない)なら、その分の主張は作れない。取り合いの違反が 0 件でも、見ていない分があるのに
 * 「全部見た」に見えてはならないので、見ていない分を 1 行ずつ言う。未選択(製品が採っていない)は事実として主張が無いので言わない。
 * 実装の木が無い製品は置き場が無く検査そのものが走らないので、何も言わない(「操作・保存点・フォームの分は見ました」とも言わない)。
 */

import type { CatalogInput } from '../kernel/input-state.js';

/** 置き場の主張を作る入力の状態(種類ごと)。 */
export interface PlacementInputs {
  /** action_spec(操作の入口と組み立ての根の主張)。 */
  readonly actions: CatalogInput<unknown>;
  /** usecase_spec(保存点の入口・組み立ての根・1 画面フォームの主張)。 */
  readonly usecases: CatalogInput<unknown>;
  /** 外部連携カタログ(受信の配線の主張)。 */
  readonly external: CatalogInput<unknown>;
}

/** 主張の集まり 1 つ(阻害のとき言う理由と、見ていない分の名前)。 */
export interface PlacementPart {
  readonly key: keyof PlacementInputs;
  /** 見ていない分の名前(「〜の置き場」に続く)。 */
  readonly unseen: string;
  /** 使えない入力の言い方(「〜ため」の前)。 */
  readonly cause: string;
  /** 「見ました」の側に添える名前。 */
  readonly seen: string;
}

/** 主張の集まり(並びは、見ました側の添え方の並びでもある。入力の欄の全数を固定する構造テスト `foreign-readers.test.ts` が、A2 が引く材料の名指しとして読む)。 */
export const PLACEMENT_PARTS: readonly PlacementPart[] = [
  { key: 'actions', unseen: '操作', cause: 'action_spec が読めない', seen: '操作' },
  { key: 'usecases', unseen: '保存点・フォーム', cause: 'ユースケース仕様が使えない', seen: '保存点・フォーム' },
  { key: 'external', unseen: '受信の配線', cause: '外部連携カタログが使えない', seen: '受信の配線' },
];

/**
 * 置き場の取り合いが、使えなかった入力のために見ていない分の行(阻害の入力ごとに 1 行。無ければ空)。
 *
 * @param inputs 3 つの入力の状態
 * @param appAvailable 実装の木があるか(無ければ検査そのものが走らないので、何も言わない)
 * @returns 実行ログの行(`A2(続き・実装の置き場の取り合い): …`)
 */
export function describePlacementGaps(inputs: PlacementInputs, appAvailable: boolean): string[] {
  if (!appAvailable) return [];
  const blocked = PLACEMENT_PARTS.filter((part) => inputs[part.key].state === 'blocked');
  return blocked.map((part) => {
    const seen = PLACEMENT_PARTS.filter((other) => inputs[other.key].state !== 'blocked').map((other) => other.seen);
    const tail = seen.length === 0 ? '' : `(${seen.join('・')}の分は見ました)`;
    return `A2(続き・実装の置き場の取り合い): ${part.cause}ため、${part.unseen}の置き場は取り合いを見ていません${tail}。`;
  });
}
