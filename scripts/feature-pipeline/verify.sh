#!/usr/bin/env bash
#
# Verify the GitHub feature pipeline matches spec.md success criteria.
# Exits 0 on success, non-zero with a diff on failure.

set -euo pipefail

REPO="opencauldron/opencauldron"
OWNER="opencauldron"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TSV="$SCRIPT_DIR/issues.tsv"
MANIFEST="$REPO_ROOT/.github/project-ids.json"

PASS=0
FAIL=0
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
fail() { printf '\033[1;31m  ✗\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }
section() { printf '\n\033[1;34m▌\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# Check 1 — Manifest schema
# ---------------------------------------------------------------------------

section "Check 1: manifest schema"

[[ -f "$MANIFEST" ]] || { fail "manifest missing at $MANIFEST"; exit 1; }

if jq -e '
  .owner == "opencauldron"
  and (.projectNumber | type == "number")
  and (.projectId | startswith("PVT_"))
  and (.statusFieldId | startswith("PVTSSF_"))
  and (.statusOptions | keys | sort) == ["Backlog","Done","In Progress","Ready to Build","Refined","Review"]
  and (.statusOptions | to_entries | all(.value | type == "string" and length > 0))
  and (.labels.priority == ["P0","P1","P2","P3"])
  and (.labels.personas | length == 7)
  and (.labels.workflow == ["ready-to-build","in-progress"])
' "$MANIFEST" >/dev/null; then
  ok "manifest schema valid"
else
  fail "manifest schema invalid"
  jq . "$MANIFEST" || true
fi

PROJECT_NUM=$(jq -r '.projectNumber' "$MANIFEST")
PROJECT_ID=$(jq -r '.projectId' "$MANIFEST")
STATUS_FIELD_ID=$(jq -r '.statusFieldId' "$MANIFEST")
BACKLOG_OPT=$(jq -r '.statusOptions["Backlog"]' "$MANIFEST")

# ---------------------------------------------------------------------------
# Check 2 — All 13 expected labels present
# ---------------------------------------------------------------------------

section "Check 2: labels"

EXPECTED_LABELS=(P0 P1 P2 P3 \
  persona:creative-director persona:social-manager persona:content-creator \
  persona:performance-marketer persona:ecommerce persona:brand-ops persona:freelancer \
  ready-to-build in-progress)

ACTUAL_LABELS=$(gh label list --repo "$REPO" --limit 200 --json name --jq '.[].name')

for l in "${EXPECTED_LABELS[@]}"; do
  if grep -qx "$l" <<<"$ACTUAL_LABELS"; then
    ok "label '$l'"
  else
    fail "missing label '$l'"
  fi
done

# ---------------------------------------------------------------------------
# Check 3 — All 24 expected issue titles present
# ---------------------------------------------------------------------------

section "Check 3: issues"

ALL_ISSUES=$(gh issue list --repo "$REPO" --state all --limit 500 --json number,title)

while IFS=$'\t' read -r title rest; do
  [[ -z "$title" ]] && continue
  if echo "$ALL_ISSUES" | jq -e --arg t "$title" 'any(.title == $t)' >/dev/null; then
    ok "issue: $title"
  else
    fail "missing issue: $title"
  fi
done < "$TSV"

# ---------------------------------------------------------------------------
# Check 4 — Status options match expected order
# ---------------------------------------------------------------------------

section "Check 4: project Status options"

OPTIONS_JSON=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            options { name }
          }
        }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUM")

ACTUAL_ORDER=$(echo "$OPTIONS_JSON" | jq -c '.data.organization.projectV2.field.options | map(.name)')
EXPECTED_ORDER='["Backlog","Refined","Ready to Build","In Progress","Review","Done"]'

if [[ "$ACTUAL_ORDER" == "$EXPECTED_ORDER" ]]; then
  ok "status options in expected order"
else
  fail "status options mismatch"
  echo "    expected: $EXPECTED_ORDER"
  echo "    actual:   $ACTUAL_ORDER"
fi

# ---------------------------------------------------------------------------
# Check 5 — All 24 project items, all with Status = Backlog
# ---------------------------------------------------------------------------

section "Check 5: project items"

# Paginate items (board can hold > 100 with cursor; with 24 we stay on page 1).
ITEMS_JSON=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        items(first: 100) {
          totalCount
          nodes {
            content {
              ... on Issue { number title }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUM")

TOTAL=$(echo "$ITEMS_JSON" | jq '.data.organization.projectV2.items.totalCount')

if [[ "$TOTAL" == "24" ]]; then
  ok "project has 24 items (totalCount)"
else
  fail "expected 24 items, got $TOTAL"
fi

NON_BACKLOG=$(echo "$ITEMS_JSON" | jq -r '
  .data.organization.projectV2.items.nodes[]
  | . as $item
  | ($item.fieldValues.nodes[]? | select(.field.name == "Status") | .name) as $status
  | select($status != "Backlog")
  | "\($item.content.number)\t\($item.content.title // "?")\t\($status)"
')

if [[ -z "$NON_BACKLOG" ]]; then
  ok "all items have Status = Backlog"
else
  fail "items not in Backlog:"
  echo "$NON_BACKLOG" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo
if (( FAIL == 0 )); then
  printf '\033[1;32mPASS\033[0m  %d checks ok\n' "$PASS"
  exit 0
else
  printf '\033[1;31mFAIL\033[0m  %d ok, %d failed\n' "$PASS" "$FAIL"
  exit 1
fi
