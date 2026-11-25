/**
 * 仕組みの保証台帳と仕組みの根の走査を、**実ローダー・実パイプラインを通して**確かめる。
 *
 * 製品が何も採っていない(`uses: []`)・実装の木も製品の保証台帳も無い題材でも、仕組みの根を渡せば Z3 が走る
 * (仕組みの約束は製品が外せない)。根を渡さなければ未実施の行が skipNotes に載る(黙って緑にならない)。
 * 仕組みの台帳が無い・壊れているときは error で、空の台帳・空の走査で緑にならない。
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';

const SAMPLES = fileURLToPath(new URL('../../fixtures/samples/', import.meta.url));
const DUAL_ACTORS = path.join(SAMPLES, 'dual_actors', 'docs', 'specs');
const FW_TEST = 'framework/runtime/src/domain/__tests__/engine.test.ts';

const LEDGER = [
  '---',
  'doc_type: guarantee_spec',
  'scope: framework',
  'id: framework-guarantee-catalog',
  'vocabulary:',
  '  enforcer:',
  '    - id: type_system',
  'guarantees:',
  '  - id: fw_engine',
  '    label: 許可なしでは遷移しない',
  '    enforced_by: [type_system]',
  '    status: enforced',
  '    canaries: [TC-FW-ENGINE-001]',
  '    summary: 説明',
  'test_cases:',
  '  - id: TC-FW-ENGINE-001',
  '    type: unit',
  '    covers: [forbidden]',
  '    spec_ids: [framework-guarantee-catalog]',
  `    implementation: ${FW_TEST}::遷移`,
  '---',
  '',
].join('\n');

const TEST_BODY = [
  "import { expect, it } from 'vitest';",
  '',
  '// @spec framework-guarantee-catalog @tc TC-FW-ENGINE-001',
  "it('遷移', () => {",
  '  expect(1).toBe(1);',
  '});',
  '',
].join('\n');

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 仕組みの根を作る(台帳と見張りテストの本文は null なら置かない)。 */
function frameworkRoot(files: { ledger: string | null; test: string | null }): string {
  const root = mkdtempSync(path.join(tmpdir(), 'framework-root-'));
  created.push(root);
  const put = (relative: string, body: string): void => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  };
  if (files.ledger !== null) put('framework/guarantees.md', files.ledger);
  if (files.test !== null) put(FW_TEST, files.test);
  return root;
}

/** 何も採らない製品(`uses: []`)で、実パイプラインを回す。 */
async function verify(framework: string | undefined) {
  const repo = mkdtempSync(path.join(tmpdir(), 'framework-pipeline-'));
  created.push(repo);
  writeProductDeclaration(repo, []);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(DUAL_ACTORS, specs, { recursive: true });
  const lines: string[] = [];
  const result = await runAllVerifications({
    ...TEST_VERIFY_INPUTS,
    domainRoot: path.join(specs, 'domain'),
    ...(framework === undefined ? {} : { frameworkRoot: framework }),
    log: (line) => lines.push(line),
  });
  return { ...result, lines };
}

const zFindings = <T extends { verifier: string }>(findings: readonly T[]): T[] => findings.filter((f) => /^Z\d$/.test(f.verifier));

describe('仕組みの保証台帳のパイプライン', () => {
  it('製品が何も採っていなくても、仕組みの根を渡せば Z3 が走って緑になり、突き合わせた件数が行に出る', async () => {
    const result = await verify(frameworkRoot({ ledger: LEDGER, test: TEST_BODY }));

    expect(zFindings(result.findings)).toEqual([]);
    const line = result.lines.find((l) => l.startsWith('Z 群(保証台帳): '));
    expect(line).toContain('仕組みの保証 1 件・仕組みの注釈 1 件を突き合わせ');
    expect(result.skipNotes.some((note) => note.startsWith('Z3: 未実施'))).toBe(false);
    // 仕組みが緑でも、製品の分(この題材は製品の台帳を持たない)が見ていないことは行に残る。
    expect(result.skipNotes.some((note) => note.startsWith('Z 群(保証台帳): ') && note.includes('製品の分(Z1・Z2)はスキップしました'))).toBe(true);
  });

  it('仕組みの根を渡さなければ、未実施の行が skipNotes に載る(黙って緑にならない)', async () => {
    const result = await verify(undefined);

    expect(zFindings(result.findings)).toEqual([]);
    expect(result.skipNotes).toContain('Z3: 未実施 — 仕組みの根が渡されていません(仕組み自身の見張りテストと保証台帳を突き合わせていません)。');
  });

  it('仕組みの台帳が無ければ error(製品の台帳と違い、無いのは正常ではない)', async () => {
    const result = await verify(frameworkRoot({ ledger: null, test: TEST_BODY }));

    expect(zFindings(result.findings).some((f) => f.verifier === 'Z3' && f.message.includes('framework/guarantees.md がありません'))).toBe(true);
    // 台帳を使えないときに「仕組みの保証 0 件を突き合わせ」と嘘を言わない。
    expect(result.lines.some((l) => l.includes('突き合わせ'))).toBe(false);
  });

  it('仕組みの台帳の構文が壊れていれば Z0 と Z3 の error(空の台帳で緑にならない)', async () => {
    const result = await verify(frameworkRoot({ ledger: '---\nid: [壊れた\n---\n', test: TEST_BODY }));

    const z = zFindings(result.findings);
    expect(z.some((f) => f.verifier === 'Z0')).toBe(true);
    expect(z.some((f) => f.verifier === 'Z3' && f.severity === 'error')).toBe(true);
  });

  it('見張りテストの置き場が無ければ、台帳があっても error', async () => {
    const result = await verify(frameworkRoot({ ledger: LEDGER, test: null }));

    expect(zFindings(result.findings).some((f) => f.verifier === 'Z3' && f.message.includes('走査できません'))).toBe(true);
  });

  it('台帳に無い @tc を持つ仕組みのテストは、製品の木が無くても孤児として出る', async () => {
    const orphan = TEST_BODY.replace('TC-FW-ENGINE-001', 'TC-FW-ORPHAN-001');
    const result = await verify(frameworkRoot({ ledger: LEDGER, test: orphan }));

    const z3 = zFindings(result.findings).filter((f) => f.verifier === 'Z3');
    expect(z3.some((f) => f.message.includes('TC-FW-ORPHAN-001'))).toBe(true);
  });
});
