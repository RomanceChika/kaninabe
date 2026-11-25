/**
 * K4 設定の URL は `format: url` と `scheme` を宣言し、読み口は関門を通る(ASVS V12.3.1)。
 *
 * 外へ出る URL(Webhook・招待・デプロイフック・自分のスタックの接続先)が平文の `http://` に化けると、
 * 秘密(Webhook の URL そのもの・Cron の合言葉)が盗聴される口になる。カタログと実装の両側を縛る。
 *
 * | 止める形 | 直し方 |
 * |---|---|
 * | `kind` の語が `url: true` なのに、その種類の行が `format: url` と `scheme` を宣言していない | 行に `format: url` と `scheme: https`(自分の機械への接続先だけ `https_or_loopback`)を書く |
 * | `format: url` の設定を実装の木(ソースの根の下。テストを除く)で素の `process.env` / `requireEnv` のまま読んでいる | `readConfigUrl('NAME', process.env['NAME'], '<scheme>')` に変える |
 * | 関門の `scheme` の綴りがカタログの宣言と違う | カタログの `scheme` に合わせる(関門の綴りが正ではない) |
 *
 * 読むのは軸(`url` の旗・`format`・`scheme`)だけで、**アプリの語彙(kind の語・変数名)は 1 語も持たない**。
 * 走査(I/O)は実行口が済ませ、ここは純粋なデータだけを見る。
 */

import type { Finding } from '../../kernel/finding.js';
import type { ConfigSpecModel } from '../../model/config/types.js';
import { sourceRootPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { UrlReadScan } from '../url-read-scan.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'K4';

/** テストの置き場とテストファイル(出荷物に載らない。テストは敵対的な値や固定の接続先を自分で組む)。 */
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** K4 の指摘を組み立てる。 */
function k4Finding(args: Omit<Finding, 'verifier' | 'severity'>): Finding {
  return { verifier: VERIFIER_ID, severity: 'error', ...args };
}

/** K4 の入力。 */
export interface UrlFormatInput {
  /** 読み込み済みの設定カタログ。 */
  readonly config: ConfigSpecModel;
  /** 読み口の数え上げ(走査できなかったら `available: false` で読み口は見ない)。 */
  readonly urlReads: UrlReadScan;
  /** 製品が宣言した根(ソースの根の場所)。 */
  readonly roots: ProductRoots;
  /** 置き場の配置。 */
  readonly layout: ProductLayout;
}

/**
 * カタログの宣言と読み口を突き合わせる。
 *
 * @param input カタログと読み口の数え上げ
 * @returns 違反のリスト
 */
export function verifyUrlFormat(input: UrlFormatInput): Finding[] {
  const catalog = input.config.catalog;
  if (catalog === null) return [];
  const urlKinds = new Set(catalog.vocabulary.kind.filter((term) => term.url === true).map((term) => term.id));
  const findings: Finding[] = [];
  for (const decl of catalog.variables) {
    if (urlKinds.has(decl.kind) && decl.format !== 'url') {
      findings.push(
        k4Finding({
          message: `設定 ${decl.id} は種類 ${decl.kind} (url: true)なのに format: url と scheme を宣言していません`,
          location: decl.location,
          suggestion:
            `${decl.id} の行に "format: url" と "scheme: https" を書く(自分の機械への接続先だけ https_or_loopback)。` +
            '外へ出る URL が平文の http に化けるのを、カタログの側で止める',
          counterexample: { variable: decl.id, kind: decl.kind },
        }),
      );
    }
  }
  if (!input.urlReads.available) return findings;
  const srcRoot = sourceRootPath(input.layout, input.roots);
  if (srcRoot === null) return findings;
  const prefix = `${srcRoot}/`;
  const declared = new Map(catalog.variables.flatMap((decl) => (decl.format === 'url' && decl.scheme !== undefined ? [[decl.id, decl.scheme] as const] : [])));
  for (const read of input.urlReads.reads) {
    const scheme = declared.get(read.name);
    if (scheme === undefined || !read.file.startsWith(prefix) || TEST_FILE.test(read.file)) continue;
    if (read.raw > read.guarded.length) {
      findings.push(
        k4Finding({
          message: `${read.file} が URL の設定 ${read.name} を関門(readConfigUrl)を通さずに読んでいます`,
          location: catalog.location,
          suggestion:
            `readConfigUrl('${read.name}', process.env['${read.name}'], '${scheme}') の形で読む(@kaninabe/runtime/url。` +
            '宣言した scheme に合わない値は例外になる。素の参照が残ると、平文の送り先を黙って使える口が残る)',
          counterexample: { variable: read.name, file: read.file, scheme },
        }),
      );
    }
    for (const written of new Set(read.guarded)) {
      if (written === scheme) continue;
      findings.push(
        k4Finding({
          message: `${read.file} の readConfigUrl('${read.name}', …) の scheme ${written} がカタログの宣言(${scheme})と違います`,
          location: catalog.location,
          suggestion: `scheme を '${scheme}' に直す(正はカタログの宣言。緩めたいときはカタログの scheme を変え、理由を summary に残す)`,
          counterexample: { variable: read.name, file: read.file, written, declared: scheme },
        }),
      );
    }
  }
  return findings;
}
