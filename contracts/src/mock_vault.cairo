//! Minimal ERC-4626 vault used only by `snforge test`.
//!
//! It stands in for Endur's xstrkBTC so the vault helper can be exercised without a
//! fork: it pulls the underlying with `transfer_from` exactly as the real one does,
//! and mints shares at a settable exchange rate so the tests can reproduce a rate
//! that is not 1:1 (mainnet's was 0.99415 shares per asset when this was written).
//!
//! `set_rate` and `set_mint_shares` exist to drive failure paths — a vault that
//! mints nothing, or fewer shares than the caller planned against. Neither has an
//! equivalent on the real vault.
//!
//! Deliberately not feature-complete, and must never be deployed anywhere.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockVault<T> {
    // --- the ERC-4626 slice LumenVault uses ---
    fn asset(self: @T) -> ContractAddress;
    fn deposit(ref self: T, assets: u256, receiver: ContractAddress) -> u256;
    fn preview_deposit(self: @T, assets: u256) -> u256;
    // --- the share token is the vault itself ---
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    // --- test knobs, no equivalent on the real vault ---
    /// shares = assets * num / den.
    fn set_rate(ref self: T, num: u256, den: u256);
    /// Force the next deposit to mint exactly this many shares. `den == 0` disables.
    fn set_forced_shares(ref self: T, shares: u256, enabled: bool);
}

#[starknet::contract]
pub mod MockVault {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::IMockVault;
    use crate::mock_erc20::{IMockErc20Dispatcher, IMockErc20DispatcherTrait};

    #[storage]
    struct Storage {
        underlying: ContractAddress,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        rate_num: u256,
        rate_den: u256,
        forced_shares: u256,
        forced_on: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, underlying: ContractAddress) {
        self.underlying.write(underlying);
        self.rate_num.write(1);
        self.rate_den.write(1);
    }

    #[abi(embed_v0)]
    pub impl MockVaultImpl of IMockVault<ContractState> {
        fn asset(self: @ContractState) -> ContractAddress {
            self.underlying.read()
        }

        fn preview_deposit(self: @ContractState, assets: u256) -> u256 {
            assets * self.rate_num.read() / self.rate_den.read()
        }

        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            // Pull the underlying, exactly as a real ERC-4626 does. This is what
            // makes the helper's `approve` step load-bearing in the tests.
            IMockErc20Dispatcher { contract_address: self.underlying.read() }
                .transfer_from(get_caller_address(), get_contract_address(), assets);

            let shares = if self.forced_on.read() {
                self.forced_shares.read()
            } else {
                assets * self.rate_num.read() / self.rate_den.read()
            };
            self.balances.write(receiver, self.balances.read(receiver) + shares);
            shares
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }

        fn set_rate(ref self: ContractState, num: u256, den: u256) {
            self.rate_num.write(num);
            self.rate_den.write(den);
        }

        fn set_forced_shares(ref self: ContractState, shares: u256, enabled: bool) {
            self.forced_shares.write(shares);
            self.forced_on.write(enabled);
        }
    }
}
