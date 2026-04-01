import * as fs from 'fs-extra';
import * as path from 'path';
import { spawn } from 'child_process';
import { EnvironmentProvider, EnvironmentSetupOpts, CommandResult } from '../types';

export class LocalProvider implements EnvironmentProvider {
    private user?: string;
    private noCleanup: boolean = false;

    constructor(user?: string) {
        this.user = user;
    }

    setNoCleanup(value: boolean): void {
        this.noCleanup = value;
    }

    async setup(taskPath: string, skillsPaths: string[], _opts: EnvironmentSetupOpts, env?: Record<string, string>): Promise<string> {
        const taskName = path.basename(taskPath);
        const trialSuffix = _opts.trialId ? `_trial_${_opts.trialId}` : '';
        const randomSuffix = Math.random().toString(36).substring(7);
        const dirName = `skillgrade-${taskName}${trialSuffix}-${randomSuffix}`;
        const tempDir = path.join('/tmp', dirName);

        // Store noCleanup option from setup opts
        if (_opts.noCleanup !== undefined) {
            this.noCleanup = _opts.noCleanup;
        }

        await fs.ensureDir(tempDir);
        await fs.copy(taskPath, tempDir);

        // Inject skills into agent discovery paths
        // Gemini: .agents/skills/  |  Claude: .claude/skills/
        const discoveryDirs = [
            path.join(tempDir, '.agents', 'skills'),
            path.join(tempDir, '.claude', 'skills'),
        ];

        for (const skillsDir of discoveryDirs) {
            await fs.ensureDir(skillsDir);
            for (const spath of skillsPaths) {
                const skillName = path.basename(spath);
                await fs.copy(spath, path.join(skillsDir, skillName));
            }
        }

        return tempDir;
    }

    async cleanup(workspacePath: string): Promise<void> {
        if (this.noCleanup) {
            return; // Skip cleanup when --no-cleanup is set
        }
        if (await fs.pathExists(workspacePath)) {
            await fs.remove(workspacePath);
        }
    }

    async runCommand(workspacePath: string, command: string, env?: Record<string, string>): Promise<CommandResult> {
        return new Promise((resolve) => {
            // If user is specified, wrap command with sudo -u
            const finalCommand = this.user
                ? `sudo -u ${this.user} ${command}`
                : command;

            const child = spawn(finalCommand, {
                shell: true,
                cwd: workspacePath,
                env: { ...process.env, ...env }
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => { stdout += data.toString(); });
            child.stderr.on('data', (data) => { stderr += data.toString(); });

            child.on('close', (code) => {
                resolve({ stdout, stderr, exitCode: code ?? 1 });
            });

            child.on('error', () => {
                resolve({ stdout, stderr, exitCode: 1 });
            });
        });
    }
}
