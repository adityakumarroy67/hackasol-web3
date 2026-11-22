// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only payout token with NO real value. 2 decimals, so 1 unit = 1 paisa.
/// Anyone can mint, because it is only for local/testnet demos.
contract TestINR is ERC20 {
    constructor() ERC20("Test INR (no real value)", "tINR") {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
