import { defineConfig } from 'wxt'

// MV3 extension config. WXT generates the manifest (and MV2-converts for Firefox).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    name: 'factory wallet',
    description: 'self custody wallet for octra and factory.',
    permissions: ['storage', 'alarms'],
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
    // allow WebAssembly (pvac FHE) in extension pages
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    action: { default_title: 'factory wallet', default_icon: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' } },
    // inpage.js is injected into pages by the content script (window.octra provider),
    // so it must be web-accessible.
    web_accessible_resources: [{ resources: ['inpage.js'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true }],
  },
})
