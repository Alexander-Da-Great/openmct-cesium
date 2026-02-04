import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/cesium/Build/Cesium/Assets/*', dest: 'Assets' },
        { src: 'node_modules/cesium/Build/Cesium/Widgets/*', dest: 'Widgets' },
        { src: 'node_modules/cesium/Build/Cesium/Workers/*', dest: 'Workers' },
        { src: 'node_modules/cesium/Build/Cesium/ThirdParty/*', dest: 'ThirdParty' },
        { src: 'node_modules/openmct/dist/fonts/*', dest: 'fonts' },
        { src: 'node_modules/openmct/dist/openmct.js', dest: './' },
        { src: 'node_modules/openmct/dist/snowTheme.css', dest: './' }
      ]
    })
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify('')
  },
  server: {
    port: 3000,
    open: true
  },
  // CRITICAL: Disable sourcemaps to stop the console errors and thread blocking
  build: {
    sourcemap: false,
  },
  css: {
    devSourcemap: false
  }
});