# Sourced by push-gate.sh and scan-public.sh (not run). The scans must see what is committed, whatever the tree or the
# clone says about it: a .gitattributes line (`binary`, `-diff`, `export-ignore`) in the tree, $GIT_DIR/info/attributes,
# core.attributesFile and the grep.* / core.* settings of the user must not change what `git grep` or an export sees.
# So these commands run in a throwaway bare repository of their own (no config, no info/attributes) that borrows the
# objects of the real one, with the attributes read from the empty tree (`--attr-source`, git 2.40 or newer), and
# without the user's and the system's git configuration. A git too old for --attr-source is not worked around: the
# scans stop, because scanning less is worse than not scanning.
#
# (the real repository is $ng_repo, set by the caller)
# neutral_git_setup <dir>   prepares <dir>/neutral.git; on failure prints the reason in $ng_error and returns 1
# neutral_git <args...>     runs git (read-only use: grep, ls-tree) against the commits of the real repository
# neutral_export <sha> <dir> writes the files of the commit into <dir> exactly as committed (no export-ignore, no
#                           export-subst, no end-of-line or filter conversion)
ng_error=
# ng_env <command...>: the command with an environment of explicit inputs only (no GIT_*, GREP_*, GITLEAKS_* or anything else
# the caller had, no user or system git configuration, no attributes from outside the repository).
ng_env() {
  env -i PATH="$PATH" HOME=/nonexistent XDG_CONFIG_HOME=/nonexistent LC_ALL=C.UTF-8 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1 "$@"
}
# ng_real <command...>: the same, inside the real repository named by $ng_repo (its git directory, found by the caller
# once, in the caller's environment: see repo-context.sh). Without it the repository is looked for from the current directory.
ng_repo=${ng_repo:-}
ng_real() {
  if [ -n "${ng_repo:-}" ]; then ng_env GIT_DIR="$ng_repo" "$@"; else ng_env "$@"; fi
}
neutral_git_setup() {
  ng_empty=$(ng_env git hash-object -t tree /dev/null 2>/dev/null) || { ng_error="could not compute the empty tree"; return 1; }
  if ! ng_real git --attr-source="$ng_empty" rev-parse --git-dir >/dev/null 2>&1; then
    ng_error="this git does not support --attr-source (git 2.40 or newer is needed): not scanning with a weaker scan"
    return 1
  fi
  ng_objects=$(ng_real git rev-parse --path-format=absolute --git-path objects 2>/dev/null) || { ng_error="could not find the objects of the repository"; return 1; }
  ng_dir=$1/neutral.git
  ng_env git init -q --bare "$ng_dir" >/dev/null 2>&1 || { ng_error="could not prepare a neutral git directory"; return 1; }
  printf '%s\n' "$ng_objects" > "$ng_dir/objects/info/alternates" || { ng_error="could not prepare a neutral git directory"; return 1; }
  # A commit-graph (and a multi-pack-index) of the borrowed object directory is not content-addressed: git would read parent
  # links from it. Both are switched off in the neutral repository's own config (which gitleaks' git runs read as well).
  ng_env GIT_DIR="$ng_dir" git config core.commitGraph false && ng_env GIT_DIR="$ng_dir" git config core.multiPackIndex false \
    || { ng_error="could not prepare a neutral git directory"; return 1; }
}
neutral_git() {
  ng_env GIT_DIR="$ng_dir" git --attr-source="$ng_empty" "$@"
}
neutral_export() {
  mkdir -p "$2" || return 1
  ng_env GIT_DIR="$ng_dir" GIT_WORK_TREE="$2" GIT_INDEX_FILE="$ng_dir/export-index" git read-tree "$1" >/dev/null 2>&1 \
    && ng_env GIT_DIR="$ng_dir" GIT_WORK_TREE="$2" GIT_INDEX_FILE="$ng_dir/export-index" git --attr-source="$ng_empty" checkout-index -a -f >/dev/null 2>&1
}
