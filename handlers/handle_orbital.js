import BigComplex from "../../../sdk/math/BigComplex.js";
import FractoFastCalc from "../../../sdk/FractoFastCalc.js";

const prepare_derivation = (point) => {
  const P = new BigComplex(point.x, point.y);
  const q_minus = FractoFastCalc.calculate_big_cardioid_Q(point.x, point.y, -1);
  const Q_minus = new BigComplex(q_minus.x, q_minus.y);
  return { P, Q_minus };
};

const format_result = (point_list, Q_minus, cardinality, iterations) => {
  const negative_Q_minus = Q_minus.scale(-1);
  const mapped_list = point_list.map((point, step) => {
    const difference = point.add(negative_Q_minus);
    const offset = difference.magnitude();
    let scaled_difference = difference;
    if (offset < 0.000000000000001) {
      scaled_difference = difference.scale(10000000000000);
    }
    return {
      step,
      offset: offset.toString(),
      point: {
        re: point.re.toString(),
        im: point.im.toString(),
      },
      scaled_point: {
        re: scaled_difference.re.toString(),
        im: scaled_difference.im.toString(),
      },
    };
  });
  return {
    Q_minus,
    cardinality,
    iterations,
    point_list: mapped_list,
  };
};

const retro_derivation = (point, limit) => {
  const point_data = prepare_derivation(point);
  const { P, Q_minus } = point_data;

  const negative_P = P.scale(-1);
  const under_radical = Q_minus.add(negative_P);
  const root_Q_minus_P = under_radical.sqrt();

  const point_list = [];
  point_list.push(Q_minus);
  let seed = root_Q_minus_P.scale(-1);
  const all_points = {};
  for (let i = 1; i <= limit; i++) {
    const seed_minus_P = seed.add(negative_P);
    const sqrt_seed_minus_P = seed_minus_P.sqrt();
    seed = sqrt_seed_minus_P.scale(-1);
    const seed_str = seed.toString();
    if (all_points[seed_str] && i > 10) {
      const cardinality = i - all_points[seed_str];
      return format_result(point_list, Q_minus, cardinality, i);
    }
    all_points[seed_str] = i;
    point_list.push(seed);
  }
  return format_result(point_list, Q_minus, 0, limit);
};

/**
 * Adapt FractoFastCalc's stable orbit to the point-series response shape.
 * The calculator may include a repeated closing point. The returned list is
 * normalized to the detected cardinality and then explicitly closed with a
 * duplicate of its first point for chart rendering.
 * @param {{x:number,y:number}} point Mandelbrot parameter.
 * @returns {object} Fast-calculated orbital series.
 */
const fast_pro_derivation = (point) => {
  const calculation = FractoFastCalc.calc(point.x, point.y);
  const cardinality = Math.max(0, Number(calculation?.pattern) || 0);
  const point_list = (calculation?.orbital_points || [])
    .slice(0, cardinality)
    .map((value) => new BigComplex(value.x, value.y));
  if (point_list.length > 0) {
    point_list.push(new BigComplex(point_list[0].re, point_list[0].im));
  }
  const { Q_minus } = prepare_derivation(point);
  return format_result(
    point_list,
    Q_minus,
    cardinality,
    calculation?.iteration || 0,
  );
};

export const handle_orbital = (req, res) => {
  console.log("handle_orbital", req.query);
  try {
    const re = parseFloat(req.query.re);
    const im = parseFloat(req.query.im);
    const limit = parseFloat(req.query.limit);
    const point = { x: re, y: im };
    const result = retro_derivation(point, limit);
    res.status(200).json({ result });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error });
  }
};

export const handle_orbitals = (req, res) => {
  console.log("handle_orbitals", req.query);
  try {
    const re = parseFloat(req.query.re);
    const im = parseFloat(req.query.im);
    const limit = parseFloat(req.query.limit);
    const point = { x: re, y: im };
    const pro_derived = fast_pro_derivation(point);
    const result = { pro_derived };
    res.status(200).json({ result });
  } catch (error) {
    console.error("handle_orbitals", error.message);
    res.status(500).json({ error: error.message });
  }
};

// const test_point = {
//    x: -0.6897174395111918,
//    y: 0.27573049611632167,
// }
// const result = retro_derivation(test_point)
// console.log(result)
