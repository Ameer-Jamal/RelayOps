export interface SelectorCandidate {
  description: string;
  selector: string;
}

export const teamsSelectors = {
  shellReady: [
    { description: "app header by data-tid", selector: '[data-tid="app-layout-area--header"]' },
    { description: "main content area by data-tid", selector: '[data-tid="app-layout-area--main"]' },
    { description: "left navigation by data-tid", selector: '[data-tid="app-layout-area--left-nav"]' },
    { description: "navigation role", selector: '[role="navigation"]' },
    { description: "main role", selector: '[role="main"]' },
    { description: "search region", selector: '[data-tid="search-input"]' }
  ],
  loginHints: [
    { description: "microsoft email input", selector: 'input[name="loginfmt"]' },
    { description: "generic email input", selector: 'input[type="email"]' },
    { description: "password input", selector: 'input[type="password"]' },
    { description: "submit sign in button", selector: 'input[type="submit"], button[type="submit"]' }
  ],
  searchInput: [
    { description: "teams search data-tid input", selector: '[data-tid="search-input"] input' },
    { description: "search placeholder input", selector: 'input[placeholder*="Search" i]' },
    { description: "search aria-label input", selector: 'input[aria-label*="Search" i]' }
  ],
  composer: [
    {
      description: "reply conversation editor",
      selector: '[data-tid="ckeditor-replyConversation"] [contenteditable="true"]'
    },
    {
      description: "new message editor",
      selector: '[data-tid="ckeditor-newMessage"] [contenteditable="true"]'
    },
    { description: "textbox role editor", selector: '[contenteditable="true"][role="textbox"]' },
    { description: "message aria-label editor", selector: '[contenteditable="true"][aria-label*="message" i]' }
  ],
  sendButton: [
    { description: "send button aria-label", selector: 'button[aria-label*="Send" i]' },
    { description: "send button data-tid", selector: '[data-tid="send-button"]' },
    { description: "send button text", selector: 'button:has-text("Send")' }
  ],
  messageItems: [
    { description: "chat pane item", selector: '[data-tid="chat-pane-item"]' },
    { description: "message pane list item", selector: '[data-tid="message-pane-list-item"]' },
    { description: "generic list item", selector: '[role="listitem"]' }
  ],
  unreadIndicators: [
    { description: "aria-label unread indicator", selector: '[aria-label*="unread" i]' },
    { description: "data-tid unread indicator", selector: '[data-tid*="unread" i]' },
    { description: "unread count badge", selector: '[data-tid="unread-count-badge"]' }
  ],
  launcherUseWebApp: [
    { description: "use the web app instead by id", selector: '#openTeamsClientInBrowser' },
    { description: "join on web by data-tid", selector: '[data-tid="joinOnWeb"]' },
    { description: "use the web app button text", selector: 'button:has-text("Use the web app instead")' }
  ],
  targetHeaders: [
    { description: "main heading", selector: 'main [role="heading"]' },
    { description: "page heading", selector: '[role="main"] [role="heading"]' },
    { description: "header heading", selector: 'header [role="heading"]' },
    { description: "heading element", selector: 'h1, h2' }
  ]
} as const;
