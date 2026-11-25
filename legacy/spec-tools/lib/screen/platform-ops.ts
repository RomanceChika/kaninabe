/**
 * 画面の検査(S20・S21)が引く、auth_spec の `platform_ops` の索引。
 *
 * 画面は auth_spec の操作を**名前で参照する**だけで再定義しない(ARCH-SP-0002)。引き当てを各検査に散らさないための 1 か所である。
 * 索引が**使えない**(auth_spec を採ったのに読めない・読めずに落とした宣言がある)ときは `null` を返し、検査は「無い」と言わない
 * (欠けたモデルで偽の error を出さない。見ていないことは呼び手の入力の状態が言う)。auth_spec が無い構成は「操作が 1 つも無い」索引になる。
 */

import type { PlatformOpDecl, PlatformShape } from '../model/auth/platform-ops.js';
import type { ScreenInput } from '../model/screen/types.js';

/** 引き当ての索引。 */
export interface PlatformOpIndex {
  readonly ops: ReadonlyMap<string, PlatformOpDecl>;
  readonly shapes: ReadonlyMap<string, PlatformShape>;
}

/**
 * 画面の検査が引く `platform_ops` の索引を作る。
 *
 * @param input 画面検証器の入力(auth を読む)
 * @param authBlocked 認証の入力が阻害か(`authGateBlocked(ctx)`。採ったのに読めない)
 * @returns 索引。使えなければ null
 */
export function platformOpIndex(input: ScreenInput, authBlocked: boolean): PlatformOpIndex | null {
  if (authBlocked) return null;
  if (input.auth.available && input.auth.flow === null) return null;
  const section = input.auth.flow?.platformOps;
  return {
    ops: new Map((section?.ops ?? []).map((op) => [op.id, op])),
    shapes: new Map((section?.shapes ?? []).map((shape) => [shape.name, shape])),
  };
}
