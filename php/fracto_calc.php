<?php

ini_set('memory_limit', '-1');

include ("bcextra.php");

$theta_num = $argv[1];
$theta_den = $argv[2];
$r_num = $argv[3];
$r_den = $argv[4];

$precision = $argv[5];
$high_precision = round( 1.25 * $precision);

bcscale($precision);
echo("\n");

echo ("theta_num=$theta_num\n");
echo ("theta_den=$theta_den\n");
$theta = bcdiv($theta_num, $theta_den);
echo ("theta=$theta\n\n");

echo ("r_num=$r_num\n");
echo ("r_den=$r_den\n");
$r = bcdiv($r_num, $r_den);
echo ("r=$r\n\n");

function P_from_r_theta($r, $theta){
    $r_squared = bcmul($r, $r);
    $two_pi = bcmul("2", bcpi());
    $four_pi = bcmul("4", bcpi());
    $two_pi_theta = bcmul($two_pi, $theta);
    $four_pi_theta = bcmul($four_pi, $theta);
    $cos_two_pi_theta = bccos($two_pi_theta);
    $cos_four_pi_theta = bccos($four_pi_theta);
    $sin_two_pi_theta = bcsin($two_pi_theta);
    $r_by_2 = bcdiv($r, "2");
    $r_squared_by_four = bcdiv($r_squared, "4");
    $re_left = bcmul($r_by_2, $cos_two_pi_theta);
    $re_right = bcmul($r_squared_by_four, $cos_four_pi_theta);
    $im_first = bcmul("-1", $r_by_2);
    $im_second = bcmul($im_first, $sin_two_pi_theta);
    $r_times_cos_two_pi_theta = bcmul($r, $cos_two_pi_theta);
    $im_third = bcsub($r_times_cos_two_pi_theta, "1");
    return [
        're' => bcsub($re_left, $re_right),
        'im' => bcmul($im_second, $im_third)
    ];
}

function complex_sqrt($re, $im){
    $re_squared = bcmul($re, $re);
    $im_squared = bcmul($im, $im);
    $sum_squares = bcadd($re_squared, $im_squared);
    $r = bcsqrt($sum_squares);
    $r_plus_re = bcadd($r, $re);
    $r_plus_re_by_2 = bcdiv($r_plus_re, "2");
    $r_minus_re = bcsub($r, $re);
    $r_minus_re_by_2 = bcdiv($r_minus_re, "2");
    $sqrt_r_plus_re_by_2 = bcsqrt($r_plus_re_by_2);
    $sqrt_r_minus_re_by_2 = bcsqrt($r_minus_re_by_2);
    $im_number = new BcMath\Number($im);
    $sign_im = $im_number->compare("0");
    $scalar = $sign_im > 0 ? "1" : "-1";
    return [
        're' => $sqrt_r_plus_re_by_2,
        'im' => bcmul($scalar, $sqrt_r_minus_re_by_2)
    ];
}

function calculate_focal_Q ($re, $im){
    $negative_four_P_re = bcmul("-4", $re);
    $under_radical_re = bcadd($negative_four_P_re, "1");
    $under_radical_im = bcmul("-4", $im);
    $radical = complex_sqrt($under_radical_re, $under_radical_im);
    $radical_re = $radical['re'];
    $radical_im = $radical['im'];
    $negative_radical_re = bcmul($radical_re, "-1");
    $negative_radical_im = bcmul($radical_im, "-1");
    $one_plus_negative_radical_re = bcadd ($negative_radical_re, "1");
    return [
        're'=> bcmul($one_plus_negative_radical_re, "0.5"),
        'im'=> bcmul($negative_radical_im, "0.5")
    ];
   }

$P = P_from_r_theta($r, $theta);
// var_dump($P);

$focal_Q = calculate_focal_Q($P['re'], $P['im']);
// var_dump($focal_Q);

$FIB_SCALAR = 10000;
$MAX_ORBITAL = 25000;

$Q = [
    "re" => 0,
    "im" => 0
];
$iterations = 0;
$cardinality = 0;
$magnitude = new BcMath\Number("0");

function iterate_Q ($count){
    global $iterations;
    global $Q;
    global $P;
    global $precision;
    global $high_precision;
    for($i = 0; $i < $count; $i++) {
        $re_squared = bcmul($Q['re'], $Q['re'], $high_precision);
        $im_squared = bcmul($Q['im'], $Q['im'], $high_precision);
        $re_part = bcsub($re_squared, $im_squared, $high_precision);
        $re_times_im = bcmul($Q['re'], $Q['im'], $high_precision);
        $im_part = bcmul("2", $re_times_im, $high_precision);
        $re_final = bcadd($re_part, $P["re"], $high_precision);
        $im_final = bcadd($im_part, $P["im"], $high_precision);
        $Q = [
            "re" => bcround ($re_final, $precision),
            "im" => bcround ($im_final, $precision)
        ];
        $iterations += 1;
    }
    if ($count > 1) {
        echo("$iterations\n");
    }
}

function stringify($complex) {
    $re = $complex["re"];
    $im = $complex["im"];
    return "[$re, $im]";
}

function test_convergence(){
    global $MAX_ORBITAL;
    global $iterations;
    global $cardinality;
    global $Q;
    $first_Q = stringify($Q);
    for ($i = 1; $i <= $MAX_ORBITAL; $i++){
        iterate_Q(1);
        $string_Q = stringify($Q);
        if ($first_Q === $string_Q) {
            $cardinality = $i;
            return $cardinality;
        }
    }
    return 0;
}

function measure_orbital(){
    global $focal_Q;
    global $Q;
    global $magnitude;
    global $cardinality;
    global $precision;
    for ($i = 0; $i < $cardinality; $i++) {
        $re_diff = bcsub($focal_Q["re"], $Q["re"]);
        $im_diff = bcsub($focal_Q["im"], $Q["im"]);
        $re_squared = bcmul($re_diff, $re_diff, $precision * 2);
        $im_squared = bcmul($im_diff, $im_diff, $precision * 2);
        $sum_squares = bcadd($re_squared, $im_squared, $precision * 2);
        $test_magnitude = bcsqrt($sum_squares, $precision * 2);
        $magnitude_number = new BcMath\Number($test_magnitude);
        $is_bigger = $magnitude_number->compare($magnitude);
        if ($is_bigger > 0) {
            $magnitude = $magnitude_number;
        }
        iterate_Q(1);
    }
    return $magnitude;
}

function scientific_notation($value) {
    if( preg_match("/^0\.0*/",$value,$m)) {
        $zeroes = strlen($m[0]);
        $value = substr($value,$zeroes,1)
                    .rtrim(".".substr($value,$zeroes+1),"0.")
                    ."E-".($zeroes-1);
    }
    elseif( preg_match("/(\d+)(?:\.(\d+))?/",$value,$m)) {
        $zeroes = strlen($m[1]);
        if (array_key_exists(2, $m)) {
            $value = substr($value,0,1)
                        .rtrim(".".substr($m[1],1).$m[2],"0.")
                        ."E+".($zeroes-1);
        }
    }
    return $value;
}

$prev_fib = 1;
$curr_fib = 1;
$convergence = 0;
$start_time = microtime(true);
while (true) {
    $convergence = test_convergence ();
    if ($convergence) {
        echo("found pattern with $convergence points, $iterations iterations\n");
        break;
    }
    iterate_Q($curr_fib * $FIB_SCALAR);
    $temp_fib = $curr_fib;
    $curr_fib += $prev_fib;
    $prev_fib = $temp_fib;
}
$end_time = microtime(true);
$total_time_s = round(($end_time - $start_time) * 100) / 100;
if ($total_time_s) {
    $iterations_per_s = round($iterations / $total_time_s);
} else {
    $iterations_per_s = "all of the ";
}

if ($cardinality > 1) {
    $magnitude = measure_orbital();
}

echo("precision $precision\n");
echo("cardinality $cardinality\n");
$scientific_small = scientific_notation($magnitude);
echo("magnitude: $scientific_small\n");
echo("total time $total_time_s sec\n");
echo("$iterations_per_s iterations / sec\n");

$vectors_dir = __DIR__ . "/../vectors";
$vector_filename = "radian-$theta_den-$theta_num-$precision.csv";

$vector_filepath = "$vectors_dir/$vector_filename";
if (!file_exists($vector_filepath)){
    $header_row = "theta_num,theta_den,theta,r_num,r_den,r,P_re,P_im,focal_re,focal_im,seed_re,seed_im,precision,cardinality,iterations,magnitude\n";
    file_put_contents($vector_filepath, $header_row);
}
$P_re = $P["re"];
$P_im = $P["im"];
$focal_re = $focal_Q["re"];
$focal_im = $focal_Q["im"];
$seed_re = $Q["re"];
$seed_im = $Q["im"];
$row_data = "$theta_num,$theta_den,$theta,$r_num,$r_den,$r,$P_re,$P_im,$focal_re,$focal_im,$seed_re,$seed_im,$precision,$cardinality,$iterations,$scientific_small\n";
file_put_contents($vector_filepath, $row_data, FILE_APPEND | LOCK_EX);
