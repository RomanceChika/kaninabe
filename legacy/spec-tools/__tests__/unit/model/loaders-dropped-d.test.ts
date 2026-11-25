/**
 * 残り 8 種(jobs・notifications・config・guarantees・api・ux_principles・design_tokens・usecases)のローダーが返す `dropped`
 * (読めずにモデルへ入れなかった行の数)と、そこから決まる入力の状態のテスト(部品化 入力の状態-d)。
 *
 * 阻害は「**仕様を落とした**」ときだけである(基準 ②-k)。種類ごとに 3 つを実ローダーで確かめる:
 *   - 行を落とさない error(id の食い違い・重複・未知のキー・読めた上での違反)… error は出るが dropped 0 → **読込済み**(検査は回る)
 *   - 行を落とす error(値域の外・必須の欠け・語彙に無い語・マッピングでない行・読めなかったリスト)… dropped > 0 → **阻害**(仕様を落とした)
 *   - 0 件(空のカタログ)・正常な仕様 … dropped 0 → **読込済み**
 * 題材の仕様 1 枚を一時ファイルへ写して壊す(題材の fixture は触らない)。
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMatter, stringifyMatter } from '../../helpers/front-matter.js';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogInput, type CatalogInput, type CatalogLoad } from '../../../lib/kernel/input-state.js';
import { loadSurfaceSpecModel } from '../../../lib/model/surface/loader.js';
import { loadConfigSpecModel } from '../../../lib/model/config/loader.js';
import { loadDesignTokens } from '../../../lib/model/design/loader.js';
import { loadGuaranteeSpecModel } from '../../../lib/model/guarantee/loader.js';
import { loadJobSpecModel } from '../../../lib/model/job/loader.js';
import { loadNotificationSpecModel } from '../../../lib/model/notification/loader.js';
import { loadUsecaseSpecModel } from '../../../lib/model/usecase/loader.js';
import { loadUxPrinciplesModel } from '../../../lib/model/ux-principles/loader.js';

const SAMPLES = path.resolve(import.meta.dirname, '../../fixtures/samples');
const REPO_ROOT = path.resolve(import.meta.dirname, '../../fixtures');

type Data = Record<string, unknown>;
type Edit = (data: Data) => void;

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 題材の仕様 1 枚のフロントマター(写し)。 */
function dataOf(source: string): Data {
  return structuredClone(readMatter(readFileSync(path.join(SAMPLES, source), 'utf8')).data) as Data;
}

/** 配列の欄の n 番目の行(壊す対象)。 */
function row(data: Data, key: string, index = 0): Data {
  return (data[key] as Data[])[index] as Data;
}

/** 一時ディレクトリの中に、壊したフロントマターを `name` で書く。 */
function written(name: string, data: Data): { readonly dir: string; readonly file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'loaders-dropped-d-'));
  created.push(dir);
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringifyMatter('\n# 本文\n', data));
  return { dir, file };
}

/** 種類ごとの読み方(題材のファイル・置き場の名前・ローダーの呼び方・入力の状態の材料)。 */
interface Kind {
  readonly name: string;
  readonly source: string;
  readonly file: string;
  readonly load: (dir: string, file: string) => CatalogLoad<unknown> & { readonly findings: readonly { readonly severity: string }[] };
  /** 読めて 0 件になる形。 */
  readonly empty: Edit;
  /** 行を落とさない error(error は出るが仕様は欠けない)。 */
  readonly keep: Readonly<Record<string, Edit>>;
  /** 行を落とす error(仕様を落とす)。 */
  readonly drop: Readonly<Record<string, Edit>>;
}

const KINDS: readonly Kind[] = [
  {
    name: 'jobs',
    source: 'library/docs/specs/backend/jobs.md',
    file: 'jobs.md',
    load: (_dir, file) => {
      const loaded = loadJobSpecModel(file, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model.catalog }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: (data) => {
      data['jobs'] = [];
    },
    keep: {
      '重複した id の行(先の行が残る)': (data) => {
        (data['jobs'] as Data[]).push({ ...row(data, 'jobs') });
      },
      'カタログの id の食い違い': (data) => {
        data['id'] = 'other-catalog';
      },
    },
    drop: {
      '値域の外の source': (data) => {
        (data['jobs'] as Data[]).push({ ...row(data, 'jobs'), id: 'bad_source', source: 'bogus' });
      },
      'マッピングでない行': (data) => {
        (data['jobs'] as unknown[]).push('文字列の行');
      },
      '語彙に無い kind': (data) => {
        (data['jobs'] as Data[]).push({ ...row(data, 'jobs'), id: 'ghost_kind', kind: 'ghost' });
      },
      '読めなかった jobs のリスト': (data) => {
        data['jobs'] = 'リストではない';
      },
      '空の語彙': (data) => {
        (data['vocabulary'] as Data)['kind'] = [];
      },
    },
  },
  {
    name: 'notifications',
    source: 'library/docs/specs/backend/notifications.md',
    file: 'notifications.md',
    load: (_dir, file) => {
      const loaded = loadNotificationSpecModel(file, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model.catalog }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: (data) => {
      data['notifications'] = [];
    },
    keep: {
      '重複した id の行': (data) => {
        (data['notifications'] as Data[]).push({ ...row(data, 'notifications') });
      },
      'カタログの id の食い違い': (data) => {
        data['id'] = 'other-catalog';
      },
    },
    drop: {
      '語彙に無い medium': (data) => {
        (data['notifications'] as Data[]).push({ ...row(data, 'notifications'), id: 'notify_ghost', medium: 'ghost' });
      },
      '接頭辞の無い通知 ID': (data) => {
        (data['notifications'] as Data[]).push({ ...row(data, 'notifications'), id: 'no_prefix' });
      },
      '読めなかった notifications のリスト': (data) => {
        data['notifications'] = { not: 'a list' };
      },
    },
  },
  {
    name: 'config',
    source: 'expenses/docs/specs/backend/config.md',
    file: 'config.md',
    load: (_dir, file) => {
      const loaded = loadConfigSpecModel(file, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model.catalog }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: (data) => {
      data['variables'] = [];
    },
    keep: {
      '重複した設定の行': (data) => {
        (data['variables'] as Data[]).push({ ...row(data, 'variables') });
      },
      'カタログの id の食い違い': (data) => {
        data['id'] = 'other-catalog';
      },
    },
    drop: {
      '語彙に無い kind': (data) => {
        (data['variables'] as Data[]).push({ ...row(data, 'variables'), id: 'GHOST_KIND', kind: 'ghost' });
      },
      '環境変数名の形でない行': (data) => {
        (data['variables'] as Data[]).push({ ...row(data, 'variables'), id: 'lower_case' });
      },
      '読めなかった variables のリスト': (data) => {
        data['variables'] = 'リストではない';
      },
    },
  },
  {
    name: 'guarantees',
    source: 'library/docs/specs/backend/guarantees.md',
    file: 'guarantees.md',
    load: (_dir, file) => {
      const loaded = loadGuaranteeSpecModel(file, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model.catalog }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: (data) => {
      data['guarantees'] = [];
      data['test_cases'] = [{ ...row(data, 'test_cases') }];
    },
    keep: {
      '行の未知のキー(行は残る)': (data) => {
        row(data, 'guarantees')['extra'] = 1;
      },
      '重複した id の行': (data) => {
        (data['guarantees'] as Data[]).push({ ...row(data, 'guarantees') });
      },
    },
    drop: {
      '値域の外の status': (data) => {
        (data['guarantees'] as Data[]).push({ ...row(data, 'guarantees'), id: 'bad_status', status: 'bogus' });
      },
      '宣言されていない enforcer': (data) => {
        (data['guarantees'] as Data[]).push({ ...row(data, 'guarantees'), id: 'ghost_enforcer', enforced_by: ['ghost'] });
      },
      '欠けた guarantees のリスト': (data) => {
        delete data['guarantees'];
      },
    },
  },
  {
    name: 'surface',
    source: 'library/docs/specs/backend/surface.md',
    file: 'surface.md',
    load: (_dir, file) => {
      const loaded = loadSurfaceSpecModel(file, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model.spec }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: (data) => {
      data['hand_written_views'] = [];
    },
    keep: {
      '未知のキー': (data) => {
        data['unknown_key'] = 1;
      },
      '文書の id の食い違い': (data) => {
        data['id'] = 'other-surface';
      },
    },
    drop: {
      '理由の無い手書きのビュー': (data) => {
        data['hand_written_views'] = [{ table: 'audit_log' }];
      },
      '文字列として読めなかった土台の宣言': (data) => {
        data['surface_base_migration'] = 20260911;
      },
    },
  },
  {
    name: 'ux_principles',
    source: '',
    file: 'ux-principles.md',
    load: (_dir, file) => {
      const loaded = loadUxPrinciplesModel(file, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model.spec }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: (data) => {
      data['principles'] = [];
    },
    keep: {
      '重複した id の原則': (data) => {
        (data['principles'] as Data[]).push({ ...row(data, 'principles') });
      },
      '行の未知のキー': (data) => {
        row(data, 'principles')['extra'] = 1;
      },
      '2 文の statement': (data) => {
        row(data, 'principles')['statement'] = '1 文目。2 文目。';
      },
    },
    drop: {
      '正の整数でない閾値': (data) => {
        row(data, 'principles')['budget'] = { limit: 0 };
      },
      '値域の外の affects': (data) => {
        row(data, 'principles')['affects'] = 'ghost';
      },
      '必須の欠けた原則の行': (data) => {
        (data['principles'] as Data[]).push({ id: 'U9' });
      },
      '欠けた principles のリスト': (data) => {
        delete data['principles'];
      },
    },
  },
  {
    name: 'design_tokens',
    source: 'library/docs/specs/frontend/design/tokens.md',
    file: 'tokens.md',
    load: (dir) => {
      const loaded = loadDesignTokens(dir, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model.spec }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: (data) => {
      data['contrast'] = [];
      data['externals'] = [];
    },
    keep: {
      'テーマ名の形の違反(テーマは残る)': (data) => {
        data['theme'] = 'Bad Theme';
      },
    },
    drop: {
      '#rrggbb でない palette の行': (data) => {
        (data['palette'] as Data)['bad'] = 'not-a-hex';
      },
      'palette に無い ref のトークン': (data) => {
        ((row(data, 'groups')['tokens'] as Data[])[0] as Data)['ref'] = 'no-such-color';
      },
      '欠けた groups のリスト': (data) => {
        delete data['groups'];
      },
      '読めなかった brand': (data) => {
        data['brand'] = 'マッピングではない';
      },
    },
  },
  {
    name: 'usecases',
    source: 'library/docs/specs/frontend/usecases/borrow_self.md',
    file: 'borrow_self.md',
    load: (dir) => {
      const loaded = loadUsecaseSpecModel(dir, { repoRoot: REPO_ROOT });
      return { model: { available: loaded.model.available, catalog: loaded.model }, findings: loaded.findings, dropped: loaded.dropped };
    },
    empty: () => undefined,
    keep: {
      'id が name から導かれる ID と違う(仕様は残る)': (data) => {
        data['id'] = 'usecase-other';
      },
      '未知のキー': (data) => {
        data['guard'] = 'x == y';
      },
    },
    drop: {
      '対象の無い accept の行': (data) => {
        data['accept'] = [{ reason: '理由だけ' }];
      },
      '正の整数でない予算': (data) => {
        data['budget'] = { steps: -1 };
      },
      '読めなかった budget': (data) => {
        data['budget'] = 'マッピングではない';
      },
      '読めなかった test_cases の行': (data) => {
        (data['test_cases'] as Data[]).push({ id: 'TC-X' });
      },
    },
  },
];

/** ux_principles は題材が無いので、最小の台帳を組む。 */
function baseData(kind: Kind): Data {
  if (kind.name !== 'ux_principles') return dataOf(kind.source);
  return {
    doc_type: 'ux_principles_spec',
    scope: 'frontend',
    id: 'ux-principles',
    principles: [{ id: 'U1', statement: '一覧は 7 件までに絞る', enforced_by: 'advisory', budget: { limit: 7 } }],
  };
}

/** 壊した写しを読み、入力の状態(採っている前提)と読み込みの診断を返す。 */
function stateOf(kind: Kind, edit: Edit | null): { readonly state: CatalogInput<unknown>; readonly errors: number; readonly dropped: number } {
  const data = baseData(kind);
  edit?.(data);
  const { dir, file } = written(kind.file, data);
  const load = kind.load(dir, file);
  return {
    state: catalogInput('selected', load),
    errors: load.findings.filter((finding) => finding.severity === 'error').length,
    dropped: load.dropped,
  };
}

describe.each(KINDS)('$name のローダーの dropped と入力の状態', (kind) => {
  it('正常な仕様は dropped 0・読込済み・error なし(土台が正しい)', () => {
    const result = stateOf(kind, null);

    expect(result.errors).toBe(0);
    expect(result.dropped).toBe(0);
    expect(result.state.state).toBe('loaded');
  });

  it('読めて 0 件(空のカタログ)は dropped 0・読込済み(0 件を検査したことは検査しなかったことと違う)', () => {
    const result = stateOf(kind, kind.empty);

    expect(result.dropped).toBe(0);
    expect(result.state.state).toBe('loaded');
  });

  for (const [label, edit] of Object.entries(kind.keep)) {
    it(`行を落とさない error(${label})は error を出すが dropped 0 → 読込済み(検査は回る)`, () => {
      const result = stateOf(kind, edit);

      expect(result.errors).toBeGreaterThan(0);
      expect(result.dropped).toBe(0);
      expect(result.state.state).toBe('loaded');
    });
  }

  for (const [label, edit] of Object.entries(kind.drop)) {
    it(`行を落とす error(${label})は dropped > 0 → 阻害(仕様を落とした。読めた分は partial に持つ)`, () => {
      const result = stateOf(kind, edit);

      expect(result.errors).toBeGreaterThan(0);
      expect(result.dropped).toBeGreaterThan(0);
      expect(result.state).toMatchObject({ state: 'blocked', reason: 'invalid' });
    });
  }
});

describe('usecases のローダー: 置き場のファイル単位の落とし方と、仕様の中の落とし方を合わせて数える', () => {
  it('フロントマターの無い仕様 1 枚 + 仕様の中の対象の無い accept の行 1 件 = 2 件', () => {
    const data = dataOf('library/docs/specs/frontend/usecases/borrow_self.md');
    data['accept'] = [{ reason: '理由だけ' }];
    const { dir } = written('borrow_self.md', data);
    writeFileSync(path.join(dir, 'broken.md'), '# フロントマターの無い仕様\n');

    expect(loadUsecaseSpecModel(dir, { repoRoot: REPO_ROOT }).dropped).toBe(2);
  });

  it('置き場の写しが無ければ available: false・dropped 0(阻害は別の理由 = missing になる)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loaders-dropped-d-'));
    created.push(dir);
    cpSync(path.join(SAMPLES, 'library/docs/specs/frontend/usecases'), path.join(dir, 'copy'), { recursive: true });

    const loaded = loadUsecaseSpecModel(path.join(dir, 'no-such'), { repoRoot: REPO_ROOT });

    expect(loaded.model.available).toBe(false);
    expect(loaded.dropped).toBe(0);
  });
});
