import { randomUUID } from "node:crypto";
export const uuidGenerator = {
    generate() {
        return randomUUID();
    },
};
export function createWorkspaceId() {
    return `workspace_${randomUUID()}`;
}
export function createNoteId() {
    return `note_${randomUUID()}`;
}
//# sourceMappingURL=ids.js.map