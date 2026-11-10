import pandas as pd
import numpy as np

df = pd.read_csv('ml/creditcard.csv')
fraud = df[df['Class'] == 1]
legit = df[df['Class'] == 0]

print('=== Key V-feature thresholds ===')
for col in ['V3','V4','V10','V14','V17']:
    f_mean = fraud[col].mean()
    l_mean = legit[col].mean()
    f_pct = (fraud[col] < -1.0).mean()*100
    l_pct = (legit[col] < -1.0).mean()*100
    print(f'{col}: fraud_mean={f_mean:.3f}, legit_mean={l_mean:.3f}, fraud<-1={f_pct:.1f}%, legit<-1={l_pct:.1f}%')

print()
print('V14 thresholds:')
for t in [-1.0, -2.0, -3.0, -4.0]:
    print(f'  V14<{t}: fraud={(fraud["V14"]<t).mean()*100:.1f}%, legit={(legit["V14"]<t).mean()*100:.2f}%')

print()
print('V17 thresholds:')
for t in [-0.5, -1.0, -1.5, -2.0]:
    print(f'  V17<{t}: fraud={(fraud["V17"]<t).mean()*100:.1f}%, legit={(legit["V17"]<t).mean()*100:.2f}%')