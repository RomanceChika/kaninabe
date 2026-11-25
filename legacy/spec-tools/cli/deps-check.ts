/**
 * 依存の脆弱性の検査 CLI(`npm run deps:check`)。
 *
 * 使い方: npm run deps:check [-- [--sbom] [--ship-gate] [--root <path>]]
 *   - 製品の中の全 lockfile(ルート・ワークスペース外の道具・docs など。配置から発見する)に、`npm audit` と OSV と署名と公開日時の待ちを当てる
 *   - 結果は `LATEST_FILE`(時刻つき)に書き、1 画面の要約を出す
 *   - `--sbom` … 続けて CycloneDX の SBOM(本番の部品のみ)を lockfile ごとに `tmp/deps-check/sbom-*.json` へ書く(出荷のたびに作る。方針は dependency-patch-policy.md)
 *   - `--ship-gate` … 出荷の関門の判定(公開から 7 日未満の版と、署名のほかの未実施を赤にする。`lib/deps/ship-gate.ts`。8 回目 C8-2)。
 *     夜間の出荷の前に、依存を入れないジョブで `npm run deps:check:gate` として回す(tsx を使わず `node` で直に読む。ここから辿る部品は `node:` 以外を import しない)
 *   - `--complete` … 全部を確かめた実行の判定(未実施の部分を全部赤にする。`applyCompleteRun`)。開発用リポジトリの取り込みの台本(段 deps)が使う
 *   - `--fresh` … 検査を回さずに、最後に全部を確かめて通った実行の印(`LATEST_FILE`)が `STALE_DAYS` 日以内で、印が確かめた lockfile の中身(sha256)が
 *     今の lockfile の全部と同じかだけを答える(そうなら 0・古い/無い/赤/未実施が残った/lockfile が変わったなら 1)。
 *     取り込みの台本が「回すか」を決めるのに使う(日数の上限は verify の範囲サマリと同じ 1 つの値。新しい宣言を持たない)
 *   - 終了コード: 赤が 1 件でもあれば 1。通信できない部分は「未実施」と記録して 0 のまま(`--ship-gate` と `--complete` では赤)
 *
 * この CLI が持つのは根の決定と出力だけ。判定は `lib/deps/` が持つ(外への口は `deps-check-io.ts`)。
 */

import process from 'node:process';
import { discoverLockfiles, lockfileDigest } from '../lib/deps/lockfile.js';
import { formatSboms, writeSboms } from '../lib/deps/sbom.js';
import { runDepsCheck } from '../lib/deps/run.js';
import { describeFreshness, formatDepsReport } from '../lib/deps/report.js';
import { applyCompleteRun, applyShipGate } from '../lib/deps/ship-gate.js';
import { LATEST_FILE } from '../lib/deps/types.js';
import { readScratchText } from '../lib/io/scratch.js';
import { realDepsIo, writeLatest } from './deps-check-io.js';
import { repoRootOrExit } from './repo-root.js';

const root = repoRootOrExit('deps:check', process.argv.slice(2));
if (process.argv.includes('--fresh')) {
  // 印が確かめた lockfile の中身と今の中身を比べる(本数・パス・sha256。差分点検 A27-2)。発見の口は検査を回すときと同じ。
  const fresh = realDepsIo(root);
  const current = Object.fromEntries(discoverLockfiles({ list: fresh.list, isDirectory: fresh.isDirectory, isFile: (rel) => fresh.readText(rel) !== null }).map((file) => [file, lockfileDigest(fresh.readText(file) ?? '')]));
  const freshness = describeFreshness(readScratchText(root, LATEST_FILE), new Date(), { complete: true, lockfiles: current });
  console.log(freshness.line);
  process.exit(freshness.stale ? 1 : 0);
}
const io = realDepsIo(root);
const checked = await runDepsCheck(io, root);
const report = process.argv.includes('--ship-gate') ? applyShipGate(checked) : process.argv.includes('--complete') ? applyCompleteRun(checked) : checked;
writeLatest(root, LATEST_FILE, `${JSON.stringify(report, null, 2)}\n`);
for (const line of formatDepsReport(report, LATEST_FILE)) console.log(line);
let sbomFailed = false;
if (process.argv.includes('--sbom')) {
  const lockfiles = discoverLockfiles({ list: io.list, isDirectory: io.isDirectory, isFile: (rel) => io.readText(rel) !== null });
  const sboms = await writeSboms(io, lockfiles, root);
  for (const line of formatSboms(sboms)) console.log(line);
  sbomFailed = sboms.some((sbom) => sbom.file === null);
}
process.exit(report.ok && !sbomFailed ? 0 : 1);
