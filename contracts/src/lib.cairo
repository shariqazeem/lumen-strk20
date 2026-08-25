//! Lumen anonymizer contracts for the STRK20 privacy pool on Starknet.
//!
//! - `escrow` — `LumenEscrow`, the claim-link helper: send privately to someone
//!   with no wallet yet; they claim into their own note, with an optional
//!   expiry-gated refund path for the sender.
//! - `splitter` — `LumenSplitter`, the `privacy_invoke` helper that splits one
//!   input amount into N non-round open notes in a single atomic transaction.
//! - `mock_erc20` — a minimal ERC-20 used by the test suite only. Never deployed.
//!
//! DRAFT. Anonymizer contracts are the app team's code to review and audit; this
//! package has not been audited.

pub mod escrow;
pub mod mock_erc20;
pub mod splitter;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_escrow;
