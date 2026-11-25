/**
 * 前提の読み取り元(`premiseFiles` / `premiseCheck`)の居場所は、置き場の配置(`http-entry`)から引く。
 *
 * 起動口(1 回の起動の予算の持ち主 `/api/jobs/run`)の位置は具体のスタックの綴りなので、配置が与える。配置を差し替えるとその位置を読み、
 * 配置が決まらなければ(アプリの枠の後段が無い・実装の木が無い)居場所は空文字で、検査は「読む相手がいない」と言って確かめない(黙って緑にしない)。
 */

import { describe, expect, it } from 'vitest';
import { premiseCheck, premiseFiles } from '../../../lib/formal/premise.js';
import { generatedPath } from '../../../lib/model/product/paths.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../helpers/platform.js';

describe('premiseFiles', () => {
  it('予算の持ち主は配置の http-entry の位置(Next.js なら app/src/app/api/jobs/run/route.ts)', () => {
    expect(premiseFiles(TEST_ROOTS, TEST_LAYOUT, []).budget).toBe('app/src/app/api/jobs/run/route.ts');
  });

  it('配置を差し替えると、その配置の位置を読む(Next.js の位置ではない)', () => {
    expect(premiseFiles(TEST_ROOTS, FOREIGN_LAYOUT, []).budget).toBe('app/server_code/endpoints/api/jobs/run.handler.ts');
  });

  it('配置が決まらなければ(空の配置・実装の木が無い)空文字ではなく null(黙った空のパスを返さない)。ほかの 2 つの居場所は配置に依らない', () => {
    expect(premiseFiles(TEST_ROOTS, {}, []).budget).toBeNull();
    expect(premiseFiles({ ...TEST_ROOTS, app: null }, TEST_LAYOUT, []).budget).toBeNull();
    // リースの既定の居場所も、関数を定義する migration が無ければ null(空のパスにしない)。
    expect(premiseFiles(TEST_ROOTS, TEST_LAYOUT, []).lease).toBeNull();
    expect(premiseFiles(TEST_ROOTS, {}, []).timeout).toBe(generatedPath(TEST_ROOTS, 'external-expectations.ts'));
  });
});

describe('premiseCheck', () => {
  it('居場所が決まらない前提は読みに行かず、「確かめていません」と名指す(空のパスで読まない)', () => {
    const reads: string[] = [];
    const outcome = premiseCheck('/repo', (file) => (reads.push(file), null), TEST_ROOTS, {}, []);

    expect(outcome.findings).toEqual([]);
    expect(outcome.notes).toHaveLength(1);
    expect(outcome.notes[0]).toContain('読む相手がいないので確かめていません');
    expect(reads).not.toContain('');
    // 決められなかった居場所は黙って落とさず名指す(予算の起動口は配置が決められない・リースは関数を定義する migration が無い)。
    expect(outcome.notes[0]).toContain('budget(居場所を決められない: 置き場の配置が起動口 http-entry を決められない・実装の木が無い)');
    expect(outcome.notes[0]).toContain('lease(居場所を決められない: 関数を定義する migration が無い)');
    expect(outcome.notes[0]).toContain(generatedPath(TEST_ROOTS, 'external-expectations.ts'));
  });
});
