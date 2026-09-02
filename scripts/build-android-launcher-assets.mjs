import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resRoot = path.join(root, "android", "app", "src", "main", "res");
const assetsRoot = path.join(root, "assets");

const layers = [
  { name: "background", source: "android-icon-background.svg", opaque: true },
  { name: "foreground", source: "android-icon-foreground.svg", opaque: false },
  { name: "monochrome", source: "android-icon-monochrome.svg", opaque: false },
];

const densities = {
  ldpi: 81,
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

const adaptiveIconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;

for (const layer of layers) {
  const input = await readFile(path.join(assetsRoot, layer.source));

  for (const [density, size] of Object.entries(densities)) {
    const directory = path.join(resRoot, `mipmap-${density}`);
    const destination = path.join(directory, `ic_launcher_${layer.name}.png`);
    await mkdir(directory, { recursive: true });
    await sharp(input, { density: 288 })
      .resize(size, size, { fit: "fill" })
      .png({ compressionLevel: 9, palette: false })
      .toFile(destination);

    const metadata = await sharp(destination).metadata();
    const stats = await sharp(destination).stats();
    if (metadata.width !== size || metadata.height !== size) {
      throw new Error(`${destination} is ${metadata.width}x${metadata.height}; expected ${size}x${size}`);
    }
    if (stats.isOpaque !== layer.opaque) {
      throw new Error(`${destination} opacity does not match the ${layer.name} layer contract`);
    }
  }
}

const adaptiveDirectory = path.join(resRoot, "mipmap-anydpi-v26");
await mkdir(adaptiveDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(adaptiveDirectory, "ic_launcher.xml"), adaptiveIconXml),
  writeFile(path.join(adaptiveDirectory, "ic_launcher_round.xml"), adaptiveIconXml),
]);

console.log("Generated Android adaptive launcher layers for ldpi through xxxhdpi.");
