#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}\u2713${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}\u2717${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function readFile(relPath) {
  const absPath = path.resolve(SERVER_ROOT, relPath);
  return fs.readFileSync(absPath, 'utf8');
}

console.log(`${BLUE}PheWAS Structured Content Regression Tests${RESET}`);

const toolExpectations = [
  {
    path: 'src/tools/variant-lookup.ts',
    required: ['createCodeModeResponse', 'createCodeModeError'],
  },
];

for (const { path: filePath, required } of toolExpectations) {
  const content = readFile(filePath);
  for (const token of required) {
    assertContains(filePath, content, token, `${filePath} includes ${token}`);
  }
}

const indexContent = readFile('src/index.ts');
assertContains('src/index.ts', indexContent, 'PhewasDataDO', 'index.ts exports PhewasDataDO');
assertContains('src/index.ts', indexContent, 'McpAgent', 'index.ts uses McpAgent');
assertContains('src/index.ts', indexContent, 'registerVariantLookup', 'index.ts registers variant-lookup tool');

const variantLookupContent = readFile('src/tools/variant-lookup.ts');
assertContains(
  'src/tools/variant-lookup.ts',
  variantLookupContent,
  '"phewas_variant_lookup"',
  'variant-lookup.ts registers phewas_variant_lookup',
);
assertContains(
  'src/tools/variant-lookup.ts',
  variantLookupContent,
  '"mcp_phewas_variant_lookup"',
  'variant-lookup.ts registers mcp_phewas_variant_lookup (dual registration)',
);

const adapterContent = readFile('src/lib/api-adapter.ts');
assertContains(
  'src/lib/api-adapter.ts',
  adapterContent,
  '@bio-mcp/shared/variants/resolve',
  'api-adapter.ts imports from @bio-mcp/shared/variants/resolve',
);

console.log(`\n${BLUE}Test Results Summary${RESET}`);
console.log(`Total tests: ${totalTests}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${RED}Failed: ${failedTests}${RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}Regression tests failed.${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}PheWAS structured content regression tests passed.${RESET}`);
