/**
 * 生成の文脈に添える、仕組みの保証台帳(`framework/guarantees.md`)の読み込みの結果。
 *
 * 製品の保証台帳(`GenerateContext.guarantees`)とは**独立**に読む —— 仕組みの台帳は製品が外せない義務で、
 * 製品が保証台帳の種類を採っていなくても(`isOpen('guarantees')` に依らず)読む。生成器は読み込みに失敗しても投げず、
 * 「読めなかった」を名指す(生成器は投げない)。
 *
 * `GenerateContext` の型そのものには欄を足さない(`gen-kit/generator.ts` は C24 の写し元の閉包に入っていて、
 * 触ると RPC のモデルの hash が動く)。構造的に上位の型で足し、生成器は `frameworkLedgerOf` で読む。
 */

import type { GenerateContext } from '../gen-kit/generator.js';
import type { FrameworkLedgerLoad } from '../model/guarantee/framework-loader.js';

/** 文脈に添える仕組みの台帳の入力。 */
export interface FrameworkLedgerInput {
  /** 仕組みの台帳の読み込みの結果(未選択 / 阻害 / 読込済み)。 */
  readonly load: FrameworkLedgerLoad;
  /**
   * 生成の対象の木が、仕組みの台帳の住む木そのものか。
   *
   * 本文ブロックは台帳のファイルに書く。別の製品の木を生成しているとき(開発用の木の道具で別の題材を生成する)に、
   * 道具の木の台帳へ書き込まないために、書くのは自分の木のときだけにする。章の表(読み取り専用)は別の木でも出す。
   */
  readonly ownTree: boolean;
}

/** 仕組みの台帳の入力を足した文脈の素。 */
export interface FrameworkLedgerContext {
  readonly frameworkLedger?: FrameworkLedgerInput;
}

/** 値が仕組みの台帳の入力の形か。 */
function isFrameworkLedgerInput(value: unknown): value is FrameworkLedgerInput {
  if (typeof value !== 'object' || value === null) return false;
  if (!('load' in value) || !('ownTree' in value)) return false;
  const { load, ownTree } = value;
  if (typeof ownTree !== 'boolean' || typeof load !== 'object' || load === null || !('state' in load)) return false;
  return load.state === 'loaded' || load.state === 'blocked' || load.state === 'not_requested';
}

/**
 * 文脈から仕組みの台帳の入力を読む(足されていなければ undefined)。
 *
 * @param ctx 生成の文脈
 * @returns 仕組みの台帳の入力。足されていなければ undefined
 */
export function frameworkLedgerOf(ctx: GenerateContext): FrameworkLedgerInput | undefined {
  if (!('frameworkLedger' in ctx)) return undefined;
  const value: unknown = ctx.frameworkLedger;
  return isFrameworkLedgerInput(value) ? value : undefined;
}
