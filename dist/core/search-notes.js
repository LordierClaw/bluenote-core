import { resolveBlueNoteRoot } from "../config/root.js";
import { loadIndexStore } from "../index/index-store.js";
import { containsSearchQuery } from "../search/contains-match.js";
import { noteIsVisible } from "./note-visibility.js";
function normalizeForMatch(value) {
    return value.toLocaleLowerCase();
}
function includesAnyToken(value, tokens) {
    const normalized = normalizeForMatch(value);
    return tokens.some((token) => normalized.includes(token));
}
function createContentExplanation(body, query, fallbackTokens = []) {
    const lines = body.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
        const lineMatchesQuery = containsSearchQuery(line, query);
        const lineMatchesFallback = fallbackTokens.length > 0 && includesAnyToken(line, fallbackTokens);
        if (!lineMatchesQuery && !lineMatchesFallback) {
            continue;
        }
        const trimmed = line.trim();
        const excerpt = trimmed === "" ? "..." : `...${trimmed}...`;
        return {
            source: "content",
            label: `content line ${index + 1}`,
            excerpt,
        };
    }
    return {
        source: "content",
        label: "content",
    };
}
function getMatchedFields(match) {
    const fields = new Set();
    for (const matchedFields of Object.values(match.termMatches ?? {})) {
        for (const field of matchedFields) {
            fields.add(field);
        }
    }
    return fields;
}
function getBodyMatchTokens(match) {
    return Object.entries(match.termMatches ?? {})
        .filter(([, fields]) => fields.includes("body"))
        .map(([term]) => term);
}
function getContainsFields(match) {
    return new Set((match.containsMatches ?? []).map((containsMatch) => containsMatch.field));
}
function explainContainsMatch(match, query) {
    const containsFields = getContainsFields(match);
    if (containsFields.size === 0) {
        return null;
    }
    if (containsFields.has("title")) {
        return {
            source: "title",
            label: "title",
        };
    }
    if (containsFields.has("description")) {
        return {
            source: "description",
            label: "description",
        };
    }
    if (containsFields.has("body")) {
        return createContentExplanation(match.body, query);
    }
    return {
        source: "key-path",
        label: "key/path",
    };
}
function explainMatch(match, query) {
    const containsExplanation = explainContainsMatch(match, query);
    if (containsExplanation !== null) {
        return containsExplanation;
    }
    const matchedFields = getMatchedFields(match);
    if (matchedFields.has("title")) {
        return {
            source: "title",
            label: "title",
        };
    }
    if (matchedFields.has("description")) {
        return {
            source: "description",
            label: "description",
        };
    }
    if (matchedFields.has("body")) {
        const tokens = getBodyMatchTokens(match);
        return createContentExplanation(match.body, query, tokens);
    }
    return {
        source: "key-path",
        label: "key/path",
    };
}
function getMatchPriority(explanation) {
    switch (explanation.source) {
        case "title":
            return 0;
        case "description":
            return 1;
        case "content":
            return 2;
        case "key-path":
            return 3;
    }
}
export function searchNotes(query, options = {}) {
    const rootPath = resolveBlueNoteRoot(options);
    const store = loadIndexStore(rootPath);
    return store.search(query, { includeArchived: options.visibility === "all" })
        .filter((match) => noteIsVisible(match, options.visibility))
        .map((match) => ({
        key: match.key,
        title: match.title,
        relativePath: match.relativePath,
        match: explainMatch(match, query),
        score: match.score ?? 0,
    }))
        .sort((left, right) => {
        const priorityDifference = getMatchPriority(left.match) - getMatchPriority(right.match);
        if (priorityDifference !== 0) {
            return priorityDifference;
        }
        if (right.score !== left.score) {
            return right.score - left.score;
        }
        return left.relativePath.localeCompare(right.relativePath);
    })
        .map(({ key, title, relativePath, match }) => ({
        key,
        title,
        relativePath,
        match,
    }));
}
//# sourceMappingURL=search-notes.js.map