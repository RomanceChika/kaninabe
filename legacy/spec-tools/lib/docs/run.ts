/**
 * 文書整合検証(M1〜M6)の実行口。リンクの実在(M4)だけは、`docs/` の下の全部の .md と根の文書(CLAUDE.md)を見る(下の範囲は `link-scan.ts`)。
 *
 * ローダー(docs/rules・docs/specs・docs/knowledge の走査)を呼び、構築したモデルを ALL_DOC_VERIFIERS に流す
 * ところまでをまとめる。CLI はこの 1 関数だけを呼べばよく、検証器が増えてもここも CLI も変わらない
 * (規約: scripts-code-quality.md)。
 *
 * 走査ルートは 3 つ(rules / specs / knowledge)だが**台帳は 1 つ**にまとめてから検証器へ渡す。
 * ツリーごとに別々に検証すると、rules 側と specs 側が同じ id を宣言している状態を
 * M2 が構造的に検出できない(実際に DG-0038 がその状態で残っていた)。
 *
 * あわせて「片方のルートから 1 件も読めていない」ことを M0 として警告する。
 * 走査範囲が黙って狭まる事故は検証が緑のまま進むため、範囲そのものを検証結果に載せる。
 */

import type { Finding } from '../kernel/finding.js';
import { toRelative } from '../io/paths.js';
import { loadDocs, type LoadDocsResult } from '../model/docs/loader.js';
import { scanLinkedFiles } from '../model/docs/link-scan.js';
import type { ScannedDoc } from '../model/docs/types.js';
import { docFinding } from './verifier.js';
import { ALL_DOC_VERIFIERS } from './verifiers/index.js';
import type { ProductRoots } from '../model/product/types.js';

/**
 * 走査範囲そのものの検査に使う ID。
 *
 * 個々の文書ではなく「どこを見たか」を見る点で M1〜M6 とは層が違うため、
 * A0 / Q0 / V1 と同じ「ローダー段の検査」として 0 番を当てる。
 */
export const SCOPE_VERIFIER_ID = 'M0';

/** runDocsVerification の入力パス。すべて絶対パス。 */
export interface DocsRunOptions {
  /** docs/rules の絶対パス。存在しなくてよい。 */
  readonly rulesRoot: string;
  /** docs/specs の絶対パス。存在しなくてよい。 */
  readonly specsRoot: string;
  /**
   * ドメイン知識層(W。docs/knowledge)の絶対パス。省略・不在でよい。
   * ここに載せることで、W 層の文書も frontmatter(M1)・ID(M2)・参照(M3)・
   * リンク(M4)の検査下に入る。W 層を持たないリポジトリでは指定しなくても壊れない。
   */
  readonly knowledgeRoot?: string;
  /** サイトルート相対リンクとテンプレート探索の上限になる docs/ の絶対パス。リンクの実在(M4)は、この下の全部の .md を見る。 */
  readonly docsRoot: string;
  /** リンクの実在(M4)を見る、docs/ の外の根の文書(リポジトリの根からの相対。例: `CLAUDE.md`)。省略時は無し。 */
  readonly linkedRootFiles?: readonly string[];
  /** Finding の location.file の基準にするリポジトリルート。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(仕様の木・ドメイン知識の位置)。 */
  readonly roots: ProductRoots;
}

/** runDocsVerification の結果。 */
export interface DocsRunResult {
  readonly findings: Finding[];
  /** rules / specs のどちらかの走査ルートを読めたか。false なら M1〜M6 は実行していない。 */
  readonly available: boolean;
  /** 読み込めた文書の総数(CLI のサマリ表示用)。 */
  readonly docCount: number;
  /** そのうち docs/specs 配下の文書数(CLI のサマリ表示用)。 */
  readonly specsDocCount: number;
  /** そのうちドメイン知識層(docs/knowledge)配下の文書数(CLI のサマリ表示用)。 */
  readonly knowledgeDocCount: number;
  /** リンクの実在(M4)を見たファイル数(CLAUDE.md + docs/ の下の全部の .md。サマリ表示用)。 */
  readonly linkedFileCount: number;
}

/**
 * docs/rules と docs/specs 配下の文書整合検証を実行する。
 *
 * 片方しか無い環境(仕様だけ・ルールだけを持つリポジトリ)でも壊れない。
 * 両方とも無いときだけ `available: false` を返し、検証は行わない。
 *
 * @param options 走査対象のパス
 * @returns 全 Finding と、どこまで実行できたかの情報
 */
export function runDocsVerification(options: DocsRunOptions): DocsRunResult {
  const shared = { repoRoot: options.repoRoot, docsRoot: options.docsRoot, roots: options.roots };
  const rules = loadDocs(options.rulesRoot, shared);
  const specs = loadDocs(options.specsRoot, shared);
  const knowledge =
    options.knowledgeRoot === undefined
      ? { model: null, findings: [] as Finding[] }
      : loadDocs(options.knowledgeRoot, shared);
  // W 層(ドメイン知識)は任意の走査ルート。ルート 3 つとも同じ扱いである(下の emptyRoot)。

  const findings: Finding[] = [...rules.findings, ...specs.findings, ...knowledge.findings];
  if (rules.model === null && specs.model === null) {
    return { findings, available: false, docCount: 0, specsDocCount: 0, knowledgeDocCount: 0, linkedFileCount: 0 };
  }

  // **ディレクトリごと無い構成は警告しない。** 見るのは「ディレクトリはあるのに 0 件」だけで
  // ある(`loadDocs` は不在のとき `model: null` を返す)。仕様だけの木・規約だけの木は
  // どちらも正当な形であり、W 層に対して既に同じ扱いをしていた —— 同じ検査器の中で
  // 走査ルートごとに非対称にしない。
  findings.push(
    ...emptyRoot(rules, options.rulesRoot, options.repoRoot),
    ...emptyRoot(specs, options.specsRoot, options.repoRoot),
    ...emptyRoot(knowledge, options.knowledgeRoot ?? null, options.repoRoot),
  );

  const docs: ScannedDoc[] = [
    ...(rules.model?.docs ?? []),
    ...(specs.model?.docs ?? []),
    ...(knowledge.model?.docs ?? []),
  ];
  const scanned = scanLinkedFiles({
    repoRoot: options.repoRoot,
    docsRoot: options.docsRoot,
    rootFiles: options.linkedRootFiles ?? [],
  });
  findings.push(...scanned.findings);
  for (const verifier of ALL_DOC_VERIFIERS) {
    findings.push(...verifier.verify({ docs, linked: scanned.linked, roots: options.roots }));
  }
  return {
    findings,
    available: true,
    docCount: docs.length,
    specsDocCount: specs.model?.docs.length ?? 0,
    knowledgeDocCount: knowledge.model?.docs.length ?? 0,
    linkedFileCount: scanned.linked.length,
  };
}

/**
 * **ディレクトリはあるのに 1 件も読めていない**ことを警告する。
 *
 * 走査範囲が黙って狭まる事故(この拡張の発端でもある)は、検証が緑のままで進むのが最悪の性質なので、
 * 「見に行ったが 0 件だった」を検証結果として残す。
 *
 * **ディレクトリごと無い構成は警告しない。** 仕様だけを持つ木(サンプル・規約をまだ書いて
 * いない新規プロジェクト)も、規約だけを持つ木も正当な形であり、「消えている」とは区別が
 * 付く —— `loadDocs` はディレクトリが無いとき `model: null`、あって空のとき 0 件の model を
 * 返すので、その差をそのまま使う。
 */
function emptyRoot(loaded: LoadDocsResult, root: string | null, repoRoot: string): Finding[] {
  if (root === null || loaded.model === null) return [];
  if (loaded.model.docs.length > 0) return [];
  const file = toRelative(repoRoot, root);
  return [
    docFinding(SCOPE_VERIFIER_ID, {
      severity: 'warning',
      message: `走査対象の文書が 1 件もありません: ${file}`,
      location: { file },
      suggestion:
        'ディレクトリの場所と、走査に渡しているパスを確認する。意図的に空にしているのでなければ、文書整合検証がこのツリーを見ていない状態なので直す',
      counterexample: { root: file, documents: '0' },
    }),
  ];
}
