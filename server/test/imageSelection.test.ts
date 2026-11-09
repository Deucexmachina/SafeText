import assert from "node:assert/strict";
import { test } from "node:test";
import { validateScreenshot } from "../../web/src/imageValidation.js";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = new Uint8Array([255, 216, 255, 224]);

test("image selection accepts supported formats and uppercase extensions", async () => {
  const file = new File([png], "SMS.PNG", { type: "image/png" });
  assert.equal(await validateScreenshot(file), file);
  assert.equal((await validateScreenshot(new File(["GIF89a"], "sms.gif", { type: "image/gif" }))).type, "image/gif");
});

test("JFIF/JPEG with missing browser MIME is verified and sent as image/jpeg", async () => {
  const file = await validateScreenshot(new File([jpeg], "sms.jfif"));
  assert.equal(file.type, "image/jpeg"); assert.equal(file.name, "sms.jfif");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), jpeg);
});

test("image selection rejects documents, unsupported images and renamed non-images", async () => {
  await assert.rejects(() => validateScreenshot(new File(["document"], "sms.pdf", { type: "application/pdf" })), /not supported/);
  await assert.rejects(() => validateScreenshot(new File(["<svg/>"], "sms.svg", { type: "image/svg+xml" })), /not supported/);
  await assert.rejects(() => validateScreenshot(new File([new Uint8Array([73, 73, 42, 0])], "sms.constructor")), /not supported/);
  await assert.rejects(() => validateScreenshot(new File(["%PDF-1.7"], "sms.png", { type: "image/png" })), /does not match/);
  await assert.rejects(() => validateScreenshot(new File([png], "sms.jpg", { type: "image/png" })), /not supported/);
});

test("image selection rejects empty and oversized files, and accepts the exact 8 MB boundary", async () => {
  await assert.rejects(() => validateScreenshot(new File([], "sms.png", { type: "image/png" })), /empty/);
  const bytes = new Uint8Array(8 * 1024 * 1024); bytes.set(png);
  const exact = new File([bytes], "sms.png", { type: "image/png" });
  assert.equal(await validateScreenshot(exact), exact);
  await assert.rejects(() => validateScreenshot(new File([bytes, "x"], "sms.png", { type: "image/png" })), /8 MB limit/);
});
