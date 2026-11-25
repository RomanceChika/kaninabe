/**
 * H7 **拒否の記録の接地**(ASVS V16.3.2 / V16.3.3)—— 生成された Server Action は拒否を記録するが、その接続点と手書きの入口を構文木で見る。
 *
 * 生成された入口は `recordActionRefusal` を認証の組み立ての根から import して、拒否を返す前に 1 行記録する(`render/refusal-log-entry.ts`)。
 * 記録の部品は実行時パッケージが持ち、**製品が手で書くのは接続点だけ**(出力口を選ぶ `recordActionRefusal` と、要求の識別子を解く
 * `resolveRequestId`。どちらも認証の組み立ての根に住む)。ここが見るのは:
 *
 *   - **接続点の実在** … 認証の組み立ての根が 2 つの名前を値として export している(無ければ生成された Server Action の型検査も落ちるが、
 *     型検査より前に仕様の言葉で名指す)
 *   - **手書きの入口**(`runner: manual` の操作の Server Action)… 実行器を通らないので記録も自分で通す。export した関数ごとに
 *     ①`recordActionRefusal`(認証の組み立ての根から import した束縛)を呼んでいる ②実行者の解決(`resolveActorId`)が、入力のパース
 *     (`.safeParse(` / `.parse(`)より**先**にある(logging.md「実行者はパースより先に解決する」。拒否された入力の記録に「誰が」が無いと
 *     攻撃と操作ミスの区別が付かない)
 *
 * 呼び出しは**位置で束縛に解決**する(同名の局所の宣言・引数・自己束縛は本物ではない。`config/import-binding.ts`)。入れ子の関数の中の呼び出しは
 * 入口の実行の根拠にしない(呼ばれるかを静的に決められない)。
 *
 * 見ないもの: 記録を呼ぶ位置が拒否の返却の直前かどうか(呼んでいることだけを見る)・出力口の中身。Server Action のファイルが無い操作
 * (人の入口が無い)・実装の木が無い構成・action_spec を採っていないときは何も言わない。
 */

import path from 'node:path';
import ts from 'typescript';
import { appGrounded, isFile } from '../../io/paths.js';
import { readText } from '../../io/read-text.js';
import type { Finding } from '../../kernel/finding.js';
import { inputValue } from '../../kernel/input-state.js';
import type { CatalogInput } from '../../kernel/input-state.js';
import type { SourceLocation } from '../../kernel/source-location.js';
import { layoutModule, layoutPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import { ACTOR_RESOLVER, REFUSAL_LOG_EXPORTS, REFUSAL_RECORDER } from '../../model/auth/refusal-log.js';
import { allowedImports, resolveImport } from '../../config/import-binding.js';
import type { ImportSpec } from '../../config/import-binding.js';
import { exportedFunctions, parseModule } from '../../semantics/guard-ast.js';
import type { FunctionNode } from '../../semantics/guard-ast.js';
import { exportedValueNames } from '../../semantics/module-exports.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'H7';

/** 検査の入力。 */
export interface RefusalLogInput {
  /** action_spec の入力の状態(読込済みのときだけ手書きの入口を見る)。 */
  readonly actions: CatalogInput<ActionSpecModel>;
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}

/** 手書きの入口の関数 1 つの判定。 */
export type EntryLogState = 'logged' | 'unlogged' | 'parse_before_actor';

/**
 * 関数本体の**入口の実行の道筋**にある呼び出し。入れ子の関数(関数宣言・関数式・矢印関数・メソッド・クラスの本体)の中は数えない
 * (呼ばれるかどうかを静的に決められないので、入口の根拠にしない。保守的)。
 */
function callsIn(node: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return found;
  const visit = (current: ts.Node): void => {
    if (ts.isFunctionLike(current) || ts.isClassLike(current)) return;
    if (ts.isCallExpression(current)) found.push(current);
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
  if (ts.isCallExpression(node)) found.push(node);
  return found;
}

/**
 * 呼び出しが、認証の組み立ての根から**値として** import した `imported` の呼び出しか(`f(…)`)。
 * 呼び出しの位置で名前を束縛に解決する: 局所の宣言・引数・自己束縛に隠された同名は、本物ではない(`resolveImport` / `isShadowed`)。
 */
function isCallOf(call: ts.CallExpression, bound: ReadonlyMap<string, ImportSpec>): boolean {
  return ts.isIdentifier(call.expression) && resolveImport(call.expression, bound) !== null;
}

/** 呼び出しが入力のパース(`x.safeParse(…)` / `x.parse(…)`)か。 */
function isParseCall(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression) && ['safeParse', 'parse', 'safeParseAsync', 'parseAsync'].includes(call.expression.name.text);
}

/**
 * export した関数 1 つの判定。
 *
 * @param fn 関数
 * @param authModule 認証の組み立ての根のモジュール指定
 * @returns 判定
 */
export function entryLogState(fn: FunctionNode, authModule: string): EntryLogState {
  const file = fn.getSourceFile();
  const recorder = allowedImports(file, [{ module: authModule, imported: REFUSAL_RECORDER }]);
  const resolver = allowedImports(file, [{ module: authModule, imported: ACTOR_RESOLVER }]);
  const calls = fn.body === undefined ? [] : callsIn(fn.body);
  if (!calls.some((call) => isCallOf(call, recorder))) return 'unlogged';
  const parse = calls.filter(isParseCall).map((call) => call.getStart());
  if (parse.length === 0) return 'logged';
  const actor = calls.filter((call) => isCallOf(call, resolver)).map((call) => call.getStart());
  return actor.length > 0 && Math.min(...actor) < Math.min(...parse) ? 'logged' : 'parse_before_actor';
}

/** 認証の組み立ての根が export していない接続点(実在しないファイルは見ない)。 */
function missingExports(input: RefusalLogInput): { readonly file: string; readonly missing: readonly string[] } | null {
  const file = layoutPath(input.layout, input.roots.app, 'auth-composition');
  if (file === null || !isFile(path.join(input.repoRoot, file))) return null;
  const exported = exportedValueNames(file, readText(path.join(input.repoRoot, file)));
  const missing = REFUSAL_LOG_EXPORTS.filter((name) => !exported.has(name));
  return missing.length === 0 ? null : { file, missing };
}

/** 指摘の ID と重大度をそろえる。 */
function h7(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** 手書きの入口 1 つの指摘。 */
function entryFindings(op: string, location: SourceLocation, input: RefusalLogInput): Finding[] {
  const file = layoutPath(input.layout, input.roots.app, 'operation-entry', op);
  const auth = layoutModule(input.layout, 'auth-composition');
  if (file === null || auth === null || !isFile(path.join(input.repoRoot, file))) return [];
  const source = parseModule(file, readText(path.join(input.repoRoot, file)));
  return exportedFunctions(source).flatMap(([name, fn]) => {
    const state = entryLogState(fn, auth);
    if (state === 'logged') return [];
    const message =
      state === 'unlogged'
        ? `runner: manual の操作 ${op} の手書きの Server Action(${file} の ${name})が、拒否を記録していません(認証の組み立ての根 ${auth} の ${REFUSAL_RECORDER} を呼んでいません。実行器を通らない入口には、生成物の記録が届きません)`
        : `runner: manual の操作 ${op} の手書きの Server Action(${file} の ${name})が、実行者の解決(${ACTOR_RESOLVER})より先に入力をパースしています(拒否された入力の記録に「誰が」が載りません。logging.md)`;
    return [
      h7({
        message,
        location,
        suggestion:
          `${name} の本体の先頭で \`const actorId = await ${ACTOR_RESOLVER}();\` と \`const entry = { operation: '…', actorId, requestId: await resolveRequestId() };\` を置いてからパースし、` +
          `パースの失敗と実行器の結果(拒否のとき)を返す前に \`${REFUSAL_RECORDER}(entry, 結果);\` で記録する(import は ${auth} から)`,
        counterexample: { operation: op, file, export: name, state },
        grounding: 'implementation',
      }),
    ];
  });
}

/**
 * 拒否の記録の接地を検証する。
 *
 * @param input action_spec・リポジトリルート・根・配置
 * @returns 違反
 */
export function verifyRefusalLog(input: RefusalLogInput): Finding[] {
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  const actions = inputValue(input.actions)?.actions ?? [];
  const absent = missingExports(input);
  const connection =
    absent === null
      ? []
      : [
          h7({
            message: `認証の組み立ての根 ${absent.file} が ${absent.missing.join(' / ')} を export していません(生成された Server Action が拒否を記録できません)`,
            location: actions[0]?.location ?? { file: absent.file },
            suggestion: `${absent.file} から ${absent.missing.join(' / ')} を export する(実体は製品の配線: 出力口を選ぶ ${REFUSAL_RECORDER} と、要求の識別子を読む resolveRequestId。部品は @kaninabe/runtime/security-log)`,
            counterexample: { file: absent.file, missing: absent.missing.join(',') },
            grounding: 'implementation',
          }),
        ];
  const manual = actions.filter((action) => action.runner?.kind === 'manual').flatMap((action) => entryFindings(action.handles.raw, action.location, input));
  return [...connection, ...manual];
}
