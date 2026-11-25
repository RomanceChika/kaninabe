/**
 * 意味の差分(semantic diff)の fixture。
 *
 * **仕組み側の語彙で書く** —— アプリの集約・ロール・状態の名前は 1 つも使わない
 * (差分器がアプリの語を知らないことを、fixture の側でも示す)。
 */

import type { SideSnapshot } from '../../../lib/diff/types.js';

/** 結果表の元データの置き場。 */
export const RESULTS = 'docs/book/assets/results';

/** 生成物の置き場。 */
export const GENERATED = 'app/src/domain/generated';

/** 版の写しを組み立てる(値 null は「その版に無かった」)。 */
export function snapshot(entries: Readonly<Record<string, string | null>>): SideSnapshot {
  return new Map(Object.entries(entries));
}

/** 単発の操作の結果表 1 本(組み合わせは呼び出し側が渡す)。 */
export function aggregateResults(options: {
  readonly aggregate: string;
  readonly ops: readonly string[];
  readonly actors?: readonly { readonly key: string; readonly role: string }[];
  readonly problems?: readonly string[];
  readonly operations: readonly {
    readonly op: string;
    readonly refusals: readonly Record<string, unknown>[];
    readonly cases: readonly unknown[][];
  }[];
}): string {
  return JSON.stringify({
    aggregate: options.aggregate,
    ops: options.ops,
    problems: options.problems ?? [],
    caseFields: ['state', 'actor', 'array', 'field', 'axis', 'refusal'],
    actors: (options.actors ?? [{ key: 'chief', role: 'chief' }]).map((actor) => ({
      ...actor,
      basis: 'binding',
      arrays: [],
    })),
    operations: options.operations.map((operation) => ({
      op: operation.op,
      kind: 'transition',
      enforcement: 'named',
      count: operation.cases.length,
      folded: [],
      foldedGuards: [],
      refusals: operation.refusals,
      cases: operation.cases,
    })),
  });
}

/** 保存点の結果表 1 本。 */
export function saveResults(options: {
  readonly usecase: string;
  readonly key: string;
  readonly steps: readonly { readonly op: string; readonly label: string }[];
  readonly refusals: readonly Record<string, unknown>[];
  readonly cases: readonly unknown[][];
}): string {
  return JSON.stringify({
    usecase: options.usecase,
    caseFields: ['actor', 'caller', 'repeat', 'input', 'axis', 'blockedAt', 'steps'],
    saves: [
      {
        key: options.key,
        save: options.key,
        count: options.cases.length,
        folded: [],
        foldedGuards: [],
        problems: [],
        actors: [{ key: 'chief', role: 'chief', basis: 'binding' }],
        steps: options.steps,
        refusals: options.refusals,
        cases: options.cases,
      },
    ],
  });
}

/** 表示名の生成物(状態・イベント)。 */
export function labelsFile(stem: string, states: Record<string, string>, events: Record<string, string>): string {
  const upper = `${stem[0]?.toUpperCase() ?? ''}${stem.slice(1)}`;
  return [
    `export const ${stem}StateLabels = ${JSON.stringify(states)} as const;`,
    `export const ${stem}EventLabels = ${JSON.stringify(events)} as const;`,
    `export type ${upper}State = keyof typeof ${stem}StateLabels;`,
  ].join('\n');
}

/** ロールの表示名の生成物。 */
export function rolesFile(labels: Record<string, string>): string {
  return `export const ROLE_LABELS = ${JSON.stringify(labels)} as const;\n`;
}

/** RLS の期待表の生成物(`conditions` は `reads[].when` の写し。束 §14)。 */
export function rlsFile(
  policies: Record<string, readonly string[]>,
  migrations: Record<string, string> = {},
  conditions: Record<string, string> = {},
): string {
  return [
    `export const rlsSelectExpectations = ${JSON.stringify(policies)} as const;`,
    `export const rlsPolicyMigrations: Readonly<Record<string, string>> = ${JSON.stringify(migrations)};`,
    `export const rlsPolicyConditions: Readonly<Record<string, string>> = ${JSON.stringify(conditions)};`,
  ].join('\n');
}

/** 外に出る surface の期待表の生成物。 */
export function apiFile(views: Record<string, unknown>): string {
  return `export const apiViews: Readonly<Record<string, ApiViewExpectation>> = ${JSON.stringify(views)};\n`;
}

/**
 * 外に出る surface の期待表の生成物(**surface のロールに何も与えないビュー**の一覧つき)。
 *
 * その一覧に載るビューの列は「外から読める欄」ではないので、公開される欄の軸は数えない。
 */
export function apiFileWithInternal(
  views: Record<string, unknown>,
  internal: readonly string[],
): string {
  return [
    `export const apiViews: Readonly<Record<string, ApiViewExpectation>> = ${JSON.stringify(views)};`,
    `export const apiInternalViews: readonly string[] = ${JSON.stringify(internal)};`,
  ].join('\n');
}

/** 通知カタログの生成物。 */
export function notificationsFile(decls: readonly Record<string, unknown>[]): string {
  return `export const NOTIFICATIONS: readonly NotificationDecl[] = ${JSON.stringify(decls)};\n`;
}

/** 遷移表の生成物。 */
export function transitionsFile(stem: string, transitions: readonly Record<string, unknown>[]): string {
  const upper = `${stem[0]?.toUpperCase() ?? ''}${stem.slice(1)}`;
  return `export const ${stem}Machine = ${JSON.stringify({ machine: stem, transitions })} as const satisfies MachineTable;\nexport type ${upper}Event = string;\n`;
}

/** 画面の配線の生成物。 */
export function screensFile(routes: Record<string, unknown>): string {
  return `export const screenRoutes = ${JSON.stringify(routes)} as const;\n`;
}

/** 規則の表の生成物(作成 / 編集 / 削除)。 */
export function rulesFile(
  stem: string,
  family: 'Create' | 'Write' | 'Delete',
  rules: readonly Record<string, unknown>[],
): string {
  return `export const ${stem}${family}Rules = ${JSON.stringify({ entity: stem, rules })} as const satisfies ${family}Table;\n`;
}

/** ロールの含意の生成物(宛先の広さの順序を導く元)。 */
export function implicationsFile(labels: Record<string, string>, implications: Record<string, readonly string[]>): string {
  return [
    `export const ROLE_LABELS = ${JSON.stringify(labels)} as const;`,
    `export const ROLE_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(implications)};`,
  ].join('\n');
}

/** 外から呼べる RPC の生成物(外に出る surface の期待表に同居する)。 */
export function apiFileWithRpcs(views: Record<string, unknown>, rpcs: readonly string[]): string {
  return [
    `export const apiViews: Readonly<Record<string, ApiViewExpectation>> = ${JSON.stringify(views)};`,
    `export const apiRpcFunctions: readonly string[] = ${JSON.stringify(rpcs)};`,
  ].join('\n');
}

/** 実行計画の生成物(値は識別子の参照 = 素のデータではない形にする)。 */
export function plansFile(name: string, ops: readonly string[]): string {
  const body = ops.map((op) => `  '${op}': { steps: [{ op: '${op}', rules: sharedRules }] },`).join('\n');
  return `export const ${name} = {\n${body}\n} as const satisfies Readonly<Record<string, RunPlan>>;\n`;
}
