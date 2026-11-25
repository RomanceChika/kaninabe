/**
 * H0(auth_spec のスキーマ適合)のユニットテスト。
 *
 * 規約網羅(auth-spec-writing.md §共通形式 / §1 行が宣言すること):
 *   - 正しい宣言を読めること
 *   - id が固定値であること・doc_type が一致すること
 *   - 行の id の形式と重複
 *   - 軸の値が値域に載っていること
 *   - **主語の軸(`kind: state`)がちょうど 1 本**であること(軸の名前は体系側が持たない)
 *   - `when` / `optional` が排他で、`when` が前方参照であること
 *   - 行に宣言されていない鍵を書けないこと
 *   - **条件の組が 2 行に現れないこと**(決定表として結末が一意)
 *   - 関門の `to` が `on_fail` と対応していること
 *   - `providers`(必須・空不可・スネークケース・重複なし)と `local_only`(任意・`providers` と重ならない)
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseAuthFlow } from '../../../../lib/model/auth/parse-auth.js';
import type { AuthFlowSpec } from '../../../../lib/model/auth/types.js';

/** 最小の正しいフロントマター。 */
function validData(): Record<string, unknown> {
  return {
    doc_type: 'auth_spec',
    id: 'auth-flow',
    subject: 'membership',
    providers: ['oauth_a'],
    sessions: { inactivity: '8h', absolute: '24h', reason: '確かめた理由', concurrent: { unbounded: '既定のまま' } },
    idp_session: { logout: 'keeps_idp', idp_ends: 'app_continues', lifetime: 'independent', reason: '確かめた理由' },
    mfa: { exempt: '外す理由' },
    axes: [
      { id: 'member', kind: 'state', summary: 'メンバー行の状態', of: 'membership', absent: 'none' },
      {
        id: 'invitation',
        kind: 'enum',
        summary: '招待コードの扱い',
        when: { member: 'none' },
        values: ['none', 'unknown', 'refused', 'unreadable', 'accepted'],
      },
      { id: 'guild', kind: 'enum', summary: '在籍の確認結果', optional: true, values: ['joined', 'not_joined'] },
    ],
    landings: [{ id: 'active', screen: 'screen-workshop-list', summary: '通常の入口へ' }],
    sign_in: [{ id: 'member_active', member: 'active', lands: 'active', summary: '通す' }],
    gates: [
      {
        id: 'session',
        guards: 'requires_auth',
        on_fail: 'redirect',
        to: 'screen-login',
        implementation: 'app/src/composition/auth.ts::requireSession',
        summary: '未ログインを送り返す',
      },
    ],
    test_cases: [
      {
        id: 'TC-AUTH-SIGNIN-001',
        type: 'unit',
        covers: ['success'],
        spec_ids: ['auth-flow'],
        implementation: 'app/src/operation/__tests__/shared/sign-in-sync.test.ts::何かを確かめる',
      },
    ],
  };
}

/**
 * パースして (値, エラーメッセージ) を返す。
 *
 * パーサーは「読めた分だけ」を返す設計なので、値が null になるのは実装の異常である
 * (テスト側で握りつぶすと、何も読めていないのに違反だけを見て通ってしまう)。
 */
function parse(data: Record<string, unknown>): {
  value: AuthFlowSpec;
  messages: readonly string[];
} {
  const reporter = new SpecReporter('docs/specs/backend/auth.md');
  const result = parseAuthFlow(data, reporter);
  if (result.value === null) throw new Error('パーサーが値を返しませんでした');
  return { value: result.value, messages: result.findings.map((finding) => finding.message) };
}

describe('H0: 認証フロー仕様のパース', () => {
  it('正しい宣言を読める', () => {
    const { value, messages } = parse(validData());
    expect(messages).toEqual([]);
    expect(value.subject).toBe('membership');
    expect(value.landings).toHaveLength(1);
    expect(value.branches[0]?.id).toBe('member_active');
    expect(value.gates[0]?.to).toBe('screen-login');
    expect(value.testCases).toHaveLength(1);
  });

  it('id が固定値でなければエラー', () => {
    const { messages } = parse({ ...validData(), id: 'sign-in-flow' });
    expect(messages.some((message) => message.includes('認証フロー仕様の id ではありません'))).toBe(true);
  });

  it('分岐 id の重複を落とす', () => {
    const data = validData();
    data['sign_in'] = [
      { id: 'dup', member: 'active', lands: 'active', summary: 'a' },
      { id: 'dup', member: 'guest', lands: 'active', summary: 'b' },
    ];
    const { value, messages } = parse(data);
    expect(messages.some((message) => message.includes('分岐 dup が重複しています'))).toBe(true);
    expect(value.branches).toHaveLength(1);
  });

  it('条件の組が同じ行が 2 つあれば落とす(結末が一意でない)', () => {
    const data = validData();
    data['sign_in'] = [
      { id: 'a', member: 'guest', guild: 'joined', lands: 'active', summary: 'a' },
      { id: 'b', member: 'guest', guild: 'joined', lands: 'active', summary: 'b' },
    ];
    const { value, messages } = parse(data);
    expect(messages.some((message) => message.includes('と同じ条件'))).toBe(true);
    expect(value.branches).toHaveLength(1);
  });

  it('値域の外の語を落とす', () => {
    const data = validData();
    data['sign_in'] = [
      { id: 'a', member: 'none', invitation: 'maybe', lands: 'active', summary: 'a' },
    ];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('invitation maybe'))).toBe(true);
  });

  it('id がスネークケースでなければ落とす', () => {
    const data = validData();
    data['sign_in'] = [{ id: 'MemberActive', member: 'active', lands: 'active', summary: 'a' }];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('スネークケース'))).toBe(true);
  });

  it('送り返す関門に to が無ければ落とす', () => {
    const data = validData();
    data['gates'] = [
      {
        id: 'session',
        guards: 'requires_auth',
        on_fail: 'redirect',
        implementation: 'app/src/composition/auth.ts::requireSession',
        summary: 'a',
      },
    ];
    const { value, messages } = parse(data);
    expect(messages.some((message) => message.includes('送り先(to)がありません'))).toBe(true);
    expect(value.gates).toHaveLength(0);
  });

  it('送り返さない関門が to を持てば落とす', () => {
    const data = validData();
    data['gates'] = [
      {
        id: 'staff',
        guards: 'role_gate',
        role: 'staff',
        on_fail: 'not_found',
        to: 'screen-login',
        implementation: 'app/src/composition/auth.ts::requireStaff',
        summary: 'a',
      },
    ];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('送り返さないのに to'))).toBe(true);
  });

  it('guards: role_gate なのに role が無ければ落とす', () => {
    const data = validData();
    data['gates'] = [
      {
        id: 'staff',
        guards: 'role_gate',
        on_fail: 'not_found',
        implementation: 'app/src/composition/auth.ts::requireStaff',
        summary: 'a',
      },
    ];
    const { value, messages } = parse(data);
    expect(messages.some((message) => message.includes('role がありません'))).toBe(true);
    expect(value.gates).toHaveLength(0);
  });

  it('guards: requires_auth なのに role を持てば落とす', () => {
    const data = validData();
    data['gates'] = [
      {
        id: 'session',
        guards: 'requires_auth',
        role: 'staff',
        on_fail: 'redirect',
        to: 'screen-login',
        implementation: 'app/src/composition/auth.ts::requireSession',
        summary: 'a',
      },
    ];
    const { value, messages } = parse(data);
    expect(messages.some((message) => message.includes('role を持っています'))).toBe(true);
    expect(value.gates).toHaveLength(0);
  });

  it('guards: role_gate + role を正しく読める', () => {
    const data = validData();
    data['gates'] = [
      {
        id: 'staff',
        guards: 'role_gate',
        role: 'staff',
        on_fail: 'not_found',
        implementation: 'app/src/composition/auth.ts::requireStaff',
        summary: 'a',
      },
    ];
    const { value, messages } = parse(data);
    expect(messages).toHaveLength(0);
    expect(value.gates[0]?.role).toBe('staff');
  });

  it('doc_type が違えば落とす', () => {
    const { messages } = parse({ ...validData(), doc_type: 'config_spec' });
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('H0: axes(決定表の軸)', () => {
  it('宣言した軸をそのまま読める(名前・summary・when / optional・values)', () => {
    const { value, messages } = parse(validData());
    expect(messages).toEqual([]);
    expect(value.axes).toEqual([
      {
        id: 'member',
        kind: 'state',
        summary: 'メンバー行の状態',
        of: 'membership',
        absent: 'none',
        location: expect.anything(),
      },
      {
        id: 'invitation',
        kind: 'enum',
        summary: '招待コードの扱い',
        when: { axis: 'member', value: 'none' },
        values: ['none', 'unknown', 'refused', 'unreadable', 'accepted'],
        location: expect.anything(),
      },
      {
        id: 'guild',
        kind: 'enum',
        summary: '在籍の確認結果',
        optional: true,
        values: ['joined', 'not_joined'],
        location: expect.anything(),
      },
    ]);
  });

  it('主語の軸の of が subject と食い違えば落とす', () => {
    const data = validData();
    data['axes'] = [{ id: 'member', kind: 'state', summary: 'a', of: 'other_machine', absent: 'none' }];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('subject(membership)と一致しません'))).toBe(true);
  });

  it('主語の軸が無ければ落とす', () => {
    const data = validData();
    data['axes'] = [{ id: 'invitation', kind: 'enum', summary: '招待', values: ['none'] }];
    const { messages } = parse(data);
    expect(
      messages.some((message) => message.includes('主語の軸(kind: state | field)がありません')),
    ).toBe(true);
  });

  it('主語の軸が状態機械を持たないシステムでも書ける(kind: field)', () => {
    const data = validData();
    data['subject'] = 'staff_member.access';
    data['axes'] = [
      { id: 'account', kind: 'field', summary: '利用可否', of: 'staff_member.access', absent: 'absent' },
    ];
    data['sign_in'] = [{ id: 'row', account: 'enabled', lands: 'active', summary: 'a' }];
    const { value, messages } = parse(data);
    expect(messages).toEqual([]);
    expect(value.axes[0]).toMatchObject({ kind: 'field', of: 'staff_member.access', absent: 'absent' });
  });

  it('主語の軸が 2 本あれば落とす(決定表の主語は 1 つ)', () => {
    const data = validData();
    data['axes'] = [
      { id: 'member', kind: 'state', summary: 'a', of: 'membership', absent: 'none' },
      { id: 'account', kind: 'state', summary: 'b', of: 'membership', absent: 'none' },
    ];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('主語の軸が 2 本あります'))).toBe(true);
  });

  it('軸の名前は自由である(member / invitation という語を体系側が要求しない)', () => {
    const data = validData();
    data['subject'] = 'card_status';
    data['axes'] = [
      { id: 'account', kind: 'state', summary: '利用者の状態', of: 'card_status', absent: 'absent' },
      { id: 'hold', kind: 'enum', summary: '取り置き', optional: true, values: ['none', 'ready'] },
    ];
    data['sign_in'] = [{ id: 'row', account: 'valid', lands: 'active', summary: 'a' }];
    const { value, messages } = parse(data);
    expect(messages).toEqual([]);
    expect(value.branches[0]?.values).toEqual({ account: 'valid' });
  });

  it('when と optional の両方は書けない', () => {
    const data = validData();
    data['axes'] = [
      { id: 'member', kind: 'state', summary: 'a', of: 'membership', absent: 'none' },
      { id: 'gate', kind: 'enum', summary: 'b', when: { member: 'none' }, optional: true, values: ['x'] },
    ];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('when と optional の両方'))).toBe(true);
  });

  it('when が前方参照でなければ落とす(軸どうしの条件が循環しない)', () => {
    const data = validData();
    data['axes'] = [
      { id: 'gate', kind: 'enum', summary: 'b', when: { member: 'none' }, values: ['x'] },
      { id: 'member', kind: 'state', summary: 'a', of: 'membership', absent: 'none' },
    ];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('より前に宣言されていません'))).toBe(true);
  });

  it('必須の軸(when / optional を宣言していない)が行に無ければ落とす', () => {
    const data = validData();
    data['sign_in'] = [{ id: 'row', lands: 'active', summary: 'a' }];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('member(メンバー行の状態)がありません'))).toBe(true);
  });

  it('宣言されていない鍵は綴り間違いとして落とす', () => {
    const data = validData();
    data['sign_in'] = [{ id: 'row', member: 'active', guilde: 'joined', lands: 'active', summary: 'a' }];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('guilde は書けません'))).toBe(true);
  });

  it('labels に values に無い値があれば落とす', () => {
    const data = validData();
    data['axes'] = [
      { id: 'member', kind: 'state', summary: 'a', of: 'membership', absent: 'none' },
      { id: 'gate', kind: 'enum', summary: 'b', optional: true, values: ['x'], labels: { y: 'よ' } },
    ];
    const { messages } = parse(data);
    expect(messages.some((message) => message.includes('labels に values に無い値があります'))).toBe(true);
  });
});

describe('H0: providers(受け入れるサインインの方式)と local_only', () => {
  /** local_only の 1 件。 */
  const localEntry = (method: string, reason = 'ローカルのテスト利用者が入る') => ({ method, reason });

  it('providers と local_only(方式と理由)を宣言順に読む(local_only が無ければ空)', () => {
    const data = { ...validData(), providers: ['oauth_a', 'oauth_b'], local_only: [localEntry('password_c', '統合テストの利用者')] };

    const { value, messages } = parse(data);

    expect(messages).toEqual([]);
    expect(value.providers).toEqual(['oauth_a', 'oauth_b']);
    expect(value.localOnly).toEqual([{ method: 'password_c', reason: '統合テストの利用者' }]);
    expect(parse(validData()).value.localOnly).toEqual([]);
  });

  it('providers が無ければエラー(サインインの方式を宣言しない認証フローは、開いている口の全数を言えない)', () => {
    const data = validData();
    delete data['providers'];

    const { value, messages } = parse(data);

    expect(messages).toContain('providers がありません');
    expect(value.providers).toEqual([]);
  });

  it('providers が空ならエラー', () => {
    expect(parse({ ...validData(), providers: [] }).messages).toContain('providers が空です');
  });

  it('providers がリストでなければエラー', () => {
    expect(parse({ ...validData(), providers: 'oauth_a' }).messages).toContain('providers はリストで書きます');
  });

  it('スネークケースの語でない要素は落とす(local_only の method も同じ)', () => {
    const { value, messages } = parse({ ...validData(), providers: ['oauth_a', 'OAuth-B'], local_only: [localEntry('Pass Word')] });

    expect(value.providers).toEqual(['oauth_a']);
    expect(value.localOnly).toEqual([]);
    expect(messages.filter((message) => message.includes('スネークケースの語ではありません'))).toHaveLength(2);
  });

  it('同じ語の重複は落とす', () => {
    const { value, messages } = parse({ ...validData(), providers: ['oauth_a', 'oauth_a'], local_only: [localEntry('password_c'), localEntry('password_c')] });

    expect(value.providers).toEqual(['oauth_a']);
    expect(value.localOnly).toHaveLength(1);
    expect(messages).toContain('providers の oauth_a が重複しています');
    expect(messages).toContain('local_only の password_c が重複しています');
  });

  it('providers と local_only に同じ語が載れば local_only の側を落とす(本番で開けるのか開けないのかが割れる)', () => {
    const { value, messages } = parse({ ...validData(), providers: ['oauth_a'], local_only: [localEntry('oauth_a'), localEntry('password_c')] });

    expect(value.localOnly.map((entry) => entry.method)).toEqual(['password_c']);
    expect(messages).toContain('local_only の oauth_a は providers にも載っています');
  });

  it('local_only の理由が無い / 空 / 空白だけならエラー(理由の無い免除は穴になる)', () => {
    const noReason = parse({ ...validData(), local_only: [{ method: 'password_c' }] });
    const empty = parse({ ...validData(), local_only: [localEntry('password_c', '  ')] });

    expect(noReason.messages).toContain('reason がありません');
    expect(noReason.value.localOnly).toEqual([]);
    expect(empty.messages).toContain('local_only[0] password_c の reason が空です');
    expect(empty.value.localOnly).toEqual([]);
  });

  it('local_only の要素に method が無ければ / 余分な鍵があればエラー(文字列だけの旧い書き方も通らない)', () => {
    expect(parse({ ...validData(), local_only: [{ reason: 'r' }] }).messages).toContain('method がありません');
    expect(parse({ ...validData(), local_only: [{ method: 'password_c', reason: 'r', why: 'x' }] }).messages.some((message) => message.includes('why'))).toBe(true);
    expect(parse({ ...validData(), local_only: ['password_c'] }).messages.some((message) => message.includes('local_only[0]'))).toBe(true);
  });
});

describe('H0: callback(OAuth の帰り道の口)', () => {
  it('callback を書かなければ持たない(任意。OAuth でないサインインの仕組みは書かない)', () => {
    const { value, messages } = parse(validData());

    expect(messages).toEqual([]);
    expect(value.callback).toBeUndefined();
  });

  it('endpoint と summary を読める(位置は callback)。開始とログアウトの口も同じ形で読む', () => {
    const data = validData();
    data['callback'] = { endpoint: '/api/auth/callback', summary: '帰り道' };
    data['start'] = { endpoint: '/api/auth/sign-in', summary: '開始' };
    data['logout'] = { endpoint: '/api/auth/logout', summary: 'ログアウト' };

    const { value, messages } = parse(data);

    expect(messages).toEqual([]);
    expect(value.callback).toMatchObject({ endpoint: '/api/auth/callback', summary: '帰り道', location: { file: 'docs/specs/backend/auth.md', pointer: 'callback' } });
    expect(value.start).toMatchObject({ endpoint: '/api/auth/sign-in', summary: '開始', location: { pointer: 'start' } });
    expect(value.logout).toMatchObject({ endpoint: '/api/auth/logout', summary: 'ログアウト', location: { pointer: 'logout' } });
  });

  it('ログアウトの口は control(ログアウトの操作の名前)を持てる。他の口には書けない', () => {
    const data = validData();
    data['logout'] = { endpoint: '/api/auth/logout', summary: 'ログアウト', control: 'signed_out' };

    const { value, messages } = parse(data);

    expect(messages).toEqual([]);
    expect(value.logout).toMatchObject({ control: 'signed_out' });
    expect(parse(validData()).value.logout).toBeUndefined();
    const plain = validData();
    plain['logout'] = { endpoint: '/api/auth/logout', summary: 'ログアウト' };
    expect(parse(plain).value.logout).not.toHaveProperty('control');

    const onStart = validData();
    onStart['start'] = { endpoint: '/api/auth/sign-in', summary: '開始', control: 'signed_out' };
    expect(parse(onStart).messages.some((message) => message.includes('control は書けません'))).toBe(true);
  });

  it('control がスネークケースでない・文字列でないときは違反(口ごと落とす)', () => {
    for (const control of ['Signed Out', 'signed.out', 5]) {
      const data = validData();
      data['logout'] = { endpoint: '/api/auth/logout', summary: 'ログアウト', control };

      const { value, messages } = parse(data);

      expect(messages.length, String(control)).toBeGreaterThan(0);
      expect(value.logout, String(control)).toBeUndefined();
    }
  });

  it('帰り道があるのに開始かログアウトの口が無ければ H0(セッションの cookie はスクリプトから読めないので、どちらもサーバーの口)', () => {
    const onlyCallback = validData();
    onlyCallback['callback'] = { endpoint: '/api/auth/callback', summary: '帰り道' };
    const noLogout = { ...onlyCallback, start: { endpoint: '/api/auth/sign-in', summary: '開始' } };

    const missingBoth = parse(onlyCallback).messages;
    const missingLogout = parse(noLogout).messages;

    expect(missingBoth.filter((message) => message.includes('OAuth の帰り道(callback)があるのに'))).toHaveLength(2);
    expect(missingBoth.some((message) => message.includes('サインインの開始の口'))).toBe(true);
    expect(missingLogout).toHaveLength(1);
    expect(missingLogout[0]).toContain('ログアウトの口');
  });

  it('帰り道が無ければ、開始とログアウトの口は任意(書いても読む)', () => {
    const data = validData();
    data['logout'] = { endpoint: '/api/auth/logout', summary: 'ログアウト' };

    const { value, messages } = parse(data);

    expect(messages).toEqual([]);
    expect(value.start).toBeUndefined();
    expect(value.logout?.endpoint).toBe('/api/auth/logout');
  });

  it('endpoint か summary が無ければ落とす(落とした callback は持たない)', () => {
    const noEndpoint = validData();
    noEndpoint['callback'] = { summary: '帰り道' };
    const noSummary = validData();
    noSummary['callback'] = { endpoint: '/api/auth/callback' };

    const a = parse(noEndpoint);
    const b = parse(noSummary);

    expect(a.messages.some((message) => message.includes('endpoint がありません'))).toBe(true);
    expect(b.messages.some((message) => message.includes('summary がありません'))).toBe(true);
    expect(a.value.callback).toBeUndefined();
    expect(b.value.callback).toBeUndefined();
  });

  it('マッピングでなければ落とす・宣言されていない鍵は綴り間違いとして落とす', () => {
    const notMapping = validData();
    notMapping['callback'] = '/api/auth/callback';
    const typo = validData();
    typo['callback'] = { endpoint: '/api/auth/callback', summary: 'a', endpoints: ['/x'] };

    expect(parse(notMapping).messages.some((message) => message.includes('callback はマッピングで書きます'))).toBe(true);
    expect(parse(typo).messages.some((message) => message.includes('endpoints は書けません'))).toBe(true);
    const badStart = { ...validData(), start: ['/api/auth/sign-in'], logout: { endpoint: '/api/auth/logout' } };
    const messages = parse(badStart).messages;
    expect(messages.some((message) => message.includes('start はマッピングで書きます'))).toBe(true);
    expect(messages.some((message) => message.includes('summary がありません'))).toBe(true);
  });
});

describe('H0: sessions(セッションの寿命。必須)', () => {
  /** 同時セッションの宣言(正しい形)。寿命の欄の検査で、同時セッションが邪魔をしないために混ぜる。 */
  const OK_CONCURRENT = { concurrent: { unbounded: '理由' } };

  /** sessions だけを差し替えてパースする。 */
  function withSessions(sessions: unknown): ReturnType<typeof parse> {
    const data = validData();
    data['sessions'] = sessions;
    return parse(data);
  }

  it('無操作の時間切れ・絶対の寿命・理由を読み、期間を秒に直す(位置は sessions)', () => {
    const { value, messages } = withSessions({ ...OK_CONCURRENT, inactivity: '1h30m', absolute: '1d12h', reason: '理由' });

    expect(messages).toEqual([]);
    expect(value.sessions).toMatchObject({
      inactivity: '1h30m',
      inactivitySeconds: 5400,
      absolute: '1d12h',
      absoluteSeconds: 129_600,
      reason: '理由',
      concurrent: { kind: 'unbounded', reason: '理由' },
      location: { file: 'docs/specs/backend/auth.md', pointer: 'sessions' },
    });
  });

  it('sessions を書かなければエラー(書かないとセッションが時間で終わらない既定のまま出荷される)・落とした宣言として数える', () => {
    const data = validData();
    delete data['sessions'];
    const reporter = new SpecReporter('docs/specs/backend/auth.md');
    const result = parseAuthFlow(data, reporter);

    expect(result.findings.map((finding) => finding.message)).toContain('sessions(セッションの寿命)がありません');
    expect(result.value?.sessions).toBeUndefined();
    expect(reporter.droppedCount()).toBe(1);
  });

  it('マッピングでなければ・欄が欠ければ・宣言されていない鍵があればエラー', () => {
    expect(withSessions('24h').messages).toContain('sessions はマッピングで書きます');
    const missing = withSessions({ ...OK_CONCURRENT, absolute: '24h', reason: '理由' });
    expect(missing.messages.some((message) => message.includes('inactivity がありません'))).toBe(true);
    expect(missing.value.sessions).toBeUndefined();
    expect(withSessions({ ...OK_CONCURRENT, inactivity: '8h', absolute: '24h', reason: '理由', extra: 1 }).messages.some((message) => message.includes('extra は書けません'))).toBe(true);
  });

  it('理由が無い / 空 / 空白だけならエラー(理由の無い寿命は、なぜその長さで足りるのかを誰も確かめられない)', () => {
    expect(withSessions({ ...OK_CONCURRENT, inactivity: '8h', absolute: '24h' }).messages.some((message) => message.includes('reason がありません'))).toBe(true);
    for (const reason of ['', '   ']) {
      const { value, messages } = withSessions({ ...OK_CONCURRENT, inactivity: '8h', absolute: '24h', reason });
      expect(messages.some((message) => message.includes('reason'))).toBe(true);
      expect(value.sessions).toBeUndefined();
    }
  });

  it('期間として読めない綴り・0 はエラー(日・時間・分を大きい順に)', () => {
    for (const bad of ['8 hours', '30s', 'h', '0h', '0m', '1m2h', '']) {
      const { value, messages } = withSessions({ ...OK_CONCURRENT, inactivity: bad, absolute: '24h', reason: '理由' });
      expect(messages.length, bad).toBeGreaterThan(0);
      expect(value.sessions, bad).toBeUndefined();
    }
  });

  it('無操作の時間切れが絶対の寿命より短くなければエラー(無操作の時間切れが一度も効かない宣言)', () => {
    for (const inactivity of ['24h', '1d', '2d']) {
      const { value, messages } = withSessions({ ...OK_CONCURRENT, inactivity, absolute: '24h', reason: '理由' });
      expect(messages.some((message) => message.includes('より短くありません')), inactivity).toBe(true);
      expect(value.sessions).toBeUndefined();
    }
  });
});

describe('H0: sessions.concurrent(同時に持てるセッションの数。必須)', () => {
  const BASE = { inactivity: '8h', absolute: '24h', reason: '理由' };

  /** concurrent だけを差し替えてパースする(undefined なら欄ごと無い)。 */
  function withConcurrent(concurrent: unknown): ReturnType<typeof parse> {
    const data = validData();
    data['sessions'] = concurrent === undefined ? { ...BASE } : { ...BASE, concurrent };
    return parse(data);
  }

  it('上限なし(unbounded: 理由)を読む。位置は sessions', () => {
    const { value, messages } = withConcurrent({ unbounded: '既定のまま' });

    expect(messages).toEqual([]);
    expect(value.sessions?.concurrent).toEqual({ kind: 'unbounded', reason: '既定のまま' });
  });

  it.each([
    ['ends_oldest', 1],
    ['refuses_new', 3],
  ] as const)('上限あり(on_limit %s・max %d)を読む', (onLimit, max) => {
    const { value, messages } = withConcurrent({ max, on_limit: onLimit, reason: '端末は少数' });

    expect(messages).toEqual([]);
    expect(value.sessions?.concurrent).toEqual({ kind: 'limited', max, onLimit, reason: '端末は少数' });
  });

  it.each([
    ['欄ごと無い', undefined, 'sessions.concurrent(同時に持てるセッションの数)がありません'],
    ['マッピングでない', '1', 'sessions.concurrent はマッピングで書きます'],
    ['理由が空の unbounded', { unbounded: '  ' }, 'sessions.concurrent.unbounded が空です'],
    ['max が無い', { on_limit: 'ends_oldest', reason: '理由' }, 'sessions.concurrent.max がありません'],
    ['max が 0', { max: 0, on_limit: 'ends_oldest', reason: '理由' }, '1 以上の整数ではありません'],
    ['max が小数', { max: 1.5, on_limit: 'ends_oldest', reason: '理由' }, '1 以上の整数ではありません'],
    ['max が数でない', { max: 'many', on_limit: 'ends_oldest', reason: '理由' }, 'max は数値で書きます'],
    ['on_limit が無い', { max: 2, reason: '理由' }, 'on_limit がありません'],
    ['on_limit が未知の語', { max: 2, on_limit: 'kick_all', reason: '理由' }, '宣言できる語ではありません'],
    ['上限ありで理由が無い', { max: 2, on_limit: 'ends_oldest' }, 'reason がありません'],
    ['上限ありで理由が空', { max: 2, on_limit: 'ends_oldest', reason: '' }, 'reason'],
  ])('%s はエラー(宣言を落として数える)', (_label, concurrent, expected) => {
    const { value, messages } = withConcurrent(concurrent);

    expect(messages.some((message) => message.includes(expected)), messages.join(' / ')).toBe(true);
    expect(value.sessions).toBeUndefined();
  });
});

describe('H0: sessions.concurrent の鍵の混ざり(エラーにするが、読めた分は落とさない — 宣言されていない鍵の扱いは sessions と同じ)', () => {
  it.each([
    ['unbounded と上限の欄が混ざる', { unbounded: '理由', max: 2 }, 'max は書けません'],
    ['宣言されていない鍵', { max: 2, on_limit: 'ends_oldest', reason: '理由', note: 'x' }, 'note は書けません'],
  ])('%s', (_label, concurrent, expected) => {
    const data = validData();
    data['sessions'] = { inactivity: '8h', absolute: '24h', reason: '理由', concurrent };
    const { messages } = parse(data);

    expect(messages.some((message) => message.includes(expected)), messages.join(' / ')).toBe(true);
  });
});

describe('H0: idp_session(IdP とアプリのセッションの関係。必須。支えられる主張だけ)', () => {
  const OK = { logout: 'keeps_idp', idp_ends: 'app_continues', lifetime: 'independent', reason: '理由' };

  /** idp_session だけを差し替えてパースする(undefined なら欄ごと無い)。 */
  function withIdp(idp: unknown): { readonly result: ReturnType<typeof parseAuthFlow>; readonly messages: string[] } {
    const data = validData();
    if (idp === undefined) delete data['idp_session'];
    else data['idp_session'] = idp;
    const reporter = new SpecReporter('docs/specs/backend/auth.md');
    const result = parseAuthFlow(data, reporter);
    return { result, messages: result.findings.map((finding) => finding.message) };
  }

  it('3 つの主張と理由を読む(位置は idp_session)', () => {
    const { result, messages } = withIdp(OK);

    expect(messages).toEqual([]);
    expect(result.value?.idpSession).toMatchObject({ logout: 'keeps_idp', idpEnds: 'app_continues', lifetime: 'independent', reason: '理由', location: { pointer: 'idp_session' } });
  });

  it('欄ごと無ければエラー(落とした宣言として数える)', () => {
    const data = validData();
    delete data['idp_session'];
    const reporter = new SpecReporter('docs/specs/backend/auth.md');
    const result = parseAuthFlow(data, reporter);

    expect(result.findings.map((finding) => finding.message)).toContain('idp_session(IdP とアプリのセッションの関係)がありません');
    expect(result.value?.idpSession).toBeUndefined();
    expect(reporter.droppedCount()).toBe(1);
  });

  it.each([
    ['マッピングでない', 'keeps_idp', 'idp_session はマッピングで書きます'],
    ['logout が無い', { ...OK, logout: undefined }, 'logout がありません'],
    ['idp_ends が無い', { ...OK, idp_ends: undefined }, 'idp_ends がありません'],
    ['lifetime が無い', { ...OK, lifetime: undefined }, 'lifetime がありません'],
    ['理由が無い', { ...OK, reason: undefined }, 'reason がありません'],
    ['理由が空白だけ', { ...OK, reason: '  ' }, 'idp_session.reason が空です'],
    ['未知の語(logout)', { ...OK, logout: 'whatever' }, '宣言できる語ではありません'],
    ['未知の語(idp_ends)', { ...OK, idp_ends: 'whatever' }, '宣言できる語ではありません'],
    ['未知の語(lifetime)', { ...OK, lifetime: 'whatever' }, '宣言できる語ではありません'],
  ])('%s はエラー', (_label, idp, expected) => {
    const { result, messages } = withIdp(idp);

    expect(messages.some((message) => message.includes(expected)), messages.join(' / ')).toBe(true);
    expect(result.value?.idpSession).toBeUndefined();
  });

  it('宣言されていない鍵はエラー', () => {
    const { messages } = withIdp({ ...OK, note: 'x' });

    expect(messages.some((message) => message.includes('note は書けません')), messages.join(' / ')).toBe(true);
  });

  it.each([
    ['logout', 'ends_idp'],
    ['idp_ends', 'app_ends'],
    ['lifetime', 'follows_idp'],
  ])('書ける語でも仕組みが支えられない主張(%s: %s)はエラー(書いたのに効いていない宣言を通さない)', (key, word) => {
    const { result, messages } = withIdp({ ...OK, [key]: word });

    expect(messages.some((message) => message.includes('接地できない主張です') && message.includes(word)), messages.join(' / ')).toBe(true);
    expect(result.value?.idpSession).toBeUndefined();
  });
});

describe('H0: mfa(多要素認証。必須・既定は全員に要求する)', () => {
  /** mfa だけを差し替えてパースする。 */
  function withMfa(mfa: unknown): ReturnType<typeof parse> {
    const data = validData();
    data['mfa'] = mfa;
    return parse(data);
  }

  const REQUIRE = { to: 'screen-mfa', implementation: 'impl/gate.ts::requireMfa', summary: '求める' };

  it('外す宣言を読む(理由と位置)', () => {
    const { value, messages } = withMfa({ exempt: '敷居を上げない' });

    expect(messages).toEqual([]);
    expect(value.mfa).toEqual({ kind: 'exempt', reason: '敷居を上げない', location: { file: 'docs/specs/backend/auth.md', pointer: 'mfa' } });
  });

  it('require を書かなければ全員に要求する。all / roles を読む', () => {
    expect(withMfa(REQUIRE).value.mfa).toMatchObject({ kind: 'require', scope: { kind: 'all' }, to: 'screen-mfa' });
    expect(withMfa({ ...REQUIRE, require: 'all' }).value.mfa).toMatchObject({ scope: { kind: 'all' } });
    const roles = withMfa({ ...REQUIRE, require: { roles: ['role_a', 'role_b'] } });
    expect(roles.messages).toEqual([]);
    expect(roles.value.mfa).toMatchObject({ scope: { kind: 'roles', roles: ['role_a', 'role_b'] } });
  });

  it('mfa を書かなければエラー(既定で要求するのに送り先が無い)・落とした宣言として数える', () => {
    const data = validData();
    delete data['mfa'];
    const reporter = new SpecReporter('docs/specs/backend/auth.md');
    const result = parseAuthFlow(data, reporter);

    expect(result.findings.map((finding) => finding.message).some((message) => message.startsWith('mfa(多要素認証)がありません'))).toBe(true);
    expect(result.value?.mfa).toBeUndefined();
    expect(reporter.droppedCount()).toBe(1);
  });

  it('外す理由が空 / 空白だけ / 無ければエラー(理由の無い「外す」は免除の穴になる)', () => {
    for (const exempt of ['', '  ', null]) {
      const { value, messages } = withMfa({ exempt });
      expect(messages.length, String(exempt)).toBeGreaterThan(0);
      expect(value.mfa).toBeUndefined();
    }
  });

  it('外す宣言と要求の欄は混ぜられない', () => {
    const { value, messages } = withMfa({ exempt: '理由', to: 'screen-mfa' });
    expect(messages.some((message) => message.includes('to は書けません'))).toBe(true);
    expect(value.mfa).toMatchObject({ kind: 'exempt' });
  });

  it('要求なら to / implementation / summary が要る・require の形が違えばエラー・知らない鍵はエラー', () => {
    for (const key of ['to', 'implementation', 'summary'] as const) {
      const partial: Record<string, string> = { ...REQUIRE };
      delete partial[key];
      const { value, messages } = withMfa(partial);
      expect(messages.some((message) => message.includes(`${key} がありません`)), key).toBe(true);
      expect(value.mfa).toBeUndefined();
    }
    expect(withMfa({ ...REQUIRE, require: 'staff' }).messages).toContain('mfa.require は all か roles のマッピングで書きます');
    expect(withMfa({ ...REQUIRE, require: { roles: [] } }).value.mfa).toBeUndefined();
    expect(withMfa({ ...REQUIRE, require: { role: ['a'] } }).messages.some((message) => message.includes('role は書けません'))).toBe(true);
    expect(withMfa({ ...REQUIRE, screen: 'x' }).messages.some((message) => message.includes('screen は書けません'))).toBe(true);
    expect(withMfa('exempt').messages).toContain('mfa はマッピングで書きます');
  });
});

describe('H0: logout(ログアウトの口)', () => {
  it('書かなければ持たない・endpoint と summary を読める(位置は logout)', () => {
    expect(parse(validData()).value.logout).toBeUndefined();
    const data = validData();
    data['logout'] = { endpoint: '/api/auth/logout', summary: '消去' };
    const { value, messages } = parse(data);
    expect(messages).toEqual([]);
    expect(value.logout).toMatchObject({ endpoint: '/api/auth/logout', summary: '消去', location: { file: 'docs/specs/backend/auth.md', pointer: 'logout' } });
  });

  it('マッピングでない・鍵が欠ける・宣言されていない鍵は落とす', () => {
    const notMapping = validData();
    notMapping['logout'] = '/api/auth/logout';
    const noSummary = validData();
    noSummary['logout'] = { endpoint: '/api/auth/logout' };
    const typo = validData();
    typo['logout'] = { endpoint: '/api/auth/logout', summary: 'a', method: 'GET' };
    expect(parse(notMapping).messages.some((message) => message.includes('logout はマッピングで書きます'))).toBe(true);
    expect(parse(noSummary).value.logout).toBeUndefined();
    expect(parse(typo).messages.some((message) => message.includes('method は書けません'))).toBe(true);
  });
});

describe('H0: 落とした行の数(入力の状態の「仕様を落としたか」の源。関門が欠けると到達を広く見積もる)', () => {
  /** パースして、記録器が数えた落とした行の数を返す。 */
  function dropped(data: Record<string, unknown>): number {
    const reporter = new SpecReporter('docs/specs/backend/auth.md');
    parseAuthFlow(data, reporter);
    return reporter.droppedCount();
  }

  const GATE = validData()['gates'] as Record<string, unknown>[];

  it('正しい宣言は 0', () => {
    expect(dropped(validData())).toBe(0);
  });

  it('行を落とさない error(id の固定値違い・分岐 id の重複で先の行が残る形)は数えない', () => {
    expect(dropped({ ...validData(), id: 'sign-in-flow' })).toBe(0);
    const duplicate = validData();
    duplicate['sign_in'] = [
      { id: 'dup', member: 'active', lands: 'active', summary: 'a' },
      { id: 'dup', member: 'guest', lands: 'active', summary: 'b' },
    ];
    expect(dropped(duplicate)).toBe(0);
  });

  it('読めずに落とした関門・分岐・着地・軸・callback は数える(値域の外・送り先の欠け・id の形・条件の組の衝突)', () => {
    const badGate = validData();
    badGate['gates'] = [...GATE, { ...GATE[0], id: 'redirect_without_to', to: undefined }];
    expect(dropped(badGate)).toBe(1);

    const sameCondition = validData();
    sameCondition['sign_in'] = [
      { id: 'a', member: 'guest', guild: 'joined', lands: 'active', summary: 'a' },
      { id: 'b', member: 'guest', guild: 'joined', lands: 'active', summary: 'b' },
    ];
    expect(dropped(sameCondition)).toBe(1);

    const badLanding = validData();
    badLanding['landings'] = [{ id: 'active', screen: 'screen-workshop-list', summary: '通常の入口へ' }, { id: 'Bad-Id', screen: 's', summary: 'x' }];
    expect(dropped(badLanding)).toBe(1);

    const notMapping = validData();
    notMapping['gates'] = [...GATE, 'not a mapping'];
    expect(dropped(notMapping)).toBe(1);

    const badCallback = validData();
    badCallback['callback'] = { summary: '帰り道' };
    expect(dropped(badCallback)).toBe(1);
  });

  it('読めなかった必須のリスト(gates)も 1 件と数える', () => {
    const noGates = validData();
    delete noGates['gates'];
    expect(dropped(noGates)).toBe(1);
  });
});
