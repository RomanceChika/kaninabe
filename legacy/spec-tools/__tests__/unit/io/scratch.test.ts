/** 作業置き場(`scratch/`)の読み書きがシンボリックリンクを辿らない(3 回目の点検 C-4)。 */

import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readScratchText, symlinkOnPath, writeFileNoFollow, writeScratchFile } from '../../../lib/io/scratch.js';
import { writeLatest } from '../../../cli/deps-check-io.js';

let root = '';
let outside = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'scratch-root-'));
  outside = mkdtempSync(path.join(tmpdir(), 'scratch-outside-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('writeScratchFile', () => {
  it('置き場を作って書く(通常の経路)', () => {
    writeScratchFile(root, 'scratch/deps-check/latest.json', '{"a":1}');
    expect(readFileSync(path.join(root, 'scratch/deps-check/latest.json'), 'utf8')).toBe('{"a":1}');
    writeScratchFile(root, 'scratch/deps-check/latest.json', '{}');
    expect(readFileSync(path.join(root, 'scratch/deps-check/latest.json'), 'utf8')).toBe('{}');
  });

  it('置き場自体がリンクなら書かず、リンクの先に何も作らない', () => {
    symlinkSync(outside, path.join(root, 'scratch'));
    expect(() => writeScratchFile(root, 'scratch/deps-check/latest.json', 'x')).toThrow(/scratch はシンボリックリンク/);
    expect(existsSync(path.join(outside, 'deps-check'))).toBe(false);
  });

  it('途中のディレクトリがリンクなら書かない', () => {
    mkdirSync(path.join(root, 'scratch'));
    symlinkSync(outside, path.join(root, 'scratch/deps-check'));
    expect(() => writeScratchFile(root, 'scratch/deps-check/latest.json', 'x')).toThrow(/scratch\/deps-check はシンボリックリンク/);
    expect(existsSync(path.join(outside, 'latest.json'))).toBe(false);
  });

  it('最後のファイルがリンクなら書かず、先のファイルを変えない', () => {
    mkdirSync(path.join(root, 'scratch'));
    writeFileSync(path.join(outside, 'victim.txt'), 'ORIGINAL');
    symlinkSync(path.join(outside, 'victim.txt'), path.join(root, 'scratch/latest.json'));
    expect(() => writeScratchFile(root, 'scratch/latest.json', 'EVIL')).toThrow();
    expect(readFileSync(path.join(outside, 'victim.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it('検査のあとにリンクへ差し替えられても(O_NOFOLLOW)辿らない', () => {
    writeFileSync(path.join(outside, 'victim.txt'), 'ORIGINAL');
    const target = path.join(root, 'late.json');
    symlinkSync(path.join(outside, 'victim.txt'), target);
    expect(() => writeFileNoFollow(target, 'EVIL')).toThrow();
    expect(readFileSync(path.join(outside, 'victim.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it('ハードリンクを持つファイルは書かない', () => {
    mkdirSync(path.join(root, 'scratch'));
    writeFileSync(path.join(outside, 'victim.txt'), 'ORIGINAL');
    linkSync(path.join(outside, 'victim.txt'), path.join(root, 'scratch/latest.json'));
    expect(() => writeScratchFile(root, 'scratch/latest.json', 'EVIL')).toThrow(/ハードリンク/);
    expect(readFileSync(path.join(outside, 'victim.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it.each(['', '/abs/x', '../x', 'a/../../x', 'a//b'])('不正なパスは書かない: %j', (rel) => {
    expect(() => writeScratchFile(root, rel, 'x')).toThrow();
  });

  it('deps:check の書き込み口(writeLatest)も同じ関所を通る', () => {
    symlinkSync(outside, path.join(root, 'scratch'));
    expect(() => writeLatest(root, 'scratch/deps-check/latest.json', 'x')).toThrow(/シンボリックリンク/);
  });
});

describe('readScratchText / symlinkOnPath', () => {
  it('通常のファイルは読める。無ければ null', () => {
    writeScratchFile(root, 'scratch/x.json', 'hello');
    expect(readScratchText(root, 'scratch/x.json')).toBe('hello');
    expect(readScratchText(root, 'scratch/none.json')).toBeNull();
  });

  it('scratch がリンクなら、先に偽の記録があっても読まない(コミットされた偽の最終実施で警告を黙らせない)', () => {
    mkdirSync(path.join(outside, 'deps-check'));
    writeFileSync(path.join(outside, 'deps-check/latest.json'), '{"generatedAt":"2099-01-01T00:00:00Z"}');
    symlinkSync(outside, path.join(root, 'scratch'));
    expect(readScratchText(root, 'scratch/deps-check/latest.json')).toBeNull();
    expect(symlinkOnPath(root, 'scratch/deps-check/latest.json')).toBe('scratch');
  });

  it('無い要素から先は見ない(リンクなし)', () => {
    expect(symlinkOnPath(root, 'scratch/a/b')).toBeNull();
  });
});
