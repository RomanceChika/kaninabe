/**
 * 実行時に書き換えさせない生成の定数の一覧と凍結の関所(`gen-kit/frozen-constants.ts`。点検 8 回目 B8-4)のテスト。
 *
 * 表: 一覧の定数の初期化子(凍結あり / なし / 型の注釈つき / `as const satisfies` つき)× 補助の関数の有無 × ファイルの種類で、
 * 関所の答えを固定する。加えて、実際の生成器(サインインの期待表)の出力が関所を通り、評価すると帰り道の着地が
 * 書き換えられないこと(探り台本 B8-4 の `Object.assign(AUTH_LANDING_PATHS, …)` が TypeError)を見る。
 */

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DEEP_FREEZE_HELPER } from '../../../lib/gen-kit/code-emit.js';
import { FROZEN_CONSTANTS, FROZEN_FILES, frozen, frozenFileOf, unfrozenConstantRefusals } from '../../../lib/gen-kit/frozen-constants.js';
import { authExpectationsGenerator } from '../../../lib/generate/render/code-auth.js';
import { specModel, stubGuards } from '../../helpers/model-builder.js';
import { authBranch, authLanding, authModel } from '../../helpers/auth-builder.js';
import { screenSpec } from '../../helpers/screen-builder.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../helpers/platform.js';
import { NO_GATES } from '../../helpers/generate-context.js';

const HELPER = DEEP_FREEZE_HELPER.join('\n');

/** 1 ファイル 1 セクションの関所。 */
function refusals(content: string, file = 'gen/x.ts'): readonly string[] {
  return unfrozenConstantRefusals(new Map([[file, [{ content }]]])).map((refusal) => refusal.reason);
}

describe('凍結の関所', () => {
  it.each([
    { name: '凍結した一覧の定数(型の注釈つき)は通る', content: `${HELPER}\nexport const AUTH_LANDING_PATHS: Readonly<Record<L, string>> = ${frozen("{ active: '/a' }")};`, expected: [] },
    { name: 'as const satisfies を包んだ形も通る', content: `${HELPER}\nexport const PAID_ENTRIES = ${frozen("{} as const satisfies Readonly<Record<string, P>>")};`, expected: [] },
    { name: '一覧に無い定数は凍結を問わない', content: "export const AUTH_MFA_PATH = '/mfa';\nexport const rpcExpectationsByName = rpcExpectations;", expected: [] },
    { name: 'TypeScript でないファイルは見ない', content: "export const AUTH_LANDING_PATHS = { active: '/a' };", file: 'gen/x.sql', expected: [] },
  ])('正例: $name', ({ content, file, expected }) => {
    expect(refusals(content, file)).toEqual(expected);
  });

  it.each([
    { name: '凍結していない一覧の定数(探り台本 B8-4 の形)', content: `${HELPER}\nexport const AUTH_LANDING_PATHS: Readonly<Record<L, string>> = { active: '/a' };`, pattern: /AUTH_LANDING_PATHS が deepFreeze\(…\) で初期化されていません/u },
    { name: 'as const だけで凍結しない', content: `${HELPER}\nexport const AUTH_ENTRY_PATHS = { callback: '/c' } as const;`, pattern: /AUTH_ENTRY_PATHS が deepFreeze/u },
    { name: 'Object.freeze(浅い凍結)では足りない', content: `${HELPER}\nexport const EXTERNAL_EXPECTATIONS = Object.freeze({ a: { timeoutMs: 1 } });`, pattern: /EXTERNAL_EXPECTATIONS が deepFreeze/u },
    { name: '補助の関数の定義が無い(素通しの同名に差し替える形)', content: `import { deepFreeze } from './x';\nexport const rpcExpectations = ${frozen('{}')};`, pattern: /補助の関数 deepFreeze の定義がありません/u },
  ])('負例: $name', ({ content, pattern }) => {
    const found = refusals(content);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(pattern);
  });

  // 点検 9 回目 B9-7: 一覧の定数を出すファイルは「安全の表のファイル」で、隣の定数も全部凍らせる(ファイル単位の閉世界)。
  it.each([
    { name: '隣の定数も凍結していれば通る', content: `${HELPER}\nexport const ROLE_GATES = ${frozen('{}')};\nexport const ROLE_LABELS = ${frozen("{ a: 'A' } as const")};`, expected: 0 },
    { name: '隣の原始値・別名・真偽値は凍結を問わない', content: `${HELPER}\nexport const rpcExpectations = ${frozen('{}')};\nexport const byName: R = rpcExpectations;\nexport const LIMIT = 3;\nexport const PATH = '/x';\nexport const ON = true;`, expected: 0 },
    { name: '一覧の定数が無いファイルの隣は見ない', content: "export const testIds = { a: 'a' };\nexport const table = new Map();", expected: 0 },
    { name: '隣の表の凍らせ忘れ(探り台本 B9-7 の形: 同じファイルに足した表)', content: `${HELPER}\nexport const ROLE_GATES = ${frozen('{}')};\nexport const ROLE_LABELS = { a: 'A' } as const;`, expected: 1 },
    { name: '隣の new Map(可変の表)', content: `${HELPER}\nexport const screenRoutes = ${frozen('{}')};\nexport const byPath = new Map([['/a', 'a']]);`, expected: 1 },
    { name: '隣の Object.freeze(浅い凍結)', content: `${HELPER}\nexport const NAVIGATION_VISIBILITY = ${frozen('{}')};\nexport const extra = Object.freeze({ a: { b: 1 } });`, expected: 1 },
  ])('ファイル単位の閉世界: $name', ({ content, expected }) => {
    const found = refusals(content);
    expect(found, found.join('\n')).toHaveLength(expected);
    if (expected > 0) expect(found[0]).toMatch(/安全の表のファイルの定数/u);
  });

  // 点検 10 回目 A10-5: 名前が集約ごとに変わる engine の規則表・計画・見張りの期待は、ファイルの形で一覧に載せる(同じ閉世界)。
  it.each([
    { file: 'gen/item.transitions.ts', shape: '{機械}.transitions.ts' },
    { file: 'gen/item_member.creates.ts', shape: '{集約}.creates.ts' },
    { file: 'gen/entry.writes.ts', shape: '{集約}.writes.ts' },
    { file: 'gen/entry.deletes.ts', shape: '{集約}.deletes.ts' },
    { file: 'gen/operation-plans.ts', shape: 'operation-plans.ts' },
    { file: 'gen/usecase-plans.ts', shape: 'usecase-plans.ts' },
    { file: 'gen/session-profile.ts', shape: 'session-profile.ts' },
    { file: 'gen/rls-expectations.ts', shape: '*-expectations.ts' },
    { file: 'gen/data-table-expectations.ts', shape: '*-expectations.ts' },
    { file: 'gen/transition-writes.ts', shape: 'transition-writes.ts' },
    { file: 'gen/entry.labels.ts', shape: undefined },
    { file: 'gen/entry.schema.ts', shape: undefined },
    { file: 'gen/eq-worlds.ts', shape: undefined },
    { file: 'gen/entry.creates.test.ts', shape: undefined },
    { file: 'gen/Entry.creates.ts', shape: undefined },
    { file: 'gen/my-operation-plans.ts', shape: undefined },
  ])('ファイルの一覧の当たり: $file → $shape', ({ file, shape }) => {
    expect(frozenFileOf(file)?.shape).toBe(shape);
  });

  it.each([
    { name: '規則表の凍結した定数と原始値は通る', file: 'gen/entry.creates.ts', content: `${HELPER}\nexport const entryCreateRules = ${frozen('{ rules: [] } as const satisfies CreateTable')};\nexport const LIMIT = 3;`, expected: [] },
    {
      name: '規則表の凍らせ忘れ(名前の一覧に無くてもファイルで止まる。探り台本 A10-5 の形)',
      file: 'gen/entry.creates.ts',
      content: `${HELPER}\nexport const entryCreateRules = { rules: [{ by: 'member' }] } as const satisfies CreateTable;`,
      expected: [/安全の表のファイル\(\{集約\}\.creates\.ts\)の定数 entryCreateRules が deepFreeze/u],
    },
    {
      name: '計画の隣の表の凍らせ忘れ',
      file: 'gen/operation-plans.ts',
      content: `${HELPER}\nexport const operationPlans = ${frozen('{}')};\nexport const extra = { a: 1 };`,
      expected: [/安全の表のファイル\(operation-plans\.ts\)の定数 extra が deepFreeze/u],
    },
    {
      name: '見張りの期待の Object.freeze(浅い凍結)',
      file: 'gen/acl-expectations.ts',
      content: `${HELPER}\nexport const functionExecutors = Object.freeze({ f: ['service_role'] });`,
      expected: [/functionExecutors が deepFreeze/u],
    },
    {
      name: 'deepFreeze を使うのに補助の関数の定義が無い',
      file: 'gen/entry.transitions.ts',
      content: `import { deepFreeze } from './x';\nexport const entryMachine = ${frozen('{}')};`,
      expected: [/補助の関数 deepFreeze の定義がありません/u],
    },
    { name: '原始値だけのファイルは補助の関数を問わない(境界)', file: 'gen/session-profile.ts', content: "export const SESSION_ID_FIELD: string | null = 'member_id';", expected: [] },
  ])('ファイルの一覧: $name', ({ file, content, expected }) => {
    const found = refusals(content, file);
    expect(found).toHaveLength(expected.length);
    expected.forEach((pattern, index) => expect(found[index]).toMatch(pattern));
  });

  // 点検 11 回目 A11-2: 外へ出す値を構文木で読み、読めない形は通さない(探り台本 F0〜F4 と、その外の形)。
  describe('読めない形は通さない(A11-2)', () => {
    const FILE = 'gen/entry.creates.ts';
    const PLAIN = "{ a: 'a', b: 'b' }";

    it.each([
      { name: '凍らない定数(対照 F0)', content: `export const t = ${PLAIN};`, pattern: /定数 t が deepFreeze/u },
      { name: '別名の先が凍っていない(F1)', content: `const t = ${PLAIN};\nexport const u = t;`, pattern: /定数 u が deepFreeze/u },
      { name: '別名の別名の先が凍っていない', content: `const t = ${PLAIN};\nconst u = t;\nexport const v = u;`, pattern: /定数 v が deepFreeze/u },
      { name: '型の注釈に ; が入る(F2)', content: `export const t: { a: string; b: string } = ${PLAIN};`, pattern: /定数 t が deepFreeze/u },
      { name: 'export { }(F3)', content: `const t = ${PLAIN};\nexport { t };`, pattern: /定数 t が deepFreeze/u },
      { name: 'export { 名前 as 別名 }', content: `const t = ${PLAIN};\nexport { t as u };`, pattern: /定数 u が deepFreeze/u },
      { name: '文字列で始まる式(F4)', content: 'export const t = "a,b".split(",");', pattern: /定数 t が deepFreeze/u },
      { name: 'テンプレートで始まる式', content: 'export const t = `a,b`.split(",");', pattern: /定数 t が deepFreeze/u },
      { name: '数で始まる式', content: 'export const t = [1].map((x) => x);', pattern: /定数 t が deepFreeze/u },
      { name: 'export default', content: `export default ${PLAIN};`, pattern: /定数 default が deepFreeze/u },
      { name: 'import した名前の別名(先の値をこのファイルで読めない)', content: "import { t } from './x';\nexport const u = t;", pattern: /定数 u が deepFreeze/u },
      { name: '循環する別名', content: 'const a = b;\nconst b = a;\nexport const c = a;', pattern: /定数 c が deepFreeze/u },
      { name: '同じ名前の呼び出しでも引数が 2 つ', content: `${HELPER}\nexport const t = deepFreeze(${PLAIN}, 1);`, pattern: /定数 t が deepFreeze/u },
      { name: 'export let(束縛ごと差し替えられる)', content: "export let t = 'a';", pattern: /const でない export t/u },
      { name: '分割代入の export', content: `const o = ${PLAIN};\nexport const { a } = o;`, pattern: /分割代入の export/u },
      { name: 'export *', content: "export * from './x';", pattern: /再 export/u },
      { name: 'export { } from', content: "export { t } from './x';", pattern: /再 export/u },
      { name: 'export class', content: 'export class T {}', pattern: /読めない形の export/u },
      { name: 'export enum', content: 'export enum T { A }', pattern: /読めない形の export/u },
      { name: 'export namespace', content: 'export namespace T { export const a = 1; }', pattern: /読めない形の export/u },
      { name: 'export import', content: 'export import y = M.N;', pattern: /読めない形の export/u },
      { name: '構文を読めない', content: 'export const t = {', pattern: /構文を読めません/u },
      // 点検 12 回目 A12-4: deepFreeze の引数は全部を凍らせられる形だけ。
      { name: 'deepFreeze(new Map)(F1)', content: `${HELPER}\nexport const t = deepFreeze(new Map([['a', 1]]));`, pattern: /定数 t が deepFreeze/u },
      { name: '中の new Set(F2)', content: `${HELPER}\nexport const t = deepFreeze({ m: new Set(['a']) });`, pattern: /定数 t が deepFreeze/u },
      { name: 'getter の先の可変の値(F6)', content: `${HELPER}\nconst m = { a: 1 };\nexport const t = deepFreeze({ get v() { return m; } });`, pattern: /定数 t が deepFreeze/u },
      { name: 'private 欄を持つインスタンス(F7)', content: `${HELPER}\nclass C { #v = {}; }\nexport const t = deepFreeze(new C());`, pattern: /定数 t が deepFreeze/u },
      { name: 'メソッド', content: `${HELPER}\nexport const t = deepFreeze({ f() { return {}; } });`, pattern: /定数 t が deepFreeze/u },
      { name: 'spread', content: `${HELPER}\nconst o = { a: 1 };\nexport const t = deepFreeze({ ...o });`, pattern: /定数 t が deepFreeze/u },
      { name: '配列の spread', content: `${HELPER}\nconst o = [1];\nexport const t = deepFreeze([...o]);`, pattern: /定数 t が deepFreeze/u },
      { name: '計算された鍵', content: `${HELPER}\nconst k = 'a';\nexport const t = deepFreeze({ [k]: 1 });`, pattern: /定数 t が deepFreeze/u },
      { name: '引数の中の呼び出し', content: `${HELPER}\nexport const t = deepFreeze({ a: make() });`, pattern: /定数 t が deepFreeze/u },
      { name: '名前を経た new Map', content: `${HELPER}\nconst m = new Map();\nexport const t = deepFreeze({ m });`, pattern: /定数 t が deepFreeze/u },
      // 点検 13 回目 A13-6: 引数の外(最上位の文・継承の先・補助の関数の差し替え)。
      { name: '凍らせる前に代入で足す', content: `${HELPER}\nconst t = {};\nt.m = new Map();\nexport const T = deepFreeze(t);`, pattern: /最上位の読めない文/u },
      { name: '凍らせる前に Object.assign で足す', content: `${HELPER}\nconst t = {};\nObject.assign(t, { m: new Map() });\nexport const T = deepFreeze(t);`, pattern: /最上位の読めない文/u },
      { name: '凍らせる前に push で足す', content: `${HELPER}\nconst a = [];\na.push(new Map());\nexport const T = deepFreeze(a);`, pattern: /最上位の読めない文/u },
      { name: '最上位の制御の文', content: `${HELPER}\nconst t = {};\nif (t) t.m = 1;\nexport const T = deepFreeze(t);`, pattern: /最上位の読めない文/u },
      { name: '__proto__ の鍵', content: `${HELPER}\nexport const T = deepFreeze({ __proto__: { a: 1 } });`, pattern: /定数 T が deepFreeze/u },
      { name: '文字列の __proto__ の鍵', content: `${HELPER}\nexport const T = deepFreeze({ '__proto__': { a: 1 } });`, pattern: /定数 T が deepFreeze/u },
      { name: 'import した可変の値を __proto__ に置く', content: `${HELPER}\nimport { m } from './x';\nexport const T = deepFreeze({ __proto__: m });`, pattern: /定数 T が deepFreeze/u },
      { name: '補助の関数のあとの var deepFreeze', content: `${HELPER}\nvar deepFreeze = (v) => v;\nexport const T = deepFreeze({ a: new Date() });`, pattern: /補助の関数|定数 T が deepFreeze/u },
      { name: '補助の関数のあとの var deepFreeze(引数は読める形)', content: `${HELPER}\nvar deepFreeze = (v) => v;\nexport const T = deepFreeze({ a: 1 });`, pattern: /補助の関数/u },
      { name: '可変の表を返す関数(F4)', content: `const table = { a: 1 };\nexport function t() { return table; }`, pattern: /関数 t は読めない形です/u },
    ])('負例: $name', ({ content, pattern }) => {
      const found = refusals(content, FILE);
      expect(found.some((reason) => pattern.test(reason)), found.join('\n')).toBe(true);
    });

    it.each([
      { name: '凍った値の別名', content: `${HELPER}\nconst t = ${frozen(PLAIN)};\nexport const u = t;` },
      { name: '凍った値の export { }', content: `${HELPER}\nconst t = ${frozen(PLAIN)};\nexport { t, t as u };` },
      { name: '型の注釈に ; が入っても凍っていれば通る', content: `${HELPER}\nexport const t: { a: string; b: string } = ${frozen(PLAIN)};` },
      { name: 'as / satisfies / 括弧で包んだ凍結', content: `${HELPER}\nexport const t = (${frozen(PLAIN)}) as T;\nexport const u = ${frozen(PLAIN)} satisfies T;` },
      { name: '凍った値の欄の別名', content: `${HELPER}\nconst t = ${frozen(PLAIN)};\nexport const u = t.a;\nexport const v = t['b'];` },
      { name: '原始値の別名・負の数・テンプレート', content: "const LIMIT = 3;\nexport const a = LIMIT;\nexport const b = -1;\nexport const c = `x${LIMIT}`;\nexport const d = undefined;" },
      { name: 'deepFreeze の引数のリテラルと、同じファイルの名前・import した名前(別のファイルの関所が見る)', content: `${HELPER}\nimport { a, b } from './x';\nconst l = [1, 'x', null, true];\nexport const t = deepFreeze({ l, n: { 'k-1': -1, a, c: b.d }, e: [a] as const } as const);` },
      { name: '__proto__ の字面が値にあるだけなら読める(A13-6 の対照)', content: `${HELPER}\nexport const T = deepFreeze({ a: '__proto__' });` },
      { name: '最上位の宣言だけのファイル(A13-6 の対照)', content: `import type { X } from './x';\n${HELPER}\ntype Y = X;\ninterface Z { a: string; }\nconst t = { a: 1 };\nexport const T = deepFreeze(t);` },
      { name: '型の export は定数に数えない', content: 'export type T = string;\nexport interface I { a: string; }' },
      { name: '型だけの再 export は値を持たない', content: "export type { T } from './x';" },
      { name: 'コメントの中の export は読まない', content: "/* export const t = { a: 1 }; */\nexport const LIMIT = 3;" },
    ])('正例: $name', ({ content }) => {
      expect(refusals(content, FILE)).toEqual([]);
    });

    it.each([
      { name: '別名で外へ出した一覧の定数', content: `const t = ${PLAIN};\nexport { t as ROLE_GATES };`, pattern: /生成の定数 ROLE_GATES が deepFreeze/u },
      { name: '外への名前を替えた一覧の定数', content: `const ROLE_GATES = ${PLAIN};\nexport { ROLE_GATES as x };`, pattern: /定数 x が deepFreeze/u },
      { name: '分割代入で外へ出した一覧の定数', content: `const o = ${PLAIN};\nexport const { ROLE_GATES } = o;`, pattern: /分割代入の export/u },
      { name: '再 export した一覧の定数', content: "export { ROLE_GATES } from './roles';", pattern: /再 export/u },
      { name: '一覧の定数は原始値でも通さない', content: "export const runtimeBindings = 'x';", pattern: /生成の定数 runtimeBindings が deepFreeze/u },
    ])('一覧の定数は対象のファイルの外でも見つける: $name', ({ content, pattern }) => {
      const found = refusals(content);
      expect(found.some((reason) => pattern.test(reason)), found.join('\n')).toBe(true);
    });

    it.each([
      { name: '定義が無い', helper: "import { deepFreeze } from './x';" },
      { name: '同じ名前の素通しの関数', helper: 'function deepFreeze<T>(value: T): T { return value; }' },
      { name: '同じ名前の定数', helper: 'const deepFreeze = <T,>(value: T): T => value;' },
      { name: '正しい定義の後の同名の素通し(F8)', helper: `${HELPER}\nfunction deepFreeze(value: unknown) { return value; }` },
    ])('補助の関数は字面が同じものだけ: $name', ({ helper }) => {
      expect(refusals(`${helper}\nexport const rpcExpectations = ${frozen('{}')};`)).toEqual([expect.stringMatching(/補助の関数 deepFreeze の定義がありません/u)]);
    });
  });

  it('ファイルの一覧は重複なく、どの行も理由を持つ', () => {
    const shapes = FROZEN_FILES.map((entry) => entry.shape);
    expect(new Set(shapes).size).toBe(shapes.length);
    for (const entry of FROZEN_FILES) expect(entry.why).not.toBe('');
  });

  it('一覧は重複なく、どの行も理由を持つ(境界: 原始値の定数は載せない)', () => {
    const names = FROZEN_CONSTANTS.map((constant) => constant.name);
    expect(new Set(names).size).toBe(names.length);
    for (const constant of FROZEN_CONSTANTS) expect(constant.why).not.toBe('');
    expect(names).not.toContain('AUTH_MFA_PATH');
    expect(names).toEqual(expect.arrayContaining(['BROWSER_DEFENSE', 'PAID_ENTRIES', 'AUTH_LANDING_PATHS', 'AUTH_ENTRY_PATHS', 'EXTERNAL_EXPECTATIONS', 'rpcExpectations']));
    expect(names).toEqual(expect.arrayContaining(['screenRoutes', 'ROLE_IMPLICATIONS', 'ROLE_GATES', 'AUTHENTICATED_WHEN', 'NAVIGATION_VISIBILITY']));
  });
});

describe('サインインの期待表の生成物は凍結の関所を通り、着地を書き換えられない', () => {
  const flow = authModel({
    landings: [
      authLanding('active', { screen: 'screen-item-list', summary: '通常の入口へ' }),
      authLanding('guest', { screen: 'screen-guest', variant: 'guest', summary: '参加案内へ' }),
    ],
    branches: [
      authBranch('member_active', { values: { member: 'active' }, summary: '有効メンバーは通す' }),
      authBranch('member_guest', { values: { member: 'guest' }, lands: 'guest', summary: '案内へ' }),
    ],
  });
  const screens = {
    available: true,
    screens: [screenSpec({ name: 'item_list', route: '/items' }), screenSpec({ name: 'guest', route: '/guest' })],
    chromes: [],
    unexposed: [],
    unreachableStates: [],
    unseenStates: [],
  };

  /** 生成物を JavaScript に直して評価し、export を取り出す。 */
  function evaluate(content: string): Record<string, unknown> {
    const js = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, unknown> = {};
    new Function('exports', `'use strict';\n${js}`)(exports);
    return exports;
  }

  it('関所が 0 件で、AUTH_LANDING_PATHS / AUTH_ENTRY_PATHS / SIGN_IN_BRANCHES への Object.assign は TypeError', () => {
    const sections = authExpectationsGenerator.generate(specModel([]), {
      roots: TEST_ROOTS,
      platform: TEST_PLATFORM,
      layout: TEST_LAYOUT,
      gates: NO_GATES,
      guards: stubGuards(),
      auth: flow,
      screens,
    });
    const content = sections[0]?.content ?? '';
    expect(unfrozenConstantRefusals(new Map([[sections[0]?.file ?? '', [{ content }]]]))).toEqual([]);

    const module = evaluate(content);
    const landing = module['AUTH_LANDING_PATHS'] as Record<string, string>;
    expect(() => Object.assign(landing, { active: 'https://evil.example' })).toThrow(TypeError);
    expect(landing['active']).toBe('/items');
    expect(() => Object.assign(module['AUTH_ENTRY_PATHS'] as object, { callback: 'https://evil.example/cb' })).toThrow(TypeError);
    const branches = module['SIGN_IN_BRANCHES'] as { lands: string }[];
    expect(() => Object.assign(branches[0] ?? {}, { lands: 'active' })).toThrow(TypeError);
  });
});
