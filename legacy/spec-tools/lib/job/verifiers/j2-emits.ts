/**
 * J2(続き)走査が積む通知の宣言(`emits`)の接地 — 積む先の実在と、語と宣言の対。
 *
 * 時刻で起きる走査は、遷移を起こさず outbox に通知を積むことがある(開演前のリマインド等)。
 * `emits` はそれを**名指しで宣言する**口で、受信 Webhook の `emits`(外から届いてイベントを起こす)と並ぶ、
 * 通知の**3 つ目の発火元**である。この検査が見るのは、仕様の中で閉じる 2 点である。
 *
 * | 見ること | なぜ |
 * |---|---|
 * | `emits` の ID が `source: outbox` のジョブ行として宣言されている | 走査が積む行は outbox のキューに入り、ワーカーがハンドラで実行する。ジョブの行が無い種別を積むと、ハンドラの閉世界(job-catalog)の外へ出る。`manual` / `schedule` の行は積まれる側ではない |
 * | `kind` の語の `declares: [emits]` と行の `emits` が対である | 機械が読むのは `emits` の有無で、語(催促・リマインドの呼び名)はカタログが宣言する。**語を選んで `emits` を書き忘れた行**(`emits` を持つ行が他に無くても)も、**`emits` を持つのに宣言の無い語を選んだ行**も落ちる(`anonymizes` と同じ形。体系は語の綴りを比べない) |
 *
 * 通知カタログ側の実在(積む先が通知か・`trigger` は何か)は N1 が見る。通知でない効果を積む走査は
 * `emits` の外にある(`emits` は通知 ID の一覧)。
 */

import type { Finding } from '../../kernel/finding.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';
import { declaresMismatches } from '../declares.js';
import type { JobSpecModel } from '../../model/job/types.js';

/** この検証器の ID(J2 の続き)。 */
export const VERIFIER_ID = 'J2';

/** J2 の指摘を組み立てる。 */
function j2Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/**
 * `emits` の接地を検証する。
 *
 * @param jobs 読み込み済みのジョブカタログ
 * @param roots 製品が宣言した根(道案内のパス)
 * @returns 違反のリスト
 */
export function verifyEmits(jobs: JobSpecModel, roots: ProductRoots): Finding[] {
  const catalog = jobs.catalog;
  if (catalog === null) return [];
  const jobsPath = specPath(roots, 'backend/jobs.md');
  const sources = new Map(catalog.jobs.map((decl) => [decl.id, decl.source]));

  const grounded = catalog.jobs.flatMap((decl) =>
    (decl.schedule?.emits ?? [])
      .filter((emitted) => sources.get(emitted) !== 'outbox')
      .map((emitted) =>
        j2Finding({
          message:
            sources.has(emitted)
              ? `ジョブ ${decl.id} の emits ${emitted} は source: ${sources.get(emitted) ?? ''} の行で、走査が積む先(outbox)ではありません`
              : `ジョブ ${decl.id} の emits ${emitted} がジョブカタログに無い種別です`,
          location: decl.location,
          suggestion:
            `${jobsPath} の jobs に "- id: ${emitted} / source: outbox" の行を足す(走査が積む種別もワーカーが実行する。` +
            '行が無いと実行するハンドラの閉世界の外に出る)',
          counterexample: { job: decl.id, emits: emitted },
        }),
      ),
  );

  const pairing = declaresMismatches(catalog, 'emits', (decl) => decl.schedule?.emits !== undefined).map(
    ({ decl, problem }) =>
      problem === 'missing'
        ? j2Finding({
            message: `${decl.id} の kind ${decl.kind} は emits を必ず持つ語(declares)なのに、emits がありません`,
            location: decl.location,
            suggestion:
              `この走査が積む通知の ID を emits に書く。通知を積まない走査なら、${jobsPath} で別の kind の語を宣言して選ぶ` +
              '(機械が読むのは emits の有無であり、語はその宣言の呼び名である)',
            counterexample: { job: decl.id, kind: decl.kind },
          })
        : j2Finding({
            message: `${decl.id} は emits を持つのに、kind ${decl.kind} が emits を declares していません`,
            location: decl.location,
            suggestion:
              `${jobsPath} の vocabulary.kind の ${decl.kind} に "declares: [emits]" を足す` +
              '(語を選べば宣言が付いてくる形にする。足したあとは、その語を選ぶ行が emits を書き忘れると落ちる)',
            counterexample: { job: decl.id, kind: decl.kind },
          }),
  );
  return [...grounded, ...pairing];
}
