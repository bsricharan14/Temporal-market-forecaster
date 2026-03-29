import os
import time
import pandas as pd
import psycopg2
from dotenv import load_dotenv

# Load credentials from your .env file
load_dotenv()

DB_HOST = "127.0.0.1"
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "market_db")
DB_USER = os.getenv("DB_USER", "user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

# UPDATE THIS PATH if your CSV is in a different folder
CSV_FILE_PATH = "DAT_ASCII_EURUSD_T_202601.csv" 
SYMBOL_NAME = "EUR/USD"

def simulate_live_feed():
    print("🔌 Connecting to TimescaleDB...")
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        # Autocommit ensures each tick is saved instantly, like a real live stream
        conn.autocommit = True 
        cursor = conn.cursor()
        print("✅ Connected successfully!\n")

        print(f"📂 Loading data from {CSV_FILE_PATH}...")
        
        # HistData CSVs have no headers. We explicitly name the columns here.
        df = pd.read_csv(CSV_FILE_PATH, header=None, names=['raw_time', 'bid', 'ask', 'volume'])
        
        print(f"📝 Registering '{SYMBOL_NAME}' in the master symbols table...")
        cursor.execute("INSERT INTO symbols (symbol) VALUES (%s) ON CONFLICT DO NOTHING;", (SYMBOL_NAME,))
        
        print(f"📊 Found {len(df)} rows! Starting live tick simulation (Press Ctrl+C to stop)...")
        
        # Loop through the CSV rows (itertuples is much faster than iterrows)
        for row in df.itertuples():
            insert_query = """
                INSERT INTO market_ticks (time, symbol, price, volume)
                VALUES (NOW(), %s, %s, %s);
            """
            
            # We use the 'bid' price (column B in your spreadsheet) as the market price
            current_price = row.bid
            # FIX: Force volume to be at least 1 so the database accepts it
            current_volume = max(1.0, float(row.volume))
            
            cursor.execute(insert_query, (SYMBOL_NAME, current_price, current_volume))
            
            print(f"[{pd.Timestamp.now().strftime('%H:%M:%S.%f')[:-3]}] Inserted TICK | {SYMBOL_NAME} | Price: ${current_price} | Vol: {current_volume}")
            
            # Pause for 0.5 seconds to simulate a live market feed
            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\n🛑 Simulation stopped by user.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
    finally:
        if 'conn' in locals() and conn:
            cursor.close()
            conn.close()
            print("🔒 Database connection closed.")

if __name__ == "__main__":
    simulate_live_feed()