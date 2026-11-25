/**
 * 題材の通し実行の**生成の後の木**での回し直し(fix27 A2)。
 *
 * 通し実行は実装の木を置く前に verify を回す(置くと手書きの実装との突合が全部落ちる。表の行 `verify:pre-app`)。そのため、実装の木を読む段は
 * 題材の上ではふだん飛んでいた —— HTTP の入口の閉世界(J2)と有料の口(X8)も、見本のアプリの木の上でしか回っていなかった。ここは生成の後の木で、
 * 段の宣言 `onGeneratedTree` の段だけを回し直す(部分集合は `generatedTreeCheckIds` が登録から導く。別の表を持たない)。
 *
 * 回し直しの前に、製品が手で書く**枠の最小形**(枠の設定 `app-config` と根のレイアウト `root-layout`)を置く。受信のアダプタの最小形
 * (`harness.ts` の `writeAppStubs`)と同じ扱いで、置き場は配置の役割から引く。題材はこれを持たないので、置かないと J2 の閉世界が
 * 「枠の設定が無い」と言うだけになる。中身は最小で、守りの配線(固定のヘッダを配る `headers()`・要求ごとの描画)だけを持つ —— 生成した
 * 配線の試験がこれを読むので、配線を外すとその試験が赤になる(拒否の観測と合わせて、作り物の上の空振りの緑にしない)。
 *
 * 回数(表の `runs`)は、段が生成の後の木で**見た相手の数**で数える(J2 = 生成した HTTP の入口とリクエスト前段・X8 = 有料の連携)。数え方は検査と
 * 同じ判定(J2 = `entryClosedStatus`・X8 = `paidEntrySubjects`)を通すので、検査が走査しない木では 0 になり、表の回数と食い違って赤になる(差分点検 S27-2)。
 * 見た相手の数え方の無い段が回し直しに入ったら、`subjectCounts` が throw する(数え方を足すまで回数を言えない)。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TEST_LAYOUT, TEST_VERIFY_INPUTS } from '../helpers/platform.js';
import { runAllVerifications } from '../../lib/compose/verify-pipeline.js';
import { generatedTreeCheckIds } from '../../lib/compose/all-checks.js';
import { entryClosedStatus, foundEntries } from '../../lib/job/verifiers/j2-entry-closed.js';
import { paidEntrySubjects } from '../../lib/external/verifiers/x8-paid-entry.js';
import { loadExternalSpecModel } from '../../lib/model/external/loader.js';
import { layoutPath, layoutScan, requestGatePath } from '../../lib/model/product/layout.js';
import type { ProductRoots } from '../../lib/model/product/types.js';
import type { Finding } from '../../lib/kernel/finding.js';

/** 生成の後の木の回し直しの結末。 */
export interface GeneratedTreeRun {
  /** 回し直した検査 ID(段の宣言から導いたもの)。 */
  readonly checks: readonly string[];
  /** 回し直した検査の指摘(error と warning)。 */
  readonly findings: readonly Finding[];
  /** 検査 ID → 生成の後の木で見た相手の数。 */
  readonly subjects: Readonly<Record<string, number>>;
}

/** 生成物のモジュールへの相対の指定(拡張子なし。`./` で始める)。 */
function relativeModule(fromFile: string, toFile: string): string {
  const relative = path.relative(path.dirname(fromFile), toFile).replace(/\.ts$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * 製品が手で書く枠の最小形を置く(置き場は配置の役割 `app-config` / `root-layout`。役割が無い配置では置かない)。
 *
 * @param root 一時ツリーのルート
 * @param roots その題材が宣言した根
 */
export function writeFrameStubs(root: string, roots: ProductRoots): void {
  const config = layoutPath(TEST_LAYOUT, roots.app, 'app-config');
  if (config !== null) {
    const file = path.join(root, config);
    const defense = path.join(root, roots.generated, 'browser-defense.ts');
    writeFileSync(
      file,
      [
        '/** 題材の通し実行が置く枠の設定の最小形(製品が手で書く 1 枚。守りの配線 = 全応答の固定のヘッダと、枠が要求する鍵だけを持つ)。 */',
        "import { staticHeaderEntries } from '@kaninabe/runtime/http/browser-defense';",
        `import { BROWSER_DEFENSE } from '${relativeModule(file, defense)}';`,
        '',
        'export default {',
        '  poweredByHeader: false,',
        '  experimental: { agentUpgrade: false },',
        '  async headers() {',
        "    return [{ source: '/:path*', headers: staticHeaderEntries(BROWSER_DEFENSE) }];",
        '  },',
        '};',
        '',
      ].join('\n'),
    );
  }
  const layout = layoutPath(TEST_LAYOUT, roots.app, 'root-layout');
  if (layout !== null) {
    const file = path.join(root, layout);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      [
        '/** 題材の通し実行が置く根のレイアウトの最小形(製品が手で書く 1 枚。要求ごとに描画する)。 */',
        "import type { ReactNode } from 'react';",
        "import { connection } from 'next/server';",
        '',
        'export default async function RootLayout({ children }: { readonly children: ReactNode }) {',
        '  await connection();',
        '  return (',
        '    <html lang="ja">',
        '      <body>{children}</body>',
        '    </html>',
        '  );',
        '}',
        '',
      ].join('\n'),
    );
  }
}

/**
 * 回し直す検査が生成の後の木で見た相手の数(検査 ID ごと)。
 *
 * @param root 一時ツリーのルート
 * @param roots その題材が宣言した根
 * @param checks 回し直す検査 ID
 * @returns 検査 ID → 数
 */
export function subjectCounts(root: string, roots: ProductRoots, checks: readonly string[]): Readonly<Record<string, number>> {
  const counters: Readonly<Record<string, () => number>> = {
    // HTTP の入口の閉世界が分類した入口(走査の根の下)と、枠が名前で呼ぶリクエスト前段。閉世界が走査しない木(no_tree / no_placement)は、
    // 入口があっても 0(検査と同じ 1 つの判定 entryClosedStatus で数える。回らない検査の回数を表と合わせない。差分点検 S27-2)。
    J2: () => {
      const scan = layoutScan(TEST_LAYOUT, roots.app, 'http-entry');
      if (entryClosedStatus(root, roots, TEST_LAYOUT) !== 'ran' || scan === null) return 0;
      const entries = foundEntries(root, scan).entries.length;
      const gate = requestGatePath(TEST_LAYOUT, roots);
      return entries + (gate !== null && existsSync(path.join(root, gate)) ? 1 : 0);
    },
    // 有料の連携(`spend: paid`)のうち X8 が見るもの(検査と同じ 1 つの判定 paidEntrySubjects。実装の木が無ければ 0。差分点検 S27-2)。
    X8: () => {
      const catalog = loadExternalSpecModel(path.join(root, roots.specs, 'backend', 'external.md'), { repoRoot: root }).model.catalog;
      return catalog === null ? 0 : paidEntrySubjects({ catalog, repoRoot: root, roots }).length;
    },
  };
  return Object.fromEntries(
    checks.map((id) => {
      const count = counters[id];
      if (count === undefined) throw new Error(`回し直す検査 ${id} の「見た相手の数」の数え方がありません(generated-tree.ts の subjectCounts に足す)`);
      return [id, count()];
    }),
  );
}

/**
 * 生成の後の木で、段の宣言 `onGeneratedTree` の段だけを回し直す。
 *
 * @param root 一時ツリーのルート
 * @param roots その題材が宣言した根
 * @param plant 回し直しの前に木へ足すファイル(一時ツリーのルート相対 → 本文。検査が効くことの負例に使う)
 * @returns 回し直した検査・指摘・見た相手の数
 */
export async function rerunOnGeneratedTree(root: string, roots: ProductRoots, plant: Readonly<Record<string, string>> = {}): Promise<GeneratedTreeRun> {
  for (const [relative, text] of Object.entries(plant)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const checks = generatedTreeCheckIds();
  const { findings } = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(root, roots.specs, 'domain'), generatedTreeOnly: true });
  return { checks, findings: findings.filter((finding) => checks.includes(finding.verifier)), subjects: subjectCounts(root, roots, checks) };
}
