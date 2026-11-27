/**
 * G8 — ロゴ(アプリのアイコン)がテンプレート既定のまま出ていないこと。
 *
 * 経緯: 本番に出ていたのは Next のテンプレート既定の `favicon.ico`(create-next-app が
 * 置く Vercel の三角、25,931 バイト)だった。「ついそのまま」を人の目でのレビューに頼らず
 * 仕組みで検出する。
 *
 * 見るのは 4 点。
 *   (a) `brand.icon` が宣言されている(無ければ error)
 *   (b) 宣言したファイルが実在する
 *   (c) 宣言したファイルが Next テンプレート既定の favicon.ico と一致しない(SHA-256 比較)
 *   (d) アプリの枠が既定で置くアイコン(配置の役割 `app-icon` が置き場を決める)が残っていない(独自のアイコンがあれば既定は不要。
 *       既定の残骸を検出する)
 *
 * `brand.placeholder`(実物のロゴ待ちの受け入れ)を宣言している間は (b)(c) を warning に
 * 格下げする。(a)(d)は placeholder があっても常に error のまま —— 「宣言していない」
 * 「既定の残骸が残っている」は仮のロゴの有無とは無関係の別の不備だからである。
 *
 * **(b)(c)(d) は app/ の木がある環境でだけ見る。** 実ファイルとの突合であり、仕様だけを持つ
 * リポジトリ(サンプル・実装をまだ書いていない新規プロジェクト)では実ファイルが存在しえない
 * ので、飛ばさないと「placeholder を宣言し続ける以外に消せない warning」になる —— それは
 * placeholder を**回避の道具**にしてしまう形である(X1・J2 と同じ非対称。束 ⑲-1)。
 * (a) は仕様だけで判定できるので常に見る。
 *
 * `apple_icon` / `og_image`(任意)も宣言されていれば同じ (b)(c) を見る。
 */

import type { Finding } from '../../kernel/finding.js';
import { absentFor } from '../../kernel/scope-owner.js';
import { DESIGN_TOKENS_ID } from '../../model/design/catalog-id.js';
import type { BrandFileCheck, DesignInput, DesignTokenSpec } from '../../model/design/types.js';
import { designFinding, type DesignVerifier } from '../verifier.js';

/** brand の中でファイルパスを持つフィールド名(表示・pointer 用)。 */
type BrandFileField = 'icon' | 'apple_icon' | 'og_image';

/** 検証器 ID。 */
const ID = 'G8';

/**
 * Next.js create-next-app 既定の `favicon.ico`(Vercel の三角。25,931 バイト)の SHA-256。
 *
 * 削除する前の実物(`app/src/app/favicon.ico`)から算出した固定値であり、実行時にファイルを
 * 読んで求め直すことはできない(既定の残骸自体を削除する設計のため)。
 */
const DEFAULT_FAVICON_SHA256 = '2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932';

/** 実装の木(ロゴのファイル)との突合から出た指摘に印を付ける(`brand.icon` が宣言されていない、は仕様だけで決まるので付けない)。 */
function grounded(finding: Finding): Finding {
  return { ...finding, grounding: 'implementation' };
}

/** G8 検証器。 */
export const g8Brand: DesignVerifier = {
  id: ID,
  title: 'ロゴ(brand.icon)が宣言され、テンプレート既定の favicon.ico のまま出ていない',

  verify(input: DesignInput): Finding[] {
    const spec = input.tokens.spec;
    if (spec === null) return [];

    const findings: Finding[] = [];
    const brand = spec.brand;

    if (brand === null || brand.icon === null) {
      findings.push(
        designFinding(ID, {
          message: 'brand.icon が宣言されていません(アプリのアイコンは必須)',
          file: spec.file,
          pointer: 'brand.icon',
          suggestion:
            'brand: に icon: としてアプリのアイコンのファイルへのパスを書く(ファイル名の規約はアプリの枠の後段が持つ。置き場の配置の役割 app-icon)。実物のロゴがまだ無いなら、' +
            'placeholder に理由を添えて仮のアイコンを置く',
        }),
      );
    } else if (input.brand.appGrounded) {
      const severity = brand.placeholder === null ? 'error' : 'warning';
      findings.push(...fileFindings(spec, 'icon', brand.icon, input.brand.icon, severity).map(grounded));
      findings.push(...fileFindings(spec, 'apple_icon', brand.appleIcon, input.brand.appleIcon, severity).map(grounded));
      findings.push(...fileFindings(spec, 'og_image', brand.ogImage, input.brand.ogImage, severity).map(grounded));
      findings.push(...bookCopyFindings(spec, input.brand.icon, input.brand.bookCopy, severity).map(grounded));
    }

    const favicon = input.brand.faviconIcoPath;
    if (input.brand.appGrounded && input.brand.faviconIcoExists && favicon !== null) {
      findings.push(
        grounded(designFinding(ID, {
          message: `${favicon} が残っています(独自のアイコンを宣言したので、アプリの枠が既定で置くアイコンは要らない)`,
          file: spec.file,
          pointer: 'brand.icon',
          suggestion: `${favicon} を削除する(アプリの枠のテンプレート既定の残骸)`,
          counterexample: { file: favicon },
        })),
      );
    }

    return findings;
  },
};

/** brand の 1 フィールド分(icon / apple_icon / og_image)の (b)(c) を見る。 */
/**
 * PNG 等の二値ロゴは生成の文字列経路に載らないので、ハンドブック側の写しは手で置く。
 * 写しが無い・実装と中身が違う(腐った)は G8 が見る。SVG は生成物が写すので対象外。
 */
function bookCopyFindings(
  spec: DesignTokenSpec,
  icon: BrandFileCheck | null,
  bookCopy: BrandFileCheck | null,
  severity: Finding['severity'],
): Finding[] {
  if (icon === null || !icon.exists || bookCopy === null) return [];
  if (!bookCopy.exists) {
    return [
      designFinding(
        ID,
        {
          message: `ハンドブック側のロゴの写し ${bookCopy.declaredPath} がありません`,
          file: spec.file,
          pointer: 'brand.icon',
          suggestion: `cp ${icon.declaredPath} ${bookCopy.declaredPath}(二値ファイルは生成器が写せない)`,
          counterexample: { icon: icon.declaredPath, copy: bookCopy.declaredPath },
        },
        severity,
      ),
    ];
  }
  if (bookCopy.sha256 !== icon.sha256) {
    return [
      designFinding(
        ID,
        {
          message: `ハンドブック側のロゴの写し ${bookCopy.declaredPath} が実装 ${icon.declaredPath} と一致しません(写しが古い)`,
          file: spec.file,
          pointer: 'brand.icon',
          suggestion: `cp ${icon.declaredPath} ${bookCopy.declaredPath} で写し直す`,
          counterexample: { icon: icon.sha256 ?? "", copy: bookCopy.sha256 ?? "" },
        },
        severity,
      ),
    ];
  }
  return [];
}

function fileFindings(
  spec: DesignTokenSpec,
  field: BrandFileField,
  declaredPath: string | null,
  check: BrandFileCheck | null,
  severity: Finding['severity'],
): Finding[] {
  if (declaredPath === null) return [];
  const pointer = `brand.${field}`;
  if (check === null || !check.exists) {
    const missing = designFinding(
      ID,
      {
        message: `brand.${field} が指すファイル ${declaredPath} が実在しません`,
        file: spec.file,
        pointer,
        suggestion: '宣言したパスにファイルを置くか、パスを実在するファイルに直す',
        counterexample: { [field]: declaredPath },
      },
      severity,
    );
    // 印は「不在の error」専用。仮のアイコンを宣言した(brand.placeholder)ときは warning で、印は付けない(付けると仕分けが throw する)。
    return [severity === 'error' ? absentFor({ kind: 'catalog', id: DESIGN_TOKENS_ID }, missing) : missing];
  }
  if (check.sha256 === DEFAULT_FAVICON_SHA256) {
    return [
      designFinding(
        ID,
        {
          message:
            `brand.${field} が指すファイル ${declaredPath} は Next テンプレート既定の ` +
            `favicon.ico と同一内容です(「ついそのまま」)`,
          file: spec.file,
          pointer,
          suggestion: '実物のロゴ(または仮のアイコン)に差し替える',
          counterexample: { [field]: declaredPath, sha256: check.sha256 },
        },
        severity,
      ),
    ];
  }
  return [];
}
