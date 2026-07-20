const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');
const touched = new Set();
const applied = [];
const skipped = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoDir, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(repoDir, relativePath), content, 'utf8');
  touched.add(relativePath);
}

function replaceOnce(relativePath, name, before, after, marker = after) {
  let content = read(relativePath);
  if (content.includes(marker)) {
    skipped.push(name);
    return;
  }
  const index = content.indexOf(before);
  if (index < 0) {
    throw new Error(`[prepare] ${name}: expected source anchor was not found in ${relativePath}`);
  }
  if (content.indexOf(before, index + before.length) >= 0) {
    throw new Error(`[prepare] ${name}: source anchor is ambiguous in ${relativePath}`);
  }
  content = `${content.slice(0, index)}${after}${content.slice(index + before.length)}`;
  write(relativePath, content);
  applied.push(name);
}

replaceOnce(
  'main.js',
  'expose exact build id',
  "const APP_TITLE = 'Aegis';\nconst APP_ID = 'com.aegis.client';\nlet chatPanelVisible = true;",
  "const APP_TITLE = 'Aegis';\nconst APP_ID = 'com.aegis.client';\nconst BUILD_ID = String(process.env.AEGIS_BUILD_SHA || 'development').trim();\nlet chatPanelVisible = true;",
  "const BUILD_ID = String(process.env.AEGIS_BUILD_SHA || 'development').trim();"
);

replaceOnce(
  'main.js',
  'publish build id',
  "  view.dispatchBusy = dispatchBusy;\n  return view;",
  "  view.dispatchBusy = dispatchBusy;\n  view.buildId = BUILD_ID;\n  return view;",
  '  view.buildId = BUILD_ID;'
);

replaceOnce(
  'main.js',
  'native ChatGPT editor bridge',
  "  ipcMain.handle('aegis:get-state', () => publicState());",
  `  ipcMain.handle('aegis-chat:native-editor', async (event, input = {}) => {\n    if (!chatView || event.sender !== chatView.webContents || event.sender.isDestroyed()) {\n      return { ok: false, error: 'Встроенный ChatGPT недоступен для нативного ввода.' };\n    }\n    const action = compact(input?.action, 40);\n    try {\n      chatView.webContents.focus();\n      if (action === 'insert-text') {\n        const text = String(input?.text || '');\n        if (!text) return { ok: false, error: 'Нативный ввод получил пустой текст.' };\n        if (typeof chatView.webContents.insertText !== 'function') {\n          return { ok: false, error: 'Electron webContents.insertText недоступен.' };\n        }\n        await Promise.resolve(chatView.webContents.insertText(text));\n        return { ok: true, action, chars: text.length };\n      }\n      if (action === 'press-enter') {\n        chatView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });\n        chatView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });\n        return { ok: true, action };\n      }\n      return { ok: false, error: \`Неизвестное нативное действие редактора: \${action || 'empty'}\` };\n    } catch (error) {\n      writeLog('warn', 'Native ChatGPT editor action failed', \`\${action}: \${error?.message || error}\`);\n      return { ok: false, error: compact(error?.message || error, 500) };\n    }\n  });\n\n  ipcMain.handle('aegis:get-state', () => publicState());`,
  "ipcMain.handle('aegis-chat:native-editor'"
);

replaceOnce(
  'main.js',
  'isolated send test',
  "  ipcMain.handle('aegis:reload-chatgpt', async () => {",
  `  ipcMain.handle('aegis:test-send', async () => {\n    const targetUrl = safeChatUrl(state.browser.url);\n    if (!isChatUrl(targetUrl)) return { ok: false, error: 'Открой конкретный разговор ChatGPT для теста.' };\n    if (!state.browser.composerReady) return { ok: false, error: 'Поле ввода ChatGPT сейчас не готово.' };\n    if (state.browser.generating) return { ok: false, error: 'Дождись завершения текущего ответа ChatGPT.' };\n    if (dispatchBusy || responseGate) return { ok: false, error: 'Дождись завершения текущей отправки Aegis.' };\n\n    const testText = \`AEGIS_TEST_\${Date.now().toString(36).toUpperCase()}\`;\n    const before = {\n      capturedAt: now(),\n      appVersion: app.getVersion(),\n      buildId: BUILD_ID,\n      targetUrl,\n      browser: JSON.parse(JSON.stringify(state.browser))\n    };\n    writeLog('info', 'Manual send test started', \`\${testText} | \${targetUrl}\`);\n    const result = await sendChatCommand('send', { text: testText, targetUrl }, 25000);\n    await new Promise((resolve) => setTimeout(resolve, 900));\n    const report = {\n      kind: 'AEGIS_SEND_TEST',\n      testText,\n      before,\n      result,\n      after: { capturedAt: now(), browser: JSON.parse(JSON.stringify(state.browser)) }\n    };\n    clipboard.writeText(JSON.stringify(report, null, 2));\n    addEvent('SEND TEST', result.ok ? 'Тестовая отправка прошла' : 'Тестовая отправка не прошла', \`\${testText}. Подробный отчёт скопирован в буфер обмена.\`, result.ok ? 'success' : 'danger');\n    writeLog(result.ok ? 'info' : 'warn', 'Manual send test completed', \`\${testText}: \${result.ok ? (result.method || 'ok') : (result.error || 'unknown error')}\`);\n    await commit();\n    return { ok: Boolean(result.ok), testText, copied: true, report, error: result.error || '' };\n  });\n\n  ipcMain.handle('aegis:reload-chatgpt', async () => {`,
  "ipcMain.handle('aegis:test-send'"
);

replaceOnce(
  'chatgpt-preload.js',
  'read full composer text',
  "  if ('value' in element) return cleanText(element.value, 4000);\n  return cleanText(element.innerText || element.textContent, 4000);",
  "  if ('value' in element) return cleanMessageText(element.value, 24000);\n  return cleanMessageText(element.innerText || element.textContent, 24000);",
  'return cleanMessageText(element.value, 24000);'
);

replaceOnce(
  'chatgpt-preload.js',
  'scan connected conversation turns',
  "  let turns = adapterRegistry.queryAll(document, activeAdapter().selectors.messageTurns).filter(isVisible);\n  if (!turns.length) turns = adapterRegistry.queryAll(document, activeAdapter().selectors.roleNodes).map((node) => node.closest('article') || node).filter(isVisible);",
  "  let turns = adapterRegistry.queryAll(document, activeAdapter().selectors.messageTurns).filter((node) => node?.isConnected);\n  if (!turns.length) turns = adapterRegistry.queryAll(document, activeAdapter().selectors.roleNodes).map((node) => node.closest('article, [data-testid*=\"conversation-turn\"], [data-message-id]') || node).filter((node) => node?.isConnected);",
  'filter((node) => node?.isConnected);'
);

replaceOnce(
  'chatgpt-preload.js',
  'read hidden assistant role nodes',
  "  const explicit = [...document.querySelectorAll('main [data-message-author-role=\"assistant\"]')].filter(isVisible).at(-1);",
  "  const explicit = [...document.querySelectorAll('main [data-message-author-role=\"assistant\"]')].at(-1);",
  "querySelectorAll('main [data-message-author-role=\"assistant\"]')].at(-1)"
);

replaceOnce(
  'chatgpt-preload.js',
  'allow hidden assistant action toolbars',
  "  const actionButtons = [...document.querySelectorAll('main button')].filter((button) => {\n    if (!isVisible(button)) return false;\n    const label = cleanText",
  "  const actionButtons = [...document.querySelectorAll('main button')].filter((button) => {\n    const label = cleanText",
  "const actionButtons = [...document.querySelectorAll('main button')].filter((button) => {\n    const label = cleanText"
);

replaceOnce(
  'chatgpt-preload.js',
  'native editor preload helper',
  'function dispatchInputLikeUser(element, text, inputType = \'insertText\') {',
  `async function nativeEditor(action, payload = {}) {\n  try {\n    const result = await ipcRenderer.invoke('aegis-chat:native-editor', { action, ...payload });\n    return result && typeof result === 'object' ? result : { ok: false, error: 'Пустой ответ нативного редактора.' };\n  } catch (error) {\n    return { ok: false, error: cleanText(error?.message || error, 500) };\n  }\n}\n\nfunction dispatchInputLikeUser(element, text, inputType = 'insertText') {`,
  'async function nativeEditor(action, payload = {})'
);

replaceOnce(
  'chatgpt-preload.js',
  'native composer insertion',
  "  clearComposer(element);\n  element.focus();\n\n  if ('value' in element) {",
  `  clearComposer(element);\n  element.focus();\n\n  const nativeResult = await nativeEditor('insert-text', { text });\n  if (nativeResult?.ok) {\n    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));\n    const nativeValue = composerValue(element);\n    if (cleanMessageText(nativeValue) === cleanMessageText(text)) return nativeValue;\n    clearComposer(element);\n    element.focus();\n  }\n\n  if ('value' in element) {`,
  "const nativeResult = await nativeEditor('insert-text', { text });"
);

replaceOnce(
  'chatgpt-preload.js',
  'scan all explicit user nodes',
  "  const nodes = [...document.querySelectorAll('main [data-message-author-role=\"user\"]')].filter(isVisible);",
  "  const nodes = [...document.querySelectorAll('main [data-message-author-role=\"user\"]')];",
  "const nodes = [...document.querySelectorAll('main [data-message-author-role=\"user\"]')];"
);

replaceOnce(
  'chatgpt-preload.js',
  'native enter with button fallback',
  "  if (button) {\n    button.focus();\n    button.click();\n    return 'button';\n  }",
  `  if (button) {\n    element.focus();\n    const nativeResult = await nativeEditor('press-enter');\n    if (nativeResult?.ok) return 'native-enter';\n    button.focus();\n    button.click();\n    return 'button-fallback';\n  }`,
  "return 'button-fallback';"
);

replaceOnce(
  'chatgpt-preload.js',
  'native enter without button',
  "  pressEnterToSend(element);\n  return 'enter';",
  `  const nativeResult = await nativeEditor('press-enter');\n  if (nativeResult?.ok) return 'native-enter-no-button';\n\n  pressEnterToSend(element);\n  return 'enter';`,
  "return 'native-enter-no-button';"
);

replaceOnce(
  'chatgpt-preload.js',
  'normalize full send text',
  "    const existingDraft = cleanText(composerValue(composer));\n    const intendedText = cleanText(text);",
  "    const existingDraft = cleanMessageText(composerValue(composer));\n    const intendedText = cleanMessageText(text);",
  'const existingDraft = cleanMessageText(composerValue(composer));'
);

replaceOnce(
  'chatgpt-preload.js',
  'verify full composer text',
  '    const filled = await waitFor(() => cleanText(composerValue(composer)) === intendedText, 5000);',
  '    const filled = await waitFor(() => cleanMessageText(composerValue(composer)) === intendedText, 5000);',
  'waitFor(() => cleanMessageText(composerValue(composer)) === intendedText'
);

replaceOnce(
  'chatgpt-preload.js',
  'accept composer clear or generation start',
  "      return newUserMessage ? { composerCleared: !composerValue(composer), newUserMessage, evidence } : null;",
  `      const composerCleared = !cleanMessageText(composerValue(composer));\n      const generationStarted = generatingNow();\n      return (newUserMessage || composerCleared || generationStarted)\n        ? { composerCleared, generationStarted, newUserMessage, evidence }\n        : null;`,
  'const generationStarted = generatingNow();'
);

replaceOnce(
  'chatgpt-preload.js',
  'native retry enter',
  "        pressEnterToSend(composer);\n        method = `${method}+enter`;",
  `        composer.focus();\n        const nativeRetry = await nativeEditor('press-enter');\n        if (!nativeRetry?.ok) pressEnterToSend(composer);\n        method = \`\${method}+\${nativeRetry?.ok ? 'native-enter' : 'enter'}\`;`,
  "const nativeRetry = await nativeEditor('press-enter');"
);

replaceOnce(
  'preload.js',
  'expose send test bridge',
  "  checkAllAutopilots: () => ipcRenderer.invoke('aegis:check-all-autopilots'),",
  "  checkAllAutopilots: () => ipcRenderer.invoke('aegis:check-all-autopilots'),\n  testSend: () => ipcRenderer.invoke('aegis:test-send'),",
  '  testSend: () => ipcRenderer.invoke(\'aegis:test-send\'),'
);

replaceOnce(
  'renderer/index.html',
  'show send test button',
  '    <button id="check">↻ Проверить сейчас</button>',
  '    <button id="check">↻ Проверить сейчас</button>\n    <button id="test-send">🧪 Тест отправки</button>',
  'id="test-send"'
);

replaceOnce(
  'renderer/app.js',
  'show exact build in status',
  "  $('#summary').innerHTML=`<div>Активно: <b>${sup.autopilotChatCount||0}</b></div>",
  "  $('#summary').innerHTML=`<div>Сборка: <b>${esc(s.buildId||'development')}</b></div><div>Активно: <b>${sup.autopilotChatCount||0}</b></div>",
  "<div>Сборка: <b>${esc(s.buildId||'development')}</b>"
);

replaceOnce(
  'renderer/app.js',
  'wire send test button',
  "$('#check').onclick=()=>call('checkAllAutopilots');",
  "$('#check').onclick=()=>call('checkAllAutopilots');$('#test-send').onclick=async()=>{const r=await call('testSend');if(r?.copied)toast(r.ok?`Отправлено: ${r.testText}`:'Тест не прошёл — отчёт скопирован')};",
  "$('#test-send').onclick=async()=>"
);

for (const relativePath of touched) {
  const content = read(relativePath);
  if (content.includes('\r\n')) write(relativePath, content.replace(/\r\n/g, '\n'));
}

console.log(`[Aegis prepare] applied ${applied.length}, already present ${skipped.length}`);
if (applied.length) console.log(`[Aegis prepare] ${applied.join('; ')}`);
