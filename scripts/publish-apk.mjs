import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, "..");

const candidates = [
  resolve(rootDir, "apps/player/android/app/build/outputs/apk/release/app-release.apk"),
  resolve(rootDir, "apps/player/android/app/build/outputs/apk/debug/app-debug.apk")
];

const targetPath = resolve(rootDir, "apps/cms/public/app/maasck.apk");
const sourcePath = candidates.find((candidate) => existsSync(candidate));

if (!sourcePath) {
  console.error("Nie znaleziono żadnego zbudowanego APK.");
  console.error("Najpierw uruchom build Androida, np. `npm run build:android:debug`.");
  process.exit(1);
}

await mkdir(dirname(targetPath), { recursive: true });
await copyFile(sourcePath, targetPath);

console.log(`APK opublikowany: ${targetPath}`);
console.log("Po kolejnym buildzie CMS link /app/maasck.apk będzie dostępny publicznie.");
