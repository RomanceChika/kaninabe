/**
 * enforcement-matrix の C21 行が示す**範囲表記**と、実際に登録されている A 群の
 * 検査器の突合。
 *
 * 検査の漏れ探し(2026-09-12 §2)は「どこまで見たか」を示す実行ログの文字列が、見た範囲と
 * 突き合わされていないことを実測し、`verifier-range.ts` がログを登録配列から導く形に直した。
 * ところが**同じ束の中で規約文書の範囲表記が腐った** —— A16 を足したのに C21 行は
 * 「A1〜A15」「app/ が無い環境では A11・A12・A14 をスキップ」のままだった
 * (束 ㉑ の独立レビュー 9-A)。
 *
 * 文書は生成物ではないので、ここでは**同じ 1 か所から導いた文字列が文書に現れること**だけを
 * 見る(`scope-parity.test.ts` が pre-commit と CI の表を突き合わせるのと同じ流儀)。
 * 検査器を 1 つ足して文書を直し忘れたら、このテストが落ちる。
 *
 * **lint の自作規則も同じ形で突き合わせる**(`layer/no-failure-prefix-assert` ほか 15 本の行が対応表に無かった)。
 * 正は `@kaninabe/lint-config/rules` の**登録**(`createLayerPlugin` と `createFrameworkLayerPlugin` の `rules` の鍵の和)である ——
 * どの設定も登録に無い `layer/*` を有効にできない(ESLint が設定の読み込みで落とす)ので、有効にした規則は必ず登録の中にあり、
 * 登録は設定の数(製品・仕組み・道具)に依らず 1 か所で閉じる。対応表の側は、本文に現れる `` `layer/{名前}` `` の全部。
 * 片側にしか無い名前を両方向に赤にする(載っていない規則・腐った規則名)。併せて、冒頭の「現在 **N ルール**」が
 * 表の行数と一致することも見る(行を足して数を直し忘れない)。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_TRACE_VERIFIERS, APP_ONLY_TRACE_VERIFIERS } from '../../../lib/trace/verifiers/index.js';
import { verifierRange } from '../../../lib/verify/verifier-range.js';

/** リポジトリルート(このファイルは legacy/spec-tools/__tests__/unit/gates/ にある)。 */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** 対応表(C21 行がある)。 */
const MATRIX =
  'docs/rules/process/backend/system/standards/conventions/enforcement/enforcement-matrix.md';

/** 対応表の本文。 */
const matrixText = (): string => readFileSync(path.join(REPO_ROOT, MATRIX), 'utf-8');

/** C21 の行そのもの。 */
function c21Row(): string {
  const row = matrixText()
    .split('\n')
    .find((line) => line.startsWith('| C21 |'));
  if (row === undefined) throw new Error('enforcement-matrix に C21 の行がありません(表の形が変わった)');
  return row;
}

describe('enforcement-matrix C21 の範囲表記 ⇔ 登録された A 群', () => {
  it('「中身の正」の範囲表記が登録配列から導いた表記と一致する', () => {
    const range = verifierRange(ALL_TRACE_VERIFIERS.filter((verifier) => verifier.id.startsWith('A')).map((verifier) => verifier.id));

    expect(range).not.toBe('');
    expect(c21Row()).toContain(range);
  });

  it('app/ が無い環境で飛ばす検査器の一覧が登録側の宣言と一致する', () => {
    expect(c21Row()).toContain(APP_ONLY_TRACE_VERIFIERS.join('・'));
  });

  it('飛ばすと宣言した検査器はすべて実在する(腐った一覧を残さない)', () => {
    const registered = new Set(ALL_TRACE_VERIFIERS.map((verifier) => verifier.id));

    for (const id of APP_ONLY_TRACE_VERIFIERS) expect(registered.has(id)).toBe(true);
  });
});

/** `@kaninabe/lint-config/rules` の口のうち、ここで使う 2 つ(規則の登録)。 */
interface LayerRuleRegistry {
  readonly createLayerPlugin: (frameworkStructure: unknown) => { readonly rules: Readonly<Record<string, unknown>> };
  readonly createFrameworkLayerPlugin: () => { readonly rules: Readonly<Record<string, unknown>> };
}

/** 登録された `layer/*` の規則名の全部(製品のプラグインと仕組み側のプラグインの和)。構造の宣言は規則の名前に効かないので空を渡す。 */
function registeredLayerRules(): readonly string[] {
  const registry = createRequire(import.meta.url)('@kaninabe/lint-config/rules') as LayerRuleRegistry;
  const product = Object.keys(registry.createLayerPlugin({ auxFiles: [], baseDirs: [] }).rules);
  const framework = Object.keys(registry.createFrameworkLayerPlugin().rules);
  return [...new Set([...product, ...framework])].map((name) => `layer/${name}`).sort();
}

/** 対応表の本文に現れる `layer/{名前}` の全部。 */
function matrixLayerRules(): readonly string[] {
  return [...new Set([...matrixText().matchAll(/`layer\/([a-z][a-z-]*)`/gu)].map((match) => `layer/${match[1] ?? ''}`))].sort();
}

/** 「## ルール」の節の表の行(`| B1 |` の形)の数。 */
function ruleRowCount(): number {
  const text = matrixText();
  const start = text.indexOf('\n## ルール\n');
  const end = text.indexOf('\n## ', start + 1);
  if (start < 0 || end < 0) throw new Error('enforcement-matrix の「## ルール」の節が見つかりません(表の形が変わった)');
  return text.slice(start, end).split('\n').filter((line) => /^\| [A-Z]+\d+ \|/u.test(line)).length;
}

describe('enforcement-matrix ⇔ 登録された lint の自作規則(layer/*)', () => {
  it('空振りしない: 登録が読める', () => {
    expect(registeredLayerRules().length).toBeGreaterThan(30);
  });

  it('登録された規則は全部、対応表に名指しで載っている', () => {
    const named = new Set(matrixLayerRules());

    expect(registeredLayerRules().filter((rule) => !named.has(rule))).toEqual([]);
  });

  it('対応表に書いた規則名は全部、登録に実在する(腐った名前を残さない)', () => {
    const registered = new Set(registeredLayerRules());

    expect(matrixLayerRules().filter((rule) => !registered.has(rule))).toEqual([]);
  });

  it('冒頭の「現在 N ルール」が表の行数と一致する', () => {
    expect(matrixText()).toContain(`現在 **${ruleRowCount()} ルール**`);
  });
});
