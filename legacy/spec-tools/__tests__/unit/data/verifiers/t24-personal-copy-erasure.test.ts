/**
 * T24(消去される個人列の写しは、同じ消去で消える。点検 13 回目 A13-2)のテスト。
 *
 * 表: 写しの種類(スナップショット・トリガ)× 写し先の表が消去の宣言に載るか(`scrub` / `delete` / `update` / 呼び先 / イベントごと)。
 * 題材は架空のメンバー → 公開カード。
 */

import { describe, expect, it } from 'vitest';
import { verifyPersonalCopyErasure } from '../../../../lib/data/verifiers/t24-personal-copy-erasure.js';
import type { DataFunctionDecl, DataTableSpec, DataWriteKind } from '../../../../lib/model/data/types.js';
import type { SpecModel } from '../../../../lib/model/types.js';
import { accessSpec, aggregate, deleteRule, entitySpec, event, field, invariant, invariantSpec, machine, specModel } from '../../../helpers/model-builder-v8plus.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { jobModel, outboxJob } from '../../../helpers/job-builder.js';
import { loc } from '../../../helpers/model-builder.js';

const NAME = { kind: 'string' } as const;
const EVENT = 'membership.erase';
const RPC = 'erase_member';

/** 写し先の `organizer` が個人列か・写しの元の列が個人列かを選べる、スナップショットの題材。 */
function snapshotDomain(init: { readonly targetPersonal?: boolean; readonly sourcePersonal?: boolean } = {}): SpecModel {
  return specModel({
    aggregates: [
      aggregate({
        name: 'member',
        entity: entitySpec('member', [field('display_name', NAME, { personal: init.sourcePersonal ?? true })]),
        stateMachines: [
          {
            ...machine({ machine: 'membership', states: ['active', 'erased'], initial: 'active', events: [event({ id: 'erase', from: ['active'], to: 'erased', by: ['staff'] })] }),
            effects: [{ on: 'erase', do: ['snapshot_public_card'], snapshot: { to: 'public_card', fields: [{ from: 'member.display_name', to: 'organizer', location: loc() }, { from: 'now', to: 'copied_at', location: loc() }], location: loc() }, location: loc() }],
          },
        ],
      }),
      aggregate({ name: 'public_card', entity: { ...entitySpec('public_card', [field('organizer', NAME, { personal: init.targetPersonal ?? true })]), mirror: true } }),
    ],
  });
}

/** トリガでメンバーの名前を写す題材。 */
function triggerDomain(): SpecModel {
  return specModel({
    aggregates: [
      aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
      aggregate({
        name: 'card',
        entity: entitySpec('card', [field('member_id', { kind: 'ref', entity: 'member' }), field('organizer', NAME, { personal: true, suppliedBy: 'db' })]),
        invariants: invariantSpec([invariant({ id: 'INV-CARD-001', entities: ['card', 'member'], formal: { kind: 'check', expr: 'card.organizer == member.display_name' } })]),
      }),
    ],
  });
}

/** 消去の RPC。 */
function eraseRpc(writes: Readonly<Record<string, readonly DataWriteKind[]>>, extra: Partial<DataFunctionDecl> = {}): DataFunctionDecl {
  return { name: RPC, args: [], params: [], kind: 'rpc', shape: 'composite', handwritten: '消去', alsoWrites: Object.keys(writes), alsoWriteKinds: writes, selfWriteKinds: ['update', 'scrub'], ...extra };
}

/** 検査を実行する。 */
function run(domain: SpecModel, tables: readonly DataTableSpec[], jobs = jobModel([outboxJob('anonymize_member', { anonymizes: 'member', realizedBy: { [EVENT]: RPC } })])) {
  return verifyPersonalCopyErasure(domain, dataTableModel(tables), jobs);
}

const MEMBERS = (fn: DataFunctionDecl, extra: readonly DataFunctionDecl[] = []): DataTableSpec => dataTable('members', { entity: 'member', functions: [fn, ...extra] });
const TRIGGER = { name: 'sync_card', fires: 'before insert', supplies: ['organizer'], invariant: 'INV-CARD-001' } as unknown as DataTableSpec['triggers'][number];
const CARDS = dataTable('public_cards', { entity: 'public_card' });

describe('T24 消去される個人列の写し', () => {
  it('赤: E1 写し先を personal: true にしただけ(消去の宣言に無い)', () => {
    expect(run(snapshotDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), CARDS])).toEqual([
      expect.objectContaining({
        verifier: 'T24',
        severity: 'error',
        message: expect.stringContaining('消去(membership.erase の anonymize_member を実現する erase_member)の書き込みの宣言に public_cards がありません'),
        suggestion: expect.stringContaining('also_writes に "public_cards: [scrub]"'),
      }),
    ]);
  });

  it.each<{ name: string; kinds: readonly DataWriteKind[]; red: boolean }>([
    { name: 'scrub', kinds: ['scrub'], red: false },
    { name: 'delete', kinds: ['delete'], red: false },
    { name: 'update は消去に数えない(個人列を消すなら scrub)', kinds: ['update'], red: true },
    { name: 'insert', kinds: ['insert'], red: true },
  ])('書き込みの種類: $name', ({ kinds, red }) => {
    const found = run(snapshotDomain(), [MEMBERS(eraseRpc({ public_cards: kinds })), CARDS]);
    expect(found).toHaveLength(red ? 1 : 0);
  });

  it('緑: 呼び先の関数が消す', () => {
    const helper: DataFunctionDecl = { name: 'scrub_cards', args: [], params: [], kind: 'helper', alsoWrites: ['public_cards'], alsoWriteKinds: { public_cards: ['scrub'] } };
    expect(run(snapshotDomain(), [MEMBERS(eraseRpc({}, { calls: ['scrub_cards'] }), [helper]), CARDS])).toEqual([]);
  });

  it('イベントごとの宣言が優先する(event_writes に無ければ、also_writes に書いてあっても消えない)', () => {
    const fn = eraseRpc({ public_cards: ['scrub'] }, { eventWrites: { [EVENT]: { jobs: ['insert'] } } });
    expect(run(snapshotDomain(), [MEMBERS(fn), CARDS])).toHaveLength(1);
  });

  it('赤: 写しのトリガも同じ(写し元の表が消える表)', () => {
    const cards = dataTable('cards', { entity: 'card', triggers: [TRIGGER] });
    // 写しの指摘に加えて、本人への参照(member_id)を持つ表の個人列としても名指す(A14-2)。
    expect(run(triggerDomain(), [MEMBERS(eraseRpc({})), cards])).toEqual([
      expect.objectContaining({ message: expect.stringContaining('cards.member_id は本人(member)へ届く参照(card.member_id → member)') }),
      expect.objectContaining({ message: expect.stringContaining('member.display_name → card.organizer') }),
    ]);
    expect(run(triggerDomain(), [MEMBERS(eraseRpc({ cards: ['scrub'] }, { scrubVia: { cards: ['member_id'] } })), cards])).toEqual([]);
  });

  it.each<{ name: string; domain: SpecModel }>([
    { name: '写し先が personal でない(V12 / T15 の持ち場)', domain: snapshotDomain({ targetPersonal: false }) },
    { name: '写し元が personal でない', domain: snapshotDomain({ sourcePersonal: false }) },
  ])('見ない: $name', ({ domain }) => {
    expect(run(domain, [MEMBERS(eraseRpc({})), CARDS])).toEqual([]);
  });

  it('見ない: 消去の効果を持たない製品・カタログが読めない・RPC が無い(T19 の持ち場)', () => {
    const tables = [MEMBERS(eraseRpc({})), CARDS];
    expect(run(snapshotDomain(), tables, jobModel([outboxJob('notify_member')]))).toEqual([]);
    expect(run(snapshotDomain(), tables, jobModel([], false))).toEqual([]);
    expect(verifyPersonalCopyErasure(snapshotDomain(), dataTableModel(tables), undefined)).toEqual([]);
    expect(run(snapshotDomain(), tables, jobModel([outboxJob('anonymize_member', { anonymizes: 'member', realizedBy: { [EVENT]: 'missing_rpc' } })]))).toEqual([]);
  });

  it('見ない: 写し元の表が消えない消去', () => {
    const other = jobModel([outboxJob('anonymize_other', { anonymizes: 'visitor', realizedBy: { [EVENT]: RPC } })]);
    expect(run(snapshotDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] }, { selfWriteKinds: ['update'] })), CARDS], other)).toEqual([]);
    // 対照: 同じ宣言で、自表の個人列を消すと写し元の表が消える表に入り、写し先の欠けが鳴る
    expect(run(snapshotDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), CARDS], other)).toHaveLength(1);
  });

  describe('本人への直接の参照を持つ個人列(A14-2)', () => {
    /** 連絡先の個人列と本人への参照を持つ出店の題材。 */
    function referencingDomain(extra: { readonly personalColumns?: readonly string[] } = {}): SpecModel {
      return specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
          aggregate({ name: 'booth', entity: entitySpec('booth', [field('organizer_id', { kind: 'ref', entity: 'member' }), ...(extra.personalColumns ?? ['organizer_phone']).map((name) => field(name, NAME, { personal: true }))]) }),
        ],
      });
    }
    const BOOTHS = (extra: Partial<DataTableSpec> = {}): DataTableSpec => dataTable('booths', { entity: 'booth', ...extra });
    const ACCEPT = { via: 'organizer_id', columns: ['organizer_phone'], reason: '本人の連絡先ではない' };

    it('赤: E3b 本人への参照を持つ表の個人列が連鎖の外(写しでなくても)', () => {
      const findings = run(referencingDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), BOOTHS()]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('booths.organizer_id');
      expect(findings[0]?.counterexample).toMatchObject({ columns: 'organizer_phone' });
    });

    it('緑: 消去の宣言に scrub で載る', () => {
      expect(run(referencingDomain(), [MEMBERS(eraseRpc({ booths: ['scrub'] }, { scrubVia: { booths: ['organizer_id'] } })), BOOTHS()])).toEqual([]);
    });

    it('緑: 理由つきで受け入れる(列を名指す)', () => {
      expect(run(referencingDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), BOOTHS({ erasureAccepts: [ACCEPT] })])).toEqual([]);
    });

    it('赤: 受け入れの後で個人列が増えると残りを名指す(表の単位で受け入れない)', () => {
      const findings = run(referencingDomain({ personalColumns: ['organizer_phone', 'organizer_email'] }), [MEMBERS(eraseRpc({ jobs: ['insert'] })), BOOTHS({ erasureAccepts: [ACCEPT] })]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.counterexample).toMatchObject({ columns: 'organizer_email' });
    });

    it.each([
      ['参照でない列を指す', { ...ACCEPT, via: 'organizer_phone' }],
      ['個人列でない列を名指す', { ...ACCEPT, columns: ['organizer_phone', 'organizer_id'] }],
    ])('赤: 腐った受け入れ: %s', (_name, accept) => {
      const findings = run(referencingDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), BOOTHS({ erasureAccepts: [accept] })]);
      expect(findings.some((finding) => finding.message.includes('腐っています'))).toBe(true);
    });

    it('赤: 連鎖に入った表の受け入れは腐り', () => {
      const findings = run(referencingDomain(), [MEMBERS(eraseRpc({ booths: ['scrub'] }, { scrubVia: { booths: ['organizer_id'] } })), BOOTHS({ erasureAccepts: [ACCEPT] })]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('腐っています');
    });

    it('緑: 個人列を持たない表・参照を持たない表は見ない', () => {
      const domain = specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
          aggregate({ name: 'booth', entity: entitySpec('booth', [field('organizer_id', { kind: 'ref', entity: 'member' })]) }),
          aggregate({ name: 'venue', entity: entitySpec('venue', [field('contact', NAME, { personal: true })]) }),
        ],
      });
      expect(run(domain, [MEMBERS(eraseRpc({ jobs: ['insert'] })), BOOTHS(), dataTable('venues', { entity: 'venue' })])).toEqual([]);
    });

    it('緑: 消去の効果を持たない製品は鳴らない', () => {
      expect(run(referencingDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), BOOTHS()], jobModel([]))).toEqual([]);
    });
  });

  describe('参照を辿って本人に届く個人列(段の数を問わない。A15-3)', () => {
    /** メンバー ← 枠 ← 資料 ← 資料。資料に個人列を置き、枠は連鎖の中。 */
    function chainDomain(extra: { readonly sheetPersonal?: boolean; readonly cycle?: boolean } = {}): SpecModel {
      return specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
          aggregate({ name: 'entry', entity: entitySpec('entry', [field('owner_id', { kind: 'ref', entity: 'member' }), ...(extra.cycle === true ? [field('cover_piece_id', { kind: 'ref', entity: 'piece' })] : [])]) }),
          aggregate({ name: 'piece', entity: entitySpec('piece', [field('entry_id', { kind: 'ref', entity: 'entry' }), field('performer_memo', NAME, { personal: true })]) }),
          aggregate({ name: 'sheet', entity: entitySpec('sheet', [field('piece_id', { kind: 'ref', entity: 'piece' }), ...(extra.sheetPersonal === true ? [field('copied_by', NAME, { personal: true })] : [])]) }),
          aggregate({ name: 'room', entity: entitySpec('room', [field('note', NAME, { personal: true })]) }),
        ],
      });
    }
    const TABLES = (extra: Partial<DataTableSpec> = {}): readonly DataTableSpec[] => [dataTable('entries', { entity: 'entry' }), dataTable('pieces', { entity: 'piece', ...extra }), dataTable('sheets', { entity: 'sheet' }), dataTable('rooms', { entity: 'room' })];
    const MEMO_ACCEPT = { via: 'entry_id', columns: ['performer_memo'], reason: '編集者の連絡先で本人の個人データではない' };
    const ERASE = eraseRpc({ entries: ['scrub'] }, { scrubVia: { entries: ['owner_id'] } });

    it('赤: E3 2 段(piece.performer_memo → entry → member)を道つきで名指す', () => {
      const findings = run(chainDomain(), [MEMBERS(ERASE), ...TABLES()]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('pieces.entry_id は本人(member)へ届く参照(piece.entry_id → entry.owner_id → member)');
      expect(findings[0]?.counterexample).toMatchObject({ table: 'pieces', via: 'entry_id', columns: 'performer_memo' });
    });

    it('赤: 3 段(sheet → piece → entry → member)も同じ', () => {
      const findings = run(chainDomain({ sheetPersonal: true }), [MEMBERS(ERASE), ...TABLES({ erasureAccepts: [MEMO_ACCEPT] })]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('sheet.piece_id → piece.entry_id → entry.owner_id → member');
    });

    it('緑: 連鎖に scrub で載る / 名指しで受け入れる', () => {
      expect(run(chainDomain(), [MEMBERS(eraseRpc({ entries: ['scrub'], pieces: ['scrub'] }, { scrubVia: { entries: ['owner_id'], pieces: ['entry_id'] } })), ...TABLES()])).toEqual([]);
      expect(run(chainDomain(), [MEMBERS(ERASE), ...TABLES({ erasureAccepts: [MEMO_ACCEPT] })])).toEqual([]);
    });

    it('赤: 本人に届かなくなった列の受け入れは腐り', () => {
      const findings = run(chainDomain(), [MEMBERS(ERASE), ...TABLES({ erasureAccepts: [MEMO_ACCEPT, { ...MEMO_ACCEPT, via: 'performer_memo' }] })]);
      expect(findings.filter((finding) => finding.message.includes('腐っています'))).toHaveLength(1);
    });

    it('循環した参照でも止まり、本人に届く道を見つける', () => {
      const findings = run(chainDomain({ cycle: true }), [MEMBERS(ERASE), ...TABLES()]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('piece.entry_id → entry.owner_id → member');
    });

    it('見ない: 本人に届かない表の個人列(rooms)', () => {
      const findings = run(chainDomain(), [MEMBERS(ERASE), ...TABLES({ erasureAccepts: [MEMO_ACCEPT] })]);
      expect(findings).toEqual([]);
    });
  });

  describe('道ごとに見る(点検 16 回目 A16-3)', () => {
    /** 消える表に本人への参照が 2 本ある題材(`entry.helper_id: ref(member)` の再現)。 */
    function twoPaths(): SpecModel {
      return specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
          aggregate({ name: 'entry', entity: entitySpec('entry', [field('owner_id', { kind: 'ref', entity: 'member' }), field('helper_id', { kind: 'ref', entity: 'member' }), field('note', NAME, { personal: true })]) }),
        ],
      });
    }
    const ENTRIES = (extra: Partial<DataTableSpec> = {}): DataTableSpec => dataTable('entries', { entity: 'entry', ...extra });

    it('赤: 消える表の別の道は scrub_via にも受け入れにも無ければ赤(表の単位では止まらない)', () => {
      const findings = run(twoPaths(), [MEMBERS(eraseRpc({ entries: ['scrub'] }, { scrubVia: { entries: ['owner_id'] } })), ENTRIES()]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('entries.helper_id');
      expect(findings[0]?.counterexample).toMatchObject({ via: 'helper_id', columns: 'note' });
    });

    it('赤: scrub_via が無ければ全部の道が赤(scrub の宣言だけでは通らない)', () => {
      expect(run(twoPaths(), [MEMBERS(eraseRpc({ entries: ['scrub'] })), ENTRIES()])).toHaveLength(2);
    });

    it('緑: 全部の道が scrub_via に載る / 別の人の行として受け入れる', () => {
      expect(run(twoPaths(), [MEMBERS(eraseRpc({ entries: ['scrub'] }, { scrubVia: { entries: ['owner_id', 'helper_id'] } })), ENTRIES()])).toEqual([]);
      const accept = { via: 'helper_id', columns: ['note'], reason: '文章の持ち主は枠主で補助者ではない' };
      expect(run(twoPaths(), [MEMBERS(eraseRpc({ entries: ['scrub'] }, { scrubVia: { entries: ['owner_id'] } })), ENTRIES({ erasureAccepts: [accept] })])).toEqual([]);
    });

    it('赤: scrub_via の列が本人へ届かない・表が消去の宣言に無いのは腐り', () => {
      const findings = run(twoPaths(), [MEMBERS(eraseRpc({ jobs: ['insert'] }, { scrubVia: { entries: ['owner_id', 'helper_id', 'note'] } })), ENTRIES()]);
      expect(findings.filter((finding) => finding.location.pointer === 'scrub_via').map((finding) => finding.message).join('\n')).toMatch(/note は member へ届く参照の列ではありません[\s\S]*消去の宣言に載っていません/);
    });
  });

  describe('本人の行が指す表の個人列(点検 16 回目 A16-2)', () => {
    function reverseDomain(personal: readonly string[] = ['note']): SpecModel {
      return specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true }), field('invited_via', { kind: 'ref', entity: 'invitation' })]) }),
          aggregate({ name: 'invitation', entity: entitySpec('invitation', [field('code', NAME), ...personal.map((name) => field(name, NAME, { personal: true }))]) }),
        ],
      });
    }
    const INVITES = (extra: Partial<DataTableSpec> = {}): DataTableSpec => dataTable('invitations', { entity: 'invitation', ...extra });
    const ROW = { column: 'note', via: 'members.invited_via', reason: '宛先の名前' };

    it('赤: 分類の無い個人列を名指す', () => {
      const findings = run(reverseDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), INVITES()]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('members.invited_via');
      expect(findings[0]?.counterexample).toMatchObject({ columns: 'note' });
    });

    it('緑: 宛先の表に載せて消す / 受け入れる', () => {
      expect(run(reverseDomain(), [MEMBERS(eraseRpc({ invitations: ['scrub'] })), INVITES({ erasureAddressees: [ROW] })])).toEqual([]);
      expect(run(reverseDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), INVITES({ erasureAccepts: [{ via: 'members.invited_via', columns: ['note'], reason: '本人のものでない' }] })])).toEqual([]);
    });

    it('赤: 個人列を足すと、分類に無い列を名指す(閉じた表)', () => {
      const findings = run(reverseDomain(['note', 'memo']), [MEMBERS(eraseRpc({ invitations: ['scrub'] })), INVITES({ erasureAddressees: [ROW] })]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.counterexample).toMatchObject({ columns: 'memo' });
    });

    it('赤: 宛先の表の腐り(消去の宣言に無い・参照が違う・個人列でない)', () => {
      const findings = run(reverseDomain(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), INVITES({ erasureAddressees: [ROW, { column: 'code', via: 'members.other', reason: 'x' }] })]);
      const text = findings.filter((finding) => finding.message.includes('腐っています')).map((finding) => finding.message).join('\n');
      expect(text).toMatch(/消去の宣言に載っていません/);
      expect(text).toMatch(/members\.other は本人の行から/);
      expect(text).toMatch(/code は個人列ではありません/);
    });
  });

  describe('内部テーブル(点検 16 回目 A16-7)', () => {
    const DOMAIN = (): SpecModel => specModel({ aggregates: [aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }), aggregate({ name: 'entry', entity: entitySpec('entry', [field('owner_id', { kind: 'ref', entity: 'member' })]) })] });
    const key = (column: string, references: string): DataTableSpec['foreignKeys'][number] => ({ column, references, onDelete: 'no_action' });
    const LOG = (extra: Partial<DataTableSpec> = {}): DataTableSpec => dataTable('audit_trail', { internal: true, foreignKeys: [key('member_id', 'members')], ...extra });

    it('赤: 本人へ届く外部キーを持つ内部テーブルは personal_columns が必須', () => {
      const findings = run(DOMAIN(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), LOG()]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('内部テーブル audit_trail');
    });

    it('緑: 個人列を持たないの宣言(空の並び)', () => {
      expect(run(DOMAIN(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), LOG({ personalColumns: [] })])).toEqual([]);
    });

    it('赤: 個人列があれば道の検査に入る(消去の宣言か受け入れが要る)', () => {
      const findings = run(DOMAIN(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), LOG({ personalColumns: ['name_copy'] })]);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('audit_trail.member_id');
    });

    it('緑: 消去の宣言と scrub_via に載る', () => {
      expect(run(DOMAIN(), [MEMBERS(eraseRpc({ audit_trail: ['scrub'] }, { scrubVia: { audit_trail: ['member_id'] } })), LOG({ personalColumns: ['name_copy'] })])).toEqual([]);
    });

    // 仕組みの表の実行者の列(設計図の actorColumns。外部キーを張らない)も本人へ届く道に数える(点検 21 回目 A21-1)。
    const DIGESTS = (extra: Partial<DataTableSpec> = {}): DataTableSpec => dataTable('resend_digests', { internal: true, framework: 'resend_digests', retentionHours: 24, personalColumns: ['input_digest'], ...extra });

    it('赤: 仕組みの表の実行者の列は外部キーが無くても本人へ届く道で、消去の宣言が無ければ名指す', () => {
      const findings = run(DOMAIN(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), DIGESTS()]);
      expect(findings.map((finding) => finding.message).join('\n')).toContain('resend_digests.actor_id');
    });

    it('緑: 仕組みの表の実行者の列を消去の宣言と scrub_via に載せる', () => {
      expect(run(DOMAIN(), [MEMBERS(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id'] } })), DIGESTS()])).toEqual([]);
    });

    // 保存点の錨の列(設計図の anchorColumns = entity_id)も、錨の行か錨の子の行(同行の参加者)が本人へ届けば道に数える(点検 22 回目 A の O22-1)。
    // 題材: 枠(slot。作成の再送の宣言を持つ = 錨になりうる)は本人を指さず、枠の子の同行者(companion)だけが本人を指す。
    const ANCHOR_DOMAIN = (): SpecModel =>
      specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
          aggregate({ name: 'slot', entity: entitySpec('slot', [field('title', NAME)]) }),
          aggregate({ name: 'companion', entity: entitySpec('companion', [field('slot_id', { kind: 'ref', entity: 'slot' }), field('member_id', { kind: 'ref', entity: 'member' })]) }),
        ],
      });
    const RESEND = { returnsExisting: false, location: loc() };
    const ANCHOR_TABLES = (fn: DataFunctionDecl): readonly DataTableSpec[] => [
      MEMBERS(fn),
      dataTable('slots', { entity: 'slot', resend: RESEND }),
      dataTable('companions', { entity: 'companion', erasureAccepts: [] }),
      DIGESTS(),
    ];

    it('赤: 錨の子の行(同行者)だけが本人へ届く保存点の要約は、実行者の列だけの消去では消えないと名指す', () => {
      const findings = run(ANCHOR_DOMAIN(), ANCHOR_TABLES(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id'] } })));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('resend_digests.entity_id は本人(member)へ届く参照(resend_digests.entity_id → (錨: slots) → companion.slot_id(錨の子) → companion.member_id → member)');
      expect(findings[0]?.counterexample).toMatchObject({ table: 'resend_digests', via: 'entity_id', columns: 'input_digest' });
    });

    it('錨の行が作った後に消えうる(access の deletes。定義は T28 と共有)なら、道に「錨が消えると道も消える」を数えて名指す(点検 23 回目 A23-2)', () => {
      const domain = (deletable: boolean): SpecModel =>
        specModel({
          aggregates: [
            aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
            aggregate({ name: 'slot', entity: entitySpec('slot', [field('title', NAME)]), ...(deletable ? { access: accessSpec('slot', { deletes: [deleteRule('member')] }) } : {}) }),
            aggregate({ name: 'companion', entity: entitySpec('companion', [field('slot_id', { kind: 'ref', entity: 'slot' }), field('member_id', { kind: 'ref', entity: 'member' })]) }),
          ],
        });
      const tables = ANCHOR_TABLES(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id'] } }));
      expect(run(domain(true), tables)[0]?.message).toContain('(錨: slots。錨が消えると道も消える = 消去は錨の無い要約も消す)');
      expect(run(domain(false), tables)[0]?.message).not.toContain('錨が消えると道も消える');
    });

    it('緑: scrub_via の resend_digests に錨の列 entity_id を足す', () => {
      expect(run(ANCHOR_DOMAIN(), ANCHOR_TABLES(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id', 'entity_id'] } })))).toEqual([]);
    });

    it('緑: 錨になりうる表(resend の宣言)が本人へ届かなければ、錨の列は道でない(entity_id を載せると腐り)', () => {
      const tables = [MEMBERS(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id'] } })), dataTable('slots', { entity: 'slot', resend: RESEND }), DIGESTS()];
      expect(run(ANCHOR_DOMAIN(), tables)).toEqual([]);
      const stale = run(ANCHOR_DOMAIN(), [MEMBERS(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id', 'entity_id'] } })), dataTable('slots', { entity: 'slot', resend: RESEND }), DIGESTS()]);
      expect(stale.map((finding) => finding.message)).toEqual([expect.stringContaining('entity_id は member へ届く参照の列ではありません')]);
    });

    it('赤: 錨の行そのものが本人を指す(枠主)保存点も道に数える', () => {
      const tables = [MEMBERS(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id'] } })), dataTable('entries', { entity: 'entry', resend: RESEND }), DIGESTS()];
      expect(run(DOMAIN(), tables).map((finding) => finding.message).join('\n')).toContain('resend_digests.entity_id → (錨: entries) → entry.owner_id → member');
    });

    // 点検 24 回目 O24-1: 要約が誰を覆うかは usecase/resend-digest-cover.ts 1 か所が決め、T24 と消去の本文の期待(digestAnchorsOf)が同じ導出を呼ぶ。
    it('赤: 本人の行が錨を指すだけ(逆向き。本人を生んだ招待)の保存点も道に数える(期待の側と同じ枝)', () => {
      const domain = specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true }), field('invited_via', { kind: 'ref', entity: 'invite' })]) }),
          aggregate({ name: 'invite', entity: entitySpec('invite', [field('code', NAME)]) }),
        ],
      });
      const tables = [MEMBERS(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id'] } })), dataTable('invites', { entity: 'invite', resend: RESEND }), DIGESTS()];
      expect(run(domain, tables).map((finding) => finding.message).join('\n')).toContain('resend_digests.entity_id → (錨: invites) → member.invited_via(本人の行が錨を指す) → member');
    });

    it('緑: 2 段の参照(錨 → 中間の表 → 本人)だけの錨は、要約の入力に本人が名指されないので道に数えない(期待の側と同じ)', () => {
      const domain = specModel({
        aggregates: [
          aggregate({ name: 'member', entity: entitySpec('member', [field('display_name', NAME, { personal: true })]) }),
          aggregate({ name: 'event', entity: entitySpec('event', [field('organizer_id', { kind: 'ref', entity: 'member' })]) }),
          aggregate({ name: 'slot', entity: entitySpec('slot', [field('event_id', { kind: 'ref', entity: 'event' })]) }),
        ],
      });
      const tables = [MEMBERS(eraseRpc({ resend_digests: ['delete'] }, { scrubVia: { resend_digests: ['actor_id'] } })), dataTable('events', { entity: 'event' }), dataTable('slots', { entity: 'slot', resend: RESEND }), DIGESTS()];
      expect(run(domain, tables).filter((finding) => finding.message.includes('resend_digests.entity_id'))).toEqual([]);
    });

    it('緑: 監査ログ(設計図の実行者の列を持たない)の actor_id は道に数えない', () => {
      expect(run(DOMAIN(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), dataTable('domain_events', { internal: true, framework: 'domain_events' })])).toEqual([]);
    });

    it('赤: 別の表を経て本人へ届く外部キーも同じ', () => {
      const findings = run(DOMAIN(), [MEMBERS(eraseRpc({ jobs: ['insert'] })), LOG({ foreignKeys: [key('entry_id', 'entries')], personalColumns: ['name_copy'] }), dataTable('entries', { entity: 'entry' })]);
      expect(findings.map((finding) => finding.message).join('\n')).toContain('audit_trail.entry_id');
    });
  });
});
