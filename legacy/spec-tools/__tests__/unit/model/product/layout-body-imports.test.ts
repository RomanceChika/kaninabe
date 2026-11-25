/**
 * 生成物の本文が辿る相対の import の契約(`lib/model/product/layout-body-imports.ts`)と、その配置の定義の検査での見張り。
 *
 * 生成テストの本文が書く `../../eq-world` などの相対の指定は置き場の深さの写しで、配置が置き場の深さを変えると黙って食い違う。
 * 固定するのは ①Next.js の値と、置き場の深さまで合わせた別の配置は契約を満たす ②深さが違う別の配置(`FOREIGN_LAYOUT`)は理由つきで止まる
 * ③アダプタ 1 本・テスト 1 本の置き場を動かしても止まる ④口の実装(`harness-ports`)は置き場の根(ディレクトリ)だけを見る
 * ⑤指定の綴りの正はこのファイルの定数で、生成器の本文がそれを使っている(表と本文が別々に書かれて食い違わない)
 * ⑥**生成器の出力**(テスト 3 種とアダプタ 6 本の本文)に出る相対の import は全部、表に載っている(表の外の相対 import は赤)
 * ⑦契約を満たす別の配置で生成した本文の相対 import が、その配置の置き場に実際に解決される(表が自己確認で閉じていない証拠)。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutDefinitionProblems } from '../../../../lib/model/product/layout-definition.js';
import { LAYOUT_BODY_IMPORTS, SAVE_ADAPTER_TO_BASE_ADAPTER_DIR } from '../../../../lib/model/product/layout-body-imports.js';
import type { ProductLayout, RoleDecl } from '../../../../lib/model/product/layout.js';
import { harnessAdapterSections } from '../../../../lib/generate/render/code-harness-adapters.js';
import { layoutPath } from '../../../../lib/model/product/layout.js';
import { NEXTJS_LAYOUT } from '../../../../lib/targets/nextjs/layout.js';
import { FOREIGN_BODY_COMPATIBLE_LAYOUT, FOREIGN_LAYOUT } from '../../../helpers/platform.js';
import { generatedBodies } from '../../../helpers/generated-bodies.js';
import type { GeneratedBody } from '../../../helpers/generated-bodies.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 本文の相対の import の違反だけ(ほかの定義の違反を混ぜない)。 */
function bodyProblems(layout: ProductLayout): string[] {
  return layoutDefinitionProblems(layout).filter((problem) => problem.includes('生成物の本文は相対の指定'));
}

/** 役割の宣言を取り出す(無ければテストの書き間違い)。 */
function decl(layout: ProductLayout, role: string): RoleDecl {
  const found = layout[role];
  if (found === undefined) throw new Error(`${role} が配置に無い`);
  return found;
}

describe('本文の相対の import の宣言', () => {
  it('3 種のテスト(eq / rls / eq-save)× アダプタ 2 本と、保存点のアダプタが基盤の層のアダプタ・口の実装を指す 2 本の 8 本', () => {
    expect(LAYOUT_BODY_IMPORTS.map((entry) => `${entry.from} ${entry.specifier} -> ${entry.to}:${entry.name}${entry.sibling === true ? '(兄弟)' : ''}`)).toEqual([
      'eq-test ../../eq-world -> harness-adapter:eq-world',
      'eq-test ../../eq-expect -> harness-adapter:eq-expect',
      'rls-test ../../rls-world -> harness-adapter:rls-world',
      'rls-test ../../rls-expect -> harness-adapter:rls-expect',
      'eq-save-test ../../eq-save-world -> save-harness-adapter:eq-save-world',
      'eq-save-test ../../eq-save-expect -> save-harness-adapter:eq-save-expect',
      'save-harness-adapter ../../infrastructure/__tests__/eq-world -> harness-adapter:eq-world',
      'save-harness-adapter ../../infrastructure/__tests__/harness-ports -> harness-adapter:harness-ports(兄弟)',
    ]);
  });

  it('保存点のアダプタの本文は、表と同じ綴りで基盤の層のアダプタ・口の実装を指す(生成器の本文が定数を使っている)', () => {
    const sections = harnessAdapterSections(TEST_ROOTS, NEXTJS_LAYOUT);
    const content = (name: string): string => sections.find((section) => section.file.endsWith(`/${name}.ts`))?.content ?? '';
    expect(content('eq-save-world')).toContain(`from '${SAVE_ADAPTER_TO_BASE_ADAPTER_DIR}/eq-world'`);
    expect(content('eq-save-expect')).toContain(`from '${SAVE_ADAPTER_TO_BASE_ADAPTER_DIR}/harness-ports'`);
  });
});

/**
 * 本文の相対の import の指定を全部集める(型だけの import も)。拾う書き方: `from '../x'`(シングル・ダブルクォートとも)・動的 `import('../x')`・
 * `vi.mock('../x')`・副作用だけの `import '../x'`。
 */
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bvi\.mock\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]*)\1/g;

/** 本文の相対の import の指定(上の書き方すべて)を全部集める。 */
function relativeSpecifiers(content: string): string[] {
  return [...content.matchAll(RELATIVE_SPECIFIER)].flatMap((match) => (match[2] === undefined ? [] : [match[2]]));
}

/** 生成物の本文 1 本が書く相対の import のうち、表の外のもの(`./x` は同じ役割の兄弟 = 同じ置き場の根で、食い違えないのでここでは見ない)。 */
function outsideTable(body: GeneratedBody): string[] {
  return relativeSpecifiers(body.content).filter(
    (specifier) => !specifier.startsWith('./') && !LAYOUT_BODY_IMPORTS.some((entry) => entry.from === body.role && entry.specifier === specifier),
  );
}

describe('本文の相対の import を集める正規表現', () => {
  it('from(シングル・ダブルクォート)・動的 import・vi.mock・副作用の import を拾い、相対でない指定(`@/` ・`node:`)は拾わない', () => {
    const content = [
      "import { a } from '../a';",
      'import { b } from "../../b";',
      "import type { C } from './c';",
      "const d = await import('../d');",
      'const e = await import("./e");',
      "vi.mock('../../f', () => ({}));",
      "import '../g';",
      "import { h } from '@/h';",
      "import i from 'node:fs';",
    ].join('\n');
    expect(relativeSpecifiers(content)).toEqual(['../a', '../../b', './c', '../d', './e', '../../f', '../g']);
  });
});

describe('本文の相対の import: 表は生成器の出力と突き合わされている', () => {
  const bodies = generatedBodies(NEXTJS_LAYOUT);

  it('生成器の出力は、テスト 3 種とアダプタ 6 本をそろえて出している(突き合わせの母集合が空でない)', () => {
    expect([...new Set(bodies.map((body) => body.role))].sort()).toEqual(['eq-save-test', 'eq-test', 'harness-adapter', 'rls-test', 'save-harness-adapter']);
    expect(bodies.filter((body) => body.role === 'harness-adapter')).toHaveLength(4);
    expect(bodies.filter((body) => body.role === 'save-harness-adapter')).toHaveLength(2);
  });

  it('出力に出る `../` の相対 import は全部、表の (役割, 指定) に載っている(表の外が増えたら赤)', () => {
    for (const body of bodies) expect(outsideTable(body), body.file).toEqual([]);
  });

  it('表の宣言は全部、生成器の出力のどこかで使われている(使われない宣言が表に残らない)', () => {
    for (const entry of LAYOUT_BODY_IMPORTS) {
      expect(bodies.some((body) => body.role === entry.from && relativeSpecifiers(body.content).includes(entry.specifier)), `${entry.from} ${entry.specifier}`).toBe(true);
    }
  });

  it('`./x` は同じ役割の兄弟(アダプタの置き場の根と同じ)を指す: 行き先はその役割が生成する名前か、口の実装 harness-ports だけ', () => {
    for (const role of ['harness-adapter', 'save-harness-adapter'] as const) {
      const siblings = new Set(bodies.filter((body) => body.role === role).map((body) => body.file.replace(/^.*\//, '').replace(/\.ts$/, '')));
      for (const body of bodies.filter((entry) => entry.role === role)) {
        for (const specifier of relativeSpecifiers(body.content).filter((entry) => entry.startsWith('./'))) {
          const name = specifier.slice(2);
          // 口の実装は基盤の層の置き場の根に居る手書きのファイル。保存点のアダプタは基盤の層の外にいる(`./harness-ports` は書けず、表の宣言で指す)。
          expect(siblings.has(name) || (role === 'harness-adapter' && name === 'harness-ports'), `${body.file}: ${specifier}`).toBe(true);
        }
      }
    }
  });
});

describe('本文の相対の import は、互換の配置の置き場に実際に解決される', () => {
  /** 書き出した木(書く先の集合)に、本文の相対 import が解決されるか(`<指定>.ts` が書かれていること。拡張子のない指定の解決と同じ)。 */
  function unresolved(layout: ProductLayout, extra: readonly string[]): string[] {
    const tree = generatedBodies(layout);
    const written = new Set([...tree.map((body) => body.file), ...extra]);
    const missing: string[] = [];
    for (const body of tree) {
      for (const specifier of relativeSpecifiers(body.content)) {
        const target = path.posix.join(path.posix.dirname(body.file), specifier);
        if (!written.has(`${target}.ts`) && !written.has(`${target}/index.ts`)) missing.push(`${body.file}: ${specifier}`);
      }
    }
    return missing;
  }

  /** 口の実装(製品が手で書く。基盤の層のアダプタと同じ置き場の根に居る)の置き場。 */
  function portsOf(layout: ProductLayout): string {
    const adapter = layoutPath(layout, 'app', 'harness-adapter', 'harness-ports');
    if (adapter === null) throw new Error('harness-adapter が配置に無い');
    return adapter;
  }

  it('Next.js の値も、契約を満たす別の配置(FOREIGN_BODY_COMPATIBLE_LAYOUT)も、本文の相対 import は全部、書き出した木の中の実体に解決される', () => {
    expect(unresolved(NEXTJS_LAYOUT, [portsOf(NEXTJS_LAYOUT)])).toEqual([]);
    expect(unresolved(FOREIGN_BODY_COMPATIBLE_LAYOUT, [portsOf(FOREIGN_BODY_COMPATIBLE_LAYOUT)])).toEqual([]);
  });

  it('反例: 深さの違う別の配置(FOREIGN_LAYOUT)や、アダプタの綴りに接尾辞を足した配置では解決されない本文が出る(この確認に力がある証拠)', () => {
    expect(unresolved(FOREIGN_LAYOUT, [portsOf(FOREIGN_LAYOUT)]).length).toBeGreaterThan(0);
    const suffixed: ProductLayout = { ...NEXTJS_LAYOUT, 'harness-adapter': { ...decl(NEXTJS_LAYOUT, 'harness-adapter'), place: (name) => `infrastructure/__tests__/${name}.glue.ts` } };
    const problems = unresolved(suffixed, [portsOf(suffixed)]);
    expect(problems.some((problem) => problem.includes('../../eq-world'))).toBe(true);
  });
});

describe('配置の定義の検査: 本文の相対の import', () => {
  it('Next.js の値と、置き場の深さまで合わせた別の配置は満たす', () => {
    expect(bodyProblems(NEXTJS_LAYOUT)).toEqual([]);
    expect(bodyProblems(FOREIGN_BODY_COMPATIBLE_LAYOUT)).toEqual([]);
  });

  it('反例: 置き場の深さが違う別の配置(FOREIGN_LAYOUT)は、どの役割の置き場がどこへ動くべきかを言って止まる(以前は黙って通っていた)', () => {
    const problems = bodyProblems(FOREIGN_LAYOUT);

    expect(problems).toHaveLength(8);
    expect(problems[0]).toContain('役割 eq-test: 生成物の本文は相対の指定 ../../eq-world で eq-world を import します');
    expect(problems[0]).toContain('server_code/checks/db/same/sample_name.agg.test.ts から辿り着く先は server_code/checks/eq-world');
    expect(problems[0]).toContain('役割 harness-adapter の eq-world の置き場は server_code/checks/glue/eq-world.glue です');
    // 口の実装(兄弟)はディレクトリだけを比べるので、置き場の綴りの違い(`.glue`)ではなく根の違いで言う。
    expect(problems[7]).toContain('server_code/infrastructure/__tests__/harness-ports');
    expect(problems[7]).toContain('server_code/checks/glue/harness-ports です');
  });

  it('アダプタ 1 本の置き場を動かすと、その役割を指す本文の分だけ止まる(動かした先から基盤の層のアダプタへの相対が合うままなら、そちらは止まらない)', () => {
    const moved: ProductLayout = { ...NEXTJS_LAYOUT, 'save-harness-adapter': { ...decl(NEXTJS_LAYOUT, 'save-harness-adapter'), place: (name) => `composition/elsewhere/${name}.ts` } };

    expect(bodyProblems(moved).map((problem) => problem.slice(0, problem.indexOf(':')))).toEqual(['役割 eq-save-test', '役割 eq-save-test']);
    // 動かした先の深さが変わる(1 段浅くなる)と、基盤の層のアダプタを指す本文の分も止まる。
    const shallow: ProductLayout = { ...NEXTJS_LAYOUT, 'save-harness-adapter': { ...decl(NEXTJS_LAYOUT, 'save-harness-adapter'), place: (name) => `${name}.ts` } };
    expect(bodyProblems(shallow).filter((problem) => problem.startsWith('役割 save-harness-adapter'))).toHaveLength(2);
  });

  it('テスト 1 種の置き場の深さを変えると止まる', () => {
    const moved: ProductLayout = { ...NEXTJS_LAYOUT, 'rls-test': { ...decl(NEXTJS_LAYOUT, 'rls-test'), place: (name) => `infrastructure/__tests__/${name}.rls.test.ts` } };

    expect(bodyProblems(moved).map((problem) => problem.slice(0, problem.indexOf(':')))).toEqual(['役割 rls-test', '役割 rls-test']);
  });

  it('口の実装(harness-ports)は置き場の根だけを見る: アダプタの拡張子の綴りを変えても、口の実装の分は止まらない', () => {
    const suffixed: ProductLayout = { ...NEXTJS_LAYOUT, 'harness-adapter': { ...decl(NEXTJS_LAYOUT, 'harness-adapter'), place: (name) => `infrastructure/__tests__/${name}.glue.ts` } };

    const problems = bodyProblems(suffixed);

    expect(problems.some((problem) => problem.includes('harness-ports'))).toBe(false);
    expect(problems.some((problem) => problem.includes('eq-world'))).toBe(true);
  });

  it('どちらかの役割が配置に無いときは、ここでは言わない(下限・基準の検査が言う)', () => {
    const { 'harness-adapter': _omitted, ...without } = NEXTJS_LAYOUT;

    expect(bodyProblems(without)).toEqual([]);
    expect(layoutDefinitionProblems(without)).toContain('役割 harness-adapter: 多重度の下限が 1 の役割なのに、配置に宣言がありません');
  });
});
