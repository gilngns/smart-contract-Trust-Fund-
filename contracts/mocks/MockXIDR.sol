// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  MockXIDR
 * @notice Token ERC-20 tiruan untuk menggantikan XIDR asli di environment
 *         testing lokal (Hardhat Network) dan testnet (Polygon Amoy).
 *
 * @dev    JANGAN deploy ke Polygon Mainnet.
 *         Desimal disesuaikan dengan XIDR asli: 6 desimal.
 *         Owner bisa mint token bebas untuk keperluan test.
 */
contract MockXIDR is ERC20, Ownable {
    /// @notice XIDR menggunakan 6 desimal (sama seperti USDC/USDT)
    uint8 private constant DECIMALS = 6;

    constructor(address initialOwner)
        ERC20("Mock XIDR", "XIDR")
        Ownable(initialOwner)
    {}

    /**
     * @notice Mint token XIDR ke alamat tertentu.
     * @dev    Hanya owner (deployer / test script) yang bisa mint.
     * @param to     Alamat penerima
     * @param amount Jumlah token (dalam satuan terkecil, 6 desimal)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Override desimal ke 6 (default ERC20 adalah 18).
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }
}
