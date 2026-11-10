import pickle
import numpy as np
import pandas as pd
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

TEMPLATES = {
    'amount':           'transaction amount is ${val:.2f}',
    'amount_ratio':     'amount is {val:.1f}x the average transaction',
    'hour':             'transaction placed at an unusual hour ({val}:00)',
    'is_new_recipient': 'recipient has never been paid before',
    'velocity_1h':      '{val} transactions occurred in the last hour',
    'velocity_24h':     '{val} transactions in the last 24 hours',
    'geo_anomaly':      'transaction originated from an unusual country',
    'device_mismatch':  'device fingerprint does not match usual device',
    'is_round_amount':  'amount is a suspicious round number',
}

def load_model():
    with open(os.path.join(BASE_DIR, 'model.pkl'), 'rb') as f:
        return pickle.load(f)

def score_transaction(tx: dict) -> dict:
    """
    tx: dict with keys matching ZeroTrace features
    returns: { fraud_score, risk_factors, explanation }
    """
    bundle = load_model()
    model = bundle['model']
    feature_names = bundle['feature_names']

    row = pd.DataFrame([{f: tx.get(f, 0) for f in feature_names}])
    fraud_score = float(model.predict_proba(row)[0][1])

    # Top 3 features by importance
    importances = model.feature_importances_
    top_indices = np.argsort(importances)[::-1][:3]
    top_features = [feature_names[i] for i in top_indices]

    # Build explanation
    parts = []
    for feat in top_features:
        val = tx.get(feat, 0)
        if feat in ('is_new_recipient', 'geo_anomaly', 'device_mismatch', 'is_round_amount'):
            if val:
                parts.append(TEMPLATES[feat])
        else:
            parts.append(TEMPLATES[feat].format(val=val))

    explanation = ('Flagged because ' + ', '.join(parts) + '.') if parts else 'No major risk factors detected.'

    return {
        'fraud_score': round(fraud_score, 4),
        'risk_factors': top_features,
        'explanation': explanation,
        'is_fraud': fraud_score > 0.75
    }


if __name__ == '__main__':
    # Quick test
    test_tx = {
        'amount': 1200.00,
        'amount_ratio': 8.5,
        'hour': 3,
        'is_new_recipient': 1,
        'velocity_1h': 3,
        'velocity_24h': 3,
        'geo_anomaly': 1,
        'device_mismatch': 1,
        'is_round_amount': 1,
    }
    result = score_transaction(test_tx)
    print(f"Fraud score: {result['fraud_score']}")
    print(f"Risk factors: {result['risk_factors']}")
    print(f"Explanation: {result['explanation']}")
    print(f"Is fraud: {result['is_fraud']}")