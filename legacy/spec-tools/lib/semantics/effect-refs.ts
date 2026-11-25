/**
 * `effects` に現れた副作用 ID の全数の、意味解析の層からの入口(実体は前段の `lib/model/notification/effect-refs.ts`)。
 *
 * 走査はモデルを歩くだけの純関数なので前段に置き、製品の根の宣言の検査(P2)と検査・生成の側が同じ 1 本を読む。
 * ここは既存の読み手のための再輸出である(上の層が下の層を再輸出する向き)。
 */

export { collectJobEffects, collectNotifyEffects, type EffectRef } from '../model/notification/effect-refs.js';
