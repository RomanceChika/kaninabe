/**
 * **runtime の依存の閉包に、DB の接続の方式もサーバー専用の印も無い**ことの見張り(③-e2D)。
 *
 * 仕様: docs/rules/decisions/common/ADR-0013-framework-runtime-package.md
 *
 * 約束は 3 つである。
 *   1. `@kaninabe/runtime` は `@supabase/**` ・PostgREST の語を持つパッケージ・`server-only` に**依存しない**
 *      (`package.json` の宣言と、配布するソース全部の import の指定子の両方で)。DB への口は中立のポート
 *      (`@kaninabe/runtime/ports`)で、接続の方式は adapter パッケージが持つ。
 *   2. 向きは一方通行である —— adapter は runtime に依存し、runtime は adapter を import しない
 *      (テスト基盤 `testing/**` も同じ。配布するので閉包に入る)。
 *   3. **ベンダーの依存(`@supabase/**` など)は adapter にだけ住む** —— runtime の核は持たず(1 と同じ形を、核の側から
 *      言い切る)、どの adapter も `server-only` を持たない。PostgREST の adapter は `@supabase/**` も持たない(接続層そのものは
 *      製品が渡す。製品の配線だけがクライアントを知る)。認証基盤ごとの adapter(セッションの adapter)は、その認証基盤の
 *      ライブラリに依存するのが正しい形である。
 *
 * 見るのは**静的な import の閉包**であり、配布物(`dist`)ではない —— `dist` は作り直しの前の古い成果物を
 * 抱えうる(移動のあとに古い `infrastructure/` が残る等)ので、検査の正にしない。DB は使わない。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectRepoRoot } from '../../lib/io/paths.js';

/** リポジトリのルート。 */
const REPO_ROOT = detectRepoRoot(import.meta.dirname);

/** runtime パッケージの根。 */
const RUNTIME_DIR = join(REPO_ROOT, 'framework', 'runtime');

/** adapter パッケージの置き場(この下のディレクトリ 1 つが adapter 1 つ)。 */
const ADAPTERS_ROOT = join(REPO_ROOT, 'framework', 'adapters');

/** PostgREST の adapter パッケージの根。 */
const ADAPTER_DIR = join(ADAPTERS_ROOT, 'postgrest');

/** adapter パッケージの根の全部(`package.json` を持つディレクトリ)。 */
const ADAPTER_DIRS: readonly string[] = readdirSync(ADAPTERS_ROOT)
  .map((name) => join(ADAPTERS_ROOT, name))
  .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, 'package.json')));

/** ベンダーの依存(adapter にだけ住む)。 */
const VENDOR: readonly RegExp[] = [/^@supabase\//u];

/** 閉包に入ってはならない指定子(runtime 側)。 */
const FORBIDDEN_IN_RUNTIME: readonly RegExp[] = [/^@supabase\//u, /postgrest/iu, /^server-only$/u, /^@kaninabe\/adapter-/u];

/** 閉包に入ってはならない指定子(adapter 側)。runtime は依存してよい(向きは adapter → runtime)。 */
const FORBIDDEN_IN_ADAPTER: readonly RegExp[] = [/^@supabase\//u, /^server-only$/u];

/** import の指定子を取り出す形(静的 import / 再輸出 / 副作用 import / 動的 import / require)。 */
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/gu;

/**
 * 配布するソースの全部(テストを除く `.ts` / `.mts` / `.mjs`)。
 *
 * @param dir - 歩く根
 * @returns ファイルの絶対パス
 */
function sourcesUnder(dir: string): readonly string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourcesUnder(path));
    else if (/\.(?:ts|mts|mjs)$/u.test(name) && !/\.test\./u.test(name)) found.push(path);
  }
  return found;
}

/**
 * ファイルが import する指定子の全部。
 *
 * @param file - ファイルの絶対パス
 * @returns 指定子(重複あり)
 */
function specifiersOf(file: string): readonly string[] {
  return specifiersIn(readFileSync(file, 'utf8'));
}

/**
 * ソースの文字列から、コメントを除いたうえで import の指定子を取り出す(コメントの中の
 * 「`import 'server-only'` を持たない」のような説明を拾わない)。
 *
 * @param source - ソースの全文
 * @returns 指定子(重複あり)
 */
function specifiersIn(source: string): readonly string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1');
  return [...code.matchAll(SPECIFIER)].map((match) => match[1] ?? '');
}

/**
 * 木の中で、禁じられた指定子を import しているファイル。
 *
 * @param roots - 見る根(パッケージ内のソースの根)
 * @param forbidden - 禁じる指定子の形
 * @returns 「相対パス: 指定子」の並び(空なら閉じている)
 */
function violations(roots: readonly string[], forbidden: readonly RegExp[]): readonly string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const file of sourcesUnder(root)) {
      for (const specifier of specifiersOf(file)) {
        if (forbidden.some((pattern) => pattern.test(specifier))) out.push(`${file.slice(REPO_ROOT.length + 1)}: ${specifier}`);
      }
    }
  }
  return out;
}

/** `package.json` が宣言する依存の名前(dependencies / devDependencies / peerDependencies)。 */
function declaredDependencies(dir: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
  return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) => Object.keys(manifest[key] ?? {}));
}

describe('runtime の依存の閉包(DB の接続の方式・サーバー専用の印・向き)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-CLOSURE-001
  it('runtime の宣言した依存にも、配布するソースの import にも、@supabase / PostgREST / server-only が 1 つも無い', () => {
    const declared = declaredDependencies(RUNTIME_DIR);
    expect(declared.filter((name) => FORBIDDEN_IN_RUNTIME.some((pattern) => pattern.test(name)))).toEqual([]);
    expect(violations([join(RUNTIME_DIR, 'src'), join(RUNTIME_DIR, 'testing'), join(RUNTIME_DIR, 'scripts')], FORBIDDEN_IN_RUNTIME)).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-CLOSURE-002
  it('runtime の核はベンダーの依存(@supabase など)を持たず、ベンダー依存は adapters にだけ住む。依存は adapter → runtime の一方通行で、PostgREST の adapter は @supabase / server-only を持たない', () => {
    // runtime の核: 宣言した依存にも配布するソースの import にも、ベンダーの依存が無い。
    expect(declaredDependencies(RUNTIME_DIR).filter((name) => VENDOR.some((pattern) => pattern.test(name)))).toEqual([]);
    expect(violations([join(RUNTIME_DIR, 'src'), join(RUNTIME_DIR, 'testing'), join(RUNTIME_DIR, 'scripts')], VENDOR)).toEqual([]);
    // どの adapter も runtime に依存し(向きは adapter → runtime)、サーバー専用の印を持たない。
    expect(ADAPTER_DIRS.length).toBeGreaterThanOrEqual(2);
    for (const dir of ADAPTER_DIRS) {
      expect(declaredDependencies(dir), dir).toContain('@kaninabe/runtime');
      expect(declaredDependencies(dir).filter((name) => name === 'server-only'), dir).toEqual([]);
      expect(violations([join(dir, 'src')], [/^server-only$/u]), dir).toEqual([]);
    }
    // PostgREST の adapter は接続層そのものを受け取らない(@supabase も持たない)。
    expect(declaredDependencies(ADAPTER_DIR).filter((name) => FORBIDDEN_IN_ADAPTER.some((pattern) => pattern.test(name)))).toEqual([]);
    expect(violations([join(ADAPTER_DIR, 'src')], FORBIDDEN_IN_ADAPTER)).toEqual([]);
  });

  it('見張りが空振りしない: 根が実在し、検査に使う指定子の形が実際の import を拾う', () => {
    expect(sourcesUnder(join(RUNTIME_DIR, 'src')).length).toBeGreaterThan(30);
    expect(sourcesUnder(join(ADAPTER_DIR, 'src')).length).toBeGreaterThan(3);
    // adapter は runtime を import している(閉包の向きを読み違えていない証拠)。
    const adapterSpecifiers = sourcesUnder(join(ADAPTER_DIR, 'src')).flatMap(specifiersOf);
    expect(adapterSpecifiers.some((specifier) => specifier.startsWith('@kaninabe/runtime/'))).toBe(true);
    // 禁じる形が、書いてあれば拾われる。
    const sample = "import 'server-only';\nimport { createClient } from '@supabase/supabase-js';\nconst x = await import('@kaninabe/adapter-postgrest');\n";
    const found = specifiersIn(sample);
    expect(found).toEqual(['server-only', '@supabase/supabase-js', '@kaninabe/adapter-postgrest']);
    // コメントの中の言及は拾わない。
    expect(specifiersIn("// import 'server-only'\n/* import x from '@supabase/ssr' */\nconst a = 1;\n")).toEqual([]);
    expect(found.every((specifier) => FORBIDDEN_IN_RUNTIME.some((pattern) => pattern.test(specifier)))).toBe(true);
  });
});
