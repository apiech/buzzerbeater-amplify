This directory is the shared BBAPI contract asset area for `bb-amplify`.

- `xml/` contains canonical raw BB XML samples copied from `/Users/karey/projects/bb/bb-xml-api-client/tests/fixtures`.
- `json/` contains approved normalized outputs for the TypeScript parser.

The app runtime is TypeScript-canonical. Python may still use the XML fixtures for overlap and diagnostics, but product changes are validated against the TypeScript parser and these golden outputs first.
