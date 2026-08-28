//! Test suite for `LumenVault`.
//!
//! The pool is simulated the way it actually behaves: it funds the helper first
//! (its Withdraw leg), then calls `privacy_invoke` as the caller. The invariants
//! that matter are that every share minted is promised to the pool and approved to
//! it — a helper that mints shares it does not hand back has stranded a user's
//! Bitcoin inside an anonymizer, which is the worst failure available here.
//!
//! The mainnet rate is deliberately reproduced: Endur's vault returned 99_415_375
//! shares for 100_000_000 assets when this was written, so 1:1 is never the only
//! rate under test.

use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};
use crate::mock_vault::{IMockVaultDispatcher, IMockVaultDispatcherTrait};
use crate::vault::{ILumenVaultDispatcher, ILumenVaultDispatcherTrait, errors};

const POOL: felt252 = 'POOL';
const ATTACKER: felt252 = 'ATTACKER';
const NOTE: felt252 = 'NOTE_SHARES';

/// One whole strkBTC, at 8 decimals.
const ONE_BTC: u128 = 100_000_000;
/// Endur's live exchange rate: 100_000_000 assets minted 99_415_375 shares.
const RATE_NUM: u256 = 99_415_375;
const RATE_DEN: u256 = 100_000_000;

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

fn deploy_vault(underlying: ContractAddress) -> IMockVaultDispatcher {
    let contract = declare("MockVault").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![underlying.into()]).unwrap();
    IMockVaultDispatcher { contract_address: address }
}

fn deploy_helper(
    vault: ContractAddress, asset: ContractAddress,
) -> ILumenVaultDispatcher {
    let contract = declare("LumenVault").unwrap().contract_class();
    let (address, _) = contract
        .deploy(@array![pool().into(), vault.into(), asset.into()])
        .unwrap();
    ILumenVaultDispatcher { contract_address: address }
}

/// A helper funded exactly the way the pool's Withdraw leg funds it.
fn setup(
    funding: u128,
) -> (ILumenVaultDispatcher, IMockErc20Dispatcher, IMockVaultDispatcher) {
    let token = deploy_token();
    let vault = deploy_vault(token.contract_address);
    let helper = deploy_helper(vault.contract_address, token.contract_address);
    if funding != 0 {
        token.mint(helper.contract_address, funding.into());
    }
    (helper, token, vault)
}

fn stake(helper: ILumenVaultDispatcher, min_shares: u128) -> u128 {
    start_cheat_caller_address(helper.contract_address, pool());
    let deposits = helper.privacy_invoke(NOTE, min_shares);
    stop_cheat_caller_address(helper.contract_address);
    assert(deposits.len() == 1, 'ONE_NOTE_EXPECTED');
    *deposits.at(0).amount
}

// ---------------------------------------------------------------- the happy path

#[test]
fn stakes_everything_the_pool_delivered() {
    let (helper, token, vault) = setup(ONE_BTC);
    vault.set_rate(RATE_NUM, RATE_DEN);

    let shares = stake(helper, 0);

    // The rate is applied, not assumed.
    assert(shares == 99_415_375, 'WRONG_SHARES');
    // Everything delivered went into the vault: the helper is a conduit.
    assert(token.balance_of(helper.contract_address) == 0, 'UNDERLYING_STRANDED');
    assert(token.balance_of(vault.contract_address) == ONE_BTC.into(), 'VAULT_NOT_FUNDED');
}

#[test]
fn promises_the_note_exactly_what_it_approves_to_the_pool() {
    let (helper, _, vault) = setup(ONE_BTC);
    vault.set_rate(RATE_NUM, RATE_DEN);

    let promised = stake(helper, 0);

    // The pool pulls; it can only pull what was approved. A promise larger than
    // the allowance would abort the pool transaction; smaller would strand shares.
    let allowance = vault.allowance(helper.contract_address, pool());
    assert(allowance == promised.into(), 'ALLOWANCE_NOT_PROMISE');
    assert(vault.balance_of(helper.contract_address) == promised.into(), 'SHARES_MISMATCH');
}

#[test]
fn returns_the_note_id_it_was_given() {
    let (helper, _, _) = setup(ONE_BTC);
    start_cheat_caller_address(helper.contract_address, pool());
    let deposits = helper.privacy_invoke(NOTE, 0);
    stop_cheat_caller_address(helper.contract_address);
    assert(*deposits.at(0).note_id == NOTE, 'WRONG_NOTE_ID');
}

#[test]
fn credits_the_share_token_not_the_underlying() {
    // The open note is opened in the *share* token. Naming the underlying here
    // would make the pool try to fill a note that does not exist.
    let (helper, _, vault) = setup(ONE_BTC);
    start_cheat_caller_address(helper.contract_address, pool());
    let deposits = helper.privacy_invoke(NOTE, 0);
    stop_cheat_caller_address(helper.contract_address);
    assert(*deposits.at(0).token == vault.contract_address, 'WRONG_TOKEN');
}

#[test]
fn measures_the_balance_rather_than_trusting_a_number() {
    // The pool delivered more than any caller declared. A helper that staked a
    // declared amount would leave the difference behind; this one sweeps it.
    let (helper, token, _) = setup(ONE_BTC);
    token.mint(helper.contract_address, 7_777.into());

    let shares = stake(helper, 0);

    assert(shares == ONE_BTC + 7_777, 'DELTA_NOT_MEASURED');
    assert(token.balance_of(helper.contract_address) == 0, 'DUST_STRANDED');
}

#[test]
fn handles_dust_amounts() {
    // Bitcoin has 8 decimals, so a realistic first stake is very small.
    let (helper, _, _) = setup(1_000);
    assert(stake(helper, 0) == 1_000, 'DUST_FAILED');
}

// ------------------------------------------------------------------ the floor

#[test]
fn accepts_a_fill_at_or_above_the_floor() {
    let (helper, _, vault) = setup(ONE_BTC);
    vault.set_rate(RATE_NUM, RATE_DEN);
    assert(stake(helper, 99_415_375) == 99_415_375, 'EXACT_FLOOR_REJECTED');
}

#[test]
#[should_panic(expected: ('BELOW_MIN_SHARES',))]
fn refuses_a_fill_below_the_floor() {
    // The rate moved against the caller between quoting and execution.
    let (helper, _, vault) = setup(ONE_BTC);
    vault.set_rate(90, 100);
    stake(helper, 99_415_375);
}

#[test]
fn a_zero_floor_opts_out() {
    let (helper, _, vault) = setup(ONE_BTC);
    vault.set_rate(1, 2);
    assert(stake(helper, 0) == ONE_BTC / 2, 'ZERO_FLOOR_ENFORCED');
}

// ------------------------------------------------------------- refusals

#[test]
#[should_panic(expected: ('CALLER_NOT_POOL',))]
fn only_the_pool_may_drive_it() {
    // Anything this contract holds mid-transaction belongs to the pool's
    // transaction. A direct caller must never be able to redirect it.
    let (helper, _, _) = setup(ONE_BTC);
    start_cheat_caller_address(helper.contract_address, attacker());
    helper.privacy_invoke(NOTE, 0);
}

#[test]
#[should_panic(expected: ('ZERO_NOTE_ID',))]
fn refuses_a_zero_note_id() {
    let (helper, _, _) = setup(ONE_BTC);
    start_cheat_caller_address(helper.contract_address, pool());
    helper.privacy_invoke(0, 0);
}

#[test]
#[should_panic(expected: ('NOTHING_DELIVERED',))]
fn refuses_when_the_withdraw_leg_delivered_nothing() {
    let (helper, _, _) = setup(0);
    stake(helper, 0);
}

#[test]
#[should_panic(expected: ('NO_SHARES_MINTED',))]
fn refuses_when_the_vault_mints_nothing() {
    // A paused or misconfigured vault that accepts the deposit and mints zero
    // would otherwise consume the underlying and promise an empty note.
    let (helper, _, vault) = setup(ONE_BTC);
    vault.set_forced_shares(0, true);
    stake(helper, 0);
}

// ---------------------------------------------------------------- deployment

#[test]
fn pins_pool_vault_and_asset() {
    let (helper, token, vault) = setup(0);
    assert(helper.pool_address() == pool(), 'WRONG_POOL');
    assert(helper.vault_address() == vault.contract_address, 'WRONG_VAULT');
    assert(helper.asset_address() == token.contract_address, 'WRONG_ASSET');
}

/// A constructor revert arrives as an `Err` from `deploy`, not as a panic the
/// test harness can catch, so these two check the reason rather than unwrapping.
fn deploy_helper_expecting(
    pool_arg: felt252, vault: ContractAddress, asset: ContractAddress, reason: felt252,
) {
    let contract = declare("LumenVault").unwrap().contract_class();
    match contract.deploy(@array![pool_arg, vault.into(), asset.into()]) {
        Result::Ok(_) => panic!("the deploy should have been refused"),
        Result::Err(data) => assert(*data.at(0) == reason, 'WRONG_REASON'),
    }
}

#[test]
fn refuses_a_deploy_that_names_the_wrong_asset() {
    // The one deploy-time mistake that would silently approve the wrong token.
    let token = deploy_token();
    let other = deploy_token();
    let vault = deploy_vault(token.contract_address);
    deploy_helper_expecting(
        pool().into(), vault.contract_address, other.contract_address, errors::ASSET_MISMATCH,
    );
}

#[test]
fn refuses_a_deploy_with_no_pool() {
    let token = deploy_token();
    let vault = deploy_vault(token.contract_address);
    deploy_helper_expecting(
        0, vault.contract_address, token.contract_address, errors::ZERO_POOL_ADDRESS,
    );
}

// ------------------------------------------------------------------- preview

#[test]
fn preview_matches_what_a_stake_actually_credits() {
    // The dapp sets `min_shares` from this, so a preview that disagrees with
    // execution would make every floor either useless or a guaranteed revert.
    let (helper, _, vault) = setup(ONE_BTC);
    vault.set_rate(RATE_NUM, RATE_DEN);
    let previewed = helper.preview_stake(ONE_BTC);
    assert(stake(helper, 0) == previewed, 'PREVIEW_DISAGREES');
}
