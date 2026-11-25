/** deps の単体テストの偽の口と材料(ネットワークにも子プロセスにも出ない)。 */

import type { DepsFinding, DepsIo } from '../../../lib/deps/types.js';

/** 偽の audit の出力 1 件(via の advisory)。 */
export function auditJson(items: readonly { name: string; severity: string; ghsa: string; title?: string }[]): string {
  const vulnerabilities: Record<string, unknown> = {};
  for (const item of items) {
    vulnerabilities[item.name] = {
      name: item.name, severity: item.severity,
      via: [{ source: 1, name: item.name, title: item.title ?? 't', url: `https://github.com/advisories/${item.ghsa}`, severity: item.severity, range: '<9' }, 'transitive-dep'],
    };
  }
  const counts: Record<string, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const item of items) counts[item.severity] = (counts[item.severity] ?? 0) + 1;
  // npm audit --json の実の形(auditReportVersion 2・metadata.vulnerabilities の件数)にそろえる。
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { ...counts, total: items.length } } });
}

/** 固定の sha512(SRI)。 */
export const SRI = `sha512-${'A'.repeat(86)}==`;

/** 公式の登録簿の tarball の URL(`@s/b` → `/@s/b/-/b-1.0.0.tgz`。名前と版は resolved から導かれる — C4-5)。 */
export function registryUrl(name: string, version: string): string {
  return `https://registry.npmjs.org/${name}/-/${name.slice(name.lastIndexOf('/') + 1)}-${version}.tgz`;
}

/** lockfile v3 の本文(resolved の既定はキーの名前と版から作る)。 */
export function lockfile(pkgs: readonly { key: string; version: string; resolved?: string; link?: boolean; integrity?: string }[]): string {
  const packages: Record<string, unknown> = { '': { name: 'root', version: '1.0.0' } };
  for (const p of pkgs) packages[p.key] = { version: p.version, resolved: p.resolved ?? registryUrl(p.key.slice(p.key.lastIndexOf('node_modules/') + 'node_modules/'.length), p.version), integrity: p.integrity ?? SRI, ...(p.link === true ? { link: true } : {}) };
  return JSON.stringify({ lockfileVersion: 3, packages });
}

/** 指摘の最小の材料。 */
export function finding(over: Partial<DepsFinding> = {}): DepsFinding {
  return { lockfile: 'package-lock.json', kind: 'advisory', id: 'GHSA-aaaa', aliases: [], pkg: 'left-pad', severity: 'high', sources: ['audit'], title: '', level: 'red', ...over };
}

/** 偽の口の仕様。 */
export interface FakeSpec {
  readonly files?: Readonly<Record<string, string>>;
  readonly dirs?: readonly string[];
  readonly exec?: (cmd: string, args: readonly string[], cwd: string) => { code: number; stdout: string; stderr?: string };
  readonly fetch?: (url: string, init?: { method?: string; body?: unknown }) => unknown;
  readonly now?: string;
  /** `writeText` の書き込み先(渡せばテストが中身を見られる)。 */
  readonly written?: Record<string, string>;
}

/** 偽の口を作る。fetch を渡さなければ通信失敗になる。 */
export function fakeIo(spec: FakeSpec): DepsIo {
  const files = spec.files ?? {};
  const dirs = new Set(spec.dirs ?? []);
  for (const file of Object.keys(files)) {
    const parts = file.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  return {
    fetchJson: (url, init) => (spec.fetch === undefined ? Promise.reject(new Error('network down')) : Promise.resolve(spec.fetch(url, init))),
    exec: (cmd, args, cwd) => {
      if (spec.exec === undefined) return Promise.reject(new Error('no exec'));
      const out = spec.exec(cmd, args, cwd);
      return Promise.resolve({ code: out.code, stdout: out.stdout, stderr: out.stderr ?? '' });
    },
    readText: (rel) => files[rel] ?? null,
    isDirectory: (rel) => dirs.has(rel),
    list: (rel) => {
      const prefix = rel === '.' || rel === '' ? '' : `${rel}/`;
      const names = new Set<string>();
      for (const entry of [...Object.keys(files), ...dirs]) {
        if (!entry.startsWith(prefix) || entry === rel) continue;
        const first = entry.slice(prefix.length).split('/')[0];
        if (first !== undefined && first !== '') names.add(first);
      }
      return [...names].sort();
    },
    now: () => new Date(spec.now ?? '2026-10-22T00:00:00Z'),
    writeText: (rel, text) => {
      if (spec.written !== undefined) spec.written[rel] = text;
    },
  };
}
