/**
 * UX 原則の台帳を読む I/O 境界のテスト(ファイルが無い・壊れている・読める)。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadUxPrinciplesModel } from '../../../../lib/model/ux-principles/loader.js';

const created: string[] = [];

/** 一時ディレクトリに台帳を書き、その絶対パスを返す。 */
function put(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ux-principles-'));
  created.push(dir);
  const file = path.join(dir, 'ux-principles.md');
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadUxPrinciplesModel', () => {
  it('ファイルが無ければ available: false(検査器の既定値で動く)', () => {
    const result = loadUxPrinciplesModel(path.join(tmpdir(), 'no-such-dir', 'ux-principles.md'), { repoRoot: tmpdir() });

    expect(result).toEqual({ model: { available: false, spec: null }, findings: [], dropped: 0 });
  });

  it('読める台帳をモデルにする', () => {
    const file = put(
      [
        '---',
        'doc_type: ux_principles_spec',
        'scope: frontend',
        'id: ux-principles',
        'principles:',
        '  - id: U3',
        '    statement: 行き止まりを作らない',
        '    enforced_by: U3',
        '---',
        '',
        '# 本文',
      ].join('\n'),
    );
    const result = loadUxPrinciplesModel(file, { repoRoot: path.dirname(file) });

    expect(result.findings).toEqual([]);
    expect(result.model.available).toBe(true);
    expect(result.model.spec?.principles.map((p) => p.id)).toEqual(['U3']);
  });

  it('スキーマ違反は U8 として積む', () => {
    const file = put(['---', 'doc_type: ux_principles_spec', 'scope: frontend', 'id: ux-principles', '---'].join('\n'));
    const result = loadUxPrinciplesModel(file, { repoRoot: path.dirname(file) });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.verifier === 'U8' && f.severity === 'error')).toBe(true);
  });

  it('フロントマターが読めなければ spec は null で U8 を積む', () => {
    const file = put('フロントマターが無い');
    const result = loadUxPrinciplesModel(file, { repoRoot: path.dirname(file) });

    expect(result.model).toEqual({ available: true, spec: null });
    expect(result.findings.every((f) => f.verifier === 'U8')).toBe(true);
  });
});
