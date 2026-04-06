export async function importAmplifyOutputsModule() {
  return import("../amplify_outputs.json", {
    with: { type: "json" },
  });
}
