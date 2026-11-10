import pandas as pd
import numpy as np
import random
random.seed(42)
np.random.seed(42)

rows = []
N = 200000
FRAUD_RATE = 0.15

type_map = {'CASH_IN':0,'CASH_OUT':1,'DEBIT':2,'PAYMENT':3,'TRANSFER':4}

def rand_amount():
    magnitude = random.choice([
        (10, 1000),
        (1000, 10000),
        (10000, 100000),
        (100000, 1000000),
        (1000000, 10000000),
    ])
    return round(random.uniform(*magnitude), 2)

def make_legit():
    tx_type = random.choice(['CASH_IN','CASH_OUT','DEBIT','PAYMENT','TRANSFER'])
    amount = rand_amount()

    if tx_type == 'CASH_IN':
        # receiving money — sender balance goes up
        old_org  = round(random.uniform(0, amount * 2), 2)
        new_org  = round(old_org + amount, 2)
        old_dest = round(random.uniform(amount, amount * 5), 2)
        new_dest = round(old_dest - amount, 2)  # source account loses it
    elif tx_type in ['CASH_OUT', 'PAYMENT', 'DEBIT']:
        # spending money — sender loses, no specific receiver credited
        old_org  = round(amount * random.uniform(1.1, 5.0), 2)
        new_org  = round(old_org - amount, 2)
        old_dest = round(random.uniform(0, amount * 3), 2)
        new_dest = old_dest  # merchant/system absorbs, dest unchanged
    else:  # TRANSFER
        # sending to another person — both balances change correctly
        old_org  = round(amount * random.uniform(1.1, 5.0), 2)
        new_org  = round(old_org - amount, 2)
        old_dest = round(random.uniform(0, amount * 3), 2)
        new_dest = round(old_dest + amount, 2)  # receiver gets it

    new_org  = max(new_org, 0.0)
    new_dest = max(new_dest, 0.0)
    if tx_type == 'CASH_IN':
        err_orig = round(abs(new_org - (old_org + amount)), 2)  # sender gains
    else:
        err_orig = round(abs(new_org - (old_org - amount)), 2)  # sender loses
    # for types where dest doesn't receive, error is 0 by design
    if tx_type in ['CASH_OUT', 'PAYMENT', 'DEBIT']:
        err_dest = 0.0
    elif tx_type == 'CASH_IN':
        err_dest = round(abs(new_dest - (old_dest - amount)), 2)  # source loses, so minus
    else:  # TRANSFER
        err_dest = round(abs(new_dest - (old_dest + amount)), 2)  # receiver gains, so plus

    return {
        'type': tx_type,
        'type_encoded': type_map[tx_type],
        'amount': amount,
        'oldbalanceOrg': old_org,
        'newbalanceOrig': new_org,
        'oldbalanceDest': old_dest,
        'newbalanceDest': new_dest,
        'errorBalanceOrig': err_orig,
        'errorBalanceDest': err_dest,
        'isFlaggedFraud': 0,
        'isFraud': 0,
    }

def make_fraud():
    # Fraud can happen in any type — the PATTERN is what matters
    # Sender drained + receiver never gets the money + balance mismatch
    tx_type  = random.choice(['CASH_IN','CASH_OUT','DEBIT','PAYMENT','TRANSFER'])
    amount   = rand_amount()
    old_org  = round(amount * random.uniform(1.0, 1.3), 2)  # sender had just enough
    new_org  = 0.0                                            # account fully drained
    old_dest = round(random.uniform(0, amount * 0.5), 2)
    new_dest = old_dest                                       # receiver never got the money
    err_orig = round(abs(new_org - (old_org - amount)), 2)   # big mismatch
    err_dest = round(abs(new_dest - (old_dest + amount)), 2) # big mismatch
    flagged  = 1 if amount > 200000 else 0

    return {
        'type': tx_type,
        'type_encoded': type_map[tx_type],
        'amount': amount,
        'oldbalanceOrg': old_org,
        'newbalanceOrig': new_org,
        'oldbalanceDest': old_dest,
        'newbalanceDest': new_dest,
        'errorBalanceOrig': err_orig,
        'errorBalanceDest': err_dest,
        'isFlaggedFraud': flagged,
        'isFraud': 1,
    }

print(f"Generating {N} transactions ({FRAUD_RATE*100:.0f}% fraud)...")
for i in range(N):
    if random.random() < FRAUD_RATE:
        rows.append(make_fraud())
    else:
        rows.append(make_legit())

df = pd.DataFrame(rows)
out = 'fraud_dataset.csv'
df.to_csv(out, index=False)
print(f"✅ Saved {out}")
print(f"Total: {len(df)} | Fraud: {df['isFraud'].sum()} | Legit: {(df['isFraud']==0).sum()}")
print(f"Amount ranges:")
print(df.groupby('isFraud')['amount'].describe()[['min','25%','50%','75%','max']])