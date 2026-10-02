import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { audit_legacy_span_catalog, parse_legacy_span_catalog } from "./legacy_span_catalog.js";

export const audit_legacy_span_file = async ({ file_path, output_path }) => {
  if (!file_path) throw new Error("Supply a source spans.json file path");
  const absolute_path = resolve(file_path);
  const source = await readFile(absolute_path, "utf8");
  const report = audit_legacy_span_catalog(parse_legacy_span_catalog(source, absolute_path));
  if (output_path) await writeFile(resolve(output_path), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
};

const is_main = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (is_main) {
  const args = process.argv.slice(2);
  const file_path = args.find((arg) => !arg.startsWith("--"));
  const output_index = args.indexOf("--output");
  const output_path = output_index >= 0 ? args[output_index + 1] : undefined;
  try {
    const report = await audit_legacy_span_file({ file_path, output_path });
    if (output_path) {
      console.log(JSON.stringify({
        report_path: resolve(output_path),
        source_version: report.source_version,
        source_sha256: report.source_sha256,
        source_entry_count: report.source_entry_count,
        summary: report.summary,
      }, null, 2));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } catch (error) {
    console.error(`Legacy logistic-map span audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
