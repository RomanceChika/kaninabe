/**
 * ハンドブックだけを出す本物の CLI(`cli/generate-book.ts`)を別プロセスで実行するテストの共通の道具
 * (使い捨ての製品の写し・木の指紋・実行の口)。**題材の fixture は触らず、いつも使い捨てのディレクトリに写して実行する。**
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FRAMEWORK_CLI_DIR, PRODUCT_DECL_FILE, toRelative, walkFiles } from '../../lib/io/paths.js';
import { runToolCli, runToolCliRecorded, TOOL_ROOT, TOOL_TREE } from './run-tool-cli.js';
import type { CliRun, RecordedCliRun } from './run-tool-cli.js';

/** CLI の絶対パス(道具の木の `cli/` の中)。 */
export const cliPath = (name: string): string => path.join(TOOL_ROOT, FRAMEWORK_CLI_DIR, name);

/** 題材 `library`(実装の木 `app` を宣言する仕様だけの製品)。 */
export const LIBRARY = path.join(import.meta.dirname, '../fixtures/samples/library');

/** 1 回の実行は題材を読んで生成するので長い(負荷の高い日の余裕を見る)。 */
export const SLOW = 300_000;

const created: string[] = [];

/** 一時ディレクトリ(macOS の別名を畳んだ実パス)。`cleanupTemps` が消す。 */
export function temp(label: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), `generate-book-${label}-`)));
  created.push(dir);
  return dir;
}

/** `temp` で作った一時ディレクトリを全部消す(`afterAll` で呼ぶ)。 */
export function cleanupTemps(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** `library` を一時ディレクトリへ写す。`withoutDb` なら、DB の宣言(data_table と surface)を外して `uses` からも消す。 */
export function copiedSample(label: string, withoutDb = false): string {
  const root = temp(label);
  cpSync(LIBRARY, root, { recursive: true });
  if (withoutDb) {
    rmSync(path.join(root, 'docs/specs/backend/data'), { recursive: true });
    rmSync(path.join(root, 'docs/specs/backend/surface.md'));
    editFile(root, PRODUCT_DECL_FILE, (text) => text.replace('  - data_tables\n', '').replace('  - surface\n', ''));
  }
  return root;
}

/** 製品の木の 1 ファイルを書き換える。 */
export function editFile(root: string, file: string, edit: (text: string) => string): void {
  const absolute = path.join(root, file);
  writeFileSync(absolute, edit(readFileSync(absolute, 'utf-8')));
}

/** 木の全ファイル(木の根からの相対パス。昇順)。 */
export function filesOf(root: string): readonly string[] {
  return walkFiles(root, () => true).map((file) => toRelative(root, file)).sort();
}

/** 本文を読む。 */
export function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf-8');
}

/** 木の全ファイルの指紋(相対パス → sha256)。書き換え・削除・追加を全部見つけるために使う。 */
export function fingerprintOf(root: string): ReadonlyMap<string, string> {
  return new Map(filesOf(root).map((file) => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]));
}

/** 製品の木に、書かれてはいけないファイルの見張り(実装・migration・仕様・book の外のメモ)を置く。 */
export function plantSentinels(root: string): readonly string[] {
  const sentinels = ['app/src/sentinel.ts', 'supabase/migrations/0000_sentinel.sql', 'docs/specs/sentinel-note.txt', 'docs/notes-outside-book.md'];
  for (const file of sentinels) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `見張り: ${file}\n`);
  }
  return sentinels;
}

/** 入口を実行する(`--root` は付ける。ほかの引数は呼び手が渡す)。 */
export function runBook(root: string, ...args: readonly string[]): CliRun {
  return runToolCli(cliPath('generate-book.ts'), TOOL_TREE, ['--root', root, ...args]);
}

/** 入口を、読み込みの記録つきで実行する。 */
export function runBookRecorded(root: string, logFile: string, ...args: readonly string[]): RecordedCliRun {
  return runToolCliRecorded(cliPath('generate-book.ts'), ['--root', root, ...args], logFile);
}

/** 全部入りの `generate` を、読み込みの記録つきで実行する(入口の「読み込まない」の対照に使う)。 */
export function runFullRecorded(root: string, logFile: string): RecordedCliRun {
  return runToolCliRecorded(cliPath('generate-docs.ts'), ['--root', root], logFile);
}

/**
 * 題材の保証台帳に、**道具の木の見張りテスト 1 件**(製品の実物の画面を読む配線の突合)の宣言を足す。
 *
 * 開発用の木の道具で別の題材を検証するテストは、道具の木の `__tests__/guarantees` にある、この製品の台帳が宣言している 1 件
 * (`@spec guarantee-catalog`)を、題材の台帳が宣言していないので孤児として Z3 に落とされる。配布の木にはそのテストファイルが無い
 * (開発用の木だけの事情)。題材に同じ宣言を足して、道具の木をまたいで検証する CLI のテストを終了コード 0 で通す。
 *
 * @param root 題材の写しの根
 * @returns 同じ根
 */
export function declareToolWatchTest(root: string): string {
  const watch = 'legacy/spec-tools/__tests__/guarantees/form-refresh-wiring.test.ts';
  // 配布の木にはそのテストファイルが無い(足すと逆に「ファイルが無い」で落ちる)。あるときだけ足す。
  if (!existsSync(path.join(TOOL_ROOT, watch))) return root;
  const name = 'changedFields を呼ぶ画面のファイルは全部、2 層の入力・editField・保存直後の held・共有の競合表示を配線している';
  editFile(root, 'docs/specs/backend/guarantees.md', (text) =>
    text
      .replace(
        '\nguarantees:\n',
        '\nguarantees:\n  - id: tool_watch_wiring\n    label: 道具の木の見張りテスト\n    enforced_by: [parity_test]\n    status: enforced\n    canaries: [TC-GUAR-FORMREFRESH-007]\n    summary: 道具の木の配線の突合\n',
      )
      .replace(
        '\ntest_cases:\n',
        `\ntest_cases:\n  - id: TC-GUAR-FORMREFRESH-007\n    type: unit\n    covers: [other]\n    spec_ids: [guarantee-catalog]\n    implementation: "${watch}::${name}"\n`,
      ),
  );
  return root;
}
