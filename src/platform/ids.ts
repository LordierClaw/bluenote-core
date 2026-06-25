import { randomUUID } from "node:crypto"

export interface IdGenerator {
  generate(): string
}

export const uuidGenerator: IdGenerator = {
  generate() {
    return randomUUID()
  },
}

export function createWorkspaceId(): string {
  return `workspace_${randomUUID()}`
}

export function createNoteId(): string {
  return `note_${randomUUID()}`
}

export function createReplicaId(): string {
  return `replica_${randomUUID()}`
}
