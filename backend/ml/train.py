import pandas as pd
import numpy as np
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import classification_report, roc_auc_score
import pickle, os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(os.path.join(BASE_DIR, 'fraud_dataset.csv'))
print(f"Loaded {len(df)} rows")

df = df[df['type'].isin(['TRANSFER','CASH_OUT','PAYMENT','DEBIT'])].copy()
type_map = {'CASH_IN':0,'CASH_OUT':1,'DEBIT':2,'PAYMENT':3,'TRANSFER':4}
df['type_encoded'] = df['type'].map(type_map).fillna(3).astype(float)
df['errorBalanceOrig'] = abs(df['newbalanceOrig'] - (df['oldbalanceOrg'] - df['amount']))
df['errorBalanceDest'] = abs(df['newbalanceDest'] - (df['oldbalanceDest'] + df['amount']))

NUMERICAL_COLS = ['amount','oldbalanceOrg','newbalanceOrig','oldbalanceDest','newbalanceDest','errorBalanceOrig','errorBalanceDest']
scaler = MinMaxScaler()
df[NUMERICAL_COLS] = scaler.fit_transform(df[NUMERICAL_COLS])

FEATURE_NAMES = ['amount','type_encoded','oldbalanceOrg','newbalanceOrig','oldbalanceDest','newbalanceDest','errorBalanceOrig','errorBalanceDest','isFlaggedFraud']
X = df[FEATURE_NAMES].values.astype(float)
y = df['isFraud'].values.astype(int)

X_train,X_test,y_train,y_test = train_test_split(X,y,test_size=0.2,random_state=42,stratify=y)
scale_pos_weight = int((y==0).sum()) / int((y==1).sum())

model = XGBClassifier(n_estimators=300,max_depth=6,learning_rate=0.1,subsample=0.8,
    colsample_bytree=0.8,scale_pos_weight=scale_pos_weight,eval_metric='logloss',
    random_state=42,n_jobs=-1)

print("Training... (5-10 mins)")
model.fit(X_train,y_train,eval_set=[(X_test,y_test)],verbose=50)

y_proba = model.predict_proba(X_test)[:,1]
print(f"\nROC-AUC: {roc_auc_score(y_test,y_proba):.4f}")

fraud_rows = df[df['isFraud']==1]
legit_rows = df[df['isFraud']==0]

df_raw = pd.read_csv(os.path.join(BASE_DIR, 'fraud_dataset.csv'))
fraud_raw = df_raw[df_raw['isFraud']==1]
legit_raw = df_raw[df_raw['isFraud']==0]

SUSPICIOUS_PRESET = {f: round(float(fraud_raw[f].median()),6) for f in FEATURE_NAMES}
SUSPICIOUS_PRESET['isFlaggedFraud'] = 1
NORMAL_PRESET = {f: round(float(legit_raw[f].median()),6) for f in FEATURE_NAMES}
NORMAL_PRESET['isFlaggedFraud'] = 0

bundle = {'model':model,'feature_names':FEATURE_NAMES,'scaler':scaler,
    'numerical_cols':NUMERICAL_COLS,'normal_preset':NORMAL_PRESET,
    'suspicious_preset':SUSPICIOUS_PRESET,'type_map':type_map}

out = os.path.join(BASE_DIR,'model_own.pkl')
with open(out,'wb') as f: pickle.dump(bundle,f)
print(f"\n✅ Saved {out}")
print(f"suspicious_preset: {SUSPICIOUS_PRESET}")
print(f"normal_preset: {NORMAL_PRESET}")