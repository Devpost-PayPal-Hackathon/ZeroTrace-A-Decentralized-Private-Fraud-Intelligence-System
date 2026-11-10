pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";

template FraudThreshold() {
    signal input fraud_score;
    signal input threshold;
    signal output is_fraud;

    component gt = GreaterThan(8);
    gt.in[0] <== fraud_score;
    gt.in[1] <== threshold;

    is_fraud <== gt.out;
}

component main { public [threshold] } = FraudThreshold();