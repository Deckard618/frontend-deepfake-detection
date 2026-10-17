import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { MENU_ID, requestKey, type CheckRequest, type TargetQuery, type TargetReply } from "@/lib/messages";

const COPY_HINT = "Copy it instead (right-click → Copy image) and paste it in this panel.";

// Firefox's sidebar API is missing from the (Chrome-based) types.
const sidebarAction = (browser as unknown as { sidebarAction?: { open(): Promise<void>; toggle(): Promise<void> } })
  .sidebarAction;

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void createMenu();
    if (reason === "install" || reason === "update") void addToOpenTabs();
  });
  browser.runtime.onStartup.addListener(() => void createMenu());

  // The toolbar button opens the panel: Chrome does it by itself, Firefox has to be told.
  if (sidebarAction) browser.action.onClicked.addListener(() => void sidebarAction.toggle());
  else void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined || tab.windowId === undefined) return;
    openPanel(tab.windowId); // first: browsers only allow it while the click is being handled
    void check(info, tab.id, tab.windowId);
  });
});

async function createMenu() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU_ID,
    title: "Check image for AI",
    // Not only "image": sites like Instagram cover their images, and the browser then sees a page or a link.
    contexts: ["image", "link", "page", "frame"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  });
}

function openPanel(windowId: number) {
  const opening = sidebarAction ? sidebarAction.open() : browser.sidePanel.open({ windowId });
  opening.catch(() => {}); // the request waits in storage until the panel is opened by hand
}

/** Finds the image that was right-clicked and hands it to the side panel of that window. */
async function check(info: Browser.contextMenus.OnClickData, tabId: number, windowId: number) {
  const target = await askPage(tabId, info.frameId ?? 0);
  const base = { id: crypto.randomUUID(), at: Date.now(), pageUrl: info.pageUrl };
  let request: CheckRequest;
  if (target && "src" in target) request = { ...base, src: target.src };
  // Without the content script (a page that was open before the extension was installed), only a plain image works.
  else if (info.mediaType === "image" && info.srcUrl && !info.srcUrl.startsWith("blob:")) request = { ...base, src: info.srcUrl };
  else if (target && "error" in target) request = { ...base, error: `${target.error} ${COPY_HINT}` };
  else request = { ...base, error: `No image found where you right-clicked. ${COPY_HINT}` };

  const key = requestKey(windowId);
  try {
    await browser.storage.session.set({ [key]: request });
  } catch {
    // Over the session storage quota: a very large image read from the page as a data: URL.
    await browser.storage.session.set({ [key]: { ...base, error: `This image is too large to pass on. ${COPY_HINT}` } });
  }
}

async function askPage(tabId: number, frameId: number): Promise<TargetReply | undefined> {
  try {
    return await browser.tabs.sendMessage<TargetQuery, TargetReply>(tabId, { type: "get-target" }, { frameId });
  } catch {
    return undefined; // no content script in that page
  }
}

/** Content scripts only start in pages loaded after the install (in Chrome): add them to the tabs already open. */
async function addToOpenTabs() {
  for (const tab of await browser.tabs.query({ url: ["http://*/*", "https://*/*"] })) {
    if (tab.id === undefined) continue;
    browser.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["/content-scripts/content.js"] })
      .catch(() => {}); // pages extensions can't touch, unloaded tabs
  }
}
