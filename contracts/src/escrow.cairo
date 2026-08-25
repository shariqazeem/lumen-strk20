//! LumenEscrow — the claim-link anonymizer. Send privately to someone who has
//! no wallet yet; they claim into their own private note when they arrive.
//!
//! ## Why it exists
//!
//! A private transfer needs a registered recipient, and that requirement kills
//! the most human payment of all: paying someone who has never touched any of
//! this. LumenEscrow parks value behind a secret instead. The sender's wallet
//! funds it through the pool (no public sender), the link carries the secret
//! off-chain, and the recipient's brand-new wallet claims straight into an
//! open note (no public recipient). The chain sees a pool→escrow deposit and
//! an escrow→pool claim, connected only by a hash nobody can invert.
//!
//! ## The two sandwiches
//!
//! ```text
//! FUND   pool Withdraw(amount → escrow)            public: escrow got `amount`
//!        pool InvokeExternal(escrow, Deposit)      stores commitment, empty span
//!
//! CLAIM  pool CreateOpenNote                        (`transfer` with amount "OPEN")
//!        pool InvokeExternal(escrow, Claim(secret)) escrow approves the pool,
//!                                                   returns [OpenNoteDeposit],
//!                                                   pool pulls and credits note
//! ```
//!
//! ## Beyond the by-example escrow
//!
//! This extends the unofficial strk20-by-example escrow pattern with what a
//! product actually needs:
//!
//! - **Refunds.** A deposit may carry a second, domain-separated commitment
//!   and an expiry. After expiry the sender (holding the refund secret) can
//!   pull the value back through the same open-note flow. Lost links stop
//!   being lost money. Claims stay valid after expiry until a refund actually
//!   happens — a late claimer beats an idle sender.
//! - **Solvency accounting.** The contract tracks outstanding liabilities per
//!   token and refuses any deposit the delivered balance does not fully back,
//!   so a mis-built action list can never mint an unbacked claim.
//! - **Distinct hash domains.** Claim and refund secrets hash under different
//!   tags; neither preimage is usable on the other path.
//!
//! ## Trust model
//!
//! Stateful, therefore strictly pool-gated: `privacy_invoke` asserts the
//! caller is the pool pinned at deployment. Value only ever leaves by pool
//! pull following an approve, and every path that approves flips `claimed`
//! first in the same transaction (a revert rolls both back together).
//!
//! DRAFT — team review and audit required before any mainnet deploy. An
//! anonymizer is the app team's code to own.

use starknet::ContractAddress;
use crate::splitter::OpenNoteDeposit;

/// One escrowed payment, keyed by its claim commitment.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct EscrowEntry {
    pub token: ContractAddress,
    pub amount: u128,
    /// `poseidon(REFUND_TAG, refund_secret)`, or 0 when the sender declined a
    /// refund path.
    pub refund_commitment: felt252,
    /// Seconds since epoch after which the refund path opens. 0 iff
    /// `refund_commitment` is 0.
    pub expiry: u64,
    pub claimed: bool,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum EscrowOperation {
    Deposit,
    Claim,
    Refund,
}

/// Domain-separation tags. Two domains, so a refund secret can never be spent
/// on the claim path or vice versa.
pub const CLAIM_TAG: felt252 = 'LUMEN_ESCROW_CLAIM:V1';
pub const REFUND_TAG: felt252 = 'LUMEN_ESCROW_REFUND:V1';

pub fn compute_claim_commitment(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([CLAIM_TAG, secret].span())
}

pub fn compute_refund_commitment(secret: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([REFUND_TAG, secret].span())
}

pub mod errors {
    pub const CALLER_NOT_PRIVACY: felt252 = 'CALLER_NOT_PRIVACY';
    pub const ZERO_COMMITMENT: felt252 = 'ZERO_COMMITMENT';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const COMMITMENT_EXISTS: felt252 = 'COMMITMENT_EXISTS';
    pub const REFUND_WITHOUT_EXPIRY: felt252 = 'REFUND_WITHOUT_EXPIRY';
    pub const EXPIRY_WITHOUT_REFUND: felt252 = 'EXPIRY_WITHOUT_REFUND';
    pub const EXPIRY_IN_PAST: felt252 = 'EXPIRY_IN_PAST';
    pub const INSUFFICIENT_BACKING: felt252 = 'INSUFFICIENT_BACKING';
    pub const COMMITMENT_NOT_FOUND: felt252 = 'COMMITMENT_NOT_FOUND';
    pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
    pub const NOT_EXPIRED: felt252 = 'NOT_EXPIRED';
}

#[starknet::interface]
pub trait ILumenEscrow<T> {
    /// The entry behind a claim commitment. All-zero when it does not exist.
    fn get_entry(self: @T, claim_commitment: felt252) -> EscrowEntry;

    /// Total escrowed-and-unclaimed value per token — the contract's
    /// liabilities, which its balance must always cover.
    fn get_outstanding(self: @T, token: ContractAddress) -> u128;

    /// Called by the privacy pool via the protocol's `INVOKE_SELECTOR`. The
    /// pool deserializes calldata straight into these parameters, so the order
    /// is load-bearing.
    ///
    /// **Deposit** uses `claim_commitment`, `refund_commitment`, `expiry`,
    /// `token`, `amount`; ignores `secret` and `note_id`; returns an empty
    /// span (value stays parked here).
    ///
    /// **Claim** uses `secret` (claim preimage) and `note_id`; ignores the
    /// rest; approves the pool and returns the one-entry deposit span.
    ///
    /// **Refund** uses `secret` (refund preimage) and `note_id`; only valid
    /// once `expiry` has passed and the entry is unclaimed.
    fn privacy_invoke(
        ref self: T,
        operation: EscrowOperation,
        claim_commitment: felt252,
        refund_commitment: felt252,
        expiry: u64,
        token: ContractAddress,
        amount: u128,
        secret: felt252,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod LumenEscrow {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use crate::splitter::{IErc20Dispatcher, IErc20DispatcherTrait, OpenNoteDeposit};
    use super::{
        EscrowEntry, EscrowOperation, ILumenEscrow, compute_claim_commitment,
        compute_refund_commitment, errors,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
        /// claim commitment → entry.
        entries: Map<felt252, EscrowEntry>,
        /// refund commitment → claim commitment, so a refund secret can find
        /// its entry without the claim secret.
        refund_index: Map<felt252, felt252>,
        /// token → unclaimed liabilities. The balance must always cover this.
        outstanding: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Deposited: Deposited,
        Claimed: Claimed,
        Refunded: Refunded,
    }

    /// Emitted per escrow. Deliberately carries no more than the chain already
    /// shows: the commitment, the token, the public escrow amount, the expiry.
    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub claim_commitment: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub expiry: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub claim_commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Refunded {
        #[key]
        pub claim_commitment: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), errors::ZERO_TOKEN);
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    pub impl LumenEscrowImpl of ILumenEscrow<ContractState> {
        fn get_entry(self: @ContractState, claim_commitment: felt252) -> EscrowEntry {
            self.entries.read(claim_commitment)
        }

        fn get_outstanding(self: @ContractState, token: ContractAddress) -> u128 {
            self.outstanding.read(token)
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: EscrowOperation,
            claim_commitment: felt252,
            refund_commitment: felt252,
            expiry: u64,
            token: ContractAddress,
            amount: u128,
            secret: felt252,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_PRIVACY);

            match operation {
                EscrowOperation::Deposit => {
                    self.deposit(claim_commitment, refund_commitment, expiry, token, amount);
                    [].span()
                },
                EscrowOperation::Claim => {
                    let commitment = compute_claim_commitment(secret);
                    let entry = self.take_entry(commitment);
                    self.approve_pool(pool, entry);
                    self.emit(Claimed { claim_commitment: commitment });
                    [OpenNoteDeposit { note_id, token: entry.token, amount: entry.amount }].span()
                },
                EscrowOperation::Refund => {
                    let commitment = self.refund_index.read(compute_refund_commitment(secret));
                    assert(commitment.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
                    let probe = self.entries.read(commitment);
                    assert(
                        probe.expiry.is_non_zero() && get_block_timestamp() >= probe.expiry,
                        errors::NOT_EXPIRED,
                    );
                    let entry = self.take_entry(commitment);
                    self.approve_pool(pool, entry);
                    self.emit(Refunded { claim_commitment: commitment });
                    [OpenNoteDeposit { note_id, token: entry.token, amount: entry.amount }].span()
                },
            }
        }
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        fn deposit(
            ref self: ContractState,
            claim_commitment: felt252,
            refund_commitment: felt252,
            expiry: u64,
            token: ContractAddress,
            amount: u128,
        ) {
            assert(claim_commitment.is_non_zero(), errors::ZERO_COMMITMENT);
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);
            assert(self.entries.read(claim_commitment).token.is_zero(), errors::COMMITMENT_EXISTS);

            // A refund path is all-or-nothing: commitment and future expiry
            // together, or neither.
            if refund_commitment.is_non_zero() {
                assert(expiry.is_non_zero(), errors::REFUND_WITHOUT_EXPIRY);
                assert(expiry > get_block_timestamp(), errors::EXPIRY_IN_PAST);
                assert(
                    self.refund_index.read(refund_commitment).is_zero(),
                    errors::COMMITMENT_EXISTS,
                );
                self.refund_index.write(refund_commitment, claim_commitment);
            } else {
                assert(expiry.is_zero(), errors::EXPIRY_WITHOUT_REFUND);
            }

            // Solvency: the pool's Withdraw leg must have delivered enough to
            // back this entry on top of everything still owed in this token.
            let owed = self.outstanding.read(token) + amount;
            let held = IErc20Dispatcher { contract_address: token }
                .balance_of(starknet::get_contract_address());
            assert(held >= owed.into(), errors::INSUFFICIENT_BACKING);
            self.outstanding.write(token, owed);

            self
                .entries
                .write(
                    claim_commitment,
                    EscrowEntry { token, amount, refund_commitment, expiry, claimed: false },
                );
            self.emit(Deposited { claim_commitment, token, amount, expiry });
        }

        /// Load an entry, assert it is live, and flip it to claimed. Both exit
        /// paths (claim, refund) settle liabilities here, and a revert later in
        /// the same transaction rolls all of it back.
        fn take_entry(ref self: ContractState, claim_commitment: felt252) -> EscrowEntry {
            let entry = self.entries.read(claim_commitment);
            assert(entry.token.is_non_zero(), errors::COMMITMENT_NOT_FOUND);
            assert(!entry.claimed, errors::ALREADY_CLAIMED);
            self.entries.write(claim_commitment, EscrowEntry { claimed: true, ..entry });
            self.outstanding.write(entry.token, self.outstanding.read(entry.token) - entry.amount);
            entry
        }

        fn approve_pool(ref self: ContractState, pool: ContractAddress, entry: EscrowEntry) {
            IErc20Dispatcher { contract_address: entry.token }
                .approve(pool, entry.amount.into());
        }
    }
}
