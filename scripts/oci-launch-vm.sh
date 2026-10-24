#!/usr/bin/env bash
# Creates the Always Free Ampere VM on Oracle Cloud, retrying until the region has capacity.
#
# Needs the oci CLI configured once (`brew install oci-cli && oci setup config`, then upload the
# printed public key under Profile -> User settings -> API keys) and a public subnet, e.g. the one
# made by Networking -> Virtual cloud networks -> Start VCN Wizard -> "VCN with Internet Connectivity".
#
#   scripts/oci-launch-vm.sh                      # 1 OCPU / 4 GB / 100 GB boot, retry every 60s
#   OCPUS=4 MEMORY_GB=8 scripts/oci-launch-vm.sh   # resize later: stop, Edit -> Shape
set -euo pipefail

NAME=${NAME:-mf-tracker}
OCPUS=${OCPUS:-1}
MEMORY_GB=${MEMORY_GB:-4}
BOOT_GB=${BOOT_GB:-100}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519.pub}
SUBNET_NAME=${SUBNET_NAME:-public subnet-mf-vcn}
WAIT=${WAIT:-60}
SHAPE=VM.Standard.A1.Flex

[ -f "$SSH_KEY" ] || { echo "SSH public key not found: $SSH_KEY (set SSH_KEY=...)" >&2; exit 1; }

# Always Free resources live in the root compartment, whose OCID is the tenancy's.
TENANCY=$(awk -F= '$1 ~ /^tenancy/ { gsub(/[ \t]/, "", $2); print $2; exit }' ~/.oci/config)
AD=$(oci iam availability-domain list -c "$TENANCY" --query 'data[0].name' --raw-output)
SUBNET=$(oci network subnet list -c "$TENANCY" --all \
  --query "data[?\"display-name\"=='$SUBNET_NAME'].id | [0]" --raw-output)
IMAGE=$(oci compute image list -c "$TENANCY" --all --shape "$SHAPE" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --sort-by TIMECREATED --sort-order DESC --query 'data[0].id' --raw-output)

for v in AD SUBNET IMAGE; do
  [ -n "${!v}" ] && [ "${!v}" != "null" ] || { echo "Could not find $v (subnet name: '$SUBNET_NAME')" >&2; exit 1; }
done
echo "AD:     $AD"
echo "Subnet: $SUBNET"
echo "Image:  $IMAGE"
echo "Shape:  $SHAPE, $OCPUS OCPU, $MEMORY_GB GB RAM, $BOOT_GB GB boot volume"

attempt=0
while true; do
  attempt=$((attempt + 1))
  echo "[$(date '+%H:%M:%S')] attempt $attempt"
  if out=$(oci compute instance launch -c "$TENANCY" \
      --availability-domain "$AD" --display-name "$NAME" \
      --shape "$SHAPE" --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
      --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true \
      --boot-volume-size-in-gbs "$BOOT_GB" --ssh-authorized-keys-file "$SSH_KEY" \
      --wait-for-state RUNNING --query 'data.id' --raw-output 2>&1); then
    ID=$(printf '%s\n' "$out" | grep -o 'ocid1\.instance[^" ]*' | head -1)
    IP=$(oci compute instance list-vnics --instance-id "$ID" --query 'data[0]."public-ip"' --raw-output)
    echo "Created $NAME: $ID"
    echo "Public IP: $IP"
    echo "SSH:       ssh ubuntu@$IP"
    exit 0
  fi
  case "$out" in
    *"Out of host capacity"* | *"Out of capacity"* | *InternalError*)
      echo "  no capacity, retrying in ${WAIT}s" ;;
    *TooManyRequests*)
      echo "  rate limited, retrying in $((WAIT * 3))s"; sleep $((WAIT * 2)) ;;
    *)
      echo "$out" >&2; exit 1 ;;
  esac
  sleep "$WAIT"
done
