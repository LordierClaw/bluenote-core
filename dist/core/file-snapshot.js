import fs from "node:fs";
import path from "node:path";
export function snapshotFiles(filePaths) {
    return filePaths.map((filePath) => ({
        filePath,
        content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
    }));
}
export function restoreFileSnapshots(snapshots) {
    for (const snapshot of snapshots) {
        if (snapshot.content === null) {
            fs.rmSync(snapshot.filePath, { force: true });
            continue;
        }
        fs.mkdirSync(path.dirname(snapshot.filePath), { recursive: true });
        fs.writeFileSync(snapshot.filePath, snapshot.content);
    }
}
//# sourceMappingURL=file-snapshot.js.map