import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { TEST_VERIFY_INPUTS } from '../../helpers/platform.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import type { UsecaseInput } from '../../../lib/usecase/derive.js';

/**
 * **Y 群へ渡す入力に、3 つのカタログ(テーブル仕様・通知・ジョブ)が載っている**ことを守る
 * (束 外部レビュー C-③-A。C-④ レビューの指摘)。
 *
 * `OperationCatalogs` は全欄が省略できる型なので、パイプラインの配線が `catalogs: {}` に
 * 退化しても**型を通る** —— そのとき操作の確認要否(⑦)や連鎖の事実は「カタログが無い」入力で
 * 計算され、Y5 の予算判定が黙って別の値になる(画面の生成・ハンドブックは正しいカタログを
 * 読んでいるので、検証だけが食い違う)。型が守らないので、入力の実物を見て守る。
 *
 * **見るのは「3 欄が在る」ではなく「実際の仕様から読んだ件数が 0 でない」まで**である。`toBeDefined()` だけでは、
 * カタログを読み損ねて**空のモデル**(表 0 件・通知 0 件・ジョブ 0 件)になる退化が通る —— 空の入力でも
 * 型は通り、Y5 は「連鎖なし・確認不要」と黙って判定する。だからテーブル・通知・ジョブをそろって持つ題材
 * (`fixtures/samples/archive`)を一時ツリーに写して通し、件数で見る。
 */

/** Y 群の入口に渡された入力(呼ばれるたびに積む)。 */
const received: UsecaseInput[] = [];

vi.mock('../../../lib/verify/usecase-group.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/verify/usecase-group.js')>();
  return {
    ...original,
    runUsecases: (...args: Parameters<typeof original.runUsecases>): ReturnType<typeof original.runUsecases> => {
      received.push(args[0]);
      return original.runUsecases(...args);
    },
  };
});

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

describe('検査パイプラインは Y 群へ 3 つのカタログを渡す', () => {
  let repo: string;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'pipeline-catalogs-'));
    cpSync(join(FIXTURES, 'samples', 'archive'), repo, { recursive: true });
    await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: join(repo, 'docs', 'specs', 'domain') });
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('Y 群の入口が 1 回呼ばれ、catalogs の 3 欄がどれも実際の仕様から読んだ中身(件数 > 0)を持つ', () => {
    expect(received).toHaveLength(1);
    const catalogs = received[0]?.catalogs ?? {};
    expect(Object.keys(catalogs).sort()).toEqual(['dataTables', 'jobs', 'notifications']);
    expect(catalogs.dataTables?.tables.length ?? 0).toBeGreaterThan(0);
    expect(catalogs.notifications?.catalog?.notifications.length ?? 0).toBeGreaterThan(0);
    expect(catalogs.jobs?.catalog?.jobs.length ?? 0).toBeGreaterThan(0);
  });
});
