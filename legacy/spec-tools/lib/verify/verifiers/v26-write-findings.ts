/**
 * V26 の**指摘の文面**(付け替えの口・死角・入力の参照の欄が `context` で辿れない形)。判定は `v26-tenant-write-boundary.ts`。
 *
 * **この部品はテナントの語を 1 つも持たない。**
 */

import type { AccessSpec, SourceLocation, WriteAcceptKind } from '../../model/types.js';
import type { Finding } from '../../kernel/finding.js';
import type { Retarget } from './v26-write-retarget.js';
import type { WriteCandidate } from './v26-write-candidates.js';

/** この検証器の ID(本体と同じ)。 */
const VERIFIER_ID = 'V26';

/** 付け替えの口を塞ぐものが無い、という指摘 1 件。 */
export function retargetFinding(access: AccessSpec, rule: { readonly by: string; readonly location: SourceLocation }, retarget: Retarget): Finding {
  const what =
    retarget.kind === 'own'
      ? `行の境界の列 ${retarget.field} そのもの`
      : `境界の列を持つ親(${retarget.ancestorPaths.join(' / ')})を指す参照の欄 ${retarget.field}`;
  const pair = retarget.pairs[0];
  const tie =
    pair === undefined
      ? retarget.unlinkable === 'both'
        ? `${retarget.ownPaths[0] ?? '自分の境界の列'} と ${retarget.field} を同じ編集で書けると、等式を保ったまま 2 つとも他のテナントへ動かせるので、どちらかを fields から外したうえで両者を結ぶ`
        : `${retarget.field} を別のテナントの列と結ぶ`
      : `${pair[0]} == ${pair[1]} を and の必須の項に持つ(check の)`;
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message:
      `${access.entity} の writes(by: ${rule.by})は ${what}を書き換えられますが、書いたあとの行が実行者のテナントに留まる保証がありません ` +
      '(when は今ある行を読むので、旧い値への境界の比較は新しい値を縛らない —— 自社の行を他社へ移せる・他社の親を自社の親へ付け替えられる形です)',
    location: rule.location,
    suggestion:
      `編集で動かす必要が無ければ ${retarget.field} を fields から外す(作成のときにだけ入力で受ける)。動かすなら、${tie}不変条件を ` +
      '執行点つき(data_table の check / trigger が invariant で名指す)で足すか、' +
      `access_spec に "accept: [{ by: ${rule.by}, filter: ${retarget.acceptFields[0] ?? retarget.field}, on: [write], reason: {なぜ跨がないか} }]" を足して受け入れる`,
    counterexample: { entity: access.entity, key: 'writes', by: rule.by, field: retarget.field, column: retarget.acceptFields[0] ?? retarget.field, kind: 'retarget' },
  };
}

/**
 * 境界の欄がモデルにあるのに、書き込みの規則か状態遷移を持つ集約が境界の列を導けない(V20 / V26 の死角)。
 *
 * 遷移も数える(A4-1)—— 以前は creates / writes / deletes だけを数えたので、遷移だけを持つ集約は死角の警告すら出なかった。
 *
 * @param eventCount その集約の状態遷移(イベント)の数
 */
export function blindSpot(access: AccessSpec, eventCount: number): Finding[] {
  const kinds: string[] = (['creates', 'writes', 'deletes'] as const).filter((key) => access[key].length > 0);
  if (eventCount > 0) kinds.push('遷移');
  if (kinds.length === 0) return [];
  return [
    {
      verifier: VERIFIER_ID,
      severity: 'warning',
      message:
        `${access.entity} は ${kinds.join(' / ')} の規則を持ちますが、実行者の属性を表す列を自分も祖先も持たないので、` +
        'テナント境界を結んでいるかを検査できません(他のテナントの行に届くかは宣言から決められない)',
      location: access.location,
      suggestion:
        '境界の列を持つ親へ context で届くようにする(entity_spec の context と参照の欄)か、' +
        'この集約がテナントを持たない(共有の参照データなど)理由を仕様の散文に残す',
      counterexample: { entity: access.entity, rules: kinds.join(',') },
    },
  ];
}

/**
 * 結べない候補(`context` で辿れない入力の参照の欄の先・境界を書けない形)の指摘 1 件(A3-2(b)(c))。
 *
 * `when` の左辺に書ける綴りが無いので、`when` を足せとは言わない。道を宣言する・不変条件で結ぶ・受け入れる、の 3 つを示す。
 */
export function unbindableFinding(
  access: AccessSpec,
  key: string,
  accept: WriteAcceptKind,
  rule: { readonly by: string; readonly location: SourceLocation },
  candidate: WriteCandidate,
): Finding {
  const column = candidate.acceptFields[0] ?? '';
  const acceptText = `access_spec に "accept: [{ by: ${rule.by}, filter: ${column}, on: [${accept}], reason: {なぜ跨がないか} }]" を足して受け入れる`;
  const what =
    candidate.unreachable === true
      ? `参照の欄 ${candidate.acceptFields.join(' / ')} の先に実行者の属性(actor.${candidate.boundary})を表す列があるのに、context で 2 段以内・1 通りに辿れない(または実行者の集約を経る道しか無い)ので境界を書けません`
      : `入力の参照の欄 ${candidate.via ?? ''} が指す行の ${(candidate.tiePaths ?? []).join(' / ')} を actor.${candidate.boundary} に結べません(context にその欄を通る道が無い)`;
  return {
    verifier: VERIFIER_ID,
    severity: 'error',
    message: `${access.entity} の ${key}(by: ${rule.by})は、${what} —— 他のテナントの行を書ける・指せる形です`,
    location: rule.location,
    suggestion:
      `entity_spec ${access.entity} の context に境界の列を持つ表への道(その参照の欄を通る 2 段以内・1 通り)を宣言して when で結ぶか、` +
      '自分の境界の列と参照先の境界の列の等式を執行点つきの不変条件(data_table の check / trigger が invariant で名指す)で足すか、' +
      `他のテナントに届かない理由が別にあるなら ${acceptText}`,
    counterexample: { entity: access.entity, key, by: rule.by, column, boundary: candidate.boundary, kind: candidate.unreachable === true ? 'unreachable' : 'unbound_ref' },
  };
}
