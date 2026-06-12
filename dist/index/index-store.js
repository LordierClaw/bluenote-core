import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import MiniSearch from "minisearch";
// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js";
import { STATE_DIRECTORY } from "../config/root.js";
import { IndexUnavailableError } from "../core/errors.js";
import { assertPathInsideRoot } from "../platform/path-safety.js";
import { collectContainsFieldMatches } from "../search/contains-match.js";
import { createSearchDocuments } from "./search-documents.js";
const SQL_WASM_FILENAME = "sql-wasm.wasm";
const executableAdjacentSqlWasmPath = path.join(path.dirname(process.execPath), SQL_WASM_FILENAME);
const projectSqlWasmPath = path.resolve("node_modules", "sql.js", "dist", SQL_WASM_FILENAME);
function locateSqlWasm(fileName) {
    if (fileName !== SQL_WASM_FILENAME) {
        return fileName;
    }
    if (existsSync(executableAdjacentSqlWasmPath)) {
        return executableAdjacentSqlWasmPath;
    }
    if (existsSync(projectSqlWasmPath)) {
        return projectSqlWasmPath;
    }
    return fileName;
}
const SQL = await initSqlJs({ locateFile: locateSqlWasm });
const DERIVED_DIRECTORY = STATE_DIRECTORY;
const METADATA_FILENAME = "metadata.sqlite";
const SEARCH_FILENAME = "search-index.json";
const SEARCH_FIELDS = ["key", "title", "description", "body", "relativePath"];
const SEARCH_STORE_FIELDS = ["id", "key", "title", "description", "body", "relativePath"];
const REBUILD_INDEX_HINT = `Run bn rebuild to recreate ${DERIVED_DIRECTORY} artifacts from note files and sidecars.`;
function getDerivedDirectory(rootPath) {
    return assertPathInsideRoot(path.resolve(rootPath), path.join(path.resolve(rootPath), DERIVED_DIRECTORY));
}
function getMetadataDatabasePath(rootPath) {
    return path.join(getDerivedDirectory(rootPath), METADATA_FILENAME);
}
function getSearchIndexPath(rootPath) {
    return path.join(getDerivedDirectory(rootPath), SEARCH_FILENAME);
}
function createSearchEngine() {
    return new MiniSearch({
        fields: [...SEARCH_FIELDS],
        storeFields: [...SEARCH_STORE_FIELDS],
    });
}
function getFilename(relativePath) {
    return path.basename(relativePath);
}
function collectSearchIndexContainsMatches(query, match) {
    return collectContainsFieldMatches(query, [
        { field: "key", value: match.key },
        { field: "title", value: match.title },
        { field: "description", value: match.description },
        { field: "body", value: match.body },
        { field: "path", value: match.relativePath },
        { field: "filename", value: getFilename(match.relativePath) },
    ]);
}
function getContainsScore(matches) {
    return matches.reduce((highestScore, match) => Math.max(highestScore, match.score), 0);
}
function getStoredSearchMatches(searchJson) {
    const parsed = JSON.parse(searchJson);
    const storedFields = parsed.storedFields;
    if (storedFields === undefined || typeof storedFields !== "object" || storedFields === null) {
        return [];
    }
    return Object.values(storedFields).map((stored) => ({
        key: String(stored.key ?? ""),
        id: String(stored.id ?? stored.key ?? ""),
        title: String(stored.title ?? ""),
        description: String(stored.description ?? ""),
        body: String(stored.body ?? ""),
        relativePath: String(stored.relativePath ?? ""),
    }));
}
function deriveLegacyDescription(note) {
    return note.body
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? note.frontmatter.title;
}
function normalizeIndexedNote(note) {
    if ("key" in note) {
        return note;
    }
    return {
        key: note.frontmatter.id,
        title: note.frontmatter.title,
        description: deriveLegacyDescription(note),
        body: note.body,
        relativePath: note.sourcePath,
        createdAt: note.frontmatter.createdAt,
        updatedAt: note.frontmatter.updatedAt,
        archivedAt: note.frontmatter.archivedAt ?? null,
    };
}
export function rebuildIndexStore(input) {
    const metadataDatabasePath = getMetadataDatabasePath(input.rootPath);
    const searchIndexPath = getSearchIndexPath(input.rootPath);
    mkdirSync(path.dirname(metadataDatabasePath), { recursive: true });
    const db = new SQL.Database();
    db.run(`
    CREATE TABLE notes (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      relativePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      archivedAt TEXT
    )
  `);
    const insert = db.prepare(`
    INSERT INTO notes (key, title, description, relativePath, createdAt, updatedAt, archivedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    const sortedNotes = input.notes
        .map((note) => normalizeIndexedNote(note))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    try {
        for (const note of sortedNotes) {
            insert.run([
                note.key,
                note.title,
                note.description,
                note.relativePath,
                note.createdAt,
                note.updatedAt,
                note.archivedAt,
            ]);
        }
    }
    finally {
        insert.free();
    }
    writeFileSync(metadataDatabasePath, db.export());
    db.close();
    const searchEngine = createSearchEngine();
    searchEngine.addAll(createSearchDocuments(sortedNotes));
    writeFileSync(searchIndexPath, JSON.stringify(searchEngine), "utf8");
    return {
        noteCount: sortedNotes.length,
        metadataDatabasePath,
        searchIndexPath,
    };
}
export function updateIndexedNote(rootPath, note) {
    const normalizedRootPath = path.resolve(rootPath);
    const metadataDatabasePath = getMetadataDatabasePath(normalizedRootPath);
    const searchIndexPath = getSearchIndexPath(normalizedRootPath);
    mkdirSync(path.dirname(metadataDatabasePath), { recursive: true });
    let metadataBytes;
    let searchJson;
    try {
        metadataBytes = readFileSync(metadataDatabasePath);
        searchJson = readFileSync(searchIndexPath, "utf8");
    }
    catch (error) {
        throw new IndexUnavailableError("Derived indexes are unavailable.", {
            hint: REBUILD_INDEX_HINT,
            cause: error,
        });
    }
    try {
        const db = new SQL.Database(metadataBytes);
        try {
            db.run("BEGIN IMMEDIATE TRANSACTION");
            const upsert = db.prepare(`
        INSERT INTO notes (key, title, description, relativePath, createdAt, updatedAt, archivedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          relativePath = excluded.relativePath,
          createdAt = excluded.createdAt,
          updatedAt = excluded.updatedAt,
          archivedAt = excluded.archivedAt
      `);
            try {
                upsert.run([
                    note.key,
                    note.title,
                    note.description,
                    note.relativePath,
                    note.createdAt,
                    note.updatedAt,
                    note.archivedAt,
                ]);
            }
            finally {
                upsert.free();
            }
            const noteCountResult = db.exec("SELECT COUNT(*) FROM notes");
            const noteCount = Number(noteCountResult[0]?.values[0]?.[0] ?? 0);
            db.run("COMMIT");
            writeFileSync(metadataDatabasePath, db.export());
            const searchEngine = MiniSearch.loadJSON(searchJson, {
                fields: [...SEARCH_FIELDS],
                storeFields: [...SEARCH_STORE_FIELDS],
            });
            const [searchDocument] = createSearchDocuments([note]);
            if (searchEngine.has(searchDocument.id)) {
                searchEngine.replace(searchDocument);
            }
            else {
                searchEngine.add(searchDocument);
            }
            writeFileSync(searchIndexPath, JSON.stringify(searchEngine), "utf8");
            return {
                noteCount,
                metadataDatabasePath,
                searchIndexPath,
            };
        }
        catch (error) {
            try {
                db.run("ROLLBACK");
            }
            catch {
                // Ignore rollback failures; the original error is more useful.
            }
            throw error;
        }
        finally {
            db.close();
        }
    }
    catch (error) {
        throw new IndexUnavailableError("Derived indexes are unavailable.", {
            hint: REBUILD_INDEX_HINT,
            cause: error,
        });
    }
}
export function loadIndexStore(rootPath) {
    const metadataDatabasePath = getMetadataDatabasePath(rootPath);
    const searchIndexPath = getSearchIndexPath(rootPath);
    let metadataBytes;
    let searchJson;
    try {
        metadataBytes = readFileSync(metadataDatabasePath);
        searchJson = readFileSync(searchIndexPath, "utf8");
    }
    catch (error) {
        throw new IndexUnavailableError("Derived indexes are unavailable.", {
            hint: REBUILD_INDEX_HINT,
            cause: error,
        });
    }
    try {
        const db = new SQL.Database(metadataBytes);
        try {
            const result = db.exec(`
        SELECT key, title, description, relativePath, createdAt, updatedAt, archivedAt
        FROM notes
        ORDER BY relativePath ASC
      `);
            const summaries = [];
            const values = result[0]?.values ?? [];
            for (const row of values) {
                const [key, title, description, relativePath, createdAt, updatedAt, archivedAt] = row;
                summaries.push({
                    key,
                    id: key,
                    title,
                    description,
                    relativePath,
                    createdAt,
                    updatedAt,
                    archivedAt,
                });
            }
            const activeSummaries = summaries.filter((summary) => summary.archivedAt === null);
            const activeKeys = new Set(activeSummaries.map((summary) => summary.key));
            MiniSearch.loadJSON(searchJson, {
                fields: [...SEARCH_FIELDS],
                storeFields: [...SEARCH_STORE_FIELDS],
            });
            const searchableMatches = getStoredSearchMatches(searchJson);
            return {
                listSummaries() {
                    return activeSummaries.map((summary) => ({ ...summary }));
                },
                listAllSummaries() {
                    return summaries.map((summary) => ({ ...summary }));
                },
                search(query, options = {}) {
                    if (query.trim() === "") {
                        return [];
                    }
                    const visibleKeys = options.includeArchived === true ? new Set(summaries.map((summary) => summary.key)) : activeKeys;
                    return searchableMatches
                        .filter((match) => visibleKeys.has(match.key))
                        .flatMap((match) => {
                        const containsMatches = collectSearchIndexContainsMatches(query, match);
                        if (containsMatches.length === 0) {
                            return [];
                        }
                        return [
                            {
                                ...match,
                                containsMatches,
                                score: getContainsScore(containsMatches),
                            },
                        ];
                    });
                },
            };
        }
        finally {
            db.close();
        }
    }
    catch (error) {
        throw new IndexUnavailableError("Derived indexes are unavailable.", {
            hint: REBUILD_INDEX_HINT,
            cause: error,
        });
    }
}
//# sourceMappingURL=index-store.js.map