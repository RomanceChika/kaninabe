/**
 * K3 置き場の宣言(`targets`)⇔ その置き場の読み口(`read_by`)の双方向一致。
 *
 * config-spec-writing.md の要求:
 *   - `targets` にその置き場を持つ行は、その置き場の読み口に現れること
 *   - 読み口に現れる設定は、`targets` にその置き場を持つこと
 *
 * K1 が見るのは「**どこかで**読まれているか」なので、`targets` を取り違えても通ってしまう ——
 * CI だけに要る秘密の行に `targets: [local]` と書いても K1 は緑である。K3 が閉じるのはそこで、
 * **「CD を通すのに要る設定はこれで全部」がカタログの側から機械で答えられる**状態にする。
 *
 * これが無い間、CD が要る設定の正は**workflow の手書きの分岐**にしか無かった(設計メモ
 * `docs/design/config-provisioning.md` §1-1 の穴 3)。挙動は `absence` が、要る場所は
 * `targets` が持ち、workflow はそれを執行するだけ、という向きに直すための検査である。
 *
 * カタログに 1 行も無い名前(読み口にだけ現れる設定)は K1 が「宣言がありません」で落とすので、
 * ここでは指摘しない —— 同じ 1 つの間違いに 2 つの指摘を出すと、どちらを直せば消えるのかが
 * 読めなくなる。
 */

import type { Finding } from '../../kernel/finding.js';
import type { ConfigCatalogSpec, ConfigSpecModel, ConfigVariableDecl } from '../../model/config/types.js';
import type { TargetScanResult } from '../env-scan.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'K3';

/** K3 の指摘を組み立てる。 */
function k3Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** K3 の入力(読み口の走査は I/O 境界が済ませてある)。 */
export interface TargetReaderParityInput {
  /** 読み込み済みの設定カタログ。 */
  readonly config: ConfigSpecModel;
  /** 置き場の読み口の走査結果(走査できなかった置き場は見ない)。 */
  readonly targetScan: TargetScanResult;
}

/**
 * 置き場の宣言と読み口を双方向に突き合わせる。
 *
 * @param input カタログと読み口の走査結果
 * @returns 違反のリスト
 */
export function verifyTargetReaderParity(input: TargetReaderParityInput): Finding[] {
  const catalog = input.config.catalog;
  if (catalog === null) return [];

  const findings: Finding[] = [];
  const declaredNames = new Set(catalog.variables.map((decl) => decl.id));
  for (const target of input.targetScan.scanned) {
    const read = new Map<string, string>();
    for (const reference of input.targetScan.references) {
      if (reference.target === target) read.set(reference.name, reference.file);
    }
    findings.push(...missingInReader(catalog.variables, target, read));
    findings.push(...missingInCatalog(catalog, target, read, declaredNames));
  }
  return findings;
}

/** `targets` にその置き場を持つのに、読み口が読んでいない行。 */
function missingInReader(
  variables: readonly ConfigVariableDecl[],
  target: string,
  read: ReadonlyMap<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const decl of variables) {
    if (!decl.targets.includes(target) || read.has(decl.id)) continue;
    findings.push(
      k3Finding({
        message: `設定 ${decl.id} は targets に ${target} を持つのに、その置き場の読み口が読んでいません`,
        location: decl.location,
        suggestion:
          `置き場 ${target} の read_by が指す場所でこの設定を読むか、targets から ${target} を外す` +
          '(置き場に入れても誰も読まない設定は、入れ忘れと区別がつかない)',
        counterexample: { variable: decl.id, target },
      }),
    );
  }
  return findings;
}

/** 読み口が読んでいるのに、`targets` にその置き場を持たない行。 */
function missingInCatalog(
  catalog: ConfigCatalogSpec,
  target: string,
  read: ReadonlyMap<string, string>,
  declaredNames: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(catalog.variables.map((decl) => [decl.id, decl]));
  for (const [name, file] of read) {
    if (!declaredNames.has(name)) continue;
    const decl = byId.get(name);
    if (decl === undefined || decl.targets.includes(target)) continue;
    findings.push(
      k3Finding({
        message: `${file} が読んでいる設定 ${name} の targets に ${target} がありません`,
        location: decl.location,
        suggestion:
          `targets に ${target} を足す(置き場に値が要ることの宣言であり、doctor が照合する先になる)` +
          'か、読む側をやめる',
        counterexample: { variable: name, target, file },
      }),
    );
  }
  return findings;
}
