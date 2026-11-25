import { describe, expect, it } from 'vitest';
import { CORE_GENERATORS } from '../../../lib/compose/all-generators.js';
import { testGenerators } from '../../helpers/generators.js';
import { cronRouteTestsGenerator } from '../../../lib/targets/vercel/generate/code-cron-route-tests.js';
import { browserDefenseGenerator } from '../../../lib/targets/nextjs/generate/code-browser-defense.js';
import { browserDefenseTestsGenerator } from '../../../lib/targets/nextjs/generate/code-browser-defense-tests.js';
import { paidEntryTestsGenerator } from '../../../lib/targets/nextjs/generate/code-paid-entry-tests.js';
import { barePlatformTarget } from '../../helpers/platform.js';

/**
 * 全部入りの生成器の一覧は「コアの生成器 + 選んだ後段が登録した生成器」。コアは後段の生成器を知らず、後段を選ばない構成では
 * その出力(ホストの Cron 起動口の見張りテスト)は出ない。全部入りの並びと出力は、コアにあったときと変わらない
 * (`generate:check` がバイト同一を見る。ここは並びと合成の形を固定する)。
 */

describe('allGenerators', () => {
  it('全部入り: コアの生成器のあとに、後段が登録した生成器が後段の並びで続く(ホストの Cron 起動口の見張りテスト → アプリの枠のブラウザ側の守り)', () => {
    const all = testGenerators();
    expect(all.slice(0, CORE_GENERATORS.length)).toEqual([...CORE_GENERATORS]);
    expect(all.slice(CORE_GENERATORS.length)).toEqual([cronRouteTestsGenerator, browserDefenseGenerator, browserDefenseTestsGenerator, paidEntryTestsGenerator]);
  });

  it('後段が生成器を登録しない構成では、コアの生成器だけ(後段の生成器の出力は出ない)', () => {
    const bare = testGenerators([barePlatformTarget()]);
    expect(bare).toEqual([...CORE_GENERATORS]);
    expect(bare.map((generator) => generator.id)).not.toContain('code-cron-route-tests');
  });

  it('コアの一覧は後段の生成器を含まず、生成器の ID は全体で重ならない', () => {
    expect(CORE_GENERATORS.map((generator) => generator.id)).not.toContain('code-cron-route-tests');
    const ids = testGenerators().map((generator) => generator.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
