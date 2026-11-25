/**
 * `screen_spec` の `precondition` / `on_fail` を、生成物(`screens.ts`)に載せる形へ写す。
 *
 * `precondition` はガード式(文字列)だが、実装がエンジンの評価器(`passesPreflight` /
 * `evaluateGuard`。`@/domain/preflight` / `@/domain/engine`)にかけられるのは AST
 * (`GuardExprData`)だけである。写す作業をここに集約し、`code-screens.ts` はこの結果を
 * リテラルへ差し込むだけにする(2026-09-04 拡張)。
 */

import type { GuardServices } from '../guard/ast.js';
import { guardExprData } from '../guard/expr-data.js';
import type { LiteralValue } from '../kernel/literal-value.js';
import type { ScreenSpec } from '../model/screen/types.js';

/**
 * `precondition` の AST を `{ precondition: GuardExprData }` の形で返す(無ければ `{}`)。
 *
 * パースに失敗する式は S5 が別途エラーにするので、ここでは黙って省く(`generate` は
 * `verify` の後に走る運用だが、単独で呼ばれても落ちないようにする)。
 */
export function preconditionLiteral(
  screen: ScreenSpec,
  guards: GuardServices,
): Record<string, LiteralValue> {
  if (screen.precondition === undefined) return {};
  const parsed = guards.parse(screen.precondition.source);
  if (!parsed.ok) return {};
  const data = guardExprData(parsed.expr);
  // エンジンに反映できない節点(`is null`)を含む式も、パース不能と同じく省く。
  return data === null ? {} : { precondition: data };
}

/** `on_fail` を `{ onFail: {...} }` の形で返す(無ければ `{}`)。 */
export function onFailLiteral(screen: ScreenSpec): Record<string, LiteralValue> {
  if (screen.onFail === undefined) return {};
  return { onFail: { raw: screen.onFail.raw, screen: screen.onFail.screen } };
}
