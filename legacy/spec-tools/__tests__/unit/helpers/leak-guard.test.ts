/**
 * `helpers/leak-guard.ts` の読み方と止め方(差し替え口で。本物の子を起こす試験は precommit-step-limit.test.ts にある)。
 *
 * 点検 20 回目 C20-5: 止める相手を印の字面だけでなく**プロセスの木**(自分の子孫と、印を持つものの子孫・群)で決める。`guard.shell` は `sh` が命令を
 * exec して印を失わない形にする。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnIsolatedShell } from '../../helpers/git-env.js';
import { markedShell, parsePs, reap, targetsOf, type ProcessEntry, type ReapDeps } from '../../helpers/leak-guard.js';

const MARK = 'st-leak-abc';

/** 一覧と KILL した記録を持つ偽の世界。`immortal` に入れた番号は KILL でも消えない。 */
function world(entries: readonly ProcessEntry[], immortal: readonly number[] = []): { readonly deps: ReapDeps; readonly sent: string[] } {
  let alive = [...entries];
  const sent: string[] = [];
  const deps: ReapDeps = {
    list: () => alive,
    kill: (pid, signal) => {
      sent.push(`${signal}:${String(pid)}`);
      alive = alive.filter((entry) => immortal.includes(entry.pid) || (pid < 0 ? entry.pgid !== -pid : entry.pid !== pid));
    },
    ownPid: 100,
    ownPgid: 90,
    sleep: () => undefined,
  };
  return { deps, sent };
}

const entry = (pid: number, ppid: number, pgid: number, args: string): ProcessEntry => ({ pid, ppid, pgid, args });

describe('ps の出力を読む', () => {
  it('pid・ppid・pgid・状態・命令の 5 列を読み、読めない行は捨てる', () => {
    expect(parsePs('  12  1   7 S+ node -e x\n\n garbage\n 5 4 5 Z sh -c "a b"\n')).toEqual([
      { ...entry(12, 1, 7, 'node -e x'), stat: 'S+' },
      { ...entry(5, 4, 5, 'sh -c "a b"'), stat: 'Z' },
    ]);
  });
});

describe('止める相手(プロセスの木)', () => {
  const own = entry(100, 50, 90, 'vitest worker');
  const unrelated = entry(300, 1, 300, 'node other.js');

  it('自分の子孫は印が無くても全部(同じ群の孫も)', () => {
    const child = entry(110, 100, 90, 'sh -c sleep 4');
    const grandchild = entry(111, 110, 90, 'sleep 4');
    expect(targetsOf([own, child, grandchild, unrelated], MARK, 100, 90).map((target) => target.pid).sort()).toEqual([110, 111]);
  });

  it('印を持つものの子孫と、その群の全部(親を失った孫も群で見つかる)', () => {
    const marked = entry(200, 1, 200, `sh -c x # ${MARK}`);
    const child = entry(201, 200, 200, 'node -e loop');
    const orphan = entry(202, 1, 200, 'node -e orphan');
    expect(targetsOf([own, marked, child, orphan, unrelated], MARK, 100, 90).map((target) => target.pid).sort()).toEqual([200, 201, 202]);
  });

  it('自分と、自分の群の無関係なものは含めない', () => {
    const sibling = entry(120, 50, 90, 'vitest other worker');
    expect(targetsOf([own, sibling, unrelated], MARK, 100, 90)).toEqual([]);
  });
});

describe('印を持つプロセスと自分の子孫をKILL する', () => {
  const sh = entry(200, 1, 200, `sh -c trap '' TERM # ${MARK}`);
  const orphan = entry(201, 1, 200, `node -e loop /tmp/pid ${MARK}`);
  const unrelated = entry(300, 1, 300, 'node other.js');

  it('群ごと KILL して、無関係なプロセスには触れない', () => {
    const { deps, sent } = world([sh, orphan, unrelated]);

    expect(reap(MARK, deps)).toEqual({ killed: 2, survivors: [] });
    expect(sent).toContain('SIGKILL:-200');
    expect(sent.join()).not.toContain('300');
  });

  it('自分の群に居る印の無い子孫も番号で KILL する(以前は残った)', () => {
    const child = entry(110, 100, 90, `sh -c x # ${MARK}`);
    const grandchild = entry(111, 110, 90, 'sleep 4');
    const { deps, sent } = world([entry(100, 50, 90, 'vitest'), child, grandchild]);

    expect(reap(MARK, deps, 2)).toEqual({ killed: 2, survivors: [] });
    expect(sent).toEqual(['SIGKILL:110', 'SIGKILL:111']);
  });

  it('何も無ければ何もKILL しない', () => {
    const { deps, sent } = world([unrelated]);

    expect(reap(MARK, deps)).toEqual({ killed: 0, survivors: [] });
    expect(sent).toEqual([]);
  });

  it('KILL でも消えないものは survivors に返る(呼び手が赤にする)', () => {
    const { deps } = world([sh], [200]);

    expect(reap(MARK, deps, 3).survivors).toEqual([sh]);
  });
});

describe('guard.shell の形は sh に印を残し、終了コードは命令のまま', () => {
  const place = mkdtempSync(path.join(tmpdir(), 'leak-guard-shell-'));
  afterAll(() => rmSync(place, { recursive: true, force: true }));

  it.each([
    ['単純な命令 1 つ(以前は sh が exec して印が消えた)', 'exit 0', 0],
    ['赤の命令', 'false', 1],
    ['終了コード', 'sh -c "exit 7"', 7],
    ['末尾の ;', 'true;', 0],
  ])('%s', (_name, command, code) => {
    expect(spawnIsolatedShell(place, ['-c', markedShell(command, MARK)]).status).toBe(code);
  });

  it('単純な命令でも、命令の間 sh の引数に印が残る', () => {
    const run = spawnIsolatedShell(place, ['-c', markedShell('ps -o args= -p $$', MARK)]);
    expect(run.stdout).toContain(MARK);
  });
});
