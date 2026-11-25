/**
 * ガード式の**比較リテラルの接地**を見る純粋モジュール。
 *
 * パスの実在は解決規則が見るが、比較の右辺に置いた**値**は誰も見ていなかった。
 * `state == publik` も `workshop.state in [confirmed, program_publishedd]` も式としては妥当で、
 * 型も合っている ── だから検証は緑のまま通り、綴り違いは「その条件が永久に成立しない」
 * (または「その節だけが死んでいる」)という形で本番まで生き延びる。
 *
 * 左辺の値域が閉じている(state / enum / boolean = finite ドメイン)ときだけ判定できる。
 * 数値・日時・参照のような開いた値域は照合しようがないので何も言わない。
 * 右辺がパスの比較(`entry.performer_id == actor.id`)も対象外である。
 *
 * 恒偽・恒真の判定(V9)とは別物である。恒偽判定は「式全体が成立し得ない」ことしか言えず、
 * `state == draft or state == publik` のように**他の節が生きている式では黙る**。
 * 綴り違いを名指しで落とせるのはこの検査だけである。
 */

import type { DomainEnv, GuardExpr } from './ast.js';
import { forEachAtom } from './atoms.js';

/** 宣言済みの値集合に無いリテラルとの比較 1 件。 */
export interface UngroundedLiteral {
  /** 比較の左辺パス(正規化キー。例: "workshop.state")。 */
  readonly path: string;
  /** 右辺に書かれていた値(例: "publik")。 */
  readonly value: string;
  /** そのパスが取り得る値の全体。Finding の suggestion に載せる。 */
  readonly allowed: readonly string[];
}

/**
 * 式に現れる比較のうち、**左辺の値域に無いリテラル**と突き合わせているものを集める。
 *
 * `in` / `not in` は等号比較の集まりとして数えるので、値の並びも同じ規則で見られる。
 *
 * @param expr 検査対象の式(パース済み)
 * @param env パス → 変数ドメインの宣言。ここに無いパスは値域が分からないので対象外
 * @returns 接地しないリテラルの一覧(同じ左辺・同じ値は 1 件にまとめる)
 */
export function ungroundedLiterals(expr: GuardExpr, env: DomainEnv): readonly UngroundedLiteral[] {
  const found = new Map<string, UngroundedLiteral>();
  forEachAtom(expr, (atom) => {
    if (atom.kind !== 'compare' || atom.rhsVar !== null) return;
    const domain = env.get(atom.varKey);
    if (domain === undefined || domain.kind !== 'finite') return;
    if (domain.values.includes(atom.text)) return;
    found.set(`${atom.varKey}\u0000${atom.text}`, {
      path: atom.varKey,
      value: atom.text,
      allowed: domain.values,
    });
  });
  return [...found.values()];
}
