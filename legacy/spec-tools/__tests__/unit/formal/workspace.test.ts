/**
 * 診断の嘘を作らない 2 つのテスト。
 *
 * 1. **道具の故障を「モデルの問題」と言わない。** jar が壊れているときに 4 本すべてが
 *    「PlusCal の括弧を確かめろ」と出ると、直す先が読めない(独立レビューの実測)。
 * 2. **`.cfg` に性質の行が混ざったら、その `.cfg` を名指す。** 混ざったまま回すと、
 *    1 本の実行が 2 つの性質を見ることになり、破れた性質の名前が入れ替わる ——
 *    そのとき犯人扱いされるのは無関係な性質である。
 */

import { describe, expect, it } from 'vitest';
import {
  cfgPropertyLineFindings,
  looksLikeToolFailure,
  toolFailureFinding,
} from '../../../lib/formal/workspace.js';

describe('looksLikeToolFailure', () => {
  it('JVM がクラスを読めなかった言い分を道具の故障と見る', () => {
    expect(looksLikeToolFailure(['Error: Could not find or load main class pcal.trans'])).toBe(true);
    expect(looksLikeToolFailure(['Error: Invalid or corrupt jarfile /home/u/.tla/tla2tools.jar'])).toBe(true);
    expect(looksLikeToolFailure(['Error: Unable to access jarfile x.jar'])).toBe(true);
  });

  it('言語に依らない目印でも見分ける(JVM の文面は OS の言語で変わる)', () => {
    // 実測: 日本語環境では「メイン・クラスpcal.transを検出およびロードできませんでした」と出て、
    // 英語の目印だけでは外れた。例外クラス名は翻訳されない。
    expect(looksLikeToolFailure(['原因: java.lang.ClassNotFoundException: pcal.trans'])).toBe(true);
    expect(looksLikeToolFailure(['java.lang.NoClassDefFoundError: tlc2/TLC'])).toBe(true);
  });

  it('PlusCal の文法エラーは道具の故障ではない(モデルを直す話である)', () => {
    expect(looksLikeToolFailure(['Unrecoverable error:', ' -- Missing label at the following location:'])).toBe(false);
  });

  it('TLC が正しく走った出力も道具の故障ではない', () => {
    expect(looksLikeToolFailure(['Model checking completed. No error has been found.'])).toBe(false);
  });
});

describe('toolFailureFinding', () => {
  it('道具の故障として報告し、jar を場所に出し、stderr をそのまま見せる', () => {
    const finding = toolFailureFinding('pcal.trans', '/home/u/.tla/tla2tools.jar', [
      '',
      'Error: Invalid or corrupt jarfile',
      '',
    ]);
    expect(finding.message).toContain('道具の故障');
    expect(finding.message).not.toContain('括弧');
    expect(finding.location).toBe('/home/u/.tla/tla2tools.jar');
    expect(finding.detail).toEqual(['Error: Invalid or corrupt jarfile']);
  });
});

describe('cfgPropertyLineFindings', () => {
  it('性質の行が無ければ何も言わない', () => {
    expect(cfgPropertyLineFindings('Outbox.cfg', 'SPECIFICATION Spec\nCONSTANTS\n    N = 1\n')).toEqual([]);
  });

  it('INVARIANT の行が混ざっていたら、その cfg と行を名指す(性質を犯人扱いしない)', () => {
    const findings = cfgPropertyLineFindings('Outbox.cfg', 'SPECIFICATION Spec\nINVARIANT S1\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('Outbox.cfg');
    expect(findings[0]?.message).toContain('INVARIANT S1');
    expect(findings[0]?.location).toBe('formal/Outbox.cfg:2');
  });

  it('PROPERTY / INVARIANTS / PROPERTIES も同じく拾う', () => {
    for (const line of ['PROPERTY L1', 'INVARIANTS S1 S2', 'PROPERTIES L1']) {
      expect(cfgPropertyLineFindings('X.cfg', `SPECIFICATION Spec\n${line}\n`)).toHaveLength(1);
    }
  });

  it('コメントの中の INVARIANT は拾わない(書き方の案内は cfg に残せる)', () => {
    const text = 'SPECIFICATION Spec\n\\* 手で回すときは INVARIANT S1 を足す\n';
    expect(cfgPropertyLineFindings('X.cfg', text)).toEqual([]);
  });
});
