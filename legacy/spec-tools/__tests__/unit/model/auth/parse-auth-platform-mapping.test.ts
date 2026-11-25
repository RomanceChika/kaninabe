/**
 * H0(auth_spec のスキーマ適合)のうち、`platform_ops` の**配線先との明示の対応表**の読み取りのテスト(束 B)。
 *
 * 規約網羅:
 *   - `binding.params`: スカラー 1 つ(`name` / `arg` / `type` / `optional`)とオブジェクト(`props` ごとに引数へ対応)の 2 形・型の値域・識別子
 *   - `binding.result`: スカラーの型の語か `{ rows: 行の型名 }`。省略は読める(無いことは H9 が拒む)
 *   - `platform_ports`: 結果の union の判別の欄・失敗の理由と文言(空にできない)・行の型(型・`?` で null)
 *   - `shapes`: `{ row, fields: {欄: 行のプロパティ}, labels, formats }`(対応表)と、旧い `fields: [欄, …]` の形(対応表なし)
 *   - 引数の `skip_if` / `format: uuid`
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseAuthFlow } from '../../../../lib/model/auth/parse-auth.js';
import type { AuthFlowSpec } from '../../../../lib/model/auth/types.js';

/** 最小の正しいフロントマター(platform_ops は差し替える)。 */
function baseData(): Record<string, unknown> {
  return {
    doc_type: 'auth_spec',
    id: 'auth-flow',
    subject: 'membership',
    providers: ['oauth_a'],
    sessions: { inactivity: '8h', absolute: '24h', reason: '確かめた理由', concurrent: { unbounded: '既定のまま' } },
    idp_session: { logout: 'keeps_idp', idp_ends: 'app_continues', lifetime: 'independent', reason: '確かめた理由' },
    mfa: { exempt: '外す理由' },
    axes: [{ id: 'member', kind: 'state', summary: 'メンバー行の状態', of: 'membership', absent: 'none' }],
    landings: [{ id: 'active', screen: 'screen-home', summary: '通常の入口へ' }],
    sign_in: [{ id: 'member_active', member: 'active', lands: 'active', summary: '通す' }],
    gates: [],
    test_cases: [{ id: 'TC-AUTH-SIGNIN-001', type: 'unit', covers: ['success'], spec_ids: ['auth-flow'], implementation: 'legacy/spec-tools/__tests__/unit/model/auth/parse-auth.test.ts::x' }],
  };
}

const PORT = { result: { type: 'R', ok: 'ok', value: 'value', reason: 'reason' }, refusals: { unauthenticated: 'ログインしてください' }, rows: { Row: { id: 'string', lastActiveAt: 'string?', current: 'boolean', count: 'number' } } };

/** 本人の読み 1 本 + 終了 1 本 + ロールの操作 1 本の宣言(対応表つき)。 */
function data(patch: { readonly binding?: Record<string, unknown>; readonly arg?: Record<string, unknown>; readonly ports?: unknown; readonly shapes?: unknown } = {}): Record<string, unknown> {
  return {
    ...baseData(),
    platform_ops: [
      { id: 'session.list_mine', label: '一覧', kind: 'read', actor: { self: true }, returns: 'session_summary', binding: { port: 'P', method: 'list', result: { rows: 'Row' } } },
      {
        id: 'session.end_mine',
        label: '終える',
        kind: 'do',
        actor: { self: true },
        args: { session_id: patch.arg ?? { from: 'row', of: 'session.list_mine', field: 'id', skip_if: 'is_current', format: 'uuid' } },
        confirm: false,
        binding: patch.binding ?? { port: 'P', method: 'end', params: [{ name: 'sessionId', arg: 'session_id', type: 'string' }], result: 'boolean' },
      },
      {
        id: 'session.end_every',
        label: '全員',
        kind: 'do',
        actor: { role: 'staff' },
        args: { keep_self: { type: 'bool', default: true } },
        confirm: true,
        binding: { port: 'P', method: 'every', params: [{ name: 'options', optional: true, props: { keepSelf: { arg: 'keep_self', type: 'boolean', optional: true } } }], result: 'number' },
      },
    ],
    platform_ports: patch.ports ?? { P: PORT },
    shapes: patch.shapes ?? { session_summary: { row: 'Row', fields: { id: 'id', last_used_at: 'lastActiveAt', is_current: 'current' }, labels: { last_used_at: '最後に使った日時' }, formats: { last_used_at: 'datetime' } } },
    secret_field_words: ['token'],
  };
}

function parse(input: Record<string, unknown>): { value: AuthFlowSpec; messages: readonly string[] } {
  const reporter = new SpecReporter('docs/specs/backend/auth.md');
  const result = parseAuthFlow(input, reporter);
  if (result.value === null) throw new Error('パーサーが値を返しませんでした');
  return { value: result.value, messages: result.findings.map((finding) => finding.message) };
}

describe('H0: platform_ops の配線先との対応表の読み取り', () => {
  it('設計どおりの対応表(位置の引数・オブジェクトの引数・行の配列・ポート・shapes・skip_if・format)を読める', () => {
    const { value, messages } = parse(data());

    expect(messages).toEqual([]);
    const ops = value.platformOps?.ops ?? [];
    expect(ops[0]?.binding.result).toEqual({ kind: 'rows', row: 'Row' });
    expect(ops[1]?.binding.params).toMatchObject([{ kind: 'scalar', name: 'sessionId', map: { arg: 'session_id', type: 'string', optional: false } }]);
    expect(ops[1]?.binding.result).toEqual({ kind: 'scalar', type: 'boolean' });
    expect(ops[1]?.args[0]).toMatchObject({ kind: 'row', skipIf: 'is_current', format: 'uuid' });
    expect(ops[2]?.binding.params).toMatchObject([{ kind: 'object', name: 'options', optional: true, props: [{ prop: 'keepSelf', arg: 'keep_self', type: 'boolean', optional: true }] }]);
    expect(value.platformOps?.ports[0]).toMatchObject({
      name: 'P',
      union: { type: 'R', ok: 'ok', value: 'value', reason: 'reason' },
      refusals: [{ reason: 'unauthenticated', message: 'ログインしてください' }],
      rows: [{ name: 'Row', props: [{ name: 'id', type: 'string', nullable: false }, { name: 'lastActiveAt', type: 'string', nullable: true }, { name: 'current', type: 'boolean', nullable: false }, { name: 'count', type: 'number', nullable: false }] }],
    });
    expect(value.platformOps?.shapes[0]).toMatchObject({
      name: 'session_summary',
      row: 'Row',
      fields: ['id', 'last_used_at', 'is_current'],
      mapping: [{ field: 'id', from: 'id' }, { field: 'last_used_at', from: 'lastActiveAt' }, { field: 'is_current', from: 'current' }],
      labels: [{ field: 'last_used_at', label: '最後に使った日時' }],
      formats: [{ field: 'last_used_at', format: 'datetime' }],
    });
  });

  it('params / result / platform_ports を書かない宣言も読める(対応表が無いことは H9 が拒む)', () => {
    const input = data({ binding: { port: 'P', method: 'end' }, ports: undefined });
    delete input['platform_ports'];
    const { value, messages } = parse(input);

    expect(messages).toEqual([]);
    expect(value.platformOps?.ops[1]?.binding).toEqual({ port: 'P', method: 'end', params: [] });
    expect(value.platformOps?.ports).toEqual([]);
  });

  it('旧い shapes の形(fields: [欄, …])は対応表なしとして読める', () => {
    const { value, messages } = parse(data({ shapes: { session_summary: { fields: ['id', 'ip'] } } }));

    expect(messages).toEqual([]);
    expect(value.platformOps?.shapes[0]).toEqual(expect.objectContaining({ fields: ['id', 'ip'] }));
    expect(value.platformOps?.shapes[0]?.mapping).toBeUndefined();
  });

  const negatives: readonly { readonly name: string; readonly input: Record<string, unknown>; readonly expected: string }[] = [
    { name: 'binding に未知のキー', input: data({ binding: { port: 'P', method: 'end', param: [] } }), expected: 'param は書けません' },
    { name: 'params の type が値域外', input: data({ binding: { port: 'P', method: 'end', params: [{ name: 'a', arg: 'session_id', type: 'int' }] } }), expected: 'type int は書ける型ではありません' },
    { name: 'params の要素がマッピングでない', input: data({ binding: { port: 'P', method: 'end', params: ['sessionId'] } }), expected: 'マッピングで書きます' },
    { name: 'params の arg がスネークケースでない', input: data({ binding: { port: 'P', method: 'end', params: [{ name: 'a', arg: 'sessionId', type: 'string' }] } }), expected: 'arg sessionId がスネークケースではありません' },
    { name: 'params の引数名が識別子でない', input: data({ binding: { port: 'P', method: 'end', params: [{ name: 'a-b', arg: 'session_id', type: 'string' }] } }), expected: '識別子ではありません' },
    { name: 'オブジェクトの引数の props が空のマッピングでない', input: data({ binding: { port: 'P', method: 'end', params: [{ name: 'o', props: 'x' }] } }), expected: 'props はマッピングで書きます' },
    { name: 'result が値域外の型', input: data({ binding: { port: 'P', method: 'end', result: 'float' } }), expected: 'result float は書ける型ではありません' },
    { name: 'result の rows が識別子でない', input: data({ binding: { port: 'P', method: 'list', result: { rows: 'a b' } } }), expected: 'rows a b が識別子ではありません' },
    { name: 'result に未知のキー', input: data({ binding: { port: 'P', method: 'list', result: { row: 'Row' } } }), expected: 'row は書けません' },
    { name: 'platform_ports の refusals が空', input: data({ ports: { P: { ...PORT, refusals: {} } } }), expected: '空にできません' },
    { name: 'platform_ports の理由がスネークケースでない', input: data({ ports: { P: { ...PORT, refusals: { NotSnake: 'x' } } } }), expected: 'スネークケースの理由に空でない文言' },
    { name: 'platform_ports の result の欄が無い', input: data({ ports: { P: { ...PORT, result: { type: 'R', ok: 'ok', value: 'value' } } } }), expected: 'reason がありません' },
    { name: 'platform_ports の行の型の型指定が値域外', input: data({ ports: { P: { ...PORT, rows: { Row: { id: 'uuid' } } } } }), expected: 'プロパティ id の型が書けない語です' },
    { name: 'platform_ports のポート名が識別子でない', input: data({ ports: { 'P-1': PORT } }), expected: 'ポート名 P-1 が識別子ではありません' },
    { name: 'shapes のマッピングに row が無い', input: data({ shapes: { session_summary: { fields: { id: 'id' } } } }), expected: 'row がありません' },
    { name: 'shapes の対応先が識別子でない', input: data({ shapes: { session_summary: { row: 'Row', fields: { id: 'a b' } } } }), expected: '行のプロパティ名(識別子)' },
    { name: 'shapes の formats が値域外', input: data({ shapes: { session_summary: { row: 'Row', fields: { id: 'id' }, formats: { id: 'currency' } } } }), expected: '整形 currency は書けません' },
    { name: 'shapes の labels が空の文言', input: data({ shapes: { session_summary: { row: 'Row', fields: { id: 'id' }, labels: { id: '' } } } }), expected: 'labels の id は空でない文字列' },
    { name: '引数の format が uuid 以外', input: data({ arg: { from: 'row', of: 'session.list_mine', field: 'id', format: 'ulid' } }), expected: 'format ulid は書けません' },
    { name: 'platform_ports だけで platform_ops が無い', input: (() => { const d = data(); delete d['platform_ops']; return d; })(), expected: 'platform_ops がありません' },
  ];

  it.each(negatives)('$name はエラー', ({ input, expected }) => {
    expect(parse(input).messages.some((message) => message.includes(expected)), parse(input).messages.join('\n')).toBe(true);
  });
});
