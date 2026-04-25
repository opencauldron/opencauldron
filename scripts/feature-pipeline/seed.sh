#!/usr/bin/env bash
#
# Seed the GitHub feature pipeline:
#   - 13 labels (4 priority + 7 persona + 2 workflow)
#   - 1 org-level Project v2 board "Feature Pipeline" with 6 Status options
#   - 24 stub issues, all added to the board with Status = Backlog
#   - .github/project-ids.json manifest for the future scheduled agent
#
# Idempotent: safe to re-run. See specs/github-feature-pipeline/spec.md.

set -euo pipefail

REPO="opencauldron/opencauldron"
OWNER="opencauldron"
PROJECT_TITLE="Feature Pipeline"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TSV="$SCRIPT_DIR/issues.tsv"
MANIFEST="$REPO_ROOT/.github/project-ids.json"

log() { printf '\033[1;34m[seed]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[seed]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[seed]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Step 0 — Preflight
# ---------------------------------------------------------------------------

log "Preflight: checking gh auth + scopes"
gh auth status >/dev/null 2>&1 || die "gh not authenticated. Run: gh auth login"

SCOPES=$(gh auth status 2>&1 | awk -F': ' '/Token scopes/ {print $2}' | tr -d "' ")
case ",$SCOPES," in
  *",project,"*) : ;;
  *) die "Token missing 'project' scope (got: $SCOPES). Run: gh auth refresh -s project,read:project" ;;
esac

gh api user/orgs --jq '.[].login' | grep -qx "$OWNER" \
  || die "Not a member of org '$OWNER' (or token lacks read:org)."

[[ -f "$TSV" ]] || die "Missing $TSV"
[[ "$(wc -l <"$TSV" | tr -d ' ')" == "24" ]] || die "Expected 24 lines in $TSV, got $(wc -l <"$TSV")"

# ---------------------------------------------------------------------------
# Step 1 — Labels (parallel)
# ---------------------------------------------------------------------------

log "Creating/upserting 13 labels"

create_label() {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null
}

create_label P0 b60205 "Critical priority" &
create_label P1 d93f0b "High priority" &
create_label P2 fbca04 "Medium priority" &
create_label P3 0e8a16 "Low priority" &

for p in creative-director social-manager content-creator performance-marketer ecommerce brand-ops freelancer; do
  create_label "persona:$p" 5319e7 "Affects the $p persona" &
done

create_label ready-to-build 0e8a16 "Fully specified; safe for autonomous build" &
create_label in-progress    1d76db "Active work in flight" &

wait
log "Labels done."

# ---------------------------------------------------------------------------
# Step 2 — Project board (create or find)
# ---------------------------------------------------------------------------

log "Finding or creating project '$PROJECT_TITLE'"

PROJECT_NUM=$(gh project list --owner "$OWNER" --format json \
  --jq ".projects[] | select(.title==\"$PROJECT_TITLE\") | .number" | head -1 || true)

if [[ -z "${PROJECT_NUM:-}" ]]; then
  PROJECT_NUM=$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json --jq '.number')
  log "Created project #$PROJECT_NUM"
else
  log "Found existing project #$PROJECT_NUM"
fi

# ---------------------------------------------------------------------------
# Step 2b — Reconcile Status field options
# ---------------------------------------------------------------------------

log "Reading Status field"

PROJECT_STATE=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        id
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id name }
          }
        }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUM")

PROJECT_ID=$(echo "$PROJECT_STATE" | jq -r '.data.organization.projectV2.id')
STATUS_FIELD_ID=$(echo "$PROJECT_STATE" | jq -r '.data.organization.projectV2.field.id')
[[ -n "$PROJECT_ID" && "$PROJECT_ID" != "null" ]] || die "Could not resolve project node ID"
[[ -n "$STATUS_FIELD_ID" && "$STATUS_FIELD_ID" != "null" ]] || die "Could not resolve Status field ID"

CURRENT_OPTIONS=$(echo "$PROJECT_STATE" | jq -c '.data.organization.projectV2.field.options')
CURRENT_NAMES=$(echo "$CURRENT_OPTIONS" | jq -r '.[].name' | tr '\n' '|')
DESIRED="Backlog|Refined|Ready to Build|In Progress|Review|Done|"

if [[ "$CURRENT_NAMES" == "$DESIRED" ]]; then
  log "Status options already correct."
else
  log "Reconciling Status options: [$CURRENT_NAMES] -> [$DESIRED]"

  # Look up existing IDs for names we want to keep.
  find_existing_id() {
    echo "$CURRENT_OPTIONS" | jq -r --arg n "$1" '.[] | select(.name == $n) | .id' | head -1
  }
  IP_ID=$(find_existing_id "In Progress")
  DONE_ID=$(find_existing_id "Done")

  # Build a single GraphQL option-literal with optional id field.
  opt_literal() {
    local name="$1" color="$2" id="${3:-}"
    if [[ -n "$id" ]]; then
      printf '{ id: "%s", name: "%s", color: %s, description: "" }' "$id" "$name" "$color"
    else
      printf '{ name: "%s", color: %s, description: "" }' "$name" "$color"
    fi
  }

  # Inline the entire options array into the mutation string. This sidesteps
  # `gh api graphql -F` not supporting JSON arrays as variable values.
  # Options not present here are deleted; options with `id` are preserved
  # (allowing rename/recolor). Order is the displayed order.
  OPTIONS_LITERAL=$(printf '[%s, %s, %s, %s, %s, %s]' \
    "$(opt_literal 'Backlog'        GRAY)" \
    "$(opt_literal 'Refined'        BLUE)" \
    "$(opt_literal 'Ready to Build' GREEN)" \
    "$(opt_literal 'In Progress'    YELLOW "$IP_ID")" \
    "$(opt_literal 'Review'         ORANGE)" \
    "$(opt_literal 'Done'           PURPLE  "$DONE_ID")")

  MUTATION="mutation {
    updateProjectV2Field(input: {
      fieldId: \"$STATUS_FIELD_ID\"
      singleSelectOptions: $OPTIONS_LITERAL
    }) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
          options { id name }
        }
      }
    }
  }"

  if ! gh api graphql -f query="$MUTATION" >/dev/null 2>/tmp/feature-pipeline-mutation-err; then
    warn "Bulk option update failed:"
    cat /tmp/feature-pipeline-mutation-err >&2
    die "Status option reconciliation failed."
  fi

  log "Status options reconciled."
fi

# Re-read after mutation for stable IDs
PROJECT_STATE=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        id
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id name }
          }
        }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUM")

PROJECT_ID=$(echo "$PROJECT_STATE" | jq -r '.data.organization.projectV2.id')
STATUS_FIELD_ID=$(echo "$PROJECT_STATE" | jq -r '.data.organization.projectV2.field.id')

# ---------------------------------------------------------------------------
# Step 3 — Manifest
# ---------------------------------------------------------------------------

log "Writing manifest -> $MANIFEST"

mkdir -p "$(dirname "$MANIFEST")"

OPTIONS_MAP=$(echo "$PROJECT_STATE" | jq '.data.organization.projectV2.field.options | map({(.name): .id}) | add')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
USER_LOGIN=$(gh api user --jq .login)

jq -n \
  --arg owner "$OWNER" \
  --argjson num "$PROJECT_NUM" \
  --arg pid "$PROJECT_ID" \
  --arg sfid "$STATUS_FIELD_ID" \
  --argjson opts "$OPTIONS_MAP" \
  --arg now "$NOW" \
  --arg by "$USER_LOGIN" \
  '{
    owner: $owner,
    projectNumber: $num,
    projectId: $pid,
    statusFieldId: $sfid,
    statusOptions: $opts,
    labels: {
      priority: ["P0","P1","P2","P3"],
      personas: [
        "persona:creative-director",
        "persona:social-manager",
        "persona:content-creator",
        "persona:performance-marketer",
        "persona:ecommerce",
        "persona:brand-ops",
        "persona:freelancer"
      ],
      workflow: ["ready-to-build","in-progress"]
    },
    capturedAt: $now,
    capturedBy: $by,
    _warning: "Do not delete Status options. Renaming is safe (IDs are stable). Deletion breaks the scheduled feature-pipeline agent."
  }' > "$MANIFEST"

log "Manifest written."

# ---------------------------------------------------------------------------
# Step 4 — Issues (idempotent upsert by title)
# ---------------------------------------------------------------------------

log "Pre-fetching existing issues for idempotency"

# Pull all open + closed issue titles once, instead of querying per-row.
EXISTING_ISSUES=$(gh issue list --repo "$REPO" --state all --limit 500 --json number,title)

ISSUE_NUMS_FILE=$(mktemp -t feature-pipeline-issues.XXXX)
trap 'rm -f "$ISSUE_NUMS_FILE"' EXIT

BODY_FOOTER=$'\n\n---\nStatus: Backlog stub. TODO: refine into a Ready-to-Build issue with problem statement, acceptance criteria, scope boundaries, affected surfaces, and test plan. See `specs/github-feature-pipeline/spec.md`.'

create_or_find_issue() {
  local title="$1" oneliner="$2" labels="$3"
  local body="${oneliner}${BODY_FOOTER}"
  local existing
  existing=$(echo "$EXISTING_ISSUES" | jq -r --arg t "$title" '.[] | select(.title == $t) | .number' | head -1)

  if [[ -n "$existing" ]]; then
    echo "$existing"
    return
  fi

  local url
  url=$(gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$labels")
  echo "${url##*/}"
}

log "Creating/finding 24 issues (sequential to keep stable order)"

> "$ISSUE_NUMS_FILE"
LINE_NO=0
while IFS=$'\t' read -r title oneliner labels; do
  LINE_NO=$((LINE_NO + 1))
  [[ -z "$title" ]] && continue
  num=$(create_or_find_issue "$title" "$oneliner" "$labels")
  printf '%s\t%s\n' "$num" "$title" >> "$ISSUE_NUMS_FILE"
  printf '  [%2d/24] #%s  %s\n' "$LINE_NO" "$num" "$title"
done < "$TSV"

ISSUE_COUNT=$(wc -l <"$ISSUE_NUMS_FILE" | tr -d ' ')
[[ "$ISSUE_COUNT" == "24" ]] || die "Expected 24 issues, got $ISSUE_COUNT"

# ---------------------------------------------------------------------------
# Step 5 — Add issues to project, set Status = Backlog
# ---------------------------------------------------------------------------

log "Adding issues to project + setting Status = Backlog"

BACKLOG_OPT=$(jq -r '.statusOptions["Backlog"]' "$MANIFEST")
[[ -n "$BACKLOG_OPT" && "$BACKLOG_OPT" != "null" ]] || die "Backlog option ID missing from manifest"

set_backlog() {
  local issue_num="$1"
  local item_id retries=3
  while (( retries > 0 )); do
    if item_id=$(gh project item-add "$PROJECT_NUM" --owner "$OWNER" \
        --url "https://github.com/$REPO/issues/$issue_num" \
        --format json --jq '.id' 2>/tmp/feature-pipeline-add-err); then
      break
    fi
    retries=$((retries - 1))
    if (( retries == 0 )); then
      cat /tmp/feature-pipeline-add-err >&2
      die "Failed to add issue #$issue_num to project after retries"
    fi
    sleep 1
  done

  gh project item-edit \
    --project-id "$PROJECT_ID" \
    --id "$item_id" \
    --field-id "$STATUS_FIELD_ID" \
    --single-select-option-id "$BACKLOG_OPT" >/dev/null
}

# Sequential: GitHub rejects concurrent modifications to the same project
# with "temporary conflict" errors. With 24 items, sequential is ~10s.
COUNT=0
while IFS=$'\t' read -r num title; do
  COUNT=$((COUNT + 1))
  set_backlog "$num"
  printf '  [%2d/24] item-add + Status=Backlog for #%s\n' "$COUNT" "$num"
done < "$ISSUE_NUMS_FILE"
log "All 24 items linked + set to Backlog."

log "Done. Manifest at: $MANIFEST"
log "Project: https://github.com/orgs/$OWNER/projects/$PROJECT_NUM"
