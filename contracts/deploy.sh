#!/usr/bin/env bash
#
# LumenSplitter — mainnet declare + deploy walkthrough.
#
# ─────────────────────────────────────────────────────────────────────────────
# THIS SCRIPT DOES NOT DEPLOY ANYTHING. It prints the exact commands and exits.
#
# Declaring a class and deploying a contract SPEND REAL MAINNET GAS and are
# irreversible. That is the repo owner's decision to make, with the repo owner's
# own account and the repo owner's own signer. So this script:
#
#   - never contains, prompts for, reads, or echoes private key material
#   - never invokes `starkli declare` or `starkli deploy`
#   - takes the account and signer as PATHS via environment variables, and only
#     ever checks that those paths exist
#
# When you run the printed commands yourself, starkli will prompt you for your
# keystore password in its own process. Nothing in this repository sees it.
#
# The contract is a DRAFT and has NOT been audited. Get it reviewed — and run the
# `cairo-security` skill over it — before you put mainnet value behind it.
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage:
#
#   export STARKNET_ACCOUNT=~/.starkli-wallets/lumen/account.json
#   export STARKNET_KEYSTORE=~/.starkli-wallets/lumen/keystore.json
#   export STARKNET_RPC=https://your-mainnet-rpc          # optional
#   export FEE_RECIPIENT=0x0                              # optional, 0 = fees off
#   export MAX_FEE_BPS=0                                  # optional, 0 = fees off
#   ./deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")"

# The live STRK20 privacy pool on Starknet mainnet. Pinned into the contract at
# deployment: it becomes the only address allowed to call privacy_invoke.
# Source: src/lib/strk20/config.ts (POOL_ADDRESS).
POOL_ADDRESS="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"

# Fees are opt-in. The intended Lumen configuration is both of these at zero,
# which disables the fee leg entirely (a non-zero fee then reverts).
FEE_RECIPIENT="${FEE_RECIPIENT:-0x0}"
MAX_FEE_BPS="${MAX_FEE_BPS:-0}"

SIERRA="target/dev/lumen_splitter_LumenSplitter.contract_class.json"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

echo
bold "LumenSplitter — mainnet deployment walkthrough (nothing is executed)"
echo

# ─── 1. Preconditions ────────────────────────────────────────────────────────
# Paths only. Never the contents, and never a private key.

missing=0
if [[ -z "${STARKNET_ACCOUNT:-}" ]]; then
  warn "STARKNET_ACCOUNT is not set — path to your starkli account descriptor JSON."
  missing=1
elif [[ ! -f "${STARKNET_ACCOUNT}" ]]; then
  warn "STARKNET_ACCOUNT is set but no file exists at: ${STARKNET_ACCOUNT}"
  missing=1
fi

if [[ -z "${STARKNET_KEYSTORE:-}" ]]; then
  warn "STARKNET_KEYSTORE is not set — path to your encrypted keystore JSON."
  warn "starkli will ask for its password itself, in its own process."
  missing=1
elif [[ ! -f "${STARKNET_KEYSTORE}" ]]; then
  warn "STARKNET_KEYSTORE is set but no file exists at: ${STARKNET_KEYSTORE}"
  missing=1
fi

if [[ ! -f "${SIERRA}" ]]; then
  warn "Build artifact missing. Run 'scarb build' first (expected: ${SIERRA})."
  missing=1
fi

if [[ "${missing}" -ne 0 ]]; then
  echo
  warn "Set the missing values and re-run. The commands below are printed anyway,"
  warn "with placeholders where a real path is not known."
  echo
fi

RPC_FLAG=""
if [[ -n "${STARKNET_RPC:-}" ]]; then
  RPC_FLAG="--rpc ${STARKNET_RPC}"
else
  RPC_FLAG="--network mainnet"
fi

ACCOUNT_PATH="${STARKNET_ACCOUNT:-<path-to-account.json>}"
KEYSTORE_PATH="${STARKNET_KEYSTORE:-<path-to-keystore.json>}"

# ─── 2. Verify locally (free, offline, no key) ───────────────────────────────

bold "Step 0 — verify the build (free, offline, no key involved)"
cat <<EOF

  scarb fmt --check
  scarb build
  snforge test
  starkli class-hash ${SIERRA}

The class hash printed by that last command is the one you are about to declare.
It changes if the source or the compiler version changes.
EOF

if [[ -f "${SIERRA}" ]] && command -v starkli >/dev/null 2>&1; then
  echo
  echo "  current local class hash: $(starkli class-hash "${SIERRA}")"
fi

# ─── 3. Declare ──────────────────────────────────────────────────────────────

echo
bold "Step 1 — declare the class on mainnet  ⚠ COSTS GAS"
cat <<EOF

  starkli declare ${RPC_FLAG} \\
    --account ${ACCOUNT_PATH} \\
    --keystore ${KEYSTORE_PATH} \\
    ${SIERRA}

Declaring registers the code; it does not create an instance. If this class hash
has already been declared, starkli says so and no gas is spent. Copy the class
hash it prints — you need it for step 2.
EOF

# ─── 4. Deploy ───────────────────────────────────────────────────────────────

echo
bold "Step 2 — deploy an instance  ⚠ COSTS GAS"
cat <<EOF

Constructor arguments, in order:

  pool           ${POOL_ADDRESS}
                 the STRK20 privacy pool — the ONLY address allowed to call
                 privacy_invoke on this instance
  fee_recipient  ${FEE_RECIPIENT}
                 0x0 disables the fee leg entirely
  max_fee_bps    ${MAX_FEE_BPS}
                 hard cap on any declared fee, in basis points

  starkli deploy ${RPC_FLAG} \\
    --account ${ACCOUNT_PATH} \\
    --keystore ${KEYSTORE_PATH} \\
    <CLASS_HASH_FROM_STEP_1> \\
    ${POOL_ADDRESS} \\
    ${FEE_RECIPIENT} \\
    ${MAX_FEE_BPS}
EOF

# ─── 5. Post-deploy ──────────────────────────────────────────────────────────

echo
bold "Step 3 — confirm the deployment (free, read-only)"
cat <<EOF

  starkli call ${RPC_FLAG} <DEPLOYED_ADDRESS> pool_address
  starkli call ${RPC_FLAG} <DEPLOYED_ADDRESS> max_splits

pool_address must echo ${POOL_ADDRESS}. If it does not, the instance is
misconfigured: do not route value through it, deploy a corrected one.

Then wire the deployed address into the dapp's helper allowlist and dry-run the
action list with strk20PrepareInvoke(actions, true) before any real transaction.
EOF

echo
warn "Nothing above was executed. Run the commands yourself, after review."
echo
