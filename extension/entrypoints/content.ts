import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { fetchableSource, findImageAt } from "@/lib/findImage";
import type { TargetQuery, TargetReply } from "@/lib/messages";

/** Remembers where the context menu was opened, and tells the background which image is there. */
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  main(ctx) {
    let point: { x: number; y: number } | null = null;
    ctx.addEventListener(window, "contextmenu", (e) => (point = { x: e.clientX, y: e.clientY }), { capture: true });

    const onMessage = (message: TargetQuery, _sender: unknown, reply: (answer: TargetReply) => void) => {
      if (message?.type !== "get-target") return;
      const found = point && findImageAt(point.x, point.y);
      if (!found) return reply(null);
      fetchableSource(found).then(
        (src) => reply({ src }),
        (e: Error) => reply({ error: e.message }),
      );
      return true; // answered asynchronously
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));
  },
});
