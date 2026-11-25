/**
 * code-send-limits(送信の上限の migration と期待の表)のユニットテスト。正: ARCH-SP-BE-0001 §送信の上限。
 *
 * 期待の表は製品の拒否の語の閉じた表と、実 DB の見張り(send-limit-parity)の入力である。宣言が過不足なく写ること・
 * migration が宣言の書き出し先に出ること・本文の md5 が data-table-expectations に載ること(本文を壊すと突合が赤)を固定する。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sendLimitsGenerator } from '../../../../lib/generate/render/code-send-limits.js';
import { dataTableExpectationsGenerator } from '../../../../lib/generate/render/code-data-table-expectations.js';
import { sendLimitBody } from '../../../../lib/sql/send-limit.js';
import type { DataFunctionDecl, SendLimitDecl } from '../../../../lib/model/data/types.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_PLATFORM, TEST_LAYOUT } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

const DECL: SendLimitDecl = {
  event: 'thing.update',
  types: ['notify_a'],
  keys: [{ name: 'parent_id', blocked: { table: 'parents', column: 'state', values: ['draft'], word: 'from_draft' } }, { name: 'actor_id' }],
  payload: ['text'],
  limits: [{ word: 'actor_daily', key: 'actor_id', max: 10, per: '24 hours' }],
};

const FN: DataFunctionDecl = {
  name: 'send_limit_thing',
  args: ['text', 'uuid', 'uuid', 'text'],
  params: ['p_type', 'p_parent_id', 'p_actor_id', 'p_text'],
  kind: 'send_limit',
  migration: '20261105100038_send_limit_thing.sql',
  alsoWrites: [],
  sendLimit: DECL,
};

/** 生成の文脈。 */
function contextOf(model: ReturnType<typeof dataTableModel>) {
  return { roots: TEST_ROOTS, platform: TEST_PLATFORM, layout: TEST_LAYOUT, gates: NO_GATES, guards: stubGuards(), dataTables: model };
}

describe('code-send-limits', () => {
  it('宣言の書き出し先に migration を、期待の表に語・鍵・掴む順を出す', () => {
    const sections = sendLimitsGenerator.generate(specModel([]), contextOf(dataTableModel([dataTable('jobs', { internal: true, functions: [FN] })])));
    expect(sections.map((section) => section.file)).toEqual([
      expect.stringContaining('20261105100038_send_limit_thing.sql'),
      expect.stringContaining('send-limit-expectations.ts'),
    ]);
    const table = sections[1]?.content ?? '';
    expect(table).toContain("readonly send_limit_thing: 'from_draft' | 'actor_daily';");
    expect(table).toContain('export const sendLimitExpectations: Readonly<Record<keyof SendLimitWords, SendLimitExpectation>> =');
    expect(table).toContain('deepFreeze(');
    expect(table).toContain("locks: ['send_limit_thing:actor_id=', 'send_limit_thing:parent_id=']");
    expect(table).toContain("params: ['p_type', 'p_parent_id', 'p_actor_id', 'p_text']");
    expect(table).toMatch(/word: 'from_draft',\s+timed: false/);
    expect(table).toMatch(/word: 'actor_daily',\s+timed: true/);
    expect(table).toMatch(/name: 'actor_id',\s+blocked: null,\s+unit: null/);
  });

  it('送信の上限が無い製品は空の表(型は never の鍵を持たない)', () => {
    const sections = sendLimitsGenerator.generate(specModel([]), contextOf(dataTableModel([dataTable('jobs', { internal: true })])));
    expect(sections).toHaveLength(1);
    expect(sections[0]?.content).toContain('export interface SendLimitWords {\n}');
    expect(sections[0]?.content).toContain('deepFreeze({})');
  });

  it('data_table が無ければ何も出さない', () => {
    expect(sendLimitsGenerator.generate(specModel([]), contextOf(dataTableModel([], false)))).toEqual([]);
  });

  it('本文の md5 が data-table-expectations の関数の期待に載る(本文を壊すと data-table-parity が赤)', () => {
    const sections = dataTableExpectationsGenerator.generate(specModel([]), contextOf(dataTableModel([dataTable('jobs', { internal: true, functions: [FN] })])));
    const content = sections[0]?.content ?? '';
    const md5 = createHash('md5').update(sendLimitBody('send_limit_thing', DECL)).digest('hex');
    expect(content).toContain(`bodyMd5: '${md5}'`);
    expect(content).toMatch(/name: 'send_limit_thing',[\s\S]*?kind: 'send_limit',\s+securityDefiner: true/);
  });
});
