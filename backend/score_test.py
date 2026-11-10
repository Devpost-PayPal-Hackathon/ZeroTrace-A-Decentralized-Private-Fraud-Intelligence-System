import json, urllib.request

rows = json.load(open('ml/sample_transactions.json'))
correct = 0

for i, row in enumerate(rows):
    actual = row.pop('_actual_class')
    body = json.dumps(row).encode()
    req = urllib.request.Request(
        'http://localhost:8000/fraud/score',
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    res = json.loads(urllib.request.urlopen(req).read())
    predicted = 1 if res['is_fraud'] else 0
    correct += predicted == actual

    if actual == 1 and predicted == 1:
        status = 'TRUE FRAUD'
    elif actual == 0 and predicted == 0:
        status = 'TRUE LEGIT'
    elif actual == 1 and predicted == 0:
        status = 'MISSED FRAUD'
    else:
        status = 'FALSE ALARM'

    print(f"[{i+1:02d}] actual={actual} score={res['fraud_score']} is_fraud={res['is_fraud']} -> {status}")

print(f"\nAccuracy: {correct}/{len(rows)} = {correct/len(rows)*100:.1f}%")
