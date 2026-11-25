/**
 * 軸「通知」—— 誰に飛ぶか、どう発火するか、どの遷移が飛ばすか。
 *
 * 元は 3 本である ——
 * - 通知の閉世界(宛先・発火のしかた。**ここに無い通知は送られない**)
 * - 遷移表の効果(`effects`)。**発火元はここにしかない**
 * - ロールの含意(`ROLE_IMPLICATIONS`)。宛先が**広がったか狭まったか**の順序をここから取る
 *
 * 宛先の広さは仕組み側が表で持たない —— 生成物から**導ける**からである。
 * 宛先種別(`recipient.kind`)は「本人 1 人 < そのロールの全員 < チャンネルを見られる全員」の
 * 順に広く、ロール同士は含意で比べられる(`A implies B` は「A は必ず B である」= B のほうが
 * 広い集合)。導けない入れ替わりだけが 🔁 になる。
 *
 * **片側が読めないときは 1 行も出さない**(独立レビューの止め 2)。
 *
 * 純粋関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { diffFacts, factKey, FactBuilder, keyParts } from './facts.js';
import { changeText } from './messages.js';
import { asArray, asObject, asString, asStrings, field, flatten } from './plain.js';
import { pathsWith, problemsOf, readExport, unreadable } from './reader.js';
import { isTransitionsPath, notificationsPath, roleLabelsPath, stemOf } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import { exportedNames, readExportedValue } from './ts-literal.js';
import type { AxisInput, AxisResult, DiffDirection, DiffProblem, SemanticChange, SideSnapshot } from './types.js';
import type { ProductRoots } from '../model/product/types.js';

/** カタログの export 名(生成物が持つ綴り)。 */
const CATALOG = 'NOTIFICATIONS';

/** ロールの含意の export 名。 */
const IMPLICATIONS = 'ROLE_IMPLICATIONS';

/** 遷移表の export 名の形(1 つ目の捕獲は機械の綴り)。 */
const MACHINE = /(\w+)Machine/;

/** 突き合わせる宣言の欄(この 6 つが「誰にどう飛ぶか」の全部。`personFrom` は本人を名指す行の相手の出どころ)。 */
const DECLARED_FIELDS = ['medium', 'audience', 'mention', 'trigger', 'recipient', 'personFrom'] as const;

/** 宛先の広さを決める欄(この 2 つだけが「誰に届くか」を動かす)。 */
const AUDIENCE_FIELDS: ReadonlySet<string> = new Set(['audience', 'recipient']);

/**
 * 宛先種別の広さ(**フレームワーク固定の値域**であり、アプリの語彙ではない)。
 *
 * `self` は名指しの 1 人、`role` はそのロールを持つ全員、`channel` はそのチャンネルを
 * 見られる全員である。順序はこの包含関係そのもので、表示名も判断も要らない。
 */
const KIND_BREADTH: Readonly<Record<string, number>> = { self: 1, role: 2, channel: 3 };

/** 通知 ID → 宣言、の表。 */
function catalogOf(value: PlainValue | undefined): ReadonlyMap<string, PlainValue> {
  const found = new Map<string, PlainValue>();
  for (const decl of asArray(value)) {
    const id = asString(field(decl, 'id'));
    if (id !== undefined) found.set(id, decl);
  }
  return found;
}

/** 通知 ID → 「その通知があること」、の事実の表。 */
function presenceTable(catalog: ReadonlyMap<string, PlainValue>): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  for (const [id, decl] of catalog) builder.add(id, asString(field(decl, 'summary')) ?? id);
  return builder.table();
}

/** 通知 ID × 欄 → 中身、の事実の表。 */
function fieldTable(catalog: ReadonlyMap<string, PlainValue>): ReturnType<FactBuilder['table']> {
  const builder = new FactBuilder();
  for (const [id, decl] of catalog) {
    for (const name of DECLARED_FIELDS) builder.add(factKey(id, name), flatten(field(decl, name)));
  }
  return builder.table();
}

/** ロールの含意(A → A が必ず併せ持つロール)。 */
function implicationsOf(value: PlainValue | undefined): ReadonlyMap<string, readonly string[]> {
  const table = new Map<string, readonly string[]>();
  const object = asObject(value);
  if (object === undefined) return table;
  for (const [role, implied] of Object.entries(object)) table.set(role, asStrings(implied));
  return table;
}

/** その通知の宛先種別(`recipient`)。 */
function recipientOf(catalog: ReadonlyMap<string, PlainValue>, id: string): PlainValue | undefined {
  return field(catalog.get(id), 'recipient');
}

/**
 * 宛先が広がったか狭まったか。
 *
 * 種別が違えば包含の順で決まり、同じ `role` 同士なら含意で決まる —— `B` が `A` を含意する
 * (`B は必ず A である`)なら `A` のほうが広い集合である。どちらとも言えなければ 🔁。
 */
function audienceDirection(
  before: PlainValue | undefined,
  after: PlainValue | undefined,
  implications: ReadonlyMap<string, readonly string[]>,
): DiffDirection {
  const beforeKind = KIND_BREADTH[asString(field(before, 'kind')) ?? ''] ?? 0;
  const afterKind = KIND_BREADTH[asString(field(after, 'kind')) ?? ''] ?? 0;
  if (beforeKind === 0 || afterKind === 0) return 'changed';
  if (afterKind > beforeKind) return 'widened';
  if (afterKind < beforeKind) return 'narrowed';
  const beforeRole = asString(field(before, 'role'));
  const afterRole = asString(field(after, 'role'));
  if (beforeRole === undefined || afterRole === undefined || beforeRole === afterRole) return 'changed';
  if (implications.get(beforeRole)?.includes(afterRole) === true) return 'widened';
  if (implications.get(afterRole)?.includes(beforeRole) === true) return 'narrowed';
  return 'changed';
}

/** 遷移 × 効果 → 通知 ID、の事実の表(通知として宣言されている ID だけ)。 */
function effectTable(
  snapshot: SideSnapshot,
  side: DiffProblem['side'],
  known: ReadonlySet<string>,
  roots: ProductRoots,
): { readonly table: ReturnType<FactBuilder['table']>; readonly problems: readonly DiffProblem[] } {
  const builder = new FactBuilder();
  const problems: DiffProblem[] = [];
  for (const path of pathsWith(snapshot, (path) => isTransitionsPath(path, roots))) {
    const content = snapshot.get(path);
    if (content === null || content === undefined) continue;
    for (const found of exportedNames(content, MACHINE)) {
      const read = readExportedValue(content, found.name);
      if (!read.ok) {
        problems.push({ kind: read.missing === true ? 'undeclared' : 'unreadable', side, path, reason: read.reason });
        continue;
      }
      for (const transition of asArray(field(read.value, 'transitions'))) {
        const event = asString(field(transition, 'event'));
        if (event === undefined) continue;
        for (const effect of asStrings(field(transition, 'effects'))) {
          if (known.has(effect)) builder.add(factKey(`${stemOf(path)}.${event}`, effect), effect);
        }
      }
    }
  }
  return { table: builder.table(), problems };
}

/**
 * 軸「通知」の差分。
 *
 * @param input 2 版の写しと表示名の帳面
 * @returns 行と、読めなかったもの
 */
export function notificationChanges(input: AxisInput): AxisResult {
  const baseRead = readExport(input.base, 'base', notificationsPath(input.roots), CATALOG);
  const headRead = readExport(input.head, 'head', notificationsPath(input.roots), CATALOG);
  const baseRoles = readExport(input.base, 'base', roleLabelsPath(input.roots), IMPLICATIONS);
  const headRoles = readExport(input.head, 'head', roleLabelsPath(input.roots), IMPLICATIONS);
  const problems = problemsOf(baseRead, headRead, baseRoles, headRoles);
  const changes: SemanticChange[] = [];
  if (unreadable(baseRead, headRead, baseRoles, headRoles)) return { changes, problems };
  const base = catalogOf(baseRead.value);
  const head = catalogOf(headRead.value);
  const implications = implicationsOf(headRoles.value ?? baseRoles.value);
  for (const delta of diffFacts(presenceTable(base), presenceTable(head))) {
    if (delta.kind === 'changed') continue;
    changes.push({
      axis: 'notifications',
      direction: delta.kind,
      subject: delta.key,
      before: delta.before,
      after: delta.after,
      text: changeText('notification_decl', delta.kind, {
        subject: delta.key,
        subjectLabel: (delta.kind === 'added' ? delta.after : delta.before) ?? '',
      }),
    });
  }
  for (const delta of diffFacts(fieldTable(base), fieldTable(head))) {
    if (delta.kind !== 'changed') continue;
    const [id = '', name = ''] = keyParts(delta.key);
    const direction = AUDIENCE_FIELDS.has(name)
      ? audienceDirection(recipientOf(base, id), recipientOf(head, id), implications)
      : 'changed';
    changes.push({
      axis: 'notifications',
      direction,
      subject: id,
      before: delta.before,
      after: delta.after,
      text: changeText('notification_field', direction, {
        subject: id,
        field: name,
        before: delta.before,
        after: delta.after,
      }),
    });
  }
  const known = new Set([...base.keys(), ...head.keys()]);
  const baseEffects = effectTable(input.base, 'base', known, input.roots);
  const headEffects = effectTable(input.head, 'head', known, input.roots);
  for (const delta of diffFacts(baseEffects.table, headEffects.table)) {
    if (delta.kind === 'changed') continue;
    const [transition = ''] = keyParts(delta.key);
    changes.push({
      axis: 'notifications',
      direction: delta.kind,
      subject: transition,
      before: delta.before,
      after: delta.after,
      text: changeText('notification_effect', delta.kind, {
        subject: transition,
        subjectLabel: input.labels.operation(transition) ?? '',
        before: delta.before,
        after: delta.after,
      }),
    });
  }
  return { changes, problems: [...problems, ...baseEffects.problems, ...headEffects.problems] };
}
