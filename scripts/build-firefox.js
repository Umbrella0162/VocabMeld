/**
 * VocabMeld Firefox 构建脚本
 * 将 Chrome 扩展转换为 Firefox 兼容版本
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'firefox');
const POLYFILL_PATH = path.join(ROOT_DIR, 'node_modules', 'webextension-polyfill', 'dist', 'browser-polyfill.min.js');

// 需要复制的文件和目录
const FILES_TO_COPY = [
  'popup.html',
  'options.html',
  'css',
  'icons',
  '_locales'
];

// 需要复制的 JS 文件（将被转换）
const JS_FILES = [
  'js/popup.js',
  'js/options.js',
  'js/core',
  'js/services'
];

/**
 * 递归删除目录
 */
function rmdir(dir) {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(file => {
      const curPath = path.join(dir, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        rmdir(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dir);
  }
}

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 复制文件或目录
 */
function copy(src, dest) {
  const srcPath = path.join(ROOT_DIR, src);
  const destPath = path.join(DIST_DIR, src);

  if (fs.lstatSync(srcPath).isDirectory()) {
    copyDir(srcPath, destPath);
  } else {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
}

/**
 * 转换 JS 文件：将 chrome.* 替换为 browser.*
 */
function convertJsFile(content) {
  // 替换 chrome. 为 browser.（但保留 chrome:// URL）
  return content
    .replace(/\bchrome\.storage\b/g, 'browser.storage')
    .replace(/\bchrome\.runtime\b/g, 'browser.runtime')
    .replace(/\bchrome\.tabs\b/g, 'browser.tabs')
    .replace(/\bchrome\.commands\b/g, 'browser.commands')
    .replace(/\bchrome\.action\b/g, 'browser.action')
    .replace(/\bchrome\.scripting\b/g, 'browser.scripting');
}

/**
 * 复制并转换 JS 文件
 */
function copyAndConvertJs(src) {
  const srcPath = path.join(ROOT_DIR, src);
  const destPath = path.join(DIST_DIR, src);

  if (fs.lstatSync(srcPath).isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    const entries = fs.readdirSync(srcPath);
    for (const entry of entries) {
      copyAndConvertJs(path.join(src, entry).replace(/\\/g, '/'));
    }
  } else if (srcPath.endsWith('.js')) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const content = fs.readFileSync(srcPath, 'utf8');
    fs.writeFileSync(destPath, convertJsFile(content));
  }
}

/**
 * 生成 Firefox 专用的 manifest.json
 */
function generateFirefoxManifest() {
  const chromeManifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));

  const firefoxManifest = {
    manifest_version: 3,
    name: chromeManifest.name,
    description: chromeManifest.description,
    version: chromeManifest.version,
    default_locale: chromeManifest.default_locale,

    // Firefox 特定设置
    browser_specific_settings: {
      gecko: {
        id: 'vocabmeld@vocabmeld.com',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none']
        }
      }
    },

    icons: chromeManifest.icons,
    action: chromeManifest.action,

    // Firefox 使用 menus 而非 contextMenus，并移除 tts
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      'menus'
    ],

    host_permissions: chromeManifest.host_permissions,

    // Firefox MV3 使用 scripts 数组而非 service_worker
    background: {
      scripts: ['lib/browser-polyfill.min.js', 'js/background.js']
    },

    // Content scripts 需要先加载 polyfill
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['lib/browser-polyfill.min.js', 'js/content.js'],
        css: ['css/content.css'],
        run_at: 'document_idle'
      }
    ],

    options_ui: chromeManifest.options_ui,
    commands: chromeManifest.commands,
    web_accessible_resources: chromeManifest.web_accessible_resources
  };

  return firefoxManifest;
}

/**
 * 生成 Firefox 专用的 background.js
 */
function generateFirefoxBackground() {
  let content = fs.readFileSync(path.join(ROOT_DIR, 'js', 'background.js'), 'utf8');

  // 替换 chrome.* 为 browser.*
  content = convertJsFile(content);

  // 替换 contextMenus 为 menus
  content = content.replace(/\bchrome\.contextMenus\b/g, 'browser.menus');
  content = content.replace(/\bbrowser\.contextMenus\b/g, 'browser.menus');

  // 替换 TTS 实现：在 Firefox 中通过 content script 使用 Web Speech API
  const ttsReplacement = `// 语音合成 (Firefox: 通过 content script 使用 Web Speech API)
  if (message.action === 'speak') {
    browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
      if (tabs[0]) {
        browser.tabs.sendMessage(tabs[0].id, {
          action: 'speakInPage',
          text: message.text,
          lang: message.lang || 'en-US'
        }).catch(() => {
          console.log('[VocabMeld] Could not send TTS message to content script');
        });
      }
    });
    sendResponse({ success: true });
    return true;
  }`;

  // 替换原来的 TTS 代码块
  content = content.replace(
    /\/\/ 语音合成[\s\S]*?if \(message\.action === 'speak'\) \{[\s\S]*?return true;\s*\}/,
    ttsReplacement
  );

  return content;
}

/**
 * 生成 Firefox 专用的 content.js
 */
function generateFirefoxContent() {
  let content = fs.readFileSync(path.join(ROOT_DIR, 'js', 'content.js'), 'utf8');

  // 替换 chrome.* 为 browser.*
  content = convertJsFile(content);

  // 在消息监听器中添加 speakInPage 处理
  // 查找现有的 onMessage 监听器并添加 speakInPage 处理
  const speakInPageHandler = `
  // Firefox TTS: 处理 speakInPage 消息
  if (message.action === 'speakInPage') {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(message.text);
      utterance.lang = message.lang || 'en-US';
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    }
    return;
  }
`;

  // 在 onMessage 监听器的开头插入 speakInPage 处理
  content = content.replace(
    /(browser\.runtime\.onMessage\.addListener\s*\(\s*(?:async\s*)?\(\s*message(?:\s*,\s*sender)?(?:\s*,\s*sendResponse)?\s*\)\s*=>\s*\{)/,
    `$1${speakInPageHandler}`
  );

  // 如果上面的替换没有生效（可能格式不同），尝试另一种模式
  if (!content.includes('speakInPage')) {
    content = content.replace(
      /(chrome\.runtime\.onMessage\.addListener\s*\(\s*(?:async\s*)?\(\s*message(?:\s*,\s*sender)?(?:\s*,\s*sendResponse)?\s*\)\s*=>\s*\{)/,
      `$1${speakInPageHandler}`
    );
  }

  return content;
}

/**
 * 更新 HTML 文件中的脚本引用
 */
function updateHtmlFile(filename) {
  const srcPath = path.join(DIST_DIR, filename);
  let content = fs.readFileSync(srcPath, 'utf8');

  // 在现有脚本之前添加 polyfill
  content = content.replace(
    /<script\s+src="js\//g,
    '<script src="lib/browser-polyfill.min.js"></script>\n  <script src="js/'
  );

  // 去除重复的 polyfill 引用
  const polyfillTag = '<script src="lib/browser-polyfill.min.js"></script>';
  const firstIndex = content.indexOf(polyfillTag);
  if (firstIndex !== -1) {
    content = content.substring(0, firstIndex + polyfillTag.length) +
              content.substring(firstIndex + polyfillTag.length).replace(new RegExp(polyfillTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\n\\s*', 'g'), '');
  }

  fs.writeFileSync(srcPath, content);
}

// 主构建流程
console.log('VocabMeld Firefox Build');
console.log('========================\n');

// 1. 清理并创建输出目录
console.log('1. 清理输出目录...');
rmdir(DIST_DIR);
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. 复制静态文件
console.log('2. 复制静态文件...');
FILES_TO_COPY.forEach(file => {
  copy(file);
  console.log(`   - ${file}`);
});

// 3. 复制并转换 JS 文件
console.log('3. 复制并转换 JS 文件...');
JS_FILES.forEach(file => {
  copyAndConvertJs(file);
  console.log(`   - ${file}`);
});

// 4. 复制 polyfill
console.log('4. 复制 webextension-polyfill...');
const libDir = path.join(DIST_DIR, 'lib');
fs.mkdirSync(libDir, { recursive: true });
fs.copyFileSync(POLYFILL_PATH, path.join(libDir, 'browser-polyfill.min.js'));

// 5. 生成 Firefox manifest
console.log('5. 生成 Firefox manifest.json...');
const firefoxManifest = generateFirefoxManifest();
fs.writeFileSync(
  path.join(DIST_DIR, 'manifest.json'),
  JSON.stringify(firefoxManifest, null, 2)
);

// 6. 生成适配后的 background.js
console.log('6. 生成适配后的 background.js...');
fs.mkdirSync(path.join(DIST_DIR, 'js'), { recursive: true });
fs.writeFileSync(
  path.join(DIST_DIR, 'js', 'background.js'),
  generateFirefoxBackground()
);

// 7. 生成适配后的 content.js
console.log('7. 生成适配后的 content.js...');
fs.writeFileSync(
  path.join(DIST_DIR, 'js', 'content.js'),
  generateFirefoxContent()
);

// 8. 更新 HTML 文件
console.log('8. 更新 HTML 文件...');
updateHtmlFile('popup.html');
updateHtmlFile('options.html');

console.log('\n构建完成！');
console.log(`输出目录: ${DIST_DIR}`);
console.log('\n测试命令:');
console.log('  npm run test:firefox');
console.log('\n打包命令:');
console.log('  npm run package:firefox');
