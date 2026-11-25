/**
 * R5-7 / R5-8 **有料の口の濫用の歯止めの宣言**(external_spec の `spend: paid` と `abuse`。設計は
 * 凍結案 r5-abuse-freeze.md §2-2・§3。`r5-abuse.ts` の未ログインの作成と対の、有料の口の側)。
 *
 * ブラウザから叩ける口(`endpoints`)がお金を使う連携(`spend: paid`)を呼ぶとき、1 回の入力が巨大でも・回数に枠が無くても、
 * 費用が際限なく膨らむ。この検査は、その口に**入力の上限と回数の枠の宣言**があることを見る。
 *
 * | 条件(error) | 位置 |
 * |---|---|
 * | R5-7 `spend: paid` かつ `endpoints` のある連携で、`abuse.max_body_bytes` が `endpoints` の全部に無い・`endpoints` に無い口の上限がある・`abuse.quota` が無い・枠の `per` が 366 日超 / `max` が不正・`quota.source` の config の id が実在しない(config カタログが無いのに `source` を書いた場合も) | 連携の行 |
 * | R5-7(続き)`spend: paid` かつ `endpoints` のある連携で、`meter`(枠を消費する RPC)が無い・data_table の `kind: rpc` の関数に実在しない・`authz`(認可)が無い・`authz.kind: public`(有料の口を誰にでも開く)・`authz.role` が立てられる役でない(役の台帳に無い・文脈依存・内部実行・未ログインにも立つ・実行者の行の条件 `claim` が無い) | 連携の行 |
 * | R5-8 `spend` / `abuse` / `meter` / `authz` を、`direction: inbound` の行・`endpoints` の無い行に書いた(効かない宣言)。`abuse` / `meter` / `authz` を `spend: paid` なしで書いた(何の口の歯止めか決まらない) | 連携の行 |
 *
 * **これは宣言の検査である。** 宣言した上限・役・RPC を口が実際に使っているか(本文を読む前に上限で落とし、課金の前に枠を消費しているか)は
 * X8(`external/verifiers/x8-paid-entry.ts`)が構文木で見る。値の妥当性(上限をいくつにするか)は見ない —— 製品が決める。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない**(連携 ID・口の URL・config の id は仕様から引く)。
 */

import type { Finding } from '../../kernel/finding.js';
import { makeFinding } from '../../kernel/finding.js';
import { inputValue, type CatalogInput } from '../../kernel/input-state.js';
import type { ConfigCatalogSpec } from '../../model/config/types.js';
import type { ExternalCatalogSpec, IntegrationDecl } from '../../model/external/types.js';
import { windowProblems } from '../../model/abuse-clock.js';
import { paidRolePlan } from '../../model/paid-authz.js';
import type { RoleDef } from '../../model/types.js';

/** この検査の ID(`r5-abuse.ts` と同じ群の 7・8 番)。 */
const VERIFIER_ID = 'R5';

/** 有料の口の検査の材料(外部連携カタログと、`quota.source` の接地先の config カタログ、`meter` と `authz.role` の接地先)。 */
export interface PaidInput {
  /** 読み込み済みの外部連携カタログ(無ければ見ない)。 */
  readonly external: ExternalCatalogSpec | undefined;
  /** config カタログ(入力の状態のまま。読込済みなら `source` の実在を見て、未選択なら接地先が無いと言い、阻害なら見ない)。 */
  readonly config: CatalogInput<ConfigCatalogSpec> | undefined;
  /** 役の台帳の全ロール(`authz.role` を引く。無ければ役を見ない)。 */
  readonly roles?: readonly RoleDef[] | undefined;
  /** テーブル仕様の `kind: rpc` の関数の名前(`meter` の実在を引く。テーブル仕様が読めていなければ undefined = 実在を見ない)。 */
  readonly rpcNames?: ReadonlySet<string> | undefined;
}

/** 執行を誰が見るか、という断り(R5-7 の直し方に必ず添える)。 */
const NOT_ENFORCEMENT =
  '宣言した上限・役・RPC を口が実際に使っているか(本文を読む前に上限で落とし、課金の前に枠を消費しているか)は X8 が構文木で見ます';

/** 口(URL)を持つ送信の連携の口の一覧(受信・口の無い行は空)。 */
function endpointsOf(integration: IntegrationDecl): readonly string[] {
  return integration.direction === 'outbound' ? (integration.endpoints ?? []) : [];
}

/** `quota.source` の接地の指摘(読み込み済みなら実在、未選択なら接地先なし。阻害は見ない)。 */
function sourceProblems(source: string, config: CatalogInput<ConfigCatalogSpec> | undefined): string[] {
  if (config === undefined || config.state === 'blocked') return [];
  if (config.state === 'unselected') {
    return [`quota.source="${source}" を接地する config カタログがありません(config を使わない製品は source でなく max: n で枠の数を書く)`];
  }
  const variables = inputValue(config)?.variables ?? [];
  return variables.some((variable) => variable.id === source) ? [] : [`quota.source="${source}" は config カタログに実在しません`];
}

/** 口ごとの本文の上限と回数の枠(`abuse`)の指摘。 */
function abuseProblems(integration: IntegrationDecl, config: CatalogInput<ConfigCatalogSpec> | undefined): string[] {
  const abuse = integration.abuse;
  const endpoints = endpointsOf(integration);
  if (abuse === undefined) {
    return ['abuse がありません(口ごとの本文の上限 max_body_bytes と、回数の枠 quota が要ります)'];
  }
  const problems: string[] = [];
  const missing = endpoints.filter((endpoint) => abuse.maxBodyBytes[endpoint] === undefined);
  if (missing.length > 0) problems.push(`abuse.max_body_bytes に口の上限がありません: ${missing.join(', ')}`);
  const stray = Object.keys(abuse.maxBodyBytes).filter((endpoint) => !endpoints.includes(endpoint));
  if (stray.length > 0) problems.push(`abuse.max_body_bytes に endpoints に無い口があります: ${stray.join(', ')}`);
  const quota = abuse.quota;
  if (quota === undefined) {
    problems.push('abuse.quota(回数の枠)がありません');
    return problems;
  }
  problems.push(...windowProblems('quota', { max: quota.max ?? 1, per: quota.per }));
  if (quota.source !== undefined) problems.push(...sourceProblems(quota.source, config));
  return problems;
}

/** `meter`(枠を消費する RPC)の指摘(テーブル仕様が読めていなければ実在は見ない)。 */
function meterProblems(integration: IntegrationDecl, rpcNames: ReadonlySet<string> | undefined): string[] {
  const meter = integration.meter;
  if (meter === undefined) return ['meter(枠を消費する RPC の名前)がありません'];
  if (rpcNames === undefined) return [];
  return rpcNames.has(meter) ? [] : [`meter="${meter}" は data_table の kind: rpc の関数に実在しません`];
}

/** `authz`(認可)の指摘(役の台帳が無ければ役は見ない)。 */
function authzProblems(integration: IntegrationDecl, roles: readonly RoleDef[] | undefined): string[] {
  const authz = integration.authz;
  if (authz === undefined) return ['authz(認可: { kind: role, role: {役の ID} })がありません'];
  if (authz.kind === 'public' || authz.role === undefined) {
    return ['authz.kind: public は有料の口に書けません(誰にでも開いた口が、呼び出しごとにお金を使います。宣言した役を持つ実行者だけに閉じる)'];
  }
  return roles === undefined ? [] : [...paidRolePlan(roles, authz.role).problems];
}

/** 有料の口(R5-7)の指摘の並び(無ければ空)。 */
function paidProblems(integration: IntegrationDecl, input: PaidInput): string[] {
  return [
    ...abuseProblems(integration, input.config),
    ...meterProblems(integration, input.rpcNames),
    ...authzProblems(integration, input.roles),
  ];
}

/** R5-7: 有料の口の宣言が揃っていない。 */
function incompletePaid(integration: IntegrationDecl, problems: readonly string[]): Finding {
  return makeFinding(VERIFIER_ID, {
    message:
      `連携 ${integration.id} は spend: paid の口(${endpointsOf(integration).join(', ')})ですが、濫用の歯止めの宣言が揃っていません` +
      `(1 回の入力が巨大でも・回数に枠が無くても・誰でも叩けても、費用が際限なく膨らみます): ${problems.join(' / ')}`,
    location: integration.location,
    suggestion:
      'abuse: { max_body_bytes: { {口の URL}: {バイト数}, ... }(endpoints の全部), quota: { source: {config の id} か max: n, per: "1 day", key: actor } } と、' +
      'meter: {枠を消費する RPC の名前}、authz: { kind: role, role: {実行者の行の条件を持つグローバルロールの ID} } を書く。' +
      `値の大きさは製品が決められます。${NOT_ENFORCEMENT}`,
    counterexample: { integration: integration.id, problems: problems.join(' / ') },
  });
}

/** R5-8: 効かない場所の `spend` / `abuse` / `meter` / `authz`。 */
function strayPaid(integration: IntegrationDecl, reason: string): Finding {
  const written = [
    integration.spend === undefined ? null : 'spend',
    integration.abuse === undefined ? null : 'abuse',
    integration.meter === undefined ? null : 'meter',
    integration.authz === undefined ? null : 'authz',
  ].filter((word): word is string => word !== null);
  return makeFinding(VERIFIER_ID, {
    message: `連携 ${integration.id} に ${written.join(' / ')} がありますが、${reason}(効く先の無い宣言です)`,
    location: integration.location,
    suggestion:
      '"spend: paid" と "abuse" / "meter" / "authz" は、ブラウザから叩かれる口(endpoints)を持つ送信の連携にだけ書ける。abuse・meter・authz は spend: paid と対で書く。効かない側を消す' +
      `(受信の口の本文の上限は max_body_bytes の欄。${NOT_ENFORCEMENT})`,
    counterexample: { integration: integration.id, reason },
  });
}

/** 連携 1 件の指摘。 */
function integrationFindings(integration: IntegrationDecl, input: PaidInput): Finding[] {
  const written = [integration.spend, integration.abuse, integration.meter, integration.authz].some((value) => value !== undefined);
  if (!written) return [];
  if (integration.direction === 'inbound') return [strayPaid(integration, '受信の連携です(受信の口は生成物で、有料の口ではありません)')];
  if (endpointsOf(integration).length === 0) return [strayPaid(integration, 'endpoints(ブラウザから叩かれる口)がありません')];
  if (integration.spend === undefined) return [strayPaid(integration, 'spend: paid がありません(何の口の歯止めか決まりません)')];
  const problems = paidProblems(integration, input);
  return problems.length === 0 ? [] : [incompletePaid(integration, problems)];
}

/**
 * 有料の口(R5-7)と効かない宣言(R5-8)を見る。
 *
 * @param input 外部連携カタログ・config カタログ・役の台帳・テーブル仕様(外部連携が無ければ何も見ない)
 * @returns 違反(無ければ空)
 */
export function verifyPaidEndpoints(input: PaidInput): Finding[] {
  return (input.external?.integrations ?? []).flatMap((integration) => integrationFindings(integration, input));
}
