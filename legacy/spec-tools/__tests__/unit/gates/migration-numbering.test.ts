/**
 * migration の採番(C23 の 2 つめの判定)のテスト。
 *
 * 判定は純粋関数(`numberingViolations`)であり、入力は「基点にあったファイル」と
 * 「この変更が足したファイル」の 2 つだけなので、ここでは本物の git を使わない
 * (`addedPaths` が `git diff --name-status` の状態文字から後者を作ることは、
 * 不変則の側のテストが本物の git で作った出力の形をそのまま使って確かめている)。
 *
 * 見るのは 6 つ ——
 *   1. **末尾の次**に採番するのは通る(これが反例の形である)
 *   2. **欠番を埋める**のは赤(規約が名指しで禁じている。**飛ぶのは通る**)
 *   3. 日付が変わって**連番を振り直す**のは赤
 *   4. 歴史に既にある破れは触らない(適用済み migration は改名できないので直せない)
 *   5. 連番の**最大**とは比べない(時刻ベースの `…120003` が最大なので、比べると全部赤になる)
 *   6. 報告文が**次に使う番号**を名指す(末尾の連番 + 1・日付は今日を `Asia/Tokyo` で採る)
 */

import { describe, expect, it } from 'vitest';
import {
  addedPaths,
  dateStamp,
  formatNumberingViolations,
  nextNumber,
  numberingViolations,
  sequenceOf,
} from '../../../lib/gates/migration-numbering.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** `supabase/migrations/` を前置する(読みやすさのため)。 */
function at(...names: readonly string[]): string[] {
  return names.map((name) => `supabase/migrations/${name}`);
}

/** 破れを `[破り方] ファイル名` の 1 行にする。 */
function summary(violations: readonly { kind: string; file: string }[]): string[] {
  return violations.map((violation) => `[${violation.kind}] ${violation.file.replace('supabase/migrations/', '')}`);
}

describe('migration の採番(辞書順の末尾の次に採番する)', () => {
  it('末尾の次に足すのは通る —— これが反例の形である', () => {
    const base = at('20260101000001_first.sql', '20260101000002_second.sql');

    expect(numberingViolations(base, at('20260102000003_third.sql'), TEST_ROOTS)).toEqual([]);
  });

  it('飛ぶのは通る(欠番そのものは破れではない)', () => {
    const base = at('20260101000001_first.sql');

    expect(numberingViolations(base, at('20260101000010_tenth.sql'), TEST_ROOTS)).toEqual([]);
  });

  it('**欠番を埋める**のは赤(一度捨てた番号を後から別の内容で使わせない)', () => {
    // 基点に 001 と 005 があり 002〜004 が欠番。そこへ 003 を挿すと辞書順で末尾より前になる。
    const base = at('20260101000001_first.sql', '20260101000005_fifth.sql');

    expect(summary(numberingViolations(base, at('20260101000003_filler.sql'), TEST_ROOTS))).toEqual([
      '[末尾より前] 20260101000003_filler.sql',
    ]);
  });

  it('日付が変わって連番を振り直したら赤(規約が名指しで禁じている形)', () => {
    // 辞書順では末尾より後ろだが、連番が末尾以下である。
    const base = at('20260101000001_first.sql', '20260101000002_second.sql');

    expect(summary(numberingViolations(base, at('20260102000001_third.sql'), TEST_ROOTS))).toEqual([
      '[連番の逆行] 20260102000001_third.sql',
    ]);
  });

  it('同じ連番を 2 本足したら赤(並行作業の衝突がここで割れる)', () => {
    const base = at('20260101000001_first.sql');
    const added = at('20260102000002_a.sql', '20260103000002_b.sql');

    expect(summary(numberingViolations(base, added, TEST_ROOTS))).toEqual(['[連番の逆行] 20260103000002_b.sql']);
  });

  it('足したファイル 2 本が末尾から順に並んでいれば通る', () => {
    const base = at('20260101000001_first.sql');
    const added = at('20260102000002_a.sql', '20260102000003_b.sql');

    expect(numberingViolations(base, added, TEST_ROOTS)).toEqual([]);
  });

  it('歴史に既にある破れは触らない(適用済み migration は改名できないので直せない)', () => {
    const base = at('20260101120003_time_based.sql', '20260102000010_renumbered.sql');

    expect(numberingViolations(base, [], TEST_ROOTS)).toEqual([]);
    expect(numberingViolations(base, at('20260103000011_next.sql'), TEST_ROOTS)).toEqual([]);
  });

  it('連番の**最大**とは比べない(時刻ベースの採番が混入した歴史を持つリポジトリで全部赤にしない)', () => {
    // 最大の連番は 120003 だが、辞書順の末尾は 20260102000010 である。
    const base = at('20260101120003_time_based.sql', '20260102000010_renumbered.sql');

    expect(numberingViolations(base, at('20260103000011_next.sql'), TEST_ROOTS)).toEqual([]);
  });

  it('名前が形式どおりでない追加は「読めない名前」として赤(黙って通さない)', () => {
    const violations = numberingViolations(at('20260101000001_first.sql'), at('fix-the-thing.sql'), TEST_ROOTS);

    expect(violations).toEqual([{ file: 'supabase/migrations/fix-the-thing.sql', kind: '読めない名前' }]);
  });

  it('基点に migration が 1 本も無ければ比べる相手が無い(最初の 1 本は通る)', () => {
    expect(numberingViolations([], at('20260101000001_first.sql'), TEST_ROOTS)).toEqual([]);
  });

  it('migration 以外のパスは見ない', () => {
    expect(numberingViolations(['docs/README.md'], ['docs/NOTES.md'], TEST_ROOTS)).toEqual([]);
  });

  it('連番は 6 桁の位置から読む(日付部分は連番ではない)', () => {
    expect(sequenceOf('supabase/migrations/20260904000042_update_member.sql')).toBe(42);
    expect(sequenceOf('supabase/migrations/20260809120001_program_items.sql')).toBe(120001);
    expect(sequenceOf('supabase/migrations/no_sequence.sql')).toBeNull();
  });

  it('追加の取り出しは A / R / C を見る(改名先が新しいパスである)', () => {
    const changes = [
      { status: 'A', path: 'supabase/migrations/20260101000002_a.sql' },
      { status: 'M', path: 'supabase/migrations/20260101000001_first.sql' },
      { status: 'R100', path: 'supabase/migrations/20260101000003_old.sql', renamedTo: 'supabase/migrations/20260101000004_new.sql' },
    ];

    expect(addedPaths(changes)).toEqual([
      'supabase/migrations/20260101000002_a.sql',
      'supabase/migrations/20260101000004_new.sql',
    ]);
  });

  it('報告文は破れごとに「何が」と「どう直すか」を出す', () => {
    const lines = formatNumberingViolations(
      numberingViolations(at('20260101000002_second.sql'), at('20260102000001_third.sql'), TEST_ROOTS),
      'HEAD',
      '20260926',
    );

    expect(lines[0]).toContain('C23 migration の採番: 1 件');
    expect(lines.join('\n')).toContain('辞書順の末尾は supabase/migrations/20260101000002_second.sql');
    expect(lines.join('\n')).toContain('ls supabase/migrations/ | tail -1');
    expect(formatNumberingViolations([], 'HEAD', '20260926')).toEqual([]);
  });

  it('報告文は**次に使う番号**を出す(末尾の連番 + 1・日付は今日)', () => {
    const lines = formatNumberingViolations(
      numberingViolations(at('20260926000423_grants.sql'), at('20260926000423_again.sql'), TEST_ROOTS),
      'HEAD',
      '20260926',
    );

    expect(lines.join('\n')).toContain('次に使う番号: 20260926000424');
  });

  it('次に使う番号は「破れごとの末尾のうち最大」の次(足したファイルで末尾が進む)', () => {
    // 424 は通り(末尾が進む)、その次に足した 423 が逆行で赤になる。薦める番号は 425 である。
    const violations = numberingViolations(at('20260101000423_base.sql'), at('20260926000424_ok.sql', '20260927000423_back.sql'), TEST_ROOTS);

    expect(nextNumber(violations, '20260927')).toBe('20260927000425');
  });

  it('末尾を持たない破れ(読めない名前)だけなら番号は薦めない', () => {
    const violations = numberingViolations(at('20260101000001_first.sql'), ['supabase/migrations/fix.sql'], TEST_ROOTS);

    expect(nextNumber(violations, '20260926')).toBeNull();
    expect(formatNumberingViolations(violations, 'HEAD', '20260926').join('\n')).not.toContain('次に使う番号');
  });

  it('今日の 8 桁は Asia/Tokyo の暦日で採る(UTC の CI と手元で同じ番号を薦める)', () => {
    // 2026-09-25T15:00Z は JST では 2026-09-26 の 0 時である。
    expect(dateStamp(new Date('2026-09-25T15:00:00.000Z'))).toBe('20260926');
    expect(dateStamp(new Date('2026-09-25T14:59:59.000Z'))).toBe('20260925');
  });
});
