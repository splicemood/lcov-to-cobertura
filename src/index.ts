import { spawnSync } from "node:child_process";
import path from "node:path";

export interface LineCoverage {
  branch: "true" | "false";
  hits: string | number;
  "branches-total": number;
  "branches-covered": number;
}

export type MethodCoverage = [line: string, hits: string];

export interface ClassCoverage {
  name: string;
  lines: Record<number, LineCoverage>;
  methods: Record<string, MethodCoverage>;
  "lines-total": number;
  "lines-covered": number;
  "branches-total": number;
  "branches-covered": number;
}

export interface PackageCoverage {
  classes: Record<string, ClassCoverage>;
  "lines-total": number;
  "lines-covered": number;
  "branches-total": number;
  "branches-covered": number;
  "line-rate"?: string;
  "branch-rate"?: string;
}

export interface CoverageData {
  packages: Record<string, PackageCoverage>;
  summary: {
    "lines-total": number;
    "lines-covered": number;
    "branches-total": number;
    "branches-covered": number;
  };
  timestamp: string;
}

export interface LcovCoberturaOptions {
  baseDir?: string;
  excludes?: string | string[];
  demangle?: boolean;
}

export interface GenerateXmlOptions {
  indent?: string;
}

const COBERTURA_VERSION = "2.0.3";

export class LcovCobertura {
  private readonly lcovData: string;
  private readonly baseDir: string;
  private readonly excludes: string[];
  private readonly formatter: (name: string) => string;

  constructor(
    lcovData: string,
    baseDirOrOptions: string | LcovCoberturaOptions = ".",
    excludes?: string | string[],
    demangle = false,
  ) {
    if (typeof baseDirOrOptions === "string") {
      this.baseDir = baseDirOrOptions;
      this.excludes = normalizeExcludes(excludes);
      this.formatter = demangle ? demangleName : (name) => name;
    } else {
      this.baseDir = baseDirOrOptions.baseDir ?? ".";
      this.excludes = normalizeExcludes(baseDirOrOptions.excludes);
      this.formatter = baseDirOrOptions.demangle ? demangleName : (name) => name;
    }

    this.lcovData = lcovData;
  }

  convert(): string {
    return this.generateCoberturaXml(this.parse());
  }

  parse(options: { timestamp?: string | number } = {}): CoverageData {
    const coverageData: CoverageData = {
      packages: {},
      summary: {
        "lines-total": 0,
        "lines-covered": 0,
        "branches-total": 0,
        "branches-covered": 0,
      },
      timestamp:
        options.timestamp === undefined
          ? String(Math.trunc(Date.now() / 1000))
          : String(options.timestamp),
    };

    let packageName: string | undefined;
    let currentFile: string | undefined;
    let fileLinesTotal = 0;
    let fileLinesCovered = 0;
    const fileLines: Record<number, LineCoverage> = {};
    const fileMethods: Record<string, MethodCoverage> = {};
    let fileBranchesTotal = 0;
    let fileBranchesCovered = 0;

    const resetFile = () => {
      fileLinesTotal = 0;
      fileLinesCovered = 0;
      for (const key of Object.keys(fileLines)) {
        delete fileLines[Number(key)];
      }
      for (const key of Object.keys(fileMethods)) {
        delete fileMethods[key];
      }
      fileBranchesTotal = 0;
      fileBranchesCovered = 0;
    };

    for (const rawLine of this.lcovData.split("\n")) {
      const line = rawLine.trimEnd();

      if (line.trim() === "end_of_record" && currentFile !== undefined && packageName !== undefined) {
        const packageData = coverageData.packages[packageName];
        const classData = packageData?.classes[currentFile];

        if (packageData !== undefined && classData !== undefined) {
          packageData["lines-total"] += fileLinesTotal;
          packageData["lines-covered"] += fileLinesCovered;
          packageData["branches-total"] += fileBranchesTotal;
          packageData["branches-covered"] += fileBranchesCovered;

          classData["lines-total"] = fileLinesTotal;
          classData["lines-covered"] = fileLinesCovered;
          classData.lines = { ...fileLines };
          classData.methods = { ...fileMethods };
          classData["branches-total"] = fileBranchesTotal;
          classData["branches-covered"] = fileBranchesCovered;

          coverageData.summary["lines-total"] += fileLinesTotal;
          coverageData.summary["lines-covered"] += fileLinesCovered;
          coverageData.summary["branches-total"] += fileBranchesTotal;
          coverageData.summary["branches-covered"] += fileBranchesCovered;
        }
      }

      const separatorIndex = line.indexOf(":");
      const inputType = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const inputValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).trim();

      if (inputType === "SF") {
        const relativeFileName = relativeToBase(inputValue, this.baseDir);
        const parts = relativeFileName.split("/");
        packageName = parts.slice(0, -1).join(".");
        currentFile = relativeFileName;

        const packageData =
          coverageData.packages[packageName] ??
          (coverageData.packages[packageName] = {
            classes: {},
            "lines-total": 0,
            "lines-covered": 0,
            "branches-total": 0,
            "branches-covered": 0,
          });

        packageData.classes[relativeFileName] = {
          name: parts.join("."),
          lines: {},
          methods: {},
          "lines-total": 0,
          "lines-covered": 0,
          "branches-total": 0,
          "branches-covered": 0,
        };

        resetFile();
      } else if (inputType === "DA") {
        const [lineNumberRaw, lineHitsRaw] = inputValue.split(",");
        if (lineNumberRaw === undefined || lineHitsRaw === undefined) {
          continue;
        }

        const lineNumber = Number.parseInt(lineNumberRaw, 10);
        if (Number.isNaN(lineNumber)) {
          continue;
        }

        fileLines[lineNumber] ??= {
          branch: "false",
          "branches-total": 0,
          "branches-covered": 0,
          hits: "0",
        };
        fileLines[lineNumber].hits = lineHitsRaw;

        const hits = Number.parseInt(lineHitsRaw, 10);
        if (!Number.isNaN(hits) && hits > 0) {
          fileLinesCovered += 1;
        }
        fileLinesTotal += 1;
      } else if (inputType === "BRDA") {
        const [lineNumberRaw, , , branchHits] = inputValue.split(",");
        if (lineNumberRaw === undefined || branchHits === undefined) {
          continue;
        }

        const lineNumber = Number.parseInt(lineNumberRaw, 10);
        if (Number.isNaN(lineNumber)) {
          continue;
        }

        fileLines[lineNumber] ??= {
          branch: "true",
          "branches-total": 0,
          "branches-covered": 0,
          hits: 0,
        };
        fileLines[lineNumber].branch = "true";
        fileLines[lineNumber]["branches-total"] += 1;
        fileBranchesTotal += 1;

        const branchHitCount = Number.parseInt(branchHits, 10);
        if (branchHits !== "-" && !Number.isNaN(branchHitCount) && branchHitCount > 0) {
          fileLines[lineNumber]["branches-covered"] += 1;
          fileBranchesCovered += 1;
        }
      } else if (inputType === "BRF") {
        fileBranchesTotal = Number.parseInt(inputValue, 10);
      } else if (inputType === "BRH") {
        fileBranchesCovered = Number.parseInt(inputValue, 10);
      } else if (inputType === "FN") {
        const commaIndex = inputValue.indexOf(",");
        if (commaIndex === -1) {
          continue;
        }

        const functionLine = inputValue.slice(0, commaIndex);
        const functionName = inputValue.slice(commaIndex + 1);
        fileMethods[functionName] = [functionLine, "0"];
      } else if (inputType === "FNDA") {
        const commaIndex = inputValue.indexOf(",");
        if (commaIndex === -1) {
          continue;
        }

        const functionHits = inputValue.slice(0, commaIndex);
        const functionName = inputValue.slice(commaIndex + 1);
        fileMethods[functionName] ??= ["0", "0"];
        fileMethods[functionName][1] = functionHits;
      }
    }

    for (const excludedPackage of packagesToExclude(coverageData.packages, this.excludes)) {
      delete coverageData.packages[excludedPackage];
    }

    for (const packageData of Object.values(coverageData.packages)) {
      packageData["line-rate"] = percent(packageData["lines-total"], packageData["lines-covered"]);
      packageData["branch-rate"] = percent(packageData["branches-total"], packageData["branches-covered"]);
    }

    return coverageData;
  }

  generateCoberturaXml(coverageData: CoverageData, options: GenerateXmlOptions = {}): string {
    const indent = options.indent ?? "\t";
    const lines: string[] = [
      '<?xml version="1.0" ?>',
      "<!DOCTYPE coverage",
      "  SYSTEM 'http://cobertura.sourceforge.net/xml/coverage-04.dtd'>",
    ];
    const summary = coverageData.summary;

    lines.push(
      `<coverage branch-rate="${escapeXmlAttribute(percent(summary["branches-total"], summary["branches-covered"]))}" branches-covered="${summary["branches-covered"]}" branches-valid="${summary["branches-total"]}" complexity="0" line-rate="${escapeXmlAttribute(percent(summary["lines-total"], summary["lines-covered"]))}" lines-covered="${summary["lines-covered"]}" lines-valid="${summary["lines-total"]}" timestamp="${escapeXmlAttribute(coverageData.timestamp)}" version="${COBERTURA_VERSION}">`,
    );
    lines.push(`${indent}<sources>`);
    lines.push(`${indent.repeat(2)}<source>${escapeXmlText(this.baseDir)}</source>`);
    lines.push(`${indent}</sources>`);
    lines.push(`${indent}<packages>`);

    for (const [currentPackageName, packageData] of Object.entries(coverageData.packages)) {
      lines.push(
        `${indent.repeat(2)}<package line-rate="${escapeXmlAttribute(packageData["line-rate"] ?? "0.0")}" branch-rate="${escapeXmlAttribute(packageData["branch-rate"] ?? "0.0")}" name="${escapeXmlAttribute(currentPackageName)}" complexity="0">`,
      );
      lines.push(`${indent.repeat(3)}<classes>`);

      for (const [classFilename, classData] of Object.entries(packageData.classes)) {
        lines.push(
          `${indent.repeat(4)}<class branch-rate="${escapeXmlAttribute(percent(classData["branches-total"], classData["branches-covered"]))}" complexity="0" filename="${escapeXmlAttribute(classFilename)}" line-rate="${escapeXmlAttribute(percent(classData["lines-total"], classData["lines-covered"]))}" name="${escapeXmlAttribute(classData.name)}">`,
        );
        lines.push(`${indent.repeat(5)}<methods>`);

        for (const [methodName, [methodLine, methodHits]] of Object.entries(classData.methods)) {
          const methodCovered = Number.parseInt(methodHits, 10) > 0;
          lines.push(
            `${indent.repeat(6)}<method name="${escapeXmlAttribute(this.formatter(methodName))}" signature="" line-rate="${methodCovered ? "1.0" : "0.0"}" branch-rate="${methodCovered ? "1.0" : "0.0"}">`,
          );
          lines.push(`${indent.repeat(7)}<lines>`);
          lines.push(
            `${indent.repeat(8)}<line hits="${escapeXmlAttribute(methodHits)}" number="${escapeXmlAttribute(methodLine)}" branch="false"/>`,
          );
          lines.push(`${indent.repeat(7)}</lines>`);
          lines.push(`${indent.repeat(6)}</method>`);
        }

        lines.push(`${indent.repeat(5)}</methods>`);
        lines.push(`${indent.repeat(5)}<lines>`);

        const lineNumbers = Object.keys(classData.lines)
          .map((lineNumber) => Number.parseInt(lineNumber, 10))
          .sort((left, right) => left - right);

        for (const lineNumber of lineNumbers) {
          const lineData = classData.lines[lineNumber];
          if (lineData === undefined) {
            continue;
          }

          const baseAttrs = `branch="${lineData.branch}" hits="${escapeXmlAttribute(String(lineData.hits))}" number="${lineNumber}"`;
          if (lineData.branch === "true") {
            const total = lineData["branches-total"];
            const covered = lineData["branches-covered"];
            const percentage = Math.trunc((covered * 100.0) / total);
            lines.push(
              `${indent.repeat(6)}<line ${baseAttrs} condition-coverage="${percentage}% (${covered}/${total})"/>`,
            );
          } else {
            lines.push(`${indent.repeat(6)}<line ${baseAttrs}/>`);
          }
        }

        lines.push(`${indent.repeat(5)}</lines>`);
        lines.push(`${indent.repeat(4)}</class>`);
      }

      lines.push(`${indent.repeat(3)}</classes>`);
      lines.push(`${indent.repeat(2)}</package>`);
    }

    lines.push(`${indent}</packages>`);
    lines.push("</coverage>");
    lines.push("");

    return lines.join("\n");
  }

  generate_cobertura_xml(coverageData: CoverageData, options: GenerateXmlOptions = {}): string {
    return this.generateCoberturaXml(coverageData, options);
  }
}

function normalizeExcludes(excludes: string | string[] | undefined): string[] {
  if (excludes === undefined || excludes.length === 0) {
    return [];
  }

  return Array.isArray(excludes) ? excludes : [excludes];
}

function packagesToExclude(packages: Record<string, PackageCoverage>, excludes: string[]): string[] {
  const excluded: string[] = [];

  for (const packageName of Object.keys(packages)) {
    for (const exclude of excludes) {
      if (new RegExp(exclude).test(packageName) && packageName.match(new RegExp(exclude))?.index === 0) {
        excluded.push(packageName);
        break;
      }
    }
  }

  return excluded;
}

function percent(total: number, covered: number): string {
  if (total === 0) {
    return "0.0";
  }

  return String(covered / total);
}

function relativeToBase(fileName: string, baseDir: string): string {
  const usesWinPath =
    fileName.includes("\\") ||
    baseDir.includes("\\") ||
    /^[A-Za-z]:/.test(fileName) ||
    /^[A-Za-z]:/.test(baseDir);

  if (usesWinPath) {
    return path.win32.relative(baseDir, fileName).replace(/\\/g, "/");
  }

  return path.posix.relative(baseDir, fileName);
}

function demangleName(name: string): string {
  const result = spawnSync("c++filt", [name], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  return result.stdout.trimEnd();
}

function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}
