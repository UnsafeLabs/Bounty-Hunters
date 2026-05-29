import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FlashLoan is Ownable {
    IERC20 public token;
    
    uint256 public loanAmount;
    uint256 public feeBPS;
    uint256 public protocolFee;
    
    constructor(IERC20 _token) public {
        token = _token;
    }

    function flashLoan(uint256 amount, uint256 _feeBPS) public onlyOwner {
        loanAmount = amount;
        feeBPS = _feeBPS;
        protocolFee = loanAmount * feeBPS / 10000;
        if (protocolFee == 0) protocolFee = 1;
        uint256 balanceBefore = token.balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient collateral");
        uint256 balanceAfter = balanceBefore + amount;
        require(balanceAfter <= address(this).balance, "Insufficient balance");
    }
}
        // BUG: Truncates to 0 when amount < 10000/feeBPS
        uint256 fee = amount * feeBPS / 10000;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // BUG: balanceOf can be manipulated by rebasing tokens
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
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
