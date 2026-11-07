import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['apps', 'packages'];
const ignoredDirectories = new Set(['dist', 'generated', 'node_modules', '.turbo', 'coverage']);
const sourceFilePattern = /\.(?:[cm]?[jt]s|tsx)$/u;
const testFilePattern = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const allowedProductionDependencies = new Map([
  ['@who-ruined/contracts', new Set()],
  ['@who-ruined/artifacts', new Set(['@who-ruined/contracts'])],
  ['@who-ruined/testkit', new Set(['@who-ruined/contracts'])],
  ['@who-ruined/parser-adapter', new Set(['@who-ruined/match-domain'])],
  ['@who-ruined/match-domain', new Set(['@who-ruined/contracts'])],
  ['@who-ruined/features', new Set(['@who-ruined/contracts'])],
  ['@who-ruined/scoring', new Set(['@who-ruined/contracts'])],
  ['@who-ruined/database', new Set()],
  [
    '@who-ruined/validation',
    new Set([
      '@who-ruined/contracts',
      '@who-ruined/features',
      '@who-ruined/match-domain',
      '@who-ruined/parser-adapter',
      '@who-ruined/scoring',
    ]),
  ],
  ['@who-ruined/web', new Set(['@who-ruined/contracts'])],
  [
    '@who-ruined/api',
    new Set(['@who-ruined/artifacts', '@who-ruined/contracts', '@who-ruined/database', '@who-ruined/parser-adapter', '@who-ruined/scoring']),
  ],
  [
    '@who-ruined/worker',
    new Set([
      '@who-ruined/artifacts',
      '@who-ruined/contracts',
      '@who-ruined/database',
      '@who-ruined/features',
      '@who-ruined/match-domain',
      '@who-ruined/parser-adapter',
      '@who-ruined/scoring',
    ]),
  ],
]);

const temporaryProductionExceptions = [];

function toRepositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join('/');
}

async function discoverPackages() {
  const packages = [];
  for (const sourceRoot of sourceRoots) {
    const root = join(repositoryRoot, sourceRoot);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, entry.name);
      const manifestPath = join(directory, 'package.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      packages.push({ name: manifest.name, directory, manifest, manifestPath });
    }
  }
  return packages;
}

async function collectSourceFiles(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(join(current, entry.name));
      } else if (entry.isFile() && sourceFilePattern.test(entry.name)) {
        files.push(join(current, entry.name));
      }
    }
  }
  await visit(directory);
  return files;
}

function workspaceTarget(specifier, packageNames) {
  return packageNames.find((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function relativeWorkspaceTarget(internalTarget, packages) {
  if (internalTarget === null) return null;
  return packages.find((workspacePackage) => {
    const packagePath = toRepositoryPath(workspacePackage.directory);
    return internalTarget === packagePath || internalTarget.startsWith(`${packagePath}/`);
  })?.name ?? null;
}

function resolvedInternalTarget(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  return toRepositoryPath(resolve(dirname(file), specifier));
}

function exceptionFor(from, to) {
  return temporaryProductionExceptions.find((exception) => exception.from === from && exception.to === to);
}

function canonicalCycle(cycle) {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  const canonical = rotations.map((rotation) => rotation.join(' -> ')).sort()[0];
  return `${canonical} -> ${canonical.split(' -> ')[0]}`;
}

function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = new Set();

  function visit(node) {
    state.set(node, 1);
    stack.push(node);
    for (const target of graph.get(node) ?? []) {
      if ((state.get(target) ?? 0) === 0) visit(target);
      else if (state.get(target) === 1) {
        const start = stack.indexOf(target);
        cycles.add(canonicalCycle([...stack.slice(start), target]));
      }
    }
    stack.pop();
    state.set(node, 2);
  }

  for (const node of graph.keys()) if ((state.get(node) ?? 0) === 0) visit(node);
  return [...cycles].sort();
}

const packages = await discoverPackages();
const packageByName = new Map(packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]));
const packageNames = [...packageByName.keys()].sort((left, right) => right.length - left.length);
const violations = [];
const imports = [];

for (const workspacePackage of packages) {
  if (!allowedProductionDependencies.has(workspacePackage.name)) {
    violations.push(`${toRepositoryPath(workspacePackage.manifestPath)}: no production boundary rule for ${workspacePackage.name}`);
  }

  for (const file of await collectSourceFiles(workspacePackage.directory)) {
    const repositoryPath = toRepositoryPath(file);
    const isTestOnly = testFilePattern.test(repositoryPath);
    const preprocessed = ts.preProcessFile(await readFile(file, 'utf8'), true, true);
    for (const importedFile of preprocessed.importedFiles) {
      const specifier = importedFile.fileName;
      const internalTarget = resolvedInternalTarget(file, specifier);
      if (!isTestOnly && repositoryPath.startsWith('apps/web/src/') && internalTarget !== null) {
        if (repositoryPath.startsWith('apps/web/src/shared/')
          && internalTarget.startsWith('apps/web/src/features/')) {
          violations.push(`${repositoryPath}: shared frontend code imports feature code via ${specifier}`);
        }
        if (repositoryPath.startsWith('apps/web/src/entities/')
          && /apps\/web\/src\/(?:app|features|pages)\//u.test(internalTarget)) {
          violations.push(`${repositoryPath}: frontend entity imports an upper layer via ${specifier}`);
        }
        if (repositoryPath.startsWith('apps/web/src/pages/')
          && /apps\/web\/src\/(?:analytics|components|hooks|replay)\//u.test(internalTarget)) {
          violations.push(`${repositoryPath}: route page bypasses frontend feature/shared boundaries via ${specifier}`);
        }
        if (repositoryPath.startsWith('apps/web/src/pages/')
          && internalTarget.startsWith('apps/web/src/features/')
          && !/\/index\.[cm]?[jt]sx?$/u.test(internalTarget)) {
          violations.push(`${repositoryPath}: route page must use a feature public index, not ${specifier}`);
        }
        const sourceFeature = repositoryPath.match(/^apps\/web\/src\/features\/([^/]+)\//u)?.[1];
        const targetFeature = internalTarget.match(/^apps\/web\/src\/features\/([^/]+)\//u)?.[1];
        if (sourceFeature && targetFeature && sourceFeature !== targetFeature
          && !/\/index\.[cm]?[jt]sx?$/u.test(internalTarget)) {
          violations.push(`${repositoryPath}: cross-feature import must use the public index, not ${specifier}`);
        }
        if (sourceFeature && /apps\/web\/src\/(?:app|pages)\//u.test(internalTarget)) {
          violations.push(`${repositoryPath}: frontend feature imports route/composition code via ${specifier}`);
        }
      }
      if (repositoryPath.startsWith('apps/api/src/application/')) {
        const forbiddenWorkspaceImport = specifier === '@who-ruined/database' || specifier === '@who-ruined/parser-adapter';
        const forbiddenNodeIo = specifier === 'node:fs' || specifier.startsWith('node:fs/');
        const concreteApiDependency = internalTarget !== null && (
          internalTarget.startsWith('apps/api/src/infrastructure/')
          || internalTarget.startsWith('apps/api/src/modules/')
          || internalTarget.includes('/safe-exception.filter.')
          || internalTarget.includes('/bounded-gzip.')
          || internalTarget.includes('/match-result-storage.')
          || internalTarget.includes('/participation-rating.')
          || internalTarget.includes('/replay-storage.')
          || internalTarget.includes('/storage.')
        );
        if (forbiddenWorkspaceImport || forbiddenNodeIo || concreteApiDependency) {
          violations.push(`${repositoryPath}: API application code imports concrete infrastructure ${specifier}`);
        }
      }
      if (repositoryPath.startsWith('apps/api/src/modules/') && repositoryPath.endsWith('.controller.ts')) {
        const controllerInfrastructureImport = specifier === '@who-ruined/database'
          || specifier === '@who-ruined/parser-adapter'
          || (internalTarget?.startsWith('apps/api/src/infrastructure/') ?? false);
        if (controllerInfrastructureImport) {
          violations.push(`${repositoryPath}: controller imports infrastructure directly via ${specifier}`);
        }
      }
      if (workspacePackage.name === '@who-ruined/match-domain') {
        const forbiddenDomainImport = specifier === '@who-ruined/database'
          || specifier === '@who-ruined/parser-adapter'
          || specifier.startsWith('@nestjs/')
          || specifier.startsWith('@prisma/')
          || specifier === 'node:fs'
          || specifier.startsWith('node:fs/')
          || specifier === 'node:http'
          || specifier === 'node:https';
        if (forbiddenDomainImport) {
          violations.push(`${repositoryPath}: match-domain imports forbidden infrastructure ${specifier}`);
        }
      }
      if (workspacePackage.name === '@who-ruined/scoring') {
        const importTimeFileSystem = specifier === 'node:fs' || specifier.startsWith('node:fs/');
        if (importTimeFileSystem) {
          violations.push(`${repositoryPath}: scoring imports filesystem API ${specifier}; configs and scoring inputs must be explicit`);
        }
      }
      const packageSpecifierTarget = workspaceTarget(specifier, packageNames);
      if (packageSpecifierTarget && specifier !== packageSpecifierTarget) {
        violations.push(`${repositoryPath}: workspace deep import bypasses the public package entry point via ${specifier}`);
      }
      const relativeTarget = relativeWorkspaceTarget(internalTarget, packages);
      if (!isTestOnly && relativeTarget && relativeTarget !== workspacePackage.name) {
        violations.push(`${repositoryPath}: relative import crosses a workspace boundary via ${specifier}; use ${relativeTarget}`);
      }
      // Cross-workspace test fixtures may deliberately exercise a concrete
      // implementation. Production code must always use the package entrypoint.
      const target = packageSpecifierTarget ?? (isTestOnly ? null : relativeTarget);
      if (!target || target === workspacePackage.name) continue;
      imports.push({ from: workspacePackage.name, to: target, repositoryPath, specifier, isTestOnly });
    }
  }
}

for (const workspacePackage of packages) {
  const productionDependencies = workspacePackage.manifest.dependencies ?? {};
  const developmentDependencies = workspacePackage.manifest.devDependencies ?? {};
  for (const target of packageNames) {
    if (target === workspacePackage.name) continue;
    const declaredForProduction = target in productionDependencies;
    const declaredForDevelopment = target in developmentDependencies;
    const usedByProduction = imports.some((entry) => entry.from === workspacePackage.name && entry.to === target && !entry.isTestOnly);
    const usedByTests = imports.some((entry) => entry.from === workspacePackage.name && entry.to === target && entry.isTestOnly);

    if (usedByProduction && !declaredForProduction) {
      for (const entry of imports.filter((candidate) => candidate.from === workspacePackage.name && candidate.to === target && !candidate.isTestOnly)) {
        violations.push(`${entry.repositoryPath}: production import ${entry.specifier} is not declared in dependencies`);
      }
    }
    if (usedByTests && !declaredForProduction && !declaredForDevelopment) {
      for (const entry of imports.filter((candidate) => candidate.from === workspacePackage.name && candidate.to === target && candidate.isTestOnly)) {
        violations.push(`${entry.repositoryPath}: test-only import ${entry.specifier} is not declared in dependencies/devDependencies`);
      }
    }

    if (declaredForProduction || usedByProduction) {
      const allowed = allowedProductionDependencies.get(workspacePackage.name)?.has(target) ?? false;
      if (!allowed && !exceptionFor(workspacePackage.name, target)) {
        const paths = imports
          .filter((entry) => entry.from === workspacePackage.name && entry.to === target && !entry.isTestOnly)
          .map((entry) => entry.repositoryPath);
        const evidence = paths.length > 0 ? paths.join(', ') : `${toRepositoryPath(workspacePackage.manifestPath)} (declared dependency)`;
        violations.push(`${evidence}: forbidden production dependency ${workspacePackage.name} -> ${target}`);
      }
    }
  }
}

for (const exception of temporaryProductionExceptions) {
  const workspacePackage = packageByName.get(exception.from);
  const declared = exception.to in (workspacePackage?.manifest.dependencies ?? {});
  const paths = imports
    .filter((entry) => entry.from === exception.from && entry.to === exception.to && !entry.isTestOnly)
    .map((entry) => entry.repositoryPath);
  if (!declared && paths.length === 0) {
    violations.push(`stale temporary exception ${exception.from} -> ${exception.to}; remove it from scripts/check-architecture.mjs`);
  }
}

const productionGraph = new Map(packages.map((workspacePackage) => [workspacePackage.name, new Set()]));
const testInclusiveGraph = new Map(packages.map((workspacePackage) => [workspacePackage.name, new Set()]));
for (const workspacePackage of packages) {
  for (const dependency of Object.keys(workspacePackage.manifest.dependencies ?? {})) {
    if (packageByName.has(dependency)) {
      productionGraph.get(workspacePackage.name).add(dependency);
      testInclusiveGraph.get(workspacePackage.name).add(dependency);
    }
  }
  for (const dependency of Object.keys(workspacePackage.manifest.devDependencies ?? {})) {
    if (packageByName.has(dependency)) testInclusiveGraph.get(workspacePackage.name).add(dependency);
  }
}

for (const cycle of findCycles(productionGraph)) violations.push(`production dependency cycle: ${cycle}`);
for (const cycle of findCycles(testInclusiveGraph)) violations.push(`test-inclusive dependency cycle: ${cycle}`);

if (violations.length > 0) {
  console.error('Architecture boundary check failed:');
  for (const violation of violations.sort()) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture boundary check passed for ${packages.length} workspaces and ${imports.length} workspace imports.`);
  for (const exception of temporaryProductionExceptions) {
    const paths = imports
      .filter((entry) => entry.from === exception.from && entry.to === exception.to && !entry.isTestOnly)
      .map((entry) => entry.repositoryPath);
    console.log(`Temporary exception (${exception.removeIn}): ${exception.from} -> ${exception.to}`);
    console.log(`  reason: ${exception.reason}`);
    for (const path of paths) console.log(`  path: ${path}`);
  }
}
