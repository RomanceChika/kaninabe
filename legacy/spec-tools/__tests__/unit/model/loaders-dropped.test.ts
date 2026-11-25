/**
 * ローダーが返す `dropped`(モデルへ入れずに捨てた仕様・宣言の数)のテスト(部品化 ②-k)。
 *
 * 入力の状態は「読み込みの error が残る」でなく「**仕様を落とした**」ときだけ阻害にする。その判断の材料がこの数である:
 *   - 読めた上での違反(id の不一致)は、error は出るが仕様は落とさない(dropped 0)
 *   - 読めずに捨てた仕様(フロントマターが無い・必須の欄が読めない)は dropped に数える
 *   - README の宣言の読み違い(綴り違いのキー・欠けた欄)は、宣言を落とすので dropped に数える
 *   - 置き場が無い(`available: false`)・正常な木は dropped 0
 * 規約(scripts-code-quality.md)により、fixture を読むのはローダー自身のテストだけ。壊すのは一時ツリーの側で行う。
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadActionSpecModel } from '../../../lib/model/trace/loader.js';
import { loadDataTableSpecModel } from '../../../lib/model/data/loader.js';
import { loadQuerySpecModel } from '../../../lib/model/query/loader.js';
import { loadScreenSpecModel } from '../../../lib/model/screen/loader.js';
import { loadUsecaseSpecModel } from '../../../lib/model/usecase/loader.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');
const REPO_ROOT = path.resolve(FIXTURES, '..');
const STORES_TABLES = path.join(FIXTURES, 'samples', 'stores', 'docs', 'specs', 'backend', 'data', 'tables');

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** fixture を一時ディレクトリへ写す(壊すのは写しの側)。 */
function copyOf(source: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'loaders-dropped-'));
  created.push(dir);
  cpSync(source, dir, { recursive: true });
  return dir;
}

/** ファイルの 1 箇所を書き換える(無ければ落とす)。 */
function rewrite(file: string, from: string, to: string): void {
  const source = readFileSync(file, 'utf8');
  if (!source.includes(from)) throw new Error(`${file} に ${from} が無い`);
  writeFileSync(file, source.replace(from, to));
}

const NO_FRONTMATTER = '# フロントマターの無い仕様\n';

describe('loadActionSpecModel の dropped', () => {
  const load = (dir: string) => loadActionSpecModel(dir, { repoRoot: REPO_ROOT });

  it('正常なツリーは 0・置き場が無いときも 0(モデルが null で、阻害は別の理由 = missing になる)', () => {
    expect(load(path.join(FIXTURES, 'actions-valid')).dropped).toBe(0);
    expect(load(path.join(FIXTURES, 'no-such-actions')).dropped).toBe(0);
  });

  it('id の不一致(読めた上での違反)は error を出すが、仕様は落とさない(0)', () => {
    const dir = copyOf(path.join(FIXTURES, 'actions-valid'));
    rewrite(path.join(dir, 'entry', 'submit.md'), 'id: entry-submit-action', 'id: entry-submit-action-x');

    const loaded = load(dir);

    expect(loaded.findings.length).toBeGreaterThan(0);
    expect(loaded.model?.actions).toHaveLength(1);
    expect(loaded.dropped).toBe(0);
  });

  it('フロントマターが無い・スキーマが壊れた仕様は、1 枚ごとに落とした数へ入る', () => {
    const broken = load(path.join(FIXTURES, 'actions-invalid'));
    const dir = copyOf(path.join(FIXTURES, 'actions-valid'));
    writeFileSync(path.join(dir, 'entry', 'broken.md'), NO_FRONTMATTER);

    expect(broken.model?.actions).toEqual([]);
    expect(broken.dropped).toBe(1);
    expect(load(dir).dropped).toBe(1);
  });

  it('README の宣言の読み違い(綴り違いのキー)は、宣言を落とすので数える', () => {
    const dir = copyOf(path.join(FIXTURES, 'actions-valid'));
    writeFileSync(path.join(dir, 'README.md'), '---\nunhandld:\n  - event: entry.submit\n    reason: 理由\n---\n\n# README\n');

    const loaded = load(dir);

    expect(loaded.findings.length).toBeGreaterThan(0);
    expect(loaded.dropped).toBe(loaded.findings.length);
  });
});

describe('loadDataTableSpecModel の dropped', () => {
  const load = (dir: string) => loadDataTableSpecModel(dir, { repoRoot: REPO_ROOT });

  it('正常なツリーは 0・置き場が無いときも 0', () => {
    expect(load(STORES_TABLES).dropped).toBe(0);
    expect(load(path.join(FIXTURES, 'no-such-tables')).dropped).toBe(0);
  });

  it('id の不一致は error を出すが落とさない(0)。読めない 1 枚は 1 と数える', () => {
    const dir = copyOf(STORES_TABLES);
    const before = load(dir).model.tables.length;
    rewrite(path.join(dir, 'stores.md'), 'id: table-stores', 'id: table-stores-x');
    const mismatched = load(dir);
    writeFileSync(path.join(dir, 'broken.md'), NO_FRONTMATTER);
    const broken = load(dir);

    expect(mismatched.findings.length).toBeGreaterThan(0);
    expect(mismatched.model.tables).toHaveLength(before);
    expect(mismatched.dropped).toBe(0);
    expect(broken.dropped).toBe(1);
  });
});

describe('loadQuerySpecModel の dropped', () => {
  const load = (dir: string) => loadQuerySpecModel(dir, { repoRoot: REPO_ROOT });

  it('正常なツリーは 0・置き場が無いときも 0', () => {
    expect(load(path.join(FIXTURES, 'queries-valid')).dropped).toBe(0);
    expect(load(path.join(FIXTURES, 'no-such-queries')).dropped).toBe(0);
  });

  it('id の不一致は落とさない(0)。読めない 1 枚は 1 と数える', () => {
    const dir = copyOf(path.join(FIXTURES, 'queries-valid'));
    rewrite(path.join(dir, 'workshop', 'list.md'), 'id: query-list', 'id: query-list-x');
    const mismatched = load(dir);
    writeFileSync(path.join(dir, 'workshop', 'broken.md'), NO_FRONTMATTER);
    const broken = load(dir);

    expect(mismatched.findings.length).toBeGreaterThan(0);
    expect(mismatched.model.queries).toHaveLength(2);
    expect(mismatched.dropped).toBe(0);
    expect(broken.dropped).toBe(1);
  });
});

describe('loadScreenSpecModel の dropped', () => {
  const load = (dir: string) => loadScreenSpecModel(dir, { repoRoot: REPO_ROOT, roots: TEST_ROOTS, layout: TEST_LAYOUT });

  it('正常なツリーは 0・置き場が無いときも 0', () => {
    expect(load(path.join(FIXTURES, 'screens-valid')).dropped).toBe(0);
    expect(load(path.join(FIXTURES, 'no-such-frontend')).dropped).toBe(0);
  });

  it('id の不一致は落とさない(0)。読めない画面・クロームは 1 枚ずつ数える', () => {
    const dir = copyOf(path.join(FIXTURES, 'screens-valid'));
    rewrite(path.join(dir, 'screens', 'auth', 'login.md'), 'id: screen-login', 'id: screen-login-x');
    const mismatched = load(dir);
    writeFileSync(path.join(dir, 'screens', 'auth', 'broken.md'), NO_FRONTMATTER);
    writeFileSync(path.join(dir, 'chrome', 'broken.md'), NO_FRONTMATTER);
    const broken = load(dir);

    expect(mismatched.findings.length).toBeGreaterThan(0);
    expect(mismatched.model.screens).toHaveLength(2);
    expect(mismatched.dropped).toBe(0);
    expect(broken.dropped).toBe(2);
  });

  it('README の免除宣言の読み違いは、免除を落とすので数える', () => {
    const dir = copyOf(path.join(FIXTURES, 'screens-valid'));
    writeFileSync(path.join(dir, 'screens', 'README.md'), '---\nunexposd:\n  - event: a.b\n    reason: 理由\n---\n\n# README\n');

    const loaded = load(dir);

    expect(loaded.findings.length).toBeGreaterThan(0);
    expect(loaded.dropped).toBe(loaded.findings.length);
  });
});

describe('loadUsecaseSpecModel の dropped', () => {
  const USECASES = path.join(FIXTURES, 'samples', 'archive', 'docs', 'specs', 'frontend', 'usecases');
  const load = (dir: string) => loadUsecaseSpecModel(dir, { repoRoot: REPO_ROOT });

  it('正常なツリーは 0・置き場が無いときも 0(`available: false` の阻害は別の理由 = missing になる)', () => {
    const ok = load(USECASES);
    expect(ok.model.usecases.length).toBeGreaterThan(0);
    expect(ok.dropped).toBe(0);
    const missing = load(path.join(FIXTURES, 'no-such-usecases'));
    expect(missing.model.available).toBe(false);
    expect(missing.dropped).toBe(0);
  });

  it('フロントマターが無い仕様は、落とした数へ入る(置き場の他の仕様は読める)', () => {
    const dir = copyOf(USECASES);
    writeFileSync(path.join(dir, 'broken.md'), NO_FRONTMATTER);

    const loaded = load(dir);

    expect(loaded.findings.length).toBeGreaterThan(0);
    expect(loaded.model.usecases.length).toBeGreaterThan(0);
    expect(loaded.dropped).toBe(1);
  });
});
