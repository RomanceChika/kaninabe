/**
 * query_spec ローダー(I/O 境界)と Q0(スキーマ適合)のテスト。
 *
 * 規約(scripts-code-quality.md)により fixture ファイルを使うのはローダー自身のテストだけ。
 * 検証器のテストは verifiers/ 配下でモデルをリテラル構築する。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadQuerySpecModel } from '../../../../lib/model/query/loader.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures');
const REPO_ROOT = path.resolve(FIXTURES, '..');

/** fixture ディレクトリを repoRoot 固定で読む(Finding のパスを安定させるため)。 */
function load(name: string) {
  return loadQuerySpecModel(path.join(FIXTURES, name), { repoRoot: REPO_ROOT });
}

/** 指摘のメッセージだけを取り出す(照合を読みやすくするため)。 */
function messages(findings: readonly { message: string }[]): string[] {
  return findings.map((finding) => finding.message);
}

describe('loadQuerySpecModel', () => {
  /** 名前で 1 本引く(fixture が複数になったのでインデックス依存を避ける)。 */
  function queryNamed(name: string) {
    return load('queries-valid').model.queries.find((query) => query.name === name);
  }

  it('正常なツリーから query_spec を読む', () => {
    const { model, findings } = load('queries-valid');

    expect(findings).toEqual([]);
    expect(model.queries).toHaveLength(2);
    expect(queryNamed('list')).toMatchObject({
      id: 'query-list',
      name: 'list',
      source: 'workshop',
      relPath: 'workshop/list.md',
      forRoles: ['member'],
      scopeUsed: { kind: 'all' },
      returns: 'many',
      paging: { kind: 'limit', max: 50 },
    });
  });

  it('for(観客)と via(可視性の供給元)を別々に読む', () => {
    const query = queryNamed('own');

    expect(query?.forRoles).toEqual(['member']);
    expect(query?.via).toMatchObject({ role: 'performer' });
    expect(query?.scopeUsed).toEqual({ kind: 'own' });
  });

  it('via を書いていない query_spec は via を持たない', () => {
    expect(queryNamed('list')?.via).toBeUndefined();
  });

  it('filters / includes / sort / projection / params を型付きで読む', () => {
    const query = queryNamed('list');

    expect(query?.filters.map((filter) => filter.source)).toEqual([
      'state != draft',
      'workshop.organizer_id == param.organizer_id',
    ]);
    expect(query?.params).toEqual([
      expect.objectContaining({
        name: 'organizer_id',
        ref: { entity: 'workshop', field: 'organizer_id', raw: 'workshop.organizer_id' },
      }),
    ]);
    expect(query?.includes).toEqual([
      expect.objectContaining({
        entity: 'entry',
        scopeUsed: { kind: 'own' },
        via: expect.objectContaining({ role: 'performer' }),
        projection: [
          expect.objectContaining({ name: 'id' }),
          expect.objectContaining({ name: 'title' }),
        ],
        sort: [expect.objectContaining({ field: 'title', direction: 'asc' })],
        limit: 20,
      }),
      expect.objectContaining({ entity: 'member', scopeUsed: { kind: 'all' } }),
    ]);
    expect(query?.sort).toEqual([
      expect.objectContaining({ field: 'starts_at', direction: 'desc' }),
    ]);
    expect(query?.projection.map((field) => field.name)).toEqual(['id', 'title', 'starts_at']);
  });

  it('README とテンプレートは仕様として読まない', () => {
    const { model } = load('queries-valid');

    expect(model.queries.map((query) => query.relPath).sort()).toEqual([
      'entry/own.md',
      'workshop/list.md',
    ]);
  });

  it('location.file をリポジトリルートからの相対パスにする', () => {
    expect(queryNamed('list')?.location.file).toBe('fixtures/queries-valid/workshop/list.md');
  });

  it('ディレクトリが無い場合は available: false の空モデルを返し、違反にはしない', () => {
    const { model, findings } = load('queries-missing');

    expect(model).toEqual({ available: false, queries: [] });
    expect(findings).toEqual([]);
  });

  it('Q0 違反を検証器 ID Q0 で積む', () => {
    const { findings } = load('queries-invalid');

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.verifier === 'Q0')).toBe(true);
    expect(findings.every((finding) => finding.suggestion.length > 0)).toBe(true);
  });

  it('id と name の不一致・scope 違い・scope_used: none・paging の値域の外を検出する', () => {
    const found = messages(load('queries-invalid').findings);

    expect(found).toContain('id が name(list)から導かれる ID と一致しません');
    expect(found).toContain('query_spec の scope は backend でなければなりません');
    expect(found).toContain('scope_used に none は書けません');
    expect(found).toContain('returns: one に paging は書けません');
  });

  it('for / projection / test_cases の欠落を検出し、モデルは作らない', () => {
    const { model, findings } = load('queries-invalid');
    const found = messages(findings);

    expect(found).toContain('for がありません');
    expect(found).toContain('projection が空です');
    expect(found).toContain('test_cases がありません');
    expect(model.queries).toEqual([]);
  });

  it('集約ディレクトリが source と食い違う仕様を検出する', () => {
    // 仕様のパスから実装（app/src/{layer}/{aggregate}/queries.ts）を導く規約は、
    // ディレクトリ名が source と一致していて初めて成り立つ。移動されたら落ちること。
    const { findings } = load('queries-misplaced');

    expect(messages(findings)).toEqual(['ディレクトリ entry が source(workshop)と一致しません']);
    expect(findings.every((finding) => finding.verifier === 'Q0')).toBe(true);
  });

  it('params の名前と ref の形式違反を検出する', () => {
    const found = messages(load('queries-invalid').findings);

    expect(found).toContain('params の Bad-Name が snake_case ではありません');
    expect(found).toContain('params の ref "workshop_id" が "{entity}.{field}" の形式ではありません');
  });

  it('sort / limit を書かない併読は sort が空で limit を持たない', () => {
    const include = queryNamed('list')?.includes[1];

    expect(include?.entity).toBe('member');
    expect(include?.sort).toEqual([]);
    expect(include?.limit).toBeUndefined();
  });

  it('includes の limit が 1 未満なら検出する', () => {
    expect(messages(load('queries-invalid').findings)).toContain(
      'includes の limit 0 は 1 以上の整数で書きます',
    );
  });

  it('via がロール ID の形式でなければ検出する', () => {
    expect(messages(load('queries-invalid').findings)).toContain(
      'via Performer! がロール ID の形式ではありません',
    );
  });
});
