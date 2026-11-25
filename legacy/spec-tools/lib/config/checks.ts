/**
 * 設定仕様の検査(K 群)の登録 — どの検査を、どの順で実行するか。
 *
 * 実行口(`run.ts`)はここの `CONFIG_STEPS` を上から回すだけである(走査の I/O は実行口が済ませ、検査には結果だけを渡す)。
 * 並びは**違反の並び**を決める。ID は各検証器のファイルが持つ `VERIFIER_ID` を参照する。全検査の表は `CONFIG_CHECKS` を読む。
 */

import type { Finding } from '../kernel/finding.js';
import type { CheckEntry } from '../kernel/check-entry.js';
import { K0_VERIFIER_ID } from '../model/config/loader.js';
import type { ConfigRunInput } from './run.js';
import type { EnvScanResult, TargetScanResult } from './env-scan.js';
import type { UrlReadScan } from './url-read-scan.js';
import type { SecretReadScan } from './secret-read-scan.js';
import { VERIFIER_ID as K1, verifyEnvReferenceParity } from './verifiers/k1-env-reference-parity.js';
import { VERIFIER_ID as K2, verifyTemplateParity } from './verifiers/k2-template-parity.js';
import { VERIFIER_ID as K3, verifyTargetReaderParity } from './verifiers/k3-target-reader-parity.js';
import { VERIFIER_ID as K4, verifyUrlFormat } from './verifiers/k4-url-format.js';
import { VERIFIER_ID as K5, verifyLogSink } from './verifiers/k5-log-sink.js';
import { VERIFIER_ID as K6, verifySecretDeclarations } from './verifiers/k6-secret-declarations.js';

/** 実行口が済ませた走査の結果(検査には純粋なデータだけを渡す)。 */
export interface ConfigScans {
  /** 実装の `process.env` 参照の走査。 */
  readonly scan: EnvScanResult;
  /** 雛形(`.env.example`)の読み取り。 */
  readonly template: readonly string[] | null;
  /** 置き場の読み口の走査。 */
  readonly targetScan: TargetScanResult;
  /** URL の設定の読み口の数え上げ(K4)。 */
  readonly urlReads: UrlReadScan;
  /** サービスの認証の秘密の読み口の数え上げ(K6)。 */
  readonly secretReads: SecretReadScan;
}

/** 実行の段 1 つ(検査 1 本)。 */
export interface ConfigStep extends CheckEntry {
  /** 検査を実行し、違反を返す。 */
  run(input: ConfigRunInput, scans: ConfigScans): Finding[];
}

/** 実行の順(違反の並びを決める)。 */
export const CONFIG_STEPS: readonly ConfigStep[] = [
  {
    id: K1,
    title: '設定カタログ ⇔ 実装の process.env 参照の双方向閉世界',
    run: (i, s) => verifyEnvReferenceParity({ config: i.config, scan: s.scan, targetScan: s.targetScan, roots: i.roots, layout: i.layout }),
  },
  {
    id: K2,
    title: '設定カタログ ⇔ 雛形(.env.example)の双方向一致',
    run: (i, s) => verifyTemplateParity({ config: i.config, template: s.template, roots: i.roots, layout: i.layout }),
  },
  { id: K3, title: '置き場の宣言(targets)⇔ その置き場の読み口(read_by)の双方向一致', run: (i, s) => verifyTargetReaderParity({ config: i.config, targetScan: s.targetScan }) },
  {
    id: K4,
    title: '外へ出る URL の設定は format: url と scheme(https)を宣言し、実装の読み口は関門(readConfigUrl)を通る',
    run: (i, s) => verifyUrlFormat({ config: i.config, urlReads: s.urlReads, roots: i.roots, layout: i.layout }),
  },
  { id: K5, title: 'ログの目録(logging)の宣言と、転送先がホストの外にあること(本番の転送先の設定は未検証と名指す)', run: (i) => verifyLogSink({ config: i.config }) },
  {
    id: K6,
    title: '秘密の行は rotation を、サービスの認証の秘密は strength を宣言し、実装の読み口は関門(readServiceSecret)を通る。previous は 1 対 1 で整合する',
    run: (i, s) => verifySecretDeclarations({ config: i.config, inboundKeys: i.inboundKeys ?? [], secretReads: s.secretReads, roots: i.roots, layout: i.layout }),
  },
];

/** K 群の全検査(ローダーの K0 を含む。全検査の表が読む)。 */
export const CONFIG_CHECKS: readonly CheckEntry[] = [
  { id: K0_VERIFIER_ID, title: 'config のスキーマ適合(ローダーが実施)' },
  ...CONFIG_STEPS,
];
