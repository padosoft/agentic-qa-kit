import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Profile, Project, RiskMap } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';

export interface ValidateOptions {
  root: string;
}

export interface ValidateIssue {
  file: string;
  path: string;
  message: string;
}

export interface ValidateResult {
  ok: boolean;
  checked: string[];
  issues: ValidateIssue[];
}

interface FileSpec {
  rel: string;
  parser: (data: unknown, rel: string) => ValidateIssue[];
  required: boolean;
}

function parseProject(data: unknown, rel: string): ValidateIssue[] {
  const r = Project.Project.safeParse(data);
  return r.success ? [] : zodIssues(r.error.issues, rel);
}

function parseRiskMap(data: unknown, rel: string): ValidateIssue[] {
  const r = RiskMap.RiskMap.safeParse(data);
  return r.success ? [] : zodIssues(r.error.issues, rel);
}

function parseProfiles(data: unknown, rel: string): ValidateIssue[] {
  const r = Profile.ProfilesFile.safeParse(data);
  return r.success ? [] : zodIssues(r.error.issues, rel);
}

function zodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
  rel: string,
): ValidateIssue[] {
  return issues.map((i) => ({
    file: rel,
    path: i.path.map((p) => String(p)).join('.') || '<root>',
    message: i.message,
  }));
}

const FILES: FileSpec[] = [
  { rel: '.aqa/project.yaml', parser: parseProject, required: true },
  { rel: '.aqa/risk-map.yaml', parser: parseRiskMap, required: true },
  { rel: '.aqa/profiles.yaml', parser: parseProfiles, required: true },
];

export function runValidate(opts: ValidateOptions): ValidateResult {
  const issues: ValidateIssue[] = [];
  const checked: string[] = [];
  for (const spec of FILES) {
    const abs = join(opts.root, spec.rel);
    if (!existsSync(abs)) {
      if (spec.required) {
        issues.push({ file: spec.rel, path: '<root>', message: 'missing required file' });
      }
      continue;
    }
    checked.push(spec.rel);
    let parsed: unknown;
    try {
      parsed = yamlParse(readFileSync(abs, 'utf8'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      issues.push({ file: spec.rel, path: '<root>', message: `YAML parse error: ${msg}` });
      continue;
    }
    issues.push(...spec.parser(parsed, spec.rel));
  }
  return { ok: issues.length === 0, checked, issues };
}
