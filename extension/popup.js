// popup.js

function cookiesToNetscapeFormat(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    if (!c.domain || !c.name || typeof c.value === 'undefined') continue;
    // Use domain as-is
    const domain = c.domain;
    // includeSubdomains: TRUE if domain starts with dot, else FALSE
    const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    const name = c.name;
    const value = c.value;
    lines.push([
      domain,
      includeSubdomains,
      path,
      secure,
      expiry,
      name,
      value
    ].join('\t'));
  }
  return lines.join('\n');
}

document.getElementById('extractBtn').addEventListener('click', () => {
  const statusDiv = document.getElementById('cookieStatus');
  const cookieText = document.getElementById('cookieText');
  statusDiv.textContent = 'Extracting cookies...';
  cookieText.value = '';

  chrome.runtime.sendMessage({ type: 'get_youtube_cookies' }, (response) => {
    if (chrome.runtime.lastError) {
      statusDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
      return;
    }
    if (response && response.cookies) {
      statusDiv.textContent = 'Cookies extracted!';
      cookieText.value = cookiesToNetscapeFormat(response.cookies);
    } else {
      statusDiv.textContent = 'No cookies found or failed to extract.';
    }
  });
}); 