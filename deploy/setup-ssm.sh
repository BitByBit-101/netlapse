#!/usr/bin/env bash
#
# Replace inbound SSH with AWS Systems Manager, and tidy up unused Elastic IPs.
#
#   ./deploy/setup-ssm.sh                 # show what would change, change nothing
#   ./deploy/setup-ssm.sh --apply         # attach the role and enable SSM access
#   ./deploy/setup-ssm.sh --apply --close-ssh
#   ./deploy/setup-ssm.sh --release-unused-eips --apply
#
# Why bother: an inbound rule pinned to your home IP breaks every time your ISP
# rotates it, and a GitHub-hosted runner can never match it because it has no
# fixed egress address. Session Manager tunnels over the instance's *outbound*
# 443, so port 22 can be closed to the entire internet and CI can still deploy.
#
# Run this from a machine with AWS credentials that can manage IAM and EC2. It
# never touches the running app, the database, or nginx.
#
# Requires: aws CLI v2, configured (`aws configure`) or with AWS_PROFILE set.

set -euo pipefail

ROLE_NAME="${ROLE_NAME:-netlapse-ssm-role}"
PROFILE_NAME="${PROFILE_NAME:-$ROLE_NAME}"
# Overridable so this is reusable, but defaulted to the netlapse instance.
INSTANCE_ID="${INSTANCE_ID:-i-03bc1682269869980}"
REGION="${REGION:-ap-southeast-2}"
# The address DuckDNS points at. Guards the EIP release: whatever is serving the
# site must never be released, whatever the tags say.
LIVE_DOMAIN="${LIVE_DOMAIN:-netlapse.duckdns.org}"

APPLY=false
CLOSE_SSH=false
RELEASE_EIPS=false
for arg in "$@"; do
  case "$arg" in
    --apply)                APPLY=true ;;
    --close-ssh)            CLOSE_SSH=true ;;
    --release-unused-eips)  RELEASE_EIPS=true ;;
    -h|--help)              sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!  %s\033[0m\n' "$1"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }
# Prefixes anything that would change state while in dry-run.
run() {
  if [[ "$APPLY" == true ]]; then "$@"
  else printf '   \033[2mwould run:\033[0m %s\n' "$*"
  fi
}

command -v aws >/dev/null || die "aws CLI not found. Install it, then \`aws configure\`."
aws sts get-caller-identity --query Arn --output text >/dev/null 2>&1 \
  || die "aws credentials are not working. Run \`aws configure\` (or set AWS_PROFILE)."

export AWS_DEFAULT_REGION="$REGION"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
CALLER="$(aws sts get-caller-identity --query Arn --output text)"

echo "  account   : $ACCOUNT"
echo "  caller    : $CALLER"
echo "  region    : $REGION"
echo "  instance  : $INSTANCE_ID"
[[ "$APPLY" == true ]] || warn "dry run — nothing will be changed. Re-run with --apply."

aws ec2 describe-instances --instance-ids "$INSTANCE_ID" >/dev/null 2>&1 \
  || die "instance $INSTANCE_ID not found in $REGION"

# ---------------------------------------------------------------- IAM role ----
say "IAM role for Session Manager"

# The trust policy is what makes this an *instance* role: only EC2 may assume it.
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "   role $ROLE_NAME already exists"
else
  echo "   creating role $ROLE_NAME"
  run aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST" \
    --description "Lets netlapse be managed by SSM so inbound SSH can stay closed"
fi

# AmazonSSMManagedInstanceCore is the AWS-managed policy for exactly this. It
# grants the agent what it needs to register and open sessions, and nothing else
# — notably no S3, no EC2 mutation. Preferred over a hand-rolled policy, which
# would drift as SSM adds APIs.
echo "   attaching AmazonSSMManagedInstanceCore"
run aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

# EC2 cannot consume a role directly; it needs an instance profile wrapper.
if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  echo "   instance profile $PROFILE_NAME already exists"
else
  echo "   creating instance profile $PROFILE_NAME"
  run aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME"
fi

if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" \
     --query "InstanceProfile.Roles[?RoleName=='$ROLE_NAME']" --output text 2>/dev/null | grep -q .; then
  echo "   role already in the profile"
else
  echo "   adding the role to the profile"
  run aws iam add-role-to-instance-profile \
    --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME"
  # IAM is eventually consistent: associating a just-created profile often fails
  # with an InvalidParameterValue until it has propagated.
  if [[ "$APPLY" == true ]]; then
    echo "   waiting for IAM to propagate"
    sleep 15
  fi
fi

say "Attaching the profile to $INSTANCE_ID"
EXISTING="$(aws ec2 describe-iam-instance-profile-associations \
  --filters "Name=instance-id,Values=$INSTANCE_ID" \
  --query "IamInstanceProfileAssociations[?State=='associated'].IamInstanceProfile.Arn" \
  --output text 2>/dev/null || true)"

if [[ -n "$EXISTING" && "$EXISTING" != "None" ]]; then
  echo "   already has a profile: $EXISTING"
  case "$EXISTING" in
    *"$PROFILE_NAME") echo "   that is the one we want — nothing to do" ;;
    *) warn "a DIFFERENT profile is attached. Not replacing it: it may grant"
       warn "something else this instance needs. Add AmazonSSMManagedInstanceCore"
       warn "to that role instead, or detach it deliberately and re-run." ;;
  esac
else
  echo "   associating $PROFILE_NAME"
  run aws ec2 associate-iam-instance-profile \
    --instance-id "$INSTANCE_ID" \
    --iam-instance-profile "Name=$PROFILE_NAME"
fi

# The agent only picks up new credentials on restart. Without this you wait out
# its retry backoff wondering whether any of the above worked.
say "Restarting the SSM agent so it picks up the credentials"
if [[ "$APPLY" == true ]]; then
  aws ssm send-command --instance-ids "$INSTANCE_ID" \
      --document-name AWS-RunShellScript \
      --parameters 'commands=["systemctl restart snap.amazon-ssm-agent.amazon-ssm-agent"]' \
      >/dev/null 2>&1 \
    && echo "   restart requested via SSM" \
    || warn "could not reach the agent yet (expected on first run). Restart it over SSH:
     sudo systemctl restart snap.amazon-ssm-agent.amazon-ssm-agent"
else
  echo "   would restart snap.amazon-ssm-agent.amazon-ssm-agent"
fi

say "Waiting for the instance to register with SSM"
if [[ "$APPLY" == true ]]; then
  ONLINE=false
  for _ in $(seq 1 30); do
    STATUS="$(aws ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
      --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
    [[ "$STATUS" == "Online" ]] && { ONLINE=true; break; }
    sleep 10
  done
  if [[ "$ONLINE" == true ]]; then
    printf '\033[1;32m   Online. Connect with:\033[0m\n'
    echo "     aws ssm start-session --target $INSTANCE_ID --region $REGION"
  else
    warn "not Online yet. It can take a few minutes. Check with:"
    warn "  aws ssm describe-instance-information --region $REGION"
    warn "Do NOT close port 22 until this reports Online."
  fi
else
  echo "   would poll until PingStatus=Online"
fi

# --------------------------------------------------------------- close SSH ----
if [[ "$CLOSE_SSH" == true ]]; then
  say "Removing inbound SSH rules"
  # Refuse to do this blind. Locking yourself out of a box whose only other door
  # is not yet proven open is the one mistake here that is genuinely painful.
  STATUS="$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
  if [[ "$STATUS" != "Online" ]]; then
    die "instance is not Online in SSM (status: ${STATUS:-unknown}).
Closing port 22 now would leave no way in. Fix SSM first, then re-run."
  fi

  SG_IDS="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[].Instances[].SecurityGroups[].GroupId' --output text)"
  for sg in $SG_IDS; do
    # Matches FromPort<=22<=ToPort, not FromPort==22, because a range like 20-25
    # also exposes SSH. Filtering on the exact port would leave it open while
    # reporting success. Rules covering more than SSH are reported, never
    # revoked: removing 0-65535 to close one port would take the site down.
    RULES="$(aws ec2 describe-security-group-rules \
      --filters "Name=group-id,Values=$sg" \
      --query "SecurityGroupRules[?IsEgress==\`false\` && FromPort<=\`22\` && ToPort>=\`22\`].[SecurityGroupRuleId,FromPort,ToPort]" \
      --output text 2>/dev/null || true)"
    if [[ -z "$RULES" ]]; then
      echo "   $sg: no inbound rule covers port 22"
      continue
    fi
    while read -r rid from to; do
      [[ -n "$rid" ]] || continue
      if [[ "$from" == "22" && "$to" == "22" ]]; then
        echo "   $sg: revoking $rid (22-22)"
        run aws ec2 revoke-security-group-ingress \
          --group-id "$sg" --security-group-rule-ids "$rid"
      else
        warn "$sg: $rid spans $from-$to, which covers 22 but other ports too."
        warn "  Not revoking it automatically. Narrow or remove it by hand."
      fi
    done <<<"$RULES"
  done
  [[ "$APPLY" == true ]] && echo "   port 22 is now closed. Use start-session instead of ssh."
fi

# ------------------------------------------------------------- Elastic IPs ----
if [[ "$RELEASE_EIPS" == true ]]; then
  say "Unassociated Elastic IPs"
  # An allocated-but-unassociated address bills by the hour for doing nothing.
  # getent is glibc-only: absent on macOS and on Git Bash for Windows, where it
  # would silently yield nothing and quietly disarm the guard below. Fall back
  # through the other resolvers rather than trusting whichever one exists.
  LIVE_IP="$(getent ahostsv4 "$LIVE_DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
  if [[ -z "$LIVE_IP" ]] && command -v dig >/dev/null; then
    LIVE_IP="$(dig +short A "$LIVE_DOMAIN" 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)"
  fi
  if [[ -z "$LIVE_IP" ]] && command -v nslookup >/dev/null; then
    # Only read Addresses that come AFTER the "Name:" line. The header block
    # reports the resolver's own address, so parsing the first Address: yields
    # the DNS server — a wrong-but-plausible value that would disarm the guard.
    LIVE_IP="$(nslookup "$LIVE_DOMAIN" 2>/dev/null \
      | awk '/^Name:/{seen=1} seen && /^Address(es)?: */{sub(/^Address(es)?: */,""); print $1; exit}' || true)"
  fi
  echo "   $LIVE_DOMAIN resolves to: ${LIVE_IP:-<unresolved>}"
  # Without a resolved address the guard cannot tell the live IP from an idle
  # one, so releasing anything would be guesswork. Stop instead.
  [[ -n "$LIVE_IP" ]] || die "could not resolve $LIVE_DOMAIN, so I cannot tell which
address is serving the site. Refusing to release anything. Check DNS, or set
LIVE_DOMAIN= to the right name."

  mapfile -t IDLE < <(aws ec2 describe-addresses \
    --query 'Addresses[?AssociationId==null].[AllocationId,PublicIp]' --output text 2>/dev/null || true)

  if [[ ${#IDLE[@]} -eq 0 || -z "${IDLE[0]:-}" ]]; then
    echo "   none — nothing is being billed for sitting idle"
  else
    for row in "${IDLE[@]}"; do
      alloc="$(awk '{print $1}' <<<"$row")"
      ip="$(awk '{print $2}' <<<"$row")"
      # Belt and braces: an address is only idle if AWS says it has no
      # association AND it is not the one currently serving the site.
      if [[ -n "$LIVE_IP" && "$ip" == "$LIVE_IP" ]]; then
        warn "$ip ($alloc) is unassociated but IS what $LIVE_DOMAIN resolves to — SKIPPING"
        continue
      fi
      echo "   releasing $ip ($alloc)"
      run aws ec2 release-address --allocation-id "$alloc"
    done
  fi
fi

say "Done"
if [[ "$APPLY" != true ]]; then
  echo "This was a dry run. Re-run with --apply to make the changes."
fi
