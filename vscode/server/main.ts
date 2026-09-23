import { main } from "@okfit/lsp/main";

await main({ distribution: { name: "okfit-vscode", version: process.env.__EXTENSION_VERSION__ ?? "dev" } });
