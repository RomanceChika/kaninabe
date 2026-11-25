/**
 * ハンドブックの「できること」「見える範囲」の節と、役の凡例の事実 — 権限の宣言を、表示から独立した型つきの値にする。
 *
 * 設計メモ `docs/design/book-as-spec/plan-generator.md` §2(中間表現)と `book-as-spec.md` §1-7-7(役の色)。
 *
 * - **役の事実**: 種類(`kind: system` → 内部実行 / `kind: anonymous` → 未ログイン / `binding` あり → 対象との関係で決まる役 /
 *   それ以外 → 誰にでも付く役)と、**宣言した操作の数**(遷移の `by` と、creates / writes / deletes の `by` に名前が出る数。
 *   `implies` で受け継ぐ分は数えない)。この数は「権限の強さ」ではない(外部レビュー の Q2)。凡例の濃さの順だけに使う。
 * - **操作の事実**: 集約ごとの遷移・作成・編集・削除。誰が・どの欄を・どんな条件で。理由つきの受け入れ(`self_assign` /
 *   `public` / 作成の代行 `delegate`)も持つ(読者が「例外として開けてある」と分かるように)。
 * - **読み取りの事実**: 誰が・どの範囲を・どの条件で。その役から隠す欄(`fields_hidden`)を役ごとに引いて持つ。
 *
 * 並びは仕様の宣言順。純粋関数だけ。**アプリの語彙は 1 語も持たない。**
 */

import type { SourceLocation } from '../../kernel/source-location.js';
import type { ReadFilter, ReadScope } from '../../model/types-access.js';
import type { DelegateDecl, SelfAssignDecl, SpecModel } from '../../model/types.js';

/** 役の種類(色相の区分と同じ。表示の語は words の側が持つ)。 */
export type RoleClass = 'system' | 'anonymous' | 'global' | 'relation';

/** 役 1 つの事実。 */
export interface RoleFact {
  readonly id: string;
  readonly label: string;
  readonly roleClass: RoleClass;
  /** 直接の含意(`implies`。宣言順)。 */
  readonly implies: readonly string[];
  /** 仕様がこの役の名前で宣言した操作の数(含意で受け継ぐ分は数えない)。 */
  readonly declaredOperations: number;
}

/** 操作の種類。 */
export type OperationKind = 'event' | 'create' | 'write' | 'delete';

/** 操作 1 つの事実。 */
export interface OperationFact {
  readonly aggregate: string;
  readonly kind: OperationKind;
  /** 遷移なら `{状態機械}.{イベント}`、それ以外は空。 */
  readonly event: string;
  /** 遷移の表示名(無ければ id)。それ以外は空。 */
  readonly label: string;
  readonly by: readonly string[];
  /** 編集できる欄(編集だけ。宣言順)。 */
  readonly fields: readonly string[];
  readonly when?: string;
  /** 理由つきの受け入れ(`self_assign` / `public` / 作成の代行 `delegate`)。無ければ空。 */
  readonly accepted: readonly { readonly kind: 'self_assign' | 'public' | 'delegate'; readonly text: string }[];
  readonly source: SourceLocation;
}

/** 読み取り 1 つの事実。 */
export interface ReadFact {
  readonly aggregate: string;
  readonly by: string;
  readonly scope: ReadScope;
  readonly filters: readonly ReadFilter[];
  readonly when?: string;
  /** この役から隠す欄(`fields_hidden` のうち `from` にこの役があるもの。宣言順)。 */
  readonly hiddenFields: readonly string[];
  readonly source: SourceLocation;
}

/** 集約 1 つの権限の事実。 */
export interface AggregateAccessFacts {
  readonly aggregate: string;
  readonly operations: readonly OperationFact[];
  readonly reads: readonly ReadFact[];
}

function accepted(entries: readonly (readonly ['self_assign' | 'public' | 'delegate', string | undefined])[]): OperationFact['accepted'] {
  return entries.flatMap(([kind, text]) => (text === undefined ? [] : [{ kind, text }]));
}

/** `self_assign` の要素を 1 つずつ、名指した欄 × 役 × 書き手つきの文に写す(受け入れは欄・書き手ごとに効くので、読者にも欄・書き手ごとに見せる)。 */
function selfAssigns(decls: readonly SelfAssignDecl[] | undefined): readonly (readonly ['self_assign', string])[] {
  return (decls ?? []).map(
    (decl) => ['self_assign', `${decl.entity}.${decl.field}${decl.role === undefined ? '' : `(${decl.role})`}・by ${decl.by.join(' / ')}: ${decl.reason}`] as const,
  );
}

/** `delegate` の要素を 1 つずつ、名指した欄つきの文に写す(代理は名指した欄にだけ効く)。 */
function delegates(decls: readonly DelegateDecl[] | undefined): readonly (readonly ['delegate', string])[] {
  return (decls ?? []).map((decl) => ['delegate', `${decl.entity}.${decl.field}: ${decl.reason}`] as const);
}

/** 集約 1 つの権限の事実(集約が無ければ空)。 */
export function aggregateAccessFacts(model: SpecModel, aggregate: string): AggregateAccessFacts {
  const specs = model.aggregates.get(aggregate);
  const access = specs?.access;
  const operations: OperationFact[] = [];
  for (const machine of specs?.stateMachines ?? []) {
    for (const event of machine.events) {
      operations.push({
        aggregate,
        kind: 'event',
        event: `${machine.machine}.${event.id}`,
        label: event.label ?? event.id,
        by: event.by,
        fields: [],
        ...(event.guard === undefined ? {} : { when: event.guard }),
        accepted: accepted([...selfAssigns(event.selfAssign), ['public', event.public]]),
        source: event.location,
      });
    }
  }
  const plain = (kind: OperationKind, by: string, when: string | undefined, fields: readonly string[], extra: OperationFact['accepted'], source: SourceLocation): OperationFact => ({
    aggregate,
    kind,
    event: '',
    label: '',
    by: [by],
    fields,
    ...(when === undefined ? {} : { when }),
    accepted: extra,
    source,
  });
  for (const rule of access?.creates ?? []) {
    operations.push(plain('create', rule.by, rule.when, [], accepted([...selfAssigns(rule.selfAssign), ...delegates(rule.delegate)]), rule.location));
  }
  for (const rule of access?.writes ?? []) operations.push(plain('write', rule.by, rule.when, rule.fields, [], rule.location));
  for (const rule of access?.deletes ?? []) operations.push(plain('delete', rule.by, rule.when, [], accepted([['public', rule.public]]), rule.location));
  const reads = (access?.reads ?? []).map(
    (rule): ReadFact => ({
      aggregate,
      by: rule.by,
      scope: rule.scope,
      filters: rule.filters ?? [],
      ...(rule.when === undefined ? {} : { when: rule.when }),
      hiddenFields: (access?.fieldsHidden ?? []).filter((hidden) => hidden.from.includes(rule.by)).map((hidden) => hidden.field),
      source: rule.location,
    }),
  );
  return { aggregate, operations, reads };
}

/** 役の事実(roles.md の宣言順)。操作の数は製品の全集約で数える。 */
export function roleFacts(model: SpecModel): readonly RoleFact[] {
  const counts = new Map<string, number>();
  for (const aggregate of model.aggregates.keys()) {
    for (const operation of aggregateAccessFacts(model, aggregate).operations) {
      for (const role of new Set(operation.by)) counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  }
  return model.roles.roles.map((role) => ({
    id: role.id,
    label: role.label ?? role.id,
    roleClass: role.kind === 'system' ? 'system' : role.kind === 'anonymous' ? 'anonymous' : role.binding === undefined ? 'global' : 'relation',
    implies: role.implies ?? [],
    declaredOperations: counts.get(role.id) ?? 0,
  }));
}
