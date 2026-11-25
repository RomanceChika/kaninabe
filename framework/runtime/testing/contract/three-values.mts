import { expect } from 'vitest';
import type { RunParam } from '@kaninabe/runtime/plan';
import type { Json } from '@kaninabe/runtime/ports';
import { namedArgs } from '@kaninabe/runtime/template/evaluate';
import { runCall } from './neutral.mjs';
import type { Channel, ContractDriver, ContractWorld, EncodingProbe, Scenario } from './types.mjs';

/**
 * 契約テスト ① **3 値(未指定 / null / 値)の運び方**。
 *
 * 入力の 1 欄は「送られていない(`undefined`)」「空で送られた(`null`)」「値」の 3 通りで、運び方は
 * 引数の意味(作成の `record`・編集の `patch`・最上位の値)で決まる。**どの adapter でも、DB に届く名前付き引数が
 * 同じ**であることを固定する:
 *
 * - 作成(`record`): 並べた欄を**全部**出す。送られていない欄も `null` で出す。
 * - 編集(`patch`): 送られていない欄は**鍵ごと出さない**(`null` にしない。`null` は「空にする」の意味)。
 *   `null` は `null`・値は値で出す。
 * - 最上位の値: `null` は `null` のまま(0・空文字・`false` は落ちない)。
 * - 型を迂回して `undefined` を最上位に渡しても、**`null` にならず引数ごと渡らない**(PostgREST は JSON に鍵を出さず、
 *   pg の素朴な実装は `null` にする —— この逆転が「未指定を null にする」反例の正体である)。
 *
 * 期待(`expectedArgs`)は実行器の符号化とは**別の写し**で書く(実行計画の供給元と入力から直に決める)。
 * 引数は実行器が使う `namedArgs` で組むので、実行器 → adapter → 通信路の全体が一致の対象になる。
 */

/** `namedArgs` の第 2 引数の型(実行器が持つ型で、公開の入口には出ていない)。 */
type ArgsContext = Parameters<typeof namedArgs>[1];

/** 引数を組むための文脈。 */
function contextOf(probe: EncodingProbe): ArgsContext {
  return {
    resolution: { facts: {}, actorId: probe.actorId, session: null, input: probe.input, now: '2026-01-01T00:00:00Z' },
    idempotencyKey: probe.idempotencyKey,
    actorRoles: [...probe.actorRoles],
    writeEffects: [...probe.writeEffects],
    computes: {},
  };
}

/** 入力の 1 欄を「送られていなければ `null`」にして読む。 */
function orNull(input: EncodingProbe['input'], field: string): Json {
  const value = input[field];
  return value === undefined ? null : (value as Json);
}

/** 引数 1 本の期待(供給元と入力から直に決める)。 */
function expectedArg(param: RunParam, probe: EncodingProbe): Json {
  const source = param.source;
  switch (source.kind) {
    case 'idempotency_key':
      return probe.idempotencyKey;
    case 'actor':
      return probe.actorId;
    case 'actor_roles':
      return [...probe.actorRoles];
    case 'write_effects':
      return [...probe.writeEffects];
    case 'effects':
      return [...source.effects];
    case 'next_state':
      return source.state;
    case 'event_id':
      return source.event;
    case 'input_field':
      return orNull(probe.input, source.field);
    case 'input_target_id':
      return orNull(probe.input, 'id');
    case 'input_values':
      return Object.fromEntries(source.fields.map((field) => [field, orNull(probe.input, field)]));
    case 'input_changes':
      return Object.fromEntries(source.fields.filter((field) => probe.input[field] !== undefined).map((field) => [field, orNull(probe.input, field)]));
    case 'not_written':
      return null;
    default:
      throw new Error(`3 値の確認では使えない供給元です: ${source.kind}`);
  }
}

/** DB に届くはずの名前付き引数(渡さない引数は鍵ごと無い)。 */
function expectedArgs(probe: EncodingProbe): Readonly<Record<string, Json>> {
  return Object.fromEntries(probe.params.map((param) => [param.name, expectedArg(param, probe)]));
}

/** 呼び出しを流して、通信路に出た要求を取る(結果は見ない。見るのは何が運ばれたか)。 */
async function carried(driver: ContractDriver, scenario: Scenario): Promise<Channel> {
  const channel = await driver.open('rows', scenario);
  await runCall(channel.ports, scenario.call);
  return channel;
}

/** 探りの呼び出しを、状況 `rows` で開く場面にする(期待は使わない)。 */
function scenarioOf(probe: EncodingProbe, args: Readonly<Record<string, unknown>>): Scenario {
  return {
    call: { port: 'rpc', rpc: probe.rpc, args },
    expected: { kind: 'saved', shape: 'rows', requestedEffects: [], outbox: 'unknown' },
  };
}

/** 編集の `patch` で、送られていない欄は鍵が無く・`null` は `null` で出ていること(反例の直接の確認)。 */
function expectPatchKeys(probe: EncodingProbe, sent: Readonly<Record<string, Json>>, label: string): void {
  for (const param of probe.params) {
    if (param.source.kind !== 'input_changes') continue;
    const nested = sent[param.name] as Readonly<Record<string, Json>>;
    for (const field of param.source.fields) {
      const value = probe.input[field];
      if (value === undefined) expect(Object.keys(nested), `${label}: 未変更の ${field} は鍵ごと出さない`).not.toContain(field);
      else expect(nested[field], `${label}: ${field}`).toEqual(value);
    }
  }
}

/**
 * 3 値の群を全ドライバに当てる。
 *
 * @param drivers - 当てる adapter
 * @param world - 製品が渡す世界(`probes` に作成の record と編集の patch を含むこと)
 * @returns 歩いた回数
 */
export async function contractThreeValues(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  const kinds = world.probes.flatMap((probe) => probe.params.map((param) => param.source.kind));
  expect(kinds, '作成の record を含む').toContain('input_values');
  expect(kinds, '編集の patch を含む').toContain('input_changes');
  let visits = 0;
  for (const probe of world.probes) {
    const args = namedArgs(probe.params, contextOf(probe));
    const expected = expectedArgs(probe);
    const sentBy: Readonly<Record<string, Json>>[] = [];
    for (const driver of drivers) {
      const label = `${driver.name} / ${probe.label}`;
      const channel = await carried(driver, scenarioOf(probe, args));
      expect(channel.sent().map((sent) => sent.rpc), label).toEqual([probe.rpc]);
      const sent = channel.sent()[0]?.args ?? {};
      expect(sent, `${label}: DB に届く名前付き引数`).toStrictEqual(expected);
      expectPatchKeys(probe, sent, label);
      sentBy.push(sent);
      visits += 1;
    }
    const [first, ...rest] = sentBy;
    for (const other of rest) expect(JSON.stringify(other), `${probe.label}: adapter 同士で引数が同じ`).toBe(JSON.stringify(first));
  }
  return visits + (await undefinedTopLevel(drivers, world));
}

/** 型を迂回して最上位に `undefined` を渡しても、`null` にならず引数ごと渡らない。 */
async function undefinedTopLevel(drivers: readonly ContractDriver[], world: ContractWorld): Promise<number> {
  const probe = world.probes[0];
  if (probe === undefined) return 0;
  const args = namedArgs(probe.params, contextOf(probe));
  const names = Object.keys(args);
  const dropped = names[names.length - 1] ?? '';
  let visits = 0;
  for (const driver of drivers) {
    const channel = await carried(driver, scenarioOf(probe, { ...args, [dropped]: undefined }));
    const sent = channel.sent()[0]?.args ?? {};
    expect(Object.keys(sent).sort(), `${driver.name}: undefined の ${dropped} は null にならず渡さない`).toEqual(names.filter((name) => name !== dropped).sort());
    visits += 1;
  }
  return visits;
}
