import csv
import random
import argparse
from pathlib import Path
from datetime import datetime, timedelta

def generate_tick_data(filename, num_rows, symbol):
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


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate synthetic high-frequency tick data for a symbol."
    )
    parser.add_argument(
        "symbol",
        type=str,
        help="Trading symbol to embed in generated rows and output filename.",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=1_000_000,
        help="Number of rows to generate (default: 1000000).",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    symbol = args.symbol.strip().upper()
    output_file = Path(__file__).resolve().parent / f"{symbol}_ticks.csv"
    generate_tick_data(output_file, args.rows, symbol)


if __name__ == "__main__":
    main()
