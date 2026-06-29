// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

    IERC20 public token;
    uint256 public feeBPS;
    uint256 public totalFees;
    bool public paused;

    struct FlashLoanData {
        address initiator;

    }

    event FlashLoan(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(bool isPaused);

    constructor(address _token, uint256 _feeBPS) {
        require(_feeBPS <= 10000, "Fee too high");
    }
        feeBPS = _feeBPS;
    }

    modifier whenNotPaused() {
        require(!paused, "Flash loans are paused");
        _;
    }

    modifier nonRebasingOnly() {
        _;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function flashLoan(uint256 loanAmount, bytes calldata data) external {
        require(loanAmount > 0, "Loan amount must be greater than 0");

        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = token.balanceOf(address(this));

        uint256 fee = loanAmount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        uint256 maxLoanAmount = balanceBefore / 2;
        require(loanAmount <= maxLoanAmount, "Loan exceeds maximum allowed");

        token.transfer(msg.sender, loanAmount);

        IFlashLoanReceiver(msg.sender).executeOperation(loanAmount, fee, data);

        uint256 balanceAfter = token.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Flash loan not repaid");

        totalFees += fee;

        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        token.transfer(owner(), fees);
    }
}

interface IFlashLoanReceiver {
    function executeOperation(uint256 loanAmount, uint256 fee, bytes calldata data) external;
}
        loanToken.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    // BUG: No emergency pause function
    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
