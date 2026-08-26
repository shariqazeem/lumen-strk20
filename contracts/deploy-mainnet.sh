#!/usr/bin/env bash
#
# LumenEscrow — one-shot mainnet deploy.
#
# ─────────────────────────────────────────────────────────────────────────────
# THIS SCRIPT NEVER SEES YOUR PRIVATE KEY OR PASSWORD.
#
# It takes the PATHS to your starkli account and keystore from the environment
# and runs starkli. starkli prompts you for the keystore password in its own
# process, on your terminal. Nothing here reads, stores, echoes, or forwards
# it. Everything else — build, class hash, declare, deploy, verify, wiring the
# address into the app — is automated.
#
# The contract is a DRAFT and has NOT been audited.
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage:
#   export STARKNET_ACCOUNT=~/.starkli-wallets/lumen/account.json
#   export STARKNET_KEYSTORE=~/.starkli-wallets/lumen/keystore.json
#   export STARKNET_RPC=https://your-mainnet-rpc      # optional but recommended
#   ./contracts/deploy-mainnet.sh
#
set -euo pipefail
cd "$(dirname "$0")"

POOL_ADDRESS="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
STRK="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
SIERRA="target/dev/lumen_splitter_LumenEscrow.contract_class.json"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ─── preconditions ───────────────────────────────────────────────────────────
command -v starkli >/dev/null || die "starkli not found. Install: curl https://get.starkli.sh | sh"
[[ -n "${STARKNET_ACCOUNT:-}" ]] || die "STARKNET_ACCOUNT is not set (path to account.json)."
[[ -f "${STARKNET_ACCOUNT}" ]]   || die "No file at STARKNET_ACCOUNT: ${STARKNET_ACCOUNT}"
[[ -n "${STARKNET_KEYSTORE:-}" ]] || die "STARKNET_KEYSTORE is not set (path to keystore.json)."
[[ -f "${STARKNET_KEYSTORE}" ]]  || die "No file at STARKNET_KEYSTORE: ${STARKNET_KEYSTORE}"

if [[ -n "${STARKNET_RPC:-}" ]]; then RPC=(--rpc "${STARKNET_RPC}"); else RPC=(--network mainnet); fi

bold "1/6  Building"
scarb build >/dev/null
[[ -f "${SIERRA}" ]] || die "Build artifact missing: ${SIERRA}"

bold "2/6  Local class hash"
CLASS_HASH_LOCAL="$(starkli class-hash "${SIERRA}")"
echo "     ${CLASS_HASH_LOCAL}"

bold "3/6  Declaring on mainnet   ⚠ COSTS GAS — starkli will ask for your password"
DECLARE_LOG="$(mktemp)"
starkli declare "${RPC[@]}" \
  --account "${STARKNET_ACCOUNT}" \
  --keystore "${STARKNET_KEYSTORE}" \
  "${SIERRA}" 2>&1 | tee "${DECLARE_LOG}"

CLASS_HASH="$(grep -oE '0x[0-9a-fA-F]{60,64}' "${DECLARE_LOG}" | tail -1 || true)"
[[ -n "${CLASS_HASH}" ]] || CLASS_HASH="${CLASS_HASH_LOCAL}"
rm -f "${DECLARE_LOG}"
echo
bold "     class hash: ${CLASS_HASH}"

bold "4/6  Deploying an instance   ⚠ COSTS GAS — password again"
echo "     constructor arg: pool = ${POOL_ADDRESS}"
DEPLOY_LOG="$(mktemp)"
starkli deploy "${RPC[@]}" \
  --account "${STARKNET_ACCOUNT}" \
  --keystore "${STARKNET_KEYSTORE}" \
  "${CLASS_HASH}" \
  "${POOL_ADDRESS}" 2>&1 | tee "${DEPLOY_LOG}"

ESCROW="$(grep -oE '0x[0-9a-fA-F]{60,64}' "${DEPLOY_LOG}" | tail -1 || true)"
rm -f "${DEPLOY_LOG}"
[[ -n "${ESCROW}" ]] || die "Could not parse the deployed address. Copy it from the output above and set NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS by hand."
echo
bold "     escrow: ${ESCROW}"

# ─── verify (free, read-only) ────────────────────────────────────────────────
bold "5/6  Verifying the fresh instance"
OUTSTANDING="$(starkli call "${RPC[@]}" "${ESCROW}" get_outstanding "${STRK}" 2>/dev/null | tr -d '[]" \n' || echo "?")"
if [[ "${OUTSTANDING}" == "0x0" || "${OUTSTANDING}" == "0" ]]; then
  echo "     get_outstanding(STRK) = 0  ✓ owes nothing, as a fresh escrow must"
else
  warn "     get_outstanding(STRK) = ${OUTSTANDING}  — expected 0. Do NOT route value through this instance."
fi

# ─── wire it into the app ────────────────────────────────────────────────────
bold "6/6  Wiring the address into the app"
cd ..
touch .env.local
if grep -q '^NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS=' .env.local 2>/dev/null; then
  tmp="$(mktemp)"
  grep -v '^NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS=' .env.local > "${tmp}" && mv "${tmp}" .env.local
fi
echo "NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS=${ESCROW}" >> .env.local
echo "     .env.local updated"

node -e '
const fs = require("fs");
const escrow = process.argv[1], cls = process.argv[2];
const p = "strk20.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.contracts = j.contracts || [];
if (!j.contracts.some(c => (c.address || c) === escrow)) {
  j.contracts.push({ name: "LumenEscrow", address: escrow, class_hash: cls, network: "mainnet" });
}
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("     strk20.json updated");
' "${ESCROW}" "${CLASS_HASH}"

echo
bold "Done."
cat <<EOF

  Escrow      ${ESCROW}
  Class hash  ${CLASS_HASH}
  Explorer    https://voyager.online/contract/${ESCROW}

Next:
  1. Add the same variable to Vercel (Project → Settings → Environment
     Variables), then redeploy, so claim links go live in production:

       NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS=${ESCROW}

  2. Restart your local dev server so it picks up .env.local.
  3. Add money once, then mint a claim link with the 10 min window and
     reclaim it — that is your refund proof for the video.

EOF
