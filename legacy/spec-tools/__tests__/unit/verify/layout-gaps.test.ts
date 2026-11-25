/**
 * 置き場の配置に**あるスタックにしか無い概念の役割**(`request-gate` = リクエスト前段・`app-icon` = アプリの既定のアイコン。下限 0)が無いとき、
 * それを読む検査(S7 の `matcher` の被覆・G8 の既定のアイコンの残骸)が**黙って緑にならず**、実行ログが「未実施」と名指すこと(部品化 ③-c2b)。
 *
 * 語は入力の状態の未実施と同じ(`ID: 未実施 — …`)で、範囲サマリの「実行していません」の件数に入る(`isSkipNote`)。配置にある・実装の木が無い構成では出さない
 * (見る相手が無いのは事実で、別の行が言う)。
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeMissingRole } from '../../../lib/verify/check-run-report.js';
import { runDesign } from '../../../lib/verify/pipeline-groups-quality.js';
import { runScreens } from '../../../lib/verify/screens-group.js';
import type { ScreenRunArgs } from '../../../lib/verify/screens-group.js';
import { isSkipNote } from '../../../lib/verify/skip-notes.js';
import type { ProductLayout } from '../../../lib/model/product/layout.js';
import { SCREEN_CTX, screenInput, screenSpec } from '../../helpers/screen-builder.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** 配置から、下限 0 の 2 役割を引いたもの(そのスタックに無い概念を宣言しない後段)。 */
function withoutZeroMinRoles(): ProductLayout {
  const { 'request-gate': _gate, 'app-icon': _icon, ...rest } = TEST_LAYOUT;
  return rest;
}

describe('describeMissingRole', () => {
  it('配置に役割が無いので見ていないことを、未実施の行(範囲サマリの件数に入る形)で言う', () => {
    const line = describeMissingRole('S7', 'request-gate(リクエスト前段)', '要ログイン画面の matcher の被覆');

    expect(line).toBe('S7: 未実施 — 置き場の配置に request-gate(リクエスト前段) が無いため、要ログイン画面の matcher の被覆は見ていません。');
    expect(isSkipNote(line)).toBe(true);
  });
});

describe('S7: 配置にリクエスト前段が無い', () => {
  /** 実装の木を読めた(`available: true`)画面 1 枚の入力。`requestGateMissing` だけを切り替える。 */
  function args(requestGateMissing: boolean): ScreenRunArgs {
    const input = screenInput({ screens: [screenSpec({ name: 'home', route: '/', requiresAuth: true })] });
    return {
      model: input.domain,
      queries: input.queries,
      screens: input.screens,
      app: {
        available: true,
        routes: [{ route: '/', file: 'app/src/app/page.tsx', metadata: { kind: 'none' } }],
        proxy: { available: false, file: '', patterns: [] },
        ...(requestGateMissing ? { requestGateMissing: true as const } : {}),
      },
      registry: input.registry,
      tests: input.tests,
      auth: input.auth,
      usecases: input.usecases,
      actions: null,
      reachabilityGaps: [],
      blockedInputs: [],
    };
  }

  it('matcher の被覆を見ていないことを「S7: 未実施」で名指し、警告・エラーにはしない(緑でもない)', () => {
    const lines: string[] = [];
    const findings = runScreens(args(true), SCREEN_CTX.guards, TEST_ROOTS, TEST_LAYOUT, (line) => lines.push(line));

    expect(lines).toContain('S7: 未実施 — 置き場の配置に request-gate(リクエスト前段) が無いため、要ログイン画面の matcher の被覆は見ていません。');
    expect(findings.filter((finding) => finding.verifier === 'S7' && finding.message.includes('matcher'))).toEqual([]);
  });

  it('配置にある構成(matcher を読めなかった)では未実施の行を出さず、従来の警告が出る', () => {
    const lines: string[] = [];
    const findings = runScreens(args(false), SCREEN_CTX.guards, TEST_ROOTS, TEST_LAYOUT, (line) => lines.push(line));

    expect(lines.filter((line) => line.startsWith('S7: 未実施'))).toEqual([]);
    expect(findings.some((finding) => finding.verifier === 'S7' && finding.severity === 'warning' && finding.message.includes('matcher を読めませんでした'))).toBe(true);
  });

  it('実装の木があるのに配置が画面の器の走査を決められない構成は、「実装の木が無いためスキップ」とは言わず、前提の失敗と言う(S7 の error が出る)', () => {
    const lines: string[] = [];
    const base = args(false);
    const placement = { ...base, app: { available: false, routes: [], proxy: { available: false, file: '', patterns: [] }, placementProblem: '置き場の配置から画面の器(screen-shell)の走査の根を決められません(テスト)' } };
    const findings = runScreens(placement, SCREEN_CTX.guards, TEST_ROOTS, TEST_LAYOUT, (line) => lines.push(line));

    const summary = lines.find((line) => line.startsWith('S 群(画面仕様)')) ?? '';
    expect(summary).toContain('S7 は置き場の配置が画面の器の走査を決められないため前提の失敗');
    expect(summary).not.toContain('実装の木が無いためS7');
    expect(summary).not.toContain('S7 はスキップ');
    expect(findings.filter((finding) => finding.verifier === 'S7' && finding.severity === 'error')).toHaveLength(1);
    // 実装がまだ無い構成は従来どおりスキップと言う。
    const absent: string[] = [];
    runScreens({ ...base, app: { available: false, routes: [], proxy: { available: false, file: '', patterns: [] } } }, SCREEN_CTX.guards, TEST_ROOTS, TEST_LAYOUT, (line) => absent.push(line));
    expect(absent.find((line) => line.startsWith('S 群(画面仕様)'))).toContain('実装の木が無いため S7 はスキップ');
  });
});

describe('G8: 配置にアプリの既定のアイコンが無い', () => {
  let repo: string;
  let domainRoot: string;

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'layout-gaps-'));
    const specs = path.join(repo, TEST_ROOTS.specs);
    cpSync(path.join(fileURLToPath(new URL('../../fixtures/samples/library/docs/specs/frontend/design', import.meta.url))), path.join(specs, 'frontend', 'design'), { recursive: true });
    domainRoot = path.join(specs, 'domain');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('既定の残骸を見ていないことを「G8: 未実施」で名指す(配置にある・実装の木が無い構成では出さない)', () => {
    const missing: string[] = [];
    runDesign(domainRoot, TEST_ROOTS, withoutZeroMinRoles(), (line) => missing.push(line));
    expect(missing).toContain('G8: 未実施 — 置き場の配置に app-icon(アプリの既定のアイコン) が無いため、既定のアイコンの残骸は見ていません。');

    const placed: string[] = [];
    runDesign(domainRoot, TEST_ROOTS, TEST_LAYOUT, (line) => placed.push(line));
    expect(placed.filter((line) => line.startsWith('G8: 未実施'))).toEqual([]);

    const noApp: string[] = [];
    runDesign(domainRoot, { ...TEST_ROOTS, app: null }, withoutZeroMinRoles(), (line) => noApp.push(line));
    expect(noApp.filter((line) => line.startsWith('G8: 未実施'))).toEqual([]);
  });
});
