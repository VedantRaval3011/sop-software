"use client";

import { ComplianceRunFloatingPanel } from "./ComplianceRunFloatingPanel";
import { ComplianceRunWatcher } from "./ComplianceRunWatcher";

/** Mounts the global compliance run indicator (survives page navigation). */
export function ComplianceRunHost() {
  return (
    <>
      <ComplianceRunWatcher />
      <ComplianceRunFloatingPanel />
    </>
  );
}
