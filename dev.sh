#!/usr/bin/env bash
# dev.sh — load the extension into a Firefox test instance using your real profile.
#
# Usage:
#   ./dev.sh                        # auto-detects default Firefox profile
#   ./dev.sh --firefox-profile PATH # override profile
#   ./dev.sh --keep-profile-changes # save session changes back to the profile
#
# web-ext copies the profile at start-up; without --keep-profile-changes the real
# profile is never modified.  The extension is live-reloaded whenever src/ changes.
#
# Requires web-ext (already a devDependency):  npx web-ext run --help
set -euo pipefail

# ── Detect default Firefox profile ────────────────────────────────────────────

if [[ "$OSTYPE" == "darwin"* ]]; then
  PROFILES_INI="$HOME/Library/Application Support/Firefox/profiles.ini"
  PROFILES_ROOT="$HOME/Library/Application Support/Firefox"
else
  PROFILES_INI="$HOME/.mozilla/firefox/profiles.ini"
  PROFILES_ROOT="$HOME/.mozilla/firefox"
fi

detect_default_profile() {
  [[ -f "$PROFILES_INI" ]] || return 0
  # Parse INI: find the section with Default=1 and return its Path= value.
  awk -F= '
    /^\[/ { path=""; is_default=0; is_relative=1 }
    /^Path=/       { path=$2 }
    /^IsRelative=/ { is_relative=$2 }
    /^Default=1/   { is_default=1 }
    /^$/ || ENDFILE {
      if (is_default && path != "") {
        if (is_relative) print ENVIRON["PROFILES_ROOT"] "/" path
        else             print path
        exit
      }
    }
  ' ENDFILE=1 "$PROFILES_INI"
}

# ── Build argument list ───────────────────────────────────────────────────────

ARGS=(--source-dir src)

# Only inject --firefox-profile if the caller didn't already supply one.
if [[ ! " $* " =~ " --firefox-profile " ]]; then
  PROFILE="$(detect_default_profile)"
  if [[ -n "$PROFILE" && -d "$PROFILE" ]]; then
    echo "Using Firefox profile: $PROFILE"
    ARGS+=(--firefox-profile "$PROFILE")
  else
    echo "No default Firefox profile found — launching with a fresh profile."
  fi
fi

# ── Test windows ─────────────────────────────────────────────────────────────
# Each entry opens in its own window. Add, remove, or change URLs freely.
WINDOWS=(
  # window 1
  'https://github.com/torvalds/linux'

  # window 2
  'https://github.com/mozilla/gecko-dev'
)

# Build a data: startup page: open windows 2..N via window.open(), then navigate
# the current window to window 1.  dom.disable_open_during_load=false lets
# window.open() work without a user gesture (bypasses the popup blocker).
SCRIPT='<script>'
for url in "${WINDOWS[@]:1}"; do
  SCRIPT+="window.open('$url','_blank','width=1200,height=800,noreferrer');"
done
SCRIPT+="window.location.href='${WINDOWS[0]}';</script>"
ARGS+=(
  --pref 'dom.disable_open_during_load=false'
  --pref 'browser.link.open_newwindow.restriction=0'
  --pref 'browser.startup.homepage_override.mstone=ignore'
  --pref 'startup.homepage_welcome_url=about:blank'
  --pref 'startup.homepage_welcome_url.additional=about:blank'
  --start-url "data:text/html,$SCRIPT"
)

# ── Launch ────────────────────────────────────────────────────────────────────

exec npx web-ext run "${ARGS[@]}" "$@"
