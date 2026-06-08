function getRelativePath(note) {
    if ("sourcePath" in note) {
        return note.sourcePath;
    }
    return note.relativePath;
}
function getArchivedAt(note) {
    if ("frontmatter" in note) {
        return note.frontmatter.archivedAt ?? null;
    }
    if ("archivedAt" in note) {
        return note.archivedAt;
    }
    return note.relativePath.startsWith(".data/archive/") ? "archived" : null;
}
export function noteIsVisible(note, visibility = "normal") {
    const relativePath = getRelativePath(note);
    const archivedAt = getArchivedAt(note);
    const isArchived = archivedAt !== null || relativePath.startsWith(".data/archive/");
    const isDraft = !isArchived && relativePath.startsWith("draft/");
    const isNormal = !isArchived && relativePath.startsWith("note/");
    if (visibility === "all") {
        return isNormal || isDraft || isArchived;
    }
    if (visibility === "drafts") {
        return isNormal || isDraft;
    }
    return isNormal;
}
//# sourceMappingURL=note-visibility.js.map