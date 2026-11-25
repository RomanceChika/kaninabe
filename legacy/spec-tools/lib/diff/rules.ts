/**
 * 軸「権限」の**第 2 の元** —— 規則の表そのもの(作成 / 編集 / 削除 / 遷移)。
 *
 * なぜ要るか: 結果表は world を宣言から作れない集約で `operations: []` になり、その集約の操作は
 * **1 件も判定されない**。結果表だけを元にすると、そこの `by` にロールを 1 つ足しても差分が
 * 0 件になる —— 黙って通る経路である(独立レビューの止め 1)。そこで、**結果表が答えを
 * 出していない操作だけ**を、規則の表(engine が読むのと同じ生成物)から見る。
 *
 * 見るのは宣言そのもの(誰が `by` に居るか・条件 `guardSource`・編集できる欄・遷移の端)で
 * あって、組み合わせの結末ではない。結末の網羅は結果表の仕事であり、ここはその穴を塞ぐ
 * **下限**である(「誰ができるか」が動いたことは必ず出る)。
 *
 * 操作 ID は生成物が自分で持つ綴り(`entity` / `machine` と `event`)と、実行計画の
 * 手順の種別(`RunStepKind` = 作成 / 遷移 / 削除 / 編集)から組む。アプリの語は 1 つも持たない。
 *
 * 純粋関数であり throw しない。
 */

import { diffFacts, factKey, FactBuilder, keyParts } from './facts.js';
import { changeText } from './messages.js';
import { asArray, asString, asStrings, field, flatten } from './plain.js';
import { pathsWith } from './reader.js';
import { isRulesPath, RULE_SUFFIX } from './sources.js';
import type { PlainValue } from './ts-literal.js';
import { exportedNames, readExportedValue } from './ts-literal.js';
import type { AxisInput, AxisResult, DiffProblem, SemanticChange, SideSnapshot } from './types.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 規則の表 1 家族の宣言。
 *
 * `verb` は実行計画の手順の種別(`RunStepKind`)であり、**仕組み側の語彙**である
 * (`app/src/domain/generated/plan-types.ts`)。操作 ID の後半はこの語と一致する。
 */
interface RuleFamily {
  /** ファイルの接尾辞。 */
  readonly suffix: string;
  /** export 名の形(1 つ目の捕獲は集約の綴り)。 */
  readonly pattern: RegExp;
  /** 操作 ID の後半(手順の種別)。遷移だけは宣言側が持つので null。 */
  readonly verb: 'create' | 'update' | 'delete' | null;
}

/** 読む家族の全数(これ以外の規則の表は無い)。 */
const FAMILIES: readonly RuleFamily[] = [
  { suffix: RULE_SUFFIX.creates, pattern: /(\w+)CreateRules/, verb: 'create' },
  { suffix: RULE_SUFFIX.writes, pattern: /(\w+)WriteRules/, verb: 'update' },
  { suffix: RULE_SUFFIX.deletes, pattern: /(\w+)DeleteRules/, verb: 'delete' },
  { suffix: RULE_SUFFIX.transitions, pattern: /(\w+)Machine/, verb: null },
];

/** その版の規則の表(操作 × ロール → 宣言の中身)と、読めなかったもの。 */
interface RulesSide {
  readonly table: ReturnType<FactBuilder['table']>;
  readonly problems: readonly DiffProblem[];
}

/** `by` は 1 人のことも並びのこともある(作成・編集・削除は単数、遷移は並び)。 */
function rolesOf(value: PlainValue | undefined): readonly string[] {
  const single = asString(value);
  return single === undefined ? asStrings(value) : [single];
}

/** 宣言の中身を 1 行に畳む(同じ中身なら必ず同じ文字列になる)。 */
function permitText(parts: readonly string[]): string {
  const kept = parts.filter((part) => part !== '');
  return kept.length === 0 ? '無条件' : kept.join(' / ');
}

/** 作成・編集・削除の規則を写す。 */
function absorbRules(value: PlainValue, verb: string, builder: FactBuilder, decided: ReadonlySet<string>): void {
  const entity = asString(field(value, 'entity'));
  if (entity === undefined) return;
  const op = `${entity}.${verb}`;
  if (decided.has(op)) return;
  for (const rule of asArray(field(value, 'rules'))) {
    const columns = asStrings(field(rule, 'fields'));
    const permit = permitText([flatten(field(rule, 'guardSource')), columns.length === 0 ? '' : columns.join(' ')]);
    for (const role of rolesOf(field(rule, 'by'))) builder.add(factKey(op, role), permit);
  }
}

/** 遷移の規則を写す(端 from → to も宣言の中身に入れる)。 */
function absorbMachine(value: PlainValue, builder: FactBuilder, decided: ReadonlySet<string>): void {
  const machine = asString(field(value, 'machine'));
  if (machine === undefined) return;
  for (const transition of asArray(field(value, 'transitions'))) {
    const event = asString(field(transition, 'event'));
    if (event === undefined) continue;
    const op = `${machine}.${event}`;
    if (decided.has(op)) continue;
    const permit = permitText([
      `${asStrings(field(transition, 'from')).join(' / ')} → ${flatten(field(transition, 'to'))}`,
      flatten(field(transition, 'guardSource')),
    ]);
    for (const role of rolesOf(field(transition, 'by'))) builder.add(factKey(op, role), permit);
  }
}

/** 片側の規則の表をすべて読む。 */
function rulesSide(
  snapshot: SideSnapshot,
  side: DiffProblem['side'],
  decided: ReadonlySet<string>,
  roots: ProductRoots,
): RulesSide {
  const builder = new FactBuilder();
  const problems: DiffProblem[] = [];
  for (const path of pathsWith(snapshot, (path) => isRulesPath(path, roots))) {
    const content = snapshot.get(path);
    if (content === null || content === undefined) continue;
    const family = FAMILIES.find((candidate) => path.endsWith(candidate.suffix));
    if (family === undefined) continue;
    for (const found of exportedNames(content, family.pattern)) {
      const read = readExportedValue(content, found.name);
      if (!read.ok) {
        problems.push({ kind: read.missing === true ? 'undeclared' : 'unreadable', side, path, reason: read.reason });
        continue;
      }
      if (family.verb === null) absorbMachine(read.value, builder, decided);
      else absorbRules(read.value, family.verb, builder, decided);
    }
  }
  return { table: builder.table(), problems };
}

/**
 * 軸「権限」の差分(第 2 の元 = 規則の表)。
 *
 * @param input 2 版の写しと表示名の帳面
 * @param decidedOps 結果表が判定を出している操作(こちらでは見ない)
 * @returns 行と、読めなかったもの
 */
export function ruleChanges(input: AxisInput, decidedOps: readonly string[]): AxisResult {
  const decided = new Set(decidedOps);
  const base = rulesSide(input.base, 'base', decided, input.roots);
  const head = rulesSide(input.head, 'head', decided, input.roots);
  const problems = [...base.problems, ...head.problems];
  const changes: SemanticChange[] = [];
  // **片側が読めないなら 1 行も出さない**(同上)。
  if (problems.some((problem) => problem.kind === 'unreadable')) return { changes, problems };
  for (const delta of diffFacts(base.table, head.table)) {
    const [op = '', role = ''] = keyParts(delta.key);
    const direction = delta.kind === 'added' ? 'widened' : delta.kind === 'removed' ? 'narrowed' : 'changed';
    const opLabel = input.labels.operation(op);
    const roleLabel = input.labels.role(role);
    changes.push({
      axis: 'permission',
      direction,
      subject: op,
      before: delta.before,
      after: delta.after,
      text: changeText('permission_rule', direction, {
        subject: op,
        ...(opLabel === undefined ? {} : { subjectLabel: opLabel }),
        actor: role,
        ...(roleLabel === undefined ? {} : { actorLabel: roleLabel }),
        before: delta.before,
        after: delta.after,
      }),
    });
  }
  return { changes, problems };
}
