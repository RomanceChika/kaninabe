/**
 * **外へ通信しないビルド**の入口(`node build-offline.mjs <包みの bin の名前 | node> [引数…]`。例: `node ../framework/runtime/scripts/build-offline.mjs next build`)。
 *
 * 命令を、外への通信の見張り(`offline-guard.mjs`。`NODE_OPTIONS=--import` で子のプロセスにも引き継ぐ)の下で回す。命令が通っても、
 * どれかのプロセスが手元の外へ出ようとした記録が残っていれば、宛先を名指して赤で終わる(見張りの例外を命令の側が握りつぶしても見逃さない)。
 * 許す宛先の表(`offline-hosts.mjs` の `ALLOWED_HOSTS`)は閉じていて**空**である。Next.js の利用状況の送信は切る(`NEXT_TELEMETRY_DISABLED=1`。切らないと外へ出る)。
 * 製品の設定が外へ出る機能を持てば(例: next の `experimental.agentUpgrade` の既定 `security` = build のたびに npm の脆弱性の一覧を取る)、ここが赤にする。
 *
 * **命令は PATH で引かない**(点検 9 回目 C9-5 の名前で引く外部コマンドの規則): 名前は今の場所から解いた包みの `package.json` の `bin` の JS で、
 * 今の node(`process.execPath`)で回す。`node` は今の node そのもの(引数をそのまま渡す)。`node_modules/.bin` に同じ名前の偽物が居ても動かない。
 *
 * 終了コード: 命令の終了コード。命令が 0 でも外への通信の記録があれば 1。依存は node の標準だけ。
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 見張りの前置き(この隣。`--import` は URL で渡す)。 */
export const GUARD_URL = new URL('./offline-guard.mjs', import.meta.url).href;

/**
 * 記録の行を、人が読む宛先の一覧にする(重複を除く)。
 *
 * @param {string} text 記録(`口\t宛先\tpid` の行)
 * @returns {string[]} `宛先(口)` の並び
 */
export function attemptsOf(text) {
  const seen = new Set();
  for (const line of text.split('\n')) {
    const [via, host] = line.split('\t');
    if (via !== undefined && via !== '' && host !== undefined) seen.add(`${host}(${via})`);
  }
  return [...seen];
}

/**
 * 既にある `NODE_OPTIONS` に見張りの前置きを足した値。
 *
 * @param {string} existing - 既にある `NODE_OPTIONS`(無ければ空文字)
 * @returns {string} 足した値
 */
export function nodeOptionsWith(existing) {
  return [existing, `--import=${GUARD_URL}`].filter((part) => part !== '').join(' ');
}

/**
 * 命令の名前を、今の node に渡す引数の頭にする(`node` は空・それ以外は包みの bin の JS の絶対パス)。
 *
 * @param {string} name - 包みの bin の名前か `node`
 * @param {string} from - 包みを解く場所
 * @returns {string[]} 今の node に渡す引数の頭
 */
export function scriptOf(name, from) {
  if (name === 'node') return [];
  const manifest = createRequire(join(from, 'package.json')).resolve(`${name}/package.json`);
  const bin = /** @type {{ bin?: string | Record<string, string> }} */ (JSON.parse(readFileSync(manifest, 'utf8'))).bin;
  const entry = typeof bin === 'string' ? bin : bin?.[name];
  if (entry === undefined) throw new Error(`build-offline: 包み ${name} は bin ${name} を持ちません`);
  return [join(dirname(manifest), entry)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    console.error('build-offline: 使い方は node build-offline.mjs <包みの bin の名前 | node> [引数…]');
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'st-build-offline-'));
  const log = join(dir, 'outbound.log');
  // 環境は名指しで書き足して子に引き継ぐ(環境をまるごと組み直して渡さない = K1 が読める形)。
  process.env['NODE_OPTIONS'] = nodeOptionsWith(process.env['NODE_OPTIONS'] ?? '');
  process.env['ST_OUTBOUND_LOG'] = log;
  // Next.js の利用状況の送信は外への通信なので切る。
  process.env['NEXT_TELEMETRY_DISABLED'] = '1';
  const run = spawnSync(process.execPath, [...scriptOf(command, process.cwd()), ...args], { stdio: 'inherit' });
  const attempts = existsSync(log) ? attemptsOf(readFileSync(log, 'utf8')) : [];
  rmSync(dir, { recursive: true, force: true });
  if (attempts.length > 0) {
    console.error(`build-offline: ビルドが外へ通信しようとしました: ${attempts.join(', ')}。ビルドは手元だけで閉じます(許す宛先の表は空。書体は next/font/local で同梱する)`);
    process.exit(1);
  }
  if (run.error !== undefined) {
    console.error(`build-offline: ${command} を起動できませんでした: ${run.error.message}`);
    process.exit(1);
  }
  process.exit(run.status ?? 1);
}
