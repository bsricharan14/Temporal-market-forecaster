import csv
import random
from datetime import datetime, timedelta

def generate_tick_data(filename, num_rows, symbol="AAPL"):
    print(f"Generating {num_rows} rows of tick data for {symbol}...")
    
    # Start at a simulated market open
    current_time = datetime(2026, 3, 25, 9, 30, 0) 
    current_price = 175.50
    
    with open(filename, mode='w', newline='') as file:
        writer = csv.writer(file)
        # Write the headers exactly as PostgreSQL will expect them
        writer.writerow(['time', 'symbol', 'price', 'volume'])
        
        for _ in range(num_rows):
            # Advance time by random milliseconds (simulating high-frequency trades)
            current_time += timedelta(milliseconds=random.randint(1, 500))
            
            # Simulate realistic price movement (Random Walk)
            current_price += random.uniform(-0.02, 0.02)
            
            # Simulate trade volume
            volume = random.randint(10, 1500)
            
            # Write the row with millisecond precision
            writer.writerow([
                current_time.strftime('%Y-%m-%d %H:%M:%S.%f'), 
                symbol, 
                round(current_price, 2), 
                volume
            ])
            
    print(f"Success! Massive dataset saved to {filename}")

# Generate 1 Million rows (Creates a file roughly 50MB-60MB in size)
generate_tick_data("synthetic_ticks.csv", 1000000)
