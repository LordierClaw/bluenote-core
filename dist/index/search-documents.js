function getDescription(note) {
    if ("description" in note) {
        return note.description;
    }
    return note.body
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? note.frontmatter.title;
}
export function createSearchDocuments(notes) {
    return notes.map((note) => ({
        id: "key" in note ? note.key : note.frontmatter.id,
        key: "key" in note ? note.key : note.frontmatter.id,
        title: "title" in note ? note.title : note.frontmatter.title,
        description: getDescription(note),
        body: note.body,
        relativePath: "relativePath" in note ? note.relativePath : note.sourcePath,
    }));
}
//# sourceMappingURL=search-documents.js.map