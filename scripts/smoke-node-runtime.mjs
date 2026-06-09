const api = await import("../dist/index.js")

if (typeof api.createBlueNoteCore !== "function") {
  throw new TypeError("Expected createBlueNoteCore to be exported from the package root")
}

if (typeof api.searchNotes !== "function") {
  throw new TypeError("Expected searchNotes to be exported from the package root")
}
