#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { LcovCobertura } from "./index.js";

const VERSION = "0.1.0";

interface CliOptions {
  baseDir: string;
  excludes: string[];
  output: string;
  demangle: boolean;
  version: boolean;
  help: boolean;
  input?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseDir: ".",
    excludes: [],
    output: "coverage.xml",
    demangle: false,
    version: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-b" || arg === "--base-dir") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      options.baseDir = value;
      index += 1;
    } else if (arg === "-e" || arg === "--excludes") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      options.excludes.push(value);
      index += 1;
    } else if (arg === "-o" || arg === "--output") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      options.output = value;
      index += 1;
    } else if (arg === "-d" || arg === "--demangle") {
      options.demangle = true;
    } else if (arg === "-v" || arg === "--version") {
      options.version = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg?.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.input === undefined) {
      options.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

export function usage(): string {
  return [
    "Converts lcov output to cobertura-compatible XML",
    "",
    "Usage:",
    "  lcov-to-cobertura lcov-file.dat [-b source/dir] [-e <exclude packages regex>] [-o output.xml] [-d]",
    "",
    "Options:",
    "  -b, --base-dir   Directory where source files are located",
    "  -e, --excludes   Regex of packages to exclude; can be repeated",
    "  -o, --output     Path to store cobertura xml file",
    "  -d, --demangle   Demangle C++ function names using c++filt",
    "  -v, --version    Display version info",
  ].join("\n");
}

export function main(argv = process.argv.slice(2)): number {
  let options: CliOptions;

  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${String(error instanceof Error ? error.message : error)}\n`);
    process.stderr.write(`${usage()}\n`);
    return 1;
  }

  if (options.version) {
    process.stdout.write(`[lcov_cobertura ${VERSION}]\n`);
    return 0;
  }

  if (options.help || options.input === undefined) {
    process.stdout.write(`${usage()}\n`);
    return options.help ? 0 : 1;
  }

  try {
    const lcovData = fs.readFileSync(options.input, "utf8");
    const converter = new LcovCobertura(lcovData, {
      baseDir: options.baseDir,
      excludes: options.excludes,
      demangle: options.demangle,
    });
    fs.writeFileSync(options.output, converter.convert(), "utf8");
    return 0;
  } catch {
    process.stderr.write(`Unable to convert ${options.input} to Cobertura XML`);
    return 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.exitCode = main();
}
