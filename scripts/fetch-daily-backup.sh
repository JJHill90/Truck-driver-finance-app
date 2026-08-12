#!/usr/bin/env bash
# Login as primary mod, create a full-store backup, download it locally.
# Used by .github/workflows/daily-backup.yml (and can be run by hand).
#
# Required env:
#   HAULAGE_BASE_URL          e.g. https://haulage-finance.onrender.com
#   HAULAGE_ADMIN_USERNAME    primary mod username
#   HAULAGE_ADMIN_PASSWORD    primary mod password
#
# Optional:
#   OUT_DIR                   default ./backups
#   SKIP_CREATE=1             download latest only (do not POST /admin/backups)

set -euo pipefail

BASE_URL="${HAULAGE_BASE_URL:-}"
USERNAME="${HAULAGE_ADMIN_USERNAME:-}"
PASSWORD="${HAULAGE_ADMIN_PASSWORD:-}"
OUT_DIR="${OUT_DIR:-./backups}"
SKIP_CREATE="${SKIP_CREATE:-0}"

if [[ -z "$BASE_URL" || -z "$USERNAME" || -z "$PASSWORD" ]]; then
  echo "Missing HAULAGE_BASE_URL / HAULAGE_ADMIN_USERNAME / HAULAGE_ADMIN_PASSWORD" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"
API="${BASE_URL}/api/haulage"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
mkdir -p "$OUT_DIR"

curl_json() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local attempt=1
  local max=6
  local body
  local code
  while (( attempt <= max )); do
    if [[ -n "$data" ]]; then
      body="$(curl -sS -c "$JAR" -b "$JAR" -X "$method" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        --data "$data" \
        -w "\n%{http_code}" \
        "${API}${path}" || true)"
    else
      body="$(curl -sS -c "$JAR" -b "$JAR" -X "$method" \
        -H "Accept: application/json" \
        -w "\n%{http_code}" \
        "${API}${path}" || true)"
    fi
    code="$(printf '%s' "$body" | tail -n1)"
    body="$(printf '%s' "$body" | sed '$d')"
    if [[ "$code" =~ ^2 ]]; then
      printf '%s' "$body"
      return 0
    fi
    # Render cold start / transient errors — wait and retry.
    if [[ "$code" == "000" || "$code" == "502" || "$code" == "503" || "$code" == "504" ]]; then
      echo "Retry ${attempt}/${max} after HTTP ${code}…" >&2
      sleep $(( attempt * 8 ))
      attempt=$(( attempt + 1 ))
      continue
    fi
    echo "Request failed HTTP ${code}: ${body}" >&2
    return 1
  done
  echo "Gave up after ${max} attempts" >&2
  return 1
}

echo "Signing in to ${BASE_URL} as ${USERNAME}…"
LOGIN_JSON="$(curl_json POST /auth/login "$(jq -nc --arg u "$USERNAME" --arg p "$PASSWORD" '{username:$u,password:$p}')")"
IS_ADMIN="$(printf '%s' "$LOGIN_JSON" | jq -r '.user.isAdmin // false')"
if [[ "$IS_ADMIN" != "true" ]]; then
  echo "Signed-in user is not primary mod (isAdmin=${IS_ADMIN})" >&2
  exit 1
fi

BACKUP_ID=""
if [[ "$SKIP_CREATE" == "1" ]]; then
  echo "Listing latest backup…"
  LIST_JSON="$(curl_json GET /admin/backups)"
  BACKUP_ID="$(printf '%s' "$LIST_JSON" | jq -r '.backups[0].id // empty')"
else
  echo "Creating backup…"
  CREATE_JSON="$(curl_json POST /admin/backups '{}')"
  BACKUP_ID="$(printf '%s' "$CREATE_JSON" | jq -r '.backup.id // empty')"
  BYTES="$(printf '%s' "$CREATE_JSON" | jq -r '.backup.bytes // 0')"
  echo "Created ${BACKUP_ID} (${BYTES} bytes)"
fi

if [[ -z "$BACKUP_ID" ]]; then
  echo "No backup id available" >&2
  exit 1
fi

OUT_FILE="${OUT_DIR}/${BACKUP_ID}.tar.gz"
echo "Downloading ${BACKUP_ID} → ${OUT_FILE}"
attempt=1
while (( attempt <= 6 )); do
  code="$(curl -sS -c "$JAR" -b "$JAR" -L \
    -o "$OUT_FILE" \
    -w "%{http_code}" \
    "${API}/admin/backups/${BACKUP_ID}/download" || true)"
  if [[ "$code" =~ ^2 ]] && [[ -s "$OUT_FILE" ]]; then
    break
  fi
  echo "Download retry ${attempt}/6 (HTTP ${code})…" >&2
  sleep $(( attempt * 8 ))
  attempt=$(( attempt + 1 ))
done

if [[ ! -s "$OUT_FILE" ]]; then
  echo "Download failed or empty file" >&2
  exit 1
fi

SHA="$(sha256sum "$OUT_FILE" | awk '{print $1}')"
SIZE="$(wc -c < "$OUT_FILE" | tr -d ' ')"
echo "Saved ${OUT_FILE} (${SIZE} bytes, sha256=${SHA})"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "BACKUP_ID=${BACKUP_ID}"
    echo "BACKUP_FILE=${OUT_FILE}"
  } >> "$GITHUB_OUTPUT"
fi
