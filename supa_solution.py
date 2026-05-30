```python
def calculate_flash_loan_fees(principal, interest_rate, duration):
    # Calculate the fee as 0.1% of the principal amount
    fee = (principal * interest_rate) / 10000000
    return fee

def drain_pool_funds(amount, pool_capacity):
    # Check if the amount is greater than the pool capacity
    if amount > pool_capacity:
        raise ValueError("Amount cannot exceed pool capacity")
    
    # Calculate the drained funds as a percentage of the pool capacity (50%)
    drained_amount = (amount / pool_capacity) * 50000
    
    return drained_amount

def flash_loan_calculator(principal, interest_rate, duration, amount=None):
    fees = []
    if amount is None:
        fee = calculate_flash_loan_fees(principal, interest_rate, duration)
        fees.append(fee)
        
        # Calculate the drained funds
        pool_capacity = 10000000  # Replace with actual pool capacity
        drained_amount = drain_pool_funds(amount or principal, pool_capacity)
        fees.append(drained_amount)
    
    return fees

def main():
    principal = 1000000  # Replace with actual loan amount
    interest_rate = 20  # Replace with actual interest rate
    duration = 3600  # Replace with actual duration
    
    fees = flash_loan_calculator(principal, interest_rate, duration)
    
    print("Fees:")
    for fee in fees:
        print(f"Fee: {fee:.4f}")
        
    print("\nDrained funds (if applicable):")
    drained_amount = drain_pool_funds(amount=principal, pool_capacity=10000000)  # Replace with actual pool capacity
    print(f"Amount: {drained_amount:.2f}")

if __name__ == "__main__":
    main()
```