/**
 * H9(プラットフォーム操作の宣言)のうち、**配線先の実際の TypeScript の形との突合**のテスト(束 B。束 A が持ち越した配線先の実在)。
 *
 * 規約網羅(構文木で見る。字面の部分一致では通らない):
 *   - 配線のモジュールが実在し、ポートの interface とその組み立て関数を export している
 *   - メソッドが実在し、引数の数・名前・省略・型(オブジェクトの引数はプロパティの集合まで)と戻り値(`Promise<結果の union<値>>`)が宣言と一致する
 *   - 結果の union の失敗の理由(文字列リテラルの和)と `refusals` の理由の集合が過不足なく一致する
 *   - 行の型が同じファイルにあれば、プロパティの名前・型・null の有無が `rows` と一致する
 *   - 実装の木が無い・置き場を決められない製品は、黙って未検査にならず 1 件で名指す
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { portFactoryName, verifyPlatformBindingSource } from '../../../../lib/auth/verifiers/h9-platform-binding-source.js';
import { layoutPath } from '../../../../lib/model/product/layout.js';
import { designSection } from '../../../helpers/platform-ops-fixture.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

const BINDING_FILE = layoutPath(TEST_LAYOUT, TEST_ROOTS.app, 'platform-binding', 'SessionManagement') ?? '';

/** 配線の隣の場面(生成テストが import する)。 */
const SCENARIO_FILE = BINDING_FILE.replace(/\.ts$/u, '.scenario.ts');

/** 設計どおりの宣言に合う、手書きの配線(本文の一部を差し替えて負例を作る)。 */
const VALID = [
  "export type SessionManagementResult<T> =",
  "  | { readonly ok: true; readonly value: T }",
  "  | { readonly ok: false; readonly reason: 'unauthenticated' | 'forbidden' | 'unknown_current_session' };",
  'export interface SessionSummary {',
  '  readonly id: string;',
  '  readonly createdAt: string;',
  '  readonly lastActiveAt: string;',
  '  readonly current: boolean;',
  '}',
  'export interface SessionManagement {',
  '  list_mine(): Promise<SessionManagementResult<readonly SessionSummary[]>>;',
  '  end_mine(sessionId: string): Promise<SessionManagementResult<boolean>>;',
  '  end_others(): Promise<SessionManagementResult<number>>;',
  '  end_member(memberId: string): Promise<SessionManagementResult<number>>;',
  '  end_every(options?: { readonly keepSelf?: boolean }): Promise<SessionManagementResult<number>>;',
  '}',
  'export function sessionManagement(): SessionManagement {',
  "  throw new Error('not used');",
  '}',
  '',
].join('\n');

/** 実装の木を作り、配線の本文を置く(null なら置かない)。 */
function tree(source: string | null, scenario: string | null = 'export const sessionManagementScenario = () => null;\n'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'h9-binding-'));
  if (source !== null) {
    mkdirSync(path.dirname(path.join(root, BINDING_FILE)), { recursive: true });
    writeFileSync(path.join(root, BINDING_FILE), source);
    if (scenario !== null) writeFileSync(path.join(root, SCENARIO_FILE), scenario);
  }
  return root;
}

function messages(source: string | null, roots = TEST_ROOTS, scenario?: string | null): string[] {
  return verifyPlatformBindingSource(designSection(), { repoRoot: tree(source, scenario), roots, layout: TEST_LAYOUT }).map((finding) => finding.message);
}

describe('H9: 配線先の実際の形との突合', () => {
  it('設計どおりの配線は違反なし', () => {
    expect(messages(VALID)).toEqual([]);
  });

  it('組み立て関数の名前はポート名の先頭を小文字にしたもの', () => {
    expect(portFactoryName('SessionManagement')).toBe('sessionManagement');
  });

  const negatives: readonly { readonly name: string; readonly source: string; readonly expected: string }[] = [
    { name: 'interface を export していない', source: VALID.replace('export interface SessionManagement {', 'interface SessionManagement {'), expected: 'ポート SessionManagement の interface を export していません' },
    { name: '組み立て関数を export していない', source: VALID.replace('export function sessionManagement()', 'function sessionManagement()'), expected: 'ポートの組み立て関数 sessionManagement を export していません' },
    { name: 'メソッドが無い', source: VALID.replace("  end_others(): Promise<SessionManagementResult<number>>;\n", ''), expected: '配線先 SessionManagement.end_others が' },
    { name: 'コメントに名前があるだけでは通らない', source: VALID.replace("  end_others(): Promise<SessionManagementResult<number>>;\n", '  // end_others(): Promise<SessionManagementResult<number>>;\n'), expected: '配線先 SessionManagement.end_others が' },
    { name: '引数の数が違う', source: VALID.replace('end_mine(sessionId: string)', 'end_mine(sessionId: string, extra: string)'), expected: '引数の数が違います(配線先 2 個・params 1 個)' },
    { name: '引数名が違う', source: VALID.replace('end_mine(sessionId: string)', 'end_mine(id: string)'), expected: '引数名が違います(配線先 id・params sessionId)' },
    { name: '引数の型が違う', source: VALID.replace('end_member(memberId: string)', 'end_member(memberId: number)'), expected: '引数 memberId の型が違います(配線先 number・params string)' },
    { name: 'オブジェクトの引数に対応表に無いプロパティがある(余剰)', source: VALID.replace('{ readonly keepSelf?: boolean }', '{ readonly keepSelf?: boolean; readonly force?: boolean }'), expected: '対応表に無いプロパティ force があります(余剰)' },
    { name: 'オブジェクトの引数のプロパティの省略の可否が違う', source: VALID.replace('{ readonly keepSelf?: boolean }', '{ readonly keepSelf: boolean }'), expected: 'プロパティ options.keepSelf の省略の可否が違います' },
    { name: 'オブジェクトの引数のプロパティの型が違う', source: VALID.replace('{ readonly keepSelf?: boolean }', '{ readonly keepSelf?: string }'), expected: 'プロパティ options.keepSelf の型が違います(配線先 string・params boolean)' },
    { name: '戻り値が Promise でない', source: VALID.replace('end_mine(sessionId: string): Promise<SessionManagementResult<boolean>>', 'end_mine(sessionId: string): SessionManagementResult<boolean>'), expected: '戻り値が Promise<SessionManagementResult<…>> ではありません' },
    { name: '戻り値の値の型が違う', source: VALID.replace('end_others(): Promise<SessionManagementResult<number>>', 'end_others(): Promise<SessionManagementResult<boolean>>'), expected: '戻り値の値の型が違います(配線先 boolean・result number)' },
    { name: '読みの戻り値が行の配列でない', source: VALID.replace('Promise<SessionManagementResult<readonly SessionSummary[]>>', 'Promise<SessionManagementResult<SessionSummary>>'), expected: 'result は SessionSummary の配列' },
    { name: '結果の union に宣言に無い理由が増えた', source: VALID.replace("'unknown_current_session' };", "'unknown_current_session' | 'rate_limited' };"), expected: '理由 rate_limited が、refusals に宣言されていません' },
    { name: '宣言した理由を結果の union が返さない(余剰)', source: VALID.replace("'unauthenticated' | 'forbidden' | 'unknown_current_session'", "'unauthenticated' | 'forbidden'"), expected: '理由 unknown_current_session は、結果の union SessionManagementResult が返さない理由です(余剰)' },
    { name: '行の型にプロパティが無い', source: VALID.replace('  readonly lastActiveAt: string;\n', ''), expected: '行の型 SessionSummary にプロパティ lastActiveAt がありません' },
    { name: '行の型のプロパティの型が違う', source: VALID.replace('readonly current: boolean;', 'readonly current: string;'), expected: '行の型 SessionSummary の current の型が違います(配線先 string・rows boolean)' },
    { name: '行の型の null の有無が違う', source: VALID.replace('readonly createdAt: string;', 'readonly createdAt: string | null;'), expected: '行の型 SessionSummary の createdAt の null の有無が違います' },
  ];

  const RUNTIME_UNION = "  | { readonly ok: false; readonly reason: 'unauthenticated' | 'forbidden' | 'unknown_current_session' };";
  const UNSAFE = '安全に読めません';

  /** 失敗の理由の読み取りの負例(fail-closed。読めないものを成功扱いにしない)。 */
  const unsafeReasons: readonly { readonly name: string; readonly source: string; readonly expected: string }[] = [
    { name: '理由が literal | string(広い string が混ざる)', source: VALID.replace("'unknown_current_session' };", "'unknown_current_session' | string };"), expected: '文字列リテラルでない構文があります(string' },
    { name: '理由が string だけ', source: VALID.replace("'unauthenticated' | 'forbidden' | 'unknown_current_session'", 'string'), expected: '文字列リテラルでない構文があります(string' },
    { name: '理由がテンプレートリテラル型', source: VALID.replace("'unknown_current_session' };", '`x_${string}` };'), expected: '文字列リテラルでない構文があります' },
    {
      name: '理由が読めない別名(同じファイルに定義が無い)',
      source: VALID.replace("'unauthenticated' | 'forbidden' | 'unknown_current_session'", 'Elsewhere'),
      expected: '理由の型 Elsewhere を同じファイルの型の別名から解決できません',
    },
    {
      name: '理由が総称の別名(型引数つき)',
      source: VALID.replace("'unauthenticated' | 'forbidden' | 'unknown_current_session'", 'Reason<string>').replace('export interface SessionSummary', 'type Reason<T> = T;\nexport interface SessionSummary'),
      expected: '文字列リテラルでない構文があります(Reason<string>',
    },
    {
      name: '別の失敗の枝に、新しい理由を足した(最初の枝だけ見て通さない)',
      source: VALID.replace(RUNTIME_UNION, `${RUNTIME_UNION.slice(0, -1)}\n  | { readonly ok: false; readonly reason: 'rate_limited' };`),
      expected: '理由 rate_limited が、refusals に宣言されていません',
    },
    {
      name: '別の失敗の枝の理由が広い string',
      source: VALID.replace(RUNTIME_UNION, `${RUNTIME_UNION.slice(0, -1)}\n  | { readonly ok: false; readonly reason: string };`),
      expected: UNSAFE,
    },
    { name: '判別子が無い(ok の欄が無いメンバー)', source: VALID.replace('{ readonly ok: true; readonly value: T }', '{ readonly value: T }'), expected: '判別子 ok が無い' },
    { name: '判別子が boolean(リテラルでない)', source: VALID.replace('{ readonly ok: true; readonly value: T }', '{ readonly ok: boolean; readonly value: T }'), expected: '判別子 ok が無い、または true / false のリテラル型ではありません' },
    { name: '成功の側に値の欄が無い', source: VALID.replace('{ readonly ok: true; readonly value: T }', '{ readonly ok: true; readonly data: T }'), expected: '(成功)に値の欄 value がありません' },
    { name: '失敗の側に理由の欄が無い', source: VALID.replace("readonly reason: 'unauthenticated'", "readonly why: 'unauthenticated'"), expected: '(失敗)に理由の欄 reason がありません' },
    { name: '失敗の枝が 1 つも無い', source: VALID.replace(RUNTIME_UNION, ';').replace('{ readonly ok: true; readonly value: T }\n', '{ readonly ok: true; readonly value: T };\n'), expected: '失敗(ok: false)の枝がありません' },
    { name: 'メンバーが型リテラルでない(別の型への参照)', source: VALID.replace(RUNTIME_UNION, '  | Failure;').replace('export interface SessionSummary', "type Failure = { readonly ok: false; readonly reason: 'forbidden' };\nexport interface SessionSummary"), expected: '型リテラルではありません' },
    { name: '結果の型の別名が無い(interface 等で読めない)', source: VALID.replace('export type SessionManagementResult<T> =', 'export type Other<T> ='), expected: '型の別名が SessionManagement の配線に見つかりません' },
  ];

  it.each(unsafeReasons)('失敗の理由の読み取り: $name は赤(成功扱いにしない)', ({ source, expected }) => {
    const found = messages(source);

    expect(found.some((message) => message.includes(expected)), found.join('\n')).toBe(true);
  });

  it('理由を安全に読めないときは、理由の突合そのものは出さない(読めない理由の過不足を言わない)', () => {
    const found = messages(VALID.replace("'unauthenticated' | 'forbidden' | 'unknown_current_session'", 'string'));

    expect(found.some((message) => message.includes(UNSAFE))).toBe(true);
    expect(found.some((message) => message.includes('(余剰)') && message.includes('refusals の理由'))).toBe(false);
  });

  it('同じファイルの型の別名を経由した文字列リテラルの和は読める(正例)', () => {
    const aliased = VALID.replace("'unauthenticated' | 'forbidden' | 'unknown_current_session'", 'Reason').replace('export interface SessionSummary', "type Reason = 'unauthenticated' | ('forbidden' | 'unknown_current_session');\nexport interface SessionSummary");

    expect(messages(aliased)).toEqual([]);
  });

  it('失敗の枝が複数あっても、全部の理由が宣言と一致すれば通る(正例)', () => {
    const split = VALID.replace(RUNTIME_UNION, `  | { readonly ok: false; readonly reason: 'unauthenticated' | 'forbidden' }\n  | { readonly ok: false; readonly reason: 'unknown_current_session' };`);

    expect(messages(split)).toEqual([]);
  });

  it.each(negatives)('$name はエラー', ({ source, expected }) => {
    const found = messages(source);

    expect(found.length).toBeGreaterThan(0);
    expect(found.some((message) => message.includes(expected)), found.join('\n')).toBe(true);
  });

  it('別のパッケージから import した行の型は読まない(型検査と接続の試験が見る)', () => {
    const imported = VALID.replace(/export interface SessionSummary \{[\s\S]*?\n\}\n/u, "import type { SessionSummary } from 'somewhere';\n");

    expect(messages(imported)).toEqual([]);
  });

  it('生成テストの場面(配線の隣の .scenario)が無い・場面の関数を export していない製品は名指す', () => {
    expect(messages(VALID, TEST_ROOTS, null).join('\n')).toContain(`生成テストの場面 ${SCENARIO_FILE} がありません`);
    expect(messages(VALID, TEST_ROOTS, 'export const other = 1;\n').join('\n')).toContain('sessionManagementScenario を export していません');
  });

  it('配線のファイルが無い・実装の木が無い製品は、黙って未検査にならず名指す', () => {
    expect(messages(null).join('\n')).toContain(`の配線 ${BINDING_FILE} がありません`);
    expect(messages(null)).toHaveLength(1);
    const noApp = messages(VALID, { ...TEST_ROOTS, app: null });
    expect(noApp).toHaveLength(1);
    expect(noApp[0]).toContain('置き場を、置き場の配置から決められません');
  });
});
