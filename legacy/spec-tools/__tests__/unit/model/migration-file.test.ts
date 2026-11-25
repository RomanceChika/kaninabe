/**
 * 仕様が宣言する migration のファイル名(`ddl_migration` ほか)の綴り(`lib/model/migration-file.ts`)の単体テスト。
 *
 * 監査の実測(F-02a): `ddl_migration: ../../../../escape_marker.sql` で生成が木の外へ書いた。名前は 14 桁の連番 + 小文字の名前 + .sql に絞る。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../lib/model/parse-common.js';
import { MIGRATION_FILE_NAME, optionalMigrationFile, requiredMigrationFile } from '../../../lib/model/migration-file.js';
import { YamlReader } from '../../../lib/model/yaml-reader.js';

function run<T>(record: Record<string, unknown>, read: (reader: YamlReader, reporter: SpecReporter) => T): { readonly value: T; readonly errors: number; readonly dropped: number } {
  const reporter = new SpecReporter('x.md');
  const value = read(new YamlReader(record, '', reporter), reporter);
  return { value, errors: reporter.findings().filter((finding) => finding.severity === 'error').length, dropped: reporter.droppedCount() };
}

describe('MIGRATION_FILE_NAME', () => {
  it.each(['20260912000150_policies_check_items.sql', '20261003000437_grants.sql'])('%s は通す', (name) => {
    expect(MIGRATION_FILE_NAME.test(name)).toBe(true);
  });

  it.each([
    '../../../../escape_marker.sql',
    'sub/20260912000150_x.sql',
    '/etc/cron.d/x.sql',
    '20260912000150_x.sql\n-- injected',
    '20260912000150_X.sql',
    '2026091200015_x.sql',
    '20260912000150_x.sh',
    '20260912000150_.sql',
    '20260912000150_x..sql',
  ])('%j は拒む', (name) => {
    expect(MIGRATION_FILE_NAME.test(name)).toBe(false);
  });
});

describe('optionalMigrationFile / requiredMigrationFile', () => {
  it('形が違う宣言はモデルに載せず、違反と落とした宣言として数える', () => {
    const { value, errors, dropped } = run({ ddl_migration: '../../../../escape_marker.sql' }, (reader, reporter) => optionalMigrationFile(reader, reporter, 'ddl_migration', 'x'));

    expect(value).toBeUndefined();
    expect(errors).toBe(1);
    expect(dropped).toBe(1);
  });

  it('形が合えば通す。書かれていなければ違反にしない', () => {
    expect(run({ m: '20260101000000_a.sql' }, (reader, reporter) => optionalMigrationFile(reader, reporter, 'm', 'x')).value).toBe('20260101000000_a.sql');
    expect(run({}, (reader, reporter) => optionalMigrationFile(reader, reporter, 'm', 'x'))).toMatchObject({ value: undefined, errors: 0 });
  });

  it('必須版は欠落も形の不正も null', () => {
    expect(run({}, (reader, reporter) => requiredMigrationFile(reader, reporter, 'm', 'x'))).toMatchObject({ value: null, errors: 1 });
    expect(run({ m: 'a/../b.sql' }, (reader, reporter) => requiredMigrationFile(reader, reporter, 'm', 'x'))).toMatchObject({ value: null, errors: 1 });
  });
});
