/**
 * 充足性の**判定器**(既製品の Z3 を呼ぶだけの層)。
 *
 * 2026-09-11 のユーザー原則「推論・探索の道具は既製品を採り、写像だけを自作する」に従い、
 * 探索は WASM の `z3-solver` に任せる。このモジュールが持つのは
 *  (1) Z3 を**隔離した worker に閉じ込めて**問いを渡す段取り(z3-host.ts / z3-worker.ts。親は Z3 の
 *  ハンドルを持たず、文字列と答えの綴りだけをやりとりする)、(2) 写像(smt.ts)の出力を Z3 に渡す口、
 *  (3) Z3 のモデルを反例(witness)に読み直す口 —— の 3 つだけである。
 *
 * `unknown` を返すのは **Z3 が答えなかったとき**だけである。自作の列挙器
 * (satisfiability.ts)が持つ「3 つの上限」はここには無い。
 *
 * 例外は投げない(規約: scripts-code-quality.md)。ただし**黙って `unknown` に畳まない**:
 * 「時間内に答えられなかった」(タイムアウト)と「判定器が動かなかった」(起動できない・
 * 写像を拒まれた = 写像のバグ)を `SatResult.failure` で分ける —— 後者を前者と見分けのつかない形で出すと
 * 診断が丸ごと嘘になり、**Z3 が 1 件も解けていなくても verify が緑で終わる**。前者は V9 / V10 が
 * warning で、後者は **error** で報告する。
 */

import process from 'node:process';
import { Worker } from 'node:worker_threads';
import type { DomainEnv, GuardExpr, SatResult, Satisfiability } from './ast.js';
import { translateToSmt, type SmtTranslation } from './smt.js';
import { EMPTY_WITNESS } from './witness.js';
import { Z3Host, type WorkerLike } from './z3-host.js';
import type { Z3Context } from './z3-protocol.js';

/** 1 つの式にかける時間の上限(ミリ秒)。超えたら `unknown`。 */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Z3 の `timeout` に足す host の余裕(ミリ秒)。worker の起動・SMT の読み込み・モデルの読み取りがここに入る。 */
export const HOST_GRACE_MS = 10_000;

/** Z3 の割当の見積りがこの値を超えたら、問いの間で worker を入れ替える(WASM のヒープは 2 GiB 固定)。 */
const RECYCLE_ABOVE_BYTES = 1024 ** 3;

/** モデル(反例)の読み口。Z3 の `Model` のうち、ここが使う 2 つだけ。 */
export interface SmtModel {
  decls(): { name(): unknown }[];
  get(decl: never): { toString(): string };
}

/**
 * 1 問を解く道具(既製品の Z3 のソルバー)。
 *
 * **差し替えられるのはテストのためだけ**である —— 「判定器が壊れたら error になる」ことは、
 * 本物の Z3 を壊さずには実測できない(z3-failure.test.ts)。
 */
export interface SmtSolver {
  set(key: string, value: number): void;
  fromString(source: string): void;
  check(): Promise<string>;
  model(): SmtModel;
}

/** ソルバーの作り口(既定は隔離した worker の Z3 に問いを渡す)。 */
export type SolverFactory = () => Promise<SmtSolver>;

/** 隔離した worker を起動する(`z3-worker.ts` は Node の型除去でそのまま読まれる)。 */
function spawnWorker(): WorkerLike {
  return new Worker(new URL('./z3-worker.ts', import.meta.url));
}

/** 入れ替え・停止の行を標準エラーに残す(開発時に気づけるように)。 */
function logToStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Z3 のセッションを持つ worker の持ち主。最初の問いまで作らない。 */
let host: Z3Host | null = null;

function currentHost(): Z3Host {
  host ??= new Z3Host({ spawn: spawnWorker, recycleAboveBytes: RECYCLE_ABOVE_BYTES, log: logToStderr });
  return host;
}

/**
 * 親が Z3 のハンドルを持たない `SmtSolver`。`set` / `fromString` を溜めておき、`check()` で 1 問として worker へ渡す。
 * モデルは `sat` のとき読み取った (変数名, 値の綴り) から組む。
 */
function remoteSolver(context: Z3Context, withModel: boolean): SmtSolver {
  const params: [string, number][] = [];
  const sources: string[] = [];
  let values: ReadonlyMap<{ name(): unknown }, string> = new Map();
  return {
    set: (key, value) => void params.push([key, value]),
    fromString: (source) => void sources.push(source),
    check: async () => {
      const timeoutMs = params.filter(([key]) => key === 'timeout').at(-1)?.[1] ?? DEFAULT_TIMEOUT_MS;
      const answer = await currentHost().request({ context, params, sources, withModel, deadlineMs: timeoutMs + HOST_GRACE_MS });
      values = new Map((answer.values ?? []).map(([name, text]) => [{ name: () => name }, text]));
      return answer.status;
    },
    model: () => ({
      decls: () => [...values.keys()],
      get: (decl) => ({ toString: () => values.get(decl) ?? '' }),
    }),
  };
}

/**
 * Z3 のセッション(worker)を止める(Node のプロセスが落ちられるようにする)。
 *
 * 呼ばなくても判定の正しさは変わらない。長く走るプロセス(CLI・テストランナー)が
 * 終われなくなるのを防ぐためだけのもの。次の問いは新しい worker で始まる。
 * 手放した worker を含む全部の `terminate()` が終わってから返る。終了を確認できない worker が残れば reject し、
 * その間(障壁が立っているあいだ)は新しい worker を作らず問いは error になる。**障壁を解くのはこの関数だけ**(次の呼び出しがまた確認を試みる)。
 * 持ち主(`host`)は捨てない: 止めている最中に来た問いも、同じ持ち主が古い `terminate()` を待ってから新しい worker で処理する
 * (待った後に終了を確認できない worker が残っていれば、障壁が立っているので待たずに・新しい worker を作らずに error になる)。
 */
export async function shutdownZ3(): Promise<void> {
  await host?.shutdown();
}

/** 判定の呼び出し口(既定以外を渡すのはテストだけ)。 */
export interface Z3Options {
  /** 1 問あたりの時間の上限(既定 5 秒)。 */
  readonly timeoutMs?: number;
  /** ソルバーの作り口(既定は隔離した worker の Z3)。 */
  readonly solver?: SolverFactory;
}

/** 既定のソルバーの作り口(起動を 1 回に畳んだ main 文脈。モデルを読む)。 */
const defaultSolver: SolverFactory = async () => remoteSolver('main', true);

/**
 * **1 問ごとに捨てる文脈**から作るソルバー。
 *
 * Z3 の文脈は読み込んだ式(AST)を抱え続ける。ガード式 1 本(数百バイト)なら 1 つの文脈を
 * 使い回して構わないが、時間軸に展開したスクリプト(数百 KB)を同じ文脈に何十本も流し込むと
 * **WASM のヒープが尽きて worker ごと落ちる**(2026-09-20 の実測: 9 問目で
 * `memory access out of bounds`)。落ち方が例外ですらないので Finding にもできない。
 * 問いごとに文脈を捨てれば、抱えた AST もそこで終わる。
 */
const scratchSolver: SolverFactory = async () => remoteSolver('scratch', false);

/**
 * ガード式の充足可能性を Z3 で判定する。
 *
 * @param expr 判定対象の式
 * @param env パス → ドメインの宣言
 * @param options 時間の上限とソルバーの作り口(既定は本物の Z3)
 * @returns verdict と、真にできる場合は Z3 のモデルから読んだ witness。
 *          判定器そのものが壊れたときは `failure` つきの `unknown`
 */
export async function satisfiabilityByZ3(
  expr: GuardExpr,
  env: DomainEnv,
  options: Z3Options = {},
): Promise<SatResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const solver = options.solver ?? defaultSolver;
  const translation = translateToSmt(expr, env);
  const positive = await check(translation, translation.formula, timeoutMs, solver);
  if (positive.failure !== undefined) return { verdict: 'unknown', failure: positive.failure };
  if (positive.status === 'unsat') return { verdict: 'unsatisfiable' };
  if (positive.status === 'unknown') return { verdict: 'unknown' };

  const negative = await check(translation, `(not ${translation.formula})`, timeoutMs, solver);
  if (negative.failure !== undefined) return { verdict: 'unknown', failure: negative.failure };
  const verdict: Satisfiability =
    negative.status === 'unsat' ? 'tautology' : negative.status === 'sat' ? 'satisfiable' : 'unknown';
  return positive.witness === undefined ? { verdict } : { verdict, witness: positive.witness };
}

/** 1 本のスクリプトを解いた結果(反例は読まない)。 */
export interface ScriptResult {
  readonly status: 'sat' | 'unsat' | 'unknown';
  /** **判定器そのものが壊れた**理由(起動できない・スクリプトを拒まれた)。 */
  readonly failure?: string;
}

/**
 * **組み立て済みの SMT-LIB スクリプト**を 1 本解く。
 *
 * ガード式 1 本の判定(`satisfiabilityByZ3`)と違い、何を問うているかをここは知らない ——
 * 時間軸への展開(lib/reach)のように、写像が**式ではなくスクリプトを作る**場合の口である。
 * 反例は読まない(有界到達性は「ある / 無い」しか使わない。実行列の witness は将来の宿題)。
 *
 * @param script `(declare-const …)` と `(assert …)` を並べた SMT-LIB
 * @param timeoutMs 時間の上限
 * @param solver ソルバーの作り口(既定は起動済みの Z3。差し替えるのはテストだけ)
 * @returns `sat` / `unsat` / `unknown`。判定器そのものが壊れたときは `failure` つきの `unknown`
 */
export async function checkScript(
  script: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  solver: SolverFactory = scratchSolver,
): Promise<ScriptResult> {
  try {
    const instance = await solver();
    instance.set('timeout', timeoutMs);
    instance.fromString(script);
    const status = await instance.check();
    return status === 'sat' || status === 'unsat' ? { status } : { status: 'unknown' };
  } catch (error) {
    return { status: 'unknown', failure: error instanceof Error ? error.message : String(error) };
  }
}

/** 1 回の `check-sat`。例外は投げず、**壊れたこと**を `failure` として返す。 */
async function check(
  translation: SmtTranslation,
  formula: string,
  timeoutMs: number,
  factory: SolverFactory,
): Promise<{
  readonly status: 'sat' | 'unsat' | 'unknown';
  readonly witness?: Record<string, string>;
  readonly failure?: string;
}> {
  try {
    const solver = await factory();
    solver.set('timeout', timeoutMs);
    solver.fromString(`${translation.declarations}\n(assert ${formula})`);
    const status = await solver.check();
    if (status !== 'sat' && status !== 'unsat') return { status: 'unknown' };
    if (status === 'unsat') return { status };
    const witness = readWitness(solver.model(), translation);
    return witness === undefined ? { status } : { status, witness };
  } catch (error) {
    return { status: 'unknown', failure: error instanceof Error ? error.message : String(error) };
  }
}

/** モデルが与えた値(`3` / `(- 2)` / `1/2` / `(/ 3.0 2.0)` / `2.0`)を数へ。読めなければ undefined。 */
function numberOf(text: string): number | undefined {
  const negated = /^\(-\s*(.+)\)$/u.exec(text.trim());
  if (negated !== null) {
    const inner = numberOf(negated[1] ?? '');
    return inner === undefined ? undefined : -inner;
  }
  const division = /^\(\/\s+(\S+)\s+(\S+)\)$/u.exec(text.trim());
  if (division !== null) {
    const left = numberOf(division[1] ?? '');
    const right = numberOf(division[2] ?? '');
    return left === undefined || right === undefined || right === 0 ? undefined : left / right;
  }
  const ratio = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/u.exec(text.trim());
  if (ratio !== null) return Number(ratio[1]) / Number(ratio[2]);
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Z3 のモデルを反例(パス → 値)に読み直す。
 *
 * finite 変数は整数 → 値の綴りへ戻す。それ以外の変数は、モデルの値がリテラル定数と
 * 一致していればその綴りを、順序付きの値(数・日時)なら数そのものを載せる。
 * opaque(等号しか使えない値)の数は「同じか違うか」しか意味を持たないので載せない
 * —— 反例に uuid の代わりに `2` と出ても読めない。
 *
 * **空の欄は値より先に決まる。** 相棒の `Bool` が真の欄は `(空)` と書き、値の変数は読まない
 * —— 写像は空の欄の比較をすべて偽に閉じているので、そこに残った数は誰も見ていない値である。
 */
function readWitness(model: SmtModel, translation: SmtTranslation): Record<string, string> | undefined {
  const values = new Map<string, string>();
  for (const decl of model.decls()) {
    const name = String(decl.name());
    values.set(`|${name}|`, model.get(decl as never).toString());
  }
  const literalTexts = new Map<string, string>();
  for (const literal of translation.literals) literalTexts.set(literal.smtName, literal.text);

  const witness: Record<string, string> = {};
  const empty = new Set<string>();
  for (const nullVar of translation.nullVars) {
    if (values.get(nullVar.smtName) !== 'true') continue;
    empty.add(nullVar.path);
    witness[nullVar.path] = EMPTY_WITNESS;
  }
  for (const variable of translation.variables) {
    if (empty.has(variable.path)) continue;
    const raw = values.get(variable.smtName);
    if (raw === undefined) continue;
    const numeric = numberOf(raw);
    if (variable.valueByIndex !== undefined) {
      const label = numeric === undefined ? undefined : variable.valueByIndex.get(numeric);
      if (label !== undefined) witness[variable.path] = label;
      continue;
    }
    // その変数と直に比べられた定数だけを見る(偶然の一致で綴りを当てない)。
    const matched = (variable.literals ?? []).find((name) => values.get(name) === raw);
    const literal = matched === undefined ? undefined : literalTexts.get(matched);
    if (literal !== undefined) witness[variable.path] = literal;
    else if (variable.ordered === true && numeric !== undefined) witness[variable.path] = String(numeric);
  }
  return Object.keys(witness).length === 0 ? undefined : witness;
}
