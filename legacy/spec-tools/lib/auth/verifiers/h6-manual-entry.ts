/**
 * H6(続き)**手書きの入口の多要素認証** —— 要求する製品で `runner: manual` の操作の Server Action が、判断と書き込みの前に
 * 生成物と同じ判定(`@kaninabe/runtime/template/mfa` の `refuseUnverifiedMfa` / `mfaRefusal`)を呼び、拒否ならそこで返していること。
 *
 * 生成された入口は実行器を通るので、要求は実行器が執行する。`runner: manual` の操作は実行器を通らないので執行が届かず、手書きの
 * Server Action が自分で関門を通すしかない。ここはその形を**構文木で**見る(`semantics/guard-before-call.ts`。字面で見ると、コメント
 * の中の名前・結果を捨てる呼び出し・本体のあとの呼び出しでも通る)。本体は、その操作の組み立ての根(配置の `operation-composition`)
 * から import した束縛の呼び出しである。
 *
 * 見ないもの: Server Action のファイルが無い操作(人の入口が無い。内部実行だけが起こす操作)・外す宣言の製品・実装の木が無い構成・
 * action_spec を採っていないとき。採ったのに読めない(阻害)ときは判定を出さず、名指しの表(`verify/operation-input-notes.ts` の H6)の行が言う。関門に渡したロールが本当にその操作の判断に立ちうるロールかは見ない(呼び手が解く)。
 */

import path from 'node:path';
import { isFile } from '../../io/paths.js';
import { readText } from '../../io/read-text.js';
import type { Finding } from '../../kernel/finding.js';
import type { SourceLocation } from '../../kernel/source-location.js';
import { MFA_GUARD_FUNCTIONS, MFA_GUARD_MODULE, MFA_RESOLVER } from '../../model/auth/mfa.js';
import { layoutModule, layoutPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import { inputValue } from '../../kernel/input-state.js';
import type { CatalogInput } from '../../kernel/input-state.js';
import { exportedGuards } from '../../semantics/guard-before-call.js';

/** 手書きの入口の検査の入力。 */
export interface ManualEntryInput {
  /** action_spec の入力の状態(読込済みのときだけ見る。未選択は事実として無い・阻害は名指しの表 `operation-input-notes.ts` の H6 の行が言う)。 */
  readonly actions: CatalogInput<ActionSpecModel>;
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
  /** 指摘の ID(H6)。 */
  readonly verifier: string;
}

/** 判定ごとの、指摘の言い方。 */
const PROBLEM_WORDS = {
  unguarded: '判断と書き込みの前に多要素認証の判定を呼んで、拒否ならそこで返していません',
  no_target: 'その操作の組み立ての根を呼んでいないので、多要素認証の判定が判断と書き込みの前にあるかを確かめられません',
  unsourced: `判定に渡す actorMfa が、認証の組み立ての根の ${MFA_RESOLVER}() の結果ではありません(決め打ちの値や別の出どころでは、多要素認証を済ませていないセッションを防げません)`,
} as const;

/** 操作 1 つの指摘(Server Action のファイルが無ければ何も言わない)。 */
function findingsOf(op: string, location: SourceLocation, input: ManualEntryInput): Finding[] {
  const file = layoutPath(input.layout, input.roots.app, 'operation-entry', op);
  const composition = layoutModule(input.layout, 'operation-composition', op);
  if (file === null || composition === null || !isFile(path.join(input.repoRoot, file))) return [];
  const auth = layoutModule(input.layout, 'auth-composition');
  // 根の配置が無ければ出どころを確かめられないので、どの import も当たらない指定で赤に倒す。
  // 実行者は判定の 2 つ目の引数(refuseUnverifiedMfa・mfaRefusal のどちらも)。
  const source = { argumentIndex: 1, property: 'actorMfa', module: auth ?? '', name: MFA_RESOLVER };
  const guards = exportedGuards(file, readText(path.join(input.repoRoot, file)), { module: MFA_GUARD_MODULE, names: MFA_GUARD_FUNCTIONS }, (specifier) => specifier === composition, source);
  return guards.flatMap((guard) => {
    if (guard.state === 'guarded') return [];
    return [
      {
        verifier: input.verifier,
        severity: 'error',
        message: `多要素認証を要求していますが、runner: manual の操作 ${op} の手書きの Server Action(${file} の ${guard.name})は、${PROBLEM_WORDS[guard.state]}(実行器を通らない入口には、生成物の執行が届きません)`,
        location,
        suggestion:
          `${guard.name} の本体のいちばん外の文で、組み立ての根(${composition})を呼ぶ前に ` +
          `\`const refusal = refuseUnverifiedMfa(runtimeBindings, { actorId, actorMfa: await resolveSessionMfa() }, roles, '${op}'); if (refusal !== null) return err(refusal);\`` +
          `(resolveSessionMfa は認証の組み立ての根 ${auth ?? '(配置に無い)'} から import する)` +
          `(\`${MFA_GUARD_MODULE}\`)を置く。roles はこの操作の判断に立ちうるロールを解いた結果`,
        counterexample: { operation: op, file, export: guard.name, state: guard.state },
        grounding: 'implementation',
      },
    ];
  });
}

/**
 * 要求する製品の `runner: manual` の操作の手書きの Server Action が、多要素認証の判定を判断と書き込みの前に呼んでいるかを検証する。
 *
 * @param input action_spec・リポジトリルート・根・配置
 * @returns 違反
 */
export function verifyManualEntryMfa(input: ManualEntryInput): Finding[] {
  return (inputValue(input.actions)?.actions ?? [])
    .filter((action) => action.runner?.kind === 'manual')
    .flatMap((action) => findingsOf(action.handles.raw, action.location, input));
}
