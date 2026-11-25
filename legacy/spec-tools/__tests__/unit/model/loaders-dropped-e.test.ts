/**
 * 読み込みが「落とした行」を数える範囲の続き(部品化 入力の状態-e)を、実ローダーで確かめる。
 *
 *   1. 行の中の宣言の型違い(jobs の `in_transaction: "true"`・通知の `mentions_person: "yes"`・auth の `runs: [x, 5]`)は、
 *      読み取り器が数える ⇒ error が出るだけでなく、入力の状態が**阻害**になる(以前は dropped 0 = 読込済みのまま弱いモデルで検査が走った)
 *   2. ux_principles の `limit: null` は error で名指すが数えない(値が無いのは読み飛ばした宣言ではない)/ 重複した行は残りの欄を読む前に落とす(二重に数えない)
 *   3. data_table は表の中で落とした行(トリガの name の欠け・`supplies` の要素落ち・外部キーの欠け ほか)も数え、その表はモデルに入れない
 *      (欠けた行を前提にする自己完結の検査 T17 が「発火しない関数である」と偽の error を出さない)
 *   4. 空の語彙・空の test_cases は行を落としていない(error は残す)
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMatter, stringifyMatter } from '../../helpers/front-matter.js';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyTriggerBody } from '../../../lib/data/verifiers/t17-trigger-body.js';
import { availableLoad, catalogInput } from '../../../lib/kernel/input-state.js';
import { loadAuthSpecModel } from '../../../lib/model/auth/loader.js';
import { loadDataTableSpecModel } from '../../../lib/model/data/loader.js';
import { parseDataTableSpec } from '../../../lib/model/data/parse-data-table.js';
import { loadJobSpecModel } from '../../../lib/model/job/loader.js';
import { loadNotificationSpecModel } from '../../../lib/model/notification/loader.js';
import { parseFrontmatter, SpecReporter } from '../../../lib/model/parse-common.js';
import { loadUxPrinciplesModel } from '../../../lib/model/ux-principles/loader.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

const SAMPLES = path.resolve(import.meta.dirname, '../../fixtures/samples');
const REPO_ROOT = path.resolve(import.meta.dirname, '../../fixtures');

type Data = Record<string, unknown>;

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 題材の仕様 1 枚のフロントマター(写し)。 */
function dataOf(source: string): Data {
  return structuredClone(readMatter(readFileSync(path.join(SAMPLES, source), 'utf8')).data) as Data;
}

/** 一時ディレクトリの中に、壊したフロントマターを `relative` で書く。 */
function written(relative: string, data: Data): { readonly dir: string; readonly file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'loaders-dropped-e-'));
  created.push(dir);
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringifyMatter('\n# 本文\n', data));
  return { dir, file };
}

describe('行の中の宣言の型違いは読み取り器が数え、阻害にする', () => {
  it('jobs: kind の語の `in_transaction: "true"`(真偽値でない)→ dropped > 0・阻害', () => {
    const data = dataOf('library/docs/specs/backend/jobs.md');
    ((data['vocabulary'] as Data)['kind'] as Data[])[0]!['in_transaction'] = 'true';
    const { file } = written('jobs.md', data);

    const loaded = loadJobSpecModel(file, { repoRoot: REPO_ROOT });

    expect(loaded.findings.some((finding) => finding.severity === 'error')).toBe(true);
    expect(loaded.dropped).toBeGreaterThan(0);
    expect(catalogInput('selected', { model: { available: true, catalog: loaded.model.catalog }, findings: loaded.findings, dropped: loaded.dropped })).toMatchObject({
      state: 'blocked',
      reason: 'invalid',
    });
  });

  it('通知: mention の語の `mentions_person: "yes"`(真偽値でない)→ dropped > 0・阻害', () => {
    const data = dataOf('library/docs/specs/backend/notifications.md');
    ((data['vocabulary'] as Data)['mention'] as Data[])[0]!['mentions_person'] = 'yes';
    const { file } = written('notifications.md', data);

    const loaded = loadNotificationSpecModel(file, { repoRoot: REPO_ROOT });

    expect(loaded.findings.some((finding) => finding.severity === 'error')).toBe(true);
    expect(loaded.dropped).toBeGreaterThan(0);
  });

  it('auth: sign_in の行の `runs: [entry.create, 5]`(文字列でない要素)→ dropped > 0・阻害。正常な写しは dropped 0', () => {
    const clean = dataOf('stores/docs/specs/backend/auth.md');
    const base = loadAuthSpecModel(written('auth.md', clean).file, { repoRoot: REPO_ROOT });
    expect(base.dropped).toBe(0);

    const data = dataOf('stores/docs/specs/backend/auth.md');
    (data['sign_in'] as Data[])[0]!['runs'] = ['entry.create', 5];
    const loaded = loadAuthSpecModel(written('auth.md', data).file, { repoRoot: REPO_ROOT });

    expect(loaded.findings.some((finding) => finding.severity === 'error')).toBe(true);
    expect(loaded.dropped).toBeGreaterThan(0);
  });

  it('auth: subject の欠け(空の主語のまま続けない)→ dropped > 0', () => {
    const data = dataOf('stores/docs/specs/backend/auth.md');
    delete data['subject'];

    const loaded = loadAuthSpecModel(written('auth.md', data).file, { repoRoot: REPO_ROOT });

    expect(loaded.dropped).toBeGreaterThan(0);
  });
});

describe('ux_principles: 重複の判定は残りの欄を読む前・limit: null は名指す', () => {
  /** 台帳を書いて読む。 */
  function load(principles: readonly Data[]) {
    const { file } = written('ux-principles.md', {
      doc_type: 'ux_principles_spec',
      scope: 'frontend',
      id: 'ux-principles',
      principles,
    });
    return loadUxPrinciplesModel(file, { repoRoot: REPO_ROOT });
  }

  const U1: Data = { id: 'U1', statement: '一覧は 7 件までに絞る', enforced_by: 'advisory', budget: { limit: 7 } };

  it('重複した id の行の budget が壊れていても、先の行が残るので落とした行は無い(以前は二重に数えて阻害にした)', () => {
    const loaded = load([U1, { ...U1, budget: { limit: 'abc' } }]);

    expect(loaded.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('id U1 が重複しています')]);
    expect(loaded.dropped).toBe(0);
  });

  it('重複でない行の budget が壊れていれば、落とした行として数える', () => {
    const loaded = load([U1, { ...U1, id: 'U2', budget: { limit: 'abc' } }]);

    expect(loaded.dropped).toBeGreaterThan(0);
  });

  it('`limit: null` は黙って undefined にせず、error で名指す。値が無い(null)のは読み飛ばした宣言ではないので数えない(阻害にしない)', () => {
    const loaded = load([{ ...U1, budget: { limit: null } }]);

    expect(loaded.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('budget.limit が null です')]);
    expect(loaded.dropped).toBe(0);
  });

  it('limit の欠け(キー無し)も null と同じ基準: error で名指すが数えない(値が無いのは読み飛ばした宣言ではない)', () => {
    const loaded = load([{ ...U1, budget: {} }]);

    expect(loaded.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('budget に limit がありません')]);
    expect(loaded.dropped).toBe(0);
  });
});

describe('data_table: 表の中で落とした行も数え、その表は部分モデルの扱いにする', () => {
  /** stores の shelves(トリガ 1 本・外部キー 2 本を持つ)の写しを置き場に 1 枚置く。 */
  function tablesWith(edit: (data: Data) => void) {
    const data = dataOf('stores/docs/specs/backend/data/tables/shelves.md');
    edit(data);
    const { dir } = written('tables/shelves.md', data);
    return { dir: path.join(dir, 'tables'), data };
  }

  const triggers = (data: Data): Data[] => data['triggers'] as Data[];

  it('正常な写しは dropped 0・表はモデルに入り、droppedTables は無い', () => {
    const { dir } = tablesWith(() => undefined);

    const loaded = loadDataTableSpecModel(dir, { repoRoot: REPO_ROOT });

    expect(loaded.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(loaded.dropped).toBe(0);
    expect(loaded.model.tables.map((table) => table.table)).toEqual(['shelves']);
    expect(loaded.model.droppedTables).toBeUndefined();
  });

  it.each([
    ['トリガの name の欠け', (data: Data) => delete triggers(data)[0]!['name']],
    ['トリガの function の欠け', (data: Data) => delete triggers(data)[0]!['function']],
    ['supplies の要素落ち(文字列でない要素)', (data: Data) => (triggers(data)[0]!['supplies'] = ['company_id', 5])],
    ['外部キーの欠け(references)', (data: Data) => delete (data['foreign_keys'] as Data[])[0]!['references']],
    ['マッピングでないトリガの行', (data: Data) => triggers(data).push('文字列の行' as unknown as Data)],
    ['型違いの deferred(真偽値でない)', (data: Data) => (triggers(data)[0]!['deferred'] = 'true')],
  ])('%s: 落とした行として数え、その表はモデルに入れない(ファイル名は droppedTables に載る)', (_label, edit) => {
    const { dir } = tablesWith(edit);

    const loaded = loadDataTableSpecModel(dir, { repoRoot: REPO_ROOT });

    expect(loaded.findings.some((finding) => finding.severity === 'error')).toBe(true);
    expect(loaded.dropped).toBe(1);
    expect(loaded.model.tables).toEqual([]);
    expect(loaded.model.droppedTables).toEqual(['shelves.md']);
    // 入力の状態は阻害(仕様を落とした)で、読めた分(部分のモデル)は落ちた表の名前を持つ。
    const input = catalogInput('selected', availableLoad(loaded.model, loaded.findings, loaded.dropped));
    expect(input).toMatchObject({ state: 'blocked', reason: 'invalid' });
    expect(input.state === 'blocked' ? input.partial?.droppedTables : undefined).toEqual(['shelves.md']);
  });

  it('行を落とさない error(indexes の名前の重複で先の行が残る形)は数えず、表はモデルに入る', () => {
    const { dir } = tablesWith((data) => {
      const indexes = (data['indexes'] as Data[] | undefined) ?? [];
      data['indexes'] = [...indexes, { name: 'dup_idx', on: ['company_id'] }, { name: 'dup_idx', on: ['company_id'] }];
    });

    const loaded = loadDataTableSpecModel(dir, { repoRoot: REPO_ROOT });

    expect(loaded.findings.some((finding) => finding.message.includes('dup_idx'))).toBe(true);
    expect(loaded.dropped).toBe(0);
    expect(loaded.model.tables.map((table) => table.table)).toEqual(['shelves']);
  });

  it('偽の error の経路: トリガの行を落とした表をそのまま検査に回すと T17 が「発火しない関数である」と言う。落ちた表は入れないので言わない', () => {
    // 棚の表のトリガ(写しと凍結)の全部の名前を落とす。
    const { dir, data } = tablesWith((edit) => triggers(edit).forEach((trigger) => delete trigger['name']));
    const reporter = new SpecReporter('shelves.md');
    const parsed = parseDataTableSpec(parseFrontmatter(stringifyMatter('\n', data), reporter) ?? {}, 'shelves.md', reporter);
    // 読めた分の表(トリガ 0 本・トリガ関数 1 本)が、部分のモデルに入ったと仮定した形。
    expect(parsed.value?.triggers).toEqual([]);
    expect(parsed.value?.functions.some((fn) => fn.kind === 'trigger')).toBe(true);
    const domain = specModel([aggregate('shelf', { entity: entitySpec('shelf', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }) })]);
    const sheet = dataTable('shelves', {
      entity: 'shelf',
      triggers: [],
      functions: [{ name: 'sync_shelf_company', args: [], params: [], kind: 'trigger', alsoWrites: [] }],
    });
    const wrong = verifyTriggerBody(domain, dataTableModel([sheet]), undefined, TEST_ROOTS);
    expect(wrong.map((finding) => finding.message).join('\n')).toContain('発火しない関数である');

    // ローダーは落とした行のある表をモデルに入れない ⇒ 自己完結の検査は偽の error を出さない。
    const loaded = loadDataTableSpecModel(dir, { repoRoot: REPO_ROOT });
    expect(verifyTriggerBody(domain, loaded.model, undefined, TEST_ROOTS)).toEqual([]);
  });

  it('落ちた表と読める表が混ざる: 読める表だけがモデルに入り、落ちた表のファイル名が載る', () => {
    const data = dataOf('stores/docs/specs/backend/data/tables/shelves.md');
    const { dir } = written('tables/shelves.md', data);
    const tables = path.join(dir, 'tables');
    cpSync(path.join(SAMPLES, 'stores/docs/specs/backend/data/tables/sections.md'), path.join(tables, 'sections.md'));
    const broken = dataOf('stores/docs/specs/backend/data/tables/stock_moves.md');
    delete (broken['triggers'] as Data[])[0]!['name'];
    writeFileSync(path.join(tables, 'stock_moves.md'), stringifyMatter('\n', broken));

    const loaded = loadDataTableSpecModel(tables, { repoRoot: REPO_ROOT });

    expect(loaded.dropped).toBe(1);
    expect(loaded.model.tables.map((table) => table.table).sort()).toEqual(['sections', 'shelves']);
    expect(loaded.model.droppedTables).toEqual(['stock_moves.md']);
  });
});

describe('空の語彙・空の test_cases は行を落としていない(error は残す)', () => {
  it('jobs: 参照する行が無い軸の語彙が空でも dropped 0(jobs を 0 件にして語彙だけ空にする)', () => {
    const data = dataOf('library/docs/specs/backend/jobs.md');
    data['jobs'] = [];
    (data['vocabulary'] as Data)['on_failure'] = [];
    const { file } = written('jobs.md', data);

    const loaded = loadJobSpecModel(file, { repoRoot: REPO_ROOT });

    expect(loaded.findings.some((finding) => finding.message.includes('vocabulary.on_failure が空です'))).toBe(true);
    expect(loaded.dropped).toBe(0);
  });

  it('data_table: test_cases が空でも dropped 0(error は残る)', () => {
    const data = dataOf('stores/docs/specs/backend/data/tables/shelves.md');
    data['test_cases'] = [];
    const { dir } = written('tables/shelves.md', data);

    const loaded = loadDataTableSpecModel(path.join(dir, 'tables'), { repoRoot: REPO_ROOT });

    expect(loaded.findings.some((finding) => finding.message.includes('test_cases が空です'))).toBe(true);
    expect(loaded.dropped).toBe(0);
  });
});
