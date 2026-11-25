/**
 * **実行者(`actor.*`)に触れる原子を、手ごとに自由な真偽値へ逃がす**写像(純粋)。
 *
 * 有界到達性の世界は「誰が実行するか」を見ない(設計の凍結メモ §2)。`by` を見ないのと同じ理由で、
 * `actor.{欄}` が指す人も手ごとに違ってよい —— そこを縛ると、実際には起こせる実行列を
 * 取りこぼし、V21 が嘘の warning を出す。
 *
 * 逃がし方は「**原子ごとに独立な自由 `Bool`**」である。`actor.{欄}` を手ごとに自由な
 * *変数* にするだけでは足りない —— `x == actor.id and y == actor.id` が `x == y` を強いて
 * しまい、緩めが充足側から外れる。写像(smt.ts)が自由な `Bool` に落とす節点は `contains`
 * だけなので、そこへ写し、鍵に元の原子の綴りを混ぜて別の原子を別の真偽値に保つ。
 */

import type { GuardExpr, PathRef } from '../guard/ast.js';
import { compareAtom, literalText, nullAtom, pathKey } from '../guard/atoms.js';

/** 実行者を指す予約語のルート。 */
const ACTOR_ROOT = 'actor';

/** ルートが実行者を指すパスか。 */
function isActorPath(path: PathRef): boolean {
  return path.segments[0] === ACTOR_ROOT;
}

/**
 * 原子 1 つを**自由な真偽値**へ逃がす(写像が `Bool` に落とす節点は `contains` だけ)。
 * 鍵に元の綴りを混ぜるので別の原子は別の真偽値になり、手が違えばさらに別になる。
 */
function freeAtom(key: string): GuardExpr {
  return { kind: 'contains', path: { segments: [ACTOR_ROOT] }, ref: { segments: [key] } };
}

/**
 * 実行者に触れる原子を自由な真偽値へ逃がす。
 *
 * @param expr 元のガード式
 * @returns 実行者に触れる原子を自由な真偽値へ置き換えた式
 */
export function loosenActorAtoms(expr: GuardExpr): GuardExpr {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return { kind: expr.kind, left: loosenActorAtoms(expr.left), right: loosenActorAtoms(expr.right) };
    case 'not':
      return { kind: 'not', operand: loosenActorAtoms(expr.operand) };
    case 'compare': {
      const rhsActor = expr.rhs.kind === 'path' && isActorPath(expr.rhs.path);
      if (!isActorPath(expr.path) && !rhsActor) return expr;
      return freeAtom(compareAtom(expr.path, expr.op, expr.rhs).key);
    }
    case 'in':
      return isActorPath(expr.path)
        ? freeAtom(`${pathKey(expr.path)} in ${expr.values.map(literalText).join(',')}`)
        : expr;
    case 'contains':
      return expr;
    case 'null':
      // 「空かどうか」は実行者の属性についても問えるが(`actor.{欄} is null`)、
      // その真偽は手ごとに違ってよい —— 比較原子と同じく自由な真偽値へ逃がす。
      return isActorPath(expr.path) ? freeAtom(nullAtom(expr.path).key) : expr;
  }
}
