/**
 * 画面の到達の入力が使えないこと(S13・S16・Y3・Y5)の報告を、**実ローダー・実パイプラインを通して**確かめる
 * (部品化 ②-h。A13 / T2 と同じ形の「未実施 / 阻害」の行を、画面の到達を読む検査にも出す)。
 *
 * 土台は action_spec とドメインだけを持つ製品の仕様の木(`samples/dual_actors`)で、`uses` と画面の置き場だけを変えて
 * `runAllVerifications` を回し、実行ログの行と全体の Finding を見る。
 *   (i)   `uses` に screens が無い                       → S13 は未実施の行。**S16 / Y3 / Y5 はユースケース仕様が読み込めているときだけ**
 *         未実施の行(読めていなければ Y 群自体がスキップで、母集合が無いのに「見ていません」と言わない = ②-j の反例)
 *   (ii)  `uses` に screens があり画面の仕様が壊れている  → 阻害の行・読み込みの error(S0)は 1 回だけ・S13 / S16 の判定は出ない
 *   (iii) `uses` に screens があり画面 0 枚の読込済み     → 行は出ず、S 群は 0 枚に対して実行される(0 枚を検査したことは検査しなかったことと違う)
 * 画面が読めているときの出力が前後で同一であること(判定を変えていない)は、製品と 6 題材の verify の全文の比較で見る。
 */

import { TEST_VERIFY_INPUTS, TEST_LAYOUT } from '../../helpers/platform.js';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runAllVerifications } from '../../../lib/compose/verify-pipeline.js';
import { loadScreenSpecModel } from '../../../lib/model/screen/loader.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';

const BASE = fileURLToPath(new URL('../../fixtures/samples/dual_actors/docs/specs', import.meta.url));

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** ユースケース仕様の置き場(`frontend/usecases/` を README だけで作る = 読み込めた・0 件)。 */
type UsecasesPlacement = 'none' | 'empty';

/** 画面の置き場の中身。 */
type ScreensPlacement =
  | { readonly kind: 'none' }
  /** `frontend/screens/` はあるが仕様は 0 枚(読み込めた・0 件)。 */
  | { readonly kind: 'empty' }
  /** フロントマターの無い仕様 1 枚(読み込みの error が残る)。 */
  | { readonly kind: 'broken' };

/** 土台の仕様の木を一時ツリーへ写し、`uses` と画面の置き場を差して実パイプラインを回す。 */
async function verifyWith(uses: readonly SpecKind[], placement: ScreensPlacement, usecases: UsecasesPlacement = 'none') {
  const repo = mkdtempSync(path.join(tmpdir(), 'reach-gaps-'));
  created.push(repo);
  writeProductDeclaration(repo, uses);
  const specs = path.join(repo, TEST_ROOTS.specs);
  cpSync(BASE, specs, { recursive: true });
  const screensDir = path.join(specs, 'frontend', 'screens');
  if (placement.kind !== 'none') mkdirSync(screensDir, { recursive: true });
  if (placement.kind === 'broken') writeFileSync(path.join(screensDir, 'broken.md'), '# フロントマターの無い画面\n');
  if (usecases === 'empty') {
    mkdirSync(path.join(specs, 'frontend', 'usecases'), { recursive: true });
    writeFileSync(path.join(specs, 'frontend', 'usecases', 'README.md'), '# ユースケース仕様(0 件)\n');
  }
  const lines: string[] = [];
  const result = await runAllVerifications({ ...TEST_VERIFY_INPUTS, domainRoot: path.join(specs, 'domain'), log: (line) => lines.push(line) });
  const loadedScreens = loadScreenSpecModel(path.join(specs, 'frontend'), { repoRoot: repo, roots: TEST_ROOTS, layout: TEST_LAYOUT });
  return { ...result, lines, loadedScreens };
}

const DEPENDENT_IDS = ['S13', 'S16', 'Y3', 'Y5'] as const;

/** 画面の到達を読む検査の行(未実施 / 阻害)。 */
const reachLines = (lines: readonly string[]): string[] => lines.filter((line) => DEPENDENT_IDS.some((id) => line.startsWith(`${id}: `)));

/** 画面の到達を読む検査の Finding(判定)。 */
const reachFindings = (findings: readonly { verifier: string }[]) =>
  findings.filter((finding) => ['S13', 'S16', 'Y3'].includes(finding.verifier));

describe('(i) uses に screens が無い — 未実施', () => {
  it('画面の置き場もユースケース仕様も無ければ、S 群も Y 群も群ごと飛び、S13 以下の行は出ない(群の「スキップしました」と二重に数えない)', async () => {
    const result = await verifyWith(['actions'], { kind: 'none' });

    expect(result.lines.some((line) => line.startsWith('Y 群(ユースケース仕様): ') && line.includes('スキップしました'))).toBe(true);
    expect(result.lines.some((line) => line.startsWith('S 群(画面仕様): ') && line.includes('スキップしました'))).toBe(true);
    expect(reachLines(result.lines)).toEqual([]);
  });

  it('ユースケース仕様が読み込めていれば(Y 群が動く)、Y3・Y5 の未実施が理由つきで出て、範囲が縮んだ報告として数える。S 群は飛んでいるので S13・S16 は群の行が言う', async () => {
    const result = await verifyWith(['actions'], { kind: 'none' }, 'empty');

    expect(result.lines.some((line) => line.startsWith('Y 群(ユースケース仕様): usecase_spec 0 件'))).toBe(true);
    expect(result.lines.some((line) => line.startsWith('S 群(画面仕様): ') && line.includes('スキップしました'))).toBe(true);
    const lines = reachLines(result.lines);
    expect(lines.map((line) => line.slice(0, line.indexOf(':')))).toEqual(['Y3', 'Y5']);
    for (const line of lines) {
      expect(line).toContain(': 未実施 — 製品が screens を採っていない(product.md の uses に無い)ため、');
      expect(result.skipNotes).toContain(line);
    }
  });

  it('画面の読み込みの error も P2 も出ない(未実施は行だけで、error を増やさない)', async () => {
    const result = await verifyWith(['actions'], { kind: 'none' }, 'empty');

    expect(result.findings.filter((finding) => ['S0', 'P2'].includes(finding.verifier))).toEqual([]);
    expect(reachFindings(result.findings)).toEqual([]);
  });
});

describe('(ii) uses に screens があり画面の仕様が壊れている — 阻害', () => {
  it('阻害の行が出て、画面の読み込みの error(S0)は従来どおり 1 回だけ数える(二重に数えない)', async () => {
    const result = await verifyWith(['actions', 'screens'], { kind: 'broken' }, 'empty');

    const lines = reachLines(result.lines);
    expect(lines).toHaveLength(DEPENDENT_IDS.length);
    for (const line of lines) {
      expect(line).toContain(': 阻害 — screens を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない');
      expect(result.skipNotes).toContain(line);
    }

    const s0 = result.findings.filter((finding) => finding.verifier === 'S0');
    expect(s0.length).toBeGreaterThan(0);
    expect(s0).toHaveLength(result.loadedScreens.findings.length);
    expect(s0.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('S13・S16 の判定は出さない(部分のモデルで「届かない」を導かない)', async () => {
    const result = await verifyWith(['actions', 'screens'], { kind: 'broken' });

    expect(reachFindings(result.findings)).toEqual([]);
  });
});

describe('(iii) uses に screens があり画面 0 枚の読込済み — 実行・0 件', () => {
  it('未実施 / 阻害の行は出ず、S 群は 0 枚に対して実行される', async () => {
    const result = await verifyWith(['actions', 'screens'], { kind: 'empty' });

    expect(result.loadedScreens.findings).toEqual([]);
    expect(result.loadedScreens.model.available).toBe(true);
    expect(reachLines(result.lines)).toEqual([]);
    // S 群は 0 枚に対して実行された(「スキップ」ではない)。
    const screenGroup = result.lines.find((line) => line.startsWith('S 群'));
    expect(screenGroup).toContain('screen_spec 0 件');
    expect(screenGroup).toContain('を実行しました');
    // 置き場に仕様が無い食い違いは前段(P2)が 1 回だけ出す。
    expect(result.findings.filter((finding) => finding.verifier === 'P2')).toHaveLength(1);
  });
});
