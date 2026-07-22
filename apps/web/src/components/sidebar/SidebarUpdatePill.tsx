import { GitMergeIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { isElectron } from "../../env";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateButtonTooltip,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
} from "../desktopUpdate.logic";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function SidebarUpdateReleaseNotesTooltip({
  state,
  tooltip,
}: {
  readonly state: NonNullable<ReturnType<typeof useDesktopUpdateState>>;
  readonly tooltip: string;
}) {
  if (state.channel !== "nightly" || state.releaseNotes.length === 0) {
    return <>{tooltip}</>;
  }

  return (
    <div className="w-120 max-w-[calc(100vw-2rem)] text-left">
      <div className="px-1">
        <div className="text-sm leading-5 font-medium">{tooltip}</div>
      </div>
      <div className="pointer-events-auto max-h-[min(28rem,calc(100vh-6rem))] overflow-y-auto px-1 pt-4 pb-1">
        {state.releaseNotes.map((releaseNote, index) => (
          <div key={releaseNote.version}>
            {index > 0 && <Separator className="my-3 bg-border/60" />}
            <section>
              <h3 className="text-muted-foreground text-xs leading-4 font-semibold">
                {index === 0 ? "What's changed" : `Changes in ${releaseNote.version}`}
              </h3>
              <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-popover-foreground/90">
                {releaseNote.items.map((item, itemIndex) => (
                  <li className="list-disc break-words" key={`${releaseNote.version}-${itemIndex}`}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Fork build: upstream releases cannot be installed in place, so instead of
 * the download/install actions this pill is a passive reminder to merge
 * upstream into the fork and rebuild. Release notes stay in the tooltip.
 */
export function SidebarUpdatePill() {
  const state = useDesktopUpdateState();
  const [dismissed, setDismissed] = useState(false);

  const visible = isElectron && shouldShowDesktopUpdateButton(state) && !dismissed;
  const tooltip = state ? getDesktopUpdateButtonTooltip(state) : "Update available";

  const showArm64Warning = isElectron && shouldShowArm64IntelBuildWarning(state);
  const arm64Description =
    state && showArm64Warning ? getArm64IntelBuildWarningDescription(state) : null;

  if (!visible && !showArm64Warning) return null;

  return (
    <div className="flex flex-col gap-1">
      {showArm64Warning && arm64Description && (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
          <TriangleAlertIcon />
          <AlertTitle>Intel build on Apple Silicon</AlertTitle>
          <AlertDescription>{arm64Description}</AlertDescription>
        </Alert>
      )}
      {visible && (
        <div className="group/update relative flex h-7 w-full items-center rounded-lg bg-primary/15 text-xs font-medium text-primary">
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  aria-label={tooltip}
                  className="relative flex h-full flex-1 cursor-default items-center gap-2 px-2"
                >
                  <GitMergeIcon className="size-3.5" />
                  <span>Upstream updated — merge fork & rebuild</span>
                </div>
              }
            />
            <TooltipPopup
              align="start"
              className={
                state?.channel === "nightly" && state.releaseNotes.length > 0
                  ? "max-w-none text-balance"
                  : undefined
              }
              side="top"
            >
              {state ? (
                <SidebarUpdateReleaseNotesTooltip state={state} tooltip={tooltip} />
              ) : (
                tooltip
              )}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Dismiss update notice"
                  className="mr-1 inline-flex size-5 items-center justify-center rounded-md text-primary/60 transition-colors hover:text-primary"
                  onClick={() => setDismissed(true)}
                >
                  <XIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">Dismiss until next launch</TooltipPopup>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
