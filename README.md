# lcov-to-cobertura

Node.js LCOV to Cobertura XML converter, compatible with the behavior of the Python `lcov_cobertura` package.

## Install

```sh
npm install --save-dev @splicemood/lcov-to-cobertura
```

## CLI

```sh
lcov-to-cobertura lcov-file.dat
lcov-to-cobertura lcov-file.dat --base-dir src/dir --excludes test.lib --output build/coverage.xml --demangle
lcov_cobertura lcov-file.dat
```

Options:

- `-b, --base-dir` source root used to relativize files. Defaults to `.`
- `-e, --excludes` package regex to exclude. Can be repeated.
- `-o, --output` Cobertura XML output path. Defaults to `coverage.xml`
- `-d, --demangle` demangle C++ function names with `c++filt`
- `-v, --version` print package version

## Library

```ts
import { LcovCobertura } from "@splicemood/lcov-to-cobertura";

const lcov = "SF:foo/file.ext\nDA:1,1\nDA:2,0\nend_of_record\n";
const converter = new LcovCobertura(lcov);

console.log(converter.convert());
```

## GitLab CI

```yaml
test:coverage:
  stage: test
  script:
    - npm ci
    - npm test -- --coverage --coverage-reporter=lcov
    - npx @splicemood/lcov-to-cobertura coverage/lcov.info -o coverage/cobertura.xml
  coverage: '/Lines\s*:\s*(\d+.\d+)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura.xml
```

## Compatibility

This package implements the Python `lcov_cobertura` converter behavior as a small ESM TypeScript CLI. The package exposes both `lcov-to-cobertura` and `lcov_cobertura` bins. The test suite uses independent LCOV and Cobertura fixtures with `node:test`.
