import { fileURLToPath } from "node:url";

export * from "./apply-cognito-managed-login-branding";
import { main } from "./apply-cognito-managed-login-branding";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
