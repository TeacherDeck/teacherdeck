// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// `pnpm sync-versions`: copies the app version from root package.json into Cargo.toml (VER-001).
import fs from "node:fs";
import path from "node:path";
import { cargoWorkspaceVersion, setCargoWorkspaceVersion } from "../checks/lib/versions.ts";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown };
if (typeof pkg.version !== "string") throw new Error("package.json has no version");

const cargoPath = path.join(root, "Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8");
if (cargoWorkspaceVersion(cargo) === null) throw new Error("Cargo.toml has no [workspace.package] version");
if (cargoWorkspaceVersion(cargo) === pkg.version) {
  console.log(`Cargo.toml already at ${pkg.version}`);
} else {
  fs.writeFileSync(cargoPath, setCargoWorkspaceVersion(cargo, pkg.version));
  console.log(`Cargo.toml -> ${pkg.version}`);
}
