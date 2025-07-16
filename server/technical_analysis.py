import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime
from googletrans import Translator
import sys
import io

# Encoding configuration
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Initialize MetaTrader 5
if not mt5.initialize():
    print("❌ Failed to initialize MetaTrader 5")
    quit()

# Parameters
timeframe = mt5.TIMEFRAME_M15  # Changed to 15-minute candles
symbol = "XAUUSDb"
dxy_symbol = "DXY.spot"
usdchf_symbol = "USDCHFb"
usd_pairs = [
    "AUDUSDb", "EURUSDb", "GBPUSDb", "NZDUSDb",
    "USDCADb", "USDCHFb", "USDCNHb", "USDJPYb"
]
lookback = 50
n_bars = 100
risk_reward = 2

# Translator initialization
translator = Translator()

# === Helper Functions ===
def get_rates(symbol, n):
    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, n)
    if rates is None or len(rates) == 0:
        print(f"❌ No data for {symbol}")
        return None
    df = pd.DataFrame(rates)
    df['time'] = pd.to_datetime(df['time'], unit='s')
    return df

def calculate_ema_rsi(df, ema_period=50, rsi_period=14):
    df['ema'] = df['close'].ewm(span=ema_period).mean()
    delta = df['close'].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=rsi_period).mean()
    avg_loss = loss.rolling(window=rsi_period).mean()
    rs = avg_gain / avg_loss
    df['rsi'] = 100 - (100 / (1 + rs))
    return df

def calculate_momentum_roc(df, momentum_period=10, roc_period=10):
    df['momentum'] = df['close'] - df['close'].shift(momentum_period)
    df['roc'] = df['close'].pct_change(periods=roc_period) * 100
    return df

def get_atr(df, period=14):
    df['tr'] = df['high'] - df['low']
    df['atr'] = df['tr'].rolling(window=period).mean()
    return df['atr'].iloc[-1]

def translate_to_persian(text):
    try:
        result = translator.translate(text, dest='fa')
        return result.text
    except:
        return text

def explain_signals(avg_usd, dxy_chg, xau_chg, close, ema, rsi, usdchf_chg, momentum, roc):
    buy_reasons, sell_reasons = [], []
    buy_score = sell_score = 0

    if avg_usd < 0:
        buy_score += 1
        buy_reasons.append("🟢 دلار ضعیف")
    else:
        sell_score += 1
        sell_reasons.append("🔴 دلار قوی")

    if dxy_chg < 0:
        buy_score += 1
        buy_reasons.append("🟢 شاخص دلار در حال کاهش")
    else:
        sell_score += 1
        sell_reasons.append("🔴 شاخص دلار در حال افزایش")

    if xau_chg > 0:
        buy_score += 1
        buy_reasons.append("🟢 طلا در حال افزایش")
    else:
        sell_score += 1
        sell_reasons.append("🔴 طلا در حال کاهش")

    if close > ema:
        buy_score += 1
        buy_reasons.append("🟢 قیمت > میانگین متحرک")
    else:
        sell_score += 1
        sell_reasons.append("🔴 قیمت < میانگین متحرک")

    if rsi < 30:
        buy_score += 1
        buy_reasons.append("🟢 RSI < 30 (فروش بیش از حد)")
    elif rsi > 70:
        sell_score += 1
        sell_reasons.append("🔴 RSI > 70 (خرید بیش از حد)")

    if usdchf_chg > 0:
        sell_score += 1
        sell_reasons.append("🔴 USDCHF در حال افزایش → USD قوی → XAUUSD پایین")
    else:
        buy_score += 1
        buy_reasons.append("🟢 USDCHF در حال کاهش → USD ضعیف → XAUUSD بالا")

    if momentum > 0:
        buy_score += 1
        buy_reasons.append("🟢 مومنتوم مثبت")
    else:
        sell_score += 1
        sell_reasons.append("🔴 مومنتوم منفی")

    if roc > 0:
        buy_score += 1
        buy_reasons.append("🟢 ROC مثبت")
    else:
        sell_score += 1
        sell_reasons.append("🔴 ROC منفی")

    buy_prob = buy_score / 8 * 100
    sell_prob = sell_score / 8 * 100

    return buy_prob, sell_prob, buy_reasons, sell_reasons

# === Signal Generation ===
df_xau = get_rates(symbol, n_bars)
df_dxy = get_rates(dxy_symbol, n_bars)
df_usdchf = get_rates(usdchf_symbol, n_bars)

if df_xau is None or df_dxy is None or df_usdchf is None:
    mt5.shutdown()
    quit()

df_xau = calculate_ema_rsi(df_xau)
df_xau = calculate_momentum_roc(df_xau)
atr = get_atr(df_xau)

# USD strength calculation
usd_strengths = []
for pair in usd_pairs:
    df = get_rates(pair, lookback)
    if df is not None and len(df) >= lookback:
        pct = ((df['close'].iloc[-1] - df['close'].iloc[0]) / df['close'].iloc[0]) * 100
        strength = pct if pair.startswith("USD") else -pct
        usd_strengths.append(strength)

avg_usd_strength = sum(usd_strengths) / len(usd_strengths) if usd_strengths else 0

# Percent changes
dxy_chg = ((df_dxy['close'].iloc[-1] - df_dxy['close'].iloc[-lookback]) / df_dxy['close'].iloc[-lookback]) * 100
xau_chg = ((df_xau['close'].iloc[-1] - df_xau['close'].iloc[-lookback]) / df_xau['close'].iloc[-lookback]) * 100
usdchf_chg = ((df_usdchf['close'].iloc[-1] - df_usdchf['close'].iloc[-lookback]) / df_usdchf['close'].iloc[-lookback]) * 100

# Current values
close = df_xau['close'].iloc[-1]
ema = df_xau['ema'].iloc[-1]
rsi = df_xau['rsi'].iloc[-1]
momentum = df_xau['momentum'].iloc[-1]
roc = df_xau['roc'].iloc[-1]
time = df_xau['time'].iloc[-1]

# Signal evaluation
buy_prob, sell_prob, buy_reasons, sell_reasons = explain_signals(
    avg_usd_strength, dxy_chg, xau_chg, close, ema, rsi, usdchf_chg, momentum, roc
)

# Output results
print(f"\n📊 تحلیل سیگنال در تاریخ {time}")
print(f"قیمت: {close:.2f} | دامنه نوسان: {atr:.2f}")
print(f"احتمال خرید: {buy_prob:.0f}٪ | احتمال فروش: {sell_prob:.0f}٪")

print("\n🧩 دلایل خرید:")
for r in buy_reasons:
    print(f" - {r}")

print("\n🧩 دلایل فروش:")
for r in sell_reasons:
    print(f" - {r}")

# Trading decisions with 1:2 risk-reward
if buy_prob == 100 and sell_prob < 100:
    sl = close - atr
    tp = close + atr * risk_reward
    print(f"\n✅ سیگنال قوی خرید")
    print(f"➡️ نقطه ورود: {close:.2f} | حد سود: {tp:.2f} | حد ضرر: {sl:.2f}")
elif sell_prob == 100 and buy_prob < 100:
    sl = close + atr
    tp = close - atr * risk_reward
    print(f"\n✅ سیگنال قوی فروش")
    print(f"➡️ نقطه ورود: {close:.2f} | حد سود: {tp:.2f} | حد ضرر: {sl:.2f}")
elif sell_prob >= 80:
    sl = close + atr
    tp = close - atr * risk_reward
    print(f"\n⚠️ احتمال سیگنال فروش")
    print(f"➡️ نقطه ورود: {close:.2f} | حد سود: {tp:.2f} | حد ضرر: {sl:.2f}")
elif buy_prob >= 80:
    sl = close - atr
    tp = close + atr * risk_reward
    print(f"\n⚠️ احتمال سیگنال خرید")
    print(f"➡️ نقطه ورود: {close:.2f} | حد سود: {tp:.2f} | حد ضرر: {sl:.2f}")
else:
    print("\n⚠️ هیچ سیگنال قوی یافت نشد.")

# Shutdown MetaTrader 5
mt5.shutdown()