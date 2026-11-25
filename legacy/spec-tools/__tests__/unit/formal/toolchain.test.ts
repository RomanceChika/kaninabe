/**
 * 道具(Java 21 / tla2tools.jar)の解決のテスト。
 *
 * 見るべきは「**道具が無いときに黙って緑にしない**」である。見つからなかったことは
 * 型で返り、CLI がそれを error として報告する。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_JAR, describeMissing, resolveToolchain } from '../../../lib/formal/toolchain.js';

const HOME = '/home/u';

/** 与えたパスだけが実在する世界を作る。 */
function world(...present: string[]): (path: string) => boolean {
  const set = new Set(present);
  return (path) => set.has(path);
}

describe('resolveToolchain', () => {
  it('jar が見つからなければ「見つからなかった」を返す(探した場所つき)', () => {
    const resolved = resolveToolchain({ env: {}, home: HOME, exists: world() });
    expect('what' in resolved && resolved.what).toBe('jar');
    expect('looked' in resolved && resolved.looked).toContain(`${HOME}/.tla/tla2tools.jar`);
  });

  it('~ を展開して既定の置き場を探す', () => {
    const resolved = resolveToolchain({
      env: {},
      home: HOME,
      exists: world(`${HOME}/.tla/tla2tools.jar`),
    });
    expect('jar' in resolved && resolved.jar).toBe(`${HOME}/.tla/tla2tools.jar`);
  });

  it('TLA_TOOLS_JAR が既定の置き場より先に効く', () => {
    const resolved = resolveToolchain({
      env: { TLA_TOOLS_JAR: '/opt/tla/tools.jar' },
      home: HOME,
      exists: world('/opt/tla/tools.jar', `${HOME}/.tla/tla2tools.jar`),
    });
    expect('jar' in resolved && resolved.jar).toBe('/opt/tla/tools.jar');
  });

  it('JAVA_HOME があればその java を使う', () => {
    const resolved = resolveToolchain({
      env: { JAVA_HOME: '/jdk21' },
      home: HOME,
      exists: world('/jdk21/bin/java', `${HOME}/.tla/tla2tools.jar`),
    });
    expect('java' in resolved && resolved.java).toBe('/jdk21/bin/java');
  });

  it('候補が全滅したら PATH の java に委ねる(jar さえあれば走れる余地を残す)', () => {
    const resolved = resolveToolchain({
      env: {},
      home: HOME,
      exists: world(`${HOME}/.tla/tla2tools.jar`),
    });
    expect('java' in resolved && resolved.java).toBe('java');
  });
});

describe('describeMissing', () => {
  it('jar が無いことと、入れ方と、緑にしない理由を報告する', () => {
    const lines = describeMissing({ what: 'jar', looked: ['/x/y.jar'] });
    expect(lines[0]).toContain('見つからない');
    expect(lines.join('\n')).toContain(DEFAULT_JAR);
    expect(lines.join('\n')).toContain('緑にはしません');
  });

  it('java が無いことも報告する', () => {
    expect(describeMissing({ what: 'java', looked: ['/x/java'] })[0]).toContain('Java 21');
  });
});
