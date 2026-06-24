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
