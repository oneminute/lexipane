#!/usr/bin/env bash
# LexiPane desktop launcher for Omarchy (Arch Linux / Hyprland).
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

usage() {
  cat <<'HELP'
LexiPane Omarchy launcher

Usage: ./start-lexipane-omarchy.sh [--check | --install | --dev | --build] [--help]
  (no args), --dev   Launch Tauri in development mode
  --check            Report missing tools and Arch packages; change nothing
  --install          Install missing Arch dependencies, initialize Rust and launch
  --build            Build the Linux desktop application (no dependency installation)

Omarchy uses Arch Linux and Hyprland. This launcher does not change
Hyprland configuration and leaves user data, API keys, and databases alone.
HELP
}

mode=dev
for arg in "$@"; do
  case "$arg" in
    --dev) mode=dev ;;
    --check) mode=check ;;
    --install) mode=install ;;
    --build) mode=build ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v pacman >/dev/null 2>&1; then
  echo "This launcher requires Omarchy / Arch Linux (pacman)." >&2
  exit 1
fi

# Tauri 2 WebKitGTK dependencies plus native OpenSSL/libssh2 build support.
arch_packages=(
  base-devel curl wget file pkgconf
  nodejs npm rustup
  gtk3 webkit2gtk-4.1 libsoup3
  libayatana-appindicator librsvg patchelf
  openssl libssh2
)
missing=()
for pkg in "${arch_packages[@]}"; do
  if ! pacman -Qq "$pkg" >/dev/null 2>&1; then
    missing+=("$pkg")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing Arch packages: %s\n' "${missing[*]}"
  if [[ "$mode" == install ]]; then
    sudo pacman -S --needed -- "${missing[@]}"
  elif [[ "$mode" != check ]]; then
    echo "Run './start-lexipane-omarchy.sh --install' to install dependencies." >&2
    exit 1
  fi
fi

for cmd in node npm cargo rustc; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '%-6s %s\n' "$cmd" "$("$cmd" --version)"
  elif [[ "$mode" != install ]]; then
    printf 'Missing command: %s\n' "$cmd" >&2
    if [[ "$mode" != check ]]; then exit 1; fi
  fi
done

if [[ "$mode" == check ]]; then
  if (( ${#missing[@]} )); then exit 1; fi
  for cmd in node npm cargo rustc; do
    command -v "$cmd" >/dev/null 2>&1 || exit 1
  done
  echo "System dependencies found."
  exit 0
fi

# Arch rustup package installs the manager but may not select a toolchain.
if ! command -v cargo >/dev/null 2>&1 || ! cargo --version >/dev/null 2>&1; then
  if [[ "$mode" == install ]]; then
    rustup default stable
  else
    echo "No Rust toolchain selected. Run 'rustup default stable'." >&2
    exit 1
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
fi

# Tauri/GTK expects a running graphical session. Do not force X11 under Hyprland.
if [[ "$mode" == dev && -z "${WAYLAND_DISPLAY:-}" && -z "${DISPLAY:-}" ]]; then
  echo "No Wayland or X11 display detected. Launch from a graphical Omarchy session." >&2
  exit 1
fi

if [[ "$mode" == build ]]; then
  exec npm run tauri -- build
fi
exec npm run tauri -- dev
