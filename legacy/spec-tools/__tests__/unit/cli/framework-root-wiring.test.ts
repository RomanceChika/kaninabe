/**
 * 検証を実行する CLI の入口が、仕組みの根(`frameworkHostRoot()`)を**必ず**渡していることのテスト。
 *
 * 渡し忘れても検査は壊れず、Z3 が「未実施」になって緑のまま残る —— だから入口の配線そのものを、
 * 実行して(verify)と、構文を読んで(検証を実行する全 CLI)の両方で見る。
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runToolCli, TOOL_ROOT, TOOL_TREE } from '../../helpers/run-tool-cli.js';

const CLI_DIR = path.join(TOOL_TREE, 'cli');

describe('検証を実行する CLI は仕組みの根を渡す', () => {
  it('verify-docs を実行すると、Z3 は未実施にならず、仕組みの台帳と見張りテストの注釈を突き合わせる', { timeout: 480_000 }, () => {
    const run = runToolCli(path.join(CLI_DIR, 'verify-docs.ts'), TOOL_ROOT);

    expect(run.stdout).not.toContain('Z3: 未実施');
    expect(run.stdout).toMatch(/Z 群\(保証台帳\): .*仕組みの保証 \d+ 件・仕組みの注釈 [1-9]\d* 件を突き合わせ/);
    // 仕組みの台帳(Z0)と仕組みの突合(Z3)の違反は 0。製品の台帳(Z1)の違反は、その木の製品の事情なのでここでは見ない。
    expect(run.stdout).not.toMatch(/^error \[Z[03]\]/m);
  });

  it('runAllVerifications を呼ぶ CLI は、どれも frameworkRoot: frameworkHostRoot() を渡している', () => {
    const callers = readdirSync(CLI_DIR)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => ({ name, source: readFileSync(path.join(CLI_DIR, name), 'utf-8') }))
      .filter(({ source }) => source.includes('runAllVerifications('));

    // verify と generate の 2 本(入口が増えたら、この一覧が自動で追随して検査される)。
    expect(callers.map(({ name }) => name).sort()).toEqual(['generate-docs.ts', 'verify-docs.ts']);
    for (const { name, source } of callers) {
      expect(source, `${name} が仕組みの根を渡している`).toContain('frameworkRoot: frameworkHostRoot()');
    }
  });
});
