import { trusted_mutation_origin } from "../../../utils/auth_request_origin.js";
import { handle_data_request } from "./data_requests/handler.js";

export const require_world_notes_origin = (req, res, next) => {
  if (trusted_mutation_origin(req, res)) return next();
};
// Browser writes are deliberately narrower than the private general editor.
// Normal configured service authentication runs before this route.
export function create_world_notes_handler({
  request_handler = handle_data_request,
} = {}) {
  return (req, res) => {
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, "notes") ||
      !Object.hasOwn(body, "expected_notes")
    )
      return res
        .status(400)
        .json({ error: "Notes and expected_notes are required" });
    return request_handler(
      {
        body: {
          operation: "update",
          table: "wordnet_mappings",
          key: { cardinality: Number(req.params.cardinality) },
          values: { notes: body.notes },
          expected: { notes: body.expected_notes },
        },
      },
      res,
    );
  };
}
export const handle_world_notes = create_world_notes_handler();
