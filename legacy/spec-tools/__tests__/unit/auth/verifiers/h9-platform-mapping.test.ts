/**
 * H9(プラットフォーム操作の宣言)のうち、**宣言した引数・返す欄と配線先の ABI との明示の対応表**の整合のテスト(束 B)。
 *
 * 規約網羅(外部レビュー の設計レビュー: 引数と戻り値の欄ごとの対応。型・null の有無・配列・結果の union を含む):
 *   - 配線先のポートが `platform_ports` に宣言されている
 *   - 宣言した引数ごとに、配線先の引数(かオブジェクトのプロパティ)がちょうど 1 つ —— 未対応・余剰・重複・型の食い違い・引数名の重複
 *   - `result` がある・read は行の配列で行の型が shape の row と一致・do はスカラー
 *   - 返す欄の対応表がある(欄ごとに行のプロパティが実在・同じプロパティを 2 つの欄に対応させない)・秘密の語を対応先にも使わない
 *   - 識別子の欄は行の null にならない string・`skip_if` は行の null にならない boolean
 *   - 設計どおりの宣言は違反なし
 */

import { describe, expect, it } from 'vitest';
import { verifyPlatformMapping } from '../../../../lib/auth/verifiers/h9-platform-mapping.js';
import type { AuthPlatformOps, PlatformOpDecl, PlatformPortDecl, PlatformShape } from '../../../../lib/model/auth/platform-ops.js';
import { platformOp, platformOpsSection, platformPort, platformShape, rowArg, typedArg } from '../../../helpers/auth-builder.js';
import { designSection } from '../../../helpers/platform-ops-fixture.js';
import { loc } from '../../../helpers/model-builder.js';

const LIST = platformOp('session.list_mine', { kind: 'read' });
const END = platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_mine', 'id')] });

/** ポートの行の型のプロパティを差し替えたポート。 */
function withRow(port: PlatformPortDecl, edit: (props: PlatformPortDecl['rows'][number]['props']) => PlatformPortDecl['rows'][number]['props']): PlatformPortDecl {
  return { ...port, rows: port.rows.map((row) => ({ ...row, props: edit(row.props) })) };
}

function messages(section: AuthPlatformOps): string[] {
  return verifyPlatformMapping(section).map((finding) => finding.message);
}

describe('H9 の対応表の整合', () => {
  it('設計どおりの宣言(位置の引数・オブジェクトの引数・行の配列・見出しと整形)は違反なし', () => {
    expect(verifyPlatformMapping(designSection())).toEqual([]);
  });

  it('既定の宣言(builder が対応表を導く)は違反なし', () => {
    expect(verifyPlatformMapping(platformOpsSection([LIST, END]))).toEqual([]);
  });

  const param = (name: string, arg: string, type: 'string' | 'boolean' | 'number' = 'string'): PlatformOpDecl['binding']['params'][number] => ({
    kind: 'scalar',
    name,
    map: { arg, type, optional: false },
    location: loc('docs/specs/backend/auth.md', 'p'),
  });
  const bind = (params: PlatformOpDecl['binding']['params'], result: PlatformOpDecl['binding']['result'] | 'none' = { kind: 'scalar', type: 'boolean' }): PlatformOpDecl['binding'] => ({ port: 'SessionManagement', method: 'endMySession', params, ...(result === 'none' ? {} : { result }) });
  const endWith = (binding: PlatformOpDecl['binding']): AuthPlatformOps => platformOpsSection([LIST, platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_mine', 'id')], binding })]);

  const negatives: readonly { readonly name: string; readonly section: AuthPlatformOps; readonly expected: string }[] = [
    { name: '宣言の無いポートへ配線した', section: platformOpsSection([LIST, END], { ports: [] }), expected: 'ポート SessionManagement が platform_ports に宣言されていません' },
    { name: '宣言した引数の対応先が無い(未対応)', section: endWith(bind([])), expected: '引数 session_id の対応先が、配線先の引数にありません(未対応)' },
    { name: '宣言に無い引数を指す(余剰)', section: endWith(bind([param('sessionId', 'session_id'), param('extra', 'nope')])), expected: '宣言に無い引数 nope を指しています(余剰)' },
    { name: '同じ引数を 2 つの配線先の引数に対応させた(重複)', section: endWith(bind([param('a', 'session_id'), param('b', 'session_id')])), expected: '配線先の複数の引数に対応しています' },
    { name: '配線先の引数名が重複した', section: endWith(bind([param('a', 'session_id'), param('a', 'session_id')])), expected: '配線先の引数名 a が重複しています' },
    { name: '識別子を number に対応させた(型の食い違い)', section: endWith(bind([param('sessionId', 'session_id', 'number')])), expected: '型が配線先と食い違います' },
    {
      name: '真偽値の入力を string に対応させた',
      section: platformOpsSection([platformOp('session.end_every', { actor: { kind: 'role', role: 'staff', activeMember: true }, confirm: true, args: [typedArg('keep_self', 'bool', true)], binding: bind([param('keepSelf', 'keep_self', 'string')]) })]),
      expected: '型が配線先と食い違います',
    },
    { name: 'result が無い', section: endWith(bind([param('sessionId', 'session_id')], 'none')), expected: 'binding.result がありません' },
    { name: 'do の result が行の配列', section: endWith(bind([param('sessionId', 'session_id')], { kind: 'rows', row: 'SessionSummary' })), expected: 'kind: do なのに result が行の配列です' },
    { name: 'read の result がスカラー', section: platformOpsSection([platformOp('session.list_mine', { kind: 'read', binding: bind([], { kind: 'scalar', type: 'number' }) })]), expected: '行の配列ではありません' },
    { name: 'read の行の型がポートの rows に無い', section: platformOpsSection([platformOp('session.list_mine', { kind: 'read', binding: bind([], { kind: 'rows', row: 'Ghost' }) })]), expected: '行の型 Ghost が、ポート SessionManagement の rows にありません' },
    { name: 'result の行の型と shape の row が違う', section: platformOpsSection([LIST], { shapes: [{ ...platformShape('session_summary', ['id']), row: 'Other' }] }), expected: 'result の行の型 SessionSummary と、shape session_summary の row Other が食い違います' },
    { name: '返す欄の対応表が無い(欄名だけの形)', section: platformOpsSection([LIST], { shapes: [platformShape('session_summary', ['id'], { mapped: false })] }), expected: '対応表がありません' },
    { name: '欄の対応先が行に無い', section: platformOpsSection([LIST], { shapes: [platformShape('session_summary', ['id', 'last_used_at'], { mapping: { last_used_at: 'noSuchProp' } })], ports: [platformPort('SessionManagement', [platformShape('session_summary', ['id', 'last_used_at'])])] }), expected: '欄 last_used_at の対応先 noSuchProp が、行の型 SessionSummary にありません' },
    { name: '同じ行のプロパティを 2 つの欄に対応させた(重複)', section: platformOpsSection([LIST], { shapes: [platformShape('session_summary', ['id', 'created_at'], { mapping: { created_at: 'id' } })] }), expected: '同じ行のプロパティ id に対応しています(重複)' },
    { name: '欄名は無害でも、対応先の行のプロパティに秘密の語がある', section: platformOpsSection([LIST], { shapes: [platformShape('session_summary', ['id', 'ip'], { mapping: { ip: 'refreshAddress' } })] }), expected: '対応先 refreshAddress は秘密を指す語 refresh を含みます' },
    { name: '識別子の欄が行の null になりうる string', section: platformOpsSection([LIST, END], { ports: [withRow(platformPort('SessionManagement', [platformShape('session_summary', ['id', 'created_at', 'last_used_at', 'user_agent', 'ip', 'is_current'])]), (props) => props.map((prop) => (prop.name === 'id' ? { ...prop, nullable: true } : prop)))] }), expected: '識別子の欄 id が、行のプロパティ id(string・null がありうる)に対応しています' },
    { name: '識別子の欄が number', section: platformOpsSection([LIST, END], { ports: [withRow(platformPort('SessionManagement', [platformShape('session_summary', ['id', 'created_at', 'last_used_at', 'user_agent', 'ip', 'is_current'])]), (props) => props.map((prop) => (prop.name === 'id' ? { ...prop, type: 'number' as const } : prop)))] }), expected: '行のプロパティ id(number)に対応しています' },
    { name: 'skip_if が boolean でない欄', section: platformOpsSection([LIST, platformOp('session.end_mine', { args: [rowArg('session_id', 'session.list_mine', 'id', { skipIf: 'user_agent' })] })]), expected: 'skip_if user_agent が、出どころ session.list_mine の行の null にならない真偽値の欄ではありません' },
    { name: 'labels の鍵が shape の欄に無い', section: platformOpsSection([LIST], { shapes: [{ ...platformShape('session_summary', ['id']), labels: [{ field: 'ghost', label: '幽霊' }] }] }), expected: 'labels の ghost が、shape の欄にありません' },
    { name: 'datetime の整形を string でない欄に書いた', section: platformOpsSection([LIST], { shapes: [{ ...platformShape('session_summary', ['id', 'is_current']), formats: [{ field: 'is_current', format: 'datetime' }] }], ports: [platformPort('SessionManagement', [platformShape('session_summary', ['id', 'is_current'])], { isCurrent: 'boolean' })] }), expected: '整形 datetime は、string の欄にだけ書けます' },
  ];

  it.each(negatives)('$name はエラー', ({ section, expected }) => {
    const findings = verifyPlatformMapping(section);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.verifier === 'H9' && finding.severity === 'error')).toBe(true);
    expect(messages(section).some((message) => message.includes(expected)), messages(section).join('\n')).toBe(true);
  });

  it('対応表の無い shape は、読みの操作が使っていなければ見ない(未使用の shape の欄名は別の検査が見る)', () => {
    const unused: PlatformShape = platformShape('unused', ['client_secret'], { mapped: false });

    expect(verifyPlatformMapping(platformOpsSection([LIST], { shapes: [platformShape('session_summary', ['id']), unused] }))).toEqual([]);
  });
});
