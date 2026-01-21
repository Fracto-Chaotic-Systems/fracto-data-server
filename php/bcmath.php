<?php

function factorial($n) {
    $result = "1";
    for ($i = 1; $i <= $n; $i++) {
        $result = bcmul($result, "$n");
    }
    return $result;
}

function bcsin ($x, $decimals = 32) {
    $p = "0";
    bcscale($decimals);
    $is_negative = false;
    for ($n = 0; $n <= $decimals; $n++) {
        $two_n_plus_1 = 2 * $n + 1;
        $two_n_plus_1_factorial = factorial($two_n_plus_1);
        $x_to_2_n_plus_1 = bcpow($x, "$two_n_plus_1");
        $quotient = bcdiv($x_to_2_n_plus_1, $two_n_plus_1_factorial);
        $p = $is_negative ? bcsub($p, $quotient) : bcadd($p, $quotient);
        echo("p=$p\n")
        $is_negative = !$is_negative;
    }
    return $p;
}

// def cos_taylor(x, decimals):
//     p = 0
//     getcontext().prec = decimals
//     for n in range(decimals):
//         p += Decimal(((-1)**n)*(x**(2*n)))/(Decimal(math.factorial(2*n)))
//     return p