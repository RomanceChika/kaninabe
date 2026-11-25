/**
 * R5 **未ログインの書き込みの濫用の歯止め**(危ない形の群。規則の正は enforcement-matrix の C32。設計は
 * docs/design/security-audit-2026-10-18/r5-abuse-freeze.md §3)。
 *
 * 未ログインが書ける形は、毎回違う鍵で叩けば行を無制限に作れる(作成)・認証なしで他人の行を動かせる(更新・削除・遷移)。
 * この検査は 2 つを見る。
 *
 * | 形 | 止める条件 | 受け入れ |
 * |---|---|---|
 * | 未ログインの作成(`creates[]`) | R5-1 全体の天井(`abuse.global_ceiling`)が無い | なし(値は製品が決める。**値の妥当性は見ない**) |
 * | `abuse` の書き方 | R5-2 `max` が 1 以上の整数でない・`per` が閉じた語でない / 366 日超・鍵の欄が実在しない・期間を切る欄(`at` または省略時の既定)が `auto: true` の日時の欄でない(NOT NULL・既定値 now()・入力で書けない、を満たさない)か編集・遷移で書ける・鍵ごとが全体より大きい・1 つの access に 2 本以上 | なし |
 * | 生成器が出せない | R5-4 表(data_table)が無い・DDL が生成物でない・同名の手書きの宣言がある(判定は生成器と同じ `judgeCeiling`。**時刻の欄は R5-2 が同じ関数で見る**) | なし(生成できない宣言は嘘になる) |
 * | `abuse` の置き場 | R5-3 未ログインの作成の規則でない規則に書いた(効かない宣言) | なし |
 * | 未ログインの更新・削除・遷移(`writes[]` / `deletes[]` / `events[]`) | R5-5 `public: 理由` が無い・空 | `public: 理由`(その規則の場所) |
 * | `public` の置き場 | R5-6 未ログインのロールが `by` にいない規則に書いた(腐った受け入れ) | なし |
 *
 * 有料の口(外部連携の `spend: paid` と `abuse`。R5-7 / R5-8)は対の検査 `r5-paid.ts` が見る(入口はここの `verifyAbuseOf` が束ねる)。
 *
 * 読むのは `role.kind`・`by`・`abuse`・`public` と、欄の型・`auto`だけで、**アプリの語彙は 1 語も持たない**。純関数であり throw しない。
 */

import type { ConfigCatalogSpec } from '../../model/config/types.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';
import type { CatalogInput } from '../../kernel/input-state.js';
import { verifyPaidEndpoints } from './r5-paid.js';
import type { AbuseDecl, AccessSpec, AggregateSpecs, SourceLocation, SpecModel } from '../../model/types.js';
import { makeFinding, type Finding } from '../../kernel/finding.js';
import { clockProblems, windowProblems } from '../../model/abuse-clock.js';
import { anonymousReach, aggregateOfTable, judgeCeiling } from '../../model/data/ceiling-plan.js';
import type { DataTableSpecModel } from '../../model/data/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'R5';

/** R5 の材料(ドメイン仕様と、R5-4 が生成器の判定を聞く data_table。data_table が読めていなければ R5-4 は見ない)。 */
export interface AbuseInput {
  readonly model: SpecModel;
  readonly dataTables: DataTableSpecModel | undefined;
  /** R5-7 / R5-8 の材料: 外部連携カタログ(読込済みのもの。無ければ見ない)。 */
  readonly external?: ExternalCatalogSpec | undefined;
  /** R5-7 の材料: `quota.source` の接地先の config カタログ(入力の状態のまま。無ければ接地を見ない)。 */
  readonly config?: CatalogInput<ConfigCatalogSpec> | undefined;
}

/** 未ログインに開く規則の場所の名前を作る材料。 */
interface Site {
  /** 人が読む場所(`{集約}.writes[0](by: anonymous)`)。 */
  readonly place: string;
  readonly location: SourceLocation;
}

/** 規則の名前(`{entity}.{kind}[{index}](by: {by})`)。 */
function siteOf(entity: string, kind: string, index: number, by: string, location: SourceLocation): Site {
  return { place: `${entity}.${kind}[${index}](by: ${by})`, location };
}

/** `abuse` の中身の指摘(R5-2。欄の実在は entity_spec の欄から引く)。 */
function abuseProblems(abuse: AbuseDecl, specs: AggregateSpecs): string[] {
  const entity = specs.entity;
  const problems: string[] = [];
  if (abuse.globalCeiling !== undefined) problems.push(...windowProblems('global_ceiling', abuse.globalCeiling));
  if (abuse.perKey !== undefined) {
    problems.push(...windowProblems('per_key', abuse.perKey));
    const column = entity?.fields.find((field) => field.name === abuse.perKey?.column);
    if (column === undefined) problems.push(`per_key.column="${abuse.perKey.column}" は集約の欄にありません`);
    // 空の鍵どうしは等しくならない(NULL)ので、空にできる欄では鍵を省くだけで鍵ごとの天井をすり抜けられる。
    else if (!column.required && !column.auto) problems.push(`per_key.column="${abuse.perKey.column}" は空にできる欄です(鍵を省くと鍵ごとの天井をすり抜けられます。required か auto の欄にする)`);
    if (abuse.globalCeiling !== undefined && abuse.perKey.max > abuse.globalCeiling.max) {
      problems.push(`per_key.max=${abuse.perKey.max} が global_ceiling.max=${abuse.globalCeiling.max} より大きい(鍵ごとの天井が全体より緩いと効きません)`);
    }
  }
  problems.push(...clockProblems(abuse.at, specs));
  return problems;
}

/** R5-1: 全体の天井が無い。 */
function missingCeiling(site: Site, hasAbuse: boolean): Finding {
  return makeFinding(VERIFIER_ID, {
    message:
      `${site.place} は未ログインが書ける作成で、全体の天井がありません` +
      `(毎回違う鍵で送れば行を無制限に作られ、DB の枠とスタッフの画面が溢れます)${hasAbuse ? '。abuse はありますが global_ceiling がありません' : ''}`,
    location: site.location,
    suggestion: '"abuse: { global_ceiling: { max, per } }" を書く(生成器が commit 時の制約トリガにします)。値の大きさは製品が決められます',
    counterexample: { rule: site.place, missing: 'abuse.global_ceiling' },
  });
}

/** R5-2: `abuse` の書き方が不正。 */
function badShape(site: Site, problems: readonly string[]): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `${site.place} の abuse の書き方が不正です: ${problems.join(' / ')}`,
    location: site.location,
    suggestion:
      'max は 1 以上の整数・per は "{n} {minute|hour|day}"(366 日まで)・per_key.column は集約の欄・per_key.max は global_ceiling.max 以下にする。' +
      '期間を切る at は auto: true の日時の欄(NOT NULL・作成時の既定値 now()・入力と更新で書けない)にする(省略時は auto の日時の欄がちょうど 1 つのときだけ)。' +
      '1 つの access_spec に abuse を書けるのは 1 規則だけ(制約トリガは表に 1 本)',
    counterexample: { rule: site.place, problems: problems.join(' / ') },
  });
}

/** R5-3: 未ログインの作成でない規則の `abuse`。 */
function strayAbuse(site: Site): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `${site.place} に abuse がありますが、未ログインのロールの作成の規則ではありません(効く先の無い宣言です)`,
    location: site.location,
    suggestion: 'abuse を消す(未ログインが書ける作成の規則にだけ書ける。天井は表への作成の全部を数える)',
    counterexample: { rule: site.place },
  });
}

/** R5-4: 生成器が天井を出せない。 */
function cannotEmit(site: Site, reason: string): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `${site.place} の abuse は、生成器が制約トリガにできません: ${reason}(宣言だけで DB が天井を課さない、嘘の宣言になります)`,
    location: site.location,
    suggestion: '表(data_table)を置いて ddl_migration を宣言する・同名の手書きのトリガ / 関数の宣言を消す。生成器が出せる形にしてから abuse を書く',
    counterexample: { rule: site.place, reason },
  });
}

/** R5-5: 未ログインの更新・削除・遷移に理由が無い。 */
function missingPublic(site: Site, empty: boolean): Finding {
  return makeFinding(VERIFIER_ID, {
    message: empty
      ? `${site.place} の public の理由が空です(理由の無い受け入れは、受け入れの無いのと同じものです)`
      : `${site.place} は未ログインが更新・削除・遷移を起こせる形です(認証なしで他人の行を動かせ、誰が起こしたかも残りません)`,
    location: site.location,
    suggestion: empty
      ? '未ログインに開けてよい理由を具体的に書く'
      : 'ログインを要するロールにする。意図して開くなら、この規則の場所に "public: 理由" を書く',
    counterexample: { rule: site.place },
  });
}

/** R5-6: 未ログインでない規則の `public`。 */
function strayPublic(site: Site): Finding {
  return makeFinding(VERIFIER_ID, {
    message: `${site.place} に public がありますが、未ログインのロールの規則ではありません(何も受け入れていない、腐った受け入れです)`,
    location: site.location,
    suggestion: 'public を消す(未ログインに開く規則を後で足すときに、そのときの理由を書き直す)',
    counterexample: { rule: site.place },
  });
}

/** 更新・削除・遷移の 1 規則の指摘(`by` に未ログインのロールがいるかと `public` の有無から)。 */
function publicFindings(site: Site, opensToAnonymous: boolean, reason: string | undefined): Finding[] {
  if (opensToAnonymous) {
    if (reason === undefined) return [missingPublic(site, false)];
    return reason.trim() === '' ? [missingPublic(site, true)] : [];
  }
  return reason === undefined ? [] : [strayPublic(site)];
}

/** R5-4: 天井を出す表を引いて、生成器の判定を聞く(表の材料が無ければ見ない)。 */
function emitFindings(site: Site, access: AccessSpec, specs: AggregateSpecs, model: SpecModel, dataTables: DataTableSpecModel | undefined): Finding[] {
  if (dataTables === undefined || !dataTables.available) return [];
  // 表の引き当ては生成器の判定(judgeCeiling)と同じ helper(aggregateOfTable)。二重に引かない。
  const table = dataTables.tables.find((candidate) => aggregateOfTable(candidate, model) === specs);
  if (table === undefined) return [cannotEmit(site, `集約 ${access.entity} の表(data_table)がありません`)];
  const judged = judgeCeiling(table, model);
  return judged.kind === 'refused' ? [cannotEmit(site, judged.reason)] : [];
}

/** 作成の規則の指摘(R5-1 / R5-2 / R5-3 / R5-4)。 */
function createFindings(access: AccessSpec, specs: AggregateSpecs, open: ReadonlySet<string>, model: SpecModel, dataTables: DataTableSpecModel | undefined): Finding[] {
  const findings: Finding[] = [];
  // 天井は表に 1 本(生成器のトリガも 1 本)。未ログインに開く作成の規則が複数あっても、どれか 1 つの abuse が表全体を覆う
  // (含意で開く規則も同じ表の同じ天井で数えられる。外部レビュー)。0 本なら開く規則ごとに R5-1、2 本以上なら R5-2。
  const rules = access.creates.map((rule, index) => ({ rule, site: siteOf(access.entity, 'creates', index, rule.by, rule.location) }));
  for (const { rule, site } of rules) if (!open.has(rule.by) && rule.abuse !== undefined) findings.push(strayAbuse(site));
  const opened = rules.filter(({ rule }) => open.has(rule.by));
  const carriers = opened.filter(({ rule }) => rule.abuse !== undefined);
  const carrier = carriers[0]?.site;
  if (carriers.length === 0 || carriers.every(({ rule }) => rule.abuse?.globalCeiling === undefined)) {
    for (const { rule, site } of opened) findings.push(missingCeiling(site, rule.abuse !== undefined));
  }
  carriers.forEach(({ rule, site }, index) => {
    const problems = rule.abuse === undefined ? [] : abuseProblems(rule.abuse, specs);
    if (index > 0) problems.push('abuse が同じ access_spec の 2 規則以上にあります(天井は表に 1 本。1 つの規則に書けば、未ログインに開く作成の規則すべてを覆います)');
    if (problems.length > 0) findings.push(badShape(site, problems));
  });
  // R5-4: R5-1〜R5-3 が既に言っている宣言には、生成器の判定が重なる部分を二重に言わない(宣言が整ってから生成器に聞く)。
  if (findings.length === 0 && carrier !== undefined) findings.push(...emitFindings(carrier, access, specs, model, dataTables));
  return findings;
}

/** 集約 1 つの指摘。 */
function aggregateFindings(specs: AggregateSpecs, open: ReadonlySet<string>, model: SpecModel, dataTables: DataTableSpecModel | undefined): Finding[] {
  const findings: Finding[] = [];
  const access = specs.access;
  if (access !== undefined) {
    findings.push(...createFindings(access, specs, open, model, dataTables));
    access.writes.forEach((rule, index) => {
      findings.push(...publicFindings(siteOf(access.entity, 'writes', index, rule.by, rule.location), open.has(rule.by), rule.public));
    });
    access.deletes.forEach((rule, index) => {
      findings.push(...publicFindings(siteOf(access.entity, 'deletes', index, rule.by, rule.location), open.has(rule.by), rule.public));
    });
  }
  for (const machine of specs.stateMachines) {
    for (const event of machine.events) {
      const opens = event.by.some((role) => open.has(role));
      const site = { place: `${machine.machine}.${event.id}(by: ${event.by.join(', ')})`, location: event.location };
      findings.push(...publicFindings(site, opens, event.public));
    }
  }
  return findings;
}

/**
 * R5: 未ログインの作成の全体の天井と、未ログインの更新・削除・遷移の理由つき受け入れを見る。
 *
 * @param model ドメイン仕様全体
 * @param dataTables 読み込み済みの data_table(R5-4 が生成器の判定を聞く材料。無ければ R5-4 は見ない)
 * @returns 違反(無ければ空)
 */
export function verifyAbuse(model: SpecModel, dataTables?: DataTableSpecModel): Finding[] {
  return verifyAbuseOf({ model, dataTables });
}

/** テーブル仕様の `kind: rpc` の関数の名前(テーブル仕様が読めていなければ undefined)。 */
function rpcNamesOf(dataTables: DataTableSpecModel | undefined): ReadonlySet<string> | undefined {
  if (dataTables === undefined || !dataTables.available) return undefined;
  return new Set(dataTables.tables.flatMap((table) => table.functions.filter((fn) => fn.kind === 'rpc').map((fn) => fn.name)));
}

/**
 * R5 の実行口(群の入口が材料をまとめて渡す形)。
 *
 * @param input ドメイン仕様と data_table
 * @returns 違反(無ければ空)
 */
export function verifyAbuseOf(input: AbuseInput): Finding[] {
  const model = input.model;
  // 未ログインが持つロール = 未ログインのロールと、それが含意するロール(含意で開く規則も未ログインに開いている)。
  const open = anonymousReach(model);
  // data_table が読めていなければ undefined(R5-4 だけが見ない。ほかの指摘は材料に依らない)。
  const abuse = [...model.aggregates.values()].flatMap((specs) => aggregateFindings(specs, open, model, input.dataTables));
  return [...abuse, ...verifyPaidEndpoints({ external: input.external, config: input.config, roles: model.roles.roles, rpcNames: rpcNamesOf(input.dataTables) })];
}
