import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DOMParser, type Document, type Element } from "@xmldom/xmldom";

import { LcovCobertura } from "../src/index.js";

describe("LcovCobertura", () => {
  it("builds package, class, line, branch, and method summaries from LCOV records", () => {
    const coverage = new LcovCobertura(readFixture("app.lcov")).parse({ timestamp: 123456 });

    assert.deepEqual(coverage.summary, {
      "lines-total": 6,
      "lines-covered": 4,
      "branches-total": 4,
      "branches-covered": 3,
    });
    assert.equal(coverage.timestamp, "123456");

    const servicePackage = coverage.packages["src.service"];
    assert.equal(servicePackage?.["line-rate"], String(4 / 6));
    assert.equal(servicePackage?.["branch-rate"], String(3 / 4));
    assert.deepEqual(Object.keys(servicePackage?.classes ?? {}), [
      "src/service/account.ts",
      "src/service/account.spec.ts",
    ]);

    const accountClass = servicePackage?.classes["src/service/account.ts"];
    assert.equal(accountClass?.name, "src.service.account.ts");
    assert.equal(accountClass?.["lines-covered"], 2);
    assert.equal(accountClass?.["lines-total"], 3);
    assert.equal(accountClass?.["branches-covered"], 3);
    assert.equal(accountClass?.["branches-total"], 4);
    assert.deepEqual(accountClass?.methods.createAccount, ["10", "3"]);
    assert.deepEqual(accountClass?.methods["renderTitle<T, U>"], ["20", "0"]);
    assert.deepEqual(accountClass?.lines[12], {
      branch: "true",
      hits: "0",
      "branches-total": 4,
      "branches-covered": 3,
    });
  });

  it("keeps checksum fields out of hit parsing and treats non-numeric hits as uncovered", () => {
    const coverage = new LcovCobertura(readFixture("checksum.lcov")).parse();

    const parserPackage = coverage.packages["src.parser"];
    assert.equal(parserPackage?.["lines-total"], 3);
    assert.equal(parserPackage?.["lines-covered"], 1);
    assert.equal(parserPackage?.["line-rate"], String(1 / 3));
    assert.equal(parserPackage?.classes["src/parser/checksum.ts"]?.lines[2]?.hits, "not-a-number");
  });

  it("filters packages with anchored regular expressions after summary collection", () => {
    const coverage = new LcovCobertura(readFixture("exclude.lcov"), { excludes: ["test\\.support"] }).parse();

    assert.deepEqual(Object.keys(coverage.packages), ["src.core"]);
    assert.equal(coverage.summary["lines-total"], 2);
    assert.equal(coverage.summary["lines-covered"], 2);
  });

  it("uses baseDir to write project-root filenames for Cobertura consumers", () => {
    const coverage = new LcovCobertura(readFixture("gitlab-root.lcov"), { baseDir: "." }).parse();
    const xml = new LcovCobertura("", { baseDir: "." }).generateCoberturaXml(coverage);
    const classElement = firstElement(parseXml(xml), "class");

    assert.equal(classElement.getAttribute("filename"), "packages/api/src/http/handlers.ts");
    assert.equal(classElement.getAttribute("name"), "packages.api.src.http.handlers.ts");
  });

  it("serializes Cobertura XML with rates, source root, methods, and branch conditions", () => {
    const converter = new LcovCobertura(readFixture("app.lcov"), { baseDir: "." });
    const xml = converter.generateCoberturaXml(converter.parse({ timestamp: 123456 }));
    const document = parseXml(xml);
    const expectedDocument = parseXml(readFixture("app.cobertura.xml"));
    const coverageElement = rootElement(document);
    const methodElement = firstElement(document, "method");
    const branchLineElement = Array.from(document.getElementsByTagName("line")).find(
      (line) => line.hasAttribute("condition-coverage"),
    );

    assert.equal(coverageElement.getAttribute("version"), "2.0.3");
    assert.equal(coverageElement.getAttribute("line-rate"), String(4 / 6));
    assert.equal(coverageElement.getAttribute("branch-rate"), String(3 / 4));
    assert.equal(firstElement(document, "source").textContent, ".");
    assert.equal(methodElement.getAttribute("name"), "createAccount");
    assert.equal(methodElement.getAttribute("line-rate"), "1.0");
    assert.equal(branchLineElement?.getAttribute("condition-coverage"), "75% (3/4)");
    assert.equal(xml, readFixture("app.cobertura.xml"));
    assert.equal(rootElement(expectedDocument).getAttribute("lines-valid"), "6");
  });

  it("escapes XML text and attributes", () => {
    const coverage = new LcovCobertura(readFixture("xml-escaping.lcov"), { baseDir: "root&source" }).parse({
      timestamp: "1",
    });

    const xml = new LcovCobertura("", { baseDir: "root&source" }).generateCoberturaXml(coverage);
    const document = parseXml(xml);

    assert.equal(firstElement(document, "source").textContent, "root&source");
    assert.equal(firstElement(document, "class").getAttribute("filename"), "../src/xml/a&b.ts");
    assert.equal(firstElement(document, "method").getAttribute("name"), 'encode<value>"now"');
  });

  it("demangles C++ symbols when requested and c++filt is available", { skip: !hasCppFilt() }, () => {
    const coverage = new LcovCobertura(readFixture("native-symbol.lcov"), { demangle: true }).parse();

    const xml = new LcovCobertura("", { demangle: true }).generateCoberturaXml(coverage);
    assert.equal(firstElement(parseXml(xml), "method").getAttribute("name"), "sum_value(int)");
  });

  it("runs through the compiled CLI defaults and version flag", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lcov-to-cobertura-test-"));
    const lcovPath = path.join(directory, "coverage.lcov");
    const xmlPath = path.join(directory, "coverage.xml");
    fs.writeFileSync(lcovPath, readFixture("app.lcov"), "utf8");

    const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
    const run = spawnSync(process.execPath, [cliPath, lcovPath, "-o", xmlPath], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(run.status, 0, run.stderr);

    const xml = fs.readFileSync(xmlPath, "utf8");
    assert.equal(rootElement(parseXml(xml)).getAttribute("lines-valid"), "6");

    const version = spawnSync(process.execPath, [cliPath, "--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), "[lcov_cobertura 0.1.1]");
  });
});

function readFixture(name: string): string {
  return fs.readFileSync(path.resolve("test", "fixtures", name), "utf8");
}

function parseXml(xml: string): Document {
  const parserErrors: string[] = [];
  const document = new DOMParser({
    onError: (level, message) => parserErrors.push(`${level}: ${message}`),
  }).parseFromString(xml, "application/xml");

  assert.deepEqual(parserErrors, []);
  return document;
}

function firstElement(document: Document, tagName: string): Element {
  const element = document.getElementsByTagName(tagName)[0];
  assert.notEqual(element, undefined, `${tagName} element is missing`);
  return element as Element;
}

function rootElement(document: Document): Element {
  assert.notEqual(document.documentElement, null, "document root element is missing");
  return document.documentElement as Element;
}

function hasCppFilt(): boolean {
  return spawnSync("c++filt", ["_Z9sum_valuei"], {
    encoding: "utf8",
    windowsHide: true,
  }).status === 0;
}
