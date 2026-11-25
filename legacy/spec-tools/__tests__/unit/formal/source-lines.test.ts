/**
 * モデルの鮮度(C24 の第 1 段)のテスト。
 *
 * この検査の値打ちは「**写し元が 1 バイト変わったら赤になる**」の一点である。
 * 宣言には 2 形あり、`SOURCE-FN:`(関数名)の側は **migration が追記専用の歴史**だから
 * 存在する —— パスで宣言すると、実装を直しても旧ファイルは動かず鮮度が赤くならない。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { freshnessFindings, parseSourceDeclarations } from '../../../lib/formal/source-lines.js';
import type { ResolvedSource } from '../../../lib/formal/source-lines.js';

/** 文字列の sha256(検査器が実ファイルに対して計算するのと同じ方法)。 */
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const BODY = 'select 1 from public.jobs;\n';
const HASH = sha256(BODY);

const TLA = [
  '---- MODULE Outbox ----',
  `\\* SOURCE: app/src/x.ts ${HASH}`,
  `\\* SOURCE-FN: claim_due_jobs ${HASH}`,
  '\\* 意図: …',
  '====',
].join('\n');

/** 解決結果 1 件。 */
function ok(path: string, hash: string): ResolvedSource {
  return { kind: 'ok', path, sha256: hash };
}

describe('parseSourceDeclarations', () => {
  it('2 形をそれぞれ kind と target に読む', () => {
    const parsed = parseSourceDeclarations(TLA);
    expect(parsed.declarations).toEqual([
      { kind: 'path', target: 'app/src/x.ts', sha256: HASH, line: 2 },
      { kind: 'function', target: 'claim_due_jobs', sha256: HASH, line: 3 },
    ]);
    expect(parsed.malformed).toEqual([]);
  });

  it('SOURCE を宣言するのに形が合わない行は malformed に落とす(黙って見逃さない)', () => {
    const parsed = parseSourceDeclarations('\\* SOURCE: app/x.ts deadbeef\n\\* SOURCE-FN: fn\n');
    expect(parsed.declarations).toEqual([]);
    expect(parsed.malformed).toHaveLength(2);
  });
});

describe('freshnessFindings', () => {
  const resolved = new Map<string, ResolvedSource>([
    ['app/src/x.ts', ok('app/src/x.ts', HASH)],
    ['claim_due_jobs', ok('supabase/migrations/20260809000009_claim_due_jobs.sql', HASH)],
  ]);

  it('宣言と実ファイルが一致していれば何も言わない', () => {
    expect(freshnessFindings('Outbox', parseSourceDeclarations(TLA), resolved)).toEqual([]);
  });

  it('写し元が 1 バイト変わると赤になり、新しいハッシュを対処に出す', () => {
    // 末尾に空白を 1 つ足しただけ = 1 バイトの変更。
    const changed = sha256(`${BODY} `);
    expect(changed).not.toBe(HASH);
    const findings = freshnessFindings(
      'Outbox',
      parseSourceDeclarations(TLA),
      new Map([...resolved, ['app/src/x.ts', ok('app/src/x.ts', changed)]]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('写し元が変わりました');
    expect(findings[0]?.location).toBe('formal/Outbox.tla:2');
    expect(findings[0]?.suggestion).toContain(changed);
  });

  it('関数の宣言では、解決先の migration を文面に出す(どこを見ればよいかが変わるため)', () => {
    const findings = freshnessFindings(
      'Outbox',
      parseSourceDeclarations(TLA),
      new Map([...resolved, ['claim_due_jobs', ok('supabase/migrations/20261001000001_fix.sql', sha256('x'))]]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('claim_due_jobs');
    expect(findings[0]?.message).toContain('20261001000001_fix.sql');
  });

  it('解決できなければ赤になる(見つからないを「一致」にしない)', () => {
    const findings = freshnessFindings(
      'Outbox',
      parseSourceDeclarations(TLA),
      new Map([...resolved, ['claim_due_jobs', { kind: 'missing', reason: '定義する migration がありません' }]]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('解決できません');
  });

  it('解決を試みていない宣言も赤になる', () => {
    const findings = freshnessFindings('Outbox', parseSourceDeclarations(TLA), new Map());
    expect(findings).toHaveLength(2);
  });

  it('SOURCE の宣言が 1 行も無ければ赤になる', () => {
    const findings = freshnessFindings('Outbox', parseSourceDeclarations('---- MODULE Outbox ----\n'), new Map());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('宣言が 1 行もありません');
  });
});

describe('freshnessFindings(閉包)', () => {
  const file = (p: string, h: string): { path: string; sha256: string } => ({ path: p, sha256: h });
  const entry = file('lib/entry.ts', 'e'.repeat(64));
  const leafOld = file('lib/messages/leaf.ts', '1'.repeat(64));
  const leafNew = file('lib/messages/leaf.ts', '2'.repeat(64));
  const closureTla = ['---- MODULE M ----', `\\* SOURCE: lib/entry.ts ${HASH}`, '===='].join('\n');

  /** 閉包の hash が食い違う解決結果(`previous` は呼び側が決める)。 */
  function stale(previous?: readonly { path: string; sha256: string }[] | null): ReadonlyMap<string, ResolvedSource> {
    return new Map<string, ResolvedSource>([
      [
        'lib/entry.ts',
        {
          kind: 'ok',
          path: 'lib/entry.ts',
          sha256: sha256('new-closure'),
          closure: [entry, leafNew],
          ...(previous === undefined ? {} : { previous }),
        },
      ],
    ]);
  }

  it('宣言を作った時点の閉包を復元できたら、動いた import 先を旧 → 新の hash つきで名指す', () => {
    const findings = freshnessFindings('M', parseSourceDeclarations(closureTla), stale([entry, leafOld]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('閉包');
    const detail = (findings[0]?.detail ?? []).join('\n');
    expect(detail).toContain('lib/messages/leaf.ts');
    expect(detail).toContain(`${'1'.repeat(12)} → ${'2'.repeat(12)}`);
    expect(detail).not.toContain('lib/entry.ts e'); // 動いていないファイルは出さない
  });

  it('import が増えた・減ったファイルも名指す', () => {
    const detail = (
      freshnessFindings('M', parseSourceDeclarations(closureTla), stale([entry, file('lib/old.ts', '3'.repeat(64))]))[0]?.detail ?? []
    ).join('\n');

    expect(detail).toContain('増えた');
    expect(detail).toContain('lib/messages/leaf.ts');
    expect(detail).toContain('減った');
    expect(detail).toContain('lib/old.ts');
  });

  it('復元できなかったら、そう言って閉包の全ファイルを出す(名指せないふりをしない)', () => {
    const detail = (freshnessFindings('M', parseSourceDeclarations(closureTla), stale(null))[0]?.detail ?? []).join('\n');

    expect(detail).toContain('復元できなかった');
    expect(detail).toContain('lib/entry.ts');
    expect(detail).toContain('lib/messages/leaf.ts');
  });
});
