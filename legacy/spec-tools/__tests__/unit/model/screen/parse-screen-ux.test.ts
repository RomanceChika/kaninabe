/**
 * screen_spec の `ux:`(UX 原則の受け入れ)のパースのテスト(S0)。
 *
 * 受け入れの形: principle(必須)・subject(任意。省略は画面そのもの)・reason(必須。空は不可)。
 * 画面が方針を再定義する口にしないため、知らないキー(事実の欄)は書けない。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { YamlReader } from '../../../../lib/model/yaml-reader.js';
import { parseUx } from '../../../../lib/model/screen/parse-screen-ux.js';

/** ux を含むフロントマターを読んで (受け入れ, 違反) を返す。 */
function parse(ux: unknown) {
  const reporter = new SpecReporter('docs/specs/frontend/screens/x/s.md');
  const accepts = parseUx(new YamlReader(ux === undefined ? {} : { ux }, '', reporter), reporter);
  return { accepts, findings: reporter.findings() };
}

describe('S0: ux(UX 原則の受け入れ)', () => {
  it('書かなければ空', () => {
    expect(parse(undefined)).toEqual({ accepts: [], findings: [] });
  });

  it('principle / subject / reason を読む(subject の省略は空文字)', () => {
    const { accepts, findings } = parse([
      { principle: 'U4', subject: 'workshop.draft', reason: '別々の作業台' },
      { principle: 'U3', reason: '完了画面' },
    ]);

    expect(findings).toEqual([]);
    expect(accepts).toEqual([
      expect.objectContaining({ principle: 'U4', subject: 'workshop.draft', reason: '別々の作業台' }),
      expect.objectContaining({ principle: 'U3', subject: '', reason: '完了画面' }),
    ]);
    expect(accepts[0]?.location.pointer).toBe('ux[0]');
  });

  it('reason が無い・空の受け入れは受理しない', () => {
    const missing = parse([{ principle: 'U4', subject: 'x' }]);
    expect(missing.accepts).toEqual([]);
    expect(missing.findings.some((f) => f.message.includes('reason がありません'))).toBe(true);

    const blank = parse([{ principle: 'U4', reason: '  ' }]);
    expect(blank.accepts).toEqual([]);
    expect(blank.findings.some((f) => f.message.includes('reason が空です'))).toBe(true);
  });

  it('principle が無ければ受理しない', () => {
    const { accepts, findings } = parse([{ reason: 'なぜか' }]);

    expect(accepts).toEqual([]);
    expect(findings.some((f) => f.message.includes('principle がありません'))).toBe(true);
  });

  it('事実の欄(知らないキー)は書けない', () => {
    const { findings } = parse([{ principle: 'U1', reason: 'r', confirm: 'none' }]);

    expect(findings.some((f) => f.message.includes('confirm は書けません'))).toBe(true);
  });

  it('リストでない・要素がマッピングでないときは違反', () => {
    expect(parse('U4').findings.length).toBeGreaterThan(0);
    expect(parse(['U4']).findings.some((f) => f.message.includes('マッピングで書きます'))).toBe(true);
  });
});
