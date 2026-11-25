import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FRONT_MATTER_MAX_CHARS,
  FRONT_MATTER_MAX_VISITS,
  readFrontMatter,
  type FrontMatterResult,
} from '../../../lib/io/front-matter.js';

/**
 * フロントマターの安全な読み取り(`lib/io/front-matter.ts`)。
 * 仕様の束は信頼できない入力なので、評価・爆発・汚染の口を塞いでいることと、
 * 実際の仕様では以前(gray-matter)と同じ値が取れることを見る。
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** 拒まれたことを確かめ、理由の種類を返す。 */
function rejectionOf(result: FrontMatterResult): string {
  expect(result.kind).toBe('rejected');
  return result.kind === 'rejected' ? result.code : '';
}

describe('言語の指定は評価も解釈もしない', () => {
  /** 読み込まれたら印のファイルを書く JavaScript。 */
  function payload(marker: string): string {
    return `{
  const fs = require('node:fs');
  fs.writeFileSync(${JSON.stringify(marker)}, 'pwned');
  return { doc_type: 'x' };
}`;
  }

  it.each(['---js', '---javascript', '--- js', '--- javascript', '---JS', '---coffee', '--- coffee', '---yaml', '--- yaml', '---json'])(
    '%s で開く入力は拒み、JavaScript を評価しない',
    (open) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'front-matter-'));
      const marker = path.join(dir, 'pwned.txt');
      const source = `${open}\n${payload(marker)}\n---\n\n# 本文\n`;
      expect(rejectionOf(readFrontMatter(source))).toBe('language-tag');
      expect(existsSync(marker)).toBe(false);
    },
  );

  it('開きの行の後ろが空白だけなら普通の開き', () => {
    expect(readFrontMatter('---  \ndoc_type: x\n---\n')).toEqual({ kind: 'ok', data: { doc_type: 'x' }, closed: true });
  });

  it('YAML のタグで関数を作る形(!!js/function)も読めない', () => {
    const result = readFrontMatter('---\nx: !!js/function "function () { return 1 }"\n---\n');
    expect(rejectionOf(result)).toBe('yaml-error');
  });

  it('マージキー(<<)は展開しない(コア・スキーマにマージが無く、文字列のキーのまま)', () => {
    const result = readFrontMatter('---\nbase: &b\n  a: 1\nchild:\n  <<: *b\n  c: 2\n---\n');
    expect(result).toEqual({ kind: 'ok', data: { base: { a: 1 }, child: { '<<': { a: 1 }, c: 2 } }, closed: true });
  });
});

describe('別名の爆発・大きさ・禁じるキー', () => {
  it('別名を入れ子にして爆発させる入力(billion laughs)は、すぐ拒む', () => {
    const levels = 12;
    const lines = ['a0: &a0 [x, x, x, x, x, x, x, x, x, x]'];
    for (let i = 1; i < levels; i += 1) {
      const refs = Array.from({ length: 10 }, () => `*a${i - 1}`).join(', ');
      lines.push(`a${i}: &a${i} [${refs}]`);
    }
    const started = Date.now();
    const result = readFrontMatter(`---\n${lines.join('\n')}\n---\n`);
    expect(rejectionOf(result)).toBe('alias-expansion');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('別名の予算の内なら読める(同じ値を数回使う程度)', () => {
    const result = readFrontMatter('---\na: &a [1, 2]\nb: *a\nc: *a\n---\n');
    expect(result).toEqual({ kind: 'ok', data: { a: [1, 2], b: [1, 2], c: [1, 2] }, closed: true });
    expect(FRONT_MATTER_MAX_VISITS).toBeGreaterThan(100_000);
  });

  it('大きすぎるフロントマターは解析せずに拒む', () => {
    const big = `doc_type: x\nnote: ${'a'.repeat(FRONT_MATTER_MAX_CHARS)}`;
    expect(rejectionOf(readFrontMatter(`---\n${big}\n---\n`))).toBe('too-large');
  });

  it.each(['__proto__', 'constructor', 'prototype'])('キー %s は、どの深さでも拒む', (key) => {
    expect(rejectionOf(readFrontMatter(`---\n${key}: 1\n---\n`))).toBe('forbidden-key');
    expect(rejectionOf(readFrontMatter(`---\nfields:\n  - name: a\n    nested:\n      ${key}: 1\n---\n`))).toBe('forbidden-key');
    expect(rejectionOf(readFrontMatter(`---\nflow: { ${key}: 1 }\n---\n`))).toBe('forbidden-key');
  });

  it('プロトタイプを汚さない(拒んだあとも Object の素の状態が保たれる)', () => {
    readFrontMatter('---\n__proto__:\n  polluted: yes\n---\n');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('マッピングでないトップレベル(配列・文字列)は拒む', () => {
    expect(rejectionOf(readFrontMatter('---\n- a\n- b\n---\n'))).toBe('not-mapping');
    expect(rejectionOf(readFrontMatter('---\njust text\n---\n'))).toBe('not-mapping');
  });
});

describe('ふつうの読み取り', () => {
  it('開きが無いファイル・`----` で始まるファイルはフロントマター無し', () => {
    expect(readFrontMatter('# 見出し\n')).toEqual({ kind: 'none' });
    expect(readFrontMatter('----\na: 1\n---\n')).toEqual({ kind: 'none' });
    expect(readFrontMatter('')).toEqual({ kind: 'none' });
  });

  it('閉じが無ければ末尾までを読み、closed: false と言う', () => {
    expect(readFrontMatter('---\ndoc_type: x\n')).toEqual({ kind: 'ok', data: { doc_type: 'x' }, closed: false });
  });

  it('BOM と CRLF を許す・中身が空なら空のマッピング', () => {
    expect(readFrontMatter('﻿---\r\ndoc_type: x\r\n---\r\n')).toEqual({ kind: 'ok', data: { doc_type: 'x' }, closed: true });
    expect(readFrontMatter('---\n---\n')).toEqual({ kind: 'ok', data: {}, closed: true });
  });

  it('壊れた YAML は例外でなく結果で返す(1 行の説明つき)', () => {
    const result = readFrontMatter('---\na: [1, 2\n---\n');
    expect(rejectionOf(result)).toBe('yaml-error');
    if (result.kind === 'rejected') expect(result.message.split('\n')).toHaveLength(1);
  });

  it('日付に見える値は文字列のまま(暗黙の日時の変換をしない)', () => {
    expect(readFrontMatter('---\ndate: 2026-08-06\n---\n')).toEqual({ kind: 'ok', data: { date: '2026-08-06' }, closed: true });
  });
});

describe('実際の仕様は以前と同じ値で読める', () => {
  const read = (relative: string): FrontMatterResult => readFrontMatter(readFileSync(path.join(REPO_ROOT, relative), 'utf8'));

  it('題材の表の仕様(トリガ・配列・入れ子を含む)', () => {
    const result = read('legacy/spec-tools/__tests__/fixtures/samples/stores/docs/specs/backend/data/tables/shelves.md');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data['doc_type']).toBe('data_table');
      expect(Array.isArray(result.data['triggers'])).toBe(true);
    }
  });

  it('ルールの文書(ADR。date は文字列)', () => {
    const result = read('docs/rules/decisions/common/ADR-0001-adopt-adr.md');
    expect(result).toEqual({
      kind: 'ok',
      closed: true,
      data: {
        doc_type: 'decision',
        scope: 'common',
        id: 'ADR-0001',
        status: 'accepted',
        targets: ['documentation_process'],
        date: '2026-08-06',
        norms: ['PRIN-0001'],
        references_required: false,
      },
    });
  });
});
