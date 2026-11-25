/**
 * specs/domain のディレクトリを走査して SpecModel を構築するローダー。
 *
 * ファイル I/O を行うのはこのモジュール(と CLI)だけであり、
 * YAML → Spec の変換は parse-* の純粋関数に委ねる(規約: scripts-code-quality.md)。
 * 構築時に検出できるのは V1(スキーマ適合)だけで、V2 以降は検証器が SpecModel に対して行う。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Finding } from '../kernel/finding.js';
import type { AggregateSpecs, SpecModel } from './types.js';
import { SpecReporter, type ParseResult } from './parse-common.js';
import { parseSafeFrontmatter } from './safe-frontmatter.js';
import { parseRoleSpec } from './parse-role.js';
import { parseEntitySpec } from './parse-entity.js';
import { parseStateSpecs } from './parse-state.js';
import { parseAccessSpec } from './parse-access.js';
import { parseInvariantSpec } from './parse-invariant.js';
import { detectRepoRoot } from '../io/paths.js';

/** 集約ディレクトリに置ける固定ファイル名(ARCH-SP-0002)。 */
const AGGREGATE_FILES = ['entity.md', 'states.md', 'access.md', 'invariants.md'] as const;

/** ローダーの任意設定。 */
export interface LoadOptions {
  /**
   * Finding の location.file をこのディレクトリからの相対パスにする。
   * 省略時は rootDir から上に製品の根の宣言(product.md)を探し、見つからなければ rootDir の親を使う。
   */
  readonly repoRoot?: string;
}

/** loadSpecModel の結果。 */
export interface LoadResult {
  /** 構築できたモデル。継続不能な構造破壊(ディレクトリや roles.md が読めない)のときだけ null。 */
  readonly model: SpecModel | null;
  /** 構築中に検出した V1 違反。model が非 null でも空とは限らない。 */
  readonly findings: Finding[];
}

/**
 * specs/domain 配下を走査してドメイン仕様のモデルを構築する。
 *
 * roles.md はドメイン直下に 1 つ、集約ごとのディレクトリに entity.md / states.md /
 * access.md / invariants.md を置く構成(ARCH-SP-0002)を前提とする。
 * template.{doc_type}.md と README.md は読み飛ばす。
 *
 * @param rootDir specs/domain の絶対パス
 * @param options 相対パス基準などの任意設定
 * @returns モデルと V1 違反のリスト
 */
export function loadSpecModel(rootDir: string, options: LoadOptions = {}): LoadResult {
  const repoRoot = options.repoRoot ?? detectRepoRoot(rootDir);
  const io = new SpecFiles(repoRoot);
  const findings: Finding[] = [];

  if (!isDirectory(rootDir)) {
    return {
      model: null,
      findings: [
        fileFinding(
          io.rel(rootDir),
          'ドメイン仕様のディレクトリが見つかりません',
          'specs/domain のパスを確認する。存在しない場合は ARCH-SP-0002 の構成でディレクトリを作る',
        ),
      ],
    };
  }

  const rolesPath = join(rootDir, 'roles.md');
  if (!isFile(rolesPath)) {
    return {
      model: null,
      findings: [
        fileFinding(
          io.rel(rolesPath),
          'roles.md がありません',
          'template.role_spec.md をコピーして specs/domain/roles.md を作る(ロール定義はドメイン全体で 1 つ)',
        ),
      ],
    };
  }

  const roles = io.parse(rolesPath, findings, parseRoleSpec);
  if (roles === null) return { model: null, findings };

  const aggregates = new Map<string, AggregateSpecs>();
  for (const entry of listEntries(rootDir)) {
    const entryPath = join(rootDir, entry);
    if (isDirectory(entryPath)) {
      aggregates.set(entry, loadAggregate(entryPath, entry, io, findings));
      continue;
    }
    reportUnexpectedRootFile(entry, io.rel(entryPath), findings);
  }

  checkEntityLabelUniqueness(aggregates, findings);
  return { model: { roles, aggregates }, findings };
}

/**
 * 集約そのものの表示名(entity_spec のトップレベル `label`)がドメイン全体で一意かを見る。
 *
 * この label はハンドブックの章題(`集約 workshop(催し)`)と集約関係図の節点になるため、
 * 2 つの集約が同じ表示名を宣言すると読み手が別物を同じものとして読む。1 ファイルの中だけを
 * 見ていては分からない食い違いなので、全ファイルを読み終えたここで見る
 * (`fields[].label` の一意性は 1 ファイルで閉じるのでパーサーが見ている)。
 *
 * @param aggregates 読み込み済みの集約
 * @param findings 違反の記録先(重複 1 件につき V1 を 1 つ積む)
 */
export function checkEntityLabelUniqueness(
  aggregates: ReadonlyMap<string, AggregateSpecs>,
  findings: Finding[],
): void {
  const seen = new Map<string, string>();
  for (const specs of aggregates.values()) {
    const entity = specs.entity;
    if (entity === undefined || entity.label === undefined) continue;
    const first = seen.get(entity.label);
    if (first === undefined) {
      seen.set(entity.label, entity.entity);
      continue;
    }
    findings.push({
      verifier: 'V1',
      severity: 'error',
      message: `label "${entity.label}" が ${first} と ${entity.entity} で重複しています`,
      location: { file: entity.location.file, pointer: 'label' },
      suggestion:
        '集約の表示名はドメイン全体で一意にする(同じ表示名だと章題も関係図の節点も区別が付かない)',
      counterexample: { label: entity.label, entities: `${first}, ${entity.entity}` },
    });
  }
}

/**
 * 1 つの集約ディレクトリを読む。
 * 固定 4 ファイル以外は読み飛ばして warning を積む(ARCH-SP-0002: 4 種以外を置かない)。
 */
function loadAggregate(
  dir: string,
  name: string,
  io: SpecFiles,
  findings: Finding[],
): AggregateSpecs {
  const present = new Set<string>();
  let entity: AggregateSpecs['entity'];
  let access: AggregateSpecs['access'];
  let invariants: AggregateSpecs['invariants'];
  let stateMachines: AggregateSpecs['stateMachines'] = [];

  for (const entry of listEntries(dir)) {
    const entryPath = join(dir, entry);
    if (entry === 'README.md') continue;
    if (!isFile(entryPath) || !isAggregateFile(entry)) {
      findings.push(
        fileFinding(
          io.rel(entryPath),
          `集約ディレクトリ ${name}/ に想定外の${isFile(entryPath) ? 'ファイル' : 'ディレクトリ'}があります`,
          `集約ディレクトリに置けるのは ${AGGREGATE_FILES.join(' / ')} だけ。別の場所に移すか、doc_type を追加して ARCH-SP-0002 を更新する`,
          'warning',
        ),
      );
      continue;
    }
    present.add(entry);
    if (entry === 'entity.md') entity = io.parse(entryPath, findings, parseEntitySpec) ?? undefined;
    if (entry === 'access.md') access = io.parse(entryPath, findings, parseAccessSpec) ?? undefined;
    if (entry === 'invariants.md') {
      invariants = io.parse(entryPath, findings, parseInvariantSpec) ?? undefined;
    }
    if (entry === 'states.md') stateMachines = io.parse(entryPath, findings, parseStateSpecs) ?? [];
  }

  for (const required of ['entity.md', 'access.md'] as const) {
    if (present.has(required)) continue;
    findings.push(
      fileFinding(
        io.rel(join(dir, required)),
        `集約 ${name} に ${required} がありません`,
        `template.${required === 'entity.md' ? 'entity_spec' : 'access_spec'}.md をコピーして ${name}/${required} を作る`,
        'warning',
      ),
    );
  }

  return {
    name,
    stateMachines,
    ...(entity === undefined ? {} : { entity }),
    ...(access === undefined ? {} : { access }),
    ...(invariants === undefined ? {} : { invariants }),
  };
}

/** ファイルの読み込みとパーサー呼び出しをまとめた I/O 境界。 */
class SpecFiles {
  constructor(private readonly repoRoot: string) {}

  /** リポジトリルートからの相対パス(区切りは常に "/")。 */
  rel(absolutePath: string): string {
    return relative(this.repoRoot, absolutePath).split(sep).join('/');
  }

  /**
   * ファイルを読み、フロントマターを取り出してパーサーに渡す。
   * 読み込み失敗・フロントマター不正は Finding を積んで null を返す。
   */
  parse<T>(
    absolutePath: string,
    findings: Finding[],
    parser: (data: unknown, file: string) => ParseResult<T>,
  ): T | null {
    const file = this.rel(absolutePath);
    const reporter = new SpecReporter(file);
    let source: string;
    try {
      source = readFileSync(absolutePath, 'utf8');
    } catch (cause) {
      reporter.error(
        undefined,
        `ファイルを読み込めません: ${cause instanceof Error ? cause.message : String(cause)}`,
        'ファイルの権限とパスを確認する',
      );
      findings.push(...reporter.findings());
      return null;
    }
    const data = parseSafeFrontmatter(source, reporter);
    findings.push(...reporter.findings());
    if (data === null) return null;
    const result = parser(data, file);
    findings.push(...result.findings);
    return result.value;
  }
}

function reportUnexpectedRootFile(entry: string, file: string, findings: Finding[]): void {
  // 人間レビューの生成物はハンドブック docs/book/(全生成)にあり、specs/domain 直下には置かない
  if (entry === 'roles.md' || entry === 'README.md' || /^template\..+\.md$/.test(entry)) {
    return;
  }
  findings.push(
    fileFinding(
      file,
      'specs/domain 直下に想定外のファイルがあります',
      '直下に置けるのは roles.md / README.md / template.{doc_type}.md だけ。仕様なら集約ディレクトリに移す',
      'warning',
    ),
  );
}

function isAggregateFile(entry: string): boolean {
  return AGGREGATE_FILES.some((name) => name === entry);
}

function fileFinding(
  file: string,
  message: string,
  suggestion: string,
  severity: Finding['severity'] = 'error',
): Finding {
  return { verifier: 'V1', severity, message, location: { file }, suggestion };
}

/** ディレクトリ内の項目を名前順で返す。読めない場合は空配列。 */
function listEntries(dir: string): readonly string[] {
  try {
    return readdirSync(dir).filter((entry) => !entry.startsWith('.')).sort();
  } catch {
    return [];
  }
}

function isDirectory(target: string): boolean {
  return statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function isFile(target: string): boolean {
  return statSync(target, { throwIfNoEntry: false })?.isFile() ?? false;
}

