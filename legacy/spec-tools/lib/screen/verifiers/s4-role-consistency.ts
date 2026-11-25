/**
 * S4 ロール整合のチェック。
 *
 * screen-spec-writing.md の S4:「`for` が roles.md に実在するグローバルロールで、
 * 参照する query_spec の `for` に含まれる。`actions`(`overlays[].actions` を含む)の実行ロールと
 * `for` の交差が空なら警告」。
 *
 * 重ね表示の分まで数えるのは Phase C-6 第 2 波の決定である(V9)。重ね表示に置いた操作だけ
 * 「誰も実行できない」を見逃す理由が無く、生成物(`screens.ts` の `actions`)も S2 も S10 も
 * 画面と重ね表示を 1 つの母集合として扱っている。
 *
 * 読み取り側(`reads`)はエラーである。画面のロールがクエリの `for` に無いということは、
 * その画面はそのクエリを**呼べない**という意味で、実行すれば RLS か権限で落ちる。
 * 書き込み側(`actions`)を警告に留めるのは、「押したら断られるボタン」が UX として
 * 正しい場合があるため(可否の正は状態機械であり、画面が先読みで隠すのは二重管理になる)。
 */

import type { SpecModel } from '../../model/types.js';
import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { foreignBlocked, screenFinding } from '../verifier.js';
import { findRole, isContextRole } from '../../semantics/domain-lookup.js';
import type { QuerySpecModel } from '../../model/query/types.js';
import type { ScreenInput, ScreenSpec } from '../../model/screen/types.js';
import { actionRoles, rolesIntersect } from '../../semantics/action-ground.js';
import { declaredActionRefs } from '../../model/screen/declared-actions.js';

/** S4: 画面のロールが、読むクエリ・発火する操作のロールと噛み合うかを検証する。 */
export const roleConsistencyVerifier: ScreenVerifier = {
  id: 'S4',
  title: 'ロール整合 — for が実在するグローバルロールで、reads / actions と噛み合う',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    const readsHeld = foreignBlocked(ctx, 'queries'); // query_spec が阻害なら reads の読み取りクエリとのロール整合は言わない(行は呼び手が言う)
    return input.screens.screens.flatMap((screen) => [
      ...checkAudience(screen, input.domain),
      ...(readsHeld ? [] : checkReads(screen, input.queries)),
      ...checkActions(screen, input.domain),
    ]);
  },
};

/** for が実在し、グローバルロール(binding を持たない)だけかを見る。 */
function checkAudience(screen: ScreenSpec, domain: SpecModel): Finding[] {
  return screen.forRoles.flatMap((role) => {
    if (findRole(domain, role) === null) {
      return [
        screenFinding('S4', {
          message: `for のロール ${role} が roles.md にありません`,
          location: { file: screen.location.file, pointer: `for.${role}` },
          suggestion: 'specs/domain/roles.md に定義されたロール ID を書く(画面がロールを発明しない)',
          counterexample: { screen: screen.name, role },
        }),
      ];
    }
    if (!isContextRole(domain, role)) return [];
    return [
      screenFinding('S4', {
        message: `for のロール ${role} は文脈依存ロールです(roles.md に binding がある)`,
        location: { file: screen.location.file, pointer: `for.${role}` },
        suggestion:
          `for に書けるのは「誰がこの画面を見るか」= グローバルロールだけ。${role} が implies で` +
          '含意するロール(例: member)に直し、対象との関係は precondition か query_spec の via で表す',
        counterexample: { screen: screen.name, role },
      }),
    ];
  });
}

/** 画面の for が、読むクエリの for に含まれるか。 */
function checkReads(screen: ScreenSpec, queries: QuerySpecModel): Finding[] {
  if (!queries.available) return [];
  return screen.reads.flatMap((read) => {
    const query = queries.queries.find((candidate) => candidate.id === read.id);
    // 実在しない参照は S2 が指摘済み。ここで重ねてエラーにしない。
    if (query === undefined) return [];
    return screen.forRoles
      .filter((role) => !query.forRoles.includes(role))
      .map((role) =>
        screenFinding('S4', {
          message: `画面のロール ${role} は ${query.name} を実行できません`,
          location: read.location,
          suggestion:
            `query_spec ${query.name} の for に ${role} を足すか(足せるかは access_spec の reads 次第)、` +
            `画面の for から ${role} を外す。読めないロールに読み取り経路は開けない`,
          counterexample: {
            screen: screen.name,
            role,
            query: query.name,
            query_for: query.forRoles.join(', '),
          },
        }),
      );
  });
}

/**
 * 画面の for が、発火する操作を実行し得るか(交差が空なら警告)。
 *
 * 母集合は画面の `actions` と重ね表示の `actions` の和である(V9)。
 */
function checkActions(screen: ScreenSpec, domain: SpecModel): Finding[] {
  return declaredActionRefs(screen).flatMap((action) => {
    const byRoles = actionRoles(domain, action.id);
    // 接地しない操作は S2 が指摘済み。
    if (byRoles === null) return [];
    if (rolesIntersect(domain, screen.forRoles, byRoles)) return [];
    return [
      screenFinding('S4', {
        severity: 'warning',
        message: `${action.id} を実行できるロールが、この画面のロールと交差しません`,
        location: action.location,
        suggestion:
          `${action.id} の実行ロールは ${byRoles.join(' / ')}。画面の for(${screen.forRoles.join(' / ')})が` +
          'これらを含意していないなら、この操作は誰も実行できない。for を見直すか、操作を別画面へ移す' +
          '(押したら断られるボタンが意図的な設計なら、この警告は許容してよい)',
        counterexample: {
          screen: screen.name,
          action: action.id,
          by: byRoles.join(', '),
          for: screen.forRoles.join(', '),
        },
      }),
    ];
  });
}
