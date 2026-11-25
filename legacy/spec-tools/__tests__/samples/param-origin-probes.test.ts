/**
 * 引数の出どころの許可表(点検 7 回目 A7-1 / A7-2)の**効き目の証明** —— 点検の探り台本の形を題材の写しに当てると鳴る。
 *
 * どれも以前は error 0 で通り、生成物が「遷移を起こした人を他人の行の持ち主に据え替える」か
 * 「宣言の無い欄を保存点の入力から読む」形だった。`verifySample`(検証だけ・生成しない)で、
 * 1 つの `it` に 1 か所だけを壊す。
 */

import { describe, expect, it } from 'vitest';
import { verifySample } from './harness.js';
import type { Finding } from '../../lib/kernel/finding.js';

/** error の `検査 ID message`。 */
function errors(findings: readonly Finding[]): readonly string[] {
  return findings.filter((finding) => finding.severity === 'error').map((finding) => `${finding.verifier} ${finding.message}`);
}

/** 本文の 1 か所を置き換える(置き換えが効かなければ harness が throw する)。 */
function replace(from: string, to: string): (text: string) => string {
  return (text) => text.replace(from, to);
}

const HOLDS = 'docs/specs/backend/data/tables/holds.md';
const DOCUMENTS = 'docs/specs/backend/data/tables/documents.md';
const DOCUMENT_CREATE = 'docs/specs/backend/actions/document/create.md';

const HOLD_TRANSITION =
  'args: [uuid, text, text, "text[]", text, uuid, "text[]"]\n    params: [p_hold_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles]';
const DOCUMENT_TRANSITION =
  'args: [uuid, text, text, "text[]", text, uuid, "text[]", uuid]\n    params: [p_document_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles, p_archived_by]';
const DOCUMENT_INSERT =
  'args: [uuid, uuid, uuid, text, text, timestamptz, uuid, "text[]"]\n    params: [p_id, p_department_id, p_author_id, p_title, p_summary, p_disposable_after, p_actor_id, p_actor_roles]';

describe('遷移の RPC に records_actor の無い実行者への参照を足す(A7-1)', () => {
  it('library: apply_hold_transition に p_patron_id を足すと、宣言の外の列として T6 が、実行者にならない引数として A15 / Y8 が鳴る', async () => {
    const findings = await verifySample('library', {
      [HOLDS]: replace(
        HOLD_TRANSITION,
        'args: [uuid, text, text, "text[]", text, uuid, "text[]", uuid]\n    params: [p_hold_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles, p_patron_id]',
      ),
    });

    const found = errors(findings);
    expect(found).toContainEqual(expect.stringMatching(/^T6 遷移の RPC apply_hold_transition の引数 p_patron_id は、状態機械 hold のどの宣言も名指さない列 patron_id/u));
    // 単発の 3 遷移(司書の取り置き・受け取り・取り消し)は、どれも実行者を patron_id に入れる計画にならない。
    for (const op of ['hold.prepare', 'hold.collect', 'hold.cancel']) expect(found).toContain(`A15 ${op} の実行計画が仕様から決まりません(1 件)`);
    expect(found).toContain('Y8 apply_hold_transition の引数 p_patron_id に渡す値が仕様のどこにもありません');
  });

  it('archive: apply_document_transition に p_author_id を足すと鳴る(起案者を文書管理者に据え替える形)', async () => {
    const findings = await verifySample('archive', {
      [DOCUMENTS]: replace(
        DOCUMENT_TRANSITION,
        'args: [uuid, text, text, "text[]", text, uuid, "text[]", uuid, uuid]\n    params: [p_document_id, p_expected_state, p_next_state, p_effects, p_event_id, p_actor_id, p_actor_roles, p_archived_by, p_author_id]',
      ),
    });

    const found = errors(findings);
    expect(found).toContainEqual(expect.stringMatching(/^T6 遷移の RPC apply_document_transition の引数 p_author_id は、状態機械 document のどの宣言も名指さない列 author_id/u));
    expect(found).toContainEqual(expect.stringContaining('apply_document_transition の引数 p_author_id に渡す値が仕様のどこにもありません'));
  });
});

describe('保存点の作成の手順は、runner: manual でも宣言の無い欄を入力から読まない(A7-2)', () => {
  it('archive: insert_document に p_archived_by を足し、作成を manual にすると、保存点の解決が止まる', async () => {
    const findings = await verifySample('archive', {
      [DOCUMENTS]: replace(
        DOCUMENT_INSERT,
        'args: [uuid, uuid, uuid, text, text, timestamptz, uuid, "text[]", uuid]\n    params: [p_id, p_department_id, p_author_id, p_title, p_summary, p_disposable_after, p_actor_id, p_actor_roles, p_archived_by]',
      ),
      [DOCUMENT_CREATE]: replace(
        '  - document.disposable_after\n',
        '  - document.disposable_after\n\nrunner:\n  kind: manual\n  reason: 保管の記録を外部の台帳と照合してから入れるため、定型の作成 RPC だけでは実行計画が閉じない\n',
      ),
    });

    expect(errors(findings)).toContainEqual(expect.stringMatching(/^Y8 .*insert_document の引数 p_archived_by に渡す値が仕様のどこにもありません/u));
  });
});

describe('作成の持ち主の欄は owner の明示だけ・推測で作成者を埋めない(A8-1 / A9-1)', () => {
  const SYSTEM_READ = '  - by: system\n    scope: all';
  /** 査閲者 reviewer_id(必須・binding の根拠)を足し、作成 RPC が p_reviewer_id を受ける形(8 回目 N4b・9 回目 D3 の共通部分)。 */
  const REVIEWER = {
    'docs/specs/domain/document/entity.md': replace(
      '  - name: title\n',
      '  - name: reviewer_id\n    type: ref(staff)\n    required: true\n    label: 査閲者\n    description: 供覧を受けて査閲する職員\n    personal: false\n  - name: title\n',
    ),
    'docs/specs/domain/roles.md': replace(
      '  - id: document_author',
      '  - id: document_reviewer\n    label: 査閲者\n    binding: document.reviewer_id == actor.id\n    implies: [staff]\n  - id: document_author',
    ),
    'docs/specs/domain/department/access.md': replace(SYSTEM_READ, `  - by: document_reviewer\n    scope: none\n${SYSTEM_READ}`),
    'docs/specs/domain/staff/access.md': replace(SYSTEM_READ, `  - by: document_reviewer\n    scope: none\n${SYSTEM_READ}`),
    'docs/specs/backend/actions/document/archive.md': replace(
      'test_cases:\n',
      'test_cases:\n  - id: TC-DOCUMENT-ARCHIVE-901\n    type: unit\n    covers: [success]\n    by_role: document_reviewer\n    spec_ids: [document.archive]\n' +
        '    implementation: app/src/operation/__tests__/document/archive.test.ts::査閲者は供覧中の文書を書庫へ入れられる\n',
    ),
    'docs/specs/domain/document/states.md': replace('    to: archived\n    by: [curator]', '    to: archived\n    by: [curator, document_reviewer]'),
  } as const;
  const INSERT_WITH_REVIEWER =
    'args: [uuid, uuid, uuid, uuid, text, text, timestamptz, uuid, "text[]"]\n    params: [p_id, p_department_id, p_author_id, p_reviewer_id, p_title, p_summary, p_disposable_after, p_actor_id, p_actor_roles]';

  it('archive: 必須の査閲者 reviewer_id を足して作成の input に書き忘れると、作成者で黙って埋めずに止まる(探り台本 N4b)', async () => {
    const findings = await verifySample('archive', {
      ...REVIEWER,
      'docs/specs/domain/document/access.md': replace(`${SYSTEM_READ}\ncreates:`, `  - by: document_reviewer\n    scope: none\n${SYSTEM_READ}\ncreates:`),
      [DOCUMENTS]: replace(DOCUMENT_INSERT, INSERT_WITH_REVIEWER),
    });

    const found = errors(findings);
    // 実行計画(単発の document.create と保存点の手順)が止める。以前は error 0 で、作成 RPC が
    // coalesce((p_reviewer_id) = p_actor_id, false) を要求し、作成者が自分の文書の査閲者になった。
    expect(found).toContain('A15 document.create の実行計画が仕様から決まりません(1 件)');
    expect(found).toContainEqual(expect.stringMatching(/^Y8 insert_document の引数 p_reviewer_id に渡す値が仕様のどこにもありません/u));
    // 明示の持ち主の欄(author_id)は 1 本のままで、査閲者の欄を R2 の作成の書き手に数える経路は無い(推測の補完が無い)
    expect(found.filter((line) => line.startsWith('R2 '))).toEqual([]);
  });

  it('archive: 起案者を input に出した代理作成で、残った査閲者を作成者で埋めない —— 査閲者を作成者の欄にする直し方も勧めない(探り台本 D3)', async () => {
    const findings = await verifySample('archive', {
      ...REVIEWER,
      'docs/specs/domain/document/access.md': (text: string) =>
        replace(
          '    when: document.department_id == actor.department_id  # 他部署の文書は起こせない(部署の境界)\n',
          '    when: document.department_id == actor.department_id and staff.department_id == actor.department_id\n    delegate:\n      - field: document.author_id\n        reason: 庶務が起案者に代わって文書を起こす\n',
        )(replace(`${SYSTEM_READ}\ncreates:`, `  - by: document_reviewer\n    scope: none\n${SYSTEM_READ}\ncreates:`)(text)),
      [DOCUMENT_CREATE]: (text: string) => replace('owner: document.author_id\n', '')(replace('input:\n  - document.department_id\n', 'input:\n  - document.department_id\n  - document.author_id\n')(text)),
      // 書き手が以前の T6 の案内どおりに再送の作成者の欄を査閲者へ替えた形
      [DOCUMENTS]: (text: string) => replace('  creator: author_id', '  creator: reviewer_id')(replace(DOCUMENT_INSERT, INSERT_WITH_REVIEWER)(text)),
    });

    const all = findings.filter((finding) => finding.severity === 'error');
    const found = errors(findings);
    // 以前は error 0・型検査 ok で、複合 RPC が p_reviewer_id => p_actor_id を渡し、庶務が他人の名前で起案すると査閲者に自分が入った
    expect(found).toContainEqual(expect.stringMatching(/^Y8 insert_document の引数 p_reviewer_id に渡す値が仕様のどこにもありません/u));
    expect(found).toContainEqual(expect.stringMatching(/^T6 .*resend\.creator\(reviewer_id\)は、insert_document が実行者そのもので埋める列ではありません/u));
    // どの直し方の文も、査閲者の列を「作成者で埋まる列」として勧めない
    expect(all.map((finding) => finding.suggestion ?? '').filter((text) => /明示された列\([^)]*reviewer_id/u.test(text) || /実行者で埋まる列\([^)]*reviewer_id/u.test(text))).toEqual([]);
  });
});

describe('R2 の受け入れ self_assign は名指した欄 × 役にだけ効く(A9-2)', () => {
  const STORE_ACCESS = 'docs/specs/domain/store/access.md';
  /** 店舗に監査担当 auditor_id と役 store_auditor を足し、責任者と同じ編集の規則(会社管理者)に並べる(探り台本 S0 / S1)。 */
  const AUDITOR = {
    'docs/specs/domain/store/entity.md': replace(
      '  - name: created_at\n',
      '  - name: auditor_id\n    type: ref(staff_member)\n    label: 店舗監査担当\n    description: 店舗の棚卸しを監査する人\n    personal: false\n  - name: created_at\n',
    ),
    'docs/specs/domain/roles.md': replace(
      '  - id: store_manager ',
      '  - id: store_auditor\n    label: 店舗監査担当\n    binding: store.auditor_id == actor.id\n    implies: [staff_member]\n  - id: store_manager ',
    ),
    'docs/specs/backend/actions/store/update.md': replace('  - store.manager_id\n', '  - store.manager_id\n  - store.auditor_id\n'),
  } as const;
  const R2_AUDITOR = /^R2 store の writes\[0\]\(by: company_admin\) は、役 store_auditor の根拠の欄 store\.auditor_id\(binding\)/u;
  const R2_MANAGER = /^R2 store の writes\[0\]\(by: company_admin\) は、役 store_manager の根拠の欄 store\.manager_id\(binding\)/u;

  it('stores: 責任者の欄のための受け入れは、後から同じ規則に足した監査担当の欄を受け入れない(探り台本 S1)', async () => {
    const findings = await verifySample('stores', { ...AUDITOR, [STORE_ACCESS]: replace('    fields: [name, manager_id]\n', '    fields: [name, manager_id, auditor_id]\n') });
    const r2 = errors(findings).filter((line) => line.startsWith('R2 '));

    expect(r2).toEqual([expect.stringMatching(R2_AUDITOR)]);
  });

  it('stores: 受け入れを消せば 2 欄とも鳴る(探り台本 S0 の対照。検査は監査担当の形を危険と判定できる)', async () => {
    const findings = await verifySample('stores', {
      ...AUDITOR,
      [STORE_ACCESS]: (text: string) => {
        const widened = replace('    fields: [name, manager_id]\n', '    fields: [name, manager_id, auditor_id]\n')(text);
        const at = widened.indexOf('    fields: [name, manager_id, auditor_id]\n');
        const tail = widened.slice(at).replace(/    self_assign:\n      - field: store\.manager_id\n        role: store_manager\n        by: \[company_admin\]\n        reason: [^\n]*\n/u, '');
        return widened.slice(0, at) + tail;
      },
    });
    const r2 = errors(findings).filter((line) => line.startsWith('R2 '));

    expect(r2).toEqual([expect.stringMatching(R2_AUDITOR), expect.stringMatching(R2_MANAGER)]);
  });
});
