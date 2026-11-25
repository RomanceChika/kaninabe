/**
 * 置き場の主張の衝突の一括検査(`lib/model/product/layout-claims.ts`)のテスト。
 *
 * 契約は「衝突したら失敗」。同じパスを 2 つの持ち主が取る(URL の表記ゆれ・役割をまたいだ同じパスも)・1 つだけの役割を 2 つが取る・
 * 役割が配置に無い・キーが形に合わない・持ち主が宣言されていない、を理由つきで返す(throw しない)。
 */

import { describe, expect, it } from 'vitest';
import { layoutClaimProblems } from '../../../../lib/model/product/layout-claims.js';
import type { LayoutClaim } from '../../../../lib/model/product/layout-claims.js';
import type { ProductLayout, RoleDecl } from '../../../../lib/model/product/layout.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';

const job = (id: string, endpoint: string): LayoutClaim => ({ role: 'http-entry', key: endpoint, owner: 'product', source: `ジョブ ${id}` });
const inbound = (id: string): LayoutClaim => ({ role: 'http-entry', key: `/api/inbound/${id}`, owner: 'code-inbound-route', source: `連携 ${id}` });

describe('layoutClaimProblems', () => {
  it('主張が重ならなければ違反なし(主張が 0 件でも)', () => {
    expect(layoutClaimProblems(TEST_LAYOUT, [job('a', '/api/a/run'), job('b', '/api/b/run'), inbound('x')])).toEqual([]);
    expect(layoutClaimProblems(TEST_LAYOUT, [])).toEqual([]);
  });

  it('同じ URL を 2 つの持ち主が取れば衝突(ジョブの endpoint と受信口)。出どころを両方名指す', () => {
    const problems = layoutClaimProblems(TEST_LAYOUT, [job('a', '/api/inbound/x'), inbound('x')]);

    expect(problems).toEqual([
      {
        kind: 'duplicate_path',
        message: '同じ置き場 src/app/api/inbound/x/route.ts を 2 つの主張が取っています: ジョブ a / 連携 x',
        sources: ['ジョブ a', '連携 x'],
      },
    ]);
  });

  it('大文字小文字だけ違う URL も衝突(大文字小文字を区別しないファイルシステムでは同じ置き場)。違う綴りの両方を示し、同じ綴りには注記を付けない', () => {
    const folded = layoutClaimProblems(TEST_LAYOUT, [job('a', '/api/Jobs/run'), job('b', '/api/jobs/run')]);

    expect(folded.map((problem) => problem.kind)).toEqual(['duplicate_path']);
    expect(folded[0]?.message).toBe(
      '同じ置き場 src/app/api/Jobs/run/route.ts / src/app/api/jobs/run/route.ts(大文字小文字だけ違う綴りも、大文字小文字を区別しないファイルシステムでは同じ置き場) を 2 つの主張が取っています: ジョブ a / ジョブ b',
    );
    expect(layoutClaimProblems(TEST_LAYOUT, [job('a', '/api/jobs/run'), job('b', '/api/jobs/run')])[0]?.message).not.toContain('大文字小文字');
  });

  it('ジョブどうしの同じ URL も衝突。先頭の / や末尾の / の表記ゆれは同じ URL として数える', () => {
    const problems = layoutClaimProblems(TEST_LAYOUT, [job('a', '/api/jobs/run'), job('b', 'api/jobs/run/')]);

    expect(problems.map((problem) => problem.kind)).toEqual(['duplicate_path']);
    expect(problems[0]?.sources).toEqual(['ジョブ a', 'ジョブ b']);
  });

  it('1 つだけの役割(source-root)を 2 つの主張が取れば多重度の違反(重複するパスの違反とは別に 1 件で言う)', () => {
    const claims: LayoutClaim[] = [
      { role: 'source-root', owner: 'product', source: '手書き A' },
      { role: 'source-root', owner: 'code-inbound-route', source: '生成器' },
    ];

    expect(layoutClaimProblems(TEST_LAYOUT, claims).map((problem) => problem.kind)).toEqual(['multiplicity']);
  });

  it('役割をまたいでも、同じパスになれば衝突(別々の役割が同じファイルを取る配置)', () => {
    const clash: ProductLayout = { ...TEST_LAYOUT, 'composition-root': { ...(TEST_LAYOUT['composition-root'] as RoleDecl), place: (id) => `app/api/${id}/route.ts`, base: 'source-root' } };

    const problems = layoutClaimProblems(clash, [job('a', '/api/x'), { role: 'composition-root', key: 'x', owner: 'code-inbound-route', source: '配線 x' }]);

    expect(problems.map((problem) => problem.kind)).toEqual(['duplicate_path']);
  });

  it('配置に無い役割・キーの形に合わないキー・宣言されていない持ち主はそれぞれ理由つきで返る', () => {
    const problems = layoutClaimProblems({ 'http-entry': TEST_LAYOUT['http-entry'] as RoleDecl }, [
      { role: 'composition-root', key: 'x', owner: 'code-inbound-route', source: '配線 x' },
      { role: 'http-entry', key: '/has space', owner: 'product', source: 'ジョブ c' },
      { role: 'http-entry', key: '/api/d', owner: 'someone-else', source: 'ジョブ d' },
    ]);

    // 基準の役割(source-root)がこの配置に無いので、ジョブ d は置き場を決められない(持ち主の食い違いより先に言う)。
    expect(problems.map((problem) => problem.kind)).toEqual(['unknown_role', 'invalid_key', 'unresolvable']);
    expect(problems[2]?.message).toBe('ジョブ d の置き場を決められません(役割 http-entry の基準の役割が、この配置に宣言されていません)');
  });

  it('持ち主が役割に宣言されていなければ、理由つきで返る(置き場は決まる)', () => {
    const problems = layoutClaimProblems(TEST_LAYOUT, [{ role: 'http-entry', key: '/api/d', owner: 'someone-else', source: 'ジョブ d' }]);

    expect(problems).toEqual([
      { kind: 'undeclared_owner', message: 'ジョブ d の持ち主 someone-else は、役割 http-entry の持ち主として宣言されていません', sources: ['ジョブ d'] },
    ]);
  });

  it('別の配置でも同じ契約で見る(URL が同じなら、どの綴りの配置でも衝突する)', () => {
    expect(layoutClaimProblems(FOREIGN_LAYOUT, [job('a', '/api/inbound/x'), inbound('x')]).map((problem) => problem.kind)).toEqual(['duplicate_path']);
  });
});

describe('layoutClaimProblems: 逆引きを持つ役割(画面の器)の往復', () => {
  const shell = (name: string, route: string): LayoutClaim => ({ role: 'screen-shell', key: route, owner: 'product', source: `画面 ${name}` });

  it('置き場 → 逆引きで同じ route に戻れば違反なし(ルートグループ・動的セグメントも)', () => {
    expect(layoutClaimProblems(TEST_LAYOUT, [shell('home', '/'), shell('detail', '/workshops/:id'), shell('docs', '/docs/:slug')])).toEqual([]);
    expect(layoutClaimProblems(FOREIGN_LAYOUT, [shell('detail', '/workshops/:id')])).toEqual([]);
  });

  it('非公開フォルダ・パラレルルートの下に置かれる route は、置き場には決まるが逆引きでは戻らない(not_reachable)', () => {
    const problems = layoutClaimProblems(TEST_LAYOUT, [shell('hidden', '/_private/x'), shell('modal', '/@modal/x')]);

    expect(problems.map((problem) => problem.kind)).toEqual(['not_reachable', 'not_reachable']);
    expect(problems[0]?.message).toContain('画面 hidden の置き場 src/app/_private/x/page.tsx は、役割 screen-shell の逆引きでは同じキーに戻りません');
    expect(problems[0]?.sources).toEqual(['画面 hidden']);
  });

  it('同じ route を 2 つの画面が取れば重複(S1 が言う重複と同じ事実)。逆引きの無い役割には往復の検査は掛からない', () => {
    const problems = layoutClaimProblems(TEST_LAYOUT, [shell('a', '/same'), shell('b', '/same')]);

    expect(problems.map((problem) => problem.kind)).toEqual(['duplicate_path']);
    expect(layoutClaimProblems(TEST_LAYOUT, [{ role: 'composition-root', key: 'stripe', owner: 'code-inbound-route', source: '配線' }])).toEqual([]);
  });
});

describe('HTTP の入口の逆引き(部品化 ③-c2b): http-entry にも not_reachable と、畳んだ名前の衝突が効く', () => {
  const entry = (source: string, url: string): LayoutClaim => ({ role: 'http-entry', key: url, owner: 'product', source });
  const shell = (name: string, route: string): LayoutClaim => ({ role: 'screen-shell', key: route, owner: 'product', source: `画面 ${name}` });

  it('非公開フォルダ・パラレルルート・ルートグループ・動的セグメントの下の endpoint は、置き場には決まるが逆引きでは同じ URL に戻らない(Cron は 404 になる)', () => {
    for (const url of ['/_cron/x', '/@a/x', '/(g)/x', '/[x]/y']) {
      const problems = layoutClaimProblems(TEST_LAYOUT, [entry('ジョブ', url)]);
      expect(problems.map((problem) => problem.kind), url).toEqual(['not_reachable']);
      expect(problems[0]?.message, url).toContain('役割 http-entry の逆引きでは同じキーに戻りません');
    }
    expect(layoutClaimProblems(TEST_LAYOUT, [entry('ジョブ', '/api/jobs/run')])).toEqual([]);
  });

  it('ルーティングの規約で同じ URL になる綴り(/(g)/x と /x)は、パスが違っても 1 つの置き場の取り合いとして数える', () => {
    const problems = layoutClaimProblems(TEST_LAYOUT, [entry('ジョブ a', '/(g)/x'), entry('ジョブ b', '/x')]);

    expect(problems.map((problem) => problem.kind)).toEqual(['not_reachable', 'duplicate_path']);
    expect(problems[1]?.message).toBe(
      '同じ置き場 src/app/(g)/x/route.ts / src/app/x/route.ts(綴りは違うが、ルーティングの規約で同じ実体になる置き場) を 2 つの主張が取っています: ジョブ a / ジョブ b',
    );
  });

  it('画面の器(page)と HTTP の入口(route)が同じ URL を取る衝突も、役割をまたぐ主張として数える(同じセグメントに両方は置けない)', () => {
    const problems = layoutClaimProblems(TEST_LAYOUT, [shell('home', '/x'), entry('ジョブ', '/x')]);

    expect(problems).toEqual([
      {
        kind: 'duplicate_path',
        message: '同じ置き場 src/app/x/page.tsx / src/app/x/route.ts(綴りは違うが、ルーティングの規約で同じ実体になる置き場) を 2 つの主張が取っています: 画面 home / ジョブ',
        sources: ['画面 home', 'ジョブ'],
      },
    ]);
    // 違う URL なら衝突しない。走査の根が別の配置(架空)では、同じ URL でも空間が別なので衝突しない。
    expect(layoutClaimProblems(TEST_LAYOUT, [shell('home', '/x'), entry('ジョブ', '/y')])).toEqual([]);
    expect(layoutClaimProblems(FOREIGN_LAYOUT, [shell('home', '/x'), entry('ジョブ', '/x')])).toEqual([]);
  });

  it('同じパスの主張の組と、畳んだ名前の主張の組が同じなら 1 件で言う(重ねない)。3 つなら 3 つ全部を 1 件で言う', () => {
    expect(layoutClaimProblems(TEST_LAYOUT, [entry('ジョブ a', '/x'), entry('ジョブ b', '/x')]).map((problem) => problem.kind)).toEqual(['duplicate_path']);
    const three = layoutClaimProblems(TEST_LAYOUT, [entry('ジョブ a', '/x'), entry('ジョブ b', '/x'), shell('home', '/x')]);
    expect(three).toHaveLength(1);
    expect(three[0]?.sources).toEqual(['ジョブ a', 'ジョブ b', '画面 home']);
  });
});
