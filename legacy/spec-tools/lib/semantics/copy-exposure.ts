/**
 * **写しの先で隠し列・個人列の約束が崩れないか**の判定(1 か所)。点検 12 回目 A12-2。
 *
 * `fields_hidden` と `personal` は列の性質だが、値が別の表へ写ると、守っていたのは元の列の出口だけになる。読み手は 2 つあり、
 * どちらもこの 1 本を呼ぶ —— `effects[].snapshot` の写像(V12)と、写しのトリガ(T15)。
 *
 * | 約束 | 崩れる形 |
 * |---|---|
 * | 隠し列(元の `fields_hidden` の `from` の相手 H) | H が写し先の列を読める |
 * | 個人列(元が `personal: true`) | 写し先が `personal: true` でない(元の行を消去しても写しが残る) |
 *
 * **「H が読める」の閉じた定義**: 写し先の `reads` に `scope: none` でない規則があり、その `by` が (a) H 自身、(b) H が `implies` で宣言した
 * ロール、(c) 未ログインのロール(ログインした人にも同じ見え方で効く。`policyGranteeRoles`)のどれかで、写し先の `fields_hidden` がその `by` から
 * 写し先の列を隠していない。写し先に access_spec が無ければ読めないと言えないので、読めるとして扱う。`when` と `filters` は行の範囲を
 * 狭めるだけで列の見え方を変えないので数えない。
 *
 * 受け入れは行の `copy_accept`(`model/parse-copy-accept.ts`)だけで、名指した約束 × 相手 × 読み手にしか効かない。読み手ごとに 1 件の崩れとして数えるので、
 * 受け入れた後で写し先の `reads` に別の読み手(未ログインなど)を足すと、そこが新しい指摘になる(点検 13 回目 A13-4)。
 *
 * ここが見る個人列の約束は「写し先も個人列と宣言した」までで、消去の実体(写し先の表が消去の RPC の書き込みに載ること)は T24 が見る(A13-2)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { AccessSpec, RoleDef, SourceLocation, SpecModel } from '../model/types.js';
import type { CopyAccept } from '../model/parse-copy-accept.js';
import type { Finding } from '../kernel/finding.js';
import { anonymousRoleId, impliedRoles } from '../model/role-hierarchy.js';
import { findEntityFields } from './domain-index.js';

/** 写しの片端(`{集約}.{列}`)。 */
export interface CopyEnd {
  readonly entity: string;
  readonly field: string;
}

/** 写しの先で崩れる約束 1 件。 */
export type CopyGap =
  | { readonly kind: 'hidden'; readonly role: string; readonly reader: string | null }
  | { readonly kind: 'personal' };

/** 写し 1 本の入力。 */
export interface CopyCheck {
  /** 指摘の検証器 ID。 */
  readonly verifier: string;
  /** どの宣言かを表す文字列(メッセージに埋める)。 */
  readonly context: string;
  readonly from: CopyEnd;
  readonly to: CopyEnd;
  readonly accepts: readonly CopyAccept[];
  readonly location: SourceLocation;
  /** 受け入れの書き場所の案内。 */
  readonly acceptHint: string;
}

/** 集約の access_spec を引く。 */
function accessOf(model: SpecModel, entity: string): AccessSpec | undefined {
  for (const specs of model.aggregates.values()) {
    if (specs.entity?.entity === entity) return specs.access;
  }
  return undefined;
}

/** 列を隠す宣言の相手(宣言順)。 */
function hiddenFrom(access: AccessSpec | undefined, field: string): readonly string[] {
  return (access?.fieldsHidden ?? []).filter((rule) => rule.field === field).flatMap((rule) => rule.from);
}

/** そのロールの人が通る規則の `by`(自身・含意の先・未ログイン)。 */
export function reachableRoles(roles: readonly RoleDef[], role: string): ReadonlySet<string> {
  const anonymous = anonymousRoleId(roles);
  return new Set([role, ...impliedRoles(roles, role), ...(anonymous === undefined ? [] : [anonymous])]);
}

/** H が写し先の列を読める根拠の規則の全部(読めないなら空。access_spec が無ければ読み手を決められないので `[null]`)。 */
function readersOf(model: SpecModel, role: string, to: CopyEnd): readonly (string | null)[] {
  const access = accessOf(model, to.entity);
  if (access === undefined) return [null];
  const reachable = reachableRoles(model.roles.roles, role);
  const hidden = hiddenFrom(access, to.field);
  return [...new Set(access.reads.filter((rule) => reachable.has(rule.by) && rule.scope.kind !== 'none' && !hidden.includes(rule.by)).map((rule) => rule.by))];
}

/**
 * 写し 1 本で崩れる約束。
 *
 * @param model ドメイン仕様
 * @param from 写し元
 * @param to 写し先
 * @returns 崩れる約束(列が実在しなければ空。実在は別の検査が見る)
 */
export function copyGaps(model: SpecModel, from: CopyEnd, to: CopyEnd): readonly CopyGap[] {
  const source = findEntityFields(model, from.entity)?.find((field) => field.name === from.field);
  const target = findEntityFields(model, to.entity)?.find((field) => field.name === to.field);
  if (source === undefined || target === undefined) return [];
  const gaps: CopyGap[] = [];
  for (const role of new Set(hiddenFrom(accessOf(model, from.entity), from.field))) {
    for (const reader of readersOf(model, role, to)) gaps.push({ kind: 'hidden', role, reader });
  }
  if (source.personal && !target.personal) gaps.push({ kind: 'personal' });
  return gaps;
}

/** その受け入れがその約束を名指しているか。 */
function names(accept: CopyAccept, gap: CopyGap): boolean {
  return gap.kind === 'hidden' ? accept.on === 'hidden' && accept.role === gap.role && accept.reader === gap.reader : accept.on === 'personal';
}

/** 崩れる約束 1 件の指摘。 */
function gapFinding(check: CopyCheck, gap: CopyGap): Finding {
  const { from, to } = check;
  const path = `${from.entity}.${from.field} → ${to.entity}.${to.field}`;
  const common = { verifier: check.verifier, severity: 'error' as const, location: check.location };
  if (gap.kind === 'personal') {
    return {
      ...common,
      message: `${check.context} の ${path} は、個人列の値を personal: true でない列へ写します —— 元の行を消去しても写しが残る形です`,
      suggestion:
        `${to.entity}.${to.field} を personal: true にし、写し元を消去する RPC の also_writes に ${to.entity} の表を scrub か delete で足して本文で消す(personal: true だけでは消えない。T24 が見る)か、` +
        `値が個人に結びつかない理由を ${check.acceptHint} に "on: personal" で書く`,
      counterexample: { from: `${from.entity}.${from.field}`, to: `${to.entity}.${to.field}`, promise: 'personal' },
    };
  }
  const through = gap.reader === null ? `${to.entity} に access_spec が無く読み手を決められません` : `reads の by: ${gap.reader} で読めます`;
  return {
    ...common,
    message: `${check.context} の ${path} は、${gap.role} から隠した列を ${gap.role} の読める列へ写します(${through})`,
    suggestion:
      `写し先の fields_hidden で ${gap.role} から隠す・reads を狭める・写す行を消すのどれかにする。` +
      (gap.reader === null ? `${to.entity} の access_spec を書くまで受け入れは書けない` : `約束が別の形で守られているなら、${check.acceptHint} に "on: hidden / role: ${gap.role} / reader: ${gap.reader}" で理由を書く`),
    counterexample: { from: `${from.entity}.${from.field}`, to: `${to.entity}.${to.field}`, promise: 'hidden', role: gap.role, reader: gap.reader ?? '(access_spec なし)' },
  };
}

/** 何も受け入れていない `copy_accept` の指摘。 */
function rottenFinding(check: CopyCheck, accept: CopyAccept): Finding {
  return {
    verifier: check.verifier,
    severity: 'error',
    message: `${check.context} の copy_accept(on: ${accept.on}${accept.role === undefined ? '' : ` / role: ${accept.role} / reader: ${accept.reader ?? ''}`})は、崩れる約束を名指していません`,
    location: accept.location,
    suggestion: '効いていない受け入れは消す(写し元の宣言が変わったなら、理由も見直す)',
    counterexample: { to: `${check.to.entity}.${check.to.field}`, on: accept.on },
  };
}

/**
 * 写し 1 本を検査する(受け入れのない崩れと、腐った受け入れを error にする)。
 *
 * @param model ドメイン仕様
 * @param check 写し 1 本
 * @returns 違反のリスト
 */
export function copyExposureFindings(model: SpecModel, check: CopyCheck): Finding[] {
  const gaps = copyGaps(model, check.from, check.to);
  return [
    ...gaps.filter((gap) => !check.accepts.some((accept) => names(accept, gap))).map((gap) => gapFinding(check, gap)),
    ...check.accepts.filter((accept) => !gaps.some((gap) => names(accept, gap))).map((accept) => rottenFinding(check, accept)),
  ];
}
