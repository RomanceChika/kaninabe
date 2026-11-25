/**
 * 軸「画面」—— 画面から起こせる操作・出ていける先・**入場の関門**。
 *
 * 元は画面の配線の生成物である。画面が宣言した `actions` が「その画面のどこかにボタンが
 * 置かれる操作」の全数(重ね表示のぶんも畳まれている)、`navigations` が「出られる先」の
 * 全数、`requiresAuth` / `forRoles` が**誰がその画面に入れるか**である(設計メモ §1)。
 *
 * 記号の使い分け: 配線(操作・遷移)は ➕ / ➖ である —— 到達経路が増えることであって、
 * 誰が実行できるかは権限の軸が出す。**入場の関門だけは 🔓 / 🔒** である —— サインインが外れる /
 * 見るロールが増えるのは、まさに「可視が増える」変化そのものだからである。
 *
 * **片側が読めないときは 1 行も出さない**(独立レビューの止め 2)。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { diffFacts, factKey, FactBuilder, keyParts, setDelta } from './facts.js';
import { changeText } from './messages.js';
import { asArray, asObject, asString, asStrings, field } from './plain.js';
import { problemsOf, readExport, unreadable } from './reader.js';
import { screensPath } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import type { AxisInput, AxisResult, DiffDirection, SemanticChange } from './types.js';

/** 画面の配線の export 名(生成物が持つ綴り)。 */
const SCREEN_ROUTES = 'screenRoutes';

/** サインインの関門が立っていることの表示(比較の値)。 */
const GATE_ON = 'gated';

/** 関門が立っていないことの表示。 */
const GATE_OPEN = 'open';

/** 見るロールで絞っていないことの表示(いちばん広い)。 */
const ROLES_ANY = 'any';

/** 画面 ID(宣言が無ければ画面名で代用する)。 */
function screenIdOf(name: string, route: PlainValue | undefined): string {
  return asString(field(route, 'id')) ?? name;
}

/** 画面ごとに 1 度ずつ回す(3 つの表を同じ並びで作るため)。 */
function eachScreen(value: PlainValue | undefined, visit: (id: string, route: PlainValue) => void): void {
  const routes = asObject(value);
  if (routes === undefined) return;
  for (const name of Object.keys(routes).sort()) {
    const route = routes[name];
    if (route !== undefined) visit(screenIdOf(name, route), route);
  }
}

/** 画面 × 操作 → 操作 ID、の事実の表。 */
function actionTable(value: PlainValue | undefined): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  eachScreen(value, (id, route) => {
    for (const op of asStrings(field(route, 'actions'))) builder.add(factKey(id, op), op);
  });
  return builder.table();
}

/** 画面 × 遷移 → 行き先、の事実の表。 */
function navigationTable(value: PlainValue | undefined): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  eachScreen(value, (id, route) => {
    for (const navigation of asArray(field(route, 'navigations'))) {
      const on = asString(field(navigation, 'on'));
      const to = asString(field(navigation, 'to'));
      if (on === undefined || to === undefined) continue;
      builder.add(factKey(id, on, to), to);
    }
  });
  return builder.table();
}

/**
 * 画面 → 入場の関門(サインインの要否・見るロール)、の事実の表。
 *
 * **画面そのものの出入りは関門の変化ではない**ので、両版に居る画面だけを鍵にする ——
 * 新しい画面の関門を「狭まった」と読ませないためである。
 */
function gateTable(
  value: PlainValue | undefined,
  both: ReadonlySet<string>,
  pick: (route: PlainValue) => string,
): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  eachScreen(value, (id, route) => {
    if (both.has(id)) builder.add(id, pick(route));
  });
  return builder.table();
}

/** サインインの関門の表示(比較の値)。 */
function authOf(route: PlainValue): string {
  return field(route, 'requiresAuth') === true ? GATE_ON : GATE_OPEN;
}

/** 見るロールの表示(宣言が無ければ「絞っていない」= いちばん広い)。 */
function rolesOf(route: PlainValue): string {
  const roles = asStrings(field(route, 'forRoles'));
  return roles.length === 0 ? ROLES_ANY : [...roles].sort().join(' / ');
}

/** 両版に居る画面の id。 */
function screensInBoth(base: PlainValue | undefined, head: PlainValue | undefined): ReadonlySet<string> {
  const inBase = new Set<string>();
  eachScreen(base, (id) => inBase.add(id));
  const both = new Set<string>();
  eachScreen(head, (id) => {
    if (inBase.has(id)) both.add(id);
  });
  return both;
}

/** 見るロールの入れ替わりを行にする(絞りが外れた / 付いた / 1 ロールずつの増減)。 */
function roleChanges(screen: string, before: string, after: string, labels: AxisInput['labels']): SemanticChange[] {
  const row = (direction: DiffDirection, topic: 'screen_role' | 'screen_role_gate', role: string): SemanticChange => {
    const roleLabel = labels.role(role);
    return {
      axis: 'screens',
      direction,
      subject: screen,
      before,
      after,
      text: changeText(topic, direction, {
        subject: screen,
        actor: role,
        ...(roleLabel === undefined ? {} : { actorLabel: roleLabel }),
        before,
        after,
      }),
    };
  };
  if (before === ROLES_ANY) return [row('narrowed', 'screen_role_gate', '')];
  if (after === ROLES_ANY) return [row('widened', 'screen_role_gate', '')];
  const delta = setDelta(before.split(' / '), after.split(' / '));
  return [
    ...delta.gained.map((role) => row('widened', 'screen_role', role)),
    ...delta.lost.map((role) => row('narrowed', 'screen_role', role)),
  ];
}

/** 配線(操作・遷移)の行。 */
function wiringChange(
  topic: 'screen_action' | 'screen_navigation',
  delta: { key: string; before: string | null; after: string | null; kind: 'added' | 'removed' },
  label: string,
): SemanticChange {
  const [screen = ''] = keyParts(delta.key);
  return {
    axis: 'screens',
    direction: delta.kind,
    subject: screen,
    before: delta.before,
    after: delta.after,
    text: changeText(topic, delta.kind, { subject: screen, before: delta.before, after: delta.after, field: label }),
  };
}

/**
 * 軸「画面」の差分。
 *
 * @param input 2 版の写しと表示名の帳面
 * @returns 行と、読めなかったもの
 */
export function screenChanges(input: AxisInput): AxisResult {
  const base = readExport(input.base, 'base', screensPath(input.roots), SCREEN_ROUTES);
  const head = readExport(input.head, 'head', screensPath(input.roots), SCREEN_ROUTES);
  const problems = problemsOf(base, head);
  const changes: SemanticChange[] = [];
  if (unreadable(base, head)) return { changes, problems };
  for (const delta of diffFacts(actionTable(base.value), actionTable(head.value))) {
    if (delta.kind === 'changed') continue;
    const [, op = ''] = keyParts(delta.key);
    changes.push(wiringChange('screen_action', { ...delta, kind: delta.kind }, input.labels.operation(op) ?? ''));
  }
  for (const delta of diffFacts(navigationTable(base.value), navigationTable(head.value))) {
    if (delta.kind === 'changed') continue;
    const [, on = ''] = keyParts(delta.key);
    changes.push(wiringChange('screen_navigation', { ...delta, kind: delta.kind }, on));
  }
  const both = screensInBoth(base.value, head.value);
  // 関門は**外れたほうが広がる** —— サインインが要らなくなる = 匿名に開く、である。
  for (const delta of diffFacts(gateTable(base.value, both, authOf), gateTable(head.value, both, authOf))) {
    if (delta.kind !== 'changed') continue;
    const direction: DiffDirection = delta.after === GATE_OPEN ? 'widened' : 'narrowed';
    changes.push({
      axis: 'screens',
      direction,
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('screen_gate', direction, { subject: delta.key }),
    });
  }
  for (const delta of diffFacts(gateTable(base.value, both, rolesOf), gateTable(head.value, both, rolesOf))) {
    if (delta.kind !== 'changed') continue;
    changes.push(...roleChanges(delta.key, delta.before ?? '', delta.after ?? '', input.labels));
  }
  return { changes, problems };
}
