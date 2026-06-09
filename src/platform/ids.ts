export interface IdGenerator {
  generate(): string
}

export const uuidGenerator: IdGenerator = {
  generate() {
    return crypto.randomUUID()
  },
}
