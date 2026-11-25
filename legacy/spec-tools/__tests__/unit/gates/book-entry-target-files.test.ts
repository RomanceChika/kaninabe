import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGET_NAMES } from '../../../cli/default-targets.js';
import {
  BOOK_ENTRY_TARGET_FILES,
  BOOK_ENTRY_VALUE_FILES,
  bookEntryBannedPattern,
  bookEntryTargetFileProblems,
} from '../../../lib/gates/book-entry-target-files.js';
import { CLOSURE_BANS } from '../../../lib/gates/lib-layers.js';

/**
 * ハンドブックの入口の閉包の禁止の例外(値として読んでよい後段のファイル 2 本)が、選択(`cli/default-targets.ts`)と食い違わないこと。
 * 名指しはデータで選択とは別の場所にあるので、選択を替えて名指しを直し忘れる(または逆)と赤になる(`targetSpellingProblems` と同じ「表と木の食い違い」の形)。
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));
const NAMES = { platform: 'supabase', app_frame: 'nextjs' } as const;
const exists = (file: string): boolean => existsSync(`${LIB_DIR}${file.replace(/^lib\//, '')}`);

describe('bookEntryTargetFileProblems', () => {
  it('実物: 名指しのファイルは、選択(DEFAULT_TARGET_NAMES)が指す値のファイルと一致し、どちらも実在する', () => {
    expect(bookEntryTargetFileProblems(BOOK_ENTRY_TARGET_FILES, DEFAULT_TARGET_NAMES, exists)).toEqual([]);
    expect(BOOK_ENTRY_TARGET_FILES).toEqual([
      `lib/targets/${DEFAULT_TARGET_NAMES.platform}/${BOOK_ENTRY_VALUE_FILES.platform}`,
      `lib/targets/${DEFAULT_TARGET_NAMES.app_frame}/${BOOK_ENTRY_VALUE_FILES.app_frame}`,
    ]);
  });

  it('選択を替えて名指しを直し忘れると、選択側の値のファイルが名指しに無いことと、名指しが選択のどれとも一致しないことの両方が出る', () => {
    const problems = bookEntryTargetFileProblems(BOOK_ENTRY_TARGET_FILES, { platform: 'plainpg', app_frame: 'nextjs' }, () => true);

    expect(problems).toEqual([
      '選択(platform = plainpg)の値のファイル lib/targets/plainpg/platform-profile.ts が、ハンドブックの入口の名指し(BOOK_ENTRY_TARGET_FILES)にありません',
      'ハンドブックの入口の名指し lib/targets/supabase/platform-profile.ts が、選択(default-targets.ts の DEFAULT_TARGET_NAMES)が指すどの値のファイルとも一致しません',
    ]);
  });

  it('名指しと選択が合っていても、値のファイルが実在しなければ赤(腐った名指しを残さない)', () => {
    expect(bookEntryTargetFileProblems(BOOK_ENTRY_TARGET_FILES, NAMES, (file) => !file.endsWith('layout.ts'))).toEqual([
      '選択(app_frame = nextjs)の値のファイル lib/targets/nextjs/layout.ts が実在しません',
    ]);
  });

  it('名指しに余分なファイルがあれば赤(例外を増やしても選択と食い違う)', () => {
    expect(bookEntryTargetFileProblems([...BOOK_ENTRY_TARGET_FILES, 'lib/targets/vercel/target.ts'], NAMES, () => true)).toEqual([
      'ハンドブックの入口の名指し lib/targets/vercel/target.ts が、選択(default-targets.ts の DEFAULT_TARGET_NAMES)が指すどの値のファイルとも一致しません',
    ]);
  });
});

describe('bookEntryBannedPattern: 閉包の禁止に使う正規表現', () => {
  it('契約と、名指し以外の後段の置き場の全部を禁じ、名指しの値のファイルだけを通す', () => {
    const banned = bookEntryBannedPattern(BOOK_ENTRY_TARGET_FILES);

    expect(banned.test('lib/target-api/contract.ts')).toBe(true);
    expect(banned.test('lib/targets/supabase/target.ts')).toBe(true);
    expect(banned.test('lib/targets/supabase/platform-profile.ts')).toBe(false);
    expect(banned.test('lib/targets/nextjs/layout.ts')).toBe(false);
    expect(banned.test('lib/targets/nextjs/layout.ts.bak')).toBe(true);
    expect(banned.test('lib/targets/nextjs/target.ts')).toBe(true);
    expect(banned.test('lib/targets/vercel/generate/code-cron-route-tests.ts')).toBe(true);
    expect(banned.test('lib/model/product/layout.ts')).toBe(false);
  });

  it('実物の閉包の禁止の 1 行は、この正規表現(名指しのデータから作ったもの)を使う', () => {
    const ban = CLOSURE_BANS.find((row) => row.banned.source === bookEntryBannedPattern(BOOK_ENTRY_TARGET_FILES).source);
    expect(ban?.from.test('cli/generate-book.ts')).toBe(true);
  });
});
