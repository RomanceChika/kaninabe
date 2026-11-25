/**
 * X7 外へ送る自由文の無害化の突合(ASVS V1.3.3。規則の正は enforcement-matrix の C21)。
 *
 * 外部連携が外へ送る自由文(Discord のメッセージ・AI のプロンプトなど)は、危ない文脈(メンション・指示・制御列)へ渡る。
 * 行の `sends.neutralize` が「どの部品を通すか」を宣言し(`@kaninabe/runtime/neutralize` の語彙)、手書きのアダプタがその部品を呼んでいることをここが突き合わせる。
 *
 * | 止める形 | 直し方 |
 * |---|---|
 * | 宣言した部品(`discord_mentions` = `neutralizeDiscordMentions` と `allowedDiscordMentionsOf` / `control_chars` = `stripControlChars` / `length:N` = `clampLength(…, N)`)を、アダプタが `@kaninabe/runtime/neutralize` の束縛で呼んでいない | アダプタが送る前に部品を通す。`length:N` は第 2 引数に宣言と同じ数のリテラルを書く |
 * | `neutralize_none` なのに、`sends.fields` が利用者が書ける文字列の欄(`access_spec` の `writes[].fields` か action_spec の `input` に載る `string` / `text`)を送っている | `neutralize` で部品を宣言して通す |
 * | `sends.fields` が `bearer` の欄(持っていれば効く値)を送っている | 外の相手に渡さない。送る必要があるなら、値でなく手続きの識別子に替える |
 *
 * アダプタの実装を読むので、実装の木(製品が宣言した根)が実在する環境でだけアダプタの突合が成立する(X6 と同じ扱い。仕様だけを持つリポジトリでは宣言どうしの 2 つだけを見る)。
 * 呼んでいることまでが下限で、結果を実際に送る値に使っているかは見ない。
 */

import path from 'node:path';
import { appGrounded, isFile } from '../../io/paths.js';
import { tryReadText } from '../../io/read-text.js';
import { makeFinding, type Finding } from '../../kernel/finding.js';
import { NEUTRALIZE_MODULE, neutralizerExports, neutralizerWord, type NeutralizerDecl } from '../../kernel/neutralize.js';
import type { ExternalCatalogSpec, IntegrationDecl } from '../../model/external/types.js';
import { inputValue, unusableOf, type CatalogInput, type InputGapNote } from '../../kernel/input-state.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { FieldDef, SpecModel } from '../../model/types.js';
import type { AggregateSpecs } from '../../model/types-model.js';
import { neutralizeCallsIn, type NeutralizeCall } from '../neutralize-scan.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X7';

/** X7 の入力。 */
export interface NeutralizeInput {
  /** 構築済みのドメイン仕様モデル(送る欄の型・書き手・`bearer`)。 */
  readonly domain: SpecModel;
  /** 読み込み済みの外部連携カタログ。 */
  readonly catalog: ExternalCatalogSpec;
  /** リポジトリルートの絶対パス(アダプタの実装を読む)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木の位置)。 */
  readonly roots: ProductRoots;
  /**
   * action_spec の入力の状態(利用者が入力で書ける欄を引く)。**未選択は「入力を持つ操作は無い」という事実**で、編集の規則に載る欄だけで判定する。
   * **阻害は「分からない」**で、入力に載る欄を数えられないので、`neutralize_none` の行の判定が甘くなることを `neutralizeGaps` が名指す。
   */
  readonly actionSpecs: CatalogInput<ActionSpecModel>;
}

/** 送る欄の参照 `{entity}.{field}` を引く(集約と欄の宣言)。 */
function lookup(domain: SpecModel, ref: string): { readonly specs: AggregateSpecs; readonly field: FieldDef } | null {
  const dot = ref.indexOf('.');
  if (dot < 0) return null;
  const entity = ref.slice(0, dot);
  const name = ref.slice(dot + 1);
  for (const [aggregate, specs] of domain.aggregates) {
    if (specs.entity === undefined || (specs.entity.entity !== entity && aggregate !== entity)) continue;
    const field = specs.entity.fields.find((candidate) => candidate.name === name);
    return field === undefined ? null : { specs, field };
  }
  return null;
}

/** 利用者が書ける文字列の欄か(`string` / `text` で、access_spec の `writes[].fields` に載る、または action_spec の `input` に載る)。 */
function userWritableText(domain: SpecModel, actions: ActionSpecModel | null, ref: string): boolean {
  const found = lookup(domain, ref);
  if (found === null || (found.field.type.kind !== 'string' && found.field.type.kind !== 'text')) return false;
  const name = found.field.name;
  if ((found.specs.access?.writes ?? []).some((rule) => rule.fields.includes(name))) return true;
  const entity = found.specs.entity?.entity;
  return (actions?.actions ?? []).some((action) => action.input.some((input) => input.field === name && input.entity === entity));
}

/** 送る欄が `bearer` か。 */
function isBearer(domain: SpecModel, ref: string): boolean {
  return lookup(domain, ref)?.field.bearer !== undefined;
}

/** アダプタの宣言した部品 1 つに対する指摘(呼ばれていれば空)。 */
function partFindings(integration: IntegrationDecl, part: NeutralizerDecl, calls: readonly NeutralizeCall[]): Finding[] {
  const word = neutralizerWord(part);
  const missing = neutralizerExports(part).filter((name) => !calls.some((call) => call.name === name && (part.kind !== 'length' || call.limit === part.max)));
  return missing.map((name) => {
    const wrongLimit = part.kind === 'length' && calls.some((call) => call.name === name);
    return makeFinding(VERIFIER_ID, {
      message: wrongLimit
        ? `連携 ${integration.id} の neutralize ${word} に対し、${integration.adapter} の ${name} の第 2 引数が ${String(part.kind === 'length' ? part.max : '')} のリテラルではありません`
        : `連携 ${integration.id} は neutralize ${word} を宣言していますが、${integration.adapter} が ${name}(${NEUTRALIZE_MODULE})を呼んでいません`,
      location: integration.location,
      suggestion:
        part.kind === 'length'
          ? `アダプタで \`clampLength(text, ${String(part.max)})\` を送る前の本文に通す(数は宣言と同じリテラル)`
          : `アダプタで ${NEUTRALIZE_MODULE} の ${name} を import し、送る前の本文(または送る許可)に通す。使わない部品は neutralize の宣言から外す`,
      counterexample: { integration: integration.id, adapter: integration.adapter, part: word, missing: name },
    });
  });
}

/** 宣言と実装の突合(アダプタが読めないときは X1 が言うので黙る)。 */
function adapterFindings(integration: IntegrationDecl, repoRoot: string): Finding[] {
  const declared = integration.sends.neutralize;
  if (declared?.kind !== 'apply') return [];
  const absolute = path.join(repoRoot, integration.adapter);
  if (!isFile(absolute)) return [];
  const source = tryReadText(absolute);
  if (source === null) return [];
  const calls = neutralizeCallsIn(source, integration.adapter);
  return declared.parts.flatMap((part) => partFindings(integration, part, calls));
}

/** 宣言どうしの突合(`none` と編集できる欄・`bearer` を送らない)。 */
function declarationFindings(integration: IntegrationDecl, domain: SpecModel, actions: ActionSpecModel | null): Finding[] {
  const declared = integration.sends.neutralize;
  const findings: Finding[] = [];
  if (declared?.kind === 'none') {
    for (const ref of integration.sends.fields.filter((candidate) => userWritableText(domain, actions, candidate))) {
      findings.push(
        makeFinding(VERIFIER_ID, {
          message: `連携 ${integration.id} は neutralize_none(${declared.reason})ですが、利用者が書ける文字列の欄 ${ref} を送っています`,
          location: integration.location,
          suggestion: 'sends.neutralize に部品(discord_mentions / control_chars / length:N)を宣言し、アダプタで通す。neutralize_none は無害化する自由文を送らない連携だけに書く',
          counterexample: { integration: integration.id, field: ref },
        }),
      );
    }
  }
  for (const ref of integration.sends.fields.filter((candidate) => isBearer(domain, candidate))) {
    findings.push(
      makeFinding(VERIFIER_ID, {
        message: `連携 ${integration.id} が bearer の欄 ${ref}(持っていれば効く値)を外の相手に送っています`,
        location: integration.location,
        suggestion: 'bearer の値は外へ渡さない(渡した相手が権能を持つ)。必要なら値でなく手続きの識別子を送る',
        counterexample: { integration: integration.id, field: ref },
      }),
    );
  }
  return findings;
}

/**
 * 無害化の宣言とアダプタの実装を突き合わせる。
 *
 * @param input ドメイン仕様・カタログ・リポジトリルート
 * @returns 違反(無ければ空)
 */
export function verifyNeutralize(input: NeutralizeInput): Finding[] {
  const grounded = appGrounded(input.repoRoot, input.roots.app);
  return input.catalog.integrations.flatMap((integration) => [
    ...declarationFindings(integration, input.domain, inputValue(input.actionSpecs) ?? null),
    ...(grounded ? adapterFindings(integration, input.repoRoot) : []),
  ]);
}

/**
 * action_spec が阻害のために、`neutralize_none` の行の判定が「編集の規則に載る欄」だけになった連携の記録(使えるとき・未選択のときは空)。
 *
 * 未選択は事実(入力を持つ操作は無い)なので載せない。阻害のときだけ、`neutralize_none` で文字列の欄を送っている連携を名指して返す
 * (**無ければ見ていないものも無いので空**)。実行ログが 1 行で報告する。
 *
 * @param input X7 の入力
 */
export function neutralizeGaps(input: NeutralizeInput): readonly InputGapNote[] {
  const gap = unusableOf(input.actionSpecs, 'actions');
  if (gap === null || gap.state !== 'blocked') return [];
  const subjects = input.catalog.integrations
    .filter((integration) => integration.sends.neutralize?.kind === 'none' && integration.sends.fields.length > 0)
    .map((integration) => integration.id);
  if (subjects.length === 0) return [];
  return [{ gap, consequence: 'neutralize_none の行が利用者の入力で書ける文字列の欄(action_spec の input)を送っていないかは見ていません(編集の規則に載る欄だけを見ました)', subjects }];
}
