/**
 * `not_boundary: 理由`(実行者の集約の参照の欄がテナントの境界ではないことの宣言。点検 5 回目 A5-4)の**置き場と矛盾**の検査と、
 * 受け入れた危険としての名指し(点検 6 回目 A6-3。V20 が使う)。
 *
 * 宣言は境界の欄が 0 本のときの名指し(`tenant-latent-boundary.ts`)から欄を外す口であり、外した欄はレビューの目に入らなければならない。
 * 以前は形(参照の欄・空でない理由)しか見ず、次の 3 つが黙って通った:
 *
 * | 形 | 判定 |
 * |---|---|
 * | 実行者の集約(`session: true` の欄を持つ集約)でない集約の欄に書く | error(外す対象の名指しが起きない欄に書いた死んだ宣言) |
 * | 同じ欄に `session: true` がある | error(境界として全表で使われ続ける欄に「境界ではない」と書いた矛盾) |
 * | その欄が `actor.{欄}` として使われている(境界の欄) | error(同じ矛盾。`filters` / `when` / `guard` / `binding` のどこかで境界として結んでいる) |
 * | それ以外(実行者の集約の、境界でない参照の欄) | warning(**受け入れた危険**。毎回名指し、区分は `Finding.acceptance`。宣言の実在は W5) |
 *
 * **この部品はテナントの語を 1 つも持たない。**
 */

import type { AcceptedRiskDecl, Finding } from '../../kernel/finding.js';
import type { FieldDef, SpecModel } from '../../model/types.js';

/** この検証器の ID(V20 の続き)。 */
const VERIFIER_ID = 'V20';

/** `not_boundary` を書いた欄 1 つ。 */
interface Declared {
  readonly aggregate: string;
  readonly field: FieldDef & { readonly notBoundary: string };
  /** その集約が実行者の集約(`session: true` の欄を持つ)か。 */
  readonly actor: boolean;
}

/** `not_boundary` を書いた欄を全部(宣言順)。 */
function declaredNotBoundaries(model: SpecModel): readonly Declared[] {
  return [...model.aggregates.values()].flatMap((specs) => {
    const entity = specs.entity;
    if (entity === undefined) return [];
    const actor = entity.fields.some((field) => field.session === true);
    return entity.fields.flatMap((field) => {
      const reason = field.notBoundary;
      return reason === undefined ? [] : [{ aggregate: entity.entity, field: { ...field, notBoundary: reason }, actor }];
    });
  });
}

/** 受け入れの宣言 1 件(警告の `acceptance` と W5 へ渡す宣言で同じものを使う)。 */
function acceptanceOf(declared: Declared): AcceptedRiskDecl {
  return { reason: declared.field.notBoundary, location: declared.field.location };
}

/** 置き場・矛盾の言い分け(error)。受け入れてよい宣言なら null。 */
function contradiction(declared: Declared, boundaryNames: ReadonlySet<string>): string | null {
  if (!declared.actor) return `${declared.aggregate} は実行者の集約(session: true の欄を持つ集約)ではないので、not_boundary で外す名指しが起きません(死んだ宣言)`;
  if (declared.field.session === true) return '同じ欄に session: true があり、境界として全表で使われ続けます(「境界ではない」と矛盾)';
  if (boundaryNames.has(declared.field.name)) return `仕様のどこかで actor.${declared.field.name} として境界に結んでいます(「境界ではない」と矛盾)`;
  return null;
}

/**
 * `not_boundary` の検査と名指し(V20 の一部)。
 *
 * @param model 仕様のモデル
 * @param boundaryNames 境界の欄の名前(`tenant-boundary-model.ts` の `boundaryFields` の名前)
 * @returns 置き場・矛盾の error と、受け入れた危険の warning(宣言順)
 */
export function notBoundaryFindings(model: SpecModel, boundaryNames: ReadonlySet<string>): Finding[] {
  return declaredNotBoundaries(model).map((declared) => {
    const at = `${declared.aggregate}.${declared.field.name}`;
    const problem = contradiction(declared, boundaryNames);
    if (problem !== null) {
      return {
        verifier: VERIFIER_ID,
        severity: 'error',
        message: `${at} の not_boundary(${declared.field.notBoundary})は書けません: ${problem}`,
        location: declared.field.location,
        suggestion:
          'not_boundary は実行者の集約の、境界でない参照の欄にだけ書く。境界の欄なら not_boundary を消す(session: true と actor.{欄} の結びはそのまま)。' +
          '境界でないなら session: true と actor.{欄} の使用を消してから書く',
        counterexample: { entity: declared.aggregate, field: declared.field.name, kind: 'not_boundary_misplaced' },
      };
    }
    return {
      verifier: VERIFIER_ID,
      severity: 'warning',
      message: `${at} はテナントの境界ではないと宣言して外しています(not_boundary: ${declared.field.notBoundary})。境界の欄が 0 本のときの名指しから外れます`,
      location: declared.field.location,
      suggestion: `${at} がテナントの境界になったら not_boundary を消し、session: true を付けて各表の reads の filters と書き込みの when で actor.${declared.field.name} に結ぶ`,
      counterexample: { entity: declared.aggregate, field: declared.field.name, kind: 'not_boundary' },
      acceptance: acceptanceOf(declared),
    };
  });
}

/**
 * 宣言した `not_boundary` を、受け入れた危険の宣言として取り出す(組み立ての根が W5 へ渡す。警告の `acceptance` と同じもの)。
 *
 * @param model 仕様のモデル
 * @returns 受け入れた危険の宣言
 */
export function notBoundaryAcceptances(model: SpecModel): readonly AcceptedRiskDecl[] {
  return declaredNotBoundaries(model).map(acceptanceOf);
}
