/**
 * role_spec(roles.md)のパーサー。
 *
 * スキーマの正: domain-spec-writing.md §role_spec。
 * ここで見るのは V1(構造・必須フィールド・型)だけで、ロールが実際に使われているか、
 * binding 式が解決可能かは V2 / V11 が見る。
 */

import type { RoleDef, RoleKind, RoleSpec } from './types.js';
import { ROLE_KINDS } from './types.js';
import {
  asRecord,
  checkDocType,
  elementPointer,
  SpecReporter,
  type ParseResult,
} from './parse-common.js';
import { eachRecord, YamlReader } from './yaml-reader.js';
import { findImplyCycle } from './role-hierarchy.js';
import { parseClaimText } from './role-claim.js';
import { identifierField } from './sql-fields.js';

const ROLES_SUGGESTION =
  'roles: に "- id: {role_id}" の形でロールを列挙する(template.role_spec.md 参照)';

const IMPLIES_SUGGESTION =
  'implies にはこのロールが必ず併せ持つロール ID を並べる(例: organizer は必ず member → implies: [member])';

const KIND_SUGGESTION = `kind は ${ROLE_KINDS.join(' / ')} のいずれかを書く(グローバルロールだけが持てる)`;

const CLAIM_SUGGESTION =
  'claim は実行者自身の行の欄を書く。boolean の欄は "{entity}.{field}"、' +
  'state / enum の欄は値を添える("{entity}.{field} == {値}" または "{entity}.{field} in [{値}, ...]")。' +
  '指せるのは session: true を宣言した boolean / enum / state の欄だけである(V11)';

/**
 * roles.md のフロントマターを RoleSpec に変換する。
 *
 * @param data フロントマターのパース結果(unknown)
 * @param file リポジトリルートからの相対パス(Finding の location に入る)
 * @returns RoleSpec と V1 違反。roles を配列として読めない場合のみ value=null
 */
export function parseRoleSpec(data: unknown, file: string): ParseResult<RoleSpec> {
  const reporter = new SpecReporter(file);
  const record = asRecord(data);
  if (record === null) {
    reporter.error(
      undefined,
      'roles.md のフロントマターがマッピングではありません',
      'フロントマターを doc_type: role_spec から始まる YAML マッピングとして書き直す',
    );
    return { value: null, findings: reporter.findings() };
  }

  checkDocType(record, 'role_spec', reporter);

  const root = new YamlReader(record, '', reporter);
  const items = root.requiredList('roles', ROLES_SUGGESTION);
  if (items === null) {
    return { value: null, findings: reporter.findings() };
  }

  const roles = parseRoleDefs(items, reporter);
  checkImplies(roles, reporter);
  checkKinds(roles, reporter);
  return { value: { roles, location: reporter.location() }, findings: reporter.findings() };
}

/**
 * `kind`(グローバルロールの種別)の閉世界を検査する。
 *
 * `anonymous` / `authenticated_default` / `system` はそれぞれちょうど 1 つのロールが
 * 持たなければならない —— 仕組み側のコード(`GLOBAL_ROLES` 生成物経由)がこの前提で
 * 「未ログインに対応するロール」「認証ユーザーの既定ロール」を引くため、0 個(未接地)や
 * 2 個以上(どちらか分からない)は許さない。
 */
function checkKinds(roles: readonly RoleDef[], reporter: SpecReporter): void {
  for (const kind of ROLE_KINDS) {
    const matches = roles.filter((role) => role.kind === kind);
    if (matches.length === 1) continue;
    if (matches.length === 0) {
      reporter.error(
        'roles',
        `kind: ${kind} を持つロールがありません`,
        `roles のいずれか 1 つに kind: ${kind} を足す(${KIND_SUGGESTION})`,
        { kind },
      );
      continue;
    }
    reporter.error(
      'roles',
      `kind: ${kind} を持つロールが ${matches.length} 個あります(${matches.map((r) => r.id).join(', ')})`,
      `kind: ${kind} はちょうど 1 つのロールだけが持てる。どちらか一方から kind を外す`,
      { kind, roles: matches.map((r) => r.id).join(',') },
    );
  }
}

/**
 * `implies` の参照先が実在し、循環していないことを検査する。
 *
 * ロール階層は「A を持つ主体は必ず B も持つ」の宣言なので、実在しないロールを指す宣言は
 * 意味を持たず、循環は「2 つが同じロール」を意味してしまい包含関係の推論が壊れる。
 */
function checkImplies(roles: readonly RoleDef[], reporter: SpecReporter): void {
  const known = new Set(roles.map((role) => role.id));
  for (const role of roles) {
    for (const target of role.implies ?? []) {
      if (target === role.id) {
        reporter.error(
          `roles.${role.id}.implies`,
          `${role.id} の implies が自分自身を指しています`,
          IMPLIES_SUGGESTION,
          { role: role.id },
        );
        continue;
      }
      if (known.has(target)) continue;
      reporter.error(
        `roles.${role.id}.implies`,
        `${role.id} の implies が指すロール ${target} が定義されていません`,
        `roles に ${target} を追加するか、implies を実在するロール ID に直す`,
        { role: role.id, implies: target },
      );
    }
  }

  const cycle = findImplyCycle(roles);
  if (cycle === null) return;
  reporter.error(
    'roles',
    `implies が循環しています: ${cycle.join(' → ')}`,
    '循環は「2 つが同じロール」を意味する。どちらか一方の implies を外すか、ロールを 1 つに統合する',
    { cycle: cycle.join(' → ') },
  );
}

/** `kind`(値域)を読む。値があって値域に無ければエラーにして `undefined` を返す。 */
function parseKind(reader: YamlReader, id: string, reporter: SpecReporter): RoleKind | undefined {
  const raw = reader.optionalString('kind', KIND_SUGGESTION);
  if (raw === undefined) return undefined;
  if ((ROLE_KINDS as readonly string[]).includes(raw)) return raw as RoleKind;
  reporter.error(`roles.${id}.kind`, `kind ${raw} は値域(${ROLE_KINDS.join(' / ')})にありません`, KIND_SUGGESTION, {
    role: id,
    kind: raw,
  });
  return undefined;
}

/** `claim` と併記できる唯一の `kind`。 */
const AUTHENTICATED_DEFAULT: RoleKind = 'authenticated_default';

/** 読んだ `claim`(欄のパスと、state / enum の欄なら値の集合)。 */
interface ParsedClaim {
  readonly path: string;
  readonly values: readonly string[] | null;
}

/**
 * `claim`(実行者自身の行の欄が根拠のロール)を読む。
 *
 * ここで見るのは**形**だけである(`role-claim.ts` の 3 つの書き方のどれか)。指す欄が実在し、
 * `session: true` かつ型と値が合っていることは V11 が見る —— パーサーは 1 ファイルの中で閉じた
 * 形式しか見ない(他の仕様との突合は検証器の役目)。
 */
function parseClaim(reader: YamlReader, id: string, reporter: SpecReporter): ParsedClaim | undefined {
  const raw = reader.optionalString('claim', CLAIM_SUGGESTION);
  if (raw === undefined) return undefined;
  const parsed = parseClaimText(raw);
  if (parsed.ok) return { path: parsed.path, values: parsed.values };
  reporter.error(
    `roles.${id}.claim`,
    `${id} の claim を読めません(${parsed.reason})`,
    CLAIM_SUGGESTION,
    { role: id, claim: raw },
  );
  return undefined;
}

/**
 * `claim` と同時に書けない語(書かれているものだけを返す)。
 *
 * `kind` は `authenticated_default` とだけ併記できる —— 「実行者の行がある」ことが根拠のロールに、
 * 「その行の欄がこの条件を満たす」を足す形である(他の 2 種は行を根拠にしない)。
 */
function claimConflicts(kind: string | undefined, binding: string | undefined): readonly string[] {
  const conflicts: string[] = [];
  if (kind !== undefined && kind !== AUTHENTICATED_DEFAULT) conflicts.push('kind');
  if (binding !== undefined) conflicts.push('binding');
  return conflicts;
}

function parseRoleDefs(items: readonly unknown[], reporter: SpecReporter): readonly RoleDef[] {
  const roles: RoleDef[] = [];
  eachRecord(items, 'roles', reporter, ROLES_SUGGESTION, (reader, index) => {
    // ロール ID は RLS のポリシー名・補助関数名として生成 SQL にそのまま置かれるので、識別子の文法で閉じる(R17)。
    const id = identifierField(
      reader,
      reporter,
      'id',
      reader.requiredString('id', 'ロール識別子(スネークケース)を id に書く。例: "- id: performer"'),
    );
    if (id === null) return;
    const label = reader.optionalString(
      'label',
      'label は人間向けの日本語名を文字列で書く。例: label: 発表者',
    );
    const binding = reader.optionalString(
      'binding',
      'binding は文脈依存ロールの成立条件をガード式の文字列で書く。例: binding: "entry.performer_id == actor.id"',
    );
    const implies = reader.has('implies')
      ? reader.requiredStringList('implies', IMPLIES_SUGGESTION, false)
      : null;
    const kind = parseKind(reader, id, reporter);
    const claim = parseClaim(reader, id, reporter);
    if (kind !== undefined && binding !== undefined) {
      reporter.error(
        `roles[${index}].kind`,
        `${id} は kind と binding を両方持っています`,
        'kind はグローバルロールだけが持てる(binding を持つ文脈依存ロールは kind を書かない)',
        { role: id },
      );
    }
    // 根拠は 1 つに決まらなければならない。3 つの語はそれぞれ別の解決経路
    // (セッションの有無 / 対象の行の欄 / 実行者自身の行の欄)であり、2 つ書かれた
    // ロールは実行器がどちらで立てるかを選ぶことになる。例外は `kind: authenticated_default`
    // との併記だけ(実行者の行が根拠という点で同じ経路である)。
    for (const other of claimConflicts(kind, binding)) {
      if (claim === undefined) break;
      reporter.error(
        `roles[${index}].claim`,
        `${id} は claim と ${other} を両方持っています`,
        other === 'kind'
          ? 'claim と併記できる kind は authenticated_default だけである(未ログイン / システムは実行者の行を根拠にしない)'
          : `claim は「実行者自身の行の欄」だけが根拠のロールに書く(${other} を持つロールには書かない)`,
        { role: id, other },
      );
    }
    roles.push({
      id,
      ...(label === undefined ? {} : { label }),
      ...(kind === undefined ? {} : { kind }),
      ...(binding === undefined ? {} : { binding }),
      ...(claim === undefined ? {} : { claim: claim.path }),
      ...(claim === undefined || claim.values === null ? {} : { claimValues: claim.values }),
      ...(implies === null ? {} : { implies }),
      location: reporter.location(elementPointer('roles', index, id)),
    });
  });
  return roles;
}
