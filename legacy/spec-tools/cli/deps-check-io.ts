/**
 * `deps:check` の外への口の本物(ファイルシステム・子プロセス・`fetch`)。純粋な本体 `lib/deps/` はこの口を引数で受ける。
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { isDirectory, listEntries } from '../lib/io/paths.js';
import { tryReadText } from '../lib/io/read-text.js';
import { childEnvOutsideRoot } from '../lib/io/safe-path.js';
import { writeScratchFile } from '../lib/io/scratch.js';
import type { DepsIo } from '../lib/deps/types.js';

/** 1 回の通信の打ち切り(ミリ秒)。 */
const TIMEOUT_MS = 60_000;

/**
 * 本物の口を作る。
 *
 * @param root 製品の根の絶対パス
 */
export function realDepsIo(root: string): DepsIo {
  const abs = (rel: string): string => path.join(root, rel);
  return {
    fetchJson: async (url, init) => {
      const response = await fetch(url, {
        method: init?.method ?? 'GET',
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 状態の番号を添えて投げる(404 = 登録簿に無い を、通信の失敗と分けて赤にするため。lib/deps/signatures.ts の isNotFound)。
      if (!response.ok) throw Object.assign(new Error(`HTTP ${String(response.status)} ${url}`), { status: response.status });
      return (await response.json()) as unknown;
    },
    // 外部コマンド(`npm audit` / `npm audit signatures` / `npm sbom`)は、根の中と依存の置き場を落とした PATH で名前を引く
    // (`npm --prefix legacy/spec-tools run` は PATH の先頭に `node_modules/.bin` を足す。依存の偽の `npm` が「0 件」を返して
    // 検査を緑にしないように。7 回目 C7-6)。
    exec: (cmd, args, cwd) =>
      new Promise((resolve) => {
        execFile(cmd, [...args], { cwd, env: childEnvOutsideRoot(process.env, root), maxBuffer: 256 * 1024 * 1024, timeout: 10 * TIMEOUT_MS, encoding: 'utf8' }, (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null;
          resolve({ code, stdout, stderr: error !== null && stderr === '' ? error.message : stderr });
        });
      }),
    readText: (rel) => tryReadText(abs(rel)),
    isDirectory: (rel) => isDirectory(abs(rel)),
    list: (rel) => listEntries(abs(rel)),
    now: () => new Date(),
    writeText: (rel, text) => writeLatest(root, rel, text),
  };
}

/**
 * 結果の JSON を書く(置き場は作る)。**途中の要素がシンボリックリンクなら書かずに投げる**(`tmp` 自体がリンクでも拒む)。
 *
 * @param root 製品の根の絶対パス
 * @param rel ルート相対の置き場
 * @param body 本文
 */
export function writeLatest(root: string, rel: string, body: string): void {
  writeScratchFile(root, rel, body);
}
