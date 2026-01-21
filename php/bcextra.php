<?php
/***************************************************************************/
/* Name : bcextra.php                                                      */
/* Uses : Additional BC math functions.                                    */
/* Date : 2013/05/16                                                       */
/* Author:                                                                 */
/*   Thomas Oldbury                                                        */
/*   Andrew Que <http://www.DrQue.net/>                                    */
/* Revisions:                                                              */
/*   0.? - ??/??/???? - TO - Creation.                                     */
/*   1.0 - 05/16/2013 - QUE - Actuary and speed improvements.              */
/*   1.1 - 05/23/2013 - QUE - Added sine, cosine and pi.                   */
/*   1.2 - 06/02/2013 - QUE - Improved sine/cosine.                        */
/*   1.3 - 2015/03/12 - QUE -                                              */
/*    + Turned into e trig functions.                                      */
/*    + Added inverse trig functions.                                      */
/*                                                                         */
/* Implements the following functions:                                     */
/*   Factorial -- x!                                                       */
/*   Exponential -- e^x                                                    */
/*   Natural log -- ln( x )                                                */
/*   Exponentiation -- a^x                                                 */
/*   Pi - 3.141592...                                                      */
/*   Sine -- sin( x )                                                      */
/*   Cosine -- cos( x )                                                    */
/*   Arcsine -- asin( x )                                                  */
/*   Arccosine -- acos( x )                                                */
/*   Arctangent -- atan( x )                                               */
/*                                                                         */
/* Notes:                                                                  */
/*   The basics of several functions were written by Thomas Oldbury (who   */
/*   released the functions to the public domain) and improved on by       */
/*   Andrew Que.                                                           */
/*                                                                         */
/* This project is maintained at:                                          */
/*    http://bcextra.drque.net/                                            */
/*                                                                         */
/* ----------------------------------------------------------------------- */
/*                                                                         */
/* BC Math Extra functions class.                                          */
/* Copyright (C) 2013,2015 Andrew Que                                      */
/*                                                                         */
/* This program is free software: you can redistribute it and/or modify    */
/* it under the terms of the GNU General Public License as published by    */
/* the Free Software Foundation, either version 3 of the License, or       */
/* (at your option) any later version.                                     */
/*                                                                         */
/* This program is distributed in the hope that it will be useful,         */
/* but WITHOUT ANY WARRANTY; without even the implied warranty of          */
/* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the           */
/* GNU General Public License for more details.                            */
/*                                                                         */
/* You should have received a copy of the GNU General Public License       */
/* along with this program.  If not, see <http://www.gnu.org/licenses/>.   */
/*                                                                         */
/* ----------------------------------------------------------------------- */
/*                                                                         */
/*                         (C) Copyright 2013,2015                         */
/*                               Andrew Que                                */
/***************************************************************************/

/**
 * Various arbitrary precision math functions.
 *
 * @author Andrew Que ({@link http://www.DrQue.net/})
 * @link http://bcextra.drque.net/ Project home page.
 * @copyright Copyright (c) 2013,2015, Andrew Que
 * @license http://opensource.org/licenses/gpl-license.php GNU Public License
 * @version 1.3
 *
 */

/**
 * Return the BC math scale.
 *
 * This function will return the last value passed to bcscale.
 *
 * @return int Current scale of BC math.
 */
function bcGetScale()
{
  return strlen( bcadd( 0, 0 ) ) - 2;
}

/**
 * Rounds a value to the number of places requested.
 * @param string $value Number to round.
 * @param int $places Number of digits to round.
 * @return string Rounded result.
 */
function bcRound_not( $value, $places )
{
  // Round result by adding 5*10^(-places).
  if ( -1 == bccomp( $value, "0" ) )
    $value = bcadd( $value, "-0." . str_pad( "", $places, "0" ) . "5" );
  else
    $value = bcadd( $value, "0." . str_pad( "", $places, "0" ) . "5" );

  // Split number into the whole and fractional parts.
  list( $integer, $fractional ) = explode( ".", $value );

  // If are result uses all the digits, cut off the last few used to account
  // for rounding error--they are incorrect anyway.
  if ( strlen( $fractional ) > $places )
  {
    $fractional = substr( $fractional, 0, $places );
    $value = $integer . "." . $fractional;
  }

  return $value;
}

/**
 * Negate value.
 *
 * @param string $value Number to negate.
 * @return string Negative value.
 */
function bcneg( $value )
{
  // Already negative?
  if ( '-' == $value[ 0 ] )
    $value = substr( $value, 1 );
  else
    $value = "-$value";

  return $value;
}

/**
 * Computes the factorial (x!).
 *
 * Can be used to compute factorial, or a partial factorial.  Partial
 * factorials are all numbers between two ranges multiplied together and
 * equivalent to:
 *   a! / b!
 *
 * @param int $fact Number to take factorial (a).
 * @param int $end Stopping point for factorial (b), default is 1.
 * @return string Factorial result.
 */
function bcfact( $fact, $end = null )
{
  $result = 1;

  if ( $end === null )
    $end = 1;

  while ( $fact != $end )
  {
    $result = bcmul( $result, $fact );
    --$fact;
  }

  return $result;
}

/**
 * Generate a random number between 0 and 1, with enough precision to fill
 * the scale being used.
 *
 * @return string Random number between 0 and 1.
 */
function bcrand()
{
  $scale = bcGetScale();

  // Using the random number generator scale, see how many iterations are
  // required to generate the number of digits for this bc scale.
  $loopTime = ceil( $scale / ( log( getrandmax() ) / log( 10 ) ) );
  $result = 0;
  while ( $loopTime-- )
  {
    $result = bcadd( $result, rand() );
    $result = bcdiv( $result, getrandmax() );
  }

  return $result;
}

/**
 * Computes e^x, where e is Euler's constant.
 *
 * @param string $x Exponent.
 * @return string Result of e^x.
 */
function bcexp( $x )
{
  // Turn up the scale for the duration of this function to avoid rounding
  // error.
  // $$$FUTURE - Arbitrary.  Test and determine what is actually needed.
  $scale = bcGetScale();
  bcscale( $scale + 5 );

  //
  // Algorithm is run in two parts.  Divide down value to something less than
  // 10 and compute it's exponent.  Second, multiply this answer by the number
  // of divides needed from the first step.
  //    exp( x ) = exp( x / 2^ilog2( x ) )^2^ilog2( x )
  // Where ilog2( x ) is the integer part of the log base 2 of x.
  // This step is needed because the exponential function is computer using
  // a series, and this series converges to the answer faster for small values.
  //

  // Compute:
  //   powerDrop = ilog2( x )
  //   x = x / ilog2( x )
  $powerDrop = 0;
  while ( 1 == bccomp( $x, "10" ) )
  {
    ++$powerDrop;
    $x = bcdiv( $x, 2 );
  }

  // Compute e^( x/ilog2( x ) ).
  // Uses the standard power series: e^x = sum from n=0 to infinity of x^n / n!.
  // Loop is run until the values no longer change (meaning precision has been
  // saturated).
  $newResult = 0;
  $result    = -1;
  $iteration = 0;
  $factorial = 1;
  $power     = 1;
  while ( bccomp( $newResult, $result ) )
  {
    $result = $newResult;
    $newResult =
      bcadd
      (
        $result,
        bcdiv
        (
          $power,
          $factorial
        )
      );

    $power = bcmul( $power, $x );

    ++$iteration;
    $factorial = bcmul( $factorial, $iteration );
  }

  // Account for halving.
  // Does: $result = bcpow( $result, pow( 2, $powerDrop ) );
  // But the bcpow function can be painfully slow, so it's faster to use
  // this loop.
  while ( $powerDrop-- )
    $result = bcmul( $result, $result );

  // Cut off the last few used to account for accumulated error--they are
  // incorrect anyway.
  $result = bcround( $result, $scale - 1 );

  bcscale( $scale );

  return $result;
}

/**
 * Computes ln(x).
 *
 * Using the series after an Euler transform because it converges to the
 * answer faster.
 *
 * @param string $value Power of e.
 * @return string Result of ln( x ).
 */
function bcln( $value )
{
  // Function uses ln( 10 ) which only needs to be recomputed if it hasn't been
  // already, or the scale has increased.  These static values hold the
  // computed state.
  static $ln10 = NAN;
  static $lastScale = 0;

  // Make sure value isn't negative.
  if ( 1 == bccomp( $value, 0 ) )
  {
    $scale = bcGetScale();
    bcscale( $scale + 5 );

    // Make sure value is a correctly formatted BC value.
    $value = bcadd( $value, 0 );

    // First we are going to do a quick and dirty integer log base-10.
    // The series used to compute the natural log converges fastest for
    // small values, so we want the value as small as we can.  We can use
    // this identity to our advantage:
    //   ln( a ) = ln( a / ilog10( a ) ) + ilog10( a ) * ln( 10 )
    // Also, this algorithm only works on values greater or equal to 1, so
    // fractional values are multiplied up.
    if ( 1 == bccomp( $value, 10 ) )
    {
      $position = strpos( "$value", "." );
      if ( ( $position === false )
        || ( $position > 1 ) )
      {
        if ( $position !== false )
        {
          $position -= 1;
          $value = str_replace( ".", "", "$value" );
        }
        else
          $position = strlen( "$value" ) - 1;

        $value = substr_replace( "$value", ".", 1, 0 );
      }
    }
    else
    if ( -1 == bccomp( $value, 1 ) )
    {
      $value = str_replace( ".", "", "$value" );
      $position = 0;
      while ( "0" == $value[ $position ] )
        ++$position;

      $value = substr( $value, $position );
      $position = -$position;
      $value = substr_replace( "$value", ".", 1, 0 );
    }
    else
      $position = 0;

    // No work to do if value is one.
    if ( 0 == bccomp( $value, 1 ) )
      $result = "0";
    else
    {
      $value = bcdiv( $value, bcsub( $value, 1 ) );
      $result = 1;
      $power  = $value;
      $iteration = 1;
      $newResult = 0;

      while ( bccomp( $newResult, $result ) )
      {
        $result = $newResult;
        $accumulator = bcdiv( 1, bcmul( $iteration, $power ) );
        $newResult = bcadd( $result, $accumulator );

        $power = bcmul( $power, $value );
        ++$iteration;
      }
    }

    if ( $position != 0 )
    {
      // Do we need to recompute ln( 10 )?
      // Done if it hasn't been done already, or the precision scale has
      // increased (we don't care if it decreased).
      if ( ( is_nan( $ln10 ) )
        || ( $lastScale < $scale ) )
      {
        $ln10 = bcln( 10 );
        $lastScale = $scale;
      }

      $accumulator = bcmul( $position, $ln10 );
      $result = bcadd( $result, $accumulator );
    }

    // Cut off the last few used to account for accumulated error--they are
    // incorrect anyway.
    $result = bcround( $result, $scale - 1 );

    bcscale( $scale );
  }
  else
    $result = NAN;

  return $result;
}

/**
 * Computes a^b, where a and b can have decimal digits, be negative and/or
 * very large.  Also works for 0^0.
 *
 * @param string $value Base of exponentiation.
 * @param string $power Exponent of exponentiation.
 * @return string Returns value^power.
 */
function bcpowx( $value, $power )
{
  $scale = bcGetScale();
  bcscale( $scale + 5 );

  $result = bcexp( bcmul( bcln( $value ), $power ) );

  // Cut off the last few used to account for accumulated error--they are
  // incorrect anyway.
  $result = bcround( $result, $scale - 1 );

  bcscale( $scale );

  return $result;
}

/**
 * Computes constant pi.
 *
 * Implementation uses Spigot algorithms.  Should converge rapidly.
 * Verified to 1000 decimal places.
 *
 * @param int $desiredScale Scale/number of digits.  Defaults to bcscale.
 * @return string Pi.
 */
function bcpi( $desiredScale = 0 )
{
  // Cache value of Pi so it is not recalculated if the scale isn't changed.
  static $pi = NAN;
  static $piScale = 0;

  // Turn up the scale for the duration of this function to avoid rounding
  // error.
  $scale = bcGetScale();

  // Has the scale increased?
  if ( ( $scale > $piScale )
    || ( $desiredScale > $piScale ) )
  {
    $piScale = max( $desiredScale, $scale );

    // $$$FUTURE - Arbitrary.  Test and determine what is actually needed.
    bcscale( $piScale + 5 );

    $index = 0;
    $newResult = 0;
    $result    = -1;
    while ( bccomp( $newResult, $result ) )
    {
      $result = $newResult;

      $accumulator =                      bcdiv( 4, ( 8 * $index + 1 ) );
      $accumulator = bcsub( $accumulator, bcdiv( 2, ( 8 * $index + 4 ) ) );
      $accumulator = bcsub( $accumulator, bcdiv( 1, ( 8 * $index + 5 ) ) );
      $accumulator = bcsub( $accumulator, bcdiv( 1, ( 8 * $index + 6 ) ) );
      $accumulator = bcmul( $accumulator, bcdiv( 1, bcpow( 16, $index ) ) );

      $newResult = bcadd( $newResult, $accumulator );
      $index += 1;
    }

    // Cut off the last few used to account for accumulated error--they are
    // incorrect anyway.
    $result = bcround( $result, $piScale - 1 );

    bcscale( $scale );

    $pi = $result;
  }

  return $pi;
}

/**
 * Computes cosine of x.
 *
 * @param string $x Value to take cosine/sine.
 * @param bool $isSine True if function should return sine rather than cosine.
 * @return string Cosine/sine of input.
 */
function bccos( $x, $isSine = false )
{
  // Cosine and sine repeat in intervals of 2*pi >= x >= -2*pi.  So reduce
  // input down to this range.
  // To do this, get the whole number of how many times two pi divides into the
  // value.  Then subtract off the whole number part times two pi.  This is a
  // modulus remainder, but bcmod only returns the integer part of the
  // remainder.
  $twoPi = bcmul( bcpi(), 2 );
  $mod = bcdiv( $x, $twoPi );
  list( $whole, $fractional ) = explode( '.', $mod );
  $x = bcsub( $x, bcmul( $whole, $twoPi ) );

  $correction = bcpi();

  // Modify the scale for additional accuracy.
  // Done after the interval has been reduced to avoid rounds errors with pi.
  $scale = bcGetScale();
  bcscale( $scale + 5 );

  //-----------------------------------
  // The Taylor series for cosine is as follows:
  //      inf
  //     \---   d^n           (x - b)^n
  //      >    ------ cos(x) -----------
  //     /---   dx^n             n!
  //      n=0
  // We use the Taylor series to compute cosine.  We could use the Maclaurin
  // series, but this converges slowly at points close to pi.  So we center
  // on one of four points: 0, pi/2, pi, and 3/2 pi.  This is done because the
  // nth derivative is easy to compute at these points: it simply alternates
  // between 1, 0 and -1.  Where it starts depends on what value the input is
  // closest to.
  //-----------------------------------

  // First, figure out which point the input value is closest to.
  // NOTE: Regular numbers used here, not BC numbers.  No reason to be that
  // that accurate yet.
  $taylorIndex = 0;
  $taylorPoint = pi() * 7/4;
  $halfPi = pi() / 2;
  while ( $taylorPoint >= $x )
  {
    $taylorPoint -= $halfPi;
    $taylorIndex += 1;
  }

  // Figure out what point we are starting.
  // Now the value is needed as a BC number.
  $taylorPoint = 2 - $taylorIndex / 2;
  $taylorPoint = bcmul( $taylorPoint, bcpi() );

  // The index for what the nth derivative will be.
  // Note that $taylorIndex is subtracted by one in order to iterate it.  This
  // is the same as adding 3 and doing a modulus by 4.
  $taylorIndex %= 4;

  // To do sine rather than cosine, simply add one to the starting index.
  if ( $isSine )
    $taylorIndex = ( $taylorIndex + 1 ) % 4;

  // This is a look-up table for the derivatives.
  $taylorIndexMap = array( 1, 0, -1, 0 );

  // Setup the series variables.
  $x = bcsub( $x, $taylorPoint );
  $power = 1;
  $newResult = 0;
  $result = -1; // <- Something not equal to $newResult
  $n = 0;
  $fact = 1;
  while ( bccomp( $newResult, $result ) )
  {
    // Get the nth derivative of the Taylor point.
    $derivative = $taylorIndexMap[ $taylorIndex ];

    // Don't bother doing any addition of derivative is zero.
    if ( 0 != $derivative )
    {
      $result = $newResult;

      if ( -1 == $derivative )
        $accumulator = bcneg( $power );
      else
        $accumulator = $power;

      $accumulator = bcdiv( $accumulator, $fact );
      $newResult   = bcadd( $result, $accumulator );
    }

    $n += 1;
    $power = bcmul( $power, $x );
    $fact = bcmul( $fact, $n );
    $taylorIndex = ( $taylorIndex + 3 ) % 4;
  }

  // Cut off the last few used to account for accumulated error--they are
  // incorrect anyway.
  $result = bcround( $result, $scale - 1 );

  bcscale( $scale );

  return $result;

}

/**
 * Computes cosine of x.
 *
 * @param string $x Value to take sine.
 * @return string Cosine/sine of input.
 */
function bcsin( $x )
{
  return bccos( $x, true );
}

/**
 * Computes tangent of x.
 *
 * @param string $x Value to take tangent.
 * @return string Tangent of input.
 */
function bctan( $x )
{
  return bcdiv( bccos( $x ), bcsin( $x ) );
}

/**
 * Computes inverse tangent (arctangent/atan) of x.
 *
 * @param string $x Value to take arctangent.
 * @return string Arctangent of input.
 */
function bcatan( $x )
{
  // Modify the scale for additional accuracy.
  // Done after the interval has been reduced to avoid rounds errors with pi.
  $scale = bcGetScale();
  bcscale( $scale + 3 );

  if ( bccomp( $x, 0 ) != 0 )
  {
    // The series slows down for numbers further from zero.  So for any value
    // greater than 1, use this identity:
    //                / -pi/2 - atan( 1/x ),       x < -1
    //    atan( x ) = | atan( x ),           -1 <= x <= 1
    //                \ pi/2 - atan( 1/x ),        x > 1
    // This forces the input to always be between -1 and 1, where the series
    // converges most quickly.
    $inverse = false;
    if ( ( bccomp( $x, 1 ) > 0 )
      || ( bccomp( $x, -1 ) < 0 ) )
    {
      $inverse = true;
      $x = bcdiv( 1, $x );
    }

    // Calculate the inverse tangent using Castellanos series for arctan.
    //                inf
    //               \---  2^(2 n) (n!)^2      x^(2 n + 1)
    //   atan( x ) =  >   ---------------- -------------------
    //               /---     2 n + 1       (1 + x^2)^(n + 1)
    //                n=0

    // Couple of constants.
    $xFactor  = bcadd( bcmul( $x, $x ), 1 );
    $xSquared = bcmul( $x, $x );

    // Loop variables.
    $newResult = 0;
    $result = -1; // <- Something not equal to $newResult
    $n = 0;
    $factorial    = 1;
    $oddFactorial = 1;
    $xNumerator   = $x;
    $xDenominator = $xFactor;
    $pow2         = 1;

    while ( bccomp( $newResult, $result ) )
    {
      $result = $newResult;

      $accumulator = bcmul( $factorial, $factorial );
      $accumulator = bcmul( $accumulator, $pow2 );
      $accumulator = bcmul( $accumulator, $xNumerator );
      $accumulator = bcdiv( $accumulator, $oddFactorial );
      $accumulator = bcdiv( $accumulator, $xDenominator );

      $newResult = bcadd( $newResult, $accumulator );

      $n += 1;
      $pow2 = bcmul( $pow2, 4 );
      $factorial    = bcmul( $factorial, $n );
      $oddFactorial = bcmul( $oddFactorial, 2 * $n + 0 );
      $oddFactorial = bcmul( $oddFactorial, 2 * $n + 1 );
      $xNumerator   = bcmul( $xNumerator, $xSquared );
      $xDenominator = bcmul( $xDenominator, $xFactor );
    }

    if ( $inverse )
    {
      $accumulator = bcdiv( bcpi(), 2 );
      if ( $x < 0 )
        $accumulator = bcneg( $accumulator );

      $newResult = bcsub( $accumulator, $newResult );
    }
  }
  else
    $newResult = NAN;

  // Cut off the last few used to account for accumulated error--they are
  // incorrect anyway.
  $newResult = bcround( $newResult, $scale - 1 );

  bcscale( $scale );

  return $newResult;
}

/**
 * Computes inverse sine (arcsin) of x.
 *
 * @param string $x Value to take arcsine.
 * @return string Arcsine of input.
 */
function bcasin( $x )
{
  // Apply half-angle formula, and use arctan.
  $denominator = bcmul( $x, $x );
  $denominator = bcsub( 1, $denominator );
  $denominator = bcsqrt( $denominator );
  $denominator = bcadd( 1, $denominator );
  $x = bcdiv( $x, $denominator );
  $x = bcatan( $x );
  $x = bcmul( $x, 2 );

  return $x;
}

/**
 * Computes inverse sine (arcsin) of x.
 *
 * @param string $x Value to take arccosine.
 * @return string Arccosine of input.
 */
function bcacos( $x )
{
  if ( bccomp( -1, $x ) == 0 )
    $x = bcpi();
  else
  if ( bccomp( $x, -1 ) > 0 )
  {
    // Apply half-angle formula, and use arctan.
    $denominator = bcadd( $x, 1 );
    $numerator = bcmul( $x, $x );
    $numerator = bcsub( 1, $numerator );
    $numerator = bcsqrt( $numerator );
    $x = bcdiv( $numerator, $denominator );
    $x = bcatan( $x );
    $x = bcmul( $x, 2 );
  }

  return $x;
}

// "To those who ask what the infinitely small quantity in mathematics is, we
// answer that it is actually zero. Hence there are not so many mysteries
// hidden in this concept as they are usually believed to be."
// -- Leonhard Euler

?>