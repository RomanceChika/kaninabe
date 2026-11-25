/**
 * T2 の「余分な索引」の警告の理由の区分(`lib/data/index-reasons.ts`)のユニットテスト。
 *
 * 見るのは、**仕組みが所有する表で、製品がその表を持ち場とする関数を 1 つも宣言していない**ときだけ
 * 「仕組みの側」になり、関数を宣言していれば(製品が `lookup` を書ける)仕組みの表でも製品が直せる側になること。
 * 監査の変異 M14a(仕組みの表の関数から `lookup` を消す)が未分類に落ちる根拠である。
 */

import { describe, expect, it } from 'vitest';
import { T2_REASONS, unrequestedIndexReason } from '../../../lib/data/index-reasons.js';
import { verifyIndexExpectations } from '../../../lib/data/verifiers/t2-index-expectations.js';
import { indexRequirementsOfModels } from '../../../lib/relations/index-requirements/index.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { specModel } from '../../helpers/model-builder.js';
import { QUERY_CTX } from '../../helpers/query-builder.js';
import type { DataFunctionDecl } from '../../../lib/model/data/types.js';

/** 関数 1 つ(lookup は持たない)。 */
const FUNCTION: DataFunctionDecl = { name: 'claim_due_jobs', args: [], params: [], kind: 'rpc', alsoWrites: [] };

describe('unrequestedIndexReason', () => {
  it('仕組みの表で関数の宣言が 1 つも無ければ、仕組みの側', () => {
    expect(unrequestedIndexReason(dataTable('jobs', { framework: 'jobs' }))).toBe(T2_REASONS.frameworkTableFunctionless);
  });

  it('仕組みの表でも、製品が関数を宣言していれば製品が直せる側(lookup を書ける)', () => {
    expect(unrequestedIndexReason(dataTable('jobs', { framework: 'jobs', functions: [FUNCTION] }))).toBe(T2_REASONS.unrequested);
  });

  it('仕組みの表でなければ、関数の有無によらず製品が直せる側', () => {
    expect(unrequestedIndexReason(dataTable('workshops'))).toBe(T2_REASONS.unrequested);
    expect(unrequestedIndexReason(dataTable('workshops', { functions: [FUNCTION] }))).toBe(T2_REASONS.unrequested);
  });
});

describe('T2: 余分な索引の警告は理由を載せる', () => {
  const GUARDS = QUERY_CTX.guards;
  const INDEX = { name: 'jobs_due_idx', on: ['status', 'next_run_at'], unique: false };

  /** 仕組みの表 1 枚を検査して、余分な索引の警告を返す。 */
  function warnings(functions: readonly DataFunctionDecl[]) {
    const model = dataTableModel([dataTable('jobs', { framework: 'jobs', internal: true, indexes: [INDEX], functions })]);
    return verifyIndexExpectations(indexRequirementsOfModels(specModel([]), GUARDS, { queries: { available: true, queries: [] }, dataTables: model }), model);
  }

  it('関数が無い仕組みの表の索引は frameworkTableFunctionless', () => {
    expect(warnings([]).map((finding) => finding.reason)).toEqual([T2_REASONS.frameworkTableFunctionless]);
  });

  it('関数を宣言している仕組みの表の索引(lookup が書かれていない)は unrequested = 製品が直せる', () => {
    expect(warnings([FUNCTION]).map((finding) => finding.reason)).toEqual([T2_REASONS.unrequested]);
  });
});
