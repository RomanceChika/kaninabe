/**
 * 枠の設定ファイルの既定の export の鍵の許可表(`lib/job/frame-config-keys.ts`。7 回目 C7-4)の表のテスト。
 * 正例(受ける形)・負例(読めない形と許可表の外の欄)・境界(エスケープ・const の書き足し・CommonJS)を並べる。
 */

import { describe, expect, it } from 'vitest';
import { frameConfigKeysProblem, tokensOf } from '../../../lib/job/frame-config-keys.js';
import { NEXT_CONFIG_ALLOWED_KEYS, NEXT_CONFIG_FIXED_MEMBERS } from '../../../lib/targets/nextjs/layout.js';

const check = (text: string, file = 'next.config.ts'): string | null => frameConfigKeysProblem(file, text, NEXT_CONFIG_ALLOWED_KEYS);

describe('frameConfigKeysProblem: 受ける形(正例)', () => {
  it.each([
    ['リテラルを直に', 'export default { poweredByHeader: false };', 'next.config.ts'],
    ['const を指す', 'const c = { poweredByHeader: false, agentRules: false };\nexport default c;', 'next.config.ts'],
    ['型注釈つきの const', 'import type { NextConfig } from "next";\nconst c: NextConfig = { distDir: ".next" };\nexport default c;', 'next.config.ts'],
    ['satisfies / as / 括弧', 'export default ({ poweredByHeader: false } satisfies object) as object;', 'next.config.ts'],
    ['文字列の鍵', "export default { 'poweredByHeader': false };", 'next.config.ts'],
    ['メソッドの形', 'export default { async headers() { return []; } };', 'next.config.ts'],
    ['省略記法', 'const headers = async () => [];\nexport default { headers };', 'next.config.ts'],
    ['入れ子の中身は見ない', 'export default { typescript: { tsconfigPath: "x", pageExtensions: 1 } };', 'next.config.ts'],
    ['CommonJS(.js)', 'module.exports = { poweredByHeader: false };', 'next.config.js'],
    ['空のオブジェクト', 'export default {};', 'next.config.ts'],
  ])('%s → 通る', (_name, text, file) => {
    expect(check(text, file)).toBeNull();
  });
});

describe('frameConfigKeysProblem: 拒む形(負例)', () => {
  it.each([
    ['pageExtensions', "export default { pageExtensions: ['ts', 'api.ts'] };", 'pageExtensions'],
    ['rewrites', 'export default { async rewrites() { return []; } };', 'rewrites'],
    ['redirects', 'export default { redirects: async () => [] };', 'redirects'],
    ['basePath', "export default { basePath: '/x' };", 'basePath'],
    ['output(表に無い欄)', "export default { output: 'standalone' };", 'output'],
    ['識別子の Unicode エスケープ(許可表の欄でも)', 'export default { powered\\u0042yHeader: false };', 'エスケープ'],
    ['識別子の Unicode エスケープ(pageExtensions)', "export default { page\\u0045xtensions: ['api.ts'] };", 'エスケープ'],
    ['文字列の鍵のエスケープ', "export default { 'page\\x45xtensions': [] };", 'エスケープ'],
    ['計算した鍵', "const k = 'page' + 'Extensions';\nexport default { [k]: [] };", '静的でない鍵'],
    ['計算した鍵(文字列のリテラルでも)', "export default { ['poweredByHeader']: false };", '静的でない鍵'],
    ['数の鍵', 'export default { 1: true };', '静的でない鍵'],
    ['スプレッド', "import base from './b';\nexport default { ...base };", 'スプレッド'],
    ['get', 'export default { get distDir() { return ".next"; } };', 'get / set'],
    ['import した値', "import base from './next.base';\nexport default base;", '最上位の const でない'],
    ['let', 'let c = {};\nexport default c;', '最上位の const でない'],
    ['const への書き足し', "const c = {};\nc.rewrites = async () => [];\nexport default c;", '宣言と export のほか'],
    ['Object.assign での書き足し', 'const c = {};\nObject.assign(c, { pageExtensions: [] });\nexport default c;', '宣言と export のほか'],
    ['関数の呼び出し', 'const withX = (c: object) => c;\nexport default withX({});', 'オブジェクトのリテラルでない'],
    ['関数', 'export default (phase: string) => ({ poweredByHeader: phase === "x" });', 'オブジェクトのリテラルでない'],
    ['関数の宣言', 'export default function config() { return {}; }', '関数・クラスの宣言'],
    ['export { x as default }', 'const c = {};\nexport { c as default };', '`export { … }`'],
    ['既定の export が無い', 'export const c = {};', '見つからない'],
    ['既定の export が 2 つ(ESM と CommonJS)', 'module.exports = {};\nexport default {};', '複数'],
    ['構文として読めない', 'export default { poweredByHeader: ', '構文'],
  ])('%s → error', (_name, text, reason) => {
    expect(check(text)).toContain(reason);
  });
});

describe('frameConfigKeysProblem: 値の形を固定した欄(点検 7 回目 B7-4)', () => {
  const fixed = (text: string): string | null => frameConfigKeysProblem('next.config.ts', text, NEXT_CONFIG_ALLOWED_KEYS, NEXT_CONFIG_FIXED_MEMBERS);
  const GOOD_HEADERS = 'async headers() { return [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }]; }';

  it.each([
    ['製品の実物の形', `export default { poweredByHeader: false, ${GOOD_HEADERS} };`],
    ['空白・改行・コメント・引用符の種類は問わない', "export default {\n  // 固定のヘッダ\n  async headers() {\n    return [{ source: '/:path*', headers: staticHeaderEntries(BROWSER_DEFENSE) }];\n  },\n};"],
    ['固定の欄を書かない(既定の値で読む)', 'export default { agentRules: false };'],
  ])('%s → 通る', (_name, text) => {
    expect(fixed(text)).toBeNull();
  });

  it.each([
    [
      'B7-4 の反例: Cache-Control: public を足す',
      'export default { async headers() { return [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }, { source: "/organizer/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000" }] }]; } };',
    ],
    ['生成物の値を手で書き写す', 'export default { async headers() { return [{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] }]; } };'],
    ['source を狭める', 'export default { async headers() { return [{ source: "/api/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }]; } };'],
    ['空にする', 'export default { async headers() { return []; } };'],
    ['矢印関数の形', 'export default { headers: async () => [{ source: "/:path*", headers: staticHeaderEntries(BROWSER_DEFENSE) }] };'],
    ['省略記法(値が別の場所)', 'const headers = async () => [];\nexport default { headers };'],
    ['poweredByHeader: true', 'export default { poweredByHeader: true };'],
    ['experimental にほかの実験の欄を足す(外へ通信しないビルド。2026-11-05)', 'export default { experimental: { agentUpgrade: false, typedRoutes: true } };'],
    ["experimental の更新の案内を戻す", "export default { experimental: { agentUpgrade: 'security' } };"],
  ])('%s → error', (_name, text) => {
    expect(fixed(text)).toContain('の値が決まった形');
  });

  describe('required(点検 16 回目 C16-3: 値を固定した欄を書かないことも error)', () => {
    const required = (text: string): string | null => frameConfigKeysProblem('next.config.ts', text, NEXT_CONFIG_ALLOWED_KEYS, NEXT_CONFIG_FIXED_MEMBERS, true);

    it('製品の実物の形は通る', () => {
      expect(required(`export default { poweredByHeader: false, ${GOOD_HEADERS}, agentRules: false, experimental: { agentUpgrade: false } };`)).toBeNull();
    });

    it.each([
      ['headers を書かない', 'export default { poweredByHeader: false };', ['欄 headers が無い'], ['欄 poweredByHeader が無い']],
      ['poweredByHeader を書かない', `export default { ${GOOD_HEADERS} };`, ['欄 poweredByHeader が無い'], ['欄 headers が無い']],
      ['どちらも書かない', 'export default { agentRules: false };', ['欄 poweredByHeader が無い', '欄 headers が無い'], []],
      ['experimental を書かない(next の更新の案内が既定の security で build が外へ取りに行く)', `export default { poweredByHeader: false, ${GOOD_HEADERS} };`, ['欄 experimental が無い'], ['欄 headers が無い', '欄 poweredByHeader が無い']],
      ['空のオブジェクト', 'export default {};', ['欄 poweredByHeader が無い', '欄 headers が無い'], []],
    ] as const)('%s → error', (_name, text, present, absent) => {
      const problem = required(text);
      for (const part of present) expect(problem).toContain(part);
      for (const part of absent) expect(problem ?? '').not.toContain(part);
    });

    it('値の形が違う欄は「無い」ではなく「決まった形でない」と言う(書いた欄は数える)', () => {
      const problem = required('export default { poweredByHeader: true, async headers() { return []; }, experimental: { agentUpgrade: false } };');
      expect(problem).toContain('欄 poweredByHeader の値が決まった形');
      expect(problem).not.toContain('が無い');
    });

    it('required を渡さなければ、書かない欄は問わない(既定。対照)', () => {
      expect(fixed('export default { agentRules: false };')).toBeNull();
    });
  });

  it('tokensOf: 空白・コメントを捨て、文字列は値で比べる(引用符・エスケープの違いは同じ)', () => {
    expect(tokensOf("a( 'x' ) // c")).toEqual(tokensOf('a("x")'));
    expect(tokensOf("'\\x41'")).toEqual(tokensOf('"A"'));
    expect(tokensOf('a(b)')).not.toEqual(tokensOf('a(c)'));
  });
});
