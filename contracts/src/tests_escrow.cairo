//! Test suite for `LumenEscrow`.
//!
//! The pool is simulated the way it actually behaves: its Withdraw leg funds
//! the escrow first (a mint in the mock), then it calls `privacy_invoke` as
//! the caller. Every exit path asserts three things together: the entry flips
//! to claimed, the pool's allowance equals exactly the escrowed amount, and
//! the per-token liability ledger shrinks by the same amount — value in equals
//! value promised equals value out.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_block_timestamp, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::escrow::{
    EscrowLeg, EscrowOperation, ILumenEscrowDispatcher, ILumenEscrowDispatcherTrait,
    compute_claim_commitment, compute_refund_commitment,
};
use crate::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};

const POOL: felt252 = 'POOL';
const ATTACKER: felt252 = 'ATTACKER';

const CLAIM_SECRET: felt252 = 'a-strong-claim-secret';
const REFUND_SECRET: felt252 = 'a-strong-refund-secret';
const OTHER_SECRET: felt252 = 'someone-elses-secret';
const NOTE: felt252 = 'NOTE_1';
const NOTE_2: felt252 = 'NOTE_2';

/// Deliberately non-round, the way the guard tunes real escrows.
const AMOUNT: u128 = 149_884_201_337_004_991;
const AMOUNT_2: u128 = 88_412_009_115_662_101;

const T0: u64 = 1_756_000_000;
const EXPIRY: u64 = 1_756_600_000;

fn pool() -> ContractAddress {
    POOL.try_into().unwrap()
}

fn attacker() -> ContractAddress {
    ATTACKER.try_into().unwrap()
}

fn deploy_token() -> IMockErc20Dispatcher {
    let contract = declare("MockErc20").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    IMockErc20Dispatcher { contract_address: address }
}

fn deploy_escrow() -> ILumenEscrowDispatcher {
    let contract = declare("LumenEscrow").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![POOL]).unwrap();
    ILumenEscrowDispatcher { contract_address: address }
}

/// Fund the escrow the way the pool's Withdraw leg does, then run a Deposit
/// with a refund path as the pool.
fn fund_and_deposit(
    escrow: ILumenEscrowDispatcher, token: IMockErc20Dispatcher, amount: u128,
    claim_secret: felt252, refund_secret: felt252, expiry: u64,
) {
    token.mint(escrow.contract_address, amount.into());
    let refund_commitment = if refund_secret == 0 {
        0
    } else {
        compute_refund_commitment(refund_secret)
    };
    start_cheat_caller_address(escrow.contract_address, pool());
    escrow
        .privacy_invoke(
            EscrowOperation::Deposit,
            compute_claim_commitment(claim_secret),
            refund_commitment,
            expiry,
            token.contract_address,
            amount,
            0,
            0, [].span(),
        );
    stop_cheat_caller_address(escrow.contract_address);
}

fn claim(
    escrow: ILumenEscrowDispatcher, token: IMockErc20Dispatcher, secret: felt252, note: felt252,
) -> Span<crate::splitter::OpenNoteDeposit> {
    start_cheat_caller_address(escrow.contract_address, pool());
    let deposits = escrow
        .privacy_invoke(
            EscrowOperation::Claim, 0, 0, 0, token.contract_address, 0, secret, note, [].span(),
        );
    stop_cheat_caller_address(escrow.contract_address);
    deposits
}

fn refund(
    escrow: ILumenEscrowDispatcher, token: IMockErc20Dispatcher, secret: felt252, note: felt252,
) -> Span<crate::splitter::OpenNoteDeposit> {
    start_cheat_caller_address(escrow.contract_address, pool());
    let deposits = escrow
        .privacy_invoke(
            EscrowOperation::Refund, 0, 0, 0, token.contract_address, 0, secret, note, [].span(),
        );
    stop_cheat_caller_address(escrow.contract_address);
    deposits
}

// ------------------------------------------------------------------
// access control
// ------------------------------------------------------------------

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn test_only_pool_may_invoke() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    start_cheat_caller_address(escrow.contract_address, attacker());
    escrow
        .privacy_invoke(
            EscrowOperation::Deposit,
            compute_claim_commitment(CLAIM_SECRET),
            0,
            0,
            token.contract_address,
            AMOUNT,
            0,
            0, [].span(),
        );
}

// ------------------------------------------------------------------
// deposit
// ------------------------------------------------------------------

#[test]
fn test_deposit_stores_entry_and_liability() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);

    let entry = escrow.get_entry(compute_claim_commitment(CLAIM_SECRET));
    assert(entry.token == token.contract_address, 'wrong token');
    assert(entry.amount == AMOUNT, 'wrong amount');
    assert(entry.refund_commitment == compute_refund_commitment(REFUND_SECRET), 'wrong refund');
    assert(entry.expiry == EXPIRY, 'wrong expiry');
    assert(!entry.claimed, 'must start unclaimed');
    assert(escrow.get_outstanding(token.contract_address) == AMOUNT, 'wrong outstanding');
}

#[test]
fn test_deposit_without_refund_path() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, 0);

    let entry = escrow.get_entry(compute_claim_commitment(CLAIM_SECRET));
    assert(entry.refund_commitment == 0, 'refund must be zero');
    assert(entry.expiry == 0, 'expiry must be zero');
}

#[test]
#[should_panic(expected: 'INSUFFICIENT_BACKING')]
fn test_unbacked_deposit_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    // No mint: the pool never delivered the value this entry promises.
    start_cheat_caller_address(escrow.contract_address, pool());
    escrow
        .privacy_invoke(
            EscrowOperation::Deposit,
            compute_claim_commitment(CLAIM_SECRET),
            0,
            0,
            token.contract_address,
            AMOUNT,
            0,
            0, [].span(),
        );
}

#[test]
#[should_panic(expected: 'INSUFFICIENT_BACKING')]
fn test_backing_cannot_be_double_counted() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, 0);
    // Second entry against the same delivered balance must fail.
    start_cheat_caller_address(escrow.contract_address, pool());
    escrow
        .privacy_invoke(
            EscrowOperation::Deposit,
            compute_claim_commitment(OTHER_SECRET),
            0,
            0,
            token.contract_address,
            AMOUNT,
            0,
            0, [].span(),
        );
}

#[test]
#[should_panic(expected: 'COMMITMENT_EXISTS')]
fn test_duplicate_commitment_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, 0);
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, 0);
}

#[test]
#[should_panic(expected: 'REFUND_WITHOUT_EXPIRY')]
fn test_refund_commitment_requires_expiry() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, 0);
}

#[test]
#[should_panic(expected: 'EXPIRY_WITHOUT_REFUND')]
fn test_expiry_requires_refund_commitment() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, EXPIRY);
}

#[test]
#[should_panic(expected: 'EXPIRY_IN_PAST')]
fn test_expiry_must_be_in_the_future() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    start_cheat_block_timestamp(escrow.contract_address, EXPIRY + 1);
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);
}

#[test]
#[should_panic(expected: 'ZERO_AMOUNT')]
fn test_zero_amount_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, 0, CLAIM_SECRET, 0, 0);
}

// ------------------------------------------------------------------
// claim
// ------------------------------------------------------------------

#[test]
fn test_claim_approves_pool_and_returns_note() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);

    let deposits = claim(escrow, token, CLAIM_SECRET, NOTE);

    assert(deposits.len() == 1, 'one deposit expected');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == NOTE, 'wrong note');
    assert(deposit.token == token.contract_address, 'wrong token');
    assert(deposit.amount == AMOUNT, 'wrong amount');

    assert(
        token.allowance(escrow.contract_address, pool()) == AMOUNT.into(),
        'pool must be approved',
    );
    assert(escrow.get_entry(compute_claim_commitment(CLAIM_SECRET)).claimed, 'must be claimed');
    assert(escrow.get_outstanding(token.contract_address) == 0, 'liability must clear');
}

#[test]
fn test_claim_still_valid_after_expiry() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);
    start_cheat_block_timestamp(escrow.contract_address, EXPIRY + 1_000);
    let deposits = claim(escrow, token, CLAIM_SECRET, NOTE);
    stop_cheat_block_timestamp(escrow.contract_address);
    assert(deposits.len() == 1, 'late claim must work');
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn test_claim_with_wrong_secret_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, 0);
    claim(escrow, token, OTHER_SECRET, NOTE);
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn test_refund_secret_unusable_on_claim_path() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);
    claim(escrow, token, REFUND_SECRET, NOTE);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn test_double_claim_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, 0);
    claim(escrow, token, CLAIM_SECRET, NOTE);
    claim(escrow, token, CLAIM_SECRET, NOTE_2);
}

// ------------------------------------------------------------------
// refund
// ------------------------------------------------------------------

#[test]
fn test_refund_after_expiry() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    start_cheat_block_timestamp(escrow.contract_address, T0);
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);
    start_cheat_block_timestamp(escrow.contract_address, EXPIRY);

    let deposits = refund(escrow, token, REFUND_SECRET, NOTE);
    stop_cheat_block_timestamp(escrow.contract_address);

    assert(deposits.len() == 1, 'one deposit expected');
    assert((*deposits.at(0)).amount == AMOUNT, 'wrong amount');
    assert(
        token.allowance(escrow.contract_address, pool()) == AMOUNT.into(),
        'pool must be approved',
    );
    assert(escrow.get_outstanding(token.contract_address) == 0, 'liability must clear');
}

#[test]
#[should_panic(expected: 'NOT_EXPIRED')]
fn test_refund_before_expiry_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    start_cheat_block_timestamp(escrow.contract_address, T0);
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);
    refund(escrow, token, REFUND_SECRET, NOTE);
}

#[test]
#[should_panic(expected: 'ALREADY_CLAIMED')]
fn test_refund_after_claim_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);
    claim(escrow, token, CLAIM_SECRET, NOTE);
    start_cheat_block_timestamp(escrow.contract_address, EXPIRY);
    refund(escrow, token, REFUND_SECRET, NOTE_2);
}

#[test]
#[should_panic(expected: 'COMMITMENT_NOT_FOUND')]
fn test_claim_secret_unusable_on_refund_path() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, REFUND_SECRET, EXPIRY);
    start_cheat_block_timestamp(escrow.contract_address, EXPIRY);
    refund(escrow, token, CLAIM_SECRET, NOTE);
}

// ------------------------------------------------------------------
// several entries at once
// ------------------------------------------------------------------

#[test]
fn test_two_entries_settle_independently() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    fund_and_deposit(escrow, token, AMOUNT, CLAIM_SECRET, 0, 0);
    fund_and_deposit(escrow, token, AMOUNT_2, OTHER_SECRET, 0, 0);
    assert(
        escrow.get_outstanding(token.contract_address) == AMOUNT + AMOUNT_2,
        'both must be owed',
    );

    claim(escrow, token, OTHER_SECRET, NOTE_2);
    assert(
        escrow.get_outstanding(token.contract_address) == AMOUNT,
        'first must remain owed',
    );

    let deposits = claim(escrow, token, CLAIM_SECRET, NOTE);
    assert((*deposits.at(0)).amount == AMOUNT, 'wrong amount');
    assert(escrow.get_outstanding(token.contract_address) == 0, 'all settled');
}

// ------------------------------------------------------------------
// cross-language vector
// ------------------------------------------------------------------

/// Pinned against starknet.js `hash.computePoseidonHashOnElements` with the
/// same tag and secret. If this ever fails, links minted by the client would
/// hash to commitments this contract cannot find — funds stuck. Never bump
/// the constant without bumping the tag version on both sides.
#[test]
fn test_claim_commitment_matches_client_vector() {
    assert(
        crate::escrow::compute_claim_commitment(0x1234)
            == 0x308c7c8531f0e0d2789204d5bd59baa4b55308631b86215304789c774ac500d,
        'client vector mismatch',
    );
}

// ---------------------------------------------------------------------------
// DepositMany — N hash-locked entries from one pool withdrawal
// ---------------------------------------------------------------------------

const BATCH_SECRET_A: felt252 = 'batch-secret-a';
const BATCH_SECRET_B: felt252 = 'batch-secret-b';
const BATCH_SECRET_C: felt252 = 'batch-secret-c';

/// Three legs whose amounts are deliberately unequal and non-round.
fn three_legs() -> Span<EscrowLeg> {
    [
        EscrowLeg {
            claim_commitment: compute_claim_commitment(BATCH_SECRET_A),
            refund_commitment: 0,
            amount: 41_003_117,
        },
        EscrowLeg {
            claim_commitment: compute_claim_commitment(BATCH_SECRET_B),
            refund_commitment: 0,
            amount: 8_819_443,
        },
        EscrowLeg {
            claim_commitment: compute_claim_commitment(BATCH_SECRET_C),
            refund_commitment: 0,
            amount: 130_555_901,
        },
    ]
        .span()
}

fn batch_total() -> u128 {
    41_003_117 + 8_819_443 + 130_555_901
}

fn deposit_many(
    escrow: ILumenEscrowDispatcher,
    token: IMockErc20Dispatcher,
    legs: Span<EscrowLeg>,
    amount: u128,
) {
    start_cheat_caller_address(escrow.contract_address, pool());
    escrow
        .privacy_invoke(
            EscrowOperation::DepositMany, 0, 0, 0, token.contract_address, amount, 0, 0, legs,
        );
    stop_cheat_caller_address(escrow.contract_address);
}

#[test]
fn test_batch_creates_every_entry_and_each_claims_once() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    token.mint(escrow.contract_address, batch_total().into());
    deposit_many(escrow, token, three_legs(), batch_total());

    assert(escrow.get_outstanding(token.contract_address) == batch_total(), 'owes the whole batch');

    // Each leg is independently claimable by its own secret, and only its own.
    let a = claim(escrow, token, BATCH_SECRET_A, NOTE);
    assert(*a.at(0).amount == 41_003_117, 'leg a amount');
    let b = claim(escrow, token, BATCH_SECRET_B, NOTE_2);
    assert(*b.at(0).amount == 8_819_443, 'leg b amount');

    // Settling two legs leaves exactly the third outstanding.
    assert(escrow.get_outstanding(token.contract_address) == 130_555_901, 'third still owed');
}

#[test]
#[should_panic(expected: 'BATCH_AMOUNT_MISMATCH')]
fn test_batch_cannot_mint_more_than_was_delivered() {
    // The whole point: a caller who withdrew one amount from the pool must not
    // be able to hand out claims worth more than it.
    let escrow = deploy_escrow();
    let token = deploy_token();
    token.mint(escrow.contract_address, batch_total().into());
    deposit_many(escrow, token, three_legs(), batch_total() - 1);
}

#[test]
#[should_panic(expected: 'INSUFFICIENT_BACKING')]
fn test_batch_rejects_entries_the_escrow_cannot_back() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    // Sum matches what was asked for, but the pool never delivered it.
    token.mint(escrow.contract_address, (batch_total() - 1).into());
    deposit_many(escrow, token, three_legs(), batch_total());
}

#[test]
#[should_panic(expected: 'EMPTY_BATCH')]
fn test_empty_batch_is_rejected() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    deposit_many(escrow, token, [].span(), 0);
}

#[test]
#[should_panic(expected: 'COMMITMENT_EXISTS')]
fn test_batch_rejects_a_duplicated_commitment_inside_itself() {
    // Two legs sharing a secret would let one claim settle both liabilities.
    let escrow = deploy_escrow();
    let token = deploy_token();
    let same = compute_claim_commitment(BATCH_SECRET_A);
    let legs = [
        EscrowLeg { claim_commitment: same, refund_commitment: 0, amount: 10_000 },
        EscrowLeg { claim_commitment: same, refund_commitment: 0, amount: 20_000 },
    ]
        .span();
    token.mint(escrow.contract_address, 30_000);
    deposit_many(escrow, token, legs, 30_000);
}

#[test]
#[should_panic(expected: 'CALLER_NOT_PRIVACY')]
fn test_batch_is_pool_gated_like_every_other_operation() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    token.mint(escrow.contract_address, batch_total().into());
    start_cheat_caller_address(escrow.contract_address, ATTACKER.try_into().unwrap());
    escrow
        .privacy_invoke(
            EscrowOperation::DepositMany,
            0,
            0,
            0,
            token.contract_address,
            batch_total(),
            0,
            0,
            three_legs(),
        );
}

#[test]
fn test_batch_legs_can_carry_refunds() {
    let escrow = deploy_escrow();
    let token = deploy_token();
    start_cheat_block_timestamp(escrow.contract_address, T0);
    let legs = [
        EscrowLeg {
            claim_commitment: compute_claim_commitment(BATCH_SECRET_A),
            refund_commitment: compute_refund_commitment(REFUND_SECRET),
            amount: 55_555,
        },
    ]
        .span();
    token.mint(escrow.contract_address, 55_555);
    start_cheat_caller_address(escrow.contract_address, pool());
    escrow
        .privacy_invoke(
            EscrowOperation::DepositMany, 0, 0, EXPIRY, token.contract_address, 55_555, 0, 0, legs,
        );
    stop_cheat_caller_address(escrow.contract_address);

    // Unclaimed past expiry, the sender reclaims it exactly as with one link.
    start_cheat_block_timestamp(escrow.contract_address, EXPIRY + 1);
    start_cheat_caller_address(escrow.contract_address, pool());
    let refunded = escrow
        .privacy_invoke(
            EscrowOperation::Refund,
            0,
            0,
            0,
            token.contract_address,
            0,
            REFUND_SECRET,
            NOTE,
            [].span(),
        );
    stop_cheat_caller_address(escrow.contract_address);
    assert(*refunded.at(0).amount == 55_555, 'refunded the leg');
    stop_cheat_block_timestamp(escrow.contract_address);
}
