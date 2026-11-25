/**
 * 欄の `bearer`(持っていれば効く値の宣言)の読み取りのテスト。
 * 形(型・供給元・書式・長さ・寿命の宣言が 1 通りであること)の受理と拒否を、1 つずつ表で固定する。
 */

import { describe, expect, it } from 'vitest';
import { parseEntitySpec } from '../../../lib/model/parse-entity.js';
import { parseFrontmatter, SpecReporter } from '../../../lib/model/parse-common.js';
import { expectWellFormed, findByMessage } from './_helpers.js';

const FILE = 'invitation/entity.md';

function entityFrom(yaml: string) {
  const reporter = new SpecReporter(FILE);
  const data = parseFrontmatter(`---\n${yaml}---\n\n# 本文\n`, reporter);
  expect(reporter.findings()).toHaveLength(0);
  return parseEntitySpec(data, FILE);
}

/** 欄 1 本(`code`)の宣言を読む。`extra` は欄の下に足す行(インデント済みでなくてよい)。 */
function parseField(extra: readonly string[], type = 'string') {
  return entityFrom(
    ['doc_type: entity_spec', 'entity: invitation', 'fields:', '  - name: code', `    type: ${type}`, ...extra.map((line) => `    ${line}`), '    personal: false', ''].join('\n'),
  );
}

/** 正しい基本の宣言(供給元・長さ)。 */
const BASE = ['supplied_by: db', 'max_length: 43'];

describe('parseEntitySpec の bearer', () => {
  it('reusable(理由つき)を読む', () => {
    const result = parseField([...BASE, 'bearer:', '  reusable: 何人でも入れる窓口の設計のため']);
    expect(result.findings).toHaveLength(0);
    expect(result.value?.fields[0]?.bearer).toMatchObject({ kind: 'reusable', reason: '何人でも入れる窓口の設計のため' });
    expect(result.value?.fields[0]?.bearer?.location.pointer).toBe('fields[0].bearer');
  });

  it('expires_at と used_at の対を読む', () => {
    const result = parseField([...BASE, 'bearer:', '  expires_at: expires_at', '  used_at: used_at']);
    expect(result.findings).toHaveLength(0);
    expect(result.value?.fields[0]?.bearer).toMatchObject({ kind: 'expiring', expiresAt: 'expires_at', usedAt: 'used_at' });
  });

  it('bearer を書かない欄には bearer のキーが現れない', () => {
    expect(parseField(['max_length: 50']).value?.fields[0]).not.toHaveProperty('bearer');
  });

  it('max_length は生成する値の長さ(43)ちょうどで通る', () => {
    expect(parseField(['supplied_by: db', 'max_length: 43', 'bearer:', '  reusable: r']).findings).toHaveLength(0);
  });

  interface Rejected {
    readonly name: string;
    readonly extra: readonly string[];
    readonly message: string;
    readonly type?: string;
  }

  const rejected: readonly Rejected[] = [
    { name: 'マッピングでない', extra: [...BASE, 'bearer: yes'], message: 'bearer はマッピングで書きます' },
    { name: '知らないキー', extra: [...BASE, 'bearer:', '  reusable: r', '  ttl: 3600'], message: 'bearer に ttl は書けません' },
    { name: '寿命の宣言が無い', extra: [...BASE, 'bearer: {}'], message: 'bearer に寿命の宣言がありません' },
    { name: 'expires_at だけ', extra: [...BASE, 'bearer:', '  expires_at: expires_at'], message: 'used_at がありません' },
    { name: 'used_at だけ', extra: [...BASE, 'bearer:', '  used_at: used_at'], message: 'expires_at がありません' },
    { name: 'reusable と対の併記', extra: [...BASE, 'bearer:', '  reusable: r', '  expires_at: a', '  used_at: b'], message: 'reusable と expires_at / used_at は併記できません' },
    { name: 'reusable の理由が空', extra: [...BASE, 'bearer:', '  reusable: "  "'], message: 'reusable の理由が空です' },
    { name: 'supplied_by: db が無い', extra: ['max_length: 43', 'bearer:', '  reusable: r'], message: 'supplied_by: db を宣言します' },
    { name: 'format との併記', extra: [...BASE, 'format: url', 'bearer:', '  reusable: r'], message: 'format: url は併記できません' },
    { name: 'max_length が短い', extra: ['supplied_by: db', 'max_length: 42', 'bearer:', '  reusable: r'], message: 'max_length は 43 以上にします' },
    { name: 'max_length が無い', extra: ['supplied_by: db', 'bearer:', '  reusable: r'], message: 'max_length は 43 以上にします' },
    { name: 'string 以外', extra: [...BASE, 'bearer:', '  reusable: r'], message: 'bearer は string の欄にだけ書けます', type: 'text' },
  ];

  it.each(rejected.map((row) => [row.name, row] as const))('弾く: %s', (_name, row) => {
    const result = parseField(row.extra, row.type);
    expectWellFormed(result.findings);
    expect(findByMessage(result.findings, row.message).suggestion.length).toBeGreaterThan(0);
    expect(result.value?.fields[0]).not.toHaveProperty('bearer');
  });
});
