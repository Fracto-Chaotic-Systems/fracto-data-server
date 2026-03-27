import WolframAlphaAPI from '@wolfram-alpha/wolfram-alpha-api'
import wolfram_config from '../../../config/wolfram.json' with {type: 'json'}

const waApi = WolframAlphaAPI(wolfram_config.AppID);

const SAMPLE_QUERY = 'find all complex roots of (((((z^2+z)^2+z)^2+z)^2+z)^2+z)^2+2z=0'
export const wolfram_query = async (query) => {
   const result = await waApi.getFull({
      input: query,
      podstate: 'Result__More+solutions',
      format: 'plaintext'
   })
   const solutions = result.pods.find(x => x.title === "Complex solutions")
   if (solutions) {
      console.log(solutions.subpods)
   }else {
      const solutions = result.pods.find(x => x.title === "Result")
      console.log(solutions.subpods)
      console.log(solutions.expressiontypes)
      console.log(solutions.states)
   }
}

wolfram_query(SAMPLE_QUERY)