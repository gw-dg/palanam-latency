// background.js

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "get_youtube_cookies") {
    // Get all cookies for youtube.com
    chrome.cookies.getAll({ domain: ".youtube.com" }, (cookies) => {
      // Format cookies as Netscape cookie file format (or as a JSON array)
      // Here, we'll send as a JSON array for simplicity
      sendResponse({ cookies });
    });
    // Indicate async response
    return true;
  }
});
