/**
 * 生成の文脈から、認証フローの関門の入力の状態を取り出す(到達・着地・可視性・前提に依る生成物が共有する口)。
 *
 * 文脈の `gates`(組み立ての根が `uses` と読み込みの結果から決めた状態)があればそれを、無ければ `auth` の関門を読込済みとして使う
 * (入力の状態を決める口を持たない呼び手。従来の挙動)。**阻害のときは、関門を空として探索せず、書く側が「確かめていない」と書く**。
 */

import type { CatalogInput } from '../../kernel/input-state.js';
import { inputValue } from '../../kernel/input-state.js';
import type { AuthGateDecl } from '../../model/auth/types.js';
import { loadedGates } from '../../relations/screen-reachability/index.js';
import type { GenerateContext } from '../../gen-kit/generator.js';

/**
 * 関門の入力の状態。
 *
 * @param ctx 生成の文脈
 */
export function gatesOf(ctx: GenerateContext): CatalogInput<readonly AuthGateDecl[]> {
  return ctx.gates ?? loadedGates(ctx.auth?.flow?.gates ?? []);
}

/**
 * 関門の一覧(読込済みのときだけ。未選択は「関門は無い」で空・阻害は呼び手が欄を「確かめていない」にするので、探索に使わない空)。
 *
 * @param gates 関門の入力の状態
 */
export function gateDecls(gates: CatalogInput<readonly AuthGateDecl[]>): readonly AuthGateDecl[] {
  return inputValue(gates) ?? [];
}
