// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityPoolTest {
    MockToken internal tokenA;
    MockToken internal tokenB;
    LiquidityPool internal pool;
    address internal provider = address(0xBEEF);
    address internal attacker = address(0xCAFE);

    function setUp() public {
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        tokenA.mint(address(this), 1_000_000 ether);
        tokenB.mint(address(this), 1_000_000 ether);
        tokenA.approve(address(pool), type(uint256).max);
        tokenB.approve(address(pool), type(uint256).max);
    }

    function testFirstDepositLocksMinimumLiquidity() public {
        setUp();

        uint256 minted = pool.addLiquidity(10_000, 10_000);

        require(pool.balanceOf(address(0)) == pool.MINIMUM_LIQUIDITY(), "minimum liquidity not locked");
        require(minted == 9_000, "first provider should receive net liquidity");
        require(pool.totalSupply() == 10_000, "total supply should include locked liquidity");
        require(pool.reserveA() == 10_000, "reserve A not updated");
        require(pool.reserveB() == 10_000, "reserve B not updated");
    }

    function testFirstDepositMustExceedMinimumLiquidity() public {
        setUp();

        (bool ok,) = address(pool).call(abi.encodeWithSelector(pool.addLiquidity.selector, 1, 1));
        require(!ok, "tiny first deposit should revert");
    }

    function testDirectDonationDoesNotInflateRemovalAmounts() public {
        setUp();

        uint256 minted = pool.addLiquidity(10_000, 10_000);

        tokenA.mint(address(pool), 90_000);
        tokenB.mint(address(pool), 90_000);

        uint256 balanceABefore = tokenA.balanceOf(address(this));
        uint256 balanceBBefore = tokenB.balanceOf(address(this));
        pool.removeLiquidity(minted);
        uint256 receivedA = tokenA.balanceOf(address(this)) - balanceABefore;
        uint256 receivedB = tokenB.balanceOf(address(this)) - balanceBBefore;

        require(receivedA == 9_000, "donation changed token A withdrawal");
        require(receivedB == 9_000, "donation changed token B withdrawal");
    }

    function testSyncUpdatesReservesAfterDonation() public {
        setUp();

        pool.addLiquidity(10_000, 10_000);
        tokenA.mint(address(pool), 5_000);
        tokenB.mint(address(pool), 7_000);

        pool.sync();

        require(pool.reserveA() == 15_000, "sync did not update reserve A");
        require(pool.reserveB() == 17_000, "sync did not update reserve B");
    }
}
