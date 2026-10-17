/**
 * How the parts of the extension talk to each other:
 *
 *   right-click → background asks the content script of that frame what was under the cursor (TargetQuery)
 *               → background writes a CheckRequest to storage.session, under the window's key
 *               → the side panel of that window picks it up, downloads the image and runs the model
 */

export const MENU_ID = "check-image";

export interface TargetQuery {
  type: "get-target";
}

/** An image address the side panel can fetch (http(s) or data:), an error to show, or null if nothing was found. */
export type TargetReply = { src: string } | { error: string } | null;

export type CheckRequest = { id: string; at: number; pageUrl?: string } & ({ src: string } | { error: string });

/** One pending request per window: each window has its own side panel. */
export const requestKey = (windowId: number) => `check:${windowId}`;
