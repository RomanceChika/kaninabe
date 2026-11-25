/**
 * 実体の欄の `pattern` に `$$` を入れた題材が、生成される migration に何も持ち込まないことを見る(独立レビューが実測した迂回:
 * `pattern` の `$$` が `do $$` の本文を閉じた)。表の `where` / `rule` / `defaults` / `references` の迂回は `data-table-hostile.test.ts`。
 *
 * 読み込みが文法(`lib/model/sql-fragment.ts`)で落とし、T0 / V1 の error にする。error があれば `generate` は止まる
 * (`generationBlockers`。T0 / V1 は実装との突合ではない)。落とした値は生成物に出ない。
 */

import { describe, expect, it } from 'vitest';
import { generationBlockers } from '../../lib/verify/pre-generate.js';
import { SLOW } from '../helpers/book-entry-fixture.js';
import { runSampleSystem } from './harness.js';
import { sqlSkeleton } from '../helpers/output-skeleton.js';

const ENTITY = ['docs', 'specs', 'domain', 'room', 'entity.md'].join('/');

const DOLLAR_PATTERN = '^x$$ ; create table pwned(a int); do $$ begin null; end $$ ; --';

/** 実体の欄に敵対的な pattern を足す。 */
const hostileEntity = (text: string): string => text.replace('    max_length: 60\n    label: 部屋名', () => `    max_length: 60\n    pattern: ${JSON.stringify(DOLLAR_PATTERN)}\n    label: 部屋名`);

describe('生の SQL 断片に敵対的な値を入れた題材', () => {
  it(
    '落ちる(error)・生成が止まる・migration に持ち込まれない',
    async () => {
      const clean = await runSampleSystem('rooms');
      const hostile = await runSampleSystem('rooms', { rewrite: { [ENTITY]: hostileEntity } });

      const messages = hostile.errors.map((finding) => `${finding.verifier}: ${finding.message}`).join('\n');
      expect(messages).toContain('pattern が書ける形ではありません');
      expect(generationBlockers(hostile.findings).length).toBeGreaterThanOrEqual(1);

      const sql = [...hostile.generatedFiles].filter(([file]) => file.endsWith('.sql'));
      expect(sql.length).toBeGreaterThan(5);
      for (const [file, text] of sql) {
        expect(text, file).not.toMatch(/drop table|create table pwned|rooms_evil/i);
        const cleanText = clean.generatedFiles.get(file);
        if (cleanText !== undefined) expect(sqlSkeleton(text), file).toEqual(sqlSkeleton(cleanText));
      }
    },
    SLOW,
  );
});
