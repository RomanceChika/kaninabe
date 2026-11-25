/**
 * `SOURCE-FN:` の解決(関数名 → いま生きている migration)のテスト。
 *
 * この解決が要る理由は 1 つである —— **migration は追記専用の歴史**なので、DB の関数を
 * 直すと新しい番号のファイルができ、旧ファイルは 1 バイトも動かない。パスで鮮度を見ると
 * **実装を直しても赤くならない**(モデルは古いまま、検査は緑)。ここが「最新の定義」を
 * 指し直すことで、直した瞬間にハッシュが変わる。
 */

import { describe, expect, it } from 'vitest';
import { allDefinitions, latestDefinition } from '../../../lib/formal/migration-function.js';

const FILES = [
  { name: '20260101000001_first.sql', text: 'create function public.claim_due_jobs(\n    p_limit integer\n) returns void' },
  { name: '20260301000002_unrelated.sql', text: 'create table public.jobs (id uuid);' },
  { name: '20260201000003_fix.sql', text: 'create or replace function public.claim_due_jobs(p_limit integer)' },
];

describe('latestDefinition', () => {
  it('その関数を定義する最新番号のファイルを返す(並び順に依らない)', () => {
    expect(latestDefinition(FILES, 'claim_due_jobs')).toBe('20260201000003_fix.sql');
    expect(latestDefinition([...FILES].reverse(), 'claim_due_jobs')).toBe('20260201000003_fix.sql');
  });

  it('`create function` と `create or replace function` の両方を拾う', () => {
    expect(latestDefinition([FILES[0] as (typeof FILES)[number]], 'claim_due_jobs')).toBe('20260101000001_first.sql');
    expect(latestDefinition([FILES[2] as (typeof FILES)[number]], 'claim_due_jobs')).toBe('20260201000003_fix.sql');
  });

  it('スキーマ修飾が無い形も拾う', () => {
    const files = [{ name: '20260101000001_a.sql', text: 'create function check_staff_floor() returns trigger' }];
    expect(latestDefinition(files, 'check_staff_floor')).toBe('20260101000001_a.sql');
  });

  it('前方一致の別名を拾わない(claim_due_jobs_v2 は別の関数)', () => {
    const files = [{ name: '20260101000001_a.sql', text: 'create function public.claim_due_jobs_v2(p integer)' }];
    expect(latestDefinition(files, 'claim_due_jobs')).toBeNull();
  });

  it('定義する migration が 1 本も無ければ null(黙って通さないための材料)', () => {
    expect(latestDefinition(FILES, 'no_such_function')).toBeNull();
  });
});

describe('allDefinitions', () => {
  it('定義しているファイルを昇順で全部返す(何度直されたかが読める)', () => {
    expect(allDefinitions(FILES, 'claim_due_jobs')).toEqual([
      '20260101000001_first.sql',
      '20260201000003_fix.sql',
    ]);
  });
});
