/**
 * A2(続き)操作・保存点・フォームの置き場の取り合い — 仕様から導かれる実装のファイルが、**同じパスを 2 つの持ち主が取らない**。
 *
 * 置き場の役割(`operation-entry` / `operation-composition` / `save-entry` / `save-composition` / `ui-component`)は「衝突したら失敗」と宣言している。
 * 宣言だけでは何も止まらないので、仕様から主張を集めて(`trace/placement-claims.ts`)、配置に当てて一括で衝突を見る
 * (`lib/model/product/layout-claims.ts` の `layoutClaimProblems`。J2 の続き = HTTP の入口の衝突と同じ仕組み)。
 *
 * 取り合いが起きうるのは、**別の仕様から別の生成器が書くファイルが、同じ層の下の同じ空間に居る**ときである。実例: 組み立ての根の層の下に、操作の組み立ての根
 * (`{集約}/{イベント}.ts`)と受信の配線(`inbound/{連携}.ts`)が同居する。**集約名が `inbound` で、イベント名が連携 ID と同じ**ならば、
 * 操作の組み立ての根と受信の配線が同じパスを取り、片方がもう片方を黙って上書きする。集約名が層の土台のディレクトリ名(`jobs` / `usecase` / `inbound`)と同じになる
 * ことも、逆引きが「操作の組み立ての根」と読まない = 辿れない置き場として指す(`not_reachable`)。
 *
 * 見る範囲は、**読み込めた仕様だけ**(action_spec・usecase_spec・外部連携カタログのどれも、読込済みなら。読めない種類の分は作れないので、その分だけが落ちる)。使えなかった入力の主張は作れないので、
 * その分は見ていない(読み込みの診断は読み込んだ側が言う)。実装の木を持たない製品は置き場が無いので何も見ない(事実)。純関数で throw しない。
 */

import type { Finding } from '../../kernel/finding.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';
import { layoutClaimProblems } from '../../model/product/layout-claims.js';
import type { LayoutClaimProblem } from '../../model/product/layout-claims.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { UsecaseSpecModel } from '../../model/usecase/types.js';
import type { SpecModel } from '../../model/types.js';
import { placementClaimsOf } from '../placement-claims.js';

/** この検証器の ID(A2 の続き)。 */
const VERIFIER_ID = 'A2';

/** A2(置き場の取り合い)の入力。 */
export interface PlacementCollisionInput {
  /** ドメイン仕様(システム専用のイベントは入口を持たない)。 */
  readonly domain: SpecModel;
  /** 読み込めた action_spec(読めなければ undefined = 操作の主張は作れない。保存点・受信の配線の分は見る)。 */
  readonly actions: ActionSpecModel | undefined;
  /** 読み込んだ usecase_spec(`available: false` は保存点の主張なし)。 */
  readonly usecases: UsecaseSpecModel | undefined;
  /** 読み込めた外部連携カタログ(読めなければ undefined = 受信の配線の主張なし)。 */
  readonly external: ExternalCatalogSpec | undefined;
  /** 製品が宣言した根(実装の木が無ければ何も見ない)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置(アプリの枠の後段が与える)。 */
  readonly layout: ProductLayout;
}

/** 置き場を取り合っている(衝突の)違反か。それ以外は「置き場を決められない」違反。 */
function isCollision(kind: LayoutClaimProblem['kind']): boolean {
  return kind === 'duplicate_path' || kind === 'multiplicity';
}

/**
 * 操作・保存点・フォームの置き場を検証する(取り合いと、置き場を決められないこと)。
 *
 * @param input 読み込めた仕様・根・配置
 * @returns 違反のリスト(位置は、取り合っている主張の最初の出どころの仕様)
 */
export function verifyPlacementCollision(input: PlacementCollisionInput): Finding[] {
  if (input.roots.app === null) return [];
  const { claims, locations } = placementClaimsOf({ domain: input.domain, actions: input.actions, usecases: input.usecases, external: input.external });
  return layoutClaimProblems(input.layout, claims).map((problem): Finding => {
    const collision = isCollision(problem.kind);
    const first = problem.sources[0];
    return {
      verifier: VERIFIER_ID,
      severity: 'error',
      message: collision ? `実装の置き場が衝突しています: ${problem.message}` : `実装の置き場を決められません: ${problem.message}`,
      location: (first === undefined ? undefined : locations.get(first)) ?? { file: input.roots.specs },
      suggestion: collision
        ? '同じファイルを 2 つの仕様(別の生成器・手書き)が取ると、片方がもう片方を黙って上書きする。操作の集約名・イベント名、保存点の名前、受信の連携 ID のどれかを変えて、' +
          '置き場を分ける(組み立ての根の層の下では、集約名が `inbound` のとき `{イベント}.ts` が受信の配線 `inbound/{連携 ID}.ts` と同じパスになりうる)'
        : '集約名・イベント名・保存点の名前は、層の土台のディレクトリ名(ジョブの配線・保存点・受信の置き場)と同じにできない(置き場が土台と混ざり、実装の木を走査しても' +
          'その仕様の実体として読めない)。配置の役割(宣言・基準・キーの形)の誤りなら、アプリの枠の後段の配置を直す',
      counterexample: { kind: problem.kind, sources: problem.sources.join(' / ') },
    };
  });
}
