#!/usr/bin/env bash
# Ubuntu 22.04 read-only inspection. Does not install, stop or alter services.
set -u
printf '\n== Operating system ==\n'
if [ -r /etc/os-release ]; then
  sed -n '/^PRETTY_NAME=/p; /^VERSION_ID=/p' /etc/os-release
fi
printf '\n== CPU and memory ==\n'
nproc
free -h
printf '\n== Root disk space ==\n'
df -h /
printf '\n== Listening HTTP, HTTPS and SSH ports ==\n'
ss -ltn '( sport = :22 or sport = :80 or sport = :443 )'
printf '\n== Available runtimes ==\n'
for binary in node npm python3 nginx docker; do
  if command -v "$binary" >/dev/null 2>&1; then
    case "$binary" in
      nginx) nginx -v 2>&1 ;;
      *) "$binary" --version 2>&1 | head -n 1 ;;
    esac
  else
    printf '%s: not found\n' "$binary"
  fi
done
printf '\n== Existing web services ==\n'
for service in nginx apache2 docker; do
  printf '%s: ' "$service"
  systemctl is-active "$service" 2>/dev/null || true
done
printf '\n== Control panels (presence only) ==\n'
for panel in /www/server/panel /opt/1panel; do
  if [ -d "$panel" ]; then printf 'present: %s\n' "$panel"; fi
done
printf '\n== Nginx enabled site filenames (no configuration contents) ==\n'
if [ -d /etc/nginx/sites-enabled ]; then
  find /etc/nginx/sites-enabled -maxdepth 1 -mindepth 1 -printf '%f\n' 2>/dev/null
fi
printf '\n== Proposed application directory ==\n'
if [ -e /srv/xiaoxi ]; then
  printf '/srv/xiaoxi already exists; inspect before deploying.\n'
else
  printf '/srv/xiaoxi does not exist.\n'
fi
printf '\nInspection complete. No changes were made.\n'
