/**
 * 読み取りクエリ一覧(queries/README.md の query-list ブロック)の生成器のテスト。
 *
 * 対象の要求: 「query_spec の一覧表を生成する。1 件も無くても壊れない」。
 */

import { describe, expect, it } from 'vitest';
import { queryListGenerator } from '../../../../lib/generate/render/query-list.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { createGuardServices } from '../../../../lib/guard/services.js';
import { specModel } from '../../../helpers/model-builder.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

/** query_spec を載せた GenerateContext を作る。 */
function ctxWith(queries: readonly ReturnType<typeof querySpec>[]): GenerateContext {
  return { guards: createGuardServices(), roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, queries: { available: true, queries } };
}

describe('読み取りクエリ一覧の生成', () => {
  it('queries/README.md の query-list マーカーに差し込む', () => {
    const [section] = queryListGenerator.generate(specModel([]), ctxWith([]));

    expect(section?.file).toBe('docs/specs/backend/queries/README.md');
    expect(section?.marker).toBe('query-list');
  });

  it('置き場はあるが 0 件なら「まだ無い」と書く', () => {
    const [section] = queryListGenerator.generate(specModel([]), ctxWith([]));

    expect(section?.content).toContain('まだ query_spec はありません');
  });

  it('そもそも読み込めていない場合は 0 件と区別して書く', () => {
    const [section] = queryListGenerator.generate(specModel([]), GEN_CTX);

    expect(section?.content).toContain('読み込めなかった');
  });

  it('クエリ・source・実行ロール・スコープ・返し方を 1 行に並べる', () => {
    const ctx = ctxWith([
      querySpec({
        name: 'workshop_list',
        source: 'workshop',
        for: ['member', 'organizer'],
        scopeUsed: 'all',
        paging: { kind: 'limit', max: 50 },
      }),
    ]);

    const [section] = queryListGenerator.generate(specModel([]), ctx);

    expect(section?.content).toContain(
      '| workshop_list | workshop | member, organizer | — | all | many / limit(50) | `workshop/workshop_list.md` |',
    );
  });

  it('1 件返すクエリは paging を持たないので returns だけを書く', () => {
    const ctx = ctxWith([
      querySpec({
        name: 'workshop_detail',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        returns: 'one',
      }),
    ]);

    const [section] = queryListGenerator.generate(specModel([]), ctx);

    expect(section?.content).toContain('| workshop_detail | workshop | member | — | all | one |');
  });

  it('via を書いたクエリは可視性の供給元を列に出す', () => {
    const ctx = ctxWith([
      querySpec({
        name: 'entry_own_list',
        source: 'entry',
        for: ['member'],
        via: 'performer',
        scopeUsed: 'own',
        paging: { kind: 'none' },
      }),
    ]);

    const [section] = queryListGenerator.generate(specModel([]), ctx);

    expect(section?.content).toContain('| entry_own_list | entry | member | performer | own |');
  });

  it('併読の via も供給元の列に出す(1 本の中で供給元が分かれることが見えるように)', () => {
    const ctx = ctxWith([
      querySpec({
        name: 'workshop_detail',
        source: 'workshop',
        for: ['member'],
        scopeUsed: 'all',
        returns: 'one',
        includes: [
          { entity: 'member', scopeUsed: 'all' },
          { entity: 'entry', scopeUsed: 'own', via: 'performer' },
        ],
      }),
    ]);

    const [section] = queryListGenerator.generate(specModel([]), ctx);

    expect(section?.content).toContain('| workshop_detail | workshop | member | entry: performer |');
  });

  it('context スコープと cursor ページングをそのまま表記する', () => {
    const ctx = ctxWith([
      querySpec({
        name: 'entry_list',
        source: 'entry',
        for: ['organizer'],
        scopeUsed: 'context(workshop)',
        paging: { kind: 'cursor' },
      }),
    ]);

    const [section] = queryListGenerator.generate(specModel([]), ctx);

    expect(section?.content).toContain('context(workshop)');
    expect(section?.content).toContain('cursor');
  });
});
