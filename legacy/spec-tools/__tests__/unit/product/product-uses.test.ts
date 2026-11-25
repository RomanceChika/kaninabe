/**
 * 製品が採る仕様の種類(`product.md` の `uses`)の読み方と、P2(宣言と置き場の突合)のテスト。
 *
 * 見たいのは 4 つ。
 *   ① `uses` は**必須**で既定値が無い(無ければ宣言ごと読めない)。値は閉じた一覧・重複なし・文字列だけ
 *   ② `uses: []` は「何も採らない」という正当な宣言である(無いのとは別)
 *   ③ P2 は宣言と置き場の食い違いを**両方向とも** error にする(推定しない)
 *   ④ 置き場の形(file / dir / 画面の 2 候補)と、README・テンプレートだけの dir は「仕様がある」に数えない
 *
 * `TEST_ROOTS` は使わない —— 宣言そのものの読み方を試すので自分でフィクスチャを組む。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProductRoots } from '../../../lib/model/product/loader.js';
import { verifyDeclaredUses } from '../../../lib/product/verifiers/p2-declared-uses.js';
import { PRODUCT_DECL_FILE } from '../../../lib/io/paths.js';
import { SPEC_KINDS, SPEC_KIND_PLACEMENTS, SPEC_KIND_REQUIREMENTS, selectionOf, usesKind } from '../../../lib/model/product/uses.js';

/** 作った一時ツリー(後片付けのため)。 */
const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 必須の 4 根(仕様の木は `spec`)。 */
const ROOTS = [
  '  specs: spec',
  '  book: read',
  '  generated: impl/src/generated',
  '  migrations: db/migrations',
];

/**
 * 宣言を 1 枚だけ持つ一時ツリーを作る。
 *
 * @param usesYaml `uses` の行(`null` なら**書かない**)
 */
function repoWith(usesYaml: readonly string[] | null): string {
  const root = mkdtempSync(path.join(tmpdir(), 'product-uses-'));
  created.push(root);
  writeFileSync(
    path.join(root, PRODUCT_DECL_FILE),
    [
      '---',
      'doc_type: product_roots',
      'scope: common',
      'id: product-roots',
      '',
      'name: test-product',
      '',
      'roots:',
      ...ROOTS,
      ...(usesYaml ?? []),
      '---',
      '',
    ].join('\n'),
  );
  return root;
}

/** 仕様の木(`spec`)の中へ 1 枚書く(途中のディレクトリも作る)。 */
function place(root: string, relative: string): void {
  const file = path.join(root, 'spec', relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '---\n---\n');
}

/** 送信の連携 1 行(外部連携カタログの integrations の要素。読み込みで行を落とさない最小の形)。 */
const OUTBOUND_ROW = [
  '  - id: notice_out',
  '    service: notifier',
  '    direction: outbound',
  '    effect: write',
  '    port: NoticePort',
  '    adapter: impl/src/infra/notice.ts',
  '    config: [NOTICE_URL]',
  '    degrade: refuse',
  '    timeout_ms: 5000',
  '    retry: none',
  '    idempotency: 二重反映は防げない(再送の害が小さい)',
  '    idempotency_source: none',
  '    idempotency_reason: 同じ知らせが二度出ても害が小さいため',
  '    sends:',
  '      text: 通知の本文だけを送る',
  '      neutralize: [control_chars]',
  '    summary: 通知を送る',
];

/** 受信の連携 1 行(`event_id_table` を持つ)。 */
const INBOUND_ROW = [
  '  - id: notice_in',
  '    service: notifier',
  '    direction: inbound',
  '    effect: write',
  '    port: NoticeReceiver',
  '    adapter: impl/src/infra/receive.ts',
  '    config: [NOTICE_SECRET]',
  '    degrade: refuse',
  '    retry: none',
  '    idempotency: 外部イベント ID の一意制約で再送を読み捨てる',
  '    idempotency_source: local_ledger',
  '    signature: hmac_sha256',
  '    signature_key: NOTICE_SECRET',
  '    event_id_table: table-notices',
  '    emits: notice.receive',
  '    migration: 20260101000000_inbound_notice_in.sql',
  '    on_conflict: retry',
  '    sends:',
  '      text: 受信のみ',
  '    summary: 通知を受け取る',
];

/** 外部連携カタログを置く(連携の行を渡す。0 行なら `integrations: []`)。 */
function placeExternal(root: string, rows: readonly (readonly string[])[]): void {
  const file = path.join(root, 'spec', 'backend/external.md');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      '---',
      'doc_type: external_spec',
      'scope: backend',
      'id: external-catalog',
      'vocabulary:',
      '  service:',
      '    - id: notifier',
      '      label: 通知先',
      '      adapter_root: impl/src/infra',
      rows.length === 0 ? 'integrations: []' : 'integrations:',
      ...rows.flat(),
      'test_cases: []',
      '---',
      '',
    ].join('\n'),
  );
}

/** P2 を実際の読み込みから回す。 */
/**
 * ドメイン仕様の木を置く(ロール 1 つと、副作用 `effects` を持つ状態機械 1 本。`effects` が空なら副作用を持たない)。
 *
 * @param root 一時ツリーの根
 * @param effects 遷移の副作用の ID
 */
function placeDomain(root: string, effects: readonly string[]): void {
  const dir = path.join(root, 'spec', 'domain');
  mkdirSync(path.join(dir, 'thing'), { recursive: true });
  writeFileSync(
    path.join(dir, 'roles.md'),
    ['---', 'doc_type: role_spec', 'scope: common', 'id: domain-roles', 'roles:', '  - id: guest', '    kind: anonymous', '  - id: user', '    kind: authenticated_default', '  - id: system', '    kind: system', '---', ''].join('\n'),
  );
  writeFileSync(
    path.join(dir, 'thing', 'states.md'),
    [
      '---',
      'doc_type: state_spec',
      'scope: common',
      'id: thing-states',
      'state_machine: thing',
      'states:',
      '  - id: open',
      '    label: 開',
      '  - id: done',
      '    label: 済',
      'initial: open',
      'final: [done]',
      'events:',
      '  - id: finish',
      '    label: 済ませる',
      '    from: [open]',
      '    to: done',
      '    by: [user]',
      ...(effects.length === 0 ? [] : ['effects:', '  - on: finish', `    do: [${effects.join(', ')}]`]),
      '---',
      '',
    ].join('\n'),
  );
}

/**
 * ジョブカタログを置く(走査 1 本。`emits` が空なら通知を積まない走査)。
 *
 * @param root 一時ツリーの根
 * @param emits 走査が積む通知の ID
 */
function placeJobs(root: string, emits: readonly string[]): void {
  const file = path.join(root, 'spec', 'backend/jobs.md');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      '---',
      'doc_type: job_spec',
      'scope: backend',
      'id: job-catalog',
      'vocabulary:',
      '  kind:',
      '    - id: reminder',
      '      label: 走査',
      ...(emits.length === 0 ? [] : ['      declares: [emits]']),
      '  on_failure:',
      '    - id: skip_and_next_run',
      '      label: 次回に回す',
      '      means: next_run',
      'jobs:',
      '  - id: remind_things',
      '    source: schedule',
      '    kind: reminder',
      '    schedule: "0 23 * * *"',
      '    endpoint: /api/things/remind',
      '    implementation: impl/src/remind.ts',
      ...(emits.length === 0 ? [] : [`    emits: [${emits.join(', ')}]`]),
      '    scheduler: host',
      '    on_failure: skip_and_next_run',
      '    summary: 走査する',
      'test_cases:',
      '  - id: TC-JOB-CATALOG-001',
      '    type: unit',
      '    covers: [success]',
      '    spec_ids: [job-catalog]',
      '    implementation: impl/src/remind.test.ts::走査する',
      '---',
      '',
    ].join('\n'),
  );
}

function p2(root: string) {
  const loaded = loadProductRoots(root);
  return verifyDeclaredUses({ repoRoot: root, product: loaded.model, uses: loaded.uses });
}

describe('uses を読む', () => {
  it('宣言順のまま読め、採るかどうかと入力の選択はそこから決まる', () => {
    const loaded = loadProductRoots(repoWith(['uses:', '  - jobs', '  - actions']));
    const uses = loaded.uses ?? [];

    expect(loaded.findings).toEqual([]);
    expect(uses).toEqual(['jobs', 'actions']);
    expect(usesKind(uses, 'jobs')).toBe(true);
    expect(selectionOf(uses, 'jobs')).toBe('selected');
    expect(selectionOf(uses, 'queries')).toBe('unselected');
  });

  it('`uses: []` は「何も採らない」という正当な宣言で、根も読める', () => {
    const loaded = loadProductRoots(repoWith(['uses: []']));

    expect(loaded.findings).toEqual([]);
    expect(loaded.uses).toEqual([]);
    expect(loaded.model.roots).not.toBeNull();
  });

  it('uses が無ければ P0 が落とし、宣言ごと読めない(既定値を置かない・推定しない)', () => {
    const loaded = loadProductRoots(repoWith(null));

    expect(loaded.findings.map((finding) => finding.verifier)).toEqual(['P0']);
    expect(loaded.findings[0]?.message).toContain('uses');
    // 根は読めていても、採用が不明のまま検査が走らないよう、組で読めなかったことにする。
    expect(loaded.uses).toBeNull();
    expect(loaded.model.roots).toBeNull();
  });

  it.each([
    ['知らない種類', ['uses:', '  - job'], '知らない種類 job'],
    ['重複', ['uses:', '  - jobs', '  - jobs'], '重複'],
    ['文字列でない要素', ['uses:', '  - 1'], '文字列'],
    ['リストでない', ['uses: jobs'], 'リスト'],
  ])('%sは P0 が落とし、宣言ごと読めない', (_label, yaml, text) => {
    const loaded = loadProductRoots(repoWith(yaml));

    expect(loaded.findings.map((finding) => finding.verifier)).toContain('P0');
    expect(loaded.findings.some((finding) => finding.message.includes(text))).toBe(true);
    expect(loaded.uses).toBeNull();
    expect(loaded.model.roots).toBeNull();
  });
});

describe('P2 採る種類と置き場の突合(両方向)', () => {
  it('宣言と置き場が一致していれば何も言わない', () => {
    const root = repoWith(['uses:', '  - jobs', '  - actions']);
    placeJobs(root, []);
    place(root, 'backend/actions/claim/submit.md');

    expect(p2(root)).toEqual([]);
  });

  it('採ったのに置き場が無ければ error(その種類を要る検査が黙って空振りする形)', () => {
    const root = repoWith(['uses:', '  - jobs']);
    mkdirSync(path.join(root, 'spec'), { recursive: true });

    const findings = p2(root);

    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P2', 'error']]);
    expect(findings[0]?.message).toContain('uses に jobs を宣言していますが');
    expect(findings[0]?.message).toContain('spec/backend/jobs.md');
    expect(findings[0]?.counterexample).toEqual({ kind: 'jobs', places: 'spec/backend/jobs.md' });
  });

  it('置き場に仕様があるのに採っていなければ error(書いた仕様が検査から黙って外れる形)', () => {
    const root = repoWith(['uses: []']);
    place(root, 'backend/jobs.md');

    const findings = p2(root);

    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P2', 'error']]);
    expect(findings[0]?.message).toContain('jobs の仕様が置き場');
    expect(findings[0]?.suggestion).toContain('uses に jobs を足す');
  });

  it('食い違う種類ごとに 1 件ずつ、値域の順に出る', () => {
    const root = repoWith(['uses:', '  - jobs']);
    place(root, 'backend/queries/claim/list.md');
    place(root, 'backend/auth.md');

    expect(p2(root).map((finding) => finding.counterexample?.['kind'])).toEqual(['queries', 'jobs', 'auth']);
  });

  it('dir の置き場は README とテンプレートだけでは「仕様がある」に数えない', () => {
    const root = repoWith(['uses: []']);
    place(root, 'backend/actions/README.md');
    place(root, 'backend/actions/template.action_spec.md');

    expect(p2(root)).toEqual([]);
  });

  it('dir の置き場は深い階層の仕様も数える', () => {
    const root = repoWith(['uses: []']);
    place(root, 'backend/data/tables/claims.md');

    expect(p2(root).map((finding) => finding.counterexample?.['kind'])).toEqual(['data_tables']);
  });

  it('画面は screens か chrome のどちらかに仕様があれば採っている形になる', () => {
    const root = repoWith(['uses:', '  - screens']);
    place(root, 'frontend/chrome/app.md');

    expect(p2(root)).toEqual([]);
  });

  it('宣言が読めない・仕様の木が無い場合は何も言わない(文言は P0 / P1 が持つ)', () => {
    const noUses = repoWith(null);
    const noTree = repoWith(['uses:', '  - jobs']);

    expect(p2(noUses)).toEqual([]);
    expect(p2(noTree)).toEqual([]);
  });

  it('連携が 1 件でもあるのに設定カタログを採らなければ error(連携が必ず挙げる設定の接地先が「無い」と読まれて黙る形を、宣言の段で止める)', () => {
    const root = repoWith(['uses:', '  - external']);
    placeExternal(root, [OUTBOUND_ROW]);

    const findings = p2(root);

    expect(findings.map((finding) => [finding.verifier, finding.severity])).toEqual([['P2', 'error']]);
    expect(findings[0]?.message).toContain('uses に external を宣言していますが、config の宣言がありません');
    expect(findings[0]?.suggestion).toContain('uses に config を足して');
    expect(findings[0]?.counterexample).toEqual({ kind: 'external', requires: 'config' });
  });

  it('受信の連携があるのにテーブル仕様を採らなければ error(event_id_table の接地先が「無い」と読まれて黙る形を止める)。送信だけなら要らない', () => {
    const inbound = repoWith(['uses:', '  - external', '  - config']);
    placeExternal(inbound, [INBOUND_ROW]);
    place(inbound, 'backend/config.md');
    const outboundOnly = repoWith(['uses:', '  - external', '  - config']);
    placeExternal(outboundOnly, [OUTBOUND_ROW]);
    place(outboundOnly, 'backend/config.md');

    const findings = p2(inbound);

    expect(findings.map((finding) => finding.counterexample)).toEqual([{ kind: 'external', requires: 'data_tables' }]);
    expect(findings[0]?.message).toContain('uses に external を宣言していますが、data_tables の宣言がありません');
    expect(p2(outboundOnly)).toEqual([]);
  });

  it('連携が 0 件の外部連携カタログは何も名指さないので、設定カタログもテーブル仕様も要求しない(要求は連携が 1 件以上あるときだけ)', () => {
    const root = repoWith(['uses:', '  - external']);
    placeExternal(root, []);

    expect(p2(root)).toEqual([]);
  });

  it('外部連携カタログが読めない(数えられない)ときは、要求を外さない(原因の error は X0 が言う)。両方の依存が効く', () => {
    const root = repoWith(['uses:', '  - external']);
    place(root, 'backend/external.md');

    expect(p2(root).map((finding) => finding.counterexample)).toEqual([
      { kind: 'external', requires: 'config' },
      { kind: 'external', requires: 'data_tables' },
    ]);
  });

  it('連携と必要な種類を一緒に採れば何も言わない。設定カタログだけを採るのは自由(依存は一方向)', () => {
    const all = repoWith(['uses:', '  - external', '  - config', '  - data_tables']);
    placeExternal(all, [INBOUND_ROW, OUTBOUND_ROW]);
    place(all, 'backend/config.md');
    place(all, 'backend/data/tables/payment_notices.md');
    const configOnly = repoWith(['uses:', '  - config']);
    place(configOnly, 'backend/config.md');

    expect(p2(all)).toEqual([]);
    expect(p2(configOnly)).toEqual([]);
  });

  it('同じ「uses に足す」を重ねて言わない: 先の種類が置き場にあるのに採っていなければ、その指摘 1 件だけ。依る側が置き場に無ければ、その指摘 1 件だけ', () => {
    const presentButUndeclared = repoWith(['uses:', '  - external']);
    placeExternal(presentButUndeclared, [OUTBOUND_ROW]);
    place(presentButUndeclared, 'backend/config.md');
    const declaredButAbsent = repoWith(['uses:', '  - external']);
    mkdirSync(path.join(declaredButAbsent, 'spec'), { recursive: true });

    const present = p2(presentButUndeclared);
    const absent = p2(declaredButAbsent);

    expect(present.map((finding) => finding.message)).toEqual([expect.stringContaining('config の仕様が置き場')]);
    expect(absent.map((finding) => finding.message)).toEqual([expect.stringContaining('uses に external を宣言していますが、その置き場')]);
  });

  it('ドメイン仕様が副作用を宣言しているのにジョブカタログを採らなければ error(同じトランザクションの効果・連鎖の判定が黙って空になる形を止める)', () => {
    const root = repoWith(['uses:', '  - notifications']);
    placeDomain(root, ['create_account']);
    place(root, 'backend/notifications.md');

    const findings = p2(root);

    expect(findings.map((finding) => finding.counterexample)).toEqual([{ kind: 'domain', requires: 'jobs' }]);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('ドメイン仕様が jobs を名指す宣言を持っていますが、jobs の宣言がありません');
  });

  it('副作用が通知の ID を名指すのに通知カタログを採らなければ error。ジョブカタログも無ければ両方', () => {
    const root = repoWith(['uses:', '  - jobs']);
    placeDomain(root, ['notify_owner_done']);
    placeJobs(root, []);
    const both = repoWith(['uses: []']);
    placeDomain(both, ['notify_owner_done']);

    expect(p2(root).map((finding) => finding.counterexample)).toEqual([{ kind: 'domain', requires: 'notifications' }]);
    expect(p2(both).map((finding) => finding.counterexample)).toEqual([
      { kind: 'domain', requires: 'jobs' },
      { kind: 'domain', requires: 'notifications' },
    ]);
  });

  it('副作用を持たないドメイン仕様・ドメイン仕様の木が無い製品は何も要求しない(対照・境界)', () => {
    const noEffects = repoWith(['uses: []']);
    placeDomain(noEffects, []);
    const noDomain = repoWith(['uses: []']);
    mkdirSync(path.join(noDomain, 'spec'), { recursive: true });

    expect(p2(noEffects)).toEqual([]);
    expect(p2(noDomain)).toEqual([]);
  });

  it('ドメイン仕様が読めない(数えられない)ときは要求を外さない(原因の error は V1 が言う)', () => {
    const root = repoWith(['uses: []']);
    mkdirSync(path.join(root, 'spec', 'domain'), { recursive: true });

    expect(p2(root).map((finding) => finding.counterexample)).toEqual([
      { kind: 'domain', requires: 'jobs' },
      { kind: 'domain', requires: 'notifications' },
    ]);
  });

  it('副作用を宣言するファイル(states.md)が読めなければ要求を外さない。ほかのファイルの error だけなら言い切る(連鎖の誤報にしない)', () => {
    const brokenStates = repoWith(['uses: []']);
    placeDomain(brokenStates, []);
    writeFileSync(path.join(brokenStates, 'spec', 'domain', 'thing', 'states.md'), '---\ndoc_type: state_spec\nstates: [\n---\n');
    const brokenRoles = repoWith(['uses: []']);
    placeDomain(brokenRoles, []);
    writeFileSync(
      path.join(brokenRoles, 'spec', 'domain', 'roles.md'),
      ['---', 'doc_type: role_spec', 'scope: common', 'id: domain-roles', 'roles:', '  - id: user', '    kind: authenticated_default', '---', ''].join('\n'),
    );

    expect(p2(brokenStates).map((finding) => finding.counterexample)).toEqual([
      { kind: 'domain', requires: 'jobs' },
      { kind: 'domain', requires: 'notifications' },
    ]);
    expect(p2(brokenRoles)).toEqual([]);
  });

  it('ジョブカタログが読めないときは通知カタログを要求する(走査の emits を数えられない)・走査の emits が無いカタログは要求しない', () => {
    const unreadable = repoWith(['uses:', '  - jobs']);
    place(unreadable, 'backend/jobs.md');
    const noEmits = repoWith(['uses:', '  - jobs']);
    placeJobs(noEmits, []);
    const emits = repoWith(['uses:', '  - jobs']);
    placeJobs(emits, ['notify_owner_done']);

    expect(p2(unreadable).map((finding) => finding.counterexample)).toEqual([{ kind: 'jobs', requires: 'notifications' }]);
    expect(p2(noEmits)).toEqual([]);
    expect(p2(emits).map((finding) => finding.counterexample)).toEqual([{ kind: 'jobs', requires: 'notifications' }]);
  });

  it('依存の一覧は値域の種類(依る側はドメイン仕様も)だけを名指し、自分自身を要求しない', () => {
    for (const requirement of SPEC_KIND_REQUIREMENTS) {
      expect([...SPEC_KINDS, 'domain']).toContain(requirement.kind);
      expect(SPEC_KINDS).toContain(requirement.requires);
      expect(requirement.kind).not.toBe(requirement.requires);
    }
  });

  it('値域の全種類が置き場を持つ(置き場の表と値域がずれない)', () => {
    expect(Object.keys(SPEC_KIND_PLACEMENTS).sort()).toEqual([...SPEC_KINDS].sort());
    for (const kind of SPEC_KINDS) expect(SPEC_KIND_PLACEMENTS[kind].paths.length).toBeGreaterThan(0);
  });
});
