import path from "node:path";
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { getAiLogsPath } from "../storage/root-layout.js";
function appendJsonLine(filePath, record) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(filePath, 0o600);
}
export function appendAiUsageLog(rootPath, input) {
    const logPath = path.join(getAiLogsPath(rootPath), "usage.jsonl");
    appendJsonLine(logPath, input);
    return logPath;
}
export function appendAiResultLog(rootPath, input) {
    const logPath = path.join(getAiLogsPath(rootPath), "results.jsonl");
    appendJsonLine(logPath, input);
    return logPath;
}
//# sourceMappingURL=usage-log.js.map