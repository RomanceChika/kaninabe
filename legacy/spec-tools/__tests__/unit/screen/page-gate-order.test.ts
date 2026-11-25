/**
 * 関門のある画面の描画の順の読み方(ビルドの入口の関所の入力)。形の許可表なので、負例と正例を表で並べる。
 */

import { describe, expect, it } from 'vitest';
import { pageRender, shellAwaitsGates } from '../../../lib/screen/page-gate-order.js';

const PAGE = "import { renderAScreen } from '../_screens/a';\nexport default async function P({ params }) {\n  const { id } = await params;\n  const screen = await renderAScreen(id);\n  return screen;\n}\n";

describe('pageRender', () => {
  it('動的セグメントの受け取りの次の await が器の描画なら読める', () => {
    expect(pageRender(PAGE)).toEqual({ render: 'renderAScreen', specifier: '../_screens/a' });
  });

  it.each([
    ['await が無い', "export default async function P() { return null; }"],
    ['既定の export でない', "async function P() { await renderAScreen(); }"],
    ['関門を page で先に待つ', "import { renderAScreen } from './a';\nexport default async function P() { await requireSession(); await renderAScreen(); }"],
    ['値を先に待つ', "import { renderAScreen } from './a';\nexport default async function P() { const x = await loadSecret(); return renderAScreen(x); }"],
    ['import が読めない', 'export default async function P() { await renderAScreen(); }'],
    ['コメントの中の await だけ', '// await renderAScreen\nexport default async function P() { return null; }'],
    ['入れ子の関数の器(C15-6)', "import { renderAScreen } from './a';\nexport default async function P() { const f = async () => { await renderAScreen(); }; await f(); }"],
    ['分岐の下の器', "import { renderAScreen } from './a';\nexport default async function P() { if (c) await renderAScreen(); return null; }"],
    ['文字列の /* で先の await を隠す(C15-6)', "import { renderAScreen } from './a';\nexport default async function P() { const p = 'a/*'; const d = await loadSecret(); /* x */ await renderAScreen(d); }"],
  ])('%s は null', (_name, source) => {
    expect(pageRender(source)).toBeNull();
  });
});

describe('shellAwaitsGates', () => {
  const shell = (body: string): string => `export async function renderAScreen() { ${body} }`;

  it.each([
    ['最初が関門', shell('await requireSession(); await load();'), ['requireSession'], true],
    ['2 段の関門', shell('await requireSession(); await requireStaff();'), ['requireSession', 'requireStaff'], true],
    ['値が先', shell('await load(); await requireSession();'), ['requireSession'], false],
    ['2 段の順が逆', shell('await requireStaff(); await requireSession();'), ['requireSession', 'requireStaff'], false],
    ['関門が無い', shell('await load();'), ['requireSession'], false],
    ['関数が無い', 'export function other() {}', ['requireSession'], false],
    ['後ろの別の関数の関門は数えない', 'export async function renderAScreen() { return 1; }\nexport async function x() { await requireSession(); }', ['requireSession'], false],
    ['関門の表が空', shell('await load();'), [], false],
    ['入れ子の関数の await も数える', shell('const f = async () => { await load(); }; await requireSession();'), ['requireSession'], false],
    ['文字列の /* で先の await を隠す(C15-6 の反例)', shell('const p = "a/*"; const d = await read(); /* x */ await requireSession();'), ['requireSession'], false],
    ['テンプレートの // で先の await を隠す', shell('const p = `//`; const d = await read(); await requireSession();'), ['requireSession'], false],
    ['入れ子の関数の中の関門は関門でない(C15-6 の反例)', shell('const check = async () => { await requireSession(); }; const d = await read();'), ['requireSession'], false],
    ['分岐の下の関門は関門でない', shell('if (c) await requireSession(); await load();'), ['requireSession'], false],
    ['短絡の下の関門は関門でない', shell('c && (await requireSession()); await load();'), ['requireSession'], false],
    ['try の下の関門は関門でない', shell('try { await requireSession(); } catch {} await load();'), ['requireSession'], false],
    ['値を受ける関門', shell('const actor = await requireSession(); await load(actor);'), ['requireSession'], true],
    ['コメントと文字列は読まない', shell('const p = "await load()"; /* await load() */ await requireSession();'), ['requireSession'], true],
  ] as const)('%s', (_name, source, symbols, expected) => {
    expect(shellAwaitsGates(source, 'renderAScreen', symbols)).toBe(expected);
  });
});
