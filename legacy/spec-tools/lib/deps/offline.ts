/**
 * lockfile の**通信の要らない**検査(`deps:check:offline`。6 回目 C6-3)。
 *
 * 本体の `deps:check`(`run.ts`)は登録簿・audit・OSV・署名に通信するので CI の各 `npm ci` の前には置きにくく、以前は pre-commit でしか
 * 回らなかった(フックを通らない変更 — `--no-verify`・Web の編集・PR — の lockfile の細工は、CI も夜間も見ないまま `npm ci` された)。
 * ここは**通信をしない部分だけ**を切り出す: 許さない lockfile の存在(`discoverForeignLockfiles`)と、各 `package-lock.json` の形・配信元と固定・
 * 同梱・手元の置き場の宣言(`lockfilePinFindings`)。どれも `run.ts` と同じ関数で、判定は 1 つである。
 *
 * **依存を入れる前に走る**(CLI は `node` で直に読む。`npm ci` の install script より先に止める)ので、ここから辿る部品は `node:` 以外を import しない。
 */

import { discoverForeignLockfiles, discoverLockfiles } from './lockfile.js';
import { declaredLocalTargets } from './lockfile-local.js';
import { lockfilePinFindings } from './lockfile-pins.js';
import type { DepsFinding } from './types.js';

/** 読み取りの口(製品の根からの相対。`DepsIo` の通信しない部分)。 */
export interface DepsOfflineIo {
  readonly readText: (rel: string) => string | null;
  readonly list: (rel: string) => readonly string[];
  readonly isDirectory: (rel: string) => boolean;
}

/** 通信の要らない検査の結果。 */
export interface DepsOfflineReport {
  /** 見た `package-lock.json`(根相対・名前順)。 */
  readonly lockfiles: readonly string[];
  /** 赤(どれも受け入れ表の対象にならない種類 `lockfile`)。 */
  readonly findings: readonly DepsFinding[];
  readonly ok: boolean;
}

/**
 * 許さない lockfile が置かれていること自体の赤(5 回目 C5-2)。
 *
 * @param path lockfile のパス(根相対)
 */
export function foreignLockfileFinding(path: string): DepsFinding {
  return {
    lockfile: path, kind: 'lockfile', id: 'lockfile-foreign', aliases: [], pkg: '(lockfile)', severity: 'high', sources: ['lockfile'], level: 'red',
    title: `package-lock.json 以外の lockfile か npm の設定(${path.slice(path.lastIndexOf('/') + 1)})がある(npm-shrinkwrap.json は package-lock.json より優先され、この検査が読まない取得元で入る。.npmrc は registry と script-shell を差し替える)`,
  };
}

/**
 * 通信の要らない lockfile の検査を回す。
 *
 * @param io 読み取りの口
 */
export function runDepsOffline(io: DepsOfflineIo): DepsOfflineReport {
  const fs = { list: io.list, isDirectory: io.isDirectory, isFile: (rel: string) => io.readText(rel) !== null };
  const lockfiles = discoverLockfiles(fs);
  const findings: DepsFinding[] = discoverForeignLockfiles(fs).map(foreignLockfileFinding);
  for (const lockfile of lockfiles) findings.push(...lockfilePinFindings(lockfile, io.readText(lockfile) ?? '', declaredLocalTargets(io, lockfile)));
  return { lockfiles, findings, ok: findings.length === 0 };
}

/**
 * 結果を人に見せる行(赤を 1 行ずつ。最後に要約)。
 *
 * @param report 結果
 */
export function formatDepsOffline(report: DepsOfflineReport): string[] {
  const lines = report.findings.map((finding) => `赤 ${finding.lockfile} ${finding.pkg}${finding.version === undefined ? '' : `@${finding.version}`}: ${finding.title}`);
  lines.push(`deps:check:offline: lockfile ${String(report.lockfiles.length)} 本(${report.lockfiles.join(' / ') || 'なし'})・赤 ${String(report.findings.length)} 件${report.ok ? '' : '(npm ci の前に直す)'}`);
  return lines;
}
