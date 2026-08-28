//! Lumen anonymizer contracts for the STRK20 privacy pool on Starknet.
//!
//! - `escrow` — `LumenEscrow`, the claim-link helper: send privately to someone
//!   with no wallet yet; they claim into their own note, with an optional
//!   expiry-gated refund path for the sender.
//! - `splitter` — `LumenSplitter`, the `privacy_invoke` helper that splits one
//!   input amount into N non-round open notes in a single atomic transaction.
//! - `vault` — `LumenVault`, the `privacy_invoke` helper that stakes shielded
//!   strkBTC into an ERC-4626 vault without ever unshielding it.
//! - `mock_erc20`, `mock_vault` — minimal stand-ins used by the test suite only.
//!   Never deployed.
//!
//! DRAFT. Anonymizer contracts are the app team's code to review and audit; this
//! package has not been audited.

pub mod escrow;
pub mod mock_erc20;
pub mod mock_vault;
pub mod splitter;
pub mod vault;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_escrow;
#[cfg(test)]
mod tests_vault;
