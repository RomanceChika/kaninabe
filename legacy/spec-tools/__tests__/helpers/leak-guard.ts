/**
 * TERM を聞かない・終わらない子を起こすテストの後始末(点検 19 回目の後の直し・20 回目 C20-5 で**プロセスの木**で辿る形に変えた)。
 *
 * `trap '' TERM; while :; do :; done` や `process.on('SIGTERM', () => {})` の孫を起こすテストが、途中で赤になる・道具の約束が破れる・worker が殺されると、
 * 孫が居座って CPU を使い続けた(3 本が 17〜20 時間コアを燃やした)。後始末をテストごとの手書きにすると書き忘れるので、**起こす側が必ずこの部品を通る**
 * (通っているかは `dev-repo/unit/gates/leak-guard.test.ts` が全部のテストの木を走査して閉じる)。
 *
 * - `leakGuard()` は呼ばれたファイルに `afterEach` と `afterAll` を登録する。各テストの後と全部の後に、次の全部を 1 度の一覧(`ps`)から決めて
 *   `SIGKILL` し、消えなければ**赤**(テストを赤にする例外):
 *   1. **自分(vitest の worker)の子孫の全部**(`ppid` の木。印の有無に依らない。以前は印のある・印の群のものだけで、印の無い子孫は残った)
 *   2. **印**(引数に含めた一意の文字列)を持つプロセスと、その子孫(親が先に死んで木から外れた孫も、印で見つかる)
 *   3. 1・2 の群(自分の群を除く)の全部
 *   一覧を先に取ってから止めるので、親を止めた後に孫が親を失って木から外れる隙間が無い。
 * - 印は命令の字面(`guard.shell(命令)`)と、孫の引数(`guard.marker` を `node -e '…' 引数` に渡す)の両方に入れる。`guard.shell` は命令の後ろに
 *   `exit $?` を置く(単純な命令 1 つだと `sh` が命令を exec して印の付いた `sh` が消えるため。点検 20 回目 C20-5)。
 * - 自分(vitest の worker)とその群は KILL しない(同じ群の子は、番号だけを KILL する)。
 *
 * **群の止め方の写しを持つ理由**(点検 21 回目 C の O21-2): 群の止め方の本体は開発用リポジトリの道具の木の部品(プロセス群の部品)だが、
 * spec-tools の木(このテストの部品を含む)は配布され、道具の木は配布されないので import できない。ここの KILL と待ちは、テストの後始末に
 * 要る分(一覧から決めて KILL・残れば赤)だけに留める。
 */

import { spawnSync } from 'node:child_process';
import { withoutGitEnv } from './git-env.js';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isMainThread } from 'node:worker_threads';
import { afterAll, afterEach } from 'vitest';

/** プロセス 1 つ(`ps` の 1 行)。 */
export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  /** 状態(`ps` の stat。読めた一覧だけが持つ)。 */
  readonly stat?: string;
  readonly args: string;
}

/** 差し替え口(単体テスト用)。 */
export interface ReapDeps {
  readonly list: () => readonly ProcessEntry[];
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly ownPid: number;
  readonly ownPgid: number;
  readonly sleep: (ms: number) => void;
  /** 自分の子孫を辿るか(vitest の worker が子のプロセスのときだけ。スレッドの worker では自分 = 全部の worker の親なので辿らない)。既定 true。 */
  readonly walkOwnTree?: boolean;
}

/**
 * `ps` の出力を読む(`pid ppid pgid stat command` の 5 列。読めない行は捨てる)。
 *
 * @param output `ps -axo pid=,ppid=,pgid=,stat=,command=` の出力
 * @returns プロセスの一覧
 */
export function parsePs(output: string): readonly ProcessEntry[] {
  return output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), stat: match[4] ?? '', args: match[5] ?? '' }];
  });
}

/** 本物のプロセスの一覧。 */
function listProcesses(): readonly ProcessEntry[] {
  const run = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, cwd: tmpdir(), env: withoutGitEnv() });
  if (run.status !== 0) throw new Error(`leak-guard: ps が使えません(${String(run.error ?? run.stderr)})`);
  // 一覧を取った `ps` 自身(自分の子)と、もう終わって回収を待つだけのもの(状態 Z。macOS は全員が Z の群への KILL を EPERM で断る)は数えない。
  return parsePs(run.stdout).filter((entry) => entry.pid !== run.pid && !/^Z/.test(entry.stat ?? ''));
}

/** 本物の差し替え口。 */
function realDeps(): ReapDeps {
  const own = listProcesses().find((entry) => entry.pid === process.pid);
  return {
    list: listProcesses,
    kill: (pid, signal) => process.kill(pid, signal),
    ownPid: process.pid,
    ownPgid: own?.pgid ?? process.pid,
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    walkOwnTree: isMainThread,
  };
}

/** 送れなかった(もう居ない)ときだけ黙る。 */
function send(deps: ReapDeps, pid: number, signal: NodeJS.Signals): void {
  try {
    deps.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/**
 * 止める相手(自分の子孫・印を持つもの・その子孫・それらの群の全部。自分は除く)。
 *
 * @param entries プロセスの一覧
 * @param marker 印
 * @param ownPid 自分の番号
 * @param ownPgid 自分の群
 * @param walkOwnTree 自分の子孫を辿るか
 * @returns 止める相手
 */
export function targetsOf(entries: readonly ProcessEntry[], marker: string, ownPid: number, ownPgid: number, walkOwnTree = true): readonly ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of entries) children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry]);
  const picked = new Map<number, ProcessEntry>();
  const walk = (entry: ProcessEntry): void => {
    if (entry.pid === ownPid || picked.has(entry.pid)) return;
    picked.set(entry.pid, entry);
    for (const child of children.get(entry.pid) ?? []) walk(child);
  };
  if (walkOwnTree) for (const child of children.get(ownPid) ?? []) walk(child);
  for (const entry of entries) if (entry.args.includes(marker)) walk(entry);
  const groups = new Set([...picked.values()].map((entry) => entry.pgid).filter((pgid) => pgid !== ownPgid));
  for (const entry of entries) if (groups.has(entry.pgid)) walk(entry);
  return [...picked.values()];
}

/**
 * 自分の子孫と、印を持つプロセス(とその子孫・群)を `SIGKILL` する。消えるのを待ち(最大 `rounds` 回)、残ったものを返す。
 *
 * @param marker 印
 * @param deps 差し替え口(既定は本物)
 * @param rounds 確かめる回数の上限(1 回 50 ms 待つ)
 * @returns KILL したプロセスの数と、最後まで残ったもの
 */
export function reap(marker: string, deps: ReapDeps = realDeps(), rounds = 40): { readonly killed: number; readonly survivors: readonly ProcessEntry[] } {
  const killedPids = new Set<number>();
  let found: readonly ProcessEntry[] = [];
  for (let round = 0; round < rounds; round += 1) {
    found = targetsOf(deps.list(), marker, deps.ownPid, deps.ownPgid, deps.walkOwnTree ?? true);
    if (found.length === 0) return { killed: killedPids.size, survivors: [] };
    for (const group of new Set(found.map((entry) => entry.pgid))) if (group !== deps.ownPgid) send(deps, -group, 'SIGKILL');
    for (const entry of found) {
      killedPids.add(entry.pid);
      send(deps, entry.pid, 'SIGKILL');
    }
    deps.sleep(50);
  }
  return { killed: killedPids.size, survivors: targetsOf(deps.list(), marker, deps.ownPid, deps.ownPgid, deps.walkOwnTree ?? true) };
}

/** 後始末の部品。 */
export interface LeakGuard {
  /** 一意の印。孫の引数(`node -e '…' 引数`)に渡す。 */
  readonly marker: string;
  /** 命令に印の注釈を足す(`sh -c` に渡す命令用。`sh` が命令を exec して印を失わないよう、後ろに `exit $?` を置く)。 */
  readonly shell: (command: string) => string;
  /** いまKILL する(テストの `finally` で明示したいとき)。残れば赤。 */
  readonly reapNow: () => void;
}

/**
 * 命令の後ろに印の注釈を足す(`sh` が最後の単純な命令を exec しないよう、`exit $?` を後ろに置く。終了コードは命令のまま)。
 *
 * @param command 命令
 * @param marker 印
 * @returns 印つきの命令
 */
export function markedShell(command: string, marker: string): string {
  return `${command}\nexit $? # ${marker}`;
}

/**
 * 印を作り、各テストの後と全部の後の後始末を、呼ばれたファイルに登録する。
 *
 * @returns 後始末の部品
 */
export function leakGuard(): LeakGuard {
  const marker = `st-leak-${randomBytes(6).toString('hex')}`;
  const reapNow = (): void => {
    const { survivors } = reap(marker);
    if (survivors.length > 0) throw new Error(`leak-guard: SIGKILL の後も残っているプロセス ${survivors.map((entry) => `${String(entry.pid)}(群 ${String(entry.pgid)}: ${entry.args.slice(0, 80)})`).join(', ')}`);
  };
  afterEach(reapNow);
  afterAll(reapNow);
  return { marker, shell: (command) => markedShell(command, marker), reapNow };
}
