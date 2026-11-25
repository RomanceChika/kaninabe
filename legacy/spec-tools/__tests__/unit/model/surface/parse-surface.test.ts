/**
 * surface_spec(SQL の公開面の仕様)のパーサー・ローダー・`uses` の旧い綴りのユニットテスト。
 *
 * 規約網羅(surface-spec-writing.md / framework-modules §22-2):
 *   - 正しい宣言が読めること(id は `surface` 固定・書けるキーは閉じている)
 *   - **旧い綴りは二重には受けず、書き直し先を名指して error にする**: `doc_type: api_spec` / 土台の欄 `api_base_migration` /
 *     置き場 `api.md` の取り残し / `product.md` の `uses` の旧い種類名
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSurfaceSpecModel } from '../../../../lib/model/surface/loader.js';
import { parseSurfaceSpec } from '../../../../lib/model/surface/parse-surface.js';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseProductUses } from '../../../../lib/model/product/parse-product.js';

/** 正しいフロントマター。 */
function good(): Record<string, unknown> {
  return {
    doc_type: 'surface_spec',
    scope: 'backend',
    id: 'surface',
    grants_migration: '20260926000426_grants.sql',
    hand_written_views: [{ table: 'tutorial_docs', reason: '内部テーブルで列の正が無い' }],
  };
}

function parse(data: Record<string, unknown>) {
  return parseSurfaceSpec(data, new SpecReporter('docs/specs/backend/surface.md'));
}

const errorsOf = <T extends { readonly severity: string }>(findings: readonly T[]): T[] => findings.filter((f) => f.severity === 'error');

describe('parseSurfaceSpec', () => {
  it('正しい宣言を読める', () => {
    const { value, findings } = parse({ ...good(), surface_base_migration: '20260911000000_api_base.sql' });
    expect(errorsOf(findings)).toEqual([]);
    expect(value?.id).toBe('surface');
    expect(value?.surfaceBaseMigration).toBe('20260911000000_api_base.sql');
    expect(value?.grantsMigration).toBe('20260926000426_grants.sql');
    expect(value?.handWrittenViews.map((view) => view.table)).toEqual(['tutorial_docs']);
  });

  it('id が surface 以外ならエラー(旧い id もここで落ちる)', () => {
    const { findings } = parse({ ...good(), id: 'api-surface' });
    expect(errorsOf(findings).map((f) => f.message)).toEqual(['id api-surface は surface_spec の id ではありません']);
  });

  it('旧い doc_type は書き直し先(surface_spec)を名指して error にする。一般の doc_type の指摘は重ねない', () => {
    const { findings } = parse({ ...good(), doc_type: 'api_spec' });
    const errors = errorsOf(findings);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('api_spec は廃止されました');
    expect(errors[0]?.suggestion).toContain('doc_type: surface_spec');
  });

  it('旧い土台の欄は書き直し先を名指して error にし、未知のキーの指摘を重ねない。新しい欄には写さない', () => {
    const { value, findings } = parse({ ...good(), api_base_migration: '20260911000000_api_base.sql' });
    const errors = errorsOf(findings);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('api_base_migration は廃止されました');
    expect(errors[0]?.suggestion).toContain('surface_base_migration に書き直す');
    expect(value?.surfaceBaseMigration).toBeUndefined();
  });

  it('知らないキーは error', () => {
    expect(errorsOf(parse({ ...good(), bogus: 1 }).findings)).toHaveLength(1);
  });
});

describe('loadSurfaceSpecModel: 旧い置き場', () => {
  /** 一時の木に surface.md / api.md を置く(os の一時領域。リポジトリの中には置かない)。 */
  function tree(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'surface-loader-'));
    mkdirSync(path.join(root, 'backend'), { recursive: true });
    writeFileSync(path.join(root, 'product.md'), '---\ndoc_type: product_roots\n---\n');
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, 'backend', name), text);
    return root;
  }
  const valid = '---\ndoc_type: surface_spec\nscope: backend\nid: surface\n---\n';

  it('新しい置き場だけなら error は無い', () => {
    const root = tree({ 'surface.md': valid });
    const loaded = loadSurfaceSpecModel(path.join(root, 'backend', 'surface.md'), { repoRoot: root });
    expect(loaded.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(loaded.model.available).toBe(true);
  });

  it('旧い置き場 api.md が残っていれば、書き直し先を名指して T12 の error にする(新しい置き場が無くても黙らない)', () => {
    const root = tree({ 'api.md': '---\ndoc_type: api_spec\nid: api-surface\n---\n' });
    const loaded = loadSurfaceSpecModel(path.join(root, 'backend', 'surface.md'), { repoRoot: root });
    expect(loaded.model.available).toBe(false);
    expect(loaded.findings).toHaveLength(1);
    expect(loaded.findings[0]).toMatchObject({ verifier: 'T12', severity: 'error', location: { file: 'backend/api.md' } });
    expect(loaded.findings[0]?.suggestion).toContain('surface.md に移し');
  });
});

describe('parseProductUses: 旧い種類名', () => {
  const parseUses = (uses: readonly unknown[]) => {
    const reporter = new SpecReporter('product.md');
    const result = parseProductUses({ uses }, reporter);
    return { result, errors: reporter.findings().filter((f) => f.severity === 'error') };
  };

  it('surface を読める', () => {
    expect(parseUses(['data_tables', 'surface']).result).toEqual(['data_tables', 'surface']);
  });

  it('旧い api は書き直し先(surface)を名指して error にし、宣言全体を読めないものにする(黙って採らない)', () => {
    const { result, errors } = parseUses(['data_tables', 'api']);
    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('uses の api は廃止されました(surface と書きます)');
  });

  it('知らない種類は従来の文面のまま', () => {
    expect(parseUses(['bogus']).errors[0]?.message).toBe('uses に知らない種類 bogus があります');
  });
});
