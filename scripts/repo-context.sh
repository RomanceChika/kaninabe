# Sourced by push-range.sh, push-gate.sh and scan-public.sh (not run). Which repository is meant is decided ONCE, in the
# CALLER's environment (the one git push, the hook or the user's shell has: GIT_DIR, GIT_WORK_TREE, `git --git-dir=A
# --work-tree=B`, the current directory), and then handed explicitly into the clean environment that the scripts run
# their tools in. Without that, a clean environment (no GIT_DIR) would scan whatever repository encloses the work tree,
# not the one being pushed.
#
# repo_resolve        sets $repo_gitdir (absolute); on failure sets $repo_error and returns 1
# repo_resolve_top    the same, and also $repo_top (the work tree); a repository without a work tree (a bare one) is
#                     not supported: the scripts stop with a reason, which is the simplest safe behaviour
# The object directory is not handed on: GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES in the caller's
# environment stop the scripts too, since the clean environment could not see the objects they point to.
repo_gitdir=
repo_top=
repo_error=
repo_resolve() {
  if [ -n "${GIT_OBJECT_DIRECTORY:-}" ] || [ -n "${GIT_ALTERNATE_OBJECT_DIRECTORIES:-}" ]; then
    repo_error="GIT_OBJECT_DIRECTORY and GIT_ALTERNATE_OBJECT_DIRECTORIES are not supported (the clean environment of the scans cannot be given them)"
    return 1
  fi
  repo_gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null) || { repo_error="not inside a git repository"; return 1; }
  [ -n "$repo_gitdir" ] || { repo_error="not inside a git repository"; return 1; }
}
repo_resolve_top() {
  repo_resolve || return 1
  repo_top=$(git rev-parse --show-toplevel 2>/dev/null) || repo_top=
  [ -n "$repo_top" ] || { repo_error="this repository has no work tree (a bare repository is not supported)"; return 1; }
}
