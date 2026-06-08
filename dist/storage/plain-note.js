export function normalizePlainNoteBody(markdownText) {
    return markdownText.replace(/\r\n/g, "\n");
}
export function parsePlainNote(markdownText, sourcePath) {
    return {
        body: normalizePlainNoteBody(markdownText),
        sourcePath,
    };
}
export function serializePlainNote(note) {
    return normalizePlainNoteBody(note.body);
}
//# sourceMappingURL=plain-note.js.map