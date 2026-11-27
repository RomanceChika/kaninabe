/**
 * Structural test of the rule for every script that scans or decides (review round 20): a step that fails must never read as
 * "nothing found" or as a smaller list, so these scripts have
 *   - no pipeline (a non-final stage of a pipe has a status nobody reads),
 *   - no `|| true` and no `|| :` (a failure turned into success),
 *   - no bare `grep` (every search goes through `grep_q`, which tells found / not found / failed apart).
 * Multi-stage work goes stage by stage through files, each status checked. A construct that cannot be written otherwise may carry
 * the marker `# GATE-EXCEPTION: <reason>` on its own line; the test reports every marked line, and the review lists them.
 *
 * The detector is a small scanner of one line at a time: it blanks single-quoted text, double-quoted text and comments, and keeps
 * the inside of `$( ... )` as code. A `|` that is not part of `||` is a pipeline unless it is a case alternation: a `|` at the base
 * level of the line with an unmatched `)` after it on the same line (the structural form `a | b) ...`).
 * Also flagged: an input redirect `<` on a command inside an `if` / `while` / `until` / `!` condition (a redirect that fails reads as the
 * command's own non-zero), `egrep`, `fgrep`, `\grep`, `command grep`, a path to grep, `eval`, `sh -c`, and a one-line group `{ a; b; }` or
 * `( a; b )` whose status or output is used (only the last command counts). NOT seen: anything that spans lines (a group opened on one
 * line and closed on another, a pipe after a `\` continuation is seen only on its own line), a function that is called in a
 * condition and relies on `set -e` inside (that is a review item, listed in known-gaps), a construct built at run time, and a
 * heredoc body (none is used in these files).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const FILES = [
  'scripts/push-gate.sh',
  'scripts/push-range.sh',
  'scripts/range-id.sh',
  'scripts/neutral-git.sh',
  'scripts/gitleaks-public.sh',
  'scripts/scan-public.sh',
  'scripts/scan-rules.sh',
  'scripts/scan-pr-text.sh',
  'scripts/repo-context.sh',
  '.githooks/pre-push',
];
const MARKER = '# GATE-EXCEPTION:';

/** The code of one line: quotes and comments blanked, `$(...)` kept. Also returns the pipe findings. */
export function inspect(line) {
  if (line.includes(MARKER)) return { marked: true, problems: [] };
  const stack = [{ kind: 'code', depth: 0 }];
  let code = '';
  const pipes = [];
  let escaped = false;
  const n = line.length;
  for (let i = 0; i < n; i++) {
    const c = line[i];
    const top = stack[stack.length - 1];
    if (top.kind === 'dq') {
      if (c === '\\') { i++; code += '  '; continue; }
      if (c === '"') { stack.pop(); code += ' '; continue; }
      if (c === '$' && line[i + 1] === '(') { stack.push({ kind: 'code', depth: 0, sub: true }); code += '$('; i++; continue; }
      code += ' ';
      continue;
    }
    if (c === '\\') {
      if (/^(e|f)?grep(\s|$)/.test(line.slice(i + 1))) escaped = true;
      i++; code += '  '; continue;
    }
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) { code += ' '.repeat(n - i); break; }
      code += ' '.repeat(j - i + 1); i = j; continue;
    }
    if (c === '"') { stack.push({ kind: 'dq' }); code += ' '; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1])) && stack.length === 1) { break; }
    if (c === '$' && line[i + 1] === '(') { stack.push({ kind: 'code', depth: 0, sub: true }); code += '$('; i++; continue; }
    if (c === '(') { top.depth++; code += c; continue; }
    if (c === ')') {
      if (top.depth > 0) top.depth--;
      else if (top.sub) stack.pop();
      code += c;
      continue;
    }
    if (c === '|') {
      if (line[i + 1] === '|') { code += '||'; i++; continue; }
      pipes.push({ at: code.length, base: stack.length === 1 && top.depth === 0 });
      code += c;
      continue;
    }
    code += c;
  }
  const problems = [];
  for (const p of pipes) {
    if (p.base && hasUnmatchedCloseAfter(code, p.at)) continue; // case alternation: `a | b) ...`
    problems.push('pipeline');
    break;
  }
  if (/\|\|\s*(true|:)(\s|;|\}|\)|$)/.test(code)) problems.push('|| true / || :');
  if (/(^|[\s;&|({!`])grep(\s|$)/.test(code) && !/(^|[\s;&|({!])(git|neutral_git|ng_real\s+git)\s+grep(\s|$)/.test(code)) problems.push('bare grep');
  if (escaped) problems.push('escaped grep');
  if (/(^|[\s;&|({!`])(egrep|fgrep)(\s|$)/.test(code) || /(^|[\s;&|({!`])(command|exec|env)\s+(e|f)?grep(\s|$)|\/(e|f)?grep(\s|$)/.test(code)) problems.push('grep by another name');
  if (/(^|[\s;&|({!`])eval(\s|$)/.test(code)) problems.push('eval');
  if (/(^|[\s;&|({!`])(sh|bash|dash|ksh|zsh)\s+(-[a-zA-Z]*c)(\s|$)/.test(code)) problems.push('sh -c');
  for (const g of groupsWithSemicolons(code)) problems.push(g);
  if (/(\b(if|elif|while|until)|(^|[\s;])!)\s+[^;]*\s<\s*[^\s<(]/.test(code)) problems.push('input redirect on a command in a condition');
  return { marked: false, problems };
}

/**
 * A one-line group `{ a; b; }` or `( a; b )` whose combined status or output is used: followed by a redirect, `&&`, `||` or `)`
 * (the end of a `$( )`), or preceded by `if`, `while`, `until`, `!` or `$(`. Only the last command's status is the group's, so each
 * command must count (`a && b`). A group after `||` is an error handler and its status is not used. Function bodies are skipped.
 */
function groupsWithSemicolons(code) {
  const out = [];
  for (let i = 0; i < code.length; i++) {
    const open = code[i];
    let close;
    if (open === '{') {
      if (!(i === 0 || /[\s(;&|!]/.test(code[i - 1])) || !/\s/.test(code[i + 1] || '')) continue;
      if (/\)\s*$/.test(code.slice(0, i))) continue; // name() { ... }
      close = '}';
    } else if (open === '(') {
      if (code[i - 1] === '$' || code[i - 1] === '(' || code[i + 1] === '(' || code[i + 1] === ')') continue;
      if (!(i === 0 || /[\s;&|!]/.test(code[i - 1]))) continue;
      close = ')';
    } else continue;
    let depth = 0;
    let j = i + 1;
    for (; j < code.length; j++) {
      if (code[j] === open && (open === '(' || /\s/.test(code[j - 1] || ' '))) depth++;
      else if (code[j] === close) { if (depth === 0) break; depth--; }
    }
    if (j >= code.length) continue; // closes on another line: not seen
    const content = code.slice(i + 1, j).replace(/;;/g, '').replace(/[;\s]+$/, '');
    if (!content.includes(';')) continue;
    const before = code.slice(0, i);
    const after = code.slice(j + 1);
    if (/\|\|\s*$/.test(before) && !/\b(if|elif|while|until)\s/.test(before)) continue; // an error handler (not when it is part of a condition)
    if (/^\s*(\d*[<>]|&&|\|\||\))/.test(after) || /(\b(if|while|until)|!|\$\()\s*$/.test(before) || /\b(if|elif|while|until)\s[^;]*$/.test(before)) out.push('group with ; whose status or output is used');
  }
  return out;
}

function hasUnmatchedCloseAfter(code, from) {
  let depth = 0;
  for (let i = from + 1; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { if (depth === 0) return true; depth--; }
  }
  return false;
}

describe('no pipelines, no `|| true`, no bare grep in the scripts that decide (review round 20)', () => {
  it('the detector finds what it must and passes what it must', () => {
    const bad = [
      'a | b', 'x=$(a | b)', 'x=$(a) | b', '"$(a | b)"', 'foo || true', 'foo || : ', 'if grep -q x f; then', '! grep -q x f',
      'grep x f && y', 'x=$(grep x f)',
      '{ printf x; cat f; } > out || return 1', '( a; b ) || c', 'x=$({ a; b; })', 'if { a; b; }; then', 'if x || (a; b); then', 'if f < "$x"; then', 'while f < x; do', '! f < x', 'egrep x f', 'fgrep x f', '\\grep x f', 'command grep x f', '/bin/grep x f', 'eval "$x"', 'sh -c "x"', 'sort -u f | while read x; do', '( cd d && a | b )',
    ];
    for (const l of bad) assert.ok(inspect(l).problems.length > 0, `should be flagged: ${l}`);
    const good = [
      '# a | b || true grep', "awk '$1 == 1 || $2 { a | b }' f", 'echo "a | b || true grep"', 'case $x in 0 | 1) return 1 ;; esac',
      'a || b', 'grep_q -q x f', 'scan_grep -q x f', 'neutral_git grep -q x', 'x=$(git grep -q y)', 'x=$((a + b))',
      'echo ok # a | b', 'grep_q() { true; } # GATE-EXCEPTION: the one helper', 'tr "|" "\\n"', 'foo || [ $? = 1 ]',
      '{ a && b; } > out || return 1', 'a || { echo x; exit 2; }', 'f() { a; b; }', 'x=$(cd d && a)', '( cd d && a ) > out || rc=$?', 'echo "eval and sh -c"', 'while read x; do :; done < f', 'if f "$x"; then g < y; fi', 'x=$(a < f) || b',
    ];
    for (const l of good) assert.deepEqual(inspect(l).problems, [], `should pass: ${l}`);
  });

  it('no listed file has an offending line', () => {
    const offences = [];
    const marked = [];
    for (const f of FILES) {
      const text = readFileSync(fileURLToPath(new URL(f, root)), 'utf8');
      text.split('\n').forEach((line, k) => {
        const r = inspect(line);
        if (r.marked) marked.push(`${f}:${k + 1}`);
        if (r.problems.length) offences.push(`${f}:${k + 1} ${r.problems.join(', ')}`);
      });
    }
    // The marked lines are an explicit, reviewed list: only the helper grep_q itself (the one place a bare grep runs).
    assert.equal(marked.length, 1, `marked exceptions: ${marked.join(' ')}`);
    assert.ok(marked[0].startsWith('scripts/neutral-git.sh:'), marked[0]);
    assert.match(readFileSync(fileURLToPath(new URL('scripts/neutral-git.sh', root)), 'utf8').split('\n')[Number(marked[0].split(':')[1]) - 1], /^grep_q\(\)/);
    assert.equal(offences.length, 0, `${offences.length} offending line(s):\n${offences.join('\n')}`);
  });
});
