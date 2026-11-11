import { isBuiltin } from "node:module";
import { posix } from "node:path";
import ts from "typescript";

const extensionRoot = "packages/extension";
const sdkRoot = "packages/sdk-ts";
const sharedRoot = "packages/shared-object-model";
const sdkPackage = "@browserbasehq/stagehand";
const extensionPackage = "@browserbasehq/stagehand-extension";
const sharedRuntimeDependencies = ["@browserbasehq/stagehand-protocol", "zod"];
const extensionBuildFiles = new Set(["vite.config", "instrumentedDecoratorBuild"]);

function inside(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}/`);
}

function packageImport(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(`${name}/`);
}

function testFile(file: string): boolean {
  return file.split("/").includes("tests") || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file);
}

function extensionProductionFile(file: string): boolean {
  return (
    inside(file, extensionRoot) &&
    !testFile(file) &&
    !extensionBuildFiles.has(posix.relative(extensionRoot, file).replace(/\.[cm]?[jt]s$/u, ""))
  );
}

/** Checks source imports without loading them, including type imports and dynamic imports. */
export function dependencyBoundaryViolations(file: string, source: string): string[] {
  file = posix.normalize(file.replaceAll("\\", "/"));
  const sharedProduction = inside(file, `${sharedRoot}/src`) && !testFile(file);
  const extensionProduction = extensionProductionFile(file);
  // Test coupling is intentionally outside this production boundary check.
  if (!sharedProduction && !extensionProduction) return [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const report = (node: ts.Node, message: string) => {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    violations.push(`${file}:${line + 1}: ${message}`);
  };

  function checkImport(node: ts.Node): void {
    if (!ts.isStringLiteralLike(node)) {
      report(node, "Production imports must use literal module specifiers.");
      return;
    }
    const specifier = node.text;
    const target = specifier.startsWith(".")
      ? posix.normalize(posix.join(posix.dirname(file), specifier))
      : specifier;
    if (packageImport(specifier, sdkPackage) || inside(target, sdkRoot)) {
      report(node, "The extension and shared object model must not import the TS SDK.");
      return;
    }
    if (
      sharedProduction &&
      (packageImport(specifier, extensionPackage) || inside(target, extensionRoot))
    ) {
      report(node, "The shared object model must not import the extension.");
      return;
    }
    if (specifier.startsWith("node:") || isBuiltin(specifier)) {
      report(node, "Browser production code must not import Node built-ins.");
      return;
    }
    if (sharedProduction) {
      const allowed = specifier.startsWith(".")
        ? inside(target, `${sharedRoot}/src`) && !testFile(target)
        : sharedRuntimeDependencies.some((name) => packageImport(specifier, name));
      if (!allowed) report(node, `Shared object model dependency is not allowed: ${specifier}`);
    }
    if (extensionProduction && specifier.startsWith(".") && !extensionProductionFile(target)) {
      report(
        node,
        "Extension production imports must stay in production code; use workspace packages for shared code.",
      );
    }
  }

  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      checkImport(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      checkImport(node.argument.literal);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      if (node.moduleReference.expression) checkImport(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments[0]) checkImport(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return violations;
}

export function manifestBoundaryViolations(
  name: string,
  manifest: Record<string, unknown>,
): string[] {
  const shared = name === "@browserbasehq/stagehand-shared-object-model";
  const violations: string[] = [];
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = manifest[field] as Record<string, string> | undefined;
    for (const dependency of Object.keys(dependencies ?? {})) {
      if (dependency === sdkPackage || (shared && dependency === extensionPackage)) {
        violations.push(`${name}: ${field} must not depend on ${dependency}`);
      } else if (
        shared &&
        field !== "devDependencies" &&
        !sharedRuntimeDependencies.includes(dependency)
      ) {
        violations.push(`${name}: unsupported runtime dependency ${dependency}`);
      }
    }
  }
  return violations;
}
