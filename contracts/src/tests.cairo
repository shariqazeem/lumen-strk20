//! Test suite for `LumenSplitter`.
//!
//! The pool is simulated the way it actually behaves: it funds the helper first
//! (its Withdraw leg), then calls `privacy_invoke` as the caller. Every test that
//! matters asserts the value invariant — outputs sum to exactly the input minus
//! the declared fee — because a helper that silently loses value is a critical bug.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use crate::splitter::{
    BPS_DENOMINATOR, ILumenSplitterDispatcher, ILumenSplitterDispatcherTrait, MAX_SPLITS,
    SplitMode, compute_bps_amounts, errors,
};

const POOL: felt252 = 'POOL';
const ATTACKER: felt252 = 'ATTACKER';
const FEE_SINK: felt252 = 'FEE_SINK';

const NOTE_A: felt252 = 'NOTE_A';
const NOTE_B: felt252 = 'NOTE_B';
const NOTE_C: felt252 = 'NOTE_C';

/// Deliberately non-round legs, and a total that is nobody's idea of a nice number.
const LEG_A: u128 = 412_884_203_115_662_101;
const LEG_B: u128 = 604_118_002_884_401_893;
const LEG_C: u128 = 420_899_909_884_000_997;
const TOTAL_IN: u128 = 1_437_902_115_884_064_991;

fn pool() -> ContractAddress {
    POOL.try_into().unwrap()
}

fn attacker() -> ContractAddress {
    ATTACKER.try_into().unwrap()
}

fn fee_sink() -> ContractAddress {
    FEE_SINK.try_into().unwrap()
}

fn no_fee_recipient() -> ContractAddress {
    0.try_into().unwrap()
}

fn deploy_token() -> IMockErc20Dispatcher {
    let contract = declare("MockErc20").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    IMockErc20Dispatcher { contract_address: address }
}

fn deploy_splitter(fee_recipient: ContractAddress, max_fee_bps: u16) -> ILumenSplitterDispatcher {
    let contract = declare("LumenSplitter").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(pool().into());
    calldata.append(fee_recipient.into());
    calldata.append(max_fee_bps.into());
    let (address, _) = contract.deploy(@calldata).unwrap();
    ILumenSplitterDispatcher { contract_address: address }
}

/// A splitter funded exactly the way the pool's Withdraw leg funds it.
fn setup(
    funding: u128, fee_recipient: ContractAddress, max_fee_bps: u16,
) -> (ILumenSplitterDispatcher, IMockErc20Dispatcher) {
    let token = deploy_token();
    let splitter = deploy_splitter(fee_recipient, max_fee_bps);
    if funding != 0 {
        token.mint(splitter.contract_address, funding.into());
    }
    (splitter, token)
}

fn setup_default() -> (ILumenSplitterDispatcher, IMockErc20Dispatcher) {
    setup(TOTAL_IN, no_fee_recipient(), 0)
}

fn three_legs() -> Span<u128> {
    array![LEG_A, LEG_B, LEG_C].span()
}

fn three_notes() -> Span<felt252> {
    array![NOTE_A, NOTE_B, NOTE_C].span()
}

// ---------------------------------------------------------------------------
// The value invariant
// ---------------------------------------------------------------------------

#[test]
fn test_exact_split_sums_to_input() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, three_legs(), three_notes(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    assert_eq!(deposits.len(), 3);

    let mut sum: u128 = 0;
    for i in 0..deposits.len() {
        sum += *deposits[i].amount;
    }
    assert_eq!(sum, TOTAL_IN, "outputs must sum to exactly the input");
}

#[test]
fn test_exact_split_honours_proportions_and_note_ids() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, three_legs(), three_notes(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    // Legs come back in plan order, paired with the note ids in the same order.
    assert_eq!(*deposits[0].note_id, NOTE_A);
    assert_eq!(*deposits[0].amount, LEG_A);
    assert_eq!(*deposits[1].note_id, NOTE_B);
    assert_eq!(*deposits[1].amount, LEG_B);
    assert_eq!(*deposits[2].note_id, NOTE_C);
    assert_eq!(*deposits[2].amount, LEG_C);

    // Every leg carries the token the pool must pull.
    assert_eq!(*deposits[0].token, token.contract_address);
    assert_eq!(*deposits[1].token, token.contract_address);
    assert_eq!(*deposits[2].token, token.contract_address);
}

#[test]
fn test_pool_is_approved_for_exactly_the_credited_sum() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, three_legs(), three_notes(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    // Approve, don't transfer: the pool pulls the deposits itself.
    let allowance = token.allowance(splitter.contract_address, pool());
    assert_eq!(allowance, TOTAL_IN.into());
    assert_eq!(token.balance_of(splitter.contract_address), TOTAL_IN.into());
}

#[test]
fn test_single_leg_is_a_passthrough() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            0,
            array![TOTAL_IN].span(),
            array![NOTE_A].span(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    assert_eq!(deposits.len(), 1);
    assert_eq!(*deposits[0].amount, TOTAL_IN);
}

#[test]
fn test_max_splits_is_accepted() {
    // 16 legs of 1 wei plus a remainder leg is one over the cap, so 16 legs exactly:
    // 15 legs of 1 and one leg carrying the rest.
    let (splitter, token) = setup_default();

    let mut parts: Array<u128> = array![];
    let mut notes: Array<felt252> = array![];
    let mut assigned: u128 = 0;
    for i in 0..(MAX_SPLITS - 1) {
        parts.append(1);
        notes.append((i + 1).into());
        assigned += 1;
    }
    parts.append(TOTAL_IN - assigned);
    notes.append(MAX_SPLITS.into());

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, parts.span(), notes.span(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    assert_eq!(deposits.len(), MAX_SPLITS);
}

// ---------------------------------------------------------------------------
// Bps mode
// ---------------------------------------------------------------------------

#[test]
fn test_bps_split_proportions_and_remainder() {
    let total: u128 = 1_000_000_000_000_000_007;
    let (splitter, token) = setup(total, no_fee_recipient(), 0);

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(
            SplitMode::Bps,
            token.contract_address,
            0, // no minimum-delivered floor
            0,
            array![2500, 2500, 5000].span(),
            three_notes(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    assert_eq!(deposits.len(), 3);
    assert_eq!(*deposits[0].amount, 250_000_000_000_000_001);
    assert_eq!(*deposits[1].amount, 250_000_000_000_000_001);
    // Last leg absorbs the 2 wei the two floors left behind (5000 bps alone would
    // have floored to ...003).
    assert_eq!(*deposits[2].amount, 500_000_000_000_000_005);

    let mut sum: u128 = 0;
    for i in 0..deposits.len() {
        sum += *deposits[i].amount;
    }
    assert_eq!(sum, total, "bps outputs must still sum to exactly the input");
}

#[test]
fn test_bps_split_measures_the_delivered_balance() {
    // The pool delivered more than the planner's floor: Bps splits what arrived.
    let delivered: u128 = 777_000_000_000_000_003;
    let (splitter, token) = setup(delivered, no_fee_recipient(), 0);

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(
            SplitMode::Bps,
            token.contract_address,
            700_000_000_000_000_000, // floor: refuse if less than this arrived
            0,
            array![6000, 4000].span(),
            array![NOTE_A, NOTE_B].span(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    assert_eq!(*deposits[0].amount + *deposits[1].amount, delivered);
    assert_eq!(*deposits[0].amount, 466_200_000_000_000_001);
}

#[test]
fn test_pure_bps_helper_gives_remainder_to_last_leg() {
    let amounts = compute_bps_amounts(100, array![3333, 3333, 3334].span());
    assert_eq!(*amounts[0], 33);
    assert_eq!(*amounts[1], 33);
    assert_eq!(*amounts[2], 34);
}

#[test]
fn test_preview_matches_what_invoke_emits() {
    let total: u128 = 1_000_000_000_000_000_007;
    let (splitter, token) = setup(total, no_fee_recipient(), 0);
    let parts = array![2500, 2500, 5000].span();

    let preview = splitter.preview_bps_split(total, parts);

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(SplitMode::Bps, token.contract_address, 0, 0, parts, three_notes());
    stop_cheat_caller_address(splitter.contract_address);

    for i in 0..deposits.len() {
        assert_eq!(*preview[i], *deposits[i].amount);
    }
}

// ---------------------------------------------------------------------------
// Declared fee
// ---------------------------------------------------------------------------

#[test]
fn test_declared_fee_is_paid_and_excluded_from_the_sum() {
    let fee: u128 = 1_437_902_115_884_064; // 10 bps of TOTAL_IN, rounded down
    let (splitter, token) = setup(TOTAL_IN, fee_sink(), 50);

    let leg_a = LEG_A - fee;

    start_cheat_caller_address(splitter.contract_address, pool());
    let deposits = splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            fee,
            array![leg_a, LEG_B, LEG_C].span(),
            three_notes(),
        );
    stop_cheat_caller_address(splitter.contract_address);

    let mut sum: u128 = 0;
    for i in 0..deposits.len() {
        sum += *deposits[i].amount;
    }
    assert_eq!(sum, TOTAL_IN - fee, "outputs must sum to input minus the declared fee");
    assert_eq!(token.balance_of(fee_sink()), fee.into());
    assert_eq!(token.allowance(splitter.contract_address, pool()), (TOTAL_IN - fee).into());
}

#[test]
#[should_panic(expected: 'FEE_ABOVE_CAP')]
fn test_fee_above_cap_rejected() {
    let fee: u128 = TOTAL_IN / 2; // 5000 bps against a 50 bps cap
    let (splitter, token) = setup(TOTAL_IN, fee_sink(), 50);

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            fee,
            array![TOTAL_IN - fee].span(),
            array![NOTE_A].span(),
        );
}

#[test]
#[should_panic(expected: 'FEE_RECIPIENT_UNSET')]
fn test_fee_without_recipient_rejected() {
    let (splitter, token) = setup_default(); // fee recipient is zero
    let fee: u128 = 1_000;

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            fee,
            array![TOTAL_IN - fee].span(),
            array![NOTE_A].span(),
        );
}

#[test]
#[should_panic(expected: 'FEE_EXCEEDS_INPUT')]
fn test_fee_swallowing_the_whole_input_rejected() {
    let (splitter, token) = setup(TOTAL_IN, fee_sink(), 10_000);

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            TOTAL_IN,
            array![1].span(),
            array![NOTE_A].span(),
        );
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected: 'CALLER_NOT_POOL')]
fn test_non_pool_caller_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, attacker());
    splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, three_legs(), three_notes(),
        );
}

#[test]
fn test_constructor_rejects_zero_pool() {
    // An unpinned helper would be drivable by anyone, so the constructor refuses.
    let contract = declare("LumenSplitter").unwrap().contract_class();
    let calldata: Array<felt252> = array![0, 0, 0];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("deploying with a zero pool address must fail"),
        Result::Err(panic_data) => assert_eq!(*panic_data[0], errors::ZERO_POOL_ADDRESS),
    }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected: 'ZERO_IN_AMOUNT')]
fn test_zero_in_amount_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            0,
            0,
            array![LEG_A].span(),
            array![NOTE_A].span(),
        );
}

#[test]
#[should_panic(expected: 'ZERO_IN_AMOUNT')]
fn test_bps_with_nothing_delivered_rejected() {
    let (splitter, token) = setup(0, no_fee_recipient(), 0);

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Bps,
            token.contract_address,
            0,
            0,
            array![10_000].span(),
            array![NOTE_A].span(),
        );
}

#[test]
#[should_panic(expected: 'EMPTY_SPLIT')]
fn test_empty_split_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, array![].span(), array![].span(),
        );
}

#[test]
#[should_panic(expected: 'TOO_MANY_SPLITS')]
fn test_oversized_split_rejected() {
    let (splitter, token) = setup_default();

    let mut parts: Array<u128> = array![];
    let mut notes: Array<felt252> = array![];
    for i in 0..(MAX_SPLITS + 1) {
        parts.append(1);
        notes.append((i + 1).into());
    }

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, parts.span(), notes.span(),
        );
}

#[test]
#[should_panic(expected: 'LENGTH_MISMATCH')]
fn test_note_id_count_must_match_part_count() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            0,
            three_legs(),
            array![NOTE_A, NOTE_B].span(),
        );
}

#[test]
#[should_panic(expected: 'SPLIT_SUM_MISMATCH')]
fn test_parts_that_do_not_reconcile_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            0,
            array![LEG_A, LEG_B, LEG_C - 1].span(), // one wei short
            three_notes(),
        );
}

#[test]
#[should_panic(expected: 'ZERO_PART')]
fn test_zero_part_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            0,
            array![TOTAL_IN, 0].span(),
            array![NOTE_A, NOTE_B].span(),
        );
}

#[test]
#[should_panic(expected: 'BPS_SUM_MISMATCH')]
fn test_bps_not_summing_to_100_percent_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Bps,
            token.contract_address,
            0,
            0,
            array![2500, 2500].span(), // 5000 bps, not 10_000
            array![NOTE_A, NOTE_B].span(),
        );
}

#[test]
#[should_panic(expected: 'ZERO_NOTE_ID')]
fn test_zero_note_id_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            0,
            array![TOTAL_IN].span(),
            array![0].span(),
        );
}

#[test]
#[should_panic(expected: 'DUPLICATE_NOTE_ID')]
fn test_duplicate_note_id_rejected() {
    let (splitter, token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            token.contract_address,
            TOTAL_IN,
            0,
            array![LEG_A, LEG_B, LEG_C].span(),
            array![NOTE_A, NOTE_B, NOTE_A].span(),
        );
}

#[test]
#[should_panic(expected: 'ZERO_TOKEN')]
fn test_zero_token_rejected() {
    let (splitter, _token) = setup_default();

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact,
            0.try_into().unwrap(),
            TOTAL_IN,
            0,
            array![TOTAL_IN].span(),
            array![NOTE_A].span(),
        );
}

#[test]
#[should_panic(expected: 'INSUFFICIENT_BALANCE')]
fn test_declaring_more_than_was_delivered_rejected() {
    // The pool delivered one wei less than the plan claims.
    let (splitter, token) = setup(TOTAL_IN - 1, no_fee_recipient(), 0);

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Exact, token.contract_address, TOTAL_IN, 0, three_legs(), three_notes(),
        );
}

#[test]
#[should_panic(expected: 'INSUFFICIENT_BALANCE')]
fn test_bps_floor_not_met_rejected() {
    let (splitter, token) = setup(500_000_000_000_000_000, no_fee_recipient(), 0);

    start_cheat_caller_address(splitter.contract_address, pool());
    splitter
        .privacy_invoke(
            SplitMode::Bps,
            token.contract_address,
            900_000_000_000_000_000, // expected at least this much to arrive
            0,
            array![10_000].span(),
            array![NOTE_A].span(),
        );
}

// ---------------------------------------------------------------------------
// Deployment surface
// ---------------------------------------------------------------------------

#[test]
fn test_getters_report_the_pinned_configuration() {
    let splitter = deploy_splitter(fee_sink(), 25);
    assert_eq!(splitter.pool_address(), pool());
    assert_eq!(splitter.fee_recipient(), fee_sink());
    assert_eq!(splitter.max_fee_bps(), 25);
    assert_eq!(splitter.max_splits(), MAX_SPLITS);
    assert_eq!(BPS_DENOMINATOR, 10_000);
}
