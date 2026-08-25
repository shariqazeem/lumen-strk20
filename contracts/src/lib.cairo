//! Lumen anonymizer contracts for the STRK20 privacy pool on Starknet.
//!
//! - `splitter` — `LumenSplitter`, the `privacy_invoke` helper that splits one
//!   input amount into N non-round open notes in a single atomic transaction.
//! - `mock_erc20` — a minimal ERC-20 used by the test suite only. Never deployed.
//!
//! DRAFT. Anonymizer contracts are the app team's code to review and audit; this
//! package has not been audited.

pub mod mock_erc20;
pub mod splitter;

#[cfg(test)]
mod tests;
