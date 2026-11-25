/**
 * S14 状態の可視性検査(V6 デッドエンドの画面版)。
 *
 * V6 が「final でない状態には出ていく遷移がある」ことを問うのに対し、これが問うのは
 * 「その状態の実体を、人間が読み取り経路から見られるか」である。状態機械の各状態 `s` について、
 * `s` の実体を返しうる読み取り経路(`query_spec` の `filters` に状態の絞り込みが無い、または
 * `state in [...]` に `s` を含む — 記号評価は S13 と同じ `admitsState`。母集合は
 * **その集約を主エンティティとする query**であり、併読 `includes` は対象外)を `reads` に持ち、
 * 人間ロールが入れる画面が存在することを要求する。
 *
 * 満たさなくても直ちに壊れているとは言えない(内部的な一瞬の中間状態はあり得る)ため
 * **warning** に留める。免除は S10 / S13 と同じ方式で、
 * `specs/frontend/screens/README.md` のフロントマター `unseen_states` に `state`
 * (`{machine}.{state}` 形式) / `reason` を書く(用済みの宣言・存在しない状態の宣言は警告)。
 */

import type { Finding, ScreenContext, ScreenVerifier } from '../verifier.js';
import { authGateBlocked, foreignBlocked, screenFinding } from '../verifier.js';
import type { ScreenInput, StateVisibilityDecl } from '../../model/screen/types.js';
import { allMachines, type StateMachineSpec } from '../../model/types.js';
import { entityNameOfAggregate } from '../../semantics/domain-index.js';
import { anonymousRoleId } from '../../model/role-hierarchy.js';
import { stateFieldOf } from '../../semantics/state-admit.js';
import { findStateVisibility } from '../state-visibility.js';

/** S14: 各状態を見せる読み取り経路 × 画面があるかを検証する(warning)。 */
export const stateVisibilityVerifier: ScreenVerifier = {
  id: 'S14',
  title: '状態の可視性 — 各状態の実体を、人間が読み取り経路から見られる',

  verify(input: ScreenInput, ctx: ScreenContext): Finding[] {
    if (!input.screens.available) return [];
    // 見える経路の判定は、読み取りクエリと関門が分かっているときだけ出す(欠けた読みで「見える経路が無い」と言わない・
    // 空の関門で決めると入れない画面にも入れると広く見積もる)。阻害の行は呼び手が言う。
    const queriesBlocked = foreignBlocked(ctx, 'queries');
    const gateBlocked = authGateBlocked(ctx);
    const domain = input.domain;
    const screens = input.screens.screens;
    const queries = input.queries.available ? input.queries.queries : [];
    const anonymousRole = anonymousRoleId(domain.roles.roles);
    const gates = input.auth.flow?.gates ?? [];
    const excused = indexExcuses(input.screens.unseenStates);

    const findings: Finding[] = [];
    const checkedKeys = new Set<string>();

    for (const { aggregate, machine } of allMachines(domain)) {
      const stateField = stateFieldOf(domain, aggregate, machine.machine);
      if (stateField === undefined) continue;
      const entityName = entityNameOfAggregate(domain, aggregate);

      for (const state of machine.states) {
        const key = excuseKey(machine.machine, state);
        checkedKeys.add(key);
        const decl = excused.get(key);
        // 「見える経路ができたのに宣言が残っている」は、見つかった経路が真であれば言える(読み取りクエリが欠けていても、見つかった経路は消えない)。
        // 関門が阻害のときは経路が広く見積もられて偽になりうるので言わない。宣言の無い状態に経路が無いと言うのは、どちらの欠けでも偽になる。
        if (gateBlocked || (queriesBlocked && decl === undefined)) continue;
        const witnesses = findStateVisibility(
          ctx.guards,
          domain,
          queries,
          screens,
          gates,
          anonymousRole,
          aggregate,
          entityName,
          stateField,
          state,
        );
        if (witnesses.length > 0) {
          if (decl !== undefined) findings.push(obsoleteExcuse(decl));
        } else if (decl === undefined) {
          findings.push(missingVisibility(machine, state));
        }
      }
    }

    for (const [key, decl] of excused) {
      if (!checkedKeys.has(key)) findings.push(unknownExcuse(decl));
    }
    return findings;
  },
};

/** 免除宣言を突合キー(`{machine}.{state}`)で引けるようにする。 */
function indexExcuses(decls: readonly StateVisibilityDecl[]): ReadonlyMap<string, StateVisibilityDecl> {
  return new Map(decls.map((decl) => [decl.state, decl]));
}

/** 突合キーを組み立てる(loader.ts に書く形式と同じ)。 */
function excuseKey(machine: string, state: string): string {
  return `${machine}.${state}`;
}

/** その状態を見せる(クエリ・画面・ロール)の組が 1 つも無い。 */
function missingVisibility(machine: StateMachineSpec, state: string): Finding {
  const key = excuseKey(machine.machine, state);
  return screenFinding('S14', {
    severity: 'warning',
    message: `${key} の実体を見せる読み取り経路 × 画面がありません`,
    location: { file: machine.location.file, pointer: `states.${state}` },
    suggestion:
      `${state} を除外しない query_spec の filters を持つクエリを、そのクエリを reads に持つ画面から` +
      '人間ロールが読めるようにする。' +
      'まだ見せなくてよいなら specs/frontend/screens/README.md のフロントマターに ' +
      `"unseen_states: - state: ${key} / reason: {理由}" を書く`,
    counterexample: { state: key },
  });
}

/** 見える経路ができたのに免除宣言が残っている(消し忘れ)。 */
function obsoleteExcuse(decl: StateVisibilityDecl): Finding {
  return screenFinding('S14', {
    severity: 'warning',
    message: `${decl.state} は見える経路ができたのに unseen_states の理由宣言が残っています`,
    location: decl.location,
    suggestion: 'screens/README.md の unseen_states からこの項目を削除する',
    counterexample: { state: decl.state },
  });
}

/** 実在しない状態の免除宣言(綴り違い等)。 */
function unknownExcuse(decl: StateVisibilityDecl): Finding {
  return screenFinding('S14', {
    severity: 'warning',
    message: `unseen_states の ${decl.state} は状態機械の状態として存在しません`,
    location: decl.location,
    suggestion: '綴りを確認し、"{machine}.{state}" 形式で実在する状態に直すか項目を削除する',
    counterexample: { state: decl.state },
  });
}
