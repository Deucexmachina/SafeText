// LLMWhisperer v2 supported raster formats; retain SafeText's 8 MB limit.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff"];

export function validImage(bytes: Buffer, mime: string): boolean {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return false;
  const hex = bytes.subarray(0, 12).toString("hex");
  switch (mime) {
    case "image/png": return hex.startsWith("89504e470d0a1a0a");
    case "image/jpeg": return hex.startsWith("ffd8ff");
    case "image/gif": return bytes.subarray(0, 6).toString() === "GIF87a" || bytes.subarray(0, 6).toString() === "GIF89a";
    case "image/webp": return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    case "image/bmp": return hex.startsWith("424d");
    case "image/tiff": return hex.startsWith("49492a00") || hex.startsWith("4d4d002a");
    default: return false;
  }
}
