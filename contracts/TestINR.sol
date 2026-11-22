// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only payout token. Not real money. Anyone can mint on testnet/local for demos.
contract TestINR is ERC20 {
    constructor() ERC20("Test INR (no value)", "tINR") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
