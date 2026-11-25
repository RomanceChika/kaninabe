/**
 * K6 秘密の宣言(寿命・強さ・更新の間の旧い値)と、サービスの認証の秘密の読み口(ASVS V11.1.1 / V11.2.2 / V13.2.3)。
 *
 * | 止める形 | 直し方 |
 * |---|---|
 * | `confidential: true` の種類の行が `rotation`(寿命・更新の手順・持つ者)を宣言していない | 行に `rotation: { every, procedure, holders }` を書く。運営が決めていない値は「仮置き」と明記する |
 * | サービスの認証の秘密(`service_auth: true` の使い先の秘密・受信の署名の鍵)が `strength` を宣言していない | 行に `strength: { min_length: n }` を書く |
 * | `previous` が宣言された行を指していない・`strength` の無い行が持つ・種類が違う・連鎖する・別の行と共有する | 更新の間だけ旧い値を入れる行を別に宣言し、`strength` のある行から 1 対 1 で指す |
 * | `strength` のある秘密(と `previous`)を実装の木(テストを除く)が関門(`readServiceSecret`)を通さずに読んでいる | `readServiceSecret('NAME', process.env['NAME'], {min_length})` に変える(@kaninabe/runtime/secret) |
 * | 関門に書いた下限がカタログの `min_length` と違う | カタログの値に合わせる(正はカタログ) |
 *
 * 読むのは軸(`confidential` / `service_auth` の旗・`rotation` / `strength` / `previous`)だけで、**アプリの語彙(kind の語・変数名)は 1 語も持たない**。
 * 走査(I/O)は実行口が済ませ、ここは純粋なデータだけを見る。
 */

import type { Finding } from '../../kernel/finding.js';
import type { ConfigSpecModel, ConfigVariableDecl } from '../../model/config/types.js';
import { sourceRootPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { SecretReadScan } from '../secret-read-scan.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'K6';

/** テストの置き場とテストファイル(出荷物に載らない)。 */
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/u;

/** K6 の指摘を組み立てる。 */
function k6Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** K6 の入力。 */
export interface SecretDeclarationsInput {
  /** 読み込み済みの設定カタログ。 */
  readonly config: ConfigSpecModel;
  /** 受信の署名の鍵として指されている設定の id(外部連携カタログの `signature_key`)。 */
  readonly inboundKeys: readonly string[];
  /** 読み口の数え上げ(走査できなかったら `available: false` で読み口は見ない)。 */
  readonly secretReads: SecretReadScan;
  /** 製品が宣言した根(ソースの根の場所)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置。 */
  readonly layout: ProductLayout;
}

/**
 * 宣言と読み口を検査する。
 *
 * @param input カタログと読み口の数え上げ
 * @returns 違反のリスト
 */
export function verifySecretDeclarations(input: SecretDeclarationsInput): Finding[] {
  const catalog = input.config.catalog;
  if (catalog === null) return [];
  const secretKinds = new Set(catalog.vocabulary.kind.filter((term) => term.confidential === true).map((term) => term.id));
  const serviceAuthUses = new Set(catalog.vocabulary.used_by.filter((term) => term.serviceAuth === true).map((term) => term.id));
  const byId = new Map(catalog.variables.map((decl) => [decl.id, decl] as const));
  const owners = new Map<string, ConfigVariableDecl[]>();
  for (const decl of catalog.variables) {
    if (decl.previous !== undefined) owners.set(decl.previous, [...(owners.get(decl.previous) ?? []), decl]);
  }
  const findings: Finding[] = [];
  for (const decl of catalog.variables) {
    const isPrevious = owners.has(decl.id);
    if (secretKinds.has(decl.kind) && !isPrevious && decl.rotation === undefined) {
      findings.push(
        k6Finding({
          message: `設定 ${decl.id} は種類 ${decl.kind} (confidential: true)なのに rotation(寿命・更新の手順・持つ者)を宣言していません`,
          location: decl.location,
          suggestion:
            `${decl.id} の行に rotation: { every: "365 day", procedure: …, holders: […] } を書く(ASVS V11.1.1)。` +
            '運営がまだ決めていない値は「仮置き・運用で決める」と根拠に明記する(組織の事実を発明しない)',
          counterexample: { variable: decl.id, kind: decl.kind },
        }),
      );
    }
    const serviceAuth = (secretKinds.has(decl.kind) && decl.usedBy.some((use) => serviceAuthUses.has(use))) || input.inboundKeys.includes(decl.id);
    if (serviceAuth && !isPrevious && decl.strength === undefined) {
      findings.push(
        k6Finding({
          message: `設定 ${decl.id} はサービスの認証の秘密(共有秘密だけで口を開ける)なのに strength を宣言していません`,
          location: decl.location,
          suggestion: `${decl.id} の行に strength: { min_length: n } を書く(ASVS V13.2.3。実装は readServiceSecret で読み、下限に満たない値は未設定と同じに閉じる)`,
          counterexample: { variable: decl.id },
        }),
      );
    }
    if (decl.previous !== undefined) findings.push(...previousFindings(decl, byId, owners));
  }
  return [...findings, ...readFindings(input, catalog.location, byId, owners)];
}

/** `previous` の宣言の整合(行が実在する・強さのある行だけが持つ・種類が同じ・連鎖しない・共有しない)。 */
function previousFindings(
  decl: ConfigVariableDecl,
  byId: ReadonlyMap<string, ConfigVariableDecl>,
  owners: ReadonlyMap<string, readonly ConfigVariableDecl[]>,
): Finding[] {
  const previous = decl.previous;
  if (previous === undefined) return [];
  const problems: string[] = [];
  const target = byId.get(previous);
  if (target === undefined) problems.push(`${previous} という設定の行がありません`);
  else {
    if (target.kind !== decl.kind) problems.push(`${previous} の種類 ${target.kind} が ${decl.id} の種類 ${decl.kind} と違います`);
    if (target.previous !== undefined) problems.push(`${previous} がさらに previous を持っています(旧い値の連鎖は作らない)`);
  }
  if (decl.strength === undefined) problems.push(`${decl.id} が strength を持っていません(previous はサービスの認証の秘密の行だけが持つ)`);
  if ((owners.get(previous)?.length ?? 0) > 1) problems.push(`${previous} を複数の行が previous に指しています`);
  return problems.map((problem) =>
    k6Finding({
      message: `設定 ${decl.id} の previous: ${problem}`,
      location: decl.location,
      suggestion: '更新の間だけ旧い値を入れる行を別に宣言し(例 CRON_SECRET_PREVIOUS。種類は同じ・strength は持たなくてよい)、strength のある行から 1 対 1 で指す(ASVS V11.2.2)',
      counterexample: { variable: decl.id, previous },
    }),
  );
}

/** 実装の木の読み口が関門を通っているか(`strength` のある行と、その `previous` の行)。 */
function readFindings(
  input: SecretDeclarationsInput,
  location: Finding['location'],
  byId: ReadonlyMap<string, ConfigVariableDecl>,
  owners: ReadonlyMap<string, readonly ConfigVariableDecl[]>,
): Finding[] {
  if (!input.secretReads.available) return [];
  const srcRoot = sourceRootPath(input.layout, input.roots);
  if (srcRoot === null) return [];
  const prefix = `${srcRoot}/`;
  const findings: Finding[] = [];
  for (const read of input.secretReads.reads) {
    const decl = byId.get(read.name);
    const minLength = decl?.strength?.minLength ?? owners.get(read.name)?.[0]?.strength?.minLength;
    if (minLength === undefined || !read.file.startsWith(prefix) || TEST_FILE.test(read.file)) continue;
    if (read.raw > read.guarded.length) {
      findings.push(
        k6Finding({
          message: `${read.file} がサービスの認証の秘密 ${read.name} を関門(readServiceSecret)を通さずに読んでいます`,
          location,
          suggestion:
            `readServiceSecret('${read.name}', process.env['${read.name}'], ${String(minLength)}) の形で読む(@kaninabe/runtime/secret。` +
            '下限に満たない値は未設定と同じに閉じる。素の参照が残ると、短い秘密で口が開く読み口が残る)',
          counterexample: { variable: read.name, file: read.file, minLength: String(minLength) },
        }),
      );
    }
    for (const written of new Set(read.guarded)) {
      if (written === minLength) continue;
      findings.push(
        k6Finding({
          message: `${read.file} の readServiceSecret('${read.name}', …) の下限 ${String(written)} がカタログの宣言(${String(minLength)})と違います`,
          location,
          suggestion: `下限を ${String(minLength)} に直す(正はカタログの strength.min_length。変えたいときはカタログを変え、理由を summary に残す)`,
          counterexample: { variable: read.name, file: read.file, written: String(written), declared: String(minLength) },
        }),
      );
    }
  }
  return findings;
}
