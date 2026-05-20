import { CloudIcon, MonitorIcon, TerminalIcon } from "lucide-react";
import { detectEnvironment, type DetectedEnv } from "../../env";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function envLabel(env: DetectedEnv): string | null {
  if (env.wsl) return "WSL";
  if (env.container) return "Container";
  if (env.ci === "github-actions") return "CI: GitHub Actions";
  if (env.ci === "gitlab-ci") return "CI: GitLab CI";
  return null;
}

function envIcon(env: DetectedEnv) {
  if (env.wsl) return MonitorIcon;
  if (env.container) return TerminalIcon;
  if (env.ci) return CloudIcon;
  return null;
}

function envDescription(env: DetectedEnv): string {
  const parts: string[] = [];
  if (env.wsl) parts.push("Running in Windows Subsystem for Linux");
  if (env.container) parts.push("Running inside a container");
  if (env.ci === "github-actions") parts.push("Running in GitHub Actions CI");
  if (env.ci === "gitlab-ci") parts.push("Running in GitLab CI");
  return parts.join(". ") || "Standard environment";
}

export function EnvironmentIndicator() {
  const env = detectEnvironment();
  const label = envLabel(env);
  if (!label) return null;

  const Icon = envIcon(env)!;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={label}
            className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground"
          >
            <Icon className="size-3" />
            <span>{label}</span>
          </span>
        }
      />
      <TooltipPopup side="top">{envDescription(env)}</TooltipPopup>
    </Tooltip>
  );
}
