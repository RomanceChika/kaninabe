/**
 * ビルドの入口の関所(`cli/build-gate-routes.ts`)が、verify と**同じ仕分け**で実装の範囲を扱うことを別プロセスで見る。
 *
 * 範囲を無視する関所だと、一部しか実装していない製品はビルドできない(実ルートの無い画面で赤になる)。逆に関所だけが別の規則で
 * 範囲を読むと、verify と関所が食い違う。だから関所は verify と同じ 1 つの仕分けの関数を呼び、次を守る。
 *   - 範囲の外の画面に実ルートが無くても緑(その画面の「実ルートが無い」だけが範囲で外れる)
 *   - 範囲の中の画面に実ルートが無ければ、範囲を宣言していても赤
 *   - **宣言していない実ルート**は、範囲に依らず赤(範囲が外すのは「無い」ことだけで、「余計にある」ことは外さない)
 * 題材は中立な `library`(認証の関門・画面 6 枚)。実装の木は、`generate` が書く生成物に、画面ごとの最小の page と器を足して組む
 * (手で書く部分の最小形。器の最初の `await` が関門であること・`vercel.json` の許可表・枠の設定まで、緑の側の対照で実測してある)。
 *
 * **子プロセスを起こす**ので重い組に載せる。
 */

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { writeFrameStubs } from '../../samples/generated-tree.js';
import { cleanupTemps, cliPath, copiedSample, declareToolWatchTest, editFile, SLOW, temp } from '../../helpers/book-entry-fixture.js';
import { runToolCli, TOOL_TREE } from '../../helpers/run-tool-cli.js';

afterAll(cleanupTemps);

/** 画面(題材 library の 6 枚)。`gates` は器の最初の `await` に並べる関門(認証 → ロール)。 */
const SCREENS = [
  { id: 'screen-item-list', route: '/items', name: 'ItemList', gates: [] },
  { id: 'screen-item-detail', route: '/items/[id]', name: 'ItemDetail', gates: ['requireSession'] },
  { id: 'screen-mfa', route: '/mfa', name: 'Mfa', gates: ['requireSession'] },
  { id: 'screen-desk', route: '/desk', name: 'Desk', gates: ['requireSession', 'requireLibrarian'] },
  { id: 'screen-desk-holds', route: '/desk/holds', name: 'DeskHolds', gates: ['requireSession', 'requireLibrarian'] },
  { id: 'screen-my-library', route: '/my', name: 'MyLibrary', gates: ['requireSession'] },
] as const;

/** 目録の画面(実ルートを消す側)以外の 5 枚。 */
const OTHERS = SCREENS.filter((screen) => screen.id !== 'screen-item-list').map((screen) => screen.id);

/** 生成まで済ませ、画面の実ルートを全部置いた木(各ケースはこれを写して使う)。 */
let template = '';

/** 画面 1 枚の最小の実ルート(page と、最初の `await` が関門である器)を置く。 */
function placeScreen(root: string, screen: (typeof SCREENS)[number]): void {
  const dir = path.join(root, 'app/src/app', screen.route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'page.tsx'),
    [`import { render${screen.name}Screen } from '@/ui/${screen.name}';`, 'export default async function Page() {', `  await render${screen.name}Screen();`, '  return null;', '}', ''].join('\n'),
  );
  mkdirSync(path.join(root, 'app/src/ui'), { recursive: true });
  writeFileSync(
    path.join(root, `app/src/ui/${screen.name}.tsx`),
    ["import { requireSession, requireLibrarian } from '@/composition/auth';", `export async function render${screen.name}Screen() {`, ...screen.gates.map((gate) => `  await ${gate}();`), '  return null;', '}', ''].join('\n'),
  );
}

beforeAll(() => {
  template = declareToolWatchTest(copiedSample('gate-template'));
  const generated = runToolCli(cliPath('generate-docs.ts'), TOOL_TREE, ['--root', template]);
  expect(generated.status).toBe(0);
  const roots = loadProductRoots(template).model.roots;
  if (roots === null) throw new Error('題材の根の宣言を読めません');
  writeFrameStubs(template, roots);
  writeFileSync(path.join(template, 'app/vercel.json'), '{"git":{"deploymentEnabled":{"**":false}}}\n');
  for (const screen of SCREENS) placeScreen(template, screen);
}, SLOW);

/** 木を写して、ケースごとの形にする。 */
function caseTree(label: string, options: { readonly implemented?: readonly string[]; readonly implementedRaw?: readonly string[]; readonly withoutItemList?: boolean; readonly undeclaredRoute?: boolean }): string {
  const root = temp(`gate-${label}`);
  cpSync(template, root, { recursive: true });
  if (options.withoutItemList === true) rmSync(path.join(root, 'app/src/app/items/page.tsx'));
  if (options.undeclaredRoute === true) {
    mkdirSync(path.join(root, 'app/src/app/secret'), { recursive: true });
    cpSync(path.join(root, 'app/src/app/mfa/page.tsx'), path.join(root, 'app/src/app/secret/page.tsx'));
  }
  if (options.implementedRaw !== undefined) {
    editFile(root, PRODUCT_DECL_FILE, (text) => text.replace('  - design_tokens\n---', `  - design_tokens\n${options.implementedRaw?.join('\n') ?? ''}\n---`));
  }
  if (options.implemented !== undefined) {
    const lines = options.implemented.length === 0 ? 'implemented: []' : `implemented:\n${options.implemented.map((id) => `  - ${id}`).join('\n')}`;
    editFile(root, PRODUCT_DECL_FILE, (text) => text.replace('  - design_tokens\n---', `  - design_tokens\n${lines}\n---`));
  }
  return root;
}

/** 関所を回す。 */
function gate(root: string): ReturnType<typeof runToolCli> {
  return runToolCli(cliPath('build-gate-routes.ts'), TOOL_TREE, ['--root', root]);
}

describe('ビルドの関所と実装の範囲', () => {
  it('対照: 全部の画面に実ルートがあれば、範囲の宣言が無くても緑(これが赤だと、以降の緑は意味を持たない)', () => {
    const run = gate(caseTree('control', {}));

    expect(run.status, run.stderr).toBe(0);
  }, SLOW);

  it('対照: 実ルートの無い画面があり、範囲の宣言が無ければ赤(その画面の実ルートが無いと言う)', () => {
    const run = gate(caseTree('no-route-no-scope', { withoutItemList: true }));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('/items に対応する実ルートが app/src/app にありません');
  }, SLOW);

  it('範囲の外の画面に実ルートが無い: 緑', () => {
    const run = gate(caseTree('out-of-scope', { withoutItemList: true, implemented: OTHERS }));

    expect(run.status, run.stderr).toBe(0);
  }, SLOW);

  it('`implemented: []` でも、実ルートの無い画面は範囲の外なので緑', () => {
    const run = gate(caseTree('nothing', { withoutItemList: true, implemented: [] }));

    expect(run.status, run.stderr).toBe(0);
  }, SLOW);

  it('範囲の中の画面に実ルートが無ければ、範囲を宣言していても赤', () => {
    const run = gate(caseTree('in-scope', { withoutItemList: true, implemented: [...OTHERS, 'screen-item-list'] }));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('/items に対応する実ルートが app/src/app にありません');
  }, SLOW);

  it('`implemented:`(値が無い)は壊れた宣言で、範囲は「全部」: 実ルートの無い画面があれば赤(壊れた宣言が「何も入れない」に化けて、関所を通さない)', () => {
    const run = gate(caseTree('null-scope', { withoutItemList: true, implementedRaw: ['implemented:'] }));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('/items に対応する実ルートが app/src/app にありません');
  }, SLOW);

  it.each([
    ['null', ['implemented:']],
    ['scalar', ['implemented: room-create-action']],
    ['duplicate', ['implemented:', '  - screen-item-list', 'implemented:', '  - screen-item-list']],
  ] as const)('全部の画面に実ルートがあっても、範囲の宣言が壊れていれば赤(%s。宣言のエラーは P0 として名指す)', (label, implementedRaw) => {
    const run = gate(caseTree(`broken-${label}`, { implementedRaw }));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('P0');
    expect(run.stderr).toContain('implemented');
  }, SLOW);

  it('宣言していない実ルートは、範囲に依らず赤(範囲が外すのは「無い」ことだけ)', () => {
    const run = gate(caseTree('undeclared', { undeclaredRoute: true, implemented: [] }));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('/secret を宣言している screen_spec がありません');
  }, SLOW);

  it('範囲の外の画面の実ルートが無く、かつ宣言していない実ルートもある: 赤(後者だけを言う)', () => {
    const run = gate(caseTree('both', { withoutItemList: true, undeclaredRoute: true, implemented: OTHERS }));

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('/secret を宣言している screen_spec がありません');
    expect(run.stderr).not.toContain('/items に対応する実ルートが');
  }, SLOW);
});
