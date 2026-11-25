/**
 * DB なしのハンドブックの入口の入力の状態が、全部入りの口と**落とした行の実数で揃う**ことのテスト(部品化 入力の状態-d)。
 *
 * 以前は残り 8 種の読み込みの結果が `dropped: null`(落とした数を数えられない)で、error が 1 件でもあれば阻害だった。
 * いまはどの種類のローダーも「読めずにモデルへ入れなかった行」を数える。題材(library)の写しで、
 *   - 行を落とさない error(id の食い違い・重複・未知のキー・テーマ名の形)だけの仕様 → 入口も全部入りも**読込済み**で、阻害の章は無い(章が出る)
 *   - 行を落とす error(値域の外・必須の欠け・語彙に無い語・マッピングでない行)の仕様 → 入口も全部入りも**阻害(仕様を落とした)**で、持ち主の章を止める
 * を、入口の投影(`readEntryInputs`)と全部入りの投影(`readGenerateInputsWithLoads`)の両方から見て、状態が同じであることを確かめる。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readMatter, stringifyMatter } from '../../helpers/front-matter.js';
import { afterAll, describe, expect, it } from 'vitest';
import { planEntryInputs } from '../../../lib/generate/book-entry-plan.js';
import { gatesInputOf, inputStatesOf, readEntryInputs, readGenerateInputsWithLoads } from '../../../lib/generate/generate-inputs.js';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import type { SpecKind } from '../../../lib/model/product/uses.js';
import { cleanupTemps, copiedSample } from '../../helpers/book-entry-fixture.js';
import { TEST_LAYOUT } from '../../helpers/platform.js';

afterAll(cleanupTemps);

type Data = Record<string, unknown>;

/** 仕様 1 枚のフロントマターを書き換える(本文は保つ)。 */
function editData(root: string, file: string, edit: (data: Data) => void): void {
  const absolute = path.join(root, file);
  const parsed = readMatter(readFileSync(absolute, 'utf8'));
  const data = parsed.data as Data;
  edit(data);
  writeFileSync(absolute, stringifyMatter(parsed.content, data));
}

const SPECS = 'docs/specs';
const FILES = {
  jobs: `${SPECS}/backend/jobs.md`,
  notifications: `${SPECS}/backend/notifications.md`,
  guarantees: `${SPECS}/backend/guarantees.md`,
  surface: `${SPECS}/backend/surface.md`,
  design_tokens: `${SPECS}/frontend/design/tokens.md`,
  usecases: `${SPECS}/frontend/usecases/borrow_self.md`,
} as const;

/** 壊した対象の種類(入口が採っている 6 種)。 */
const KINDS = Object.keys(FILES) as readonly (keyof typeof FILES)[];

/** 行を落とさない error だけの壊し方(error は出るが仕様は欠けない)。 */
function breakWithoutDropping(root: string): void {
  editData(root, FILES.jobs, (data) => (data['jobs'] as Data[]).push({ ...(data['jobs'] as Data[])[0] }));
  editData(root, FILES.notifications, (data) => {
    data['id'] = 'other-catalog';
  });
  editData(root, FILES.guarantees, (data) => {
    (data['guarantees'] as Data[])[0]!['extra'] = 1;
  });
  editData(root, FILES.surface, (data) => {
    data['unknown_key'] = 1;
  });
  editData(root, FILES.design_tokens, (data) => {
    data['theme'] = 'Bad Theme';
  });
  editData(root, FILES.usecases, (data) => {
    data['id'] = 'usecase-other';
  });
}

/** 行を落とす error の壊し方(仕様を落とす)。 */
function breakByDropping(root: string): void {
  editData(root, FILES.jobs, (data) => (data['jobs'] as Data[]).push({ ...(data['jobs'] as Data[])[0], id: 'bad_source', source: 'bogus' }));
  editData(root, FILES.notifications, (data) => (data['notifications'] as Data[]).push({ ...(data['notifications'] as Data[])[0], id: 'notify_ghost', medium: 'ghost' }));
  editData(root, FILES.guarantees, (data) => (data['guarantees'] as Data[]).push({ ...(data['guarantees'] as Data[])[0], id: 'bad_status', status: 'bogus' }));
  editData(root, FILES.surface, (data) => {
    data['hand_written_views'] = [{ table: 'audit_log' }];
  });
  editData(root, FILES.design_tokens, (data) => {
    (data['palette'] as Data)['bad'] = 'not-a-hex';
  });
  editData(root, FILES.usecases, (data) => {
    data['accept'] = [{ reason: '理由だけ' }];
  });
}

/** 写しを、入口の投影と全部入りの投影の両方で読み、種類ごとの入力の状態と入口の計画を返す。 */
function readBoth(root: string) {
  const declared = loadProductRoots(root);
  if (declared.model.roots === null || declared.uses === null) throw new Error('題材の宣言を読めません');
  const roots = declared.model.roots;
  const uses = declared.uses;
  const full = readGenerateInputsWithLoads(root, roots, TEST_LAYOUT);
  const entry = readEntryInputs(root, roots, uses, TEST_LAYOUT);
  const fullStates = inputStatesOf(full.loads, uses);
  const entryStates = inputStatesOf(entry.loads, uses);
  const plan = planEntryInputs(entryStates, roots);
  const stateOf = (states: typeof entryStates, kind: SpecKind) => states.find((entry) => entry.kind === kind)?.input;
  return { full, entry, fullStates, entryStates, plan, stateOf };
}

describe('行を落とさない error だけの仕様 — 入口も全部入りも読込済み(阻害にならず章が出る)', () => {
  const clean = readBoth(copiedSample('dropped-clean'));
  const broken = readBoth((() => {
    const root = copiedSample('dropped-keep');
    breakWithoutDropping(root);
    return root;
  })());

  it('壊した 6 種は、error は読み込みの診断に残るが、落とした行は 0・読込済み(入口と全部入りで同じ)', () => {
    for (const kind of KINDS) {
      for (const read of [broken.entry, broken.full]) {
        expect(read.loads[kind].findings.some((finding) => finding.severity === 'error'), `${kind}: error が残る`).toBe(true);
        expect(read.loads[kind].dropped, `${kind}: 落とした行は 0`).toBe(0);
      }
      expect(broken.stateOf(broken.entryStates, kind)?.state, `${kind}: 入口`).toBe('loaded');
      expect(broken.stateOf(broken.fullStates, kind)?.state, `${kind}: 全部入り`).toBe('loaded');
    }
  });

  it('入口の入力の状態は、全部入りの口の入力の状態と全種類で一致する(落とした行の実数で揃う)', () => {
    expect(broken.entryStates.map(({ kind, input }) => [kind, input.state])).toEqual(broken.fullStates.map(({ kind, input }) => [kind, input.state]));
  });

  it('入口の計画に阻害は無く、止める章は壊す前と同じ(阻害の章を止めない)', () => {
    expect(broken.plan.blocked).toEqual([]);
    expect(broken.plan.stoppedChapters).toEqual(clean.plan.stoppedChapters);
  });
});

describe('行を落とす error の仕様 — 入口も全部入りも阻害(仕様を落とした)で、持ち主の章を止める', () => {
  const clean = readBoth(copiedSample('dropped-clean-2'));
  const broken = readBoth((() => {
    const root = copiedSample('dropped-drop');
    breakByDropping(root);
    return root;
  })());

  it('壊した 6 種は落とした行が 1 以上で、阻害(invalid)になる。入口と全部入りで同じ', () => {
    for (const kind of KINDS) {
      for (const read of [broken.entry, broken.full]) expect(read.loads[kind].dropped, `${kind}: 落とした行`).toBeGreaterThan(0);
      for (const states of [broken.entryStates, broken.fullStates]) {
        expect(broken.stateOf(states, kind), kind).toMatchObject({ state: 'blocked', reason: 'invalid' });
      }
    }
    expect(broken.entryStates.map(({ kind, input }) => [kind, input.state])).toEqual(broken.fullStates.map(({ kind, input }) => [kind, input.state]));
  });

  it('壊していない種類は読込済みのまま(隣の種類を巻き込まない)。入口の計画は壊した種類を名指し、章を止める', () => {
    expect(broken.stateOf(broken.entryStates, 'auth')?.state).toBe('loaded');
    expect(broken.stateOf(broken.entryStates, 'queries')?.state).toBe('loaded');
    expect(broken.plan.blocked.map((entry) => entry.kind).sort()).toEqual([...KINDS].sort());
    expect(broken.plan.stoppedChapters.length).toBeGreaterThan(clean.plan.stoppedChapters.length);
  });
});

describe('認証フローの関門の入力の状態(生成の文脈 `gates` の素)', () => {
  /** 写しを読み、入口と全部入りの両方から関門の入力の状態を返す。 */
  function gatesOf(root: string, withoutAuth = false) {
    const declared = loadProductRoots(root);
    if (declared.model.roots === null || declared.uses === null) throw new Error('題材の宣言を読めません');
    const uses = withoutAuth ? declared.uses.filter((kind) => kind !== 'auth') : declared.uses;
    const roots = declared.model.roots;
    return {
      full: gatesInputOf(readGenerateInputsWithLoads(root, roots, TEST_LAYOUT), uses),
      entry: gatesInputOf(readEntryInputs(root, roots, uses, TEST_LAYOUT), uses),
    };
  }

  it('読めた認証フローは読込済み(関門の一覧を持つ)。入口と全部入りで同じ', () => {
    const { full, entry } = gatesOf(copiedSample('gates-clean'));

    expect(full.state).toBe('loaded');
    expect(entry.state).toBe('loaded');
    if (full.state === 'loaded' && entry.state === 'loaded') {
      expect(full.value.length).toBeGreaterThan(0);
      expect(entry.value).toEqual(full.value);
    }
  });

  it('行を落とした認証フロー(sign_in の runs に文字列でない要素)は阻害(invalid)。入口と全部入りで同じ', () => {
    const root = copiedSample('gates-dropped');
    editData(root, `${SPECS}/backend/auth.md`, (data) => {
      (data['sign_in'] as Data[])[0]!['runs'] = ['entry.create', 5];
    });

    const { full, entry } = gatesOf(root);

    expect(full).toMatchObject({ state: 'blocked', reason: 'invalid' });
    expect(entry).toMatchObject({ state: 'blocked', reason: 'invalid' });
  });

  it('製品が auth を採っていなければ未選択(関門は無い事実。置き場に仕様が残っていても阻害にしない)', () => {
    const { full, entry } = gatesOf(copiedSample('gates-unselected'), true);

    expect(full.state).toBe('unselected');
    expect(entry.state).toBe('unselected');
  });
});
