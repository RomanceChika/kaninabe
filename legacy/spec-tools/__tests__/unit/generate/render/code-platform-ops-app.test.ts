/**
 * 認証基盤の操作(`platform_ops`)の型・入力のスキーマ・Server Action・組み立ての根の生成器のテスト(ADR-0019)。
 *
 * 固定するのは字面の関門:
 *   - 入口は 実行者の解決 → パース(`input ?? {}`) → 〔多要素認証の解決〕→ 組み立ての根 → 拒否の記録 の順で、パースした値だけを渡す
 *   - 本人の操作の入力のスキーマ(z.strictObject)にメンバー ID の欄が無く、余剰の鍵は弾く(`.strict()`)・識別子は UUID の形(`format: uuid`)・型つきの入力の既定
 *   - 組み立ての根は宣言した対応表どおりに配線先を呼び(位置の引数・オブジェクトの引数)、結果は**明示の射影**で宣言した欄だけを写す
 *   - 多要素認証を要求する製品では配線先を呼ぶ前に判定を掛け(ロールの操作はロールを渡す)、外す製品・宣言の無い製品では 1 字も変わらない
 *   - 宣言の無い製品・実装の木を持たない製品は何も出さない
 */

import { describe, expect, it } from 'vitest';
import { platformOpsAppGenerator } from '../../../../lib/generate/render/code-platform-ops-app.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import { MFA_ALL, MFA_EXEMPT, platformContext } from '../../../helpers/platform-ops-fixture.js';
import { specModel } from '../../../helpers/model-builder.js';

/** 生成物(置き場の綴りは配置が決めるので、中身で見分けやすい印の部分一致で引く)。 */
function generate(ctx: GenerateContext): ReadonlyMap<string, string> {
  return new Map(platformOpsAppGenerator.generate(specModel([]), ctx).map((section) => [section.file, section.content]));
}

/** 生成物を末尾の綴りと置き場の根(入口は `_actions`・組み立ての根は `composition`)で引く。 */
function find(files: ReadonlyMap<string, string>, suffix: string, root = ''): string {
  const hit = [...files.entries()].find(([file]) => file.endsWith(suffix) && file.includes(root));
  if (hit === undefined) throw new Error(`${suffix} が生成されていません: ${[...files.keys()].join(', ')}`);
  return hit[1];
}

/** 操作の入口(Server Action)。 */
const entryOf = (files: ReadonlyMap<string, string>, op: string): string => find(files, `${op}.ts`, '/_actions/');

/** 操作の組み立ての根。 */
const compositionOf = (files: ReadonlyMap<string, string>, op: string): string => find(files, `${op}.ts`, '/composition/');

describe('platformOpsAppGenerator', () => {
  it('宣言の無い製品・実装の木を持たない製品は何も出さない', () => {
    expect(platformOpsAppGenerator.generate(specModel([]), GEN_CTX)).toEqual([]);
    expect(platformOpsAppGenerator.generate(specModel([]), { ...platformContext(), roots: { ...GEN_CTX.roots, app: null } })).toEqual([]);
  });

  it('型・スキーマの束 1 本と、操作ごとに入口と組み立ての根を出す(5 操作 = 11 本)', () => {
    const files = generate(platformContext());

    expect(files.size).toBe(11);
    expect([...files.keys()].filter((file) => file.endsWith('platform-ops.ts'))).toHaveLength(1);
    expect([...files.keys()].filter((file) => file.includes('end_member'))).toHaveLength(2);
  });

  describe('型・スキーマの束', () => {
    const types = (): string => find(generate(platformContext()), 'platform-ops.ts');

    it('操作の ID・表示名・確認の要否・拒否の文言が宣言から出る', () => {
      const text = types();

      expect(text).toContain("export const platformOpIds = ['session.list_mine', 'session.end_mine', 'session.end_others', 'session.end_member', 'session.end_every'] as const;");
      expect(text).toContain("'session.end_others': true,");
      expect(text).toContain("'session.end_mine': false,");
      expect(text).toContain("export const sessionManagementRefusals = {\n  'unauthenticated': 'ログインしてください',");
      expect(text).toContain("'session.end_mine': sessionManagementRefusals,");
    });

    it('返す欄の行の型は宣言した欄だけを持ち、欄の表が対応表を運ぶ', () => {
      const text = types();

      expect(text).toContain('export interface SessionSummaryRow {\n  readonly id: string;\n  readonly createdAt: string;\n  readonly lastUsedAt: string;\n  readonly isCurrent: boolean;');
      expect(text).toContain("{ field: 'last_used_at', prop: 'lastUsedAt', from: 'lastActiveAt', type: 'string', nullable: false, label: '最後に使った日時', format: 'datetime' },");
    });

    it('入力のスキーマ: メンバー ID の欄が無く、余剰の鍵を弾き、識別子は UUID の形・型つきの入力は既定を持つ', () => {
      const text = types();

      expect(text).toContain('export const sessionListMineInputSchema = z.strictObject({\n});');
      expect(text).not.toMatch(/z\s*\.\s*object\(|\.strict\(\)/u);
      expect(text).toContain('sessionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),');
      expect(text).toContain('keepSelf: z.boolean().default(true),');
      const endMine = text.slice(text.indexOf('export const sessionEndMineInputSchema'), text.indexOf('export type SessionEndMineInput'));
      expect(endMine).not.toMatch(/memberId|actorId/u);
      expect(endMine).toContain('= z.strictObject({');
    });
  });

  describe('入口(Server Action)', () => {
    it('実行者の解決 → パース → 組み立ての根 → 拒否の記録の順で、パースした値だけを渡す', () => {
      const text = entryOf(generate(platformContext()), 'end_mine');
      const at = (needle: string, from = 0): number => text.indexOf(needle, from);

      expect(text.startsWith("'use server';")).toBe(true);
      expect(at('await resolveActorId()')).toBeLessThan(at('.safeParse('));
      expect(text).toContain('sessionEndMineInputSchema.safeParse(input ?? {})');
      expect(at('.safeParse(')).toBeLessThan(at('await sessionEndMine('));
      expect(at('await sessionEndMine(')).toBeLessThan(at('recordActionRefusal(entry, err(refusalAsActionError(', at('await sessionEndMine(')));
      expect(text).toContain('await sessionEndMine({ actorId }, parsed.data).catch(');
      expect(text).not.toContain('input.');
      expect(text).toContain("import { recordActionRefusal, resolveActorId, resolveRequestId } from '@/composition/auth';");
    });

    it('配線先が投げたら、一時的な失敗として 1 行記録してから投げ直す(点検 21 回目 B21-4。文言は載せない)', () => {
      const text = entryOf(generate(platformContext()), 'end_mine');
      const call = text.indexOf('await sessionEndMine(');
      const guarded = text.slice(call, text.indexOf('});', call));
      expect(guarded).toContain(".catch((cause: unknown) => {");
      expect(guarded).toContain("recordActionRefusal(entry, err({ kind: 'temporarily_unavailable' }));");
      expect(guarded).toContain('throw cause;');
      expect(guarded).not.toContain('message');
    });

    it('入力の検証の失敗も記録して返す(入力値は記録に渡さない)', () => {
      const text = entryOf(generate(platformContext()), 'end_mine');

      expect(text).toContain("const refusal = { kind: 'invalid_input', issues: toFieldIssues(parsed.error) } as const;");
      expect(text).toContain("recordActionRefusal(entry, err(refusalAsActionError('session.end_mine', refusal)));");
    });

    it('多要素認証を要求する製品では、パースのあと組み立ての根の前に解決して渡す。外す製品・宣言の無い製品は 1 字も変わらない', () => {
      const required = entryOf(generate(platformContext({ mfa: MFA_ALL })), 'end_every');
      expect(required).toContain('resolveSessionMfa');
      expect(required.indexOf('.safeParse(')).toBeLessThan(required.indexOf('await resolveSessionMfa()'));
      expect(required.indexOf('await resolveSessionMfa()')).toBeLessThan(required.indexOf('await sessionEndEvery('));
      expect(required).toContain('await sessionEndEvery({ actorId, actorMfa }, parsed.data).catch(');
      expect(required).toContain('const actorMfa = await resolveSessionMfa().catch(');

      const exempt = generate(platformContext({ mfa: MFA_EXEMPT }));
      expect(exempt).toEqual(generate(platformContext()));
      expect([...exempt.values()].join('\n')).not.toContain('actorMfa');
    });
  });

  describe('組み立ての根', () => {
    it('本人の読み: 配線先の行を明示の射影で写す(宣言した欄だけ。余分な欄は写らない)', () => {
      const text = compositionOf(generate(platformContext()), 'list_mine');

      expect(text).toContain('result.value.map((row): SessionSummaryRow => ({');
      expect(text).toContain('      lastUsedAt: row.lastActiveAt,\n      isCurrent: row.current,');
      expect(text).not.toContain('...row');
      expect(text).toContain('const result = await port.list_mine();');
      expect(text).toContain('if (!result.ok) return platformRefusedWithin(result.reason, sessionManagementRefusals);');
      expect(text).toContain("import { sessionManagementRefusals } from '@/domain/generated/platform-ops';");
    });

    it('失敗の理由は申告の表の中に限って返す。生の理由をそのまま拒否にする旧い形(platformRefused(result.reason))は出さない(壊すと鳴る)', () => {
      const files = generate(platformContext());

      for (const op of ['list_mine', 'end_mine', 'end_others', 'end_member', 'end_every']) {
        const text = compositionOf(files, op);
        expect(text).toContain('return platformRefusedWithin(result.reason, sessionManagementRefusals);');
        expect(text).not.toMatch(/platformRefused\(/u);
        expect(text).toMatch(/import \{[^}]*platformRefusedWithin[^}]*\} from '@kaninabe\/runtime\/platform-op';/u);
      }
    });

    it('宣言した対応表どおりに配線先を呼ぶ(位置の引数・オブジェクトの引数)', () => {
      const files = generate(platformContext());

      expect(compositionOf(files, 'end_mine')).toContain('await port.end_mine(input.sessionId);');
      expect(compositionOf(files, 'end_member')).toContain('await port.end_member(input.memberId);');
      expect(compositionOf(files, 'end_every')).toContain('await port.end_every({ keepSelf: input.keepSelf });');
      expect(compositionOf(files, 'end_others')).toContain('await port.end_others();');
    });

    it('多要素認証を要求する製品では、配線先を呼ぶ前に判定を掛ける(ロールの操作はロールを、本人の操作は null を渡す)', () => {
      const files = generate(platformContext({ mfa: MFA_ALL }));
      const every = compositionOf(files, 'end_every');
      const mine = compositionOf(files, 'end_mine');

      expect(every.indexOf('mfaRefusal(')).toBeLessThan(every.indexOf('await port.'));
      expect(every).toContain("{ actorId: actor.actorId, actorMfa: actor.actorMfa, system: false }, ['staff'], '', 'session.end_every')");
      expect(mine).toContain("{ actorId: actor.actorId, actorMfa: actor.actorMfa, system: false }, null, '', 'session.end_mine')");
      expect(every).toContain('return platformMfaRequired();');
    });

    it('外す製品では判定の行が無く、使わない実行者の引数は下線つきで受ける', () => {
      const text = compositionOf(generate(platformContext({ mfa: MFA_EXEMPT })), 'end_mine');

      expect(text).not.toContain('mfaRefusal');
      expect(text).toContain('_actor: PlatformActorFacts');
    });

    it('主 export は 1 つだけ。配線先は省略可能な最後の引数で(省略は本番の配線を要求ごとに作る)、テストが差し替えられる', () => {
      const text = compositionOf(generate(platformContext()), 'end_mine');

      expect(text).toContain('export async function sessionEndMine(_actor: PlatformActorFacts, input: SessionEndMineInput, port: SessionManagement = sessionManagement())');
      expect(text.match(/^export (async )?function /gmu)).toHaveLength(1);
    });
  });
});
