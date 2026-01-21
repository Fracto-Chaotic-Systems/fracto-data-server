<?php

include ("bcextra.php");

$theta_num = $argv[1];
$theta_den = $argv[2];
$r_num = $argv[3];
$r_den = $argv[4];
$precision = $argv[5];

echo ("theta_num=$theta_num\n");
echo ("theta_den=$theta_den\n");
echo ("r_num=$r_num\n");
echo ("r_den=$r_den\n");
echo ("precision=$precision\n");
echo ("\n");

bcscale($precision);

$theta = bcdiv($theta_num, $theta_den);
echo ("theta=$theta\n");

$r = bcdiv($r_num, $r_den);
echo ("r=$r\n");

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
var_dump($P);

$focal_Q = calculate_focal_Q($P['re'], $P['im']);
var_dump($focal_Q);

$FIB_SCALAR = 10000;
$MAX_ORBITAL = 25000;

$Q = [
    "re" => 0,
    "im" => 0
];
$iterations = 0;

function iterate_Q ($count){
    global $iterations;
    global $Q;
    for($i = 0; $i < $count; $i++) {

//       const re_left_part = this.re.mul(this.re);
//       const re_right_part = this.im.mul(this.im);
//       const re_part = re_left_part.sub(re_right_part);
//       const im_left_part = this.re.mul(this.im);
//       const im_right_part = this.im.mul(this.re);
//       const im_part = im_left_part.add(im_right_part);
//       this.re = re_part.add(z.re)
//       this.im = im_part.add(z.im)
    }
    echo("$iterations\n");
}

function stringify($complex) {
    $re = $complex["re"];
    $im = $complex["im"];
    return "[$re, $im]";
}

function test_convergence(){
    global $iterations;
    global $Q;
    $string_Q = stringify($Q);
    $all_Qs = [
        $string_Q => $iterations
    ];
    for ($i = 0; $i < $MAX_ORBITAL; $i++){
        iterate_Q(1);
        $string_Q = stringify($Q);
        if ($all_Qs[$string_Q]) {
            return $iterations - $all_Qs[$string_Q];
        }
        $all_Qs[$string_Q] = $iterations;
    }

    var_dump($all_Qs);
    return true;
}

$prev_fib = 1;
$curr_fib = 1;
$convergence = 0;
while (true) {
    $convergence = test_convergence ();
    if ($convergence) {
        break;
    }
    iterate_Q($curr_fib * $FIB_SCALAR);
    $temp_fib = $curr_fib;
    $curr_fib += $prev_fib;
    $prev_fib = $temp_fib;
}

