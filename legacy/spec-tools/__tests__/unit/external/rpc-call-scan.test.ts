/**
 * RPC の呼び出しの走査(`rpc-call-scan.ts`)のテスト。`.rpc('<名前>', …)` の第 1 引数が文字列の字句のものだけを数える。
 */

import { describe, expect, it } from 'vitest';
import { sourceCallsRpc } from '../../../lib/external/rpc-call-scan.js';

describe('sourceCallsRpc', () => {
  // 正例の表: [題, ソース]
  const FOUND: readonly (readonly [string, string])[] = [
    ['client.rpc の文字列', "await client.rpc('consume_quota', { p: 1 });"],
    ['置換のないテンプレート', 'await client.rpc(`consume_quota`);'],
    ['入れ子の呼び出しの中', "export function f(c) { return () => c.from('x').rpc('consume_quota'); }"],
  ];

  it.each(FOUND)('呼んでいる: %s', (_title, source) => {
    expect(sourceCallsRpc('a.ts', source, 'consume_quota')).toBe(true);
  });

  // 負例の表: [題, ソース]
  const MISSING: readonly (readonly [string, string])[] = [
    ['別の名前の RPC', "client.rpc('other_fn');"],
    ['名前の前方一致', "client.rpc('consume_quota_v2');"],
    ['変数の名前', 'client.rpc(name);'],
    ['算出した名前', "client.rpc(`consume_${suffix}`);"],
    ['引数が無い', 'client.rpc();'],
    ['メソッドでない(関数 rpc)', "rpc('consume_quota');"],
    ['rpc 以外のメソッド', "client.call('consume_quota');"],
    ['コメントと文字列の中', "// client.rpc('consume_quota')\nconst s = \"client.rpc('consume_quota')\";"],
  ];

  it.each(MISSING)('呼んでいない: %s', (_title, source) => {
    expect(sourceCallsRpc('a.ts', source, 'consume_quota')).toBe(false);
  });

  it('名前が空なら何も呼んでいない扱い', () => {
    expect(sourceCallsRpc('a.ts', "client.rpc('');", '')).toBe(false);
  });
});
