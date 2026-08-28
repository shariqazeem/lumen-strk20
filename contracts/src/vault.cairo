//! LumenVault — private Bitcoin staking, built on the STRK20 anonymizer interface.
//!
//! ## What this is
//!
//! STRK20 ships an extension point: the pool can withdraw to a helper contract,
//! call its `privacy_invoke`, and credit whatever the helper returns into an open
//! note — all inside one atomic private operation. That interface is how any DeFi
//! venue on Starknet becomes reachable from a shielded balance, and it is what
//! StarkWare means by extending strkBTC "from private balances and transfers into
//! private execution."
//!
//! This contract is that, pointed at Bitcoin yield. strkBTC is Starknet's shielded
//! Bitcoin; Endur's xstrkBTC is its liquid-staked form, an ERC-4626 vault over it,
//! and the first LST to carry privacy through to the staked position. On launch
//! those two were the only shieldable assets in the pool.
//!
//! So: a user holding shielded strkBTC stakes it into Endur and receives shielded
//! xstrkBTC, in one pool operation, without their address, their amount, or the
//! fact of the stake ever appearing on chain. The alternative available to them
//! today is to unshield, deposit publicly, and re-shield — two public legs of
//! matching size, seconds apart, on the same account.
//!
//! Nothing here is a patch on the pool or on Endur. Both are used exactly as
//! designed, through the interfaces each publishes: the pool's `privacy_invoke`
//! and open notes, and the vault's ERC-4626 `deposit`. The point is to show that
//! the anonymizer interface reaches real Bitcoin DeFi, and that a normal app can
//! wire it up.
//!
//! ## The sandwich (see references/helpers__privacy-invoke.md)
//!
//! ```text
//! pool Withdraw(assets -> vault helper)   phase 6
//! pool CreateOpenNote (shares token)      phase 5   (`transfer` with amount "OPEN")
//! pool InvokeExternal(vault helper)       phase 7   -> privacy_invoke
//!      helper approves the ERC-4626 vault and deposits
//!      helper approves the pool for the shares it received
//!      helper returns Span<OpenNoteDeposit> with one entry
//! pool pulls the shares back and fills the open note
//! ```
//!
//! The helper never transfers to the pool: it approves, and the pool pulls. A revert
//! anywhere aborts the whole pool transaction and no funds move.
//!
//! ## Entry is built here; the exit already exists
//!
//! Endur redeems through a withdraw queue by design, and the vault's liquid buffer
//! of the underlying was zero when this was written, so `redeem` does not return
//! assets inside the calling transaction and cannot fill an open note atomically.
//! A function that always reverts is worse than one that does not exist, so there
//! is no unstake operation here.
//!
//! It does not need one. xstrkBTC is shieldable and trades against strkBTC, so
//! leaving is an AVNU private swap inside the pool — a route STRK20 and AVNU
//! already ship, and one Lumen already calls. Entry and exit are both private;
//! only the entry needed a helper.
//!
//! ## Trust model
//!
//! Stateless, and pinned at deployment to exactly one pool and one vault. It holds
//! nothing between transactions: everything the pool delivers is deposited and
//! approved back inside the same call. `privacy_invoke` asserts the caller is the
//! pinned pool, so nobody can drive it directly, sweep a mid-transaction balance, or
//! grant themselves an allowance.
//!
//! Pinning the vault rather than taking it as a parameter is deliberate. A vault
//! address supplied in calldata is a vault address an attacker can supply, and this
//! contract approves whatever it is handed.
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
    /// The amount to deposit into the note.
    pub amount: u128,
}

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

/// The slice of ERC-4626 this contract uses. Verified against Endur's deployed
/// class on mainnet: `deposit(assets, receiver) -> shares`, `asset() -> address`.
#[starknet::interface]
pub trait IErc4626<TState> {
    fn asset(self: @TState) -> ContractAddress;
    fn deposit(ref self: TState, assets: u256, receiver: ContractAddress) -> u256;
    fn preview_deposit(self: @TState, assets: u256) -> u256;
}

pub mod errors {
    pub const ZERO_POOL_ADDRESS: felt252 = 'ZERO_POOL_ADDRESS';
    pub const ZERO_VAULT_ADDRESS: felt252 = 'ZERO_VAULT_ADDRESS';
    pub const ASSET_MISMATCH: felt252 = 'ASSET_MISMATCH';
    pub const CALLER_NOT_POOL: felt252 = 'CALLER_NOT_POOL';
    pub const ZERO_NOTE_ID: felt252 = 'ZERO_NOTE_ID';
    pub const NOTHING_DELIVERED: felt252 = 'NOTHING_DELIVERED';
    pub const NO_SHARES_MINTED: felt252 = 'NO_SHARES_MINTED';
    pub const BELOW_MIN_SHARES: felt252 = 'BELOW_MIN_SHARES';
    pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
}

#[starknet::interface]
pub trait ILumenVault<T> {
    /// Stake everything the pool just delivered, and credit the shares to one note.
    ///
    /// - `note_id` — the open note to fill. This is the `${openNoteIds[0]}`
    ///   placeholder the wallet substitutes, and it must be an open note in the
    ///   *share* token, not the underlying.
    /// - `min_shares` — floor on the shares credited, or `0` to disable. An
    ///   ERC-4626 exchange rate moves between quoting and execution, so a caller
    ///   that quoted a rate can refuse to be filled below it rather than discover
    ///   the difference afterwards.
    ///
    /// The staked amount is measured as this contract's own balance, never taken
    /// from calldata: the helper is stateless, so its whole balance is what the
    /// pool's Withdraw leg delivered earlier in this same transaction.
    fn privacy_invoke(
        ref self: T, note_id: felt252, min_shares: u128,
    ) -> Span<OpenNoteDeposit>;

    /// The privacy pool pinned at deployment. The only permitted caller.
    fn pool_address(self: @T) -> ContractAddress;
    /// The ERC-4626 vault pinned at deployment.
    fn vault_address(self: @T) -> ContractAddress;
    /// The vault's underlying asset, read from the vault at deployment.
    fn asset_address(self: @T) -> ContractAddress;
    /// Off-chain planning aid: the shares `assets` would mint at the current rate.
    /// Lets a dapp set `min_shares` without simulating a transaction.
    fn preview_stake(self: @T, assets: u128) -> u128;
}

#[starknet::contract]
pub mod LumenVault {
    use core::num::traits::Zero;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::{
        IErc20Dispatcher, IErc20DispatcherTrait, IErc4626Dispatcher, IErc4626DispatcherTrait,
        ILumenVault, OpenNoteDeposit, errors,
    };

    #[storage]
    struct Storage {
        /// Pinned at deployment: a deployed helper is a fixed, auditable route.
        pool: ContractAddress,
        /// The ERC-4626 vault this instance stakes into. One vault per deployment.
        vault: ContractAddress,
        /// The vault's underlying, cached so the hot path reads storage, not a call.
        asset: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Staked: Staked,
    }

    /// Emitted once per successful stake. Carries nothing that is not already
    /// public: open-note amounts are plaintext by design, and the note owner is
    /// never known to this contract.
    #[derive(Drop, starknet::Event)]
    pub struct Staked {
        #[key]
        pub vault: ContractAddress,
        pub assets_in: u128,
        pub shares_out: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        vault: ContractAddress,
        asset: ContractAddress,
    ) {
        assert(pool.is_non_zero(), errors::ZERO_POOL_ADDRESS);
        assert(vault.is_non_zero(), errors::ZERO_VAULT_ADDRESS);
        // The asset is passed *and* checked rather than simply read. A deploy that
        // names the wrong underlying is the one mistake here that would silently
        // approve the wrong token, so the mismatch must abort the deploy.
        assert(
            IErc4626Dispatcher { contract_address: vault }.asset() == asset, errors::ASSET_MISMATCH,
        );
        self.pool.write(pool);
        self.vault.write(vault);
        self.asset.write(asset);
    }

    #[abi(embed_v0)]
    pub impl LumenVaultImpl of ILumenVault<ContractState> {
        fn privacy_invoke(
            ref self: ContractState, note_id: felt252, min_shares: u128,
        ) -> Span<OpenNoteDeposit> {
            // 1. Access control. Only the pool may drive this contract. Anything it
            //    holds mid-transaction belongs to the pool transaction in flight.
            assert(get_caller_address() == self.pool.read(), errors::CALLER_NOT_POOL);
            assert(note_id.is_non_zero(), errors::ZERO_NOTE_ID);

            let pool = self.pool.read();
            let vault = self.vault.read();
            let asset = self.asset.read();
            let me = get_contract_address();

            // 2. Measure what actually arrived. The balance-delta idiom: this helper
            //    is stateless and holds nothing between transactions, so its whole
            //    balance is the delta produced by the pool's Withdraw leg earlier in
            //    this same transaction. A declared amount is never trusted.
            let underlying = IErc20Dispatcher { contract_address: asset };
            let assets: u256 = underlying.balance_of(me);
            assert(assets != 0, errors::NOTHING_DELIVERED);

            // 3. Shares are also measured as a delta rather than read from the
            //    vault's return value. Both should agree; if a vault ever disagrees
            //    with itself, the balance is the one that can actually be approved.
            let shares_token = IErc20Dispatcher { contract_address: vault };
            let before: u256 = shares_token.balance_of(me);

            underlying.approve(vault, assets);
            IErc4626Dispatcher { contract_address: vault }.deposit(assets, me);

            let after: u256 = shares_token.balance_of(me);
            assert(after > before, errors::NO_SHARES_MINTED);
            let shares: u128 = (after - before).try_into().expect(errors::AMOUNT_OVERFLOW);

            // 4. The caller's floor. Zero opts out; anything else refuses a fill
            //    worse than the rate the caller planned against.
            if min_shares != 0 {
                assert(shares >= min_shares, errors::BELOW_MIN_SHARES);
            }

            // 5. Approve the pool for exactly what is being promised, and promise it.
            //    The pool pulls; this contract never pushes.
            shares_token.approve(pool, shares.into());

            let assets_in: u128 = assets.try_into().expect(errors::AMOUNT_OVERFLOW);
            self.emit(Staked { vault, assets_in, shares_out: shares });

            array![OpenNoteDeposit { note_id, token: vault, amount: shares }].span()
        }

        fn pool_address(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn vault_address(self: @ContractState) -> ContractAddress {
            self.vault.read()
        }

        fn asset_address(self: @ContractState) -> ContractAddress {
            self.asset.read()
        }

        fn preview_stake(self: @ContractState, assets: u128) -> u128 {
            IErc4626Dispatcher { contract_address: self.vault.read() }
                .preview_deposit(assets.into())
                .try_into()
                .expect(errors::AMOUNT_OVERFLOW)
        }
    }
}
