// Run with: node --test scripts/
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { auditPins, insecurity, readRepoPins } from "./node-floor.mjs";

describe("Node.js security floor", () => {
  it("accepts the patched release of each supported line, with or without a leading v", () => {
    assert.equal(insecurity("22.23.4"), undefined);
    assert.equal(insecurity("v24.22.1"), undefined);
    assert.equal(insecurity("26.12.1"), undefined);
    assert.equal(insecurity("24.23.0"), undefined);
  });

  it("refuses a release below the floor of its line", () => {
    assert.equal(
      insecurity("24.22.0"),
      "Node.js 24.22.0 is below the security floor 24.22.1",
    );
  });

  it("refuses a line that gets no security fixes", () => {
    assert.equal(
      insecurity("20.20.2"),
      "Node.js 20 gets no security fixes; use one of the lines 22, 24, 26",
    );
  });

  it("refuses a floating tag, since it can be any release", () => {
    assert.equal(insecurity("20"), '"20" is not an exact version (x.y.z)');
  });

  it("checks .nvmrc and every node: stage of a Dockerfile, ignoring other images", () => {
    const dockerfile = [
      "FROM --platform=$BUILDPLATFORM node:20.20.2-alpine AS api-builder",
      "FROM nginx:1.29.5-alpine AS runtime",
      "FROM node:20-alpine AS builder",
    ].join("\n");
    assert.deepEqual(
      auditPins([
        { path: ".nvmrc", text: "24.22.1\n" },
        { path: "Dockerfile.kaneo", text: dockerfile },
      ]),
      [
        {
          path: "Dockerfile.kaneo",
          line: 1,
          message:
            "Node.js 20 gets no security fixes; use one of the lines 22, 24, 26",
        },
        {
          path: "Dockerfile.kaneo",
          line: 3,
          message: '"20" is not an exact version (x.y.z)',
        },
      ],
    );
  });
});

describe("this repository", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("pins Node.js in .nvmrc and every image", () => {
    const paths = readRepoPins(root).map((file) => file.path);
    for (const expected of [
      ".nvmrc",
      "Dockerfile.kaneo",
      "apps/api/Dockerfile",
      "apps/web/Dockerfile",
    ]) {
      assert.ok(paths.includes(expected), `${expected} is not checked`);
    }
  });

  it("pins no Node.js version below the security floor", () => {
    assert.deepEqual(auditPins(readRepoPins(root)), []);
  });
});
