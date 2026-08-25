//! LumenSplitter — a STRK20 anonymizer (helper) contract that turns one input
//! amount into N non-round output notes inside a single atomic pool transaction.
//!
//! ## Why it exists
//!
//! Lumen's thesis is that behaviour, not cryptography, deanonymizes privacy-pool
//! users. The two strongest behavioural remedies are **amount entropy** (never emit
//! a round or repeated amount) and **note-count management**. Splitting one balance
//! into several unequal notes is the primitive both remedies need.
//!
//! Without a helper, an entropic split of an amount whose value is only known at
//! *execution* time is impossible: the client must fix every note amount at proof
//! time. This contract does the split on-chain, from a caller-supplied plan, and
//! credits every leg into its own open note in the same transaction — one pool
//! operation, one fee, no timing trail between the legs.
//!
//! ## The sandwich (see references/helpers__privacy-invoke.md)
//!
//! ```text
//! pool Withdraw(amount -> splitter)      phase 6
//! pool CreateOpenNote x N                phase 5   (`transfer` with amount "OPEN")
//! pool InvokeExternal(splitter)          phase 7   -> privacy_invoke
//!      splitter approves the pool for the sum it is about to promise
//!      splitter returns Span<OpenNoteDeposit>, one entry per open note
//! pool pulls the tokens back and fills each open note
//! ```
//!
//! The helper never transfers to the pool: it approves, and the pool pulls. A revert
//! anywhere aborts the whole pool transaction and no funds move.
//!
//! ## Trust model
//!
//! Stateless — the contract keeps no user state, and in the normal path the pool
//! pulls back everything it delivered inside the same transaction. It is
//! nevertheless **pool-gated**: `privacy_invoke` asserts the caller is the pool
//! address pinned at deployment, so nobody can drive it directly, drain a
//! mid-transaction balance, or grant themselves an allowance.
//!
//! `Exact` mode distributes only the declared `in_amount`, so a balance delivered
//! above that is left behind. It is not lost — the next caller sweeps it, and
//! `Bps` mode always splits the whole measured balance — but this contract is a
//! conduit, never a vault.
//!
//! DRAFT — team review and audit required before any mainnet deploy. An anonymizer
//! is the app team's code to own; run the `cairo-security` skill over it first.

use starknet::ContractAddress;

/// Mirror of `privacy::objects::OpenNoteDeposit`.
///
/// The pool deserializes this contract's return value as `Span<OpenNoteDeposit>`,
/// so the field order here is load-bearing: it must stay byte-identical to the
/// pool's own definition. Declared locally rather than imported so the package
/// builds standalone, exactly as the STRK20 starter kit does.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    /// The identifier of the open note to deposit to.
    pub note_id: felt252,
    /// The ERC-20 token contract to deposit.
    pub token: ContractAddress,
    /// The amount of tokens to deposit.
    pub amount: u128,
}

/// How the caller's `parts` are interpreted.
///
/// Serialized as its variant index, so it occupies exactly one felt of calldata:
/// `0` = `Exact`, `1` = `Bps`.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum SplitMode {
    /// `parts` are absolute token amounts. They must sum to exactly
    /// `in_amount - fee_amount`. Use this when the planner already knows the input
    /// amount (the normal Lumen case: the input is the pool's own Withdraw leg)
    /// and wants byte-exact control over every emitted amount.
    Exact,
    /// `parts` are basis points summing to exactly 10_000. The amounts are derived
    /// on-chain from the balance actually delivered to this contract, and the last
    /// leg absorbs the rounding remainder so the outputs still sum exactly.
    /// Use this when the input amount is only known at execution time.
    Bps,
}

/// Upper bound on output notes per call.
///
/// Every extra leg costs a `CreateOpenNote` action, a slot in the proof, and a
/// token pull. Sixteen is well past the point where added amount entropy stops
/// buying anonymity and starts costing note-count hygiene — the fragmentation
/// Lumen's engine otherwise spends effort undoing.
pub const MAX_SPLITS: u32 = 16;

/// Basis-point denominator: 10_000 bps = 100%.
pub const BPS_DENOMINATOR: u128 = 10_000;

pub mod errors {
    pub const ZERO_POOL_ADDRESS: felt252 = 'ZERO_POOL_ADDRESS';
    pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
    pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
    pub const ZERO_IN_AMOUNT: felt252 = 'ZERO_IN_AMOUNT';
    pub const EMPTY_SPLIT: felt252 = 'EMPTY_SPLIT';
    pub const TOO_MANY_SPLITS: felt252 = 'TOO_MANY_SPLITS';
    pub const LENGTH_MISMATCH: felt252 = 'LENGTH_MISMATCH';
    pub const ZERO_PART: felt252 = 'ZERO_PART';
    pub const ZERO_NOTE_ID: felt252 = 'ZERO_NOTE_ID';
    pub const DUPLICATE_NOTE_ID: felt252 = 'DUPLICATE_NOTE_ID';
    pub const SPLIT_SUM_MISMATCH: felt252 = 'SPLIT_SUM_MISMATCH';
    pub const BPS_SUM_MISMATCH: felt252 = 'BPS_SUM_MISMATCH';
    pub const INSUFFICIENT_BALANCE: felt252 = 'INSUFFICIENT_BALANCE';
    pub const FEE_EXCEEDS_INPUT: felt252 = 'FEE_EXCEEDS_INPUT';
    pub const FEE_ABOVE_CAP: felt252 = 'FEE_ABOVE_CAP';
    pub const FEE_RECIPIENT_UNSET: felt252 = 'FEE_RECIPIENT_UNSET';
    pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
    pub const SUM_OVERFLOW: felt252 = 'SUM_OVERFLOW';
}

/// Minimal ERC-20 surface. Declared locally to keep the package dependency-free
/// and auditable; only the three entry points this helper actually calls.
#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait ILumenSplitter<T> {
    /// Called by the privacy pool via the protocol's `INVOKE_SELECTOR`.
    ///
    /// Calldata is deserialized straight into these parameters, so the order is
    /// load-bearing and must match the dapp's `invoke` action exactly:
    ///
    /// ```text
    /// [ mode, token, in_amount, fee_amount,
    ///   parts_len,    part_0    ... part_n-1,
    ///   note_ids_len, note_id_0 ... note_id_n-1 ]
    /// ```
    ///
    /// - `mode` — `0` = `Exact` (parts are amounts), `1` = `Bps` (parts are basis
    ///   points over the delivered balance).
    /// - `token` — the ERC-20 being split. Input and every output are the same token.
    /// - `in_amount` — in `Exact`, the exact amount the pool withdrew here; in
    ///   `Bps`, a minimum-delivered floor (`0` disables the floor).
    /// - `fee_amount` — declared fee paid out to the pinned fee recipient before
    ///   splitting. `0` for a fee-free route. Excluded from the sum invariant.
    /// - `parts` — the caller's split plan. Never generated on-chain: Cairo has no
    ///   good randomness and the planner's entropy must be reproducible.
    /// - `note_ids` — the open notes to credit, in the same order as `parts`. These
    ///   are the `${openNoteIds[i]}` placeholders the wallet substitutes.
    ///
    /// Returns one `OpenNoteDeposit` per leg. Guarantees, all asserted on-chain:
    /// the returned amounts sum to exactly `total_in - fee_amount`, every amount is
    /// non-zero, every note id is distinct, and the pool is approved for exactly
    /// the sum being promised.
    fn privacy_invoke(
        ref self: T,
        mode: SplitMode,
        token: ContractAddress,
        in_amount: u128,
        fee_amount: u128,
        parts: Span<u128>,
        note_ids: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;

    /// The privacy pool pinned at deployment. The only permitted caller.
    fn pool_address(self: @T) -> ContractAddress;
    /// Where a declared fee is sent. Zero means fees are disabled on this instance.
    fn fee_recipient(self: @T) -> ContractAddress;
    /// Hard cap on a declared fee, in basis points of the input.
    fn max_fee_bps(self: @T) -> u16;
    /// Maximum number of output notes per call.
    fn max_splits(self: @T) -> u32;
    /// Off-chain planning aid: the exact amounts `Bps` mode would emit for `total`.
    /// Lets the dapp preview on-chain rounding without simulating a transaction.
    fn preview_bps_split(self: @T, total: u128, parts: Span<u128>) -> Span<u128>;
}

/// Splits `total` across basis-point weights, giving the rounding remainder to the
/// last leg so the results sum to `total` exactly.
///
/// Free function rather than a contract method: it is pure, it is the part most
/// worth reasoning about, and tests exercise it without deploying anything.
pub fn compute_bps_amounts(total: u128, parts: Span<u128>) -> Array<u128> {
    let n = parts.len();
    assert(n != 0, errors::EMPTY_SPLIT);
    assert(n <= MAX_SPLITS, errors::TOO_MANY_SPLITS);
    assert(total != 0, errors::ZERO_IN_AMOUNT);

    // Pass 1 — the weights must describe exactly 100%. Checked before any amount is
    // derived, so a malformed plan can never produce a partially-assigned split.
    let mut sum_bps: u128 = 0;
    for i in 0..n {
        let weight = *parts[i];
        assert(weight != 0, errors::ZERO_PART);
        // u128 addition panics on overflow, so sum_bps cannot wrap past 10_000.
        sum_bps += weight;
    }
    assert(sum_bps == BPS_DENOMINATOR, errors::BPS_SUM_MISMATCH);

    // Pass 2 — floor each leg in u256 (total * weight can exceed u128), and let the
    // final leg absorb whatever the floors left behind.
    let mut amounts: Array<u128> = array![];
    let mut assigned: u128 = 0;
    for i in 0..n {
        let amount = if i == n - 1 {
            total - assigned
        } else {
            let product: u256 = total.into() * (*parts[i]).into();
            (product / BPS_DENOMINATOR.into()).try_into().expect(errors::AMOUNT_OVERFLOW)
        };
        // A weight that floors to nothing would create a worthless note and leak a
        // "dust leg" fingerprint. Reject the plan instead.
        assert(amount != 0, errors::ZERO_PART);
        assigned += amount;
        amounts.append(amount);
    }

    // The invariant, restated over the derived amounts.
    assert(assigned == total, errors::SPLIT_SUM_MISMATCH);
    amounts
}

/// Rejects a plan that names the same open note twice. Without this, a planner bug
/// that repeats `${openNoteIds[0]}` would silently double-credit one note and leave
/// another unfilled. O(n^2) over at most `MAX_SPLITS` entries.
pub fn assert_distinct_note_ids(note_ids: Span<felt252>) {
    let n = note_ids.len();
    for i in 0..n {
        assert(*note_ids[i] != 0, errors::ZERO_NOTE_ID);
        for j in (i + 1)..n {
            assert(*note_ids[i] != *note_ids[j], errors::DUPLICATE_NOTE_ID);
        }
    }
}

#[starknet::contract]
pub mod LumenSplitter {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        BPS_DENOMINATOR, ILumenSplitter, IErc20Dispatcher, IErc20DispatcherTrait, MAX_SPLITS,
        OpenNoteDeposit, SplitMode, assert_distinct_note_ids, compute_bps_amounts, errors,
    };

    #[storage]
    struct Storage {
        /// Pinned at deployment: a deployed helper is a fixed, auditable route.
        pool: ContractAddress,
        /// Zero disables fees entirely on this instance.
        fee_recipient: ContractAddress,
        /// Ceiling on any declared fee, so a malformed plan cannot route the input
        /// out as "fee" instead of into the user's notes.
        max_fee_bps: u16,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Split: Split,
    }

    /// Emitted once per successful split. Carries nothing that is not already
    /// public: open-note amounts are plaintext by design, and the note owner is
    /// never known to this contract.
    #[derive(Drop, starknet::Event)]
    pub struct Split {
        #[key]
        pub token: ContractAddress,
        pub total_in: u128,
        pub fee_amount: u128,
        pub legs: u32,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        fee_recipient: ContractAddress,
        max_fee_bps: u16,
    ) {
        assert(pool.is_non_zero(), errors::ZERO_POOL_ADDRESS);
        assert(max_fee_bps.into() <= BPS_DENOMINATOR, errors::FEE_ABOVE_CAP);
        self.pool.write(pool);
        self.fee_recipient.write(fee_recipient);
        self.max_fee_bps.write(max_fee_bps);
    }

    #[abi(embed_v0)]
    pub impl LumenSplitterImpl of ILumenSplitter<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            mode: SplitMode,
            token: ContractAddress,
            in_amount: u128,
            fee_amount: u128,
            parts: Span<u128>,
            note_ids: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            // 1. Access control. Only the pool may drive this contract. Anything it
            //    holds mid-transaction belongs to the pool transaction in flight.
            let pool = self.pool.read();
            assert(get_caller_address() == pool, errors::CALLER_NOT_POOL);

            // 2. Shape of the plan.
            assert(token.is_non_zero(), errors::ZERO_TOKEN);
            let legs = parts.len();
            assert(legs != 0, errors::EMPTY_SPLIT);
            assert(legs <= MAX_SPLITS, errors::TOO_MANY_SPLITS);
            assert(note_ids.len() == legs, errors::LENGTH_MISMATCH);
            assert_distinct_note_ids(note_ids);

            // 3. Measure what actually arrived. The balance-delta idiom: this helper
            //    is stateless and holds nothing between transactions, so its whole
            //    balance is the delta produced by the pool's Withdraw leg earlier in
            //    this same transaction. Never trust the declared number alone.
            let erc20 = IErc20Dispatcher { contract_address: token };
            let held: u128 = erc20
                .balance_of(get_contract_address())
                .try_into()
                .expect(errors::AMOUNT_OVERFLOW);

            let total_in = match mode {
                SplitMode::Exact => {
                    assert(in_amount != 0, errors::ZERO_IN_AMOUNT);
                    assert(held >= in_amount, errors::INSUFFICIENT_BALANCE);
                    in_amount
                },
                SplitMode::Bps => {
                    assert(held != 0, errors::ZERO_IN_AMOUNT);
                    // In Bps mode `in_amount` is a floor, not the total: it lets the
                    // planner refuse a split over less than it expected. Zero opts out.
                    assert(held >= in_amount, errors::INSUFFICIENT_BALANCE);
                    held
                },
            };

            // 4. Declared fee, capped and paid out before the split is computed.
            assert(fee_amount < total_in, errors::FEE_EXCEEDS_INPUT);
            let distributable = total_in - fee_amount;
            if fee_amount != 0 {
                let recipient = self.fee_recipient.read();
                assert(recipient.is_non_zero(), errors::FEE_RECIPIENT_UNSET);
                // fee/total <= cap/10_000, cross-multiplied in u256 so neither side
                // can overflow.
                let claimed: u256 = fee_amount.into() * BPS_DENOMINATOR.into();
                let allowed: u256 = total_in.into() * self.max_fee_bps.read().into();
                assert(claimed <= allowed, errors::FEE_ABOVE_CAP);
                erc20.transfer(recipient, fee_amount.into());
            }

            // 5. Resolve the plan into concrete amounts.
            let amounts = match mode {
                SplitMode::Exact => {
                    // Summed in u256 so a crafted plan cannot wrap u128 into a false
                    // reconciliation.
                    let mut declared: u256 = 0;
                    for i in 0..legs {
                        let part = *parts[i];
                        assert(part != 0, errors::ZERO_PART);
                        declared += part.into();
                    }
                    let declared: u128 = declared.try_into().expect(errors::SUM_OVERFLOW);
                    assert(declared == distributable, errors::SPLIT_SUM_MISMATCH);
                    parts
                },
                SplitMode::Bps => compute_bps_amounts(distributable, parts).span(),
            };

            // 6. Build the deposits, re-deriving the sum from what is actually being
            //    returned rather than from what was checked above. A helper that
            //    silently loses value is a critical bug; this is the last gate.
            let mut deposits: Array<OpenNoteDeposit> = array![];
            let mut credited: u128 = 0;
            for i in 0..legs {
                let amount = *amounts[i];
                credited += amount;
                deposits.append(OpenNoteDeposit { note_id: *note_ids[i], token, amount });
            }
            assert(credited == distributable, errors::SPLIT_SUM_MISMATCH);
            // Never promise the pool more than this contract can actually hand over.
            assert(credited + fee_amount <= held, errors::INSUFFICIENT_BALANCE);

            // 7. Approve, don't transfer: the pool pulls each deposit itself when it
            //    applies them. One allowance covers all legs, since every leg is the
            //    same token, and it is set to exactly what was promised.
            erc20.approve(pool, credited.into());

            self.emit(Split { token, total_in, fee_amount, legs });
            deposits.span()
        }

        fn pool_address(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn fee_recipient(self: @ContractState) -> ContractAddress {
            self.fee_recipient.read()
        }

        fn max_fee_bps(self: @ContractState) -> u16 {
            self.max_fee_bps.read()
        }

        fn max_splits(self: @ContractState) -> u32 {
            MAX_SPLITS
        }

        fn preview_bps_split(self: @ContractState, total: u128, parts: Span<u128>) -> Span<u128> {
            compute_bps_amounts(total, parts).span()
        }
    }
}
