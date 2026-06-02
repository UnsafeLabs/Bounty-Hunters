/claim #918

Fixed first-depositor price manipulation via:
- Minimum liquidity lock (require(totalLiquidity >= MIN_LOCK))
- Reserve-based accounting (price = reserveA / reserveB)
- sync() function to recover donated tokens
- Comprehensive test suite covering edge cases

Payment address: 0x9e409f7b2d7c38dc0f69bbe6c45203e8a2f3e185

Demo video attached below showing:
1. Fixed LiquidityPool.sol highlighting lock/reserve/sync changes
2. Tests passing: running test suite with green output
3. Manipulation attempt failing on fixed contract