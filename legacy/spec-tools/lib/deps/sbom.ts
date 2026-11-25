/**
 * SBOM(使う第三者の部品の目録)の書き出し(`npm run deps:check -- --sbom`。ASVS V15.1.2)。
 *
 * lockfile ごとに `npm sbom --sbom-format cyclonedx --omit dev` を回し(出荷物に載る部品だけ。開発用の依存は含めない)、
 * 標準出力の CycloneDX の JSON を `tmp/deps-check/sbom-{名前}.json` に書く。**書くのは JSON として読めたものだけ**で、
 * 通信・コマンドの失敗や読めない出力は「未実施」と名指す(黙って空のファイルを残さない)。
 * いつ作って・どれだけ保つかは `dependency-patch-policy.md`(出荷のたびに作り、その出荷の記録に添えて保つ)。
 */

import { SBOM_DIR } from './types.js';
import type { DepsIo } from './types.js';

/** SBOM 1 つの結果。 */
export interface SbomResult {
  /** lockfile のパス(ルート相対)。 */
  readonly lockfile: string;
  /** 書いたファイル(ルート相対)。書けなければ null。 */
  readonly file: string | null;
  /** 部品の数(`components`)。書けなければ 0。 */
  readonly components: number;
  /** 書けなかった理由。 */
  readonly reason?: string;
}

/**
 * lockfile のパスから SBOM のファイル名を決める(`package-lock.json` → `sbom-root.json`、`legacy/spec-tools/package-lock.json` → `sbom-legacy-spec-tools.json`)。
 *
 * @param lockfile lockfile のパス(ルート相対)
 * @returns ルート相対のファイルのパス
 */
export function sbomFileOf(lockfile: string): string {
  const dir = lockfile.includes('/') ? lockfile.slice(0, lockfile.lastIndexOf('/')) : '';
  const name = dir === '' ? 'root' : dir.replaceAll(/[^A-Za-z0-9]+/gu, '-').replaceAll(/^-+|-+$/gu, '');
  return `${SBOM_DIR}/sbom-${name}.json`;
}

/** CycloneDX の文書として読めるか(`bomFormat` と `components` の配列)。部品の数を返す。 */
function componentCount(stdout: string): number | null {
  try {
    const json = JSON.parse(stdout) as { bomFormat?: unknown; components?: unknown };
    if (json.bomFormat !== 'CycloneDX' || !Array.isArray(json.components)) return null;
    return json.components.length;
  } catch {
    return null;
  }
}

/**
 * 全 lockfile の SBOM を書き出す。
 *
 * @param io 外への口
 * @param lockfiles lockfile のパス(ルート相対)
 * @param rootAbs 製品の根の絶対パス
 * @returns lockfile ごとの結果
 */
export async function writeSboms(io: DepsIo, lockfiles: readonly string[], rootAbs: string): Promise<SbomResult[]> {
  const results: SbomResult[] = [];
  for (const lockfile of lockfiles) {
    const dir = lockfile.includes('/') ? `${rootAbs}/${lockfile.slice(0, lockfile.lastIndexOf('/'))}` : rootAbs;
    try {
      const out = await io.exec('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'], dir);
      const components = componentCount(out.stdout);
      if (out.code !== 0 || components === null) {
        const detail = out.code !== 0 ? `終了コード ${String(out.code)}` : '出力が CycloneDX の JSON ではありません';
        results.push({ lockfile, file: null, components: 0, reason: `npm sbom が使えません(${detail}${out.stderr === '' ? '' : `: ${out.stderr.trim().split('\n')[0] ?? ''}`})` });
        continue;
      }
      const file = sbomFileOf(lockfile);
      io.writeText(file, out.stdout.endsWith('\n') ? out.stdout : `${out.stdout}\n`);
      results.push({ lockfile, file, components });
    } catch (error) {
      results.push({ lockfile, file: null, components: 0, reason: `npm sbom を回せません(${error instanceof Error ? error.message : String(error)})` });
    }
  }
  return results;
}

/**
 * SBOM の結果を 1 画面の行にする。
 *
 * @param results `writeSboms` の結果
 * @returns 表示する行
 */
export function formatSboms(results: readonly SbomResult[]): string[] {
  const ok = results.filter((result) => result.file !== null);
  const lines = [`SBOM(CycloneDX・本番の部品のみ): ${String(ok.length)}/${String(results.length)} 本を書きました`];
  for (const result of results) {
    lines.push(result.file === null ? `  未実施 — ${result.lockfile}: ${result.reason ?? ''}` : `  ${result.file}(${String(result.components)} 部品)`);
  }
  return lines;
}
