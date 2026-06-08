declare module "js-yaml" {
  const yaml: {
    load(input: string, options: { schema: unknown }): unknown
    dump(
      input: unknown,
      options: {
        indent: number
        lineWidth: number
        noRefs: boolean
        schema: unknown
      },
    ): string
    JSON_SCHEMA: unknown
  }

  export default yaml
}
