/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { useState } from "react";
import { CreateCampaignDialog } from "../CreateCampaignDialog";
import { Button } from "@/components/ui/button";

export default function CreateCampaignDialogExample() {
  const [open, setOpen] = useState(false);

  return (
    <div className="p-8">
      <Button onClick={() => setOpen(true)} data-testid="button-open-dialog">
        Open Create Campaign Dialog
      </Button>
      <CreateCampaignDialog
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
